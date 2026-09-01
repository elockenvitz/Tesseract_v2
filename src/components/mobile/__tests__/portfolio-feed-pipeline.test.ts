import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { categoryOf } from '../../../lib/mobile/feed-categories'
import {
  MATERIAL_NO_THESIS, materialCapitalFor, portfolioIssueFromFilterKey,
  unwrittenPositionCapital,
} from '../../../lib/signals/portfolio-issues'
import { buildInsightCard } from '../../../lib/signals/builders/legacy-kinds'
import {
  caseCoverageFrom, researchCopy, researchIssueFor, researchSignalTypeFor, reviewClocks,
} from '../../../lib/research/case-state'
import { currentBook, type HoldingRow } from '../../../lib/holdings/portfolio-context'

/**
 * The feed classifies ENTRIES, and an insight entry has no card.
 *
 * ── The bug this pins ─────────────────────────────────────────────────────
 *
 * `buildInsightCard` stamped `capital` correctly and `categoryOf` read it
 * correctly, and a material unwritten position still never appeared under
 * Portfolio — because everything between them runs on the pipeline's ENTRY
 * objects, and an insight entry is `{ kind, score, insight, round }`. It has no
 * `.card` at all: the card is built inside `renderCard`, long after the
 * category filter and the signal-type filter have both run. So `categoryOf`
 * fell through to `switch (entry.kind)`, hit `case 'insight'`, and returned
 * Research for a card that was stamped Portfolio.
 *
 * A scenario entry carries `card` because `useScenarioCards` pre-builds it,
 * which is why Framework break worked and this did not — one Portfolio card
 * visible, and the second silently reclassified.
 *
 * Every unit test passed throughout, because each tested one end of a pipeline
 * that was broken in the middle. These assert the SHAPES the pipeline actually
 * passes around.
 */

const NOW = Date.parse('2026-09-01T00:00:00.000Z')

const holding = (portfolioId: string, assetId: string, shares: number): HoldingRow => ({
  portfolio_id: portfolioId, asset_id: assetId, shares, price: 10, date: '2026-08-01',
  portfolios: { id: portfolioId, name: 'Large Cap Core' },
  assets: { symbol: assetId.toUpperCase(), asset_type: 'equity' },
})

const bookWith = (assetId: string, shares: number) =>
  currentBook([
    ...Array.from({ length: 4 }, (_, i) => holding('p1', `pad${i}`, 100)),
    holding('p1', assetId, shares),
  ])

function insight(symbol: string, assetId: string, written: string[]) {
  const coverage = caseCoverageFrom(
    written.map(section => ({
      section, hasContent: true, updated_at: '2026-02-01T00:00:00.000Z',
    })) as never,
  )
  const clocks = reviewClocks(coverage, null)
  const issue = researchIssueFor({ clocks, coverage, evidence: [], movePct: null, now: NOW })!
  const copy = researchCopy({
    symbol, issue, portfolioName: 'Large Cap Core', weightPct: null, held: true,
  })
  return {
    id: `i-${assetId}`,
    kind: researchSignalTypeFor(issue.framing) === 'no_research' ? 'no_thesis' : 'stale_research',
    headline: copy.headline, body: copy.body, prompt: copy.prompt,
    assetId, symbol, companyName: symbol,
    portfolioName: 'Large Cap Core', portfolioId: 'p1', weightPct: null,
    held: true, portfolioCount: 1, liveIdeas: [], coverageOwners: [],
    evidenceCount: 0, issue,
    caseWrittenAt: clocks.caseWrittenAt, researchReviewAt: null,
    reviewAnchor: clocks.effectiveAnchor, anchoredOn: clocks.anchoredOn,
    daysSinceReview: issue.daysSinceReview, daysSinceWritten: issue.daysSinceWritten,
    score: 1,
  } as never
}

/** The entry the pipeline builds for a derived insight, field for field. */
function insightEntry(ins: never, book: ReturnType<typeof currentBook>) {
  const i = ins as unknown as { assetId: string; issue: { framing: string } }
  return {
    kind: 'insight' as const,
    score: 1,
    insight: ins,
    round: 0,
    capital: unwrittenPositionCapital(book, i.assetId, i.issue.framing),
  }
}

/** The category-filter predicate, as `matchesFilter` applies it. */
const inCategory = (entry: unknown, category: string) =>
  categoryOf(entry as never) === category

/** The signal-type predicate, as `matchesFilter` applies it. */
function matchesSignalType(entry: any, selected: string[]): boolean {
  const issues = selected.map(portfolioIssueFromFilterKey).filter((i): i is string => i != null)
  const types = selected.filter(k => !portfolioIssueFromFilterKey(k))
  const capitalIssue = (entry?.capital ?? entry?.card?.capital)?.issueType
  const issueHit = !!capitalIssue && issues.includes(capitalIssue)
  const typeHit = types.includes(entry?.card?.type) && !capitalIssue
  return issueHit || typeHit
}

