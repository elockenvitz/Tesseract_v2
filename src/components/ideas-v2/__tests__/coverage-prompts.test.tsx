/**
 * A thin Ideas field, filled from the reader's own coverage.
 *
 * Bogey Cap graduates with one genuine idea and five seeded demo rows. The
 * lens must fill the rest of the field with names they cover and have no idea
 * on -- suggesting only, creating nothing, and never suggesting work that
 * already exists.
 *
 * ── Why this suite moved down a layer ─────────────────────────────────────
 *
 * It used to render `IdeasWorkspace` and read `data-testid="idea-tile"`. That
 * grid is gone: desktop Ideas is now one field, the opportunity set, and
 * prompts reach it as `ExploreItem`s through `coverageExplorePrompts` rather
 * than as `IdeaRow`s through a second grid.
 *
 * Every rule below is the SAME rule, asserted where it now lives. That is not
 * a downgrade -- the old cases proved these properties through a full render,
 * eight mocked hooks and a ranking pass, any of which could mask a change in
 * the selection itself. Asked of the selector directly, each rule fails for
 * exactly one reason.
 *
 * ── One guarantee genuinely changed, and it is not hidden ─────────────────
 *
 * "Ranks every real idea above every prompt" is gone, deliberately. Prompts
 * are now one candidate type among several and are ranked ALONGSIDE the
 * others by `diversifyExplore`, which orders by interestingness rather than
 * by source. A held name nobody has looked at in a year can outrank a stale
 * authored idea, and that is the intended product. What has NOT changed is
 * that a prompt never displaces work that exists: the exclusion set below is
 * what enforces it, and it is asserted here.
 */
import { describe, it, expect } from 'vitest'
import type { CoverageResearchCandidate } from '../../../lib/research/coverage-research-gaps'
import type { ResearchFraming } from '../../../lib/research/case-state'
import {
  coverageExplorePrompts, coverageExplorePrompt,
  IDEAS_PROMPT_LIMIT, IDEAS_PROMPT_CAPS, IDEAS_FIELD_TARGET,
} from '../../../lib/desktop-ideas/coverage-prompts'
import { opportunityKind, OPPORTUNITY_LABEL } from '../../../lib/desktop-ideas/opportunity'
import { exploreVisualFor } from '../../../lib/mobile/explore-visual'

const DAY = 86_400_000
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString()

const BOOK = 'Tech & Consumer Growth'
const held = (weightPct: number) => ({
  held: true, weightPct, portfolioId: 'p1', portfolioName: BOOK, portfolioCount: 1,
})
const PRIORITY: Record<ResearchFraming, number> = {
  new_evidence: 1, price_move: 2, no_case: 3, incomplete_case: 4, long_silence: 5,
}

function candidate(
  symbol: string,
  framing: ResearchFraming = 'no_case',
  over: Partial<CoverageResearchCandidate> = {},
): CoverageResearchCandidate {
  const assetId = `a-${symbol.toLowerCase()}`
  const anchored = framing !== 'no_case'
  return {
    id: `coverage-research:${assetId}`, assetId, symbol, companyName: `${symbol} Inc`,
    coverage: 'own', framing, priority: PRIORITY[framing], score: 0.5,
    headline: 'x', body: 'x', prompt: 'Has the investment view changed?',
    facts: {
      missingSections: framing === 'incomplete_case'
        ? ['risks_to_thesis']
        : framing === 'no_case' ? ['thesis', 'where_different', 'risks_to_thesis'] : [],
      presentSections: framing === 'no_case' ? [] : ['thesis'],
      movePct: framing === 'price_move' ? -16.4 : null,
      evidenceSince: framing === 'new_evidence'
        ? [{ id: 'n1', at: daysAgo(2), authorId: null, title: 'Q3 read', kind: 'note' }] as never
        : [],
      evidenceCount: framing === 'new_evidence' ? 1 : 0,
      daysSinceReview: anchored ? 120 : null, daysSinceWritten: anchored ? 120 : null,
      anchoredOn: anchored ? 'written' : null,
      caseWrittenAt: anchored ? daysAgo(120) : null,
      reviewAnchor: anchored ? daysAgo(120) : null,
    },
    exposure: { held: false, weightPct: null, portfolioId: null, portfolioName: null, portfolioCount: 0 },
    liveIdeas: [],
    open: { assetId, symbol, companyName: null, focus: 'research', origin: 'coverage-research', issue: 'x' },
    insight: {} as never,
    ...over,
  }
}

/** Bogey Cap's coverage: three held names with nothing open, and a long tail. */
const bogeyCoverage = () => [
  candidate('TSLA', 'no_case', { exposure: held(3.2) }),
  candidate('SBUX', 'no_case', { exposure: held(2.3) }),
  candidate('MELI', 'no_case', { exposure: held(2.1) }),
  ...Array.from({ length: 46 }, (_, i) => candidate(`U${String(i).padStart(2, '0')}`)),
]

const NONE: ReadonlySet<string> = new Set()
const syms = (items: { symbol?: string | null }[]) => items.map(i => i.symbol)

