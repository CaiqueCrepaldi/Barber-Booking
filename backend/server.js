require('dotenv').config();

const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const session = require('express-session');
const cron = require('node-cron');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

const app = express();
const PORT = process.env.PORT || 3001;

// SESSION_SECRET é obrigatório — nunca use valor padrão em produção
if (!process.env.SESSION_SECRET) {
  console.error('ERRO CRÍTICO: SESSION_SECRET não definido. Configure no arquivo .env');
  process.exit(1);
}

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 15 * 60 * 1000,
    httpOnly: true,
    sameSite: 'strict'
  }
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Banco de dados — senha obrigatória via env var
if (!process.env.MYSQL_PASSWORD) {
  console.error('ERRO CRÍTICO: MYSQL_PASSWORD não definido. Configure no arquivo .env');
  process.exit(1);
}

const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE || 'barbearia_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

let pool;
try {
  pool = mysql.createPool(dbConfig);
  console.log('✓ Conexão com banco de dados configurada');
} catch (err) {
  console.error('⚠️  Erro ao conectar ao banco de dados:', err.message);
}

// Adiciona colunas de reset de senha se ainda não existirem
async function migratePasswordReset() {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    const db = process.env.MYSQL_DATABASE || 'barbearia_db';
    const [cols] = await conn.query(
      `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'usuarios'
         AND COLUMN_NAME IN ('reset_token','reset_token_expiry','reset_token_attempts')`,
      [db]
    );
    const existing = cols.map(r => r.COLUMN_NAME);
    if (!existing.includes('reset_token'))
      await conn.query('ALTER TABLE usuarios ADD COLUMN reset_token VARCHAR(255) NULL');
    if (!existing.includes('reset_token_expiry'))
      await conn.query('ALTER TABLE usuarios ADD COLUMN reset_token_expiry DATETIME NULL');
    if (!existing.includes('reset_token_attempts'))
      await conn.query('ALTER TABLE usuarios ADD COLUMN reset_token_attempts TINYINT NOT NULL DEFAULT 0');
    console.log('✓ Migração reset_token concluída');
  } catch (err) {
    console.error('⚠️  Erro na migração reset_token:', err.message);
  } finally {
    conn.release();
  }
}
migratePasswordReset();

// Garante que não seja possível reservar o mesmo horário duas vezes na mesma data
async function migrateUniqueSlot() {
  if (!pool) return;
  const conn = await pool.getConnection();
  try {
    const db = process.env.MYSQL_DATABASE || 'barbearia_db';
    const [indexes] = await conn.query(
      `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'agendamentos' AND INDEX_NAME = 'unique_slot'`,
      [db]
    );
    if (indexes.length === 0) {
      // Remove duplicatas existentes antes de criar o índice
      await conn.query(`
        DELETE a FROM agendamentos a
        INNER JOIN agendamentos b
          ON a.data = b.data AND a.horario = b.horario AND a.id > b.id
      `);
      await conn.query('ALTER TABLE agendamentos ADD UNIQUE INDEX unique_slot (data, horario)');
      console.log('✓ Migração unique_slot concluída');
    }
  } catch (err) {
    console.error('⚠️  Erro na migração unique_slot:', err.message);
  } finally {
    conn.release();
  }
}
migrateUniqueSlot();

// Transporte de e-mail (opcional — configure GMAIL_USER e GMAIL_PASS no .env)
function createMailTransport() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS }
  });
}

