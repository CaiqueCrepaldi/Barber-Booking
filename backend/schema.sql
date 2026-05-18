-- Barbearia — Schema do banco de dados
-- Compatível com MySQL 8+ e TiDB Cloud

CREATE DATABASE IF NOT EXISTS barbearia_db;
USE barbearia_db;

CREATE TABLE IF NOT EXISTS usuarios (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  usuario    VARCHAR(50)  NOT NULL UNIQUE,
  senha      VARCHAR(255) NOT NULL,
  nome       VARCHAR(100) NOT NULL,
  email      VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS agendamentos (
  id               INT AUTO_INCREMENT PRIMARY KEY,
  nome             VARCHAR(100) NOT NULL,
  telefone         VARCHAR(20),
  data             DATE         NOT NULL,
  horario          TIME         NOT NULL,
  servico          VARCHAR(100) NOT NULL,
  data_agendamento TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE INDEX unique_slot (data, horario),
  INDEX idx_nome (nome)
);

-- As colunas abaixo são adicionadas automaticamente via migration
-- ao iniciar o servidor, caso ainda não existam:
--
-- ALTER TABLE usuarios ADD COLUMN reset_token          VARCHAR(6)   DEFAULT NULL;
-- ALTER TABLE usuarios ADD COLUMN reset_token_expiry   DATETIME     DEFAULT NULL;
-- ALTER TABLE usuarios ADD COLUMN reset_token_attempts INT          DEFAULT 0;
