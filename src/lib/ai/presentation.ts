/**
 * The shapes the AI presentation layer renders.
 *
 * ── Why these moved out of useAI ──────────────────────────────────────────
 *
 * They were declared in `hooks/useAI.ts`, which constructs a Supabase client
 * at import time. Any presentation component that imported a type from there
 * dragged auth, the org context and the network in with it, which is why the
 * research trail, the citations footer and the message bubble all lived inside
 * `AISection.tsx` as module-local functions: there was nowhere to put them
 * that a test could reach.
 *
 * These are types only — erased at build, no runtime cost, no client. `useAI`
 * re-exports them, so every existing importer is unchanged.
 */

/**
 * The kind of record a source points at.
 *
 * The decision chain is four kinds rather than one because it is four facts: a
 * recommendation is not a ruling, a ruling is not a committed trade, and a
 * committed trade is not an executed one.
 */
export type AiSourceKind =
  | 'asset' | 'note' | 'contribution' | 'price_target' | 'portfolio' | 'theme'
  | 'recommendation' | 'decision_request' | 'accepted_trade'
  | 'decision_review' | 'outcome'
  | 'workflow' | 'checklist_item'
  /* An Idea Pipeline entry. Distinct from `recommendation`: the pipeline
     measures how well understood an idea is and stops at ready-to-recommend.
     Whether a recommendation was submitted is a `decision_requests` fact. */
  | 'idea'

/**
 * A record the AI consulted, with enough provenance to open it.
 *
 * `id` and `asset_id` are what make a source a link rather than a label. Both
 * are optional because a response produced before they existed carries
 * neither, and such a message must still render.
 */
export interface AiSourceRef {
  kind: AiSourceKind
  id: string
  asset_id?: string | null
  symbol?: string | null
  title: string
  timestamp?: string | null
  /**
   * The RECORD's own lifecycle state, in product words: a recommendation
   * awaiting a ruling, an idea's stage, an overdue requirement.
   *
   * Deliberately not called `status`: `MessageToolCall.status` is whether the
   * search ran, and this is what the found row is doing. Merging the two is
   * how "the lookup failed" would start rendering as "the trade was rejected".
   */
  state?: string | null
  /** A short quotation from the record, so it can be recognised unopened. */
  excerpt?: string | null
}

/**
 * How far a lookup could see.
 *
 * `organization` covers the whole active organization, so an empty result is
 * a fact about the firm. `caller_visible` covers what RLS lets this reader
 * read, so an empty result is a fact about them and nothing more.  `caller`
 * covers only their own rows.
 *
 * Mirrors `VisibilityScope` in `supabase/functions/_shared/research-results.ts`
 * and is guarded by the drift test in `retrieval-visibility.test.ts`.
 */
export type AiVisibilityScope = 'organization' | 'caller_visible' | 'caller'

/**
 * A CLAIM-LEVEL citation: the provider quoted this document for a specific
 * sentence. Weaker than it looks if treated as "the AI read everything" — it
 * means only that this snippet backs that claim.
 */
export interface MessageCitation {
  document_title: string
  cited_text:     string
  kind?:          AiSourceKind
  document_id?:   string
  asset_id?:      string | null
  symbol?:        string | null
  timestamp?:     string | null
}

/**
 * A research lookup the model performed. Distinct from a citation: this is
 * "consulted", not "quoted in support of a claim".
 *
 * `status` is the field that matters. `ok` found records, `empty` searched and
 * matched none, `error` means the search never ran — and the panel must say
 * three different things, because conflating the last two is how a user is
 * told the firm has no research when the lookup simply failed.
 */
export interface MessageToolCall {
  name:  string
  input: Record<string, unknown>
  status?: 'ok' | 'empty' | 'error'
  /** What was looked at, in words. For the "no matches" sentence. */
  searched?: string
  result_count?: number
  sources?: AiSourceRef[]
  /**
   * How far this lookup could see. The trail's absence sentence depends on it.
   *
   * Without it the panel wrote "No matching records." for every empty result,
   * which on a permission-scoped path states as a fact something it cannot
   * know. Optional because a message produced before this existed has none,
   * and those must still render: the sentence degrades to a claim about
   * matches rather than about the firm.
   */
  scope?: AiVisibilityScope
}

/**
 * One turn, as the presentation layer needs it.
 *
 * Structural, not nominal: `useAI`'s own message type satisfies this, and so
 * does a briefing's single synthesised turn, which is the point — a briefing
 * is one assistant message with a research trail, and it should render through
 * exactly the same components as a chat reply.
 */
export interface AiRenderableMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
  model?: string | null
  citations?: MessageCitation[]
  tool_calls?: MessageToolCall[]
  streaming?: boolean
  truncated?: boolean
}
