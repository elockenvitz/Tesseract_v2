/**
 * The adoption seam returns one shape, on every path, always.
 *
 * ── The P0 this pins ──────────────────────────────────────────────────────
 *
 * `MobileDashboard`'s `adoptTile` was typed `any` and returned two shapes. The
 * success path returned `{ card, visual, adopted }`. Two early returns — a
 * falsy card, and the comparison flag being off for a family still behind it —
 * returned the bare card.
 *
 * Every call site reads `.card`. On a bare card that property does not exist,
 * so the scenario branch called the renderer with `undefined` and its first
 * line, `card.entity`, took the whole Ideas feed down:
 *
 *     undefined is not an object (evaluating 'card.entity')
 *       renderScenarioCard  MobileDashboard.tsx
 *       FeedSlot            FeedSlot.tsx
 *
 * ── Why this file drives the helpers rather than the component ────────────
 *
 * Because the defect was never in the renderer. The renderer was handed a hole
 * and did the only thing it could with it. What was missing was a seam with one
 * declared shape, so that is what is asserted: every branch, through the real
 * exported constructors, consumed exactly as the renderer consumes it.
 *
 * A source-text assertion would not have caught this and does not appear here.
 * `consumeLikeRenderer` reads the two properties the crashing line reads, so a
 * seam that returns the wrong shape fails this file with the production error.
 */

import { describe, expect, it } from 'vitest'

import {
  adoptCoverageGap, adoptResearchInsight, adoptScenarioGap, adoptTargetHit,
  adoptWorkOverdue, adoptedTile, declinedTile,
  type AdoptedTile, type MobileAdoptionResult,
} from '../mobile'
import { buildAttentionCard } from '../../../signals/builders/legacy-kinds'
import type { SignalCard } from '../../../signals/contract'
import {
  COVERAGE_ASSET, COVERAGE_NOW, PHONE, atExpectedCard, coverageCard, coverageRow,
  dislocationCard, staleCard, staleInsight, targetBreachRow, targetHitCard,
} from './fixtures'

const READER = { readerId: 'u-analyst', coverage: 'direct' as const }
const NOW = Date.parse('2026-09-08T00:00:00.000Z')

/**
 * `renderScenarioCard`'s own first lines, and nothing else.
 *
 * The crash was `card.entity` on line one and `card.evidence.data.price` on
 * line three. Anything that survives both has survived the failure.
 */
function consumeLikeRenderer(tile: AdoptedTile): { symbol: string; price: unknown } {
  const card = tile.card
  const symbol = String(card.entity?.ticker ?? card.entity?.name ?? '')
  const price = (card.evidence?.data as { price?: unknown } | undefined)?.price
  return { symbol, price }
}

/**
 * The seam, written exactly as `MobileDashboard` writes it.
 *
 * `engineOn` false with no flagless source is the branch that crashed: it took
 * the early return, and the early return is the one that used to hand back a
 * bare card.
 */
function seam(
  original: SignalCard,
  opts: { engineOn: boolean; flagless?: boolean; run?: () => MobileAdoptionResult },
): AdoptedTile {
  if (!opts.engineOn && !opts.flagless) return declinedTile(original)
  return adoptedTile(original, opts.run!())
}

const overdueRow = {
  attention_id: 'att-overdue-1',
  attention_type: 'action_required' as const,
  reason_code: 'task_overdue',
  title: 'Q3 model refresh',
  tags: ['overdue'],
  created_at: '2026-08-01T00:00:00.000Z',
  last_activity_at: '2026-08-20T00:00:00.000Z',
  due_at: '2026-08-25T00:00:00.000Z',
  severity: 'high',
  context: { asset_id: 'a-amzn' },
}

function overdueCard(): SignalCard {
  const r = buildAttentionCard(overdueRow as never, COVERAGE_ASSET)
  if (!r.ok) throw new Error('fixture suppressed')
  return r.card
}

// ─────────────────────────────────────────────────────────────────────────────
// The crash
// ─────────────────────────────────────────────────────────────────────────────

