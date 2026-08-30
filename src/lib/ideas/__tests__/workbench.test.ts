import { describe, expect, it } from 'vitest'

import {
  buildWorkbench, filterWorkbench, needsAttentionCount, nextActionFor, stanceOf,
  type WorkbenchCandidate,
} from '../workbench'

const NOW = new Date('2026-08-30T12:00:00.000Z').getTime()

const post = (over: Partial<WorkbenchCandidate> & { symbol: string; id: string }): WorkbenchCandidate => ({
  kind: 'post', tier: 3, reasons: [], headline: '',
  post: {
    id: over.id, type: 'trade_idea', action: 'sell', status: 'idea',
    rationale: 'Consumer slowdown, discretionary pressure.',
    created_at: '2026-06-01T00:00:00.000Z',
    author: { first_name: 'Priya', last_name: 'Raman' },
    asset: { id: `a-${over.symbol}`, symbol: over.symbol, company_name: `${over.symbol} Inc`, current_price: 102 },
    portfolio: { name: 'Global Equity' },
  },
  ...over,
})

const finding = (over: Partial<WorkbenchCandidate> & { symbol: string; id: string }): WorkbenchCandidate => ({
  kind: 'lens', tier: 1, reasons: [], headline: 'CROX has passed its price target',
  why: '14% through the target you recorded.', typeKey: 'target_hit',
  ...over,
})

describe('findings explain ideas rather than competing with them', () => {
  it('folds a finding into the idea about the same name', () => {
    /**
     * The whole correction. The cockpit rendered these as two peer rows, so a
     * desk of one idea read as two exceptions.
     */
    const out = buildWorkbench([finding({ id: 'f1', symbol: 'CROX' }), post({ id: 'p1', symbol: 'CROX' })], NOW)
    expect(out).toHaveLength(1)
    expect(out[0].origin).toBe('authored')
    expect(out[0].id).toBe('p1')
    expect(out[0].thesis).toContain('Consumer slowdown')
    expect(out[0].evidence).toHaveLength(1)
    expect(out[0].evidence[0].typeKey).toBe('target_hit')
  })

  it('keeps ranked order, and takes the best tier of its parts', () => {
    // The finding ranked first, so CROX leads — but the row is the IDEA.
    const out = buildWorkbench([
      finding({ id: 'f1', symbol: 'CROX', tier: 1 }),
      post({ id: 'p2', symbol: 'NVDA', tier: 2 }),
      post({ id: 'p1', symbol: 'CROX', tier: 3 }),
    ], NOW)
    expect(out.map(i => i.symbol)).toEqual(['CROX', 'NVDA'])
    // An idea is as urgent as the most urgent true thing about it.
    expect(out[0].tier).toBe(1)
  })

  it('a post does not become its own evidence', () => {
    // Its headline is its content, which the row already shows as the thesis.
    const out = buildWorkbench([post({ id: 'p1', symbol: 'CROX' })], NOW)
    expect(out[0].evidence).toHaveLength(0)
    expect(out[0].whyNow).toBeNull()
  })

  it('raises a name the desk owns but has no idea about', () => {
    // Rather than inventing a fake idea to hold it, or dropping it.
    const out = buildWorkbench([finding({ id: 'f1', symbol: 'LLY' })], NOW)
    expect(out[0].origin).toBe('signal')
    expect(out[0].stance).toBe('watch')
    expect(out[0].thesis).toBeNull()
    expect(out[0].author).toBeNull()
  })
})

describe('stance comes off the one column that states direction', () => {
  it('reads buy and sell, and never guesses', () => {
    expect(stanceOf({ action: 'buy' } as any)).toBe('buy')
    expect(stanceOf({ action: 'trim' } as any)).toBe('sell')
    // No stated direction is watching — honest, not a default to buy.
    expect(stanceOf({ action: null } as any)).toBe('watch')
    expect(stanceOf({ rationale: 'we should buy this' } as any)).toBe('watch')
  })
})

describe('the next action is specific, or absent', () => {
  it('names the verb the strongest finding resolves to', () => {
    const out = buildWorkbench([
      finding({ id: 'f1', symbol: 'AMZN', typeKey: 'scenario_gap', headline: 'Trading above every modelled case' }),
      post({ id: 'p1', symbol: 'AMZN' }),
    ], NOW)
    expect(out[0].next).toEqual({
      label: 'Review scenarios', route: 'scenarios',
      because: 'Trading above every modelled case',
    })
  })

  it('skips a finding it has no verb for and uses the next one that has', () => {
    /**
     * A generic "Open" on the top finding would be worse than the second
     * finding's real action — that is the failure the brief names.
     */
    const idea = buildWorkbench([
      finding({ id: 'f0', symbol: 'NVDA', tier: 1, typeKey: 'something_unmapped', headline: 'Unmapped' }),
      finding({ id: 'f1', symbol: 'NVDA', tier: 2, typeKey: 'research_stale', headline: 'Stale research' }),
      post({ id: 'p1', symbol: 'NVDA' }),
    ], NOW)[0]
    expect(idea.next?.label).toBe('Review research')
  })

  it('falls back to answering an open proposal, and to nothing at all otherwise', () => {
    const open = buildWorkbench([post({ id: 'p1', symbol: 'CROX' })], NOW)[0]
    expect(open.next?.route).toBe('idea')

    const settled = buildWorkbench([
      post({ id: 'p2', symbol: 'MSFT', post: { ...post({ id: 'p2', symbol: 'MSFT' }).post!, status: 'accepted' } }),
    ], NOW)[0]
    expect(nextActionFor(settled)).toBeNull()
  })
})

describe('attention is metadata, not a section', () => {
  it('counts ideas carrying a finding', () => {
    const out = buildWorkbench([
      finding({ id: 'f1', symbol: 'CROX' }), post({ id: 'p1', symbol: 'CROX' }),
      post({ id: 'p2', symbol: 'MSFT' }),
    ], NOW)
    expect(needsAttentionCount(out)).toBe(1)
  })

  it('filters one ranked list rather than carving the page up', () => {
    const out = buildWorkbench([
      finding({ id: 'f1', symbol: 'LLY' }),
      post({ id: 'p1', symbol: 'CROX' }),
    ], NOW)
    expect(filterWorkbench(out, 'all')).toHaveLength(2)
    expect(filterWorkbench(out, 'attention').map(i => i.symbol)).toEqual(['LLY'])
    expect(filterWorkbench(out, 'authored').map(i => i.symbol)).toEqual(['CROX'])
    expect(filterWorkbench(out, 'watching').map(i => i.symbol)).toEqual(['LLY'])
  })
})

describe('deterministic', () => {
  it('produces the same workbench for the same candidates', () => {
    const input = [finding({ id: 'f1', symbol: 'CROX' }), post({ id: 'p1', symbol: 'CROX' })]
    expect(buildWorkbench(input, NOW)).toEqual(buildWorkbench(input, NOW))
  })
})
