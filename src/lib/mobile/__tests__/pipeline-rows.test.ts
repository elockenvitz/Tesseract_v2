import { describe, expect, it } from 'vitest'
import {
  groupIntoRows,
  rowSearchText,
  missingForStage,
  isForwardMove,
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
  stage: 'researching',
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
        stage: 'developing',
        status: 'idea',
        // The parent still claims the stage the pair was created in.
        pair_trades: { id: 'p1', name: 'Long AAPL / Short MSFT', status: 'idea', stage: 'exploring' },
      }),
    ])

    expect(rows[0].stage).toBe('developing')
  })

  it('resolves a legacy stage to a canonical one, as the board does', () => {
    // Rows written before the four-stage migration still carry the old
    // vocabulary. The strip has no column for them, so a raw pass-through
    // would drop the card off the board entirely.
    const rows = groupIntoRows([leg({ id: 'a', stage: 'idea' })])
    expect(rows[0].stage).toBe('exploring')

    expect(groupIntoRows([leg({ id: 'b', stage: 'deciding' })])[0].stage)
      .toBe('ready_to_recommend')
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

/**
 * The service throws on a forward move whose requirements are unmet, and the
 * phone used to offer the move anyway — tap, wait, refused. This surface now
 * calls the same `missingForStage` the service does rather than keeping its
 * own copy, so the two cannot disagree; what is pinned here is the unwrapping
 * of a pair row, which is this file's own logic.
 */
describe('missingForStage', () => {
  const withFields = (over: Record<string, any>) =>
    groupIntoRows([leg({ id: 'a', ...over })])[0]

  it('gates ready_to_recommend on rationale and thesis', () => {
    const bare = withFields({ rationale: null, thesis_text: null })
    expect(missingForStage(bare, 'ready_to_recommend'))
      .toEqual(['Why now (rationale)', 'Trade thesis'])
  })

  it('names only what is actually missing', () => {
    const partial = withFields({ rationale: 'Capex inflecting', thesis_text: null })
    expect(missingForStage(partial, 'ready_to_recommend')).toEqual(['Trade thesis'])
  })

  it('treats whitespace as absent, as the service does', () => {
    const blank = withFields({ rationale: '   ', thesis_text: '\n' })
    expect(missingForStage(blank, 'ready_to_recommend'))
      .toEqual(['Why now (rationale)', 'Trade thesis'])
  })

  it('allows the move once both are present', () => {
    const complete = withFields({ rationale: 'Capex inflecting', thesis_text: 'Supply constrained' })
    expect(missingForStage(complete, 'ready_to_recommend')).toEqual([])
  })

  it('does not gate the earlier stages', () => {
    const bare = withFields({ rationale: null, thesis_text: null })
    for (const s of ['exploring', 'researching', 'developing']) {
      expect(missingForStage(bare, s)).toEqual([])
    }
  })

  it('gates a pair on its first leg rather than throwing on an empty group', () => {
    const pair = groupIntoRows([
      leg({ id: 'a', pair_id: 'p1', pair_leg_type: 'long', rationale: null, thesis_text: null }),
      leg({ id: 'b', pair_id: 'p1', pair_leg_type: 'short' }),
    ])[0]
    expect(missingForStage(pair, 'ready_to_recommend')).toContain('Trade thesis')
  })
})

describe('isForwardMove', () => {
  it('recognises advancing through the pipeline', () => {
    expect(isForwardMove('exploring', 'researching')).toBe(true)
    expect(isForwardMove('researching', 'ready_to_recommend')).toBe(true)
  })

  it('does not treat going back as forward, so backward moves stay ungated', () => {
    expect(isForwardMove('ready_to_recommend', 'exploring')).toBe(false)
    expect(isForwardMove('developing', 'researching')).toBe(false)
  })

  it('is false for a move to the same stage', () => {
    expect(isForwardMove('researching', 'researching')).toBe(false)
  })

  it('is false when either stage is unknown, rather than gating blindly', () => {
    expect(isForwardMove('nonsense', 'researching')).toBe(false)
    expect(isForwardMove('researching', 'nonsense')).toBe(false)
  })

  it('is false for a retired stage name, which is no longer a position', () => {
    expect(isForwardMove('deciding', 'ready_to_recommend')).toBe(false)
    expect(isForwardMove('aware', 'developing')).toBe(false)
  })
})
