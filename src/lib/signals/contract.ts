/**
 * The signal card contract.
 *
 * One shape that every card type renders from. No card component reads from
 * the database, and no card component special-cases a type — if a type will
 * not map, the contract is wrong and changes here rather than growing a
 * branch in the component. That rule is the entire point: the seven card
 * components that exist today each invented their own header, their own
 * action bar and their own idea of what a card is, because there was never a
 * contract to drift from.
 *
 * Builders return {@link CardResult}, not a card. A card that would display a
 * contradiction is not a card to be filtered later — it is a suppression with
 * a reason, and making that unrepresentable at the type level is the only way
 * "no card renders a null or contradictory value" survives the next card type
 * somebody adds.
 */

export type Severity = 'critical' | 'attention' | 'informational'

/** Drives the accent rail. Four surfaces, deliberately few. */
/**
 * `desk` is what a colleague said, as opposed to what the data noticed.
 *
 * The other four surfaces are all machine observations — a weight, a target, a
 * price, a queue. The ideas feed carries human posts, and folding them into
 * `research` would have made the surface word meaningless on exactly the cards
 * where provenance matters most: "Priya thinks this" and "the book is 6.2%
 * overweight" are not the same kind of claim and should not wear the same
 * badge.
 */
export type Surface = 'risk' | 'research' | 'workflow' | 'market' | 'desk'

/**
 * Discriminated union of every card type.
 *
 * `conviction_undersized` and `conviction_oversized` are separate members
 * rather than one type with a direction: they are opposite claims, with
 * opposite metric polarity and opposite primary actions. Merging them is what
 * produced a four-variant component that could not be reasoned about.
 */
export type SignalType =
  // risk
  | 'active_risk'
  | 'crowding'
  | 'conviction_undersized'
  | 'conviction_oversized'
  // research
  | 'recommendation'
  /**
   * The price against the analyst's own scenario ladder.
   *
   * The richest data in the product and, until now, the least used: targets
   * are stored one row per scenario with a probability, so a name carries a
   * bear/base/bull spread and a probability-weighted expected value. Every
   * other surface reduces that to a single number and throws the shape away.
   */
  | 'scenario_gap'
  | 'research_stale'
  | 'no_research'
  | 'target_hit'
  | 'target_expired'
  /**
   * Held, sized, and nobody has ever put a number on it.
   *
   * Distinct from `no_research`, which is about the absence of written work.
   * A name can be covered thoroughly in notes and still have no price anyone
   * would defend, and that is a different gap with a different fix: the first
   * needs somebody to write, the second needs somebody to commit to a figure.
   * Merging them would mean the card could not name what is actually missing.
   *
   * Distinct from `target_expired` for the same reason in the other direction:
   * an expired view was at least a view once, and the card can put the old
   * number on the axis. This one has nothing to draw a line at.
   */
  | 'no_target'
  /**
   * Observations about the team's own attention, rather than about a position.
   *
   * Added rather than forced into an existing member: "three analysts are on
   * this name this week" is not crowding (that is portfolios), and "two people
   * disagree about it" is not stale research. Mapping them onto near-misses
   * would have made the type meaningless for ranking and dedupe, which is the
   * failure the contract exists to prevent.
   */
  | 'team_focus'
  /**
   * Posts, not observations — the ideas feed.
   *
   * These were the last kinds rendering outside the contract, through
   * `ReelsFeedItem` and the old `FeedTileHeader`, which is why the mobile feed
   * still looked like two products: a colleague's trade idea sat next to an
   * active-risk card wearing entirely different furniture.
   *
   * They are separate members rather than one `post` type for the same reason
   * conviction is split in two: a pair trade has two legs and a thesis update
   * has a prior version, so they rank, dedupe and render differently. One type
   * with a `kind` field is the four-variant component the contract exists to
   * prevent.
   */
  | 'thought'
  | 'trade_idea'
  | 'pair_trade'
  | 'research_note'
  | 'thesis_update'
  | 'discussion'
  | 'thesis_conflict'
  /** A dated event approaching on a name the desk follows, not only earnings. */
  | 'catalyst_ahead'
  // workflow
  | 'project_overdue'
  | 'awaiting_review'
  // market
  | 'news'
  | 'unusual_move'
  | 'earnings_ahead'
  | 'earnings_result'
  | 'corporate_action'
  | 'economic_release'

/**
 * Where a displayed number came from, and how much to trust it.
 *
 * Carried per number rather than per card because a single card routinely
 * mixes vintages: a live quote, a target set in March, a weight computed from
 * a holdings snapshot two weeks old. One card-level timestamp would have to
 * misrepresent two of the three.
 */
