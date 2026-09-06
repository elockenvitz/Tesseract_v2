import { describe, expect, it } from 'vitest'

import { CATEGORY_KINDS, FEED_CATEGORIES, categoryOf } from '../feed-categories'
import { CONTENT_REGISTRY, categoryForType } from '../../signals/content-registry'
import {
  FRAMEWORK_BREAK, MATERIAL_NO_THESIS, portfolioIssueFromFilterKey,
} from '../../signals/portfolio-issues'
import type { SignalType } from '../../signals/contract'

/**
 * Portfolio's subject matter, after the ontology correction.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Portfolio held two REFRAMES — a scenario finding and a research finding that
 * become capital issues once a position is behind them — while six families
 * whose triggers are book facts sat under Decisions. So the lens read as
 * Research with a percentage attached, which is exactly what it was.
 *
 * Three of those six move here. They are not reframes: their triggers cannot
 * be evaluated without a portfolio at all.
 *
 *   active_risk   weight − benchmark weight, for one asset in one book
 *   crowding      one name across several books, and the spread between them
 *   no_target     a position over 2% of a measurable book, never priced
 *
 * `recommendation` and the two conviction families deliberately stay put — see
 * the Stage 3L audit. The first reads its current weight from a non-canonical
 * table; the second rests on `analyst_ratings`, which carries a conviction for
 * about one asset per organisation.
 */

/** The two ways a card can be Portfolio. */
const BOOK_NATIVE: SignalType[] = ['active_risk', 'crowding', 'no_target']
const REFRAMED = [FRAMEWORK_BREAK, MATERIAL_NO_THESIS]

describe('the three book-derived families now declare Portfolio', () => {
  it.each(BOOK_NATIVE)('%s', type => {
    expect(categoryForType(type)).toBe('portfolio')
  })

  it('resolves them through the feed, whatever hook produced the entry', () => {
    // `active_risk` arrives as a `template`, the other two as `lens`. The
    // declared category has to beat the entry kind or the same card lands in
    // two places depending on where it came from.
    expect(categoryOf({ kind: 'template', card: { type: 'active_risk' } })).toBe('portfolio')
    expect(categoryOf({ kind: 'lens', card: { type: 'crowding' } })).toBe('portfolio')
    expect(categoryOf({ kind: 'lens', card: { type: 'no_target' } })).toBe('portfolio')
  })

  it('takes them out of Decisions', () => {
    for (const type of BOOK_NATIVE) {
      expect(categoryForType(type)).not.toBe('decisions')
      expect(categoryOf({ kind: 'lens', card: { type } })).not.toBe('decisions')
    }
  })
})

describe('what deliberately did not move', () => {
  it('leaves recommendation under Decisions', () => {
    /**
     * The concept belongs here — proposed weight against current weight is a
     * capital question — but `useRecommendationCards` reads its current weight
     * from `portfolio_holdings_positions`, whose stored `weight_pct` is
     * non-canonical and sparsely populated. Moving the lens before the number
     * would put an untrustworthy percentage in a lens defined by percentages.
     */
    expect(categoryForType('recommendation')).toBe('decisions')
  })

  it('leaves both conviction families under Decisions', () => {
    // `analyst_ratings` carries a conviction for roughly one asset per org, so
    // the cohort fallback is the only path that ever runs. A lens is not the
    // place to assert a relationship the data cannot support.
    expect(categoryForType('conviction_oversized')).toBe('decisions')
    expect(categoryForType('conviction_undersized')).toBe('decisions')
  })

  it('leaves the written-commitment families under Decisions', () => {
    // A target that was hit or has expired is a decision somebody wrote coming
    // due. It is about the commitment, not about the capital behind it.
    expect(categoryForType('target_hit')).toBe('decisions')
    expect(categoryForType('target_expired')).toBe('decisions')
    // And an unheld scenario gap: a price outside a range on a name nobody
    // owns is an observation, not an allocation.
    expect(categoryForType('scenario_gap')).toBe('decisions')
  })

  it('leaves Research, Ideas, Workflow and News untouched', () => {
    expect(categoryForType('no_research')).toBe('research')
    expect(categoryForType('research_stale')).toBe('research')
    expect(categoryForType('trade_idea')).toBe('ideas')
    expect(categoryForType('awaiting_review')).toBe('workflow')
    expect(categoryForType('unusual_move')).toBe('news')
  })
})

describe('the reframes still reach Portfolio, by the other route', () => {
  it('classifies a stamped card from either the entry or the card', () => {
    for (const issueType of REFRAMED) {
      expect(categoryOf({ kind: 'insight', capital: { issueType } })).toBe('portfolio')
      expect(categoryOf({ kind: 'scenario', card: { type: 'scenario_gap', capital: { issueType } } }))
        .toBe('portfolio')
    }
  })

  it('keeps the unstamped versions where they were', () => {
    // The whole point of the stamp: held and unheld are the same type and two
    // findings, and reclassifying the type would have moved both.
    expect(categoryOf({ kind: 'scenario', card: { type: 'scenario_gap' } })).toBe('decisions')
    expect(categoryOf({ kind: 'insight' })).toBe('research')
  })
})