describe('a material unwritten position survives the pipeline', () => {
  const book = bookWith('jnj', 250)
  const ins = insight('JNJ', 'jnj', [])
  const entry = insightEntry(ins, book)

  it('carries the stamp on the ENTRY, before any card exists', () => {
    // The whole bug in one assertion: the object the filters see has to know.
    expect(entry.capital?.issueType).toBe(MATERIAL_NO_THESIS)
    expect((entry as { card?: unknown }).card).toBeUndefined()
  })

  it('classifies as Portfolio from the entry alone', () => {
    expect(inCategory(entry, 'portfolio')).toBe(true)
    expect(inCategory(entry, 'research')).toBe(false)
  })

  it('is reachable from the Portfolio filter row', () => {
    expect(matchesSignalType(entry, ['portfolio:material_no_thesis'])).toBe(true)
    expect(matchesSignalType(entry, ['portfolio:framework_break'])).toBe(false)
  })

  it('agrees with the card the renderer eventually builds', () => {
    /**
     * The entry and the card must reach the same answer or the reader sees a
     * card in a category it does not belong to. One function decides both.
     */
    const built = buildInsightCard(
      ins, unwrittenPositionCapital(book, 'jnj', 'no_case'),
    )
    expect(built.ok).toBe(true)
    if (!built.ok) return
    expect(built.card.capital?.issueType).toBe(entry.capital?.issueType)
    expect(built.card.capital?.portfolioId).toBe(entry.capital?.portfolioId)
    expect(categoryOf({ kind: 'insight', card: built.card })).toBe('portfolio')
  })
})

describe('the entries that must stay in Research', () => {
  it('keeps an immaterial unwritten position out of Portfolio', () => {
    const entry = insightEntry(insight('SNAP', 'snap', []), bookWith('snap', 4))
    expect(entry.capital).toBeNull()
    expect(inCategory(entry, 'research')).toBe(true)
    expect(matchesSignalType(entry, ['portfolio:material_no_thesis'])).toBe(false)
  })

  it('keeps a material position with a written view out of Portfolio', () => {
    const entry = insightEntry(
      insight('MSFT', 'msft', ['thesis', 'where_different', 'risks_to_thesis']),
      bookWith('msft', 250),
    )
    expect(entry.capital).toBeNull()
    expect(inCategory(entry, 'research')).toBe(true)
  })

  it('keeps a material PARTIAL view out of Portfolio', () => {
    const entry = insightEntry(insight('NKE', 'nke', ['thesis']), bookWith('nke', 250))
    expect(entry.capital).toBeNull()
    expect(inCategory(entry, 'research')).toBe(true)
  })

  it('never stamps a name the book does not hold', () => {
    const entry = insightEntry(insight('TSLA', 'tsla', []), bookWith('other', 250))
    expect(entry.capital).toBeNull()
    expect(inCategory(entry, 'research')).toBe(true)
  })
})

describe('one gate, so the entry and the card cannot drift', () => {
  it('applies the framing test in the shared function, not per call site', () => {
    // Each end used to apply its own half: the builder knew the framing and the
    // feed knew the weight, and the filter could apply neither.
    const book = bookWith('jnj', 250)
    expect(unwrittenPositionCapital(book, 'jnj', 'no_case')?.issueType)
      .toBe(MATERIAL_NO_THESIS)
    expect(unwrittenPositionCapital(book, 'jnj', 'incomplete_case')).toBeNull()
    expect(unwrittenPositionCapital(book, 'jnj', 'long_silence')).toBeNull()
    // And the raw derivation is still framing-blind, which is why the gate has
    // to live somewhere shared rather than in whoever calls it.
    expect(materialCapitalFor(book, 'jnj')).not.toBeNull()
  })

  it('is what both the entry and the builder are given', () => {
    const src = readFileSync(resolve(__dirname, '../MobileDashboard.tsx'), 'utf8')
    expect(src.match(/unwrittenPositionCapital\(/g) ?? []).toHaveLength(2)
    // The framing-blind derivation is no longer called directly from the feed.
    expect(src).not.toContain('materialCapitalFor(')
  })
})

describe('every entry kind the classifier can be handed', () => {
  it('reads the stamp from the entry or from the card, whichever exists', () => {
    /**
     * Scenario and lens entries build their card at different times — a
     * scenario card is pre-built and carried on the entry, an insight card is
     * not. The classifier has to work for both or one family is silently
     * misfiled, which is exactly what happened.
     */
    const stamp = { issueType: MATERIAL_NO_THESIS }
    expect(categoryOf({ kind: 'insight', capital: stamp })).toBe('portfolio')
    expect(categoryOf({ kind: 'scenario', card: { type: 'scenario_gap', capital: stamp } }))
      .toBe('portfolio')
    // And with neither, the existing taxonomy is untouched.
    expect(categoryOf({ kind: 'insight' })).toBe('research')
    expect(categoryOf({ kind: 'scenario', card: { type: 'scenario_gap' } })).toBe('decisions')
    expect(categoryOf({ kind: 'idea' })).toBe('ideas')
    expect(categoryOf({ kind: 'news' })).toBe('news')
  })
})
