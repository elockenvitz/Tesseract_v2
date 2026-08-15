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
export type Surface = 'risk' | 'research' | 'workflow' | 'market'

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
  | 'research_stale'
  | 'no_research'
  | 'target_hit'
  | 'target_expired'
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

export interface CardContextChip {
  label: string
  href?: string
}

export type EvidenceKind = 'none' | 'sparkline' | 'peer_bar' | 'timeline'

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
  /** 0–3, all inline. */
  quick: CardAction[]
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
   * A full sentence containing the number. "MSFT is your largest overweight
   * at +29.6%", not "ACTIVE RISK". The badge is metadata; this is the
   * message, and if it reads like a label the card has failed.
   */
  headline: string
  /** The one number the decision turns on. Null when the claim is not
   *  numeric — a coverage gap, an overdue project. */
  metric: CardMetric | null
  /** One or two sentences: why it matters now, what happens if ignored. Not
   *  a restatement of the headline. */
  body: string
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