describe('Curate reaches all five, and only the right ones', () => {
  /** The signal-type predicate, as `matchesFilter` applies it. */
  const matches = (entry: any, selected: string[]) => {
    const issues = selected.map(portfolioIssueFromFilterKey).filter((i): i is string => i != null)
    const types = selected.filter(k => !portfolioIssueFromFilterKey(k))
    const capitalIssue = (entry?.capital ?? entry?.card?.capital)?.issueType
    const issueHit = !!capitalIssue && issues.includes(capitalIssue)
    const typeHit = types.includes(entry?.card?.type) && !capitalIssue
    return issueHit || typeHit
  }

  it('reaches each book-native family by its own type row', () => {
    for (const type of BOOK_NATIVE) {
      expect(matches({ kind: 'lens', card: { type } }, [type])).toBe(true)
      // And is not swept up by the capital-issue rows, which are not types.
      expect(matches({ kind: 'lens', card: { type } }, ['portfolio:framework_break'])).toBe(false)
    }
  })

  it('reaches each reframe by its capital row', () => {
    const fb = { kind: 'scenario', card: { type: 'scenario_gap', capital: { issueType: FRAMEWORK_BREAK } } }
    const mn = { kind: 'insight', capital: { issueType: MATERIAL_NO_THESIS } }
    expect(matches(fb, ['portfolio:framework_break'])).toBe(true)
    expect(matches(mn, ['portfolio:material_no_thesis'])).toBe(true)
    // Selecting the underlying type must not reach the stamped card.
    expect(matches(fb, ['scenario_gap'])).toBe(false)
  })

  it('is stable whether or not the card has been built yet', () => {
    /**
     * Category is read during filtering — before `renderCard` — and again on
     * the built card. If those disagreed, a card would be filtered into a lens
     * and then render in another, which is the class of bug Stage 3K fixed.
     */
    const beforeBuild = { kind: 'insight', capital: { issueType: MATERIAL_NO_THESIS } }
    const afterBuild = {
      kind: 'insight',
      capital: { issueType: MATERIAL_NO_THESIS },
      card: { type: 'no_research', capital: { issueType: MATERIAL_NO_THESIS } },
    }
    expect(categoryOf(beforeBuild)).toBe(categoryOf(afterBuild))

    // The book-native families have no stamp and no pre-build entry field; the
    // card is what carries their type, and it says the same thing every time.
    for (const type of BOOK_NATIVE) {
      expect(categoryOf({ kind: 'lens', card: { type } }))
        .toBe(categoryOf({ kind: 'template', card: { type } }))
    }
  })

  it('survives a cycle, because nothing about it is per-round', () => {
    // The pipeline re-presents the same objects on later cycles. Category is a
    // pure function of the entry, so round N classifies as round 0 did.
    const entry = (round: number) => ({
      kind: 'insight', round, capital: { issueType: MATERIAL_NO_THESIS },
    })
    expect([0, 1, 2].map(r => categoryOf(entry(r)))).toEqual(['portfolio', 'portfolio', 'portfolio'])
  })
})

describe('the taxonomy stayed coherent', () => {
  it('names every Portfolio route in CATEGORY_KINDS', () => {
    // A category whose sources are undocumented is one nobody can reason about
    // — and this one now has two routes in, which is worth saying out loud.
    const kinds = CATEGORY_KINDS.portfolio.join(' ')
    expect(kinds).toContain('active_risk')
    expect(kinds).toContain('crowding')
    expect(kinds).toContain('no_target')
    expect(kinds).toContain('framework break')
    expect(kinds).toContain('material position')
  })

  it('leaves every category with something behind it', () => {
    for (const { key } of FEED_CATEGORIES) {
      expect(CATEGORY_KINDS[key].length, `${key} has no sources`).toBeGreaterThan(0)
    }
  })

  it('keeps Decisions non-empty after the move', () => {
    // If the move had emptied Decisions it would be evidence the split was
    // wrong. Six families remain, all about a written commitment.
    const remaining = (Object.keys(CONTENT_REGISTRY) as SignalType[])
      .filter(t => CONTENT_REGISTRY[t].canonicalCategory === 'decisions')
    expect(remaining).toEqual([
      'scenario_gap', 'target_hit', 'target_expired', 'recommendation',
      'conviction_undersized', 'conviction_oversized',
    ])
  })

  it('puts exactly the three book-derived families in Portfolio', () => {
    const portfolio = (Object.keys(CONTENT_REGISTRY) as SignalType[])
      .filter(t => CONTENT_REGISTRY[t].canonicalCategory === 'portfolio')
    expect(portfolio.sort()).toEqual([...BOOK_NATIVE].sort())
  })
})