async function sendOtpEmail(to, otp) {
  const transport = createMailTransport();
  if (!transport) return false;
  await transport.sendMail({
    from: `"Barbearia" <${process.env.GMAIL_USER}>`,
    to,
    subject: 'Código de recuperação de senha',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <div style="background:linear-gradient(135deg,#d4af37,#a67c00);padding:28px;text-align:center;border-radius:10px 10px 0 0">
          <div style="font-size:40px">✂️</div>
          <h2 style="color:#1a1a1a;margin:6px 0 0;font-size:20px">Barbearia</h2>
        </div>
        <div style="background:#1a1a1a;padding:32px;border-radius:0 0 10px 10px;color:#ccc">
          <h3 style="color:#d4af37;margin:0 0 12px">Recuperação de senha</h3>
          <p style="margin:0 0 20px;font-size:14px">Use o código abaixo para redefinir sua senha. Ele expira em <strong style="color:#fff">10 minutos</strong>.</p>
          <div style="background:#111;border-radius:8px;padding:20px;text-align:center;letter-spacing:14px;font-size:34px;font-weight:800;color:#d4af37;font-family:monospace">${otp}</div>
          <p style="margin:20px 0 0;font-size:12px;color:#555">Se você não solicitou isso, ignore este e-mail.</p>
        </div>
      </div>`
  });
  return true;
}

async function sendBookingEmails({ nome, servico, data, horario, telefone, clientEmail }) {
  const transport = createMailTransport();
  if (!transport) return;

  const dataFormatada = new Date(data + 'T12:00:00').toLocaleDateString('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  });

  const cardStyle = 'background:#1a1a1a;padding:32px;border-radius:0 0 10px 10px;color:#ccc;font-family:sans-serif';
  const headerStyle = 'background:linear-gradient(135deg,#d4af37,#a67c00);padding:24px 32px;border-radius:10px 10px 0 0;text-align:center';
  const rowStyle = 'display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px';
  const labelStyle = 'color:#888';
  const valueStyle = 'color:#f0f0f0;font-weight:600';

  const detailsHtml = (items) => items.map(([label, value]) =>
    `<div style="${rowStyle}"><span style="${labelStyle}">${label}</span><span style="${valueStyle}">${value}</span></div>`
  ).join('');

  // Notificação para o dono da barbearia
  if (process.env.GMAIL_USER) {
    transport.sendMail({
      from: `"Barbearia Sistema" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `📅 Novo agendamento: ${nome} — ${horario}`,
      html: `
        <div style="max-width:480px;margin:0 auto">
          <div style="${headerStyle}">
            <div style="font-size:36px">✂️</div>
            <h2 style="color:#1a1a1a;margin:6px 0 0;font-size:18px">Novo Agendamento</h2>
          </div>
          <div style="${cardStyle}">
            ${detailsHtml([
              ['Cliente', nome],
              ['Serviço', servico],
              ['Data', dataFormatada],
              ['Horário', horario],
              ['Telefone', telefone]
            ])}
          </div>
        </div>`
    }).catch(err => console.error('Erro ao notificar dono:', err.message));
  }

  // Confirmação para o cliente
  if (clientEmail) {
    transport.sendMail({
      from: `"Barbearia" <${process.env.GMAIL_USER}>`,
      to: clientEmail,
      subject: '✅ Agendamento confirmado!',
      html: `
        <div style="max-width:480px;margin:0 auto">
          <div style="${headerStyle}">
            <div style="font-size:36px">✂️</div>
            <h2 style="color:#1a1a1a;margin:6px 0 0;font-size:18px">Agendamento Confirmado</h2>
          </div>
          <div style="${cardStyle}">
            <p style="margin:0 0 20px;font-size:14px">Olá, <strong style="color:#d4af37">${nome}</strong>! Seu horário está reservado.</p>
            ${detailsHtml([
              ['Serviço', servico],
              ['Data', dataFormatada],
              ['Horário', horario]
            ])}
            <p style="margin:20px 0 0;font-size:12px;color:#555">Para cancelar ou reagendar, acesse o site.</p>
          </div>
        </div>`
    }).catch(err => console.error('Erro ao notificar cliente:', err.message));
  }
}

