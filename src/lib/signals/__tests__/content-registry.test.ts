import { describe, expect, it } from 'vitest'

import {
  CONTENT_REGISTRY, capabilitiesFor, categoryForType, judgmentPresentationFor,
} from '../content-registry'
import { categoryOf, FEED_CATEGORIES } from '../../mobile/feed-categories'
import { signalTypeForTemplate } from '../builders/legacy-kinds'
import type { SignalType, Severity } from '../contract'

const card = (type: SignalType, severity: Severity = 'attention') => ({ type, severity })

describe('the registry describes every card type', () => {
  it('declares a category the filters actually offer', () => {
    // A category no filter renders is a card nobody can reach.
    const offered = new Set(FEED_CATEGORIES.map(c => c.key))
    for (const [type, caps] of Object.entries(CONTENT_REGISTRY)) {
      expect(offered.has(caps.canonicalCategory), `${type} -> ${caps.canonicalCategory}`).toBe(true)
    }
  })

  it('never offers a fullscreen chart to a card that is not about an asset', () => {
    // The expanded chart draws one symbol's tape. Offering it on a card with no
    // symbol is how a chart ends up showing something unrelated.
    for (const [type, caps] of Object.entries(CONTENT_REGISTRY)) {
      if (caps.fullscreenChart) expect(caps.assetLinked, type).toBe(true)
    }
  })
})

describe('active risk is a portfolio finding, not news and not a decision', () => {
  /**
   * The taxonomy defect, in the two places it could hide, plus its third home.
   *
   * Active risk is how far a position sits from its benchmark weight. It
   * arrives through the same hook as earnings and corporate actions, and the
   * feed resolved categories from that hook — so it rendered under News. That
   * was corrected to Decisions, which was better and still not derived from
   * what the number IS: `weight − benchmarkWeight` for one asset in one book,
   * where neither half exists without a portfolio and an index file. Portfolio
   * is the first home chosen from the finding rather than from its plumbing.
   */
  it('declares Portfolio', () => {
    expect(categoryForType('active_risk')).toBe('portfolio')
    expect(categoryForType('active_risk')).not.toBe('news')
    expect(categoryForType('active_risk')).not.toBe('decisions')
  })

  it('resolves to Portfolio through the feed, not to its source kind', () => {
    // The entry still says `template`. The card's declared type has to win.
    const entry = { kind: 'template', card: { type: 'active_risk' } }
    expect(categoryOf(entry)).toBe('portfolio')
  })

  it('leaves its genuinely news-shaped siblings under News', () => {
    // The fix must not drag the rest of the templates out with it.
    for (const kind of ['unusual_move', 'earnings_ahead', 'earnings_result', 'corporate_action', 'economic']) {
      const type = signalTypeForTemplate(kind)
      expect(categoryOf({ kind: 'template', card: { type } }), kind).toBe('news')
    }
  })

  it('routes the template exception through one function', () => {
    // `active_risk` is absent from TEMPLATE_TYPE by design. Every caller that
    // re-derives that exception is a place it can be forgotten, and one of
    // them did forget.
    expect(signalTypeForTemplate('active_risk')).toBe('active_risk')
    expect(signalTypeForTemplate('never_heard_of_it')).toBe('news')
  })
})

describe('the declared category is the only category', () => {
  it('overrides the entry kind wherever the two disagree', () => {
    // Both filter surfaces read `categoryOf`. If the entry kind could win,
    // Curate and Explore could disagree about where a card lives.
    expect(categoryOf({ kind: 'news', card: { type: 'active_risk' } })).toBe('portfolio')
    expect(categoryOf({ kind: 'lens', card: { type: 'news' } })).toBe('news')
  })

  it('still classifies entries that carry no built card', () => {
    // Lenses and attention rows reach the feed without a card. The kind-based
    // switch remains their answer rather than a null.
    expect(categoryOf({ kind: 'lens' })).toBe('decisions')
    expect(categoryOf({ kind: 'attention', attention: { source_type: 'trade_queue_item' } })).toBe('decisions')
    expect(categoryOf({ kind: 'attention', attention: { source_type: 'project' } })).toBe('workflow')
  })

  it('ignores a card type it has never heard of rather than crashing', () => {
    expect(categoryOf({ kind: 'news', card: { type: 'not_a_real_type' } })).toBe('news')
  })
})

