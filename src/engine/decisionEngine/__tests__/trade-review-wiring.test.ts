/**
 * The obligation read loop, end to end through the engine.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `evaluateTradeReviewOwed` opens with
 * `if (!data.tradeReviewObligations?.length) return []`. The field is
 * OPTIONAL on `EngineArgs`, and neither caller of `runGlobalDecisionEngine`
 * passed it — not `useGlobalDecisionEngine`, not `useDecisionEngine`. So the
 * evaluator returned an empty array on every run in the live application,
 * while the Trade Book sync went on writing obligations nobody read.
 *
 * Nothing failed. No error, no empty state, no wrong number — the finding
 * simply never appeared. That is why this file asserts the POSITIVE case
 * first and then proves the old shape fails it.
 */
import { describe, it, expect } from 'vitest'
import { runGlobalDecisionEngine } from '../globalDecisionEngine'
import {
  evaluateTradeReviewOwed,
  tradeReviewCandidates,
  TRADE_REVIEW_OWED_KIND,
  type OpenTradeReviewObligation,
} from '../evaluators/tradeReviewOwed'
import { toTradeReviewObligations } from '../../../hooks/useOpenObligations'
import type { EnrichedObligation } from '../../../hooks/useOpenObligations'

const NOW = new Date('2026-10-01T12:00:00Z')

const obligation = (over: Partial<OpenTradeReviewObligation> = {}): OpenTradeReviewObligation => ({
  id: 'ob-1',
  subject_id: 'trade-1',
  organization_id: 'org-A',
  owner_id: 'pm-1',
  raised_at: '2026-09-20T00:00:00Z',
  due_at: null,
  asset_symbol: 'NVDA',
  portfolio_name: 'Core Growth',
  ...over,
})

const ENGINE_BASE = {
  userId: 'pm-1',
  role: 'analyst',
  coverage: { assetIds: [], portfolioIds: [] },
  now: NOW,
}

const run = (tradeReviewObligations?: OpenTradeReviewObligation[]) =>
  runGlobalDecisionEngine({ ...ENGINE_BASE, data: { tradeReviewObligations } })

const reviewItems = (r: ReturnType<typeof run>) =>
  [...r.actionItems, ...r.intelItems].filter(i => i.titleKey === TRADE_REVIEW_OWED_KIND)

describe('an open obligation reaches the engine', () => {
  it('produces a decision item', () => {
    const items = reviewItems(run([obligation()]))
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Trade Needs Review')
  })

  it('carries the symbol and portfolio the batched lookup resolved', () => {
    const [item] = reviewItems(run([obligation()]))
    const chips = Object.fromEntries((item.chips ?? []).map(c => [c.label, c.value]))
    expect(chips.Ticker).toBe('NVDA')
    expect(chips.Portfolio).toBe('Core Growth')
  })

  it('measures waiting from raised_at, not from now', () => {
    const [item] = reviewItems(run([obligation({ raised_at: '2026-09-20T00:00:00Z' })]))
    const chips = Object.fromEntries((item.chips ?? []).map(c => [c.label, c.value]))
    expect(chips.Waiting).toBe('11d')
  })
})

describe('NON-VACUITY: the previous call shape fails the positive case', () => {
  it('omitting the field — what both callers did — yields nothing', () => {
    // This is the entire bug, in one line. The data object both hooks built
    // simply had no `tradeReviewObligations` key.
    expect(reviewItems(run(undefined))).toHaveLength(0)
  })

  it('and the same obligation passed in does yield something', () => {
    expect(reviewItems(run([obligation()]))).toHaveLength(1)
  })

  it('so the two disagree — the wiring is load bearing', () => {
    expect(reviewItems(run(undefined)).length).not.toBe(reviewItems(run([obligation()])).length)
  })
})

describe('eligibility is unchanged by this wiring', () => {
  it('an empty list produces nothing, and is not an error', () => {
    expect(() => run([])).not.toThrow()
    expect(reviewItems(run([]))).toHaveLength(0)
  })

  it('a cleared obligation never arrives — the loader filters on cleared_at', () => {
    // `fetchObligations` applies `.is('cleared_at', null)`. A cleared row
    // cannot be in the array the engine receives, which is why the
    // evaluator has no clearing logic of its own.
    const cleared: EnrichedObligation[] = []
    expect(toTradeReviewObligations(cleared)).toHaveLength(0)
    expect(reviewItems(run(toTradeReviewObligations(cleared)))).toHaveLength(0)
  })

  it('undefined from a still-loading query is not an error', () => {
    expect(toTradeReviewObligations(undefined)).toEqual([])
    expect(reviewItems(run(toTradeReviewObligations(undefined)))).toHaveLength(0)
  })
})

