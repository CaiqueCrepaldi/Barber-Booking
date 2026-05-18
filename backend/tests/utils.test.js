import { describe, it, expect } from 'vitest'
import { sanitizeText } from '../utils.js'

describe('sanitizeText', () => {
  it('retorna string vazia para null', () => {
    expect(sanitizeText(null)).toBe('')
  })

  it('retorna string vazia para undefined', () => {
    expect(sanitizeText(undefined)).toBe('')
  })

  it('retorna string vazia para string vazia', () => {
    expect(sanitizeText('')).toBe('')
  })

  it('remove tags HTML (< e >)', () => {
    expect(sanitizeText('<script>alert(1)</script>')).toBe('scriptalert(1)/script')
    expect(sanitizeText('<b>negrito</b>')).toBe('bnegrito/b')
  })

  it('remove & (ampersand)', () => {
    expect(sanitizeText('Corte & Barba')).toBe('Corte  Barba')
  })

  it('remove aspas duplas', () => {
    expect(sanitizeText('"João"')).toBe('João')
  })

  it('remove aspas simples', () => {
    expect(sanitizeText("it's fine")).toBe('its fine')
  })

  it('remove backticks', () => {
    expect(sanitizeText('`cmd`')).toBe('cmd')
  })

  it('remove barras invertidas', () => {
    expect(sanitizeText('C:\\Users\\test')).toBe('C:Userstest')
  })

  it('preserva texto normal', () => {
    expect(sanitizeText('João Silva')).toBe('João Silva')
    expect(sanitizeText('09:30')).toBe('09:30')
    expect(sanitizeText('Corte + Barba')).toBe('Corte + Barba')
    expect(sanitizeText('(11) 91234-5678')).toBe('(11) 91234-5678')
  })

  it('converte número positivo para string', () => {
    expect(sanitizeText(123)).toBe('123')
  })

  it('retorna string vazia para 0 (falsy)', () => {
    expect(sanitizeText(0)).toBe('')
  })
})
