/**
 * The glue between a feed ROW and the idea builder, which is where the two
 * shells drifted.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `headlineFor`'s `pair_trade` branch is careful: it says "Long MCD / Short
 * CMG", compresses a wide group to a count, and refuses to imply an
 * opposition a one-sided group does not contain. None of it ran on desktop.
 * `feedItemToIdeaInput` never read `long_legs` / `short_legs`, so every pair
 * card fell to the first line of that branch -- "Pair trade from Eric" -- and
 * everything below it was unreachable.
 *
 * `MobileDashboard` had already fixed this translation INLINE, with a note
 * saying the legs "resolved to undefined and the headline fell back to
 * 'proposed a pair trade' with both sides blank". The shared mapper, written
 * to be the one place that glue lives, never learned the field.
 *
 * ── Why the builder's own suite could not see it ─────────────────────────
 *
 * `builders/__tests__/ideas.test.ts` covers this branch in six cases, and
 * every one of them hands `longLegs` straight to `buildIdeaCard`. That is the
 * right way to test a headline and it cannot observe a mapper that never
 * supplies the field. The gap was never in the builder; it was in the twenty
 * lines in front of it, which nothing tested at all.
 *
 * So these cases drive the MAPPER, and the end-to-end ones drive it through
 * the real builder, because "the field is present" and "the card says the
 * right thing" are different claims and only the second one is the report.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { feedItemToIdeaInput, feedPairLegs, type FeedItemLike } from '../feed-item-input'
import { buildIdeaCard } from '../builders/ideas'
import type { CardResult, SignalCard } from '../contract'

const src = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

const card = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`expected a card, got: ${r.reason} (${r.detail})`)
  return r.card
}

beforeEach(() => localStorage.clear())

/** A pair row as `useIdeasFeed` emits it: the leg's symbol is nested. */
const pairRow = (over: Partial<FeedItemLike> = {}): FeedItemLike => ({
  id: 'p1',
  type: 'pair_trade',
  content: 'Franchise quality at a discount to the disruptor.',
  created_at: '2026-08-01T09:00:00.000Z',
  author: { full_name: 'Eric Lockenvitz' },
  asset: { id: 'a1', symbol: 'MCD', company_name: "McDonald's" },
  long_legs: [{ asset: { symbol: 'MCD' } }],
  short_legs: [{ asset: { symbol: 'CMG' } }],
  ...over,
})

describe('the legs survive the trip from row to builder', () => {
  it('reads the nested shape the feed actually emits', () => {
    expect(feedPairLegs([{ asset: { symbol: 'MCD' } }])).toEqual([{ symbol: 'MCD' }])
  })

  /* Production holds rows written by both shapes, so both are tolerated. A
     mapper that handled only one would blank half the legs. */
  it('reads a flat symbol too, and uppercases either', () => {
    expect(feedPairLegs([{ symbol: 'cmg' }])).toEqual([{ symbol: 'CMG' }])
    expect(feedPairLegs([{ asset: { symbol: 'mcd' } }])).toEqual([{ symbol: 'MCD' }])
  })

  /* A leg with no resolvable symbol is dropped rather than carried as an empty
     string, because `side()` would then print a blank where a ticker goes. */
  it('drops a leg with no symbol on either shape', () => {
    expect(feedPairLegs([{ asset: null }, { symbol: '' }, { asset: { symbol: 'GH' } }]))
      .toEqual([{ symbol: 'GH' }])
    expect(feedPairLegs(null)).toEqual([])
    expect(feedPairLegs(undefined)).toEqual([])
  })

  it('puts both sides on the builder input', () => {
    const input = feedItemToIdeaInput(pairRow())
    expect(input.longLegs).toEqual([{ symbol: 'MCD' }])
    expect(input.shortLegs).toEqual([{ symbol: 'CMG' }])
  })

  /* Every other type reaches the builder with empty sides, which is what it
     expects: it only reads these on the `pair_trade` branch. */
  it('leaves them empty for a post that has no legs', () => {
    const input = feedItemToIdeaInput({
      id: 't1', type: 'quick_thought', content: 'A view.',
      created_at: '2026-08-01T09:00:00.000Z',
    })
    expect(input.longLegs).toEqual([])
    expect(input.shortLegs).toEqual([])
  })
})

