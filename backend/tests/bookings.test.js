import { vi, describe, it, expect, beforeEach } from 'vitest'
import bcrypt from 'bcryptjs'

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

// Loga um usuário num agent e retorna o agent autenticado
async function criarAgentLogado(usuario = 'testuser', senha = 'senha123') {
  const agent = request.agent(app)
  const hash = await bcrypt.hash(senha, 10)
  mockQuery.mockResolvedValueOnce([[
    { id: 1, usuario, senha: hash, nome: 'Test', email: 'test@e.com' },
  ]])
  await agent.post('/api/login').send({ login: usuario, senha })
  return agent
}

// ── GET /api/horarios ─────────────────────────────────────────────────────────

describe('GET /api/horarios', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna lista de horários disponíveis para uma data', async () => {
    mockQuery.mockResolvedValueOnce([[]])  // nenhum slot ocupado

    const res = await request(app).get('/api/horarios?data=2025-12-25')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body.length).toBeGreaterThan(0)
  })

  it('exclui horários já reservados', async () => {
    mockQuery.mockResolvedValueOnce([[
      { horario: '09:00' },
      { horario: '14:00' },
    ]])

    const res = await request(app).get('/api/horarios?data=2025-12-25')

    expect(res.status).toBe(200)
    expect(res.body).not.toContain('09:00')
    expect(res.body).not.toContain('14:00')
    expect(res.body).toContain('09:30')
  })

  it('retorna todos os horários quando nenhum está reservado', async () => {
    mockQuery.mockResolvedValueOnce([[]])

    const res = await request(app).get('/api/horarios?data=2025-12-25')

    expect(res.body).toHaveLength(14) // 14 slots fixos definidos no servidor
  })
})

// ── GET /api/meus-agendamentos ────────────────────────────────────────────────

describe('GET /api/meus-agendamentos', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app).get('/api/meus-agendamentos')
    expect(res.status).toBe(401)
  })

  it('retorna agendamentos do usuário autenticado', async () => {
    const agent = await criarAgentLogado()

    mockQuery.mockResolvedValueOnce([[
      { id: 1, nome: 'testuser', servico: 'Corte', data: '2025-12-25', horario: '09:00:00' },
    ]])

    const res = await agent.get('/api/meus-agendamentos')

    expect(res.status).toBe(200)
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body[0].servico).toBe('Corte')
  })
})

// ── POST /api/agendar ─────────────────────────────────────────────────────────

describe('POST /api/agendar', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app)
      .post('/api/agendar')
      .send({ telefone: '(11) 91234-5678', data: '2025-12-25', horario: '09:00', servico: 'Corte' })

    expect(res.status).toBe(401)
  })

  it('retorna 400 quando campos estão faltando', async () => {
    const agent = await criarAgentLogado()

    const res = await agent
      .post('/api/agendar')
      .send({ data: '2025-12-25' }) // faltam campos

    expect(res.status).toBe(400)
  })

  it('retorna 409 quando horário já está reservado', async () => {
    const agent = await criarAgentLogado()

    mockQuery.mockResolvedValueOnce([[{ id: 99 }]]) // slot ocupado

    const res = await agent
      .post('/api/agendar')
      .send({ telefone: '(11) 91234-5678', data: '2025-12-25', horario: '09:00', servico: 'Corte' })

    expect(res.status).toBe(409)
    expect(res.body.error).toMatch(/reservado/i)
  })

  it('retorna 200 em agendamento bem-sucedido', async () => {
    const agent = await criarAgentLogado()

    mockQuery
      .mockResolvedValueOnce([[]])              // slot livre
      .mockResolvedValueOnce([{ insertId: 1 }]) // insert ok

    const res = await agent
      .post('/api/agendar')
      .send({ telefone: '(11) 91234-5678', data: '2025-12-25', horario: '09:00', servico: 'Corte' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ── DELETE /api/agendar/:id ───────────────────────────────────────────────────

describe('DELETE /api/agendar/:id', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app).delete('/api/agendar/1')
    expect(res.status).toBe(401)
  })

  it('retorna 403 quando agendamento não pertence ao usuário', async () => {
    const agent = await criarAgentLogado()

    mockQuery.mockResolvedValueOnce([[]])  // nenhum agendamento encontrado

    const res = await agent.delete('/api/agendar/999')
    expect(res.status).toBe(403)
  })

  it('retorna 200 ao cancelar agendamento próprio', async () => {
    const agent = await criarAgentLogado()

    mockQuery
      .mockResolvedValueOnce([[{ id: 1, servico: 'Corte', data: '2025-12-25', horario: '09:00:00' }]])
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    const res = await agent.delete('/api/agendar/1')

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})

// ── PUT /api/agendar/:id ──────────────────────────────────────────────────────

describe('PUT /api/agendar/:id', () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockRelease.mockReset()
    mockQuery.mockResolvedValue([[]])
  })

  it('retorna 401 sem autenticação', async () => {
    const res = await request(app)
      .put('/api/agendar/1')
      .send({ data: '2025-12-26', horario: '10:00', servico: 'Barba', telefone: '(11) 91234-5678' })
    expect(res.status).toBe(401)
  })

  it('retorna 409 quando novo horário está ocupado', async () => {
    const agent = await criarAgentLogado()

    mockQuery
      .mockResolvedValueOnce([[{ id: 1, data: '2025-12-25', horario: '09:00:00', servico: 'Corte' }]])
      .mockResolvedValueOnce([[{ id: 2 }]]) // novo slot ocupado

    const res = await agent
      .put('/api/agendar/1')
      .send({ data: '2025-12-26', horario: '10:00', servico: 'Barba', telefone: '(11) 91234-5678' })

    expect(res.status).toBe(409)
  })

  it('retorna 200 ao reagendar com sucesso', async () => {
    const agent = await criarAgentLogado()

    mockQuery
      .mockResolvedValueOnce([[{ id: 1, data: '2025-12-25', horario: '09:00:00', servico: 'Corte' }]])
      .mockResolvedValueOnce([[]])              // novo slot livre
      .mockResolvedValueOnce([{ affectedRows: 1 }])

    const res = await agent
      .put('/api/agendar/1')
      .send({ data: '2025-12-26', horario: '10:00', servico: 'Barba', telefone: '(11) 91234-5678' })

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })
})
