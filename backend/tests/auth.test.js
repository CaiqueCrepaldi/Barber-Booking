import { vi, describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

// vi.hoisted expõe variáveis para dentro do vi.mock (que é içado antes dos imports)
const { mockQuery, mockRelease } = vi.hoisted(() => ({
  mockQuery: vi.fn().mockResolvedValue([[]]),
  mockRelease: vi.fn(),
}))

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: () => ({
      getConnection: () => Promise.resolve({ query: mockQuery, release: mockRelease }),
    }),
  },
}))
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }))
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: vi.fn() })) },
}))
vi.mock('dotenv', () => ({ config: vi.fn(), default: {} }))

import request from 'supertest'
import app from '../server.js'

// ── GET /api/session ──────────────────────────────────────────────────────────

describe('GET /api/session', () => {
  it('retorna loggedIn: false sem sessão ativa', async () => {
    const res = await request(app).get('/api/session')
    expect(res.status).toBe(200)
    expect(res.body.loggedIn).toBe(false)
  })
})

// ── POST /api/login ───────────────────────────────────────────────────────────

describe('POST /api/login', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna 400 quando campos estão faltando', async () => {
    const res = await request(app).post('/api/login').send({ login: 'user' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/preencha/i)
  })

  it('retorna 401 quando usuário não existe', async () => {
    mockQuery.mockResolvedValueOnce([[]])

    const res = await request(app)
      .post('/api/login')
      .send({ login: 'fantasma', senha: 'qualquer' })

    expect(res.status).toBe(401)
    expect(res.body.error).toMatch(/inválidos/i)
  })

  it('retorna 401 quando senha está errada', async () => {
    const hash = await bcrypt.hash('senha-correta', 10)
    mockQuery.mockResolvedValueOnce([[
      { id: 1, usuario: 'user', senha: hash, nome: 'User', email: 'u@e.com' },
    ]])

    const res = await request(app)
      .post('/api/login')
      .send({ login: 'user', senha: 'senha-errada' })

    expect(res.status).toBe(401)
  })

  it('retorna 200 com dados do usuário em login válido', async () => {
    const hash = await bcrypt.hash('senha123', 10)
    mockQuery.mockResolvedValueOnce([[
      { id: 1, usuario: 'user', senha: hash, nome: 'User', email: 'u@e.com' },
    ]])

    const res = await request(app)
      .post('/api/login')
      .send({ login: 'user', senha: 'senha123' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.user.usuario).toBe('user')
    expect(res.body.user.senha).toBeUndefined()
  })
})

// ── POST /api/logout ──────────────────────────────────────────────────────────

describe('POST /api/logout', () => {
  it('retorna success: true', async () => {
    const res = await request(app).post('/api/logout')
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ── POST /api/registrar ───────────────────────────────────────────────────────

describe('POST /api/registrar', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna 400 quando campos estão faltando', async () => {
    const res = await request(app)
      .post('/api/registrar')
      .send({ login: 'user' })
    expect(res.status).toBe(400)
  })

  it('retorna 400 para e-mail inválido', async () => {
    const res = await request(app)
      .post('/api/registrar')
      .send({ login: 'user', email: 'nao-e-email', senha: 'senha123' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/e-mail/i)
  })

  it('retorna 400 quando senha tem menos de 6 caracteres', async () => {
    const res = await request(app)
      .post('/api/registrar')
      .send({ login: 'user', email: 'u@e.com', senha: '123' })
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/mínimo/i)
  })

  it('retorna 409 quando login ou e-mail já existe', async () => {
    mockQuery.mockResolvedValueOnce([[{ id: 1 }]])

    const res = await request(app)
      .post('/api/registrar')
      .send({ login: 'existente', email: 'existente@e.com', senha: 'senha123' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/já cadastrado/i)
  })

  it('retorna 200 em cadastro válido', async () => {
    mockQuery
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([{ insertId: 1 }])

    const res = await request(app)
      .post('/api/registrar')
      .send({ login: 'novo', email: 'novo@e.com', senha: 'senha123' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ── Admin ─────────────────────────────────────────────────────────────────────

describe('GET /api/admin/session', () => {
  it('retorna loggedIn: false sem sessão de admin', async () => {
    const res = await request(app).get('/api/admin/session')
    expect(res.status).toBe(200)
    expect(res.body.loggedIn).toBe(false)
  })
})

describe('POST /api/admin/login', () => {
  it('retorna 400 quando campos estão faltando', async () => {
    const res = await request(app).post('/api/admin/login').send({})
    expect(res.status).toBe(400)
  })

  it('retorna 401 para credenciais erradas', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ login: 'errado', senha: 'errado' })
    expect(res.status).toBe(401)
  })

  it('retorna 200 para credenciais corretas do admin', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ login: 'admin', senha: 'admin123' })
    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