/**
 * The report, end to end. These are the cases that fail with the mapper's two
 * lines removed, and they are the ones worth reading: a reader does not care
 * that a field is populated, they care that the card names the trade.
 */
describe('a pair card names the trade, not the fact that it is one', () => {
  it('states both sides in words', () => {
    expect(card(buildIdeaCard(feedItemToIdeaInput(pairRow()))).headline)
      .toBe('Long MCD / Short CMG')
  })

  /* The sentence the defect produced, by name. Without it this case would
     pass on any headline containing the right tickers. */
  it('no longer falls back to naming the author and the kind', () => {
    const headline = card(buildIdeaCard(feedItemToIdeaInput(pairRow()))).headline
    expect(headline).not.toMatch(/Pair trade from/)
    expect(headline).not.toMatch(/Eric/)
  })

  /* The compression branch was unreachable too, so it is exercised through the
     mapper rather than only through a hand-built input. */
  it('compresses a wide side through the mapper as well', () => {
    const headline = card(buildIdeaCard(feedItemToIdeaInput(pairRow({
      long_legs: [
        { asset: { symbol: 'LLY' } }, { asset: { symbol: 'PFE' } },
        { asset: { symbol: 'MRK' } }, { asset: { symbol: 'ABBV' } },
      ],
      short_legs: [{ asset: { symbol: 'GH' } }],
    })))).headline
    expect(headline).toBe('Long LLY + PFE + 2 / Short GH')
  })

  /* A one-sided group is a half-built pair and must not imply an opposition
     the row does not contain. Also unreachable before. */
  it('says one side when only one side exists', () => {
    expect(card(buildIdeaCard(feedItemToIdeaInput(pairRow({ short_legs: [] })))).headline)
      .toBe('Long MCD')
    expect(card(buildIdeaCard(feedItemToIdeaInput(pairRow({ long_legs: [] })))).headline)
      .toBe('Short CMG')
  })

  /* And the fallback is still correct when the row genuinely has no legs --
     the mapper did not replace one wrong headline with another. */
  it('still names the kind when the row carries no legs at all', () => {
    const headline = card(buildIdeaCard(feedItemToIdeaInput(
      pairRow({ long_legs: [], short_legs: [] }),
    ))).headline
    expect(headline).toBe('Pair trade from Eric Lockenvitz')
  })
})

/**
 * One copy of the glue, which is the only durable fix.
 *
 * This module's own header says copying it is "exactly the failure this
 * convergence exists to prevent: the two shells would agree about the builder
 * and drift about what they fed it". They did, in this field. So the phone's
 * local reshaper is gone and both shells reach the same exported function.
 */
describe('neither shell keeps its own copy of the leg reshaper', () => {
  it('has the phone importing the shared one instead of defining one', () => {
    const mobile = src('components/mobile/MobileDashboard.tsx')
    expect(mobile).toContain("import { feedPairLegs } from '../../lib/signals/feed-item-input'")
    expect(mobile).toContain('const pairLegs = feedPairLegs')
    /*
     * The body of the local copy, by the expression only IT had: the
     * `String(...)` coercion feeding a two-field `{ symbol }`. Matched
     * narrowly on purpose -- `l?.asset?.symbol ?? l?.symbol` alone also
     * appears in `pairLegRows`, which builds a ten-field `PairLegRow` for the
     * Legs pane and is a different mapper that must stay.
     *
     * Comments are stripped first because the replacement names what it
     * replaced -- the guard-breaks-on-its-own-comment shape this repo has
     * paid for more than once.
     */
    const code = mobile.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    expect(code).not.toMatch(/String\(l\?\.asset\?\.symbol/)
    // The pane's own leg mapper is untouched, and this says so, so a later
    // reader does not mistake it for a second copy and delete it.
    expect(code).toMatch(/pairLegRows/)
  })

  it('has the desktop feed going through the shared mapper', () => {
    const desktop = src('hooks/useDesktopAttentionFeed.ts')
    expect(desktop).toContain('feedItemToIdeaInput(')
    // And not reaching past it to assemble its own input, which is how the
    // phone's fix failed to reach it in the first place.
    expect(desktop).not.toMatch(/longLegs:/)
  })
})