describe('the branch that crashed the feed', () => {
  /**
   * Flag off, scenario card, no flagless source — the exact QA configuration.
   *
   * This is the reproduction. With the old seam the early return handed back
   * the card itself, `.card` on it was `undefined`, and reading `entity` off
   * that is the reported error verbatim.
   */
  it('hands the renderer a usable card with the engine switched off', () => {
    const original = dislocationCard()
    const tile = seam(original, { engineOn: false })

    expect(tile.card).toBeDefined()
    expect(() => consumeLikeRenderer(tile)).not.toThrow()
    expect(consumeLikeRenderer(tile).symbol).toBe(original.entity.ticker)
  })

  /** And the item is production's own, not a substitute for it. */
  it('preserves the legacy card exactly when the engine does not run', () => {
    const original = dislocationCard()
    const tile = seam(original, { engineOn: false })
    expect(tile.card).toBe(original)
    expect(tile.visual).toBeNull()
    expect(tile.adopted).toBe(false)
  })

  /**
   * The same shape on both sides of the flag.
   *
   * The defect was a difference between branches, so the assertion is about the
   * branches agreeing rather than about either one in isolation.
   */
  it('returns the same shape whether the engine runs or not', () => {
    const original = dislocationCard()
    const off = seam(original, { engineOn: false })
    const on = seam(original, {
      engineOn: true,
      run: () => adoptScenarioGap(original, null, READER, PHONE),
    })
    expect(Object.keys(off).sort()).toEqual(Object.keys(on).sort())
    expect(() => consumeLikeRenderer(on)).not.toThrow()
  })

  /**
   * A decline is not a hole either.
   *
   * `at_expected` is the live case: a real card that states nothing needs
   * attention, which the engine refuses to make a situation of. The reader
   * still gets the card.
   */
  it('keeps the card when the adapter declines', () => {
    const original = atExpectedCard()
    const tile = seam(original, {
      engineOn: true,
      run: () => adoptScenarioGap(original, null, READER, PHONE),
    })
    expect(tile.adopted).toBe(false)
    expect(tile.card).toBe(original)
    expect(() => consumeLikeRenderer(tile)).not.toThrow()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Every adopted situation, both sides of the flag
// ─────────────────────────────────────────────────────────────────────────────

describe('no adopted situation can hand back a hole', () => {
  const CASES: {
    name: string
    original: () => SignalCard
    run: (o: SignalCard) => MobileAdoptionResult
    /** Coverage and Overdue render through the engine for every reader. */
    flagless?: boolean
    visual: string
  }[] = [
    {
      name: 'Case vs Price',
      original: dislocationCard,
      run: o => adoptScenarioGap(o, null, READER, PHONE),
      visual: 'scenario_range',
    },
    {
      name: 'Target Hit',
      original: targetHitCard,
      run: o => adoptTargetHit(targetBreachRow(), o, READER, PHONE),
      visual: 'target_compare',
    },
    {
      name: 'Unreviewed Move',
      original: () => staleCard('price_move'),
      run: o => adoptResearchInsight(staleInsight('price_move'), o, READER, PHONE),
      visual: 'last_look',
    },
    {
      name: 'Coverage Gap',
      original: coverageCard,
      run: o => adoptCoverageGap(coverageRow() as never, o, READER, PHONE, COVERAGE_NOW),
      flagless: true,
      visual: 'timeline',
    },
    {
      name: 'Overdue',
      original: overdueCard,
      run: o => adoptWorkOverdue(overdueRow as never, o, READER, PHONE, NOW),
      flagless: true,
      visual: 'timeline',
    },
  ]

  it.each(CASES)('$name renders with the engine on', ({ original, run, visual }) => {
    const o = original()
    const tile = seam(o, { engineOn: true, run: () => run(o) })
    expect(tile.card).toBeDefined()
    expect(tile.card.entity).toBeDefined()
    expect(tile.adopted).toBe(true)
    expect(tile.visual?.kind).toBe(visual)
  })

  /**
   * With the engine off, the flagless two still render through it.
   *
   * That asymmetry is the reason the early return existed at all, and it is
   * where the bug lived: three families take the early return and two do not.
   */
  it.each(CASES)('$name renders with the engine off', ({ original, run, flagless, visual }) => {
    const o = original()
    const tile = seam(o, { engineOn: false, flagless, run: () => run(o) })
    expect(tile.card).toBeDefined()
    expect(tile.card.entity).toBeDefined()
    expect(() => consumeLikeRenderer(tile)).not.toThrow()
    if (flagless) {
      expect(tile.adopted).toBe(true)
      expect(tile.visual?.kind).toBe(visual)
    } else {
      expect(tile.card).toBe(o)
      expect(tile.visual).toBeNull()
    }
  })

  /**
   * Nothing is lost on any path.
   *
   * The insight branch's version of this bug was not a crash: `.card` on a bare
   * card is `undefined`, the branch read it as "no card", and the Research tile
   * quietly stopped rendering. A feed that silently drops items is worse than
   * one that falls over, because nobody files it.
   */
  it.each(CASES)('$name keeps its identity through the seam', ({ original, run, flagless }) => {
    const o = original()
    for (const engineOn of [true, false]) {
      const tile = seam(o, { engineOn, flagless, run: () => run(o) })
      expect(tile.card.id, `${engineOn}`).toBe(o.id)
      expect(tile.card.dedupeKey, `${engineOn}`).toBe(o.dedupeKey)
    }
  })
})
