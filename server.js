require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const mysql = require('mysql2/promise');
const session = require('express-session');
const cron = require('node-cron');
const twilio = require('twilio');

const app = express();
const PORT = process.env.PORT || 3001;

// Configuração do Twilio para WhatsApp
// IMPORTANTE: Configure suas credenciais do Twilio em variáveis de ambiente
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
const targetNumber = process.env.TWILIO_TARGET_NUMBER || 'whatsapp:+5511976754392';

// Configuração de sessão
app.use(session({
  secret: process.env.SESSION_SECRET || 'barbearia_secret_2026', // use env var em produção
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 15 * 60 * 1000 // 15 minutos
  }
}));

// Configuração de middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

// Configuração do banco de dados
// IMPORTANTE: Configure com suas credenciais do MySQL em variáveis de ambiente
const dbConfig = {
  host: process.env.MYSQL_HOST || 'localhost',
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || 'site2026',
  database: process.env.MYSQL_DATABASE || 'barbearia_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Criar pool de conexões
let pool;

try {
  pool = mysql.createPool(dbConfig);
  console.log('✓ Conexão com banco de dados configurada');
} catch (err) {
  console.error('⚠️  Erro ao conectar ao banco de dados:', err.message);
  console.log('Configure as credenciais do MySQL em server.js (linhas 18-23)');
}

// Configurar limpeza automática de agendamentos expirados
cron.schedule('*/5 * * * *', async () => { // Executa a cada 5 minutos
  if (!pool) return;
  try {
    const connection = await pool.getConnection();
    await connection.query('DELETE FROM agendamentos WHERE data < CURDATE() OR (data = CURDATE() AND horario < CURTIME())');
    connection.release();
    console.log('✓ Agendamentos expirados removidos automaticamente');
  } catch (err) {
    console.error('Erro ao limpar agendamentos expirados:', err);
  }
});

// Endpoint para verificar se o usuário está logado
app.get('/api/session', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// Endpoint de logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ success: true });
  });
});

// Endpoint de login de usuário
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
    const [rows] = await connection.query('SELECT * FROM usuarios WHERE usuario = ? AND senha = ?', [login, senha]);
    connection.release();
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Usuário ou senha inválidos' });
    }
    // Cria sessão
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

// Rota principal
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

