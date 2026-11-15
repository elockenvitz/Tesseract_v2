/**
 * A suggestion may name only what the caller gave us, and may not assert that
 * a record exists.
 *
 * The first test is the defect: the previous version fell back to the tag's
 * TYPE when no label had resolved, so the panel's opening offer on first paint
 * was "Analyze asset's thesis for blind spots" — a question about a company
 * called "asset".
 */
import { describe, it, expect } from 'vitest'
import { suggestedPrompts } from '../suggested-prompts'

const AAPL = { type: 'asset', id: 'a1' }
const MSFT = { type: 'asset', id: 'a2' }
const labels = { 'asset:a1': 'AAPL', 'asset:a2': 'MSFT' }

describe('suggestedPrompts', () => {
  it('never calls an unlabelled object by its type', () => {
    const out = suggestedPrompts({ tags: [AAPL], tagLabels: {} })
    expect(out.length).toBeGreaterThan(0)
    for (const p of out) {
      expect(p).not.toMatch(/\basset's\b/)
      expect(p).not.toMatch(/about asset\b/)
      expect(p).not.toMatch(/the asset thesis/)
    }
  })

  it('writes the prompt without a name when the name is unknown', () => {
    const out = suggestedPrompts({ tags: [AAPL], tagLabels: {} })
    expect(out.some(p => p.includes('this name'))).toBe(true)
  })

  it('uses the real name once the label has resolved', () => {
    const out = suggestedPrompts({ tags: [AAPL], tagLabels: labels })
    expect(out.some(p => p.includes('AAPL'))).toBe(true)
    expect(out.every(p => !p.includes('undefined'))).toBe(true)
  })

  it('leads with the issue that raised the engagement, quoted', () => {
    const out = suggestedPrompts({
      tags: [AAPL], tagLabels: labels,
      target: { issue: { title: 'Price target expired' } },
    })
    expect(out[0]).toBe('What does "Price target expired" mean for the thesis?')
  })

  it('asks the exposure question only when both halves are real', () => {
    const both = suggestedPrompts({
      tags: [AAPL], tagLabels: labels, mode: 'research',
      target: { symbol: 'AAPL', portfolioName: 'Growth Composite' },
    })
    expect(both.some(p => p === 'How does AAPL affect Growth Composite exposure?')).toBe(true)

    const halfOnly = suggestedPrompts({
      tags: [AAPL], tagLabels: labels, mode: 'research',
      target: { symbol: 'AAPL', portfolioName: '   ' },
    })
    expect(halfOnly.some(p => p.includes('exposure?'))).toBe(false)
  })

  it('compares the whole set or none of it', () => {
    /* A comparison that silently drops the member whose label had not arrived
       compares the wrong set of companies. */
    const partial = suggestedPrompts({
      tags: [AAPL, MSFT], tagLabels: { 'asset:a1': 'AAPL' },
    })
    expect(partial.some(p => p.includes('AAPL'))).toBe(false)
    expect(partial.some(p => p.includes('the names in this conversation'))).toBe(true)

    const full = suggestedPrompts({ tags: [AAPL, MSFT], tagLabels: labels })
    expect(full.some(p => p.includes('AAPL vs MSFT'))).toBe(true)
  })

  it('offers portfolio questions for a portfolio, not asset ones', () => {
    const out = suggestedPrompts({
      tags: [{ type: 'portfolio', id: 'p1' }], tagLabels: { 'portfolio:p1': 'Growth Composite' },
    })
    expect(out.some(p => p.includes('sector allocation'))).toBe(true)
    expect(out.some(p => p.includes('thesis for blind spots'))).toBe(false)
  })

  it('falls back to market questions with nothing bound', () => {
    const out = suggestedPrompts({})
    expect(out).toContain('What sectors are showing momentum?')
  })

  it('offers more in research mode than on the rail, and never duplicates', () => {
    const ctx = {
      tags: [AAPL], tagLabels: labels,
      target: { issue: { title: 'Thesis stale' }, symbol: 'AAPL', portfolioName: 'Growth Composite' },
    }
    const compact = suggestedPrompts({ ...ctx, mode: 'compact' })
    const research = suggestedPrompts({ ...ctx, mode: 'research' })
    expect(compact).toHaveLength(4)
    expect(research).toHaveLength(6)
    expect(new Set(research).size).toBe(research.length)
    /* Research is a superset: switching modes must not retract a question. */
    expect(research.slice(0, compact.length)).toEqual(compact)
  })

  it('asserts no record it has not looked up', () => {
    /* "Summarize the three open requirements" would have the panel inventing
       the firm's work before the model has looked anything up. */
    const out = suggestedPrompts({
      tags: [AAPL], tagLabels: labels, mode: 'research',
      target: { symbol: 'AAPL', portfolioName: 'Growth Composite' },
    })
    for (const p of out) expect(p).not.toMatch(/\b\d+\s+(open|pending|recorded)\b/)
  })

  it('writes no em dash into user-visible copy', () => {
    const out = suggestedPrompts({
      tags: [AAPL], tagLabels: labels, mode: 'research',
      target: { issue: { title: 'Thesis stale' }, symbol: 'AAPL', portfolioName: 'Growth Composite' },
    })
    for (const p of out) expect(p).not.toContain('—')
  })
})