async function sendUpdateEmail({ nome, servico, novaData, novoHorario, antigaData, antigoHorario, clientEmail }) {
  const transport = createMailTransport();
  if (!transport) return;
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const cardStyle = 'background:#1a1a1a;padding:32px;border-radius:0 0 10px 10px;color:#ccc;font-family:sans-serif';
  const headerStyle = 'background:linear-gradient(135deg,#d4af37,#a67c00);padding:24px 32px;border-radius:10px 10px 0 0;text-align:center';
  const rowStyle = 'display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px';
  const labelStyle = 'color:#888';
  const valueStyle = 'color:#f0f0f0;font-weight:600';
  const rows = items => items.map(([l, v]) =>
    `<div style="${rowStyle}"><span style="${labelStyle}">${l}</span><span style="${valueStyle}">${v}</span></div>`
  ).join('');

  if (process.env.GMAIL_USER) {
    transport.sendMail({
      from: `"Barbearia Sistema" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `✏️ Agendamento alterado: ${nome} — ${novoHorario}`,
      html: `<div style="max-width:480px;margin:0 auto"><div style="${headerStyle}"><div style="font-size:36px">✂️</div><h2 style="color:#1a1a1a;margin:6px 0 0;font-size:18px">Agendamento Alterado</h2></div><div style="${cardStyle}">${rows([['Cliente', nome], ['Serviço', servico], ['Data anterior', fmt(antigaData)], ['Horário anterior', antigoHorario], ['Nova data', fmt(novaData)], ['Novo horário', novoHorario]])}</div></div>`
    }).catch(err => console.error('Erro ao notificar dono (update):', err.message));
  }
  if (clientEmail) {
    transport.sendMail({
      from: `"Barbearia" <${process.env.GMAIL_USER}>`,
      to: clientEmail,
      subject: '✏️ Seu agendamento foi alterado',
      html: `<div style="max-width:480px;margin:0 auto"><div style="${headerStyle}"><div style="font-size:36px">✂️</div><h2 style="color:#1a1a1a;margin:6px 0 0;font-size:18px">Agendamento Atualizado</h2></div><div style="${cardStyle}"><p style="margin:0 0 20px;font-size:14px">Olá, <strong style="color:#d4af37">${nome}</strong>! Seu agendamento foi reagendado.</p>${rows([['Serviço', servico], ['Nova data', fmt(novaData)], ['Novo horário', novoHorario]])}<p style="margin:20px 0 0;font-size:12px;color:#555">Para cancelar ou reagendar novamente, acesse o site.</p></div></div>`
    }).catch(err => console.error('Erro ao notificar cliente (update):', err.message));
  }
}

async function sendCancelEmail({ nome, servico, data, horario, clientEmail }) {
  const transport = createMailTransport();
  if (!transport) return;
  const fmt = d => new Date(d + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
  const cardStyle = 'background:#1a1a1a;padding:32px;border-radius:0 0 10px 10px;color:#ccc;font-family:sans-serif';
  const headerStyle = 'background:linear-gradient(135deg,#c0392b,#96281b);padding:24px 32px;border-radius:10px 10px 0 0;text-align:center';
  const rowStyle = 'display:flex;justify-content:space-between;padding:10px 0;border-bottom:1px solid #2a2a2a;font-size:14px';
  const labelStyle = 'color:#888';
  const valueStyle = 'color:#f0f0f0;font-weight:600';
  const rows = items => items.map(([l, v]) =>
    `<div style="${rowStyle}"><span style="${labelStyle}">${l}</span><span style="${valueStyle}">${v}</span></div>`
  ).join('');

  if (process.env.GMAIL_USER) {
    transport.sendMail({
      from: `"Barbearia Sistema" <${process.env.GMAIL_USER}>`,
      to: process.env.GMAIL_USER,
      subject: `❌ Agendamento cancelado: ${nome}`,
      html: `<div style="max-width:480px;margin:0 auto"><div style="${headerStyle}"><div style="font-size:36px">✂️</div><h2 style="color:#fff;margin:6px 0 0;font-size:18px">Agendamento Cancelado</h2></div><div style="${cardStyle}">${rows([['Cliente', nome], ['Serviço', servico], ['Data', fmt(data)], ['Horário', horario]])}</div></div>`
    }).catch(err => console.error('Erro ao notificar dono (cancel):', err.message));
  }
  if (clientEmail) {
    transport.sendMail({
      from: `"Barbearia" <${process.env.GMAIL_USER}>`,
      to: clientEmail,
      subject: '❌ Agendamento cancelado',
      html: `<div style="max-width:480px;margin:0 auto"><div style="${headerStyle}"><div style="font-size:36px">✂️</div><h2 style="color:#fff;margin:6px 0 0;font-size:18px">Agendamento Cancelado</h2></div><div style="${cardStyle}"><p style="margin:0 0 20px;font-size:14px">Olá, <strong style="color:#e74c3c">${nome}</strong>. Seu agendamento foi cancelado.</p>${rows([['Serviço', servico], ['Data', fmt(data)], ['Horário', horario]])}<p style="margin:20px 0 0;font-size:12px;color:#555">Para fazer um novo agendamento, acesse o site.</p></div></div>`
    }).catch(err => console.error('Erro ao notificar cliente (cancel):', err.message));
  }
}

// Limpeza automática de agendamentos expirados
cron.schedule('*/5 * * * *', async () => {
  if (!pool) return;
  try {
    const connection = await pool.getConnection();
    await connection.query(
      'DELETE FROM agendamentos WHERE data < CURDATE() OR (data = CURDATE() AND horario < CURTIME())'
    );
    connection.release();
  } catch (err) {
    console.error('Erro ao limpar agendamentos expirados:', err);
  }
});

// Remove caracteres especiais de strings usadas em mensagens
function sanitizeText(str) {
  if (!str) return '';
  return String(str).replace(/[<>&"'`\\]/g, '');
}

// Middleware: exige sessão de admin ativa
function requireAdmin(req, res, next) {
  if (!req.session.admin) {
    return res.status(401).json({ error: 'Acesso não autorizado' });
  }
  next();
}

// ── Sessão de usuário ─────────────────────────────────────────────────────────

app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// ── Autenticação de admin (backend) ──────────────────────────────────────────

app.post('/api/admin/login', (req, res) => {
  const { login, senha } = req.body;
  const adminUser = process.env.ADMIN_USER;
  const adminPass = process.env.ADMIN_PASSWORD;

  if (!adminUser || !adminPass) {
    return res.status(500).json({ error: 'Painel admin não configurado no servidor' });
  }
  if (!login || !senha) {
    return res.status(400).json({ error: 'Preencha login e senha' });
  }
  if (login !== adminUser || senha !== adminPass) {
    return res.status(401).json({ error: 'Credenciais inválidas' });
  }

  req.session.admin = { user: adminUser };
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  delete req.session.admin;
  res.json({ success: true });
});

app.get('/api/admin/session', (req, res) => {
  res.json({ loggedIn: !!req.session.admin });
});

// ── Autenticação de usuário ───────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  const { login, senha } = req.body;
  if (!login || !senha) {
    return res.status(400).json({ error: 'Preencha login e senha' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM usuarios WHERE usuario = ?', [login]);
    connection.release();

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
    const senhaValida = await bcrypt.compare(senha, rows[0].senha);
    if (!senhaValida) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }

    req.session.user = {
      id: rows[0].id,
      usuario: rows[0].usuario,
      nome: rows[0].nome,
      email: rows[0].email
    };
    res.json({ success: true, user: req.session.user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao autenticar usuário' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.post('/api/registrar', async (req, res) => {
  const { login, email, senha } = req.body;
  if (!login || !email || !senha) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }
  if (senha.length < 6) {
    return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [existe] = await connection.query(
      'SELECT id FROM usuarios WHERE usuario = ? OR email = ?', [login, email]
    );
    if (existe.length > 0) {
      connection.release();
      return res.status(409).json({ error: 'Login ou e-mail já cadastrado' });
    }
    const senhaHash = await bcrypt.hash(senha, 12);
    await connection.query(
      'INSERT INTO usuarios (usuario, senha, nome, email) VALUES (?, ?, ?, ?)',
      [login, senhaHash, login, email]
    );
    connection.release();
    res.json({ success: true, message: 'Usuário registrado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

// ── Recuperação de senha ──────────────────────────────────────────────────────

app.post('/api/forgot-password', async (req, res) => {
  const { email } = req.body;
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return res.status(400).json({ error: 'Informe um e-mail válido' });
  }
  if (!pool) return res.status(500).json({ error: 'Banco de dados não configurado' });

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query('SELECT id, email, reset_token_expiry FROM usuarios WHERE email = ?', [email]);
    if (rows.length === 0) {
      conn.release();
      return res.status(404).json({ error: 'E-mail não encontrado em nosso sistema' });
    }

    // Rate limit: bloqueia novo envio dentro de 60 segundos
    const expiry = rows[0].reset_token_expiry;
    if (expiry && new Date(expiry) > new Date(Date.now() - (9 * 60 * 1000))) {
      conn.release();
      return res.status(429).json({ error: 'Aguarde 1 minuto antes de solicitar um novo código' });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const otpHash = await bcrypt.hash(otp, 10);

    await conn.query(
      `UPDATE usuarios SET reset_token = ?, reset_token_expiry = DATE_ADD(NOW(), INTERVAL 10 MINUTE), reset_token_attempts = 0 WHERE email = ?`,
      [otpHash, email]
    );
    conn.release();

    const emailSent = await sendOtpEmail(email, otp).catch(() => false);

    const response = { success: true };
    if (!emailSent) response.demo = otp; // modo demo: devolve o código quando e-mail não configurado

    res.json(response);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao processar solicitação' });
  }
});

app.post('/api/verify-otp', async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code || String(code).length !== 6) {
    return res.status(400).json({ error: 'Dados inválidos' });
  }
  if (!pool) return res.status(500).json({ error: 'Banco de dados não configurado' });

  try {
    const conn = await pool.getConnection();
    const [rows] = await conn.query(
      'SELECT id, reset_token, reset_token_expiry, reset_token_attempts FROM usuarios WHERE email = ?',
      [email]
    );

    if (rows.length === 0 || !rows[0].reset_token) {
      conn.release();
      return res.status(400).json({ error: 'Nenhum código de verificação ativo para este e-mail' });
    }

    const { id, reset_token, reset_token_expiry, reset_token_attempts } = rows[0];

    if (new Date(reset_token_expiry) < new Date()) {
      conn.release();
      return res.status(400).json({ error: 'Código expirado. Solicite um novo código' });
    }

    if (reset_token_attempts >= 5) {
      conn.release();
      return res.status(429).json({ error: 'Muitas tentativas. Solicite um novo código', tentativas: 5 });
    }

    const valid = await bcrypt.compare(String(code), reset_token);

    if (!valid) {
      const attempts = reset_token_attempts + 1;
      await conn.query('UPDATE usuarios SET reset_token_attempts = ? WHERE email = ?', [attempts, email]);
      conn.release();
      return res.status(401).json({ error: 'Código incorreto', tentativas: attempts });
    }

    // Código correto: invalida o token e autoriza o reset via sessão
    await conn.query(
      'UPDATE usuarios SET reset_token = NULL, reset_token_expiry = NULL, reset_token_attempts = 0 WHERE email = ?',
      [email]
    );
    conn.release();

    req.session.resetUser = { id, email, authorizedAt: Date.now() };
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao verificar código' });
  }
});

app.post('/api/reset-password', async (req, res) => {
  if (!req.session.resetUser) {
    return res.status(401).json({ error: 'Sessão de recuperação expirada. Reinicie o processo' });
  }

  // Sessão de reset válida por 30 minutos
  if (Date.now() - req.session.resetUser.authorizedAt > 30 * 60 * 1000) {
    delete req.session.resetUser;
    return res.status(401).json({ error: 'Sessão expirada. Reinicie o processo de recuperação' });
  }

  const { novaSenha } = req.body;
  if (!novaSenha || novaSenha.length < 6) {
    return res.status(400).json({ error: 'A senha deve ter no mínimo 6 caracteres' });
  }
  if (!pool) return res.status(500).json({ error: 'Banco de dados não configurado' });

  try {
    const senhaHash = await bcrypt.hash(novaSenha, 12);
    const conn = await pool.getConnection();
    await conn.query('UPDATE usuarios SET senha = ? WHERE id = ?', [senhaHash, req.session.resetUser.id]);
    conn.release();

    delete req.session.resetUser;
    res.json({ success: true, message: 'Senha redefinida com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao redefinir senha' });
  }
});

// ── Horários disponíveis ──────────────────────────────────────────────────────

app.get('/api/horarios', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  const { data } = req.query;
  const horariosFixos = [
    '09:00','09:30','10:00','10:30','11:00','11:30',
    '14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'
  ];
  try {
    const connection = await pool.getConnection();
    const { excludeId } = req.query;
    let slotQuery = 'SELECT TIME_FORMAT(horario, "%H:%i") AS horario FROM agendamentos WHERE data = ?';
    const slotParams = [data];
    if (excludeId && Number.isInteger(+excludeId)) {
      slotQuery += ' AND id != ?';
      slotParams.push(+excludeId);
    }
    const [agendados] = await connection.query(slotQuery, slotParams);
    connection.release();
    const ocupados = agendados.map(a => a.horario);
    const disponiveis = horariosFixos.filter(h => !ocupados.includes(h));
    res.json(disponiveis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar horários' });
  }
});

// ── Agendamentos de usuário ───────────────────────────────────────────────────

app.get('/api/meus-agendamentos', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM agendamentos WHERE nome = ? ORDER BY data DESC, horario DESC',
      [req.session.user.usuario]
    );
    connection.release();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar agendamentos do usuário' });
  }
});

app.post('/api/agendar', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Faça login para agendar.' });
  }
  const { telefone, data, horario, servico } = req.body;
  const nome = req.session.user.usuario;

  if (!nome || !telefone || !data || !horario || !servico) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }

  try {
    const connection = await pool.getConnection();

    // Verifica disponibilidade dentro da mesma transação para evitar race condition
    const [ocupado] = await connection.query(
      'SELECT id FROM agendamentos WHERE data = ? AND horario = ?', [data, horario]
    );
    if (ocupado.length > 0) {
      connection.release();
      return res.status(409).json({ error: 'Este horário acabou de ser reservado. Escolha outro horário.' });
    }

    await connection.query(
      'INSERT INTO agendamentos (nome, telefone, data, horario, servico) VALUES (?, ?, ?, ?, ?)',
      [nome, telefone, data, horario, servico]
    );
    connection.release();
    res.json({ success: true, message: 'Agendamento realizado com sucesso!' });

    sendBookingEmails({
      nome, servico, data, horario, telefone,
      clientEmail: req.session.user.email
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Este horário acabou de ser reservado. Escolha outro horário.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao realizar agendamento' });
  }
});

