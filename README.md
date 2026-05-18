# Barbearia — Sistema de Agendamento

Site completo para agendamento de serviços de barbearia, com autenticação de usuários, painel administrativo, recuperação de senha por OTP e notificações por e-mail.

## Funcionalidades

### Clientes
- Cadastro e login com senha criptografada (bcrypt custo 12)
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
- Sanitização de entradas via `utils.js`
- Variáveis sensíveis exclusivamente via `.env`

---

## Tecnologias

| Camada | Tecnologias |
|--------|-------------|
| Frontend | HTML5, CSS3, JavaScript vanilla, Flatpickr |
| Backend | Node.js (ESM), Express.js |
| Banco de dados | MySQL 2 (pool de conexões, compatível com TiDB Cloud) |
| Autenticação | express-session, bcryptjs |
| E-mail | Nodemailer (Gmail SMTP) |
| Agendamento | node-cron (limpeza automática de slots expirados) |
| Testes | Vitest, supertest |

---

## Pré-requisitos

- Node.js 18+
- MySQL 8+ local **ou** instância gerenciada (TiDB Cloud, Railway, PlanetScale…)
- Conta Gmail com [Senha de App](https://myaccount.google.com/apppasswords) para envio de e-mails

---

## Instalação local

### 1. Clonar o repositório

```bash
git clone https://github.com/CaiqueCrepaldi/Barber-Booking.git
cd Barber-Booking
```

### 2. Instalar dependências

```bash
cd backend
npm install
```

### 3. Configurar o banco de dados

Execute o arquivo `backend/schema.sql` no MySQL Workbench ou via CLI:

```bash
mysql -u root -p < backend/schema.sql
```

> As colunas de recuperação de senha (`reset_token`, `reset_token_expiry`, `reset_token_attempts`) são adicionadas automaticamente via migration ao iniciar o servidor, caso ainda não existam.

### 4. Configurar variáveis de ambiente

Copie o template e preencha com seus valores:

```bash
cp backend/.env.example backend/.env
```

Edite o arquivo `backend/.env`:

```env
PORT=3001
SESSION_SECRET=gere_uma_string_longa_e_aleatoria_aqui

# Painel administrativo
ADMIN_USER=admin
ADMIN_PASSWORD=sua_senha_admin

# MySQL local
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=sua_senha_mysql
MYSQL_DATABASE=barbearia_db
MYSQL_SSL=false

# Gmail — use uma Senha de App (não a senha normal)
# https://myaccount.google.com/apppasswords
GMAIL_USER=seu@gmail.com
GMAIL_PASS=xxxx xxxx xxxx xxxx
```

> Para gerar um `SESSION_SECRET` seguro: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

### 5. Iniciar o servidor

```bash
npm start
```

Acesse: **http://localhost:3001**

---

## Deploy (Render + TiDB Cloud)

O projeto está configurado para deploy no **Render.com** com banco de dados **TiDB Cloud** (MySQL-compatível com SSL).

### Render — configurações do serviço

| Campo | Valor |
|-------|-------|
| Root Directory | `backend` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Node Version | 18+ |

### Variáveis de ambiente no Render

Além das variáveis acima, configure para TiDB Cloud:

```env
MYSQL_HOST=<gateway-tidb>.tidbcloud.com
MYSQL_PORT=4000
MYSQL_USER=<usuario-tidb>
MYSQL_PASSWORD=<senha-tidb>
MYSQL_DATABASE=barbearia_db
MYSQL_SSL=true
```

> `MYSQL_SSL=true` ativa `rejectUnauthorized: true` na conexão — obrigatório para TiDB Cloud.

---

## Executar testes

```bash
cd backend
npm test
```

Os testes cobrem autenticação, agendamentos e utilitários:

```
tests/utils.test.js    — 12 testes  (sanitizeText)
tests/auth.test.js     — 15 testes  (login, registro, OTP, admin)
tests/bookings.test.js — 15 testes  (horários, agendamentos CRUD)
─────────────────────────────────────
42 testes, 0 falhas
```

O banco de dados é completamente mockado via `vi.mock` — nenhuma conexão real é feita durante os testes.

---

## Estrutura do Projeto

```
Barber-Booking/
├── frontend/
│   ├── img/
│   │   └── logo.png
│   ├── index.html              # Página principal (hero, serviços, agendamento, contato)
│   ├── login.html              # Login de usuário
│   ├── registro.html           # Cadastro de usuário
│   ├── forgot-password.html    # Recuperação de senha (3 etapas: e-mail → OTP → nova senha)
│   ├── meus-agendamentos.html  # Gerenciamento de agendamentos do usuário
│   ├── admin.html              # Painel administrativo
│   ├── perfil.html             # Perfil do usuário
│   ├── style.css               # Estilos globais (tema dark/gold)
│   └── script.js               # Lógica do formulário de agendamento
├── backend/
│   ├── server.js               # API REST, middleware, migrations (ESM)
│   ├── utils.js                # Utilitários (sanitizeText)
│   ├── schema.sql              # Schema do banco de dados
│   ├── vitest.config.mjs       # Configuração do Vitest
│   ├── package.json            # "type": "module" — projeto ESM
│   ├── package-lock.json
│   ├── .env.example            # Template de variáveis de ambiente
│   ├── tests/
│   │   ├── auth.test.js
│   │   ├── bookings.test.js
│   │   └── utils.test.js
│   └── .env                    # variáveis de ambiente (não commitado)
├── .gitignore
└── README.md
```

---

## Endpoints da API

| Método | Rota | Auth | Descrição |
|--------|------|------|-----------|
| POST | `/api/registrar` | — | Cadastro de usuário |
| POST | `/api/login` | — | Login de usuário |
| POST | `/api/logout` | — | Logout |
| GET  | `/api/session` | — | Verifica sessão ativa |
| POST | `/api/forgot-password` | — | Solicita código OTP de recuperação |
| POST | `/api/verify-otp` | — | Valida o código OTP |
| POST | `/api/reset-password` | — | Redefine a senha (requer OTP validado) |
| GET  | `/api/horarios?data=YYYY-MM-DD` | — | Lista horários disponíveis |
| POST | `/api/agendar` | Usuário | Cria agendamento |
| PUT  | `/api/agendar/:id` | Usuário | Edita agendamento |
| DELETE | `/api/agendar/:id` | Usuário | Cancela agendamento |
| GET  | `/api/meus-agendamentos` | Usuário | Lista agendamentos do usuário logado |
| PUT  | `/api/perfil` | Usuário | Atualiza nome, e-mail e/ou senha |
| GET  | `/api/admin/session` | — | Verifica sessão de admin |
| POST | `/api/admin/login` | — | Login do painel admin |
| POST | `/api/admin/logout` | Admin | Logout do admin |
| GET  | `/api/admin/agendamentos` | Admin | Lista todos os agendamentos |

---

## Troubleshooting

| Erro | Solução |
|------|---------|
| `Cannot find module` | Execute `npm install` dentro de `backend/` |
| `Connection refused` | Verifique se o MySQL está rodando e confira as variáveis do `.env` |
| `Unknown database` | Crie o banco conforme o schema acima |
| E-mail não enviado | Confira `GMAIL_USER` e `GMAIL_PASS` (use Senha de App, não a senha normal) |
| OTP expirado | O código expira em 10 min; solicite um novo |
| TiDB Cloud recusa conexão | Certifique-se de que `MYSQL_SSL=true` e `MYSQL_PORT=4000` estão definidos |
| Testes falham com `Access Denied` | O backend usa ESM — verifique se `"type": "module"` está no `package.json` |

---

Desenvolvido por Caique Crepaldi — 2026
