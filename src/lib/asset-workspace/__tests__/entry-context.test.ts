/**
 * The entry context, built from the payload the Dashboard actually produces.
 *
 * The fixtures below are not invented shapes. `AAPL` is a `TargetBreach` as
 * `usePortfolioLenses` builds one -- the ladder sorted, the lowest rung
 * excluded from reaching, the mark taken from the holdings snapshot -- and the
 * card and the selection are built by the real `buildTargetHitCard` and
 * `selectionFor`. A fixture written by hand here would let the contract agree
 * with a payload nothing sends.
 */
import { describe, it, expect } from 'vitest'
import {
  entryContextFor, targetReachedFrom, recommendationFrom,
  contextAppliesTo, ladderAgainst, daysSinceIso,
} from '../entry-context'
import { buildTargetHitCard } from '../../signals/builders/legacy-kinds'
import { selectionFor } from '../../desktop-ideas/selection'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

/** The screenshot case: AAPL through its Bull case, marked from the book. */
const AAPL = {
  assetId: 'a-aapl',
  symbol: 'AAPL',
  companyName: 'Apple Inc.',
  price: 272.95,
  target: 230,
  overshootPct: (272.95 - 230) / 230,
  caseName: 'Bull',
  cases: [
    { id: 'c-bear', name: 'Bear', price: 150 },
    { id: 'c-base', name: 'Base', price: 195 },
    { id: 'c-bull', name: 'Bull', price: 230 },
  ],
  conviction: 'high',
  heldIn: ['Vision Fund', 'Large Cap Growth'],
  heldInIds: ['p-vision', 'p-lcg'],
  statedAt: '2026-03-04T00:00:00.000Z',
  asOf: '2026-11-07T00:00:00.000Z',
}

/** The entry as the feed assembles it, row and all. */
function targetEntry(row: typeof AAPL = AAPL): AttentionEntry {
  const built = buildTargetHitCard(row as never)
  if (!built.ok || !built.card) throw new Error('fixture does not build a card')
  return {
    key: built.card.id,
    card: built.card,
    item: null,
    input: null,
    family: 'target_hit',
    source: row as never,
  }
}

const ORG = 'org-a'

describe('a target-reached card', () => {
  it('opens a target review, with the numbers the card was built from', () => {
    const entry = targetEntry()
    const context = entryContextFor({
      selection: selectionFor(entry), row: entry.source, organizationId: ORG,
    })

    expect(context?.intent).toBe('target_review')
    expect(context?.assetId).toBe('a-aapl')
    expect(context?.symbol).toBe('AAPL')
    const event = context?.event
    expect(event?.kind).toBe('target_reached')
    if (event?.kind !== 'target_reached') throw new Error('not a target event')
    expect(event.targetPrice).toBe(230)
    expect(event.observedPrice).toBe(272.95)
    /* The mark, named. The workspace draws a `price_history` close in its own
       header, and the two numbers are different measurements. */
    expect(event.observedBasis).toBe('holdings_mark')
    expect(event.caseName).toBe('Bull')
    expect(event.statedAt).toBe('2026-03-04T00:00:00.000Z')
    expect(event.asOf).toBe('2026-11-07T00:00:00.000Z')
    expect(event.ladder.map(r => r.name)).toEqual(['Bear', 'Base', 'Bull'])
    expect(event.heldIn).toEqual([
      { name: 'Vision Fund', id: 'p-vision' },
      { name: 'Large Cap Growth', id: 'p-lcg' },
    ])
  })

  it('carries the words the card already used, and composes none of its own', () => {
    const entry = targetEntry()
    const context = entryContextFor({
      selection: selectionFor(entry), row: entry.source, organizationId: ORG,
    })
    expect(context?.why?.headline).toBe(entry.card.headline)
    expect(context?.sourceItem?.family).toBe('target_hit')
    expect(context?.sourceItem?.cardId).toBe(entry.key)
  })

  it('falls back to the general workspace when the row did not survive', () => {
    /* The feed used to add every breach with `source: null`. A context that
       declared a target review on that would promise an orientation with no
       target in it. */
    const entry = { ...targetEntry(), source: null }
    const context = entryContextFor({
      selection: selectionFor(entry), row: entry.source, organizationId: ORG,
    })
    expect(context?.intent).toBe('general')
    expect(context?.event).toBeNull()
  })

  it('refuses a row whose numbers are not numbers', () => {
    expect(targetReachedFrom({ target: 0, price: 10, overshootPct: 1 })).toBeNull()
    expect(targetReachedFrom({ target: 10, price: null, overshootPct: 1 })).toBeNull()
    expect(targetReachedFrom({ target: 10, price: 12, overshootPct: 'lots' })).toBeNull()
    expect(targetReachedFrom(null)).toBeNull()
  })

  it('drops a ladder rung with no price rather than drawing it at zero', () => {
    const event = targetReachedFrom({
      ...AAPL,
      cases: [{ id: 'c-1', name: 'Bear', price: 150 }, { id: 'c-2', name: 'Blue sky' }],
    })
    expect(event?.ladder.map(r => r.name)).toEqual(['Bear'])
  })

  it('does not display a stamp that does not parse', () => {
    const event = targetReachedFrom({ ...AAPL, statedAt: 'whenever', asOf: '' })
    expect(event?.statedAt).toBeNull()
    expect(event?.asOf).toBeNull()
  })

  it('says which rungs the mark has passed and which are still ahead', () => {
    const event = targetReachedFrom(AAPL)!
    const { passed, ahead } = ladderAgainst(event)
    expect(passed.map(r => r.name)).toEqual(['Bear', 'Base', 'Bull'])
    expect(ahead).toEqual([])

    const below = targetReachedFrom({ ...AAPL, price: 200 })!
    expect(ladderAgainst(below).passed.map(r => r.name)).toEqual(['Bear', 'Base'])
    expect(ladderAgainst(below).ahead.map(r => r.name)).toEqual(['Bull'])
  })
})

