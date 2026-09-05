import type { Severity, SignalType } from './contract'
import type { FeedCategory } from '../mobile/feed-categories'

/**
 * What each kind of card IS, declaratively.
 *
 * ── Why a registry, and what it is deliberately not ───────────────────────
 *
 * Every capability below was previously a conditional somewhere in a 3,500
 * line component: which filter a card answers to, whether it asks its question
 * immediately, whether it can carry a chart, which control it manipulates.
 * Scattered, those conditionals disagree — and they did. `active_risk` is a
 * position-sizing decision that landed under **News**, because the feed
 * resolved categories from the ENTRY KIND (`template`) rather than from the
 * card, and every template is news-shaped except that one.
 *
 * This describes CAPABILITY and PRESENTATION. It does not execute signal
 * logic: no thresholds, no scoring, no suppression, nothing about when a card
 * fires. Those live in the builders and in `feed-priority`, and moving them
 * here would turn a lookup table into a second engine.
 *
 * The test that keeps it honest asserts every `SignalType` appears exactly
 * once, so a new card type cannot be added without deciding what it is.
 */

/**
 * When a card asks its question.
 *
 * ── The problem this names ────────────────────────────────────────────────
 *
 * Nearly every tile opened with a question — "What best describes this
 * position?", "Does this need a price target?", "Has the view changed?" — so
 * scrolling the feed felt like working through a questionnaire rather than
 * reading it. The questions are valuable and none of them are removed; what
 * changes is when they arrive.
 *
 * `browse -> engage -> judge`, rather than being asked to respond while
 * browsing.
 */
export type JudgmentPresentation =
  /** Visible in the resting state. Reserved for unresolved decision events. */
  | 'inline'
  /** Revealed when the reader engages the object. The default. */
  | 'on_engage'
  /** This card has no judgment to offer. */
  | 'none'

/**
 * The control this card's primary manipulation drives.
 *
 * Keeps action behaviour truthful: a no-target card manipulates a target, an
 * active-risk card manipulates a weight, and neither should offer the other's
 * control. Also what lets a scenario card open the case editor DIRECTLY rather
 * than by way of "Set a target" — see `MobileCaseTargets`.
 */
export type ManipulationSurface =
  | 'target'
  | 'scenario'
  | 'position_size'
  | 'research'
  | 'none'

export interface ContentCapabilities {
  /**
   * The single source of truth for filtering, in BOTH Curate and Explore.
   *
   * Not derived from the entry kind. That is the bug this fixes.
   */
  canonicalCategory: FeedCategory
  /**
   * Baseline presentation. `inline` here means "inline when the situation is
   * material" — see `judgmentPresentationFor`, which is what actually resolves
   * it, because materiality is severity and severity is per-card.
   */
  judgment: JudgmentPresentation
  /**
   * Whether this card is ABOUT a single asset, and so could carry its tape.
   *
   * Capability, never availability. A card may declare `true` and still have
   * no chart, because the symbol may be unresolved or uncached — see
   * `price-availability`, which is the only thing allowed to answer that.
   */
  assetLinked: boolean
  /** Whether the expanded chart is offered. Implies `assetLinked`. */
  fullscreenChart: boolean
  manipulationSurface: ManipulationSurface
  /** Whether "in N portfolios" disclosure is meaningful for this kind. */
  portfolioContext: boolean
}

/**
 * ── On the `inline` set ───────────────────────────────────────────────────
 *
 * Four types, and the common thread is that each is an unresolved event with a
 * decision attached rather than an observation about a gap. A target that has
 * been substantially exceeded, a price through a scenario boundary, and a
 * recommendation nobody has answered are all situations where the question IS
 * the content — hiding it behind an engagement would be hiding the point.
 *
 * Everything else is `on_engage`, including every card that describes an
 * absence: no thesis, no target, stale research, an overdue project. Those are
 * worth reading before they are worth answering, and asking immediately is
 * what made the feed feel like a form.
 */
