import type { SignalType } from './contract'

/**
 * Which card types the visual harness actually renders, and which do not.
 *
 * ── The gap this makes visible ────────────────────────────────────────────
 *
 * `e2e/signal-cards.spec.ts` measures twenty gallery fixtures: it asserts each
 * one fits a phone, has the action slots it should and no more, scrolls in no
 * direction it must not, and never clips content beneath its own action bar.
 * That suite is the layout contract, and it is genuinely good — for the types
 * it reaches.
 *
 * It reaches thirteen of twenty-eight. The other fifteen have never been
 * measured at any width, and nothing said so: a new `SignalType` could be added
 * to the contract, wired into a builder, ranked, filtered and shipped without
 * one assertion about how it renders, and every gate in the repo would stay
 * green. `content-registry` already refuses that trick for CAPABILITY — its
 * test asserts every type appears in the registry exactly once, so a new type
 * cannot exist without somebody deciding what it is. This is the same guard for
 * PRESENTATION.
 *
 * ── Why an exemption is a string and not a boolean ────────────────────────
 *
 * A boolean invites `false` as a shrug. A sentence forces the author to say why
 * this type does not need a fixture, and makes the claim reviewable — several
 * of the reasons below are "it renders through a shape another fixture already
 * covers", which is a real argument, and one of them would not survive being
 * written down if it were not true.
 *
 * ── What this file is NOT ─────────────────────────────────────────────────
 *
 * Not a coverage percentage, and not a target. Some of these types genuinely do
 * not warrant their own fixture. The point is that the decision is recorded
 * where a reviewer sees it, rather than being the accidental output of whoever
 * last added a slug to an array.
 *
 * Pure — no React, no Supabase, no imports beyond the contract's own types.
 */

export interface CardCoverage {
  /**
   * The `data-card` slug in the gallery, when this type has a fixture.
   *
   * Must also appear in `e2e/signal-cards.spec.ts`'s `CARDS` array, or the
   * fixture renders and is measured by nothing. The test asserts both.
   */
  slug?: string
  /**
   * Why this type has no fixture. Required when `slug` is absent.
   *
   * A sentence, in the present tense, about this type specifically. "Not done
   * yet" is not a reason; "renders through the same shape as X" is.
   */
  reason?: string
}

export const CARD_COVERAGE: Record<SignalType, CardCoverage> = {
  // ── Measured ────────────────────────────────────────────────────────────
  scenario_gap: { slug: 'scenario-below-bear' },
  active_risk: { slug: 'active-risk-real' },
  crowding: { slug: 'crowding-spread' },
  conviction_oversized: { slug: 'conviction-cohort' },
  recommendation: { slug: 'recommendation' },
  target_expired: { slug: 'target-expired' },
  no_target: { slug: 'no-target' },
  research_stale: { slug: 'unreviewed-move' },
  trade_idea: { slug: 'idea-trade' },
  thought: { slug: 'idea-thought' },
  news: { slug: 'news' },

  // ── Not measured, with a reason ─────────────────────────────────────────
  conviction_undersized: {
    reason:
      'The mirror of conviction_oversized, which has a fixture. Same builder, ' +
      'same panes, same metric shape — only the direction of the claim differs, ' +
      'and direction is a word in the headline rather than a layout.',
  },
  target_hit: {
    reason:
      'Carries a sparkline, a target chip row and a review control — the same ' +
      'three the target-expired fixture measures. Worth its own fixture when ' +
      'either card stops sharing lensCard.',
  },
  no_research: {
    reason:
      'Built by buildInsightCard, which the two unreviewed-* fixtures already ' +
      'measure. It differs in copy and in one prompt, not in structure.',
  },
  thesis_conflict: {
    reason:
      'Reached through buildIdeasSignalCard and buildAttentionCard, neither of ' +
      'which has a fixture. Genuinely unmeasured — see the workflow note below.',
  },
  team_focus: {
    reason:
      'The only type with judgment: none AND assetLinked: false, so it renders ' +
      'the thinnest card the contract permits. Unmeasured, and the type most ' +
      'likely to expose a floor the other fixtures never reach.',
  },
  catalyst_ahead: {
    reason:
      'Reached only through buildIdeasSignalCard, from a signalType the desktop ' +
      'hook does not currently emit. Unreachable in the product today.',
  },
  research_note: {
    reason:
      'A post, built by buildIdeaCard alongside trade_idea and thought, both of ' +
      'which have fixtures. It differs by taking its headline from a title.',
  },
  thesis_update: {
    reason:
      'Same builder and same shape as research_note, which is covered by the ' +
      'idea-* fixtures.',
  },
  pair_trade: {
    reason:
      'NOT covered by idea-trade, and it should be. A pair carries two legs, a ' +
      'two-sided headline with its own colour treatment, one price pane per leg ' +
      'and a four-option verdict — the widest action row on the surface, and the ' +
      'one most likely to overflow a 390px card. The highest-value gap here.',
  },
  discussion: {
    reason:
      'A post with no asset, so no chart and no portfolio context. Renders the ' +
      'idea shape minus its panes.',
  },
  project_overdue: {
    reason:
      'Built by buildAttentionCard, which has no fixture at all. Its metric is a ' +
      'day count and its entity is a project rather than an asset, which is a ' +
      'combination no measured fixture has.',
  },
  awaiting_review: {
    reason:
      'Same builder as project_overdue, and it additionally renders approve and ' +
      'decline in the quick row — three action slots where every measured card ' +
      'has two. Unmeasured, and the second-highest-value gap.',
  },
  unusual_move: {
    reason:
      'A template card: headline, metric, price pane. The news fixture measures ' +
      'the same shape from the same region of the layout.',
  },
  earnings_ahead: { reason: 'Template card, same shape as unusual_move.' },
  earnings_result: { reason: 'Template card, same shape as unusual_move.' },
  corporate_action: { reason: 'Template card, same shape as unusual_move.' },
  economic_release: {
    reason:
      'The only market type with entity.kind === "market" and no chart, so it ' +
      'renders a template card with the evidence band absent entirely.',
  },
}

/** Types with a gallery fixture behind them. */
export function measuredTypes(): SignalType[] {
  return (Object.keys(CARD_COVERAGE) as SignalType[])
    .filter(t => !!CARD_COVERAGE[t].slug)
}

/** Types nothing renders in the harness, with the reason each was excused. */
export function unmeasuredTypes(): { type: SignalType; reason: string }[] {
  return (Object.keys(CARD_COVERAGE) as SignalType[])
    .filter(t => !CARD_COVERAGE[t].slug)
    .map(t => ({ type: t, reason: CARD_COVERAGE[t].reason ?? '' }))
}
