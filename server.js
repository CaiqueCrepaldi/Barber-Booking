require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const session = require('express-session');
const cron = require('node-cron');
const twilio = require('twilio');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3001;

// Twilio — requer variáveis de ambiente
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER;
const targetNumber = process.env.TWILIO_TARGET_NUMBER;

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
app.use(express.static('public'));

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
    const [agendados] = await connection.query(
      'SELECT horario FROM agendamentos WHERE data = ?', [data]
    );
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
    await connection.query(
      'INSERT INTO agendamentos (nome, telefone, data, horario, servico) VALUES (?, ?, ?, ?, ?)',
      [nome, telefone, data, horario, servico]
    );
    connection.release();
    res.json({ success: true, message: 'Agendamento realizado com sucesso!' });

    if (accountSid && accountSid.trim() && authToken && authToken.trim() && targetNumber && whatsappNumber) {
      try {
        const client = twilio(accountSid, authToken);
        const safeNome = sanitizeText(nome);
        const safeServico = sanitizeText(servico);
        const safeData = sanitizeText(data);
        const safeHorario = sanitizeText(horario);
        const safeTelefone = sanitizeText(telefone);

        await client.messages.create({
          body: `Novo agendamento: ${safeNome} - ${safeServico} em ${safeData} às ${safeHorario}. Telefone: ${safeTelefone}`,
          from: whatsappNumber,
          to: targetNumber
        });

        const cleanPhone = telefone.replace(/\D/g, '');
        await client.messages.create({
          body: `Olá ${safeNome}! Seu agendamento foi confirmado: ${safeServico} em ${safeData} às ${safeHorario}.`,
          from: whatsappNumber,
          to: `whatsapp:+55${cleanPhone}`
        });
      } catch (error) {
        console.error('Erro ao enviar notificações WhatsApp:', error.message);
      }
    }
  } catch (err) {
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
      'SELECT id FROM agendamentos WHERE id = ? AND nome = ?', [id, req.session.user.usuario]
    );
    if (rows.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'Agendamento não encontrado ou não autorizado' });
    }
    await connection.query(
      'UPDATE agendamentos SET data = ?, horario = ?, servico = ?, telefone = ? WHERE id = ?',
      [data, horario, servico, telefone, id]
    );
    connection.release();
    res.json({ success: true, message: 'Agendamento atualizado com sucesso!' });
  } catch (err) {
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
      'SELECT id FROM agendamentos WHERE id = ? AND nome = ?', [id, req.session.user.usuario]
    );
    if (rows.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'Agendamento não encontrado ou não autorizado' });
    }
    await connection.query('DELETE FROM agendamentos WHERE id = ?', [id]);
    connection.release();
    res.json({ success: true, message: 'Agendamento cancelado com sucesso!' });
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
