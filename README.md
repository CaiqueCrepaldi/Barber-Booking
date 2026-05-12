# Barbearia — Sistema de Agendamento

Site completo para agendamento de serviços de barbearia, com autenticação de usuários, painel administrativo, recuperação de senha por OTP e notificações por e-mail.

## ✨ Funcionalidades

### Clientes
- Cadastro e login com senha criptografada (bcrypt)
- Recuperação de senha por código OTP de 6 dígitos enviado por e-mail
- Agendamento online com seletor de data (Flatpickr) e grid de horários disponíveis
- Proteção contra duplo agendamento (UNIQUE INDEX no banco + verificação no servidor)
- Página **Meus Agendamentos** com edição e cancelamento interativos
- Notificação por e-mail ao agendar, editar ou cancelar

### Estabelecimento
- E-mail automático ao dono a cada novo agendamento, edição e cancelamento
- Painel administrativo protegido por credenciais de ambiente
- Visualização e gerenciamento de todos os agendamentos

### Segurança
- Senhas armazenadas com bcrypt (custo 12)
- Sessions HTTP-only com expiração de 15 min
- Rate limiting no envio de OTP (60 s entre tentativas)
- Máximo de 5 tentativas de validação do OTP
- Sanitização de entradas nas mensagens
- Variáveis sensíveis exclusivamente via `.env`

---

## 🛠 Tecnologias

| Camada | Tecnologias |
|--------|-------------|
| Frontend | HTML5, CSS3, JavaScript vanilla, Flatpickr |
| Backend | Node.js, Express.js |
| Banco de dados | MySQL 2 (pool de conexões) |
| Autenticação | express-session, bcryptjs |
| E-mail | Nodemailer (Gmail SMTP) |
| Agendamento | node-cron (limpeza automática de slots expirados) |

---

## 📋 Pré-requisitos

- Node.js 18+
- MySQL 8+ rodando localmente
- Conta Gmail com [Senha de App](https://myaccount.google.com/apppasswords) (para envio de e-mails)

---

## 🚀 Instalação

### 1. Clonar o repositório

```bash
git clone https://github.com/CaiqueCrepaldi/Barber-Booking.git
cd barbearia
```

### 2. Instalar dependências

```bash
npm install
```

### 3. Configurar o banco de dados

Execute no MySQL Workbench ou via CLI:

```sql
CREATE DATABASE IF NOT EXISTS barbearia_db;
USE barbearia_db;

CREATE TABLE IF NOT EXISTS usuarios (
  id       INT AUTO_INCREMENT PRIMARY KEY,
  usuario  VARCHAR(50)  NOT NULL UNIQUE,
  senha    VARCHAR(255) NOT NULL,
  nome     VARCHAR(100) NOT NULL,
  email    VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id        INT AUTO_INCREMENT PRIMARY KEY,
  nome      VARCHAR(100) NOT NULL,
  telefone  VARCHAR(20),
  data      DATE         NOT NULL,
  horario   TIME         NOT NULL,
  servico   VARCHAR(100) NOT NULL,
  data_agendamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX unique_slot (data, horario),
  INDEX idx_nome (nome)
);
```

> As colunas de recuperação de senha (`reset_token`, `reset_token_expiry`, `reset_token_attempts`) e o índice `unique_slot` são adicionados automaticamente pelas migrations ao iniciar o servidor, caso ainda não existam.

### 4. Configurar variáveis de ambiente

Crie o arquivo `.env` na raiz do projeto:

```env
PORT=3001
SESSION_SECRET=gere_uma_string_longa_e_aleatoria

# Painel administrativo
ADMIN_USER=admin
ADMIN_PASSWORD=sua_senha_admin

# MySQL
MYSQL_HOST=localhost
MYSQL_USER=root
MYSQL_PASSWORD=sua_senha_mysql
MYSQL_DATABASE=barbearia_db

# Gmail — use uma Senha de App (não a senha normal)
# https://myaccount.google.com/apppasswords
GMAIL_USER=seu@gmail.com
GMAIL_PASS=xxxx xxxx xxxx xxxx
```

> Se `GMAIL_USER`/`GMAIL_PASS` não forem preenchidos, o sistema entra em **modo demo**: o código OTP é retornado diretamente na resposta da API, exibido na tela para fins de teste.

### 5. Iniciar o servidor

```bash
npm start
```

Acesse: **http://localhost:3001**

---

## 📁 Estrutura do Projeto

```
barbearia/
├── public/
│   ├── index.html              # Página principal (hero, serviços, agendamento, contato)
│   ├── login.html              # Login de usuário
│   ├── registro.html           # Cadastro de usuário
│   ├── forgot-password.html    # Recuperação de senha (3 etapas: e-mail → OTP → nova senha)
│   ├── meus-agendamentos.html  # Gerenciamento de agendamentos do usuário
│   ├── admin.html              # Painel administrativo
│   ├── style.css               # Estilos globais (tema dark/gold)
│   └── script.js               # Lógica do formulário de agendamento
├── server.js                   # API REST + middleware + migrations
├── package.json
└── README.md
```

---

## 🔌 Endpoints da API

| Método | Rota | Descrição |
|--------|------|-----------|
| POST | `/api/registrar` | Cadastro de usuário |
| POST | `/api/login` | Login de usuário |
| POST | `/api/logout` | Logout |
| GET  | `/api/session` | Verifica sessão ativa |
| POST | `/api/forgot-password` | Solicita código OTP de recuperação |
| POST | `/api/verify-otp` | Valida o código OTP |
| POST | `/api/reset-password` | Redefine a senha (requer OTP validado) |
| GET  | `/api/horarios?data=YYYY-MM-DD` | Lista horários disponíveis |
| POST | `/api/agendar` | Cria agendamento |
| PUT  | `/api/agendar/:id` | Edita agendamento |
| DELETE | `/api/agendar/:id` | Cancela agendamento |
| GET  | `/api/meus-agendamentos` | Lista agendamentos do usuário logado |
| POST | `/api/admin/login` | Login do painel admin |
| GET  | `/admin/agendamentos` | Lista todos os agendamentos (admin) |

---

## 🔧 Deploy

Sugestões de plataformas:

- **Banco de dados**: Railway, PlanetScale ou Clever Cloud (MySQL gerenciado)
- **Backend**: Railway, Render ou Fly.io (Node.js)
- **Variáveis de ambiente**: configure no painel da plataforma escolhida

Em produção, defina também `NODE_ENV=production` e use HTTPS.

---

## 🆘 Troubleshooting

| Erro | Solução |
|------|---------|
| `Cannot find module` | Execute `npm install` |
| `Connection refused` | Verifique se o MySQL está rodando e confira as variáveis do `.env` |
| `Unknown database` | Crie o banco conforme o schema acima |
| E-mail não enviado | Confira `GMAIL_USER` e `GMAIL_PASS` (use Senha de App, não a senha normal) |
| OTP expirado | O código expira em 10 min; solicite um novo |

---

Desenvolvido por Caique Crepaldi — 2026
