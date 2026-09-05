/**
 * The engagement seam — types.
 *
 * ── What this is ──────────────────────────────────────────────────────────
 *
 * One shared description of "the thing the user is acting on", so that any
 * surface — Today, Ideas, Research, Portfolio, Decisions, and eventually
 * mobile — can hand the same object to a structured action, to the AI panel,
 * or to a team thread without the user re-typing the ticker, re-finding the
 * idea, or re-explaining the problem.
 *
 * ── Why a new type rather than reusing DecisionContext ────────────────────
 *
 * `DecisionContext` (engine/decisionEngine/types.ts) is a bag of optional ids
 * belonging to the evaluator that produced an item: `assetId`, `portfolioId`,
 * `tradeIdeaId`, `proposalId`, plus evaluator-specific fields like
 * `overdueDays` and `ratingFrom`. It answers "what did the evaluator find".
 * It cannot answer "which single object is this engagement about", because
 * several of its ids are populated at once and nothing says which one leads.
 *
 * An engagement needs exactly one subject. `objectType` + `objectId` is that
 * subject; everything else is context hung off it. Deriving one from the other
 * is a lossy, opinionated step, which is why it lives in an adapter
 * (`fromDecisionContext`) rather than being pretended away by reusing the type.
 *
 * ── Why this is not shaped to Today ───────────────────────────────────────
 *
 * Nothing here mentions tiers, evaluators-as-a-closed-set, severity bands or
 * feed positions. `origin` is optional and free-form precisely so a Research
 * document, a Portfolio exposure row, a Decision record or a mobile signal
 * card can populate it with whatever produced them. A target built by hand
 * from an asset page — `{ objectType: 'asset', objectId, label }` — is valid.
 */

/**
 * The kinds of object an engagement can be about.
 *
 * Deliberately a superset of what can currently hold a thread: `decision`,
 * `research_note` and `coverage` are listed because Stage D2+ surfaces will
 * produce them, and a type that has to be widened later is a type every
 * caller has to be revisited for. Whether a given type can hold a *thread*
 * is a separate question, answered by `DISCUSSABLE_OBJECT_TYPES` in
 * `./target`, not by this union.
 */
export type EngagementObjectType =
  | 'asset'
  | 'portfolio'
  | 'theme'
  | 'note'
  | 'trade_idea'
  | 'quick_thought'
  | 'research_note'
  | 'decision'
  | 'coverage'

/** Which half of the engagement pane to open. */
export type EngagementMode = 'ai' | 'discuss'

/**
 * Why this object is being engaged with right now.
 *
 * Optional, because engagement is also valid with no issue at all — a user
 * opening AI from an asset page has an object but no triggering problem. When
 * present it is what stops a thread from being context-free and what makes a
 * seeded AI question specific rather than generic.
 */
export interface EngagementIssue {
  /** Short, human. "Framework broken", "Research needs review". */
  title: string
  /** One sentence of why-now. Shown under the title. */
  detail?: string
  /**
   * Which producer raised it — an evaluator key, a rule name, a surface.
   * Free-form on purpose: the engine's evaluator set is not the only source,
   * and hard-coding it here would make Research and Portfolio second-class.
   */
  reason?: string
  /** ISO timestamp of when the issue was detected, if known. */
  detectedAt?: string
}

/** A labelled fact shown as "context already supplied". */
export interface EngagementContextChip {
  label: string
  value: string
}

/**
 * The subject of an engagement, plus everything needed to open AI or a thread
 * about it without asking the user to restate anything.
 */
export interface EngagementTarget {
  /** The one object this engagement is about. */
  objectType: EngagementObjectType
  objectId: string
  /** Human name for the object. "AMZN — Amazon.com", "Growth Composite". */
  label: string

  /** Ticker, where the object has or belongs to one. Display + AI context. */
  symbol?: string
  /**
   * The asset this object hangs off, when the object is not itself the asset.
   * A research note about AMZN sets `objectType: 'research_note'` and
   * `assetId: <amzn>`, so AI can be given the asset's thesis and exposure
   * without the note pretending to be the asset.
   */
  assetId?: string

  /** Portfolio context, where the engagement is exposure-shaped. */
  portfolioId?: string
  portfolioName?: string

  /** What raised this, so a later reader can trace it back. */
  origin?: {
    /** Id of the surfaced item — a DecisionItem id, a row key. */
    itemId?: string
    /** Which surface it came from. Free-form; not a closed enum. */
    surface?: string
  }

  /** Why now. */
  issue?: EngagementIssue

  /**
   * A question worth asking the model about this object and issue.
   *
   * Supplied by the surface because only the surface knows what it found —
   * the seam does not invent prompts. It is a suggestion placed in the
   * composer, never auto-sent: Stage D1 lets AI analyse and propose, and a
   * prompt the user did not choose to send is neither.
   */
  seedPrompt?: string

  /**
   * What the pane should show as already-supplied context.
   *
   * Display only in D1. The model's real context is assembled server-side by
   * the `ai-chat` edge function from the conversation's tags; these chips
   * describe that to the user rather than driving it, so they can never
   * silently disagree with what was actually sent.
   */
  contextChips?: EngagementContextChip[]
}

/** What `openEngagement` puts on the wire. */
export interface EngagementRequest {
  target: EngagementTarget
  mode: EngagementMode
}