describe('a pending recommendation', () => {
  const ROW = {
    id: 'tq-1',
    action: 'add',
    proposedWeightPct: 4.5,
    currentWeightPct: 2.1,
    currentWeightAsOf: '2026-11-07T00:00:00.000Z',
    rationale: 'Services mix is carrying the multiple.',
    recommendedBy: 'A. Analyst',
    createdAt: '2026-11-10T00:00:00.000Z',
  }

  it('opens decision preparation with the proposal itself', () => {
    const context = entryContextFor({
      selection: {
        family: 'recommendation', key: 'rec:1', assetId: 'a-aapl', symbol: 'AAPL',
        portfolioId: 'p-vision', portfolioName: 'Vision Fund',
        why: { headline: 'A. Analyst proposes adding AAPL', reason: null },
      },
      row: ROW,
      organizationId: ORG,
    })
    expect(context?.intent).toBe('decision')
    const event = context?.event
    if (event?.kind !== 'recommendation') throw new Error('not a recommendation event')
    expect(event.action).toBe('add')
    expect(event.proposedWeightPct).toBe(4.5)
    expect(event.currentWeightPct).toBe(2.1)
    expect(event.rationale).toContain('Services mix')
    expect(context?.portfolioName).toBe('Vision Fund')
  })

  it('keeps "the book holds none" distinct from "nobody looked"', () => {
    expect(recommendationFrom({ ...ROW, currentWeightPct: 0 })?.currentWeightPct).toBe(0)
    expect(recommendationFrom({ ...ROW, currentWeightPct: null })?.currentWeightPct).toBeNull()
  })

  it('is nothing at all without an action or a reason', () => {
    expect(recommendationFrom({ id: 'tq-1' })).toBeNull()
  })
})

describe('an entry that named a process run', () => {
  it('is work, without any producer row', () => {
    const context = entryContextFor({
      selection: { family: 'post', key: 'p-1', assetId: 'a-aapl', symbol: 'AAPL' },
      organizationId: ORG,
      workflow: { workflowId: 'wf-1', stageId: 's-2', requirementId: 'ci-3' },
    })
    expect(context?.intent).toBe('work')
    expect(context?.workflow).toEqual({ workflowId: 'wf-1', stageId: 's-2', requirementId: 'ci-3' })
  })

  it('is general when the run id is blank', () => {
    const context = entryContextFor({
      selection: { family: 'post', key: 'p-1', assetId: 'a-aapl' },
      organizationId: ORG,
      workflow: { workflowId: '  ' },
    })
    expect(context?.intent).toBe('general')
    expect(context?.workflow).toBeNull()
  })
})

describe('an item with no asset behind it', () => {
  it('builds no context at all', () => {
    expect(entryContextFor({
      selection: { family: 'crowding', key: 'c-1', assetId: null },
      organizationId: ORG,
    })).toBeNull()
  })
})

describe('stale context', () => {
  const entry = targetEntry()
  const context = entryContextFor({
    selection: selectionFor(entry), row: entry.source, organizationId: ORG,
  })!

  it('applies to the name and organisation it was built for', () => {
    expect(contextAppliesTo(context, { assetId: 'a-aapl', organizationId: ORG })).toBe(true)
  })

  it('does not apply to a different name', () => {
    /* The reader opens MSFT while AAPL's context is still in props. Leading
       MSFT with AAPL's target event would be a fabricated event. */
    expect(contextAppliesTo(context, { assetId: 'a-msft', organizationId: ORG })).toBe(false)
  })

  it('does not apply after an organisation switch', () => {
    expect(contextAppliesTo(context, { assetId: 'a-aapl', organizationId: 'org-b' })).toBe(false)
  })

  it('does not apply while either organisation is unknown', () => {
    expect(contextAppliesTo(context, { assetId: 'a-aapl', organizationId: null })).toBe(false)
    expect(contextAppliesTo(
      { ...context, organizationId: null }, { assetId: 'a-aapl', organizationId: ORG },
    )).toBe(false)
  })
})

describe('the age of a reading', () => {
  it('counts whole days, and nothing at all from an absent stamp', () => {
    const now = new Date('2026-11-12T12:00:00.000Z').getTime()
    expect(daysSinceIso('2026-11-07T00:00:00.000Z', now)).toBe(5)
    expect(daysSinceIso(null, now)).toBeNull()
    expect(daysSinceIso('not a date', now)).toBeNull()
  })
})