// Rota para registro de usuário
app.post('/api/registrar', async (req, res) => {
  const { login, email, senha } = req.body;
  if (!login || !email || !senha) {
    return res.status(400).json({ error: 'Todos os campos são obrigatórios' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    // Verifica se já existe usuario ou email
    const [existe] = await connection.query('SELECT id FROM usuarios WHERE usuario = ? OR email = ?', [login, email]);
    if (existe.length > 0) {
      connection.release();
      return res.status(409).json({ error: 'Login ou e-mail já cadastrado' });
    }
    await connection.query('INSERT INTO usuarios (usuario, senha, nome, email) VALUES (?, ?, ?, ?)', [login, senha, login, email]);
    connection.release();
    res.json({ success: true, message: 'Usuário registrado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

// Rota para obter os horários disponíveis
// Retorna horários disponíveis para uma data específica
app.get('/api/horarios', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  const { data } = req.query;
  // Horários fixos do sistema
  const horariosFixos = [
    '09:00','09:30','10:00','10:30','11:00','11:30',
    '14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30'
  ];
  try {
    const connection = await pool.getConnection();
    // Busca horários já agendados para a data
    const [agendados] = await connection.query('SELECT horario FROM agendamentos WHERE data = ?', [data]);
    connection.release();
    const ocupados = agendados.map(a => a.horario);
    // Retorna apenas horários livres
    const disponiveis = horariosFixos.filter(h => !ocupados.includes(h));
    res.json(disponiveis);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar horários' });
  }
});

// Rota para buscar agendamentos do usuário (protegida por sessão)
app.get('/api/meus-agendamentos', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    // Busca por nome igual ao login do usuário autenticado
    const [rows] = await connection.query('SELECT * FROM agendamentos WHERE nome = ? ORDER BY data DESC, horario DESC', [req.session.user.usuario]);
    connection.release();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar agendamentos do usuário' });
  }
});

// Rota para criar agendamento (apenas autenticado)
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

    // Enviar notificação via WhatsApp
    console.log('Iniciando envio de notificações - Account SID:', accountSid.substring(0, 5) + '...');
    
    if (accountSid && accountSid.trim() && authToken && authToken.trim()) {
      try {
        const client = twilio(accountSid, authToken);
        console.log('Cliente Twilio criado com sucesso');
        
        // Notificar o dono
        console.log(`Enviando notificação para o dono em: ${targetNumber}`);
        const msgDono = await client.messages.create({
          body: `Novo agendamento: ${nome} - ${servico} em ${data} às ${horario}. Telefone: ${telefone}`,
          from: whatsappNumber,
          to: targetNumber
        });
        console.log('✓ Notificação para dono enviada com sucesso - SID:', msgDono.sid);
        
        // Notificar o cliente
        const cleanPhone = telefone.replace(/\D/g, '');
        const whatsappCliente = `whatsapp:+55${cleanPhone}`;
        console.log(`Enviando notificação para o cliente em: ${whatsappCliente}`);
        const msgCliente = await client.messages.create({
          body: `Olá ${nome}! Seu agendamento foi confirmado: ${servico} em ${data} às ${horario}.`,
          from: whatsappNumber,
          to: whatsappCliente
        });
        console.log('✓ Notificação para cliente enviada com sucesso - SID:', msgCliente.sid);
        
      } catch (error) {
        console.error('❌ Erro ao enviar notificações WhatsApp:', error.message);
        console.error('Detalhes do erro:', error.code, error.status);
        if (error.response) {
          console.error('Resposta da API:', error.response);
        }
      }
    } else {
      console.log('⚠️  Twilio não configurado - credenciais ausentes');
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao realizar agendamento' });
  }
});

// Rota para editar agendamento
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
    // Verificar se o agendamento pertence ao usuário
    const [rows] = await connection.query('SELECT id FROM agendamentos WHERE id = ? AND nome = ?', [id, req.session.user.usuario]);
    if (rows.length === 0) {
      connection.release();
      return res.status(403).json({ error: 'Agendamento não encontrado ou não autorizado' });
    }
    await connection.query('UPDATE agendamentos SET data = ?, horario = ?, servico = ?, telefone = ? WHERE id = ?', [data, horario, servico, telefone, id]);
    connection.release();
    res.json({ success: true, message: 'Agendamento atualizado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar agendamento' });
  }
});

// Rota para cancelar agendamento
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
    // Verificar se o agendamento pertence ao usuário
    const [rows] = await connection.query('SELECT id FROM agendamentos WHERE id = ? AND nome = ?', [id, req.session.user.usuario]);
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

// Rota para atualizar perfil
app.put('/api/perfil', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'Não autenticado' });
  }
  const { nome, email, senha } = req.body;
  if (!nome || !email) {
    return res.status(400).json({ error: 'Nome e email são obrigatórios' });
  }
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    let query = 'UPDATE usuarios SET nome = ?, email = ? WHERE usuario = ?';
    let params = [nome, email, req.session.user.usuario];
    if (senha) {
      query = 'UPDATE usuarios SET nome = ?, email = ?, senha = ? WHERE usuario = ?';
      params = [nome, email, senha, req.session.user.usuario];
    }
    await connection.query(query, params);
    // Atualizar sessão
    req.session.user.nome = nome;
    req.session.user.email = email;
    connection.release();
    res.json({ success: true, message: 'Perfil atualizado com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
});

// Rota para listar agendamentos (painel admin)
app.get('/admin/agendamentos', async (req, res) => {
  if (!pool) {
    return res.status(500).json({ error: 'Banco de dados não configurado' });
  }
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM agendamentos ORDER BY data DESC, horario DESC');
    connection.release();
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao buscar agendamentos' });
  }
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✓ Servidor rodando em http://localhost:${PORT}`);
});
