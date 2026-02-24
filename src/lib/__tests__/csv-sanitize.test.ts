import { describe, it, expect } from 'vitest'
import { csvSanitizeCell } from '../csv-sanitize'

describe('csvSanitizeCell', () => {
  it('wraps plain strings in double quotes', () => {
    expect(csvSanitizeCell('hello')).toBe('"hello"')
  })

  it('escapes double quotes', () => {
    expect(csvSanitizeCell('val"ue')).toBe('"val""ue"')
  })

  it('prefixes = with single tick', () => {
    expect(csvSanitizeCell('=cmd')).toBe(`"'=cmd"`)
  })

  it('prefixes + with single tick', () => {
    expect(csvSanitizeCell('+1')).toBe(`"'+1"`)
  })

  it('prefixes - with single tick', () => {
    expect(csvSanitizeCell('-1')).toBe(`"'-1"`)
  })

  it('prefixes @ with single tick', () => {
    expect(csvSanitizeCell('@SUM')).toBe(`"'@SUM"`)
  })

  it('returns empty quoted string for null', () => {
    expect(csvSanitizeCell(null)).toBe('""')
  })

  it('returns empty quoted string for undefined', () => {
    expect(csvSanitizeCell(undefined)).toBe('""')
  })

  it('returns empty quoted string for empty string', () => {
    expect(csvSanitizeCell('')).toBe('""')
  })

  it('handles numbers', () => {
    expect(csvSanitizeCell(42)).toBe('"42"')
  })

  it('handles booleans', () => {
    expect(csvSanitizeCell(true)).toBe('"true"')
  })

  it('handles combined escape + formula prefix', () => {
    expect(csvSanitizeCell('=1+1"test')).toBe(`"'=1+1""test"`)
  })
})
