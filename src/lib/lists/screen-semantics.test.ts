/**
 * Saved-screen semantics across the C1 boundary.
 *
 * Eight of the fields a saved screen can filter on used to be columns on the
 * global `assets` row: priority, process_stage, completeness, thesis,
 * where_different, risks_to_thesis, quick_note, quick_note_updated_at. A saved
 * screen is a stored criteria tree referring to those field KEYS, so the keys
 * must keep working — but they must now evaluate against the caller's own
 * organisation rather than whatever the last writer in any tenant set.
 *
 * These tests run the real evaluator over a row assembled the way
 * `useScreenResults` now assembles it: global reference data merged with an
 * organisation overlay. Three cases matter, and they are the same three the
 * live matrix proves at the database level —
 *
 *   own org        the criterion still matches
 *   foreign org    the criterion does NOT match
 *   no org         the criterion does NOT match
 *
 * — which is what "preserve saved-screen semantics" has to mean: identical
 * behaviour for the tenant that owns the data, and no behaviour at all for
 * anyone else.
 */
import { describe, it, expect } from 'vitest'
import { evaluateCriteria } from './screen-evaluator'
import { SCREENABLE_FIELDS } from './screen-fields'
import { applyAssetOverlay, EMPTY_OVERLAY, type AssetOverlay } from '../research/asset-overlay'
import type { ScreenCriteria } from './screen-types'

/** A global asset row as the universe query now selects it — reference only. */
const globalAsset = {
  id: 'a1',
  symbol: 'AAPL',
  company_name: 'Apple Inc',
  sector: 'Technology',
  industry: 'Consumer Electronics',
  country: 'US',
  exchange: 'NASDAQ',
  current_price: 100,
  market_cap: 3_000_000_000_000,
  created_at: '2026-01-01',
  updated_at: '2026-08-01',
  created_by: 'u1',
}

/** What org A sees. */
const orgAOverlay: AssetOverlay = {
  ...EMPTY_OVERLAY,
  thesis: 'Operating leverage inflects in FY27',
  where_different: 'Consensus underestimates services mix',
  risks_to_thesis: 'China demand',
  quick_note: 'Revisit after Q3',
  quick_note_updated_at: '2026-08-10',
  priority: 'high',
  process_stage: 'analysis',
  completeness: 50,
}

const rule = (field: string, op: string, value?: unknown): ScreenCriteria =>
  ({ combinator: 'AND', rules: [{ field, op, value }] } as unknown as ScreenCriteria)

const ownOrgRow     = applyAssetOverlay(globalAsset, orgAOverlay)
const foreignOrgRow = applyAssetOverlay(globalAsset, undefined) // org B: no overlay for A's data
const noOrgRow      = applyAssetOverlay(globalAsset, undefined) // unaffiliated user

describe('global reference criteria are unaffected by the overlay', () => {
  // These never came from the proprietary columns, so C1 must not have moved
  // them. If one of these breaks, the universe query lost a column it needs.
  const cases: Array<[string, string, unknown]> = [
    ['symbol', 'equals', 'AAPL'],
    ['company_name', 'contains', 'Apple'],
    ['sector', 'equals', 'Technology'],
    ['industry', 'contains', 'Consumer'],
    ['country', 'equals', 'US'],
    ['exchange', 'equals', 'NASDAQ'],
    ['current_price', 'gt', 50],
    ['market_cap', 'gt', 1_000_000_000],
    ['updated_at', 'before', '2026-12-31'],
  ]

  for (const [field, op, value] of cases) {
    it(`${field} ${op} still matches for every caller`, () => {
      expect(evaluateCriteria(ownOrgRow, rule(field, op, value))).toBe(true)
      // Reference data is global on purpose — an unaffiliated user sees it too.
      expect(evaluateCriteria(noOrgRow, rule(field, op, value))).toBe(true)
    })
  }
})