describe('a thin field is topped up, and a full one is not', () => {
  it('fills the rest of the field, exposure first', () => {
    const out = coverageExplorePrompts(bogeyCoverage(), { realCount: 1, ideaAssetIds: NONE })
    // Held names by weight lead: how much rides on an unexamined position is
    // the argument for looking at it.
    expect(syms(out).slice(0, 3)).toEqual(['TSLA', 'SBUX', 'MELI'])
  })

  it('does not turn fifty candidates into fifty tiles', () => {
    const out = coverageExplorePrompts(bogeyCoverage(), { realCount: 1, ideaAssetIds: NONE })
    expect(out.length).toBeLessThanOrEqual(IDEAS_PROMPT_LIMIT)
    // And the structural cap holds within that: repetition is the failure mode.
    const bare = syms(out).filter(s => s?.startsWith('U'))
    expect(bare.length).toBeLessThanOrEqual(IDEAS_PROMPT_CAPS['no_case:unheld'])
  })

  it('shows no prompts once the field is full of real work', () => {
    // The thin-field rule, counting the population the field now holds.
    expect(coverageExplorePrompts(bogeyCoverage(), {
      realCount: IDEAS_FIELD_TARGET, ideaAssetIds: NONE,
    })).toEqual([])
  })

  it('admits prompts only for the room that is left', () => {
    /*
     * Non-vacuous companion to the two above: the limit must track the count,
     * not merely be some number. One short of a full field admits one prompt.
     */
    const out = coverageExplorePrompts(bogeyCoverage(), {
      realCount: IDEAS_FIELD_TARGET - 1, ideaAssetIds: NONE,
    })
    expect(out).toHaveLength(1)
  })
})

describe('a prompt never suggests work that exists', () => {
  it('excludes a name any idea already concerns, seeded ones included', () => {
    const candidates = [
      candidate('AMZN', 'price_move', { exposure: held(5.4) }),
      candidate('TSLA', 'no_case', { exposure: held(3.2) }),
    ]
    /*
     * AMZN carries a SEEDED idea -- hidden from the field after graduation,
     * but the work exists and suggesting it would be a lie. The caller passes
     * every scanned asset id, not only the visible ones, which is why the
     * exclusion set is built from `scanned` rather than `ideas`.
     */
    const out = coverageExplorePrompts(candidates, {
      realCount: 1, ideaAssetIds: new Set(['a-amzn']),
    })
    expect(syms(out)).toEqual(['TSLA'])
  })

  it('would have suggested it otherwise', () => {
    // The negative case, so the exclusion above cannot pass by accident.
    const candidates = [candidate('AMZN', 'price_move', { exposure: held(5.4) })]
    expect(syms(coverageExplorePrompts(candidates, { realCount: 1, ideaAssetIds: NONE })))
      .toEqual(['AMZN'])
  })
})

describe('a prompt is a suggestion, not an idea', () => {
  const tsla = () => coverageExplorePrompt(candidate('TSLA', 'no_case', { exposure: held(3.2) }))

  it('is labelled as coming from coverage, never as somebody’s idea', () => {
    const item = tsla()
    expect(opportunityKind(item)).toBe('coverage_gap')
    expect(OPPORTUNITY_LABEL[opportunityKind(item)]).toBe('From your coverage')
    // And it never wears the authored vocabulary.
    expect(OPPORTUNITY_LABEL[opportunityKind(item)]).not.toBe(OPPORTUNITY_LABEL.authored)
  })

  it('says why the name is worth thinking about, claiming no stance or stage', () => {
    const item = tsla()
    expect(item.title).toBe(
      'A 3.2% position in Tech & Consumer Growth with no active idea and no written thesis.')
    expect(item.state).toBe('Position without an idea')
    // No direction, no maturity, and no complaint about an object that does
    // not exist yet.
    const said = `${item.title} ${item.context ?? ''} ${item.state ?? ''}`
    expect(said).not.toMatch(/researching|thesis forming|\bbuy\b|no cases|no target|0d open/i)
  })

  it('emphasises the change where something changed', () => {
    expect(coverageExplorePrompt(candidate('NKE', 'new_evidence', { exposure: held(1.4) })).title)
      .toBe('NKE has new evidence since the case was written and no active idea, on a 1.4% position in Tech & Consumer Growth.')
    expect(coverageExplorePrompt(candidate('ORCL', 'price_move')).title)
      .toBe('ORCL has moved -16.4% since the case was written, with no active idea.')
  })

  it('opens capture on that asset rather than a pane for a row that does not exist', () => {
    const item = tsla()
    expect(item.destination).toEqual({
      kind: 'action', action: 'create_idea', assetId: 'a-tsla', symbol: 'TSLA',
    })
  })

  it('draws the exposure that is the argument, not the question, when it has one', () => {
    /*
     * The candidate carries its own prompt, and `question` is resolved LAST --
     * so a held name draws the weight that makes it matter, and only a name
     * with nothing else to show falls through to asking.
     */
    expect(exploreVisualFor(tsla() as never).kind).toBe('exposure')
    const bare = coverageExplorePrompt(candidate('U00', 'no_case'))
    expect(exploreVisualFor(bare as never)).toEqual({
      kind: 'question', text: 'Has the investment view changed?',
    })
  })
})