export type NumberSource =
  /** Live market quote. */
  | 'quote'
  /** portfolio_holdings — an upload-time mark carried forward nightly, NOT
   *  a live price. Valid for weights, never for comparison to a quote or a
   *  target. See docs/tickets/holdings-freshness.md. */
  | 'holdings'
  /** Stored in the product by a person — a target, a rating, an estimate. */
  | 'stated'
  /** Derived from other numbers on this card. */
  | 'computed'

export interface CardMetric {
  /** Preformatted for display — the builder owns units and precision. */
  value: string
  label: string
  direction?: 'good' | 'bad' | 'neutral'
  source: NumberSource
  /** ISO. Rendered in the eyebrow whenever the number is shown. */
  asOf: string
  /**
   * Where the vintage came from, when `source` alone does not say.
   *
   * A `computed` number inherits the provenance of its stalest input. The
   * recommendation delta is computed from a holdings snapshot, so it is a
   * snapshot number and must be marked as one — reading the "book" prefix off
   * `source === 'holdings'` showed it as a bare date and implied a currency it
   * does not have.
   *
   * Omitted when `source` is self-describing.
   */
  vintage?: NumberSource
}

/**
 * What the eyebrow should call this number's age.
 *
 * The one place the "book" prefix is decided, so a fourth card type cannot
 * reintroduce the bug by checking `source` directly.
 */
export function vintageOf(metric: CardMetric): NumberSource {
  return metric.vintage ?? metric.source
}

export type EntityKind =
  | 'asset'
  | 'portfolio'
  | 'project'
  | 'person'
  | 'idea'
  /** A subject that is not an object in the book — a CPI print, an index
   *  level. Added because economic releases are about nothing the product
   *  owns, and making `entity` nullable would break dedupeKey, which needs
   *  it. */
  | 'market'

export interface CardEntity {
  kind: EntityKind
  id: string
  name: string
  ticker?: string
}

/**
 * A book the position sits in, with whatever the source could tell us.
 *
 * Weight is optional and frequently absent: `TargetBreach` and `StaleTarget`
 * carry portfolio NAMES and no sizes at all. A row with no weight shows the
 * name alone rather than a zero, because "0.0%" is a claim and silence is not.
 */
export interface PortfolioRef {
  id?: string
  name: string
  weightPct?: number
  valueUsd?: number
  /** Weight against the benchmark, where the card's source knows one. */
  activePct?: number
  /**
   * The index's weight in this book's benchmark.
   *
   * `undefined` and `null` are different answers and both are honest:
   * `undefined` means the source did not supply one, `null` means the book has
   * NO benchmark file, so "active" is undefined rather than equal to the
   * position. A real `0` means the file exists and does not list the name —
   * the whole position is active. None of the three may render as "0.0%"
   * except the last.
   */
  benchmarkPct?: number | null
}

export interface CardContextChip {
  label: string
  href?: string
  /**
   * The books behind the label, for inline disclosure.
   *
   * "In 2 portfolios" was inert text stating a number the reader immediately
   * wanted to expand, and a single portfolio name was a link that navigated
   * away from the card on the first tap. Both are the same mistake: the answer
   * to "which ones, and how big" is small enough to show in place, and leaving
   * the feed to find it costs the reader their position in it.
   *
   * Present means the chip discloses. Navigation still exists and is now an
   * explicit action per row rather than a side effect of touching a label.
   */
  portfolios?: PortfolioRef[]
}

export type EvidenceKind =
  | 'none'
  | 'sparkline'
  | 'peer_bar'
  | 'timeline'
  /** The scenario ladder: every case as a marker on a price axis, with the
   *  live price against them. The one chart on this surface that carries the
   *  argument rather than decorating it — the spread IS the claim. */
  | 'scenario_ladder'

export interface EvidenceAnnotation {
  date: string
  label: string
  /** `horizon` marks a deadline — the end of a target's stated timeframe, a
   *  catalyst date — as distinct from `event`, which marks something that
   *  happened. Stale-target and catalyst-countdown both need the former. */
  kind: 'entry' | 'target' | 'thesis' | 'event' | 'horizon'
}

export interface CardEvidence {
  kind: EvidenceKind
  data: unknown
  annotations?: EvidenceAnnotation[]
}

export interface CardAction {
  id: string
  label: string
  /** Resolvable without navigation. A `false` here should be rare and
   *  deliberate — leaving the feed to act is the failure this surface exists
   *  to avoid. */
  inline: boolean
}

export interface CardActions {
  /** Exactly one. A card with no primary action is a card with no point. */
  primary: CardAction
  /**
   * 0–2 inline actions that are genuinely worth a button.
   *
   * Snooze and dismiss are NOT among them. They were, and four buttons on a
   * 390px row gave triage the same visual weight as the decision the card
   * exists to prompt — while also being the reason the row overflowed on
   * Linux font metrics. Housekeeping belongs in `menu`.
   */
  quick: CardAction[]
  /**
   * Overflow, behind the ⋯ control. Snooze, dismiss, and "why am I seeing
   * this" live here. Always non-empty: a card you cannot get rid of is a card
   * that trains people to scroll past the surface.
   */
  menu: CardAction[]
  /** Always present, always last, always navigates. */
  open: { label: string; href: string }
}

