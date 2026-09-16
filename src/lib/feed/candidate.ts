/**
 * What a feed candidate IS, before any surface decides how to draw it.
 *
 * ── The problem this exists to name ──────────────────────────────────────
 *
 * Every producer in the product invents its own shape and then hand-builds a
 * `DecisionItem` around it: its own id convention, its own severity words, its
 * own chips, its own CTA. So the answer to "what does the system think needs
 * attention, and why" lives in eight evaluators and cannot be asked as one
 * question. Two of them have already drifted -- one embeds a day count in its
 * id, which makes every dismissal an orphan the next morning.
 *
 * A candidate is the claim itself: this subject, for this reason, as of this
 * time, on this evidence. It is deliberately NOT a tile.
 *
 * ── What this contract does not do ───────────────────────────────────────
 *
 *   It does not dictate layout.      No chips, no copy, no CTA styling. A
 *                                    surface renders a candidate however it
 *                                    renders things.
 *   It does not own ranking.         No score, no sort order, no tier. The
 *                                    feed decides what matters most; the
 *                                    producer only says what is true.
 *   It does not replace truth.       `facts` and `memoryRefs` point AT the
 *                                    authoritative rows. Nothing here is the
 *                                    system of record for anything.
 *   AI does not decide eligibility.  A candidate exists because a rule or a
 *                                    durable fact says so. Generation may
 *                                    later describe a candidate; it may not
 *                                    create one.
 *
 * ── V1 scope ─────────────────────────────────────────────────────────────
 *
 * One producer is adapted (`TRADE_REVIEW_OWED`) because it already comes from
 * a durable `memory_obligations` row, so the contract can be checked against
 * something real rather than against a shape invented for it. Fields are added
 * when a second producer genuinely needs them, not in anticipation.
 */

/** How loudly a surface should treat this. Deliberately the vocabulary the
 *  existing engine already uses, so an adapter is a mapping and not a
 *  translation with judgement in it. */
export type CandidateSeverity = 'red' | 'orange' | 'yellow' | 'info'

/** The kinds of thing a candidate can be about. Matches the Memory Spine's
 *  subject vocabulary so a candidate and an event can name the same object. */
export type CandidateSubjectType =
  | 'asset' | 'idea' | 'decision' | 'trade' | 'batch' | 'portfolio'

/**
 * Where the claim came from, in enough detail to audit it.
 *
 * `producer` is the rule that raised it. `source` names the authoritative
 * thing it was derived from, so a reader can always get back to the row --
 * which is the difference between a feed and a pile of assertions.
 */
export interface CandidateProvenance {
  /** The evaluator or job that produced this. */
  producer: string
  /** The table the claim derives from, where one exists. */
  sourceType?: string
  sourceId?: string
}

/**
 * A pointer into the Memory Spine.
 *
 * Present when a candidate exists BECAUSE of a durable memory fact -- an open
 * obligation, a recorded review. Absent for candidates derived live from
 * ordinary tables, which is most of them today.
 */
export interface CandidateMemoryRef {
  kind: 'obligation' | 'event'
  id: string
}

/**
 * One thing the system believes deserves attention.
 */
export interface FeedCandidate {
  /**
   * Stable across regenerations of the same claim.
   *
   * Load-bearing: a personal dismissal is recorded against this, so an id that
   * varies with time makes the reader answer the same question every morning
   * and the dismissal never appears to stick. Nothing time-varying belongs in
   * it. See `lib/attention-state/suppression`.
   */
  id: string
  /** The rule that produced this, as a stable machine key. */
  kind: string
  subjectType: CandidateSubjectType
  subjectId: string
  organizationId: string

  /** Why this is being raised, in the product's own words. One sentence. */
  reason: string
  severity: CandidateSeverity

  /**
   * When the thing that makes this true happened -- not when it was computed.
   * An obligation's `raised_at`, a trade's commit date. What "how long has this
   * been waiting" is measured from.
   */
  occurredAt: string

  /**
   * The handful of already-authoritative values a surface needs to say
   * something specific, rather than re-querying per tile. A cache of other
   * tables' truth, never a second copy of it: anything here is re-derivable.
   */
  facts?: Record<string, string | number | null>

  provenance: CandidateProvenance
  memoryRefs?: CandidateMemoryRef[]

  /**
   * What can be done about it, as intent rather than presentation.
   *
   * `actionKey` is the product's existing action vocabulary; the surface
   * decides the label, the icon and the placement. A producer that specified
   * button styling here would be dictating layout.
   */
  actions?: Array<{ actionKey: string; payload?: Record<string, unknown> }>
}