app.put('/api/agendar/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const { id } = req.params;
  const { data, horario, servico, telefone } = req.body;
  if (!data || !horario || !servico || !telefone) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT id, data, horario, servico FROM agendamentos WHERE id = ? AND nome = ?',
      [id, req.session.user.usuario]
    );
    if (rows.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'Agendamento não encontrado ou não autorizado' });
    }
    const old = rows[0];
    // Checa disponibilidade do novo slot, excluindo o próprio agendamento
    const [ocupado] = await connection.query(
      'SELECT id FROM agendamentos WHERE data = ? AND horario = ? AND id != ?',
      [data, horario, id]
    );
    if (ocupado.length > 0) {
      connection.release();
      return res.status(409).json({ error: 'Este horário já está reservado. Escolha outro horário.' });
    }
    await connection.query(
      'UPDATE agendamentos SET data = ?, horario = ?, servico = ?, telefone = ? WHERE id = ?',
      [data, horario, servico, telefone, id]
    );
    connection.release();
    res.json({ success: true, message: 'Agendamento atualizado com sucesso!' });
    sendUpdateEmail({
      nome: req.session.user.usuario,
      servico,
      novaData: data,
      novoHorario: horario,
      antigaData: typeof old.data === 'string' ? old.data : old.data.toISOString().split('T')[0],
      antigoHorario: old.horario,
      clientEmail: req.session.user.email
    });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Este horário já está reservado. Escolha outro horário.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
});