export interface CardProvenance {
  actor?: { name: string; avatarUrl?: string }
  /** When the underlying thing happened. */
  occurredAt: string
  /**
   * Human-readable, machine-generated: "You hold this in 3 portfolios and
   * have not written on it since March."
   *
   * Shown behind "Why am I seeing this". Not decoration — a proactive surface
   * that cannot explain itself trains people to distrust it.
   */
  reason: string
}

export interface CardExpiry {
  staleAfterDays: number
  /** ISO. A date after which the card resolves itself — an earnings date, a
   *  target horizon. */
  autoResolveOn?: string
}

export interface SignalCard {
  id: string
  type: SignalType
  surface: Surface
  severity: Severity
  /**
   * The claim and its qualifier, as a sentence — and NOT the number.
   *
   * "MSFT is your largest overweight in Core Equity", not "ACTIVE RISK" and
   * not "MSFT is a +3.1% overweight". The headline states what is true; the
   * metric block below it carries the figure.
   *
   * This rule replaces "a full sentence containing the number", which put the
   * same value on screen twice in 22px and then again in 38px directly
   * beneath. For any card resting on a single number — which is most of them
   * — the two are guaranteed to collide.
   *
   * A second dimension that genuinely helps the reader (the 6.2% position
   * behind a +3.1% active weight) belongs in `body`, never in `metric`.
   */
  headline: string
  /** The one number the decision turns on. Null when the claim is not
   *  numeric — a coverage gap, an overdue project. */
  metric: CardMetric | null
  /** One or two sentences: why it matters now, what happens if ignored. Not
   *  a restatement of the headline. */
  body: string
  /**
   * The question the card is actually asking, in the reader's words.
   *
   * ── Why this is a field and not part of `body` ────────────────────────────
   *
   * A card has three jobs and the first two were already separated: the
   * headline says WHAT HAPPENED, the metric says WHY IT MATTERS. The third —
   * what the reader is being asked to think about — had no home, so it was
   * either buried in the last clause of the body or living inside a response
   * control the reader had to scroll to before they knew a question existed.
   *
   * On a phone that ordering is the whole problem. A reader scanning a feed
   * decides whether to engage in about a second, and "has the investment view
   * changed?" is the line that earns the engagement. It has to be legible
   * above the fold, in its own right, at a glance.
   *
   * Kept short deliberately: one interrogative sentence. Anything longer is
   * body copy wearing a question mark.
   *
   * Optional because not every card asks something. A news card reports; an
   * economic release reports. Inventing a question for those would train the
   * reader to ignore the line on the cards that genuinely have one.
   */
  prompt?: string
  entity: CardEntity
  context: CardContextChip[]
  /** Omitted entirely, or `kind: 'none'`, unless the evidence changes the
   *  decision. Charts require an argument to appear, not an argument to
   *  suppress. */
  evidence?: CardEvidence
  actions: CardActions
  provenance: CardProvenance
  expiry: CardExpiry
  /**
   * type + entity + trigger period. Identifies *the same claim recurring*,
   * and nothing else.
   *
   * Explicitly NOT the one-card-per-entity-per-day cap: two different claims
   * about one name are competitors to be ranked, and collapsing them here
   * would silently drop the loser instead of demoting it to a secondary line.
   */
  dedupeKey: string
}

/** Why a card did not render. Logged with its entity — see logSuppression. */
export type SuppressionReason =
  /** Placeholder or keyboard-mash content. */
  | 'content_quality'
  /** A displayed number is null, or zero standing in for unknown. */
  | 'missing_number'
  /** Two numbers on the card contradict each other. */
  | 'inconsistent_numbers'
  /** The claim needs a live quote and there isn't one. */
  | 'quote_unavailable'
  /** The quote exists but is older than the freshness threshold. */
  | 'quote_stale'
  /** Would compare a holdings snapshot price to a target or a live quote. */
  | 'snapshot_vs_live'
  /** Source table too sparse for absence to mean anything — see
   *  `MIN_COVERAGE`. */
  | 'insufficient_coverage'
  /** User snoozed this type+entity and the condition has not fired. */
  | 'snoozed'
  /** Already resolved. */
  | 'resolved'

export type CardResult =
  | { ok: true; card: SignalCard }
  | { ok: false; reason: SuppressionReason; entity: string; detail?: string }

export const suppress = (
  reason: SuppressionReason,
  entity: string,
  detail?: string,
): CardResult => ({ ok: false, reason, entity, detail })

export const emit = (card: SignalCard): CardResult => ({ ok: true, card })
