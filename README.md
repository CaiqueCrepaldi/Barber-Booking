# Barbearia - Sistema de Agendamento

Um site funcional para agendamento de cortes de barbearia desenvolvido com HTML5, CSS3, JavaScript, Node.js e MySQL.

## 📋 Pré-requisitos

- Node.js instalado
- MySQL instalado e rodando
- MySQL Workbench (para gerenciar o banco)
- npm (gerenciador de pacotes do Node.js)

## 🚀 Instalação

### 1️⃣ Clonar o repositório

```bash
git clone https://github.com/CaiqueCrepaldi/barbearia.git
cd barbearia
```

### 2️⃣ Instalar dependências do Node.js

```bash
npm install
```

### 3️⃣ Configurar o banco de dados MySQL

**Opção A: Usar o script SQL fornecido**

Execute o arquivo `schema.sql` no MySQL Workbench ou via linha de comando:

```bash
mysql -u root -p < schema.sql
```

**Opção B: Configuração manual no MySQL Workbench**

Se preferir configurar manualmente, execute estes comandos SQL:

```sql
-- Criar banco de dados
CREATE DATABASE IF NOT EXISTS barbearia_db;
USE barbearia_db;

-- Tabela de usuários
CREATE TABLE IF NOT EXISTS usuarios (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    senha VARCHAR(255) NOT NULL,
    nome VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Tabela de agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nome VARCHAR(100) NOT NULL,
    telefone VARCHAR(20),
    data DATE NOT NULL,
    horario TIME NOT NULL,
    servico VARCHAR(100) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_data_horario (data, horario),
    INDEX idx_nome (nome)
);
```

### 4️⃣ Configurar credenciais do MySQL

**Opção A: Usar arquivo .env (recomendado)**

1. Copie o arquivo de exemplo:
   ```bash
   cp .env.example .env
   ```

2. Edite o arquivo `.env` com suas credenciais reais.

**Opção B: Configuração direta no código**

Abra o arquivo `server.js` e configure suas credenciais (linhas 18-23):

```javascript
const dbConfig = {
  host: 'localhost',
  user: 'root',
  password: 'sua_senha_mysql', // ⚠️ ALTERE PARA SUA SENHA REAL
  database: 'barbearia_db',
  ...
};
```

### 5️⃣ Iniciar o servidor

```bash
npm start
# ou
node server.js
```

### 6️⃣ Acessar a aplicação

Abra o navegador e acesse: **http://localhost:3001**

## 📦 Subindo para o GitHub

O banco de dados MySQL **não deve ser incluído** no repositório Git. Em vez disso:

1. **Crie o arquivo `.gitignore`** (já incluído no projeto) para evitar subir arquivos desnecessários
2. **Suba apenas o código**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Sistema de agendamento barbearia"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/barbearia.git
   git push -u origin main
   ```

3. **Para colaboradores**: Eles devem executar o `schema.sql` localmente para criar as tabelas.

> 📖 **Para instruções completas de deploy**, consulte o arquivo [`DEPLOY.md`](DEPLOY.md).

## 🔧 Configuração de Produção

Para deploy em produção, considere usar:

- **Railway** ou **PlanetScale** para MySQL na nuvem
- **Vercel** ou **Heroku** para o backend Node.js
- **Render** ou **Fly.io** para hospedagem completa
- Variáveis de ambiente para credenciais sensíveis

### Exemplo de configuração no Railway:

1. **Banco de dados**: Crie um banco MySQL no Railway
2. **Backend**: Faça deploy do código Node.js
3. **Variáveis de ambiente**: Configure as variáveis no painel do Railway
4. **Script de inicialização**: Execute o `schema.sql` no banco de produção

### Segurança em Produção:

- Nunca commite credenciais reais no código
- Use senhas fortes e únicas
- Configure firewall para aceitar apenas conexões necessárias
- Use HTTPS em produção
- Mantenha as dependências atualizadas

## 📁 Estrutura do Projeto

```
barbearia/
├── public/
│   ├── index.html      # Página principal (HTML5)
│   ├── style.css       # Estilos (CSS3)
│   └── script.js       # Interatividade (JavaScript)
├── server.js           # Servidor Node.js/Express
├── package.json        # Dependências do projeto
└── README.md          # Este arquivo
```

## 🎨 Funcionalidades da Home Page

- **Header com navegação** - Menu sticky com links para seções
- **Seção Hero** - Introdução com chamada para ação
- **Catálogo de Serviços** - Apresentação dos serviços com preços
- **Formulário de Agendamento** - Coleta dados do cliente
  - Validação de campos obrigatórios
  - Validação de telefone
  - Validação de datas (não permite data no passado)
  - Mensagens de sucesso/erro
  - Integração com backend (salva no MySQL)
- **Seção de Contato** - Informações da barbearia
- **Footer** - Rodapé com copyright
- **Design Responsivo** - Funciona em mobile e desktop

## 💻 Tecnologias Utilizadas

- **Frontend:** HTML5, CSS3, JavaScript vanilla
- **Backend:** Node.js, Express.js
- **Banco de Dados:** MySQL
- **Dependências:** 
  - `express` - Framework web
  - `mysql2` - Driver MySQL
  - `body-parser` - Middleware para parsing JSON

## 📝 Próximas Melhorias

- Autenticação de usuários (admin)
- Dashboard administrativo
- Painel de controle de agendamentos
- Envio de notificações por WhatsApp
- Revisão de serviços
- Sistema de pagamento
- Relatórios de vendas
- Integração com calendário

## 🆘 Troubleshooting

**Erro: "Cannot find module"**
- Solução: Execute `npm install` para instalar as dependências

**Erro: "Connection refused"**
- Solução: Verifique se o MySQL está rodando e configure as credenciais corretamente em `server.js`

**Erro: "Unknown database"**
- Solução: Crie o banco de dados no MySQL Workbench conforme instruções acima

---

Desenvolvido por Caique Crepaldi - 2026
