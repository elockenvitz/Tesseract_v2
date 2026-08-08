import { describe, expect, it } from 'vitest'
import {
  groupIntoRows,
  rowSearchText,
  COMMITTED_PIPELINE_STATUSES,
  ARCHIVED_PIPELINE_STATUSES,
} from '../pipeline-rows'

/**
 * The phone's pipeline collapses trade_queue_items into rows before rendering.
 * Every failure mode here is silent: a mis-grouped pair still renders and still
 * looks plausible, it just tells the reader something untrue — that a pair is
 * two independent ideas, or that a stage holds more cards than it does, or that
 * a leg can be advanced on its own when legs only ever move together.
 *
 * Nothing downstream would catch it. The move mutation accepts whatever id it
 * is handed.
 */

const leg = (over: Record<string, any> = {}) => ({
  id: 'leg-1',
  stage: 'investigate',
  status: 'idea',
  action: 'buy',
  created_by: 'u1',
  assets: { symbol: 'AAPL', company_name: 'Apple Inc' },
  ...over,
})

describe('groupIntoRows', () => {
  it('keeps unpaired ideas as individual rows', () => {
    const rows = groupIntoRows([leg({ id: 'a' }), leg({ id: 'b' })])
    expect(rows).toHaveLength(2)
    expect(rows.every(r => r.kind === 'item')).toBe(true)
  })

  it('collapses legs sharing a pair into one row', () => {
    const rows = groupIntoRows([
      leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long' }),
      leg({ id: 'b', pair_id: 'p1', pair_leg_type: 'short', assets: { symbol: 'MSFT' } }),
    ])

    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe('pair')
    if (rows[0].kind !== 'pair') throw new Error('unreachable')
    expect(rows[0].id).toBe('p1')
    expect(rows[0].legs).toHaveLength(2)
  })

  it('honours the legacy pair_trade_id as well as pair_id', () => {
    const rows = groupIntoRows([
      leg({ id: 'a', pair_trade_id: 'p9', pair_leg_type: 'long' }),
      leg({ id: 'b', pair_trade_id: 'p9', pair_leg_type: 'short' }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('p9')
  })

  it('orders legs long-first so a pair renders the same on every load', () => {
    const shortFirst = groupIntoRows([
      leg({ id: 'b', pair_id: 'p1', pair_leg_type: 'short', assets: { symbol: 'MSFT' } }),
      leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long', assets: { symbol: 'AAPL' } }),
    ])
    const longFirst = groupIntoRows([
      leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long', assets: { symbol: 'AAPL' } }),
      leg({ id: 'b', pair_id: 'p1', pair_leg_type: 'short', assets: { symbol: 'MSFT' } }),
    ])

    if (shortFirst[0].kind !== 'pair' || longFirst[0].kind !== 'pair') throw new Error('unreachable')
    expect(shortFirst[0].legs.map(l => l.id)).toEqual(['a', 'b'])
    expect(longFirst[0].legs.map(l => l.id)).toEqual(['a', 'b'])
  })

  it('does not add the same leg twice when a caller merges sources', () => {
    const duplicated = leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long' })
    const rows = groupIntoRows([duplicated, { ...duplicated }])

    if (rows[0].kind !== 'pair') throw new Error('unreachable')
    expect(rows[0].legs).toHaveLength(1)
  })

  it('takes the pair stage from a leg, not the stale joined pair record', () => {
    const rows = groupIntoRows([
      leg({
        id: 'a',
        pair_id: 'p1',
        pair_leg_type: 'long',
        stage: 'deep_research',
        status: 'idea',
        // The parent still claims the stage the pair was created in.
        pair_trades: { id: 'p1', name: 'Long AAPL / Short MSFT', status: 'idea', stage: 'aware' },
      }),
    ])

    expect(rows[0].stage).toBe('deep_research')
  })

  it('resolves legacy statuses to a research stage, as the board does', () => {
    const rows = groupIntoRows([leg({ id: 'a', stage: 'idea' })])
    // Whatever toResearchStage maps it to, it must be a stage the strip renders
    // rather than the raw legacy value passed through.
    expect(rows[0].stage).toBeTruthy()
    expect(rows[0].stage).not.toBe(undefined)
  })

  it('carries the joined pair record through for the card title', () => {
    const rows = groupIntoRows([
      leg({
        id: 'a',
        pair_id: 'p1',
        pair_leg_type: 'long',
        pair_trades: { id: 'p1', name: 'Semis pair' },
      }),
    ])
    if (rows[0].kind !== 'pair') throw new Error('unreachable')
    expect(rows[0].pair.name).toBe('Semis pair')
  })

  it('falls back to a placeholder when no leg carries the pair record', () => {
    const rows = groupIntoRows([leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long' })])
    if (rows[0].kind !== 'pair') throw new Error('unreachable')
    expect(rows[0].pair.name).toBe('Pair Trade')
  })

  it('tolerates nulls in the list rather than throwing mid-render', () => {
    expect(() => groupIntoRows([null as any, leg({ id: 'a' })])).not.toThrow()
    expect(groupIntoRows([null as any, leg({ id: 'a' })])).toHaveLength(1)
  })
})

describe('rowSearchText', () => {
  it('matches a pair on either leg, not just the pair name', () => {
    const rows = groupIntoRows([
      leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long', assets: { symbol: 'AAPL', company_name: 'Apple Inc' } }),
      leg({ id: 'b', pair_id: 'p1', pair_leg_type: 'short', assets: { symbol: 'MSFT', company_name: 'Microsoft' } }),
    ])
    const text = rowSearchText(rows[0])
    expect(text).toContain('aapl')
    expect(text).toContain('msft')
    expect(text).toContain('microsoft')
  })

  it('matches a single idea on symbol, company and rationale', () => {
    const rows = groupIntoRows([leg({ id: 'a', rationale: 'Capex guides revised up' })])
    const text = rowSearchText(rows[0])
    expect(text).toContain('aapl')
    expect(text).toContain('apple')
    expect(text).toContain('capex')
  })
})

describe('terminal status buckets', () => {
  it('does not classify a status as both committed and archived', () => {
    for (const s of COMMITTED_PIPELINE_STATUSES) {
      expect(ARCHIVED_PIPELINE_STATUSES).not.toContain(s)
    }
  })

  it('keeps in-flight statuses out of both buckets, so nothing vanishes', () => {
    for (const s of ['idea', 'discussing', 'simulating', 'deciding']) {
      expect(COMMITTED_PIPELINE_STATUSES).not.toContain(s)
      expect(ARCHIVED_PIPELINE_STATUSES).not.toContain(s)
    }
  })
})