export const CONTENT_REGISTRY: Record<SignalType, ContentCapabilities> = {
  // ── Decisions: the price against the framework ──────────────────────────
  scenario_gap: {
    canonicalCategory: 'decisions', judgment: 'inline', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'scenario', portfolioContext: true,
  },
  target_hit: {
    canonicalCategory: 'decisions', judgment: 'inline', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'target', portfolioContext: true,
  },
  target_expired: {
    canonicalCategory: 'decisions', judgment: 'inline', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'target', portfolioContext: true,
  },
  recommendation: {
    canonicalCategory: 'decisions', judgment: 'inline', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'position_size', portfolioContext: true,
  },
  /**
   * Sized, and never priced.
   *
   * ── Why this is Portfolio and not Decisions ─────────────────────────────
   *
   * Its trigger is a book fact, not a document fact. `usePortfolioLenses` only
   * emits it for a position that is held, priceable, in a book of at least
   * `MIN_POSITIONS_FOR_WEIGHT` positions, and carrying at least
   * `UNTARGETED_MIN_PCT` of it — the same 2% bar `material_no_thesis` uses,
   * and for the same reason: below it, "we have not got to it yet" is a
   * reasonable answer. There is exactly one producer, so nothing security-level
   * is being swept along with it.
   *
   * "This security has no target" would be Research. "Meaningful capital is
   * deployed with no price objective" is a statement about the book, and it
   * cannot be made without one.
   */
  no_target: {
    canonicalCategory: 'portfolio', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'target', portfolioContext: true,
  },
  /**
   * The taxonomy fix.
   *
   * Active risk is how far a position sits from its benchmark weight. That is
   * a sizing decision, and it rendered under **News** — reported from a phone,
   * and correctly, as nonsense. The cause was `categoryOf` reading the entry
   * kind: active risk arrives as a `template`, and every other template really
   * is a market event.
   */
  /**
   * Where the book differs from its benchmark.
   *
   * Constituted by portfolio state: the finding is `weight − benchmarkWeight`
   * for one asset in one book, and neither half exists without a portfolio and
   * an index file. Filed under Decisions, and before that under News, which an
   * audit called "correctly, nonsense" — this is the third home and the first
   * one derived from what the number is.
   */
  active_risk: {
    canonicalCategory: 'portfolio', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'position_size', portfolioContext: true,
  },
  /**
   * One name across several books.
   *
   * The most inherently book-derived finding the product has: it cannot be
   * stated at all without more than one portfolio, and its content is the
   * per-book weight spread. A security-level lens has nothing to say about it.
   */
  crowding: {
    canonicalCategory: 'portfolio', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'position_size', portfolioContext: true,
  },
  conviction_undersized: {
    canonicalCategory: 'decisions', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'position_size', portfolioContext: true,
  },
  conviction_oversized: {
    canonicalCategory: 'decisions', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'position_size', portfolioContext: true,
  },

  // ── Research: gaps in the written record ────────────────────────────────
  research_stale: {
    canonicalCategory: 'research', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'research', portfolioContext: true,
  },
  no_research: {
    canonicalCategory: 'research', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'research', portfolioContext: true,
  },
  thesis_conflict: {
    canonicalCategory: 'research', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'research', portfolioContext: true,
  },
  /**
   * `on_engage`, not `none`, and the change is a bug fix rather than a
   * preference.
   *
   * ── The pane that was built and thrown away ───────────────────────────────
   *
   * `judgment: 'none'` does more than withhold an affordance. `SignalCardView`
   * filters the judgment pane out of the carousel for anything that is not
   * `inline`, and only offers the engagement control when the presentation is
   * `on_engage` — so for `none` the pane is removed from the pager AND there is
   * no way to reach it. It is unrenderable.
   *
   * Both producers of this type build one anyway. The mobile feed's ideas-
   * signal branch composes a three-option response ("Is the desk looking at the
   * right thing?"), and its attention branch composes the workflow set — Done /
   * In progress / Defer / Not mine — whose handler also acknowledges or snoozes
   * the attention row. Every `informational` attention item is a `team_focus`
   * card, and `attentionItems` deliberately includes that whole section. So the
   * only response control on a populated family of cards was discarded before
   * paint, and with it the only path that clears those items from the queue.
   *
   * The registry was the thing that was wrong. "Three analysts are on this name
   * this week" and "this was routed to you for information" are both propositions
   * a reader can answer, and the call sites had already written the answers.
   * `on_engage` is the right strength: it is an observation, so it is worth
   * reading before it is worth answering, and the question arrives when asked
   * for rather than leading the card.
   *
   * `economic_release` stays `none`, and correctly: a CPI print is a report, and
   * nothing in the feed composes a response to one.
   */
  team_focus: {
    canonicalCategory: 'research', judgment: 'on_engage', assetLinked: false,
    fullscreenChart: false, manipulationSurface: 'none', portfolioContext: false,
  },

  // ── Ideas: what colleagues posted ───────────────────────────────────────
  /**
   * `inline`, so the response is a PAGE rather than a mode toggle.
   *
   * ── The collision this removes ────────────────────────────────────────────
   *
   * `on_engage` makes `SignalCardView` render a "Your view" / "Evidence"
   * affordance, and that control sits in the same band as the context chips.
   * On a card carrying a portfolio, a conviction and an urgency it was landing
   * on top of them, and its horizontal position moved with the length of the
   * metadata beside it — reported from the phone as the control colliding with
   * the labels.
   *
   * It is also a second navigation pattern. The card already pages: the
   * carousel has dots, labels and a swipe, and the response is one more thing
   * to page to. A toggle that reveals a pane the pager could have reached is
   * two mechanisms for one job, and the reader has to learn both.
   *
   * `scenario_gap` reached the same conclusion first and this is deliberate
   * parity with it: declare inline, let the shell own the panes, and let
   * `judgmentIsInOwnShell` keep it inline at any severity. No engagement
   * control renders, so it cannot collide with anything.
   */
  trade_idea: {
    canonicalCategory: 'ideas', judgment: 'inline', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  /**
   * A pair is about a RELATIONSHIP between two names, so there is no single
   * symbol whose tape is the evidence. Charting one leg would quietly assert
   * the trade was about that leg.
   */
  /**
   * `inline`, matching `trade_idea`. Two reported defects, one line.
   *
   * `on_engage` makes `SignalCardView` do two things: render a floating
   * "Your view" affordance in the metadata band, and FILTER THE JUDGMENT PANE
   * OUT of the carousel so that engaging replaces the evidence band instead.
   *
   * Both were reported from the phone as separate bugs. They are the same one.
   * The floating control is the first symptom. The second is subtler: with the
   * verdict pane absent from the pager, `onActiveChange` can never report
   * `verdict`, so the feed's footer gate — which asks whether the response pane
   * is showing — was never satisfied, and selecting an answer left the footer
   * saying `Actions`. The pair judgment was wired correctly the whole time; it
   * simply had no way to be told it was on screen.
   *
   * `trade_idea` was moved to `inline` for the collision alone and got the
   * working footer as a side effect, which is why single names behave and
   * pairs did not.
   */
  pair_trade: {
    canonicalCategory: 'ideas', judgment: 'inline', assetLinked: false,
    fullscreenChart: false, manipulationSurface: 'none', portfolioContext: true,
  },
  thought: {
    canonicalCategory: 'ideas', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: false,
  },
  research_note: {
    canonicalCategory: 'ideas', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'research', portfolioContext: false,
  },
  thesis_update: {
    canonicalCategory: 'ideas', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'research', portfolioContext: false,
  },
  discussion: {
    canonicalCategory: 'ideas', judgment: 'on_engage', assetLinked: false,
    fullscreenChart: false, manipulationSurface: 'none', portfolioContext: false,
  },

  // ── Workflow: somebody owes somebody something ──────────────────────────
  project_overdue: {
    canonicalCategory: 'workflow', judgment: 'on_engage', assetLinked: false,
    fullscreenChart: false, manipulationSurface: 'none', portfolioContext: false,
  },
  awaiting_review: {
    canonicalCategory: 'workflow', judgment: 'on_engage', assetLinked: false,
    fullscreenChart: false, manipulationSurface: 'none', portfolioContext: false,
  },

  // ── News: things that happened ──────────────────────────────────────────
  news: {
    canonicalCategory: 'news', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  unusual_move: {
    canonicalCategory: 'news', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  earnings_ahead: {
    canonicalCategory: 'news', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  earnings_result: {
    canonicalCategory: 'news', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  corporate_action: {
    canonicalCategory: 'news', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  catalyst_ahead: {
    canonicalCategory: 'news', judgment: 'on_engage', assetLinked: true,
    fullscreenChart: true, manipulationSurface: 'none', portfolioContext: true,
  },
  /**
   * A macro release is not about a company, so it is not asset-linked and gets
   * no chart. This is the rule that stops "CPI came in hot" being illustrated
   * with whatever equity happened to be nearby.
   */
  economic_release: {
    canonicalCategory: 'news', judgment: 'none', assetLinked: false,
    fullscreenChart: false, manipulationSurface: 'none', portfolioContext: false,
  },
}

export function capabilitiesFor(type: SignalType): ContentCapabilities {
  return CONTENT_REGISTRY[type]
}

/**
 * Where this card belongs, for both filter surfaces.
 *
 * This is the answer `categoryOf` defers to whenever a card type is known.
 */
export function categoryForType(type: SignalType): FeedCategory {
  return CONTENT_REGISTRY[type].canonicalCategory
}

/**
 * Whether the question is asked now or on engagement.
 *
 * ── Why severity resolves it rather than the table alone ──────────────────
 *
 * The brief's inline exceptions are "a material scenario breach", "a target
 * substantially exceeded", "an explicit major decision mismatch". Every one of
 * those is a statement about MATERIALITY, not about card type — and the
 * builders already encode materiality as `severity`. A `scenario_gap` on a
 * 0.3% watchlist name is not a decision event; the same card on a 12% position
 * through its bear case is.
 *
 * So the table declares which types are *eligible* to lead with their
 * question, and the card's own severity decides whether this instance does.
 * Anything not critical falls back to `on_engage`, which is the default the
 * whole phase is about.
 */
/**
 * Does this TYPE declare its judgment inline, before severity is considered?
 *
 * `judgmentPresentationFor` downgrades a declared-inline card to `on_engage`
 * unless it is critical, which is right for a card whose judgment is a separate
 * thing to opt into. It is wrong for a card that composes its own multi-pane
 * shell with the judgment already in it — see `SignalCardView`, where the two
 * facts are combined.
 */
export function judgmentIsDeclaredInline(type: SignalType): boolean {
  return CONTENT_REGISTRY[type].judgment === 'inline'
}

export function judgmentPresentationFor(
  card: { type: SignalType; severity: Severity },
): JudgmentPresentation {
  const declared = CONTENT_REGISTRY[card.type].judgment
  if (declared !== 'inline') return declared
  return card.severity === 'critical' ? 'inline' : 'on_engage'
}