app.delete('/api/agendar/:id', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const { id } = req.params;
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT id, data, horario, servico FROM agendamentos WHERE id = ? AND nome = ?',
      [id, req.session.user.usuario]
    );
    if (rows.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'Agendamento não encontrado ou não autorizado' });
    }
    const booking = rows[0];
    await connection.query('DELETE FROM agendamentos WHERE id = ?', [id]);
    connection.release();
    res.json({ success: true, message: 'Agendamento cancelado com sucesso!' });
    sendCancelEmail({
      nome: req.session.user.usuario,
      servico: booking.servico,
      data: typeof booking.data === 'string' ? booking.data : booking.data.toISOString().split('T')[0],
      horario: booking.horario,
      clientEmail: req.session.user.email
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao cancelar agendamento' });
  }
});

// ── Perfil de usuário ─────────────────────────────────────────────────────────

app.put('/api/perfil', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const { nome, email, senha } = req.body;
  if (!nome || !email) {
    return res.status(400).json({ error: 'Nome e email são obrigatórios' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'E-mail inválido' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    let query = 'UPDATE usuarios SET nome = ?, email = ? WHERE usuario = ?';
    let params = [nome, email, req.session.user.usuario];
    if (senha) {
      if (senha.length < 6) {
        connection.release();
        return res.status(400).json({ error: 'Senha deve ter no mínimo 6 caracteres' });
      }
      const senhaHash = await bcrypt.hash(senha, 12);
      query = 'UPDATE usuarios SET nome = ?, email = ?, senha = ? WHERE usuario = ?';
      params = [nome, email, senhaHash, req.session.user.usuario];
    }
    await connection.query(query, params);
    req.session.user.nome = nome;
    req.session.user.email = email;
    connection.release();
    res.json({ success: true, message: 'Perfil atualizado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

// ── Painel admin (protegido) ──────────────────────────────────────────────────

app.get('/admin/agendamentos', requireAdmin, async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM agendamentos ORDER BY data DESC, horario DESC'
    );
    connection.release();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

app.listen(PORT, () => {
  console.log(`✓ Servidor rodando em http://localhost:${PORT}`);
});