describe('when a card asks its question', () => {
  it('defaults the routine findings to on-engage', () => {
    /**
     * The whole point of the phase. Every card describing an ABSENCE — no
     * thesis, no target, stale research, an overdue project — is worth reading
     * before it is worth answering. Asking immediately is what made scrolling
     * the feed feel like working through a form.
     */
    for (const t of ['no_target', 'no_research', 'active_risk', 'research_stale',
                     'project_overdue', 'crowding', 'conviction_oversized'] as SignalType[]) {
      expect(judgmentPresentationFor(card(t, 'critical')), t).toBe('on_engage')
    }
  })

  it('lets an unresolved decision event lead with its question', () => {
    // The exceptions: a breach, a target substantially exceeded, a
    // recommendation nobody has answered. The question IS the content.
    for (const t of ['scenario_gap', 'target_hit', 'target_expired', 'recommendation'] as SignalType[]) {
      expect(judgmentPresentationFor(card(t, 'critical')), t).toBe('inline')
    }
  })

  it('holds those same types back when the situation is not material', () => {
    /**
     * Severity resolves it, not type alone. A `scenario_gap` on a 0.3%
     * watchlist name is not a decision event; the same card on a 12% position
     * through its bear case is. The builders already encode that as severity,
     * so the registry declares eligibility and the card decides.
     */
    expect(judgmentPresentationFor(card('scenario_gap', 'attention'))).toBe('on_engage')
    expect(judgmentPresentationFor(card('target_hit', 'informational'))).toBe('on_engage')
  })

  it('stays silent for cards with nothing to ask', () => {
    // A CPI print is a report. Nothing in the feed composes a response to one,
    // and `none` is the only presentation that does not imply there is a
    // question waiting behind an affordance.
    expect(judgmentPresentationFor(card('economic_release', 'critical'))).toBe('none')
  })

  /**
   * `none` is stronger than it looks, which is why `team_focus` left it.
   *
   * `SignalCardView` filters the judgment pane out of the carousel for anything
   * that is not `inline`, and only renders the engagement affordance when the
   * presentation is `on_engage`. So a `none` card's judgment pane is not merely
   * hidden — it is unreachable, and any call site that builds one is writing
   * dead code.
   *
   * Both producers of `team_focus` build one. The mobile feed's ideas-signal
   * branch composes "Is the desk looking at the right thing?", and its attention
   * branch composes Done / In progress / Defer / Not mine for every
   * `informational` item — the only path that acknowledges those rows. Declaring
   * `none` discarded both before paint.
   */
  it('lets a team-focus card be answered, because two call sites build the answer', () => {
    expect(judgmentPresentationFor(card('team_focus', 'critical'))).toBe('on_engage')
    expect(judgmentPresentationFor(card('team_focus', 'informational'))).toBe('on_engage')
  })

  it('asks on engagement far more often than it asks immediately', () => {
    // A sanity check on the balance the phase is about: if this ever inverts,
    // the feed is a questionnaire again.
    const kinds = Object.keys(CONTENT_REGISTRY) as SignalType[]
    const inline = kinds.filter(t => judgmentPresentationFor(card(t, 'critical')) === 'inline')
    expect(inline.length).toBeLessThan(kinds.length / 4)
  })
})

describe('manipulation surfaces stay truthful', () => {
  it('gives target cards a target and sizing cards a weight', () => {
    // Action behaviour follows from this, so a wrong entry offers the reader
    // the wrong control.
    expect(capabilitiesFor('no_target').manipulationSurface).toBe('target')
    expect(capabilitiesFor('target_expired').manipulationSurface).toBe('target')
    expect(capabilitiesFor('scenario_gap').manipulationSurface).toBe('scenario')
    expect(capabilitiesFor('active_risk').manipulationSurface).toBe('position_size')
  })

  it('refuses to chart a pair trade', () => {
    // A pair is about the RELATIONSHIP between two names. Charting one leg
    // would quietly assert the trade was about that leg.
    expect(capabilitiesFor('pair_trade').assetLinked).toBe(false)
    expect(capabilitiesFor('pair_trade').fullscreenChart).toBe(false)
  })

  it('refuses to chart a macro release', () => {
    // The rule that stops "CPI came in hot" being illustrated with whatever
    // equity happened to be nearby.
    expect(capabilitiesFor('economic_release').assetLinked).toBe(false)
  })
})