describe('own-org workflow criteria still work', () => {
  it('priority is', () => {
    expect(evaluateCriteria(ownOrgRow, rule('priority', 'is', 'high'))).toBe(true)
  })
  it('priority in', () => {
    expect(evaluateCriteria(ownOrgRow, rule('priority', 'in', ['high', 'critical']))).toBe(true)
  })
  it('process_stage is', () => {
    expect(evaluateCriteria(ownOrgRow, rule('process_stage', 'is', 'analysis'))).toBe(true)
  })
  it('completeness gte', () => {
    expect(evaluateCriteria(ownOrgRow, rule('completeness', 'gte', 50))).toBe(true)
  })
})

describe('own-org research criteria still work', () => {
  it('thesis contains', () => {
    expect(evaluateCriteria(ownOrgRow, rule('thesis', 'contains', 'operating leverage'))).toBe(true)
  })
  it('thesis is_not_empty', () => {
    expect(evaluateCriteria(ownOrgRow, rule('thesis', 'is_not_empty'))).toBe(true)
  })
  it('where_different contains', () => {
    expect(evaluateCriteria(ownOrgRow, rule('where_different', 'contains', 'services mix'))).toBe(true)
  })
  it('risks_to_thesis contains', () => {
    expect(evaluateCriteria(ownOrgRow, rule('risks_to_thesis', 'contains', 'China'))).toBe(true)
  })
  it('quick_note contains', () => {
    expect(evaluateCriteria(ownOrgRow, rule('quick_note', 'contains', 'Q3'))).toBe(true)
  })
})

describe('another organisation cannot satisfy a proprietary criterion', () => {
  // The heart of the finding: before C1 these read one global value, so org B
  // screening on "thesis contains operating leverage" matched org A's thesis.
  const proprietary: Array<[string, string, unknown]> = [
    ['thesis', 'contains', 'operating leverage'],
    ['where_different', 'contains', 'services mix'],
    ['risks_to_thesis', 'contains', 'China'],
    ['quick_note', 'contains', 'Q3'],
    ['priority', 'is', 'high'],
    ['process_stage', 'is', 'analysis'],
    ['completeness', 'gte', 50],
  ]

  for (const [field, op, value] of proprietary) {
    it(`${field} does not match for a foreign org`, () => {
      expect(evaluateCriteria(foreignOrgRow, rule(field, op, value))).toBe(false)
    })
    it(`${field} does not match for an unaffiliated user`, () => {
      expect(evaluateCriteria(noOrgRow, rule(field, op, value))).toBe(false)
    })
  }

  it('is_empty is true for a foreign org — absence, not another tenant\'s value', () => {
    expect(evaluateCriteria(foreignOrgRow, rule('thesis', 'is_empty'))).toBe(true)
    expect(evaluateCriteria(foreignOrgRow, rule('thesis', 'is_not_empty'))).toBe(false)
  })
})

describe('the field registry and the overlay agree', () => {
  it('every proprietary screenable field is supplied by the overlay', () => {
    // A field in the registry that the overlay does not populate would read as
    // permanently empty and silently break the screens that use it.
    const proprietary = ['thesis', 'where_different', 'risks_to_thesis', 'quick_note',
                         'priority', 'process_stage', 'completeness']
    for (const key of proprietary) {
      expect(SCREENABLE_FIELDS.some(f => f.key === key)).toBe(true)
      expect(Object.keys(EMPTY_OVERLAY)).toContain(key)
    }
  })

  it('a combined global + proprietary screen behaves as an AND', () => {
    const combined = {
      combinator: 'AND',
      rules: [
        { field: 'sector', op: 'equals', value: 'Technology' },
        { field: 'priority', op: 'is', value: 'high' },
      ],
    } as unknown as ScreenCriteria
    expect(evaluateCriteria(ownOrgRow, combined)).toBe(true)
    // Foreign org matches the global half and fails the proprietary half.
    expect(evaluateCriteria(foreignOrgRow, combined)).toBe(false)
  })
})