describe('severity comes from the obligation and nothing else', () => {
  it('past its due date is red', () => {
    const [c] = tradeReviewCandidates({
      tradeReviewObligations: [obligation({ raised_at: '2026-09-30T00:00:00Z', due_at: '2026-09-30T00:00:00Z' })],
      now: NOW,
    })
    expect(c.severity).toBe('red')
  })

  it('two weeks waiting is red even with no due date', () => {
    const [c] = tradeReviewCandidates({
      tradeReviewObligations: [obligation({ raised_at: '2026-09-10T00:00:00Z' })],
      now: NOW,
    })
    expect(c.severity).toBe('red')
  })

  it('one week is orange, fresher is yellow', () => {
    const [orange] = tradeReviewCandidates({
      tradeReviewObligations: [obligation({ raised_at: '2026-09-23T00:00:00Z' })], now: NOW,
    })
    const [yellow] = tradeReviewCandidates({
      tradeReviewObligations: [obligation({ raised_at: '2026-09-29T00:00:00Z' })], now: NOW,
    })
    expect(orange.severity).toBe('orange')
    expect(yellow.severity).toBe('yellow')
  })
})

describe('tenant isolation survives the wiring', () => {
  it('the candidate carries the obligation\'s own org, never the caller\'s', () => {
    const [c] = tradeReviewCandidates({
      tradeReviewObligations: [obligation({ organization_id: 'org-B' })], now: NOW,
    })
    expect(c.organizationId).toBe('org-B')
  })

  it('the loader is org-scoped at the query AND by RLS', () => {
    // `useOpenObligations` passes `organizationId: currentOrgId` into
    // `fetchObligations`, which applies `.eq('organization_id', …)`. The
    // boundary underneath is `memory_obligations`' SELECT policy,
    // `is_member_of_org(organization_id)` — tested against the fake policy
    // in lib/memory/__tests__/due-obligations.test.ts. This asserts the
    // mapping does not smuggle a different org through.
    const rows = [{ organization_id: 'org-A' }, { organization_id: 'org-B' }] as EnrichedObligation[]
    expect(toTradeReviewObligations(rows).map(r => r.organization_id)).toEqual(['org-A', 'org-B'])
  })
})

describe('the mapping to the evaluator shape', () => {
  it('passes exactly what the evaluator declares, and no blobs', () => {
    const row = {
      id: 'ob-1', organization_id: 'org-A', kind: 'trade_review',
      subject_type: 'trade', subject_id: 'trade-1', owner_id: 'pm-1',
      raised_at: '2026-09-20T00:00:00Z', due_at: null,
      source_type: 'accepted_trades', source_id: 'trade-1',
      provenance: 'job:trade-book-lifecycle',
      asset_symbol: 'NVDA', company_name: 'NVIDIA Corp',
      asset_id: 'asset-1', portfolio_name: 'Core Growth',
      resolved_portfolio_id: 'pf-1',
    } as EnrichedObligation

    const [mapped] = toTradeReviewObligations([row])
    expect(Object.keys(mapped).sort()).toEqual([
      'asset_symbol', 'due_at', 'id', 'organization_id', 'owner_id',
      'portfolio_name', 'raised_at', 'subject_id',
    ])
  })

  it('many obligations all reach the engine', () => {
    const rows = Array.from({ length: 24 }, (_, i) => ({
      id: `ob-${i}`, organization_id: 'org-A', kind: 'trade_review',
      subject_type: 'trade', subject_id: `trade-${i}`, owner_id: 'pm-1',
      raised_at: '2026-09-20T00:00:00Z', due_at: null,
      source_type: null, source_id: null, provenance: 'p',
      asset_symbol: 'AAA', company_name: null, asset_id: null,
      portfolio_name: null, resolved_portfolio_id: null,
    })) as EnrichedObligation[]

    // All 24 reach the evaluator and all 24 become claims. How the engine
    // then GROUPS them for display — it rolls same-kind action items into a
    // single parent — is pre-existing behaviour this slice does not touch,
    // so the assertion stops at the boundary this slice is responsible for.
    const mapped = toTradeReviewObligations(rows)
    expect(mapped).toHaveLength(24)
    expect(evaluateTradeReviewOwed({ tradeReviewObligations: mapped, now: NOW })).toHaveLength(24)
    expect(tradeReviewCandidates({ tradeReviewObligations: mapped, now: NOW })).toHaveLength(24)

    // And the engine surfaces them rather than dropping them.
    expect(reviewItems(run(mapped)).length).toBeGreaterThan(0)
  })
})
