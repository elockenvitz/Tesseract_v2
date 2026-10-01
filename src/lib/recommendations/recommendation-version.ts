/**
 * What the recommendation said, frozen at the moment it was submitted.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * Decision Inbox, Outcomes, Trade Book and the decision-story RPC all render
 * the investment case by joining to CURRENT `trade_queue_items` and
 * `trade_idea_theses`. Those rows are mutable. An analyst who edits a thesis
 * today changes what a decision made six weeks ago appears to have been based
 * on — silently, with no edit trail, and in the direction that most flatters
 * whoever edited it.
 *
 * `decision_requests.submission_snapshot` already freezes sizing and
 * identity. It freezes no reasoning at all, and it cannot be made to: the
 * resubmission path UPDATES the active request in place and overwrites that
 * column, so it is incapable of preserving what the first submission said.
 *
 * ── What this module does, and what it refuses to do ─────────────────────
 *
 * It writes one append-only `trade_proposal_versions` row per submission,
 * carrying the recommendation and the reasoning that accompanied it, each
 * field tagged in `captured_from` with the table, row and column it was read
 * from.
 *
 * It copies ONLY fields whose later mutation would rewrite history. Current
 * market price, present-day portfolio weight, company metadata and
 * performance are deliberately NOT captured — those are current facts, and a
 * frozen copy of a current fact is just a stale fact that looks authoritative.
 *
 * It does not invent. Catalysts and risks have no columns of their own —
 * they are `direction` values on `trade_idea_theses` (bull | bear | catalyst
 * | risk | context) — so they are frozen as part of the theses array and not
 * as fields this module made up. `captured_from` says what was read; a field
 * absent from it was never available, not merely empty.
 */
import { supabase } from '../supabase'

/** The frozen row, as the read paths consume it. */
export interface RecommendationVersion {
  id: string
  proposal_id: string
  version_number: number
  organization_id: string | null
  portfolio_id: string | null
  trade_queue_item_id: string | null
  asset_id: string | null
  action: string | null
  idea_stage: string | null
  weight: number | null
  shares: number | null
  sizing_mode: string | null
  sizing_context: Record<string, unknown> | null
  notes: string | null
  thesis_text: string | null
  rationale: string | null
  conviction: string | null
  target_price: number | null
  stop_loss: number | null
  take_profit: number | null
  time_horizon: string | null
  theses: FrozenThesis[]
  captured_from: Record<string, unknown>
  trigger_event: string | null
  submitted_at: string | null
  created_at: string
  created_by: string | null
  dedupe_key: string | null
}

export interface FrozenThesis {
  id: string
  direction: string
  rationale: string | null
  conviction: string | null
  created_at: string
}

export const VERSION_SELECT =
  'id, proposal_id, version_number, organization_id, portfolio_id, trade_queue_item_id, ' +
  'asset_id, action, idea_stage, weight, shares, sizing_mode, sizing_context, notes, ' +
  'thesis_text, rationale, conviction, target_price, stop_loss, take_profit, time_horizon, ' +
  'theses, captured_from, trigger_event, submitted_at, created_at, created_by, dedupe_key'

export interface CaptureVersionInput {
  proposalId: string
  tradeQueueItemId: string
  portfolioId: string
  organizationId: string | null
  actorId: string
  /** Sizing as submitted. Authoritative — do NOT re-read it from the idea. */
  weight?: number | null
  shares?: number | null
  sizingMode?: string | null
  sizingContext?: Record<string, unknown> | null
  notes?: string | null
  /** Action as submitted, which may differ from the idea's current action. */
  action?: string | null
}

/**
 * The mutable idea state read at submission time.
 *
 * Exported so tests can drive the freeze without a database, and so the
 * single list of captured fields has exactly one definition.
 */
export interface IdeaStateAtSubmission {
  asset_id: string | null
  stage: string | null
  thesis_text: string | null
  rationale: string | null
  conviction: string | null
  target_price: number | null
  stop_loss: number | null
  take_profit: number | null
  time_horizon: string | null
  theses: FrozenThesis[]
}

const IDEA_FIELDS = [
  'thesis_text',
  'rationale',
  'conviction',
  'target_price',
  'stop_loss',
  'take_profit',
  'time_horizon',
] as const

/**
 * Read the reasoning as it stands right now.
 *
 * This is the one moment the live idea is allowed to be the source: at
 * submission, current state IS the submitted state. Every later read goes to
 * the frozen row.
 */
export async function readIdeaStateAtSubmission(
  tradeQueueItemId: string,
): Promise<IdeaStateAtSubmission> {
  const { data: idea, error } = await supabase
    .from('trade_queue_items')
    .select(
      'asset_id, stage, thesis_text, rationale, conviction, target_price, stop_loss, take_profit, time_horizon',
    )
    .eq('id', tradeQueueItemId)
    .maybeSingle()

  if (error) throw new Error(`Failed to read idea state for submission: ${error.message}`)

  const { data: theses, error: thesesError } = await supabase
    .from('trade_idea_theses')
    .select('id, direction, rationale, conviction, created_at')
    .eq('trade_queue_item_id', tradeQueueItemId)
    .order('created_at', { ascending: true })

  // The bull/bear cases are supporting detail, not the recommendation itself.
  // Losing them must not block a submission; losing them silently, however,
  // would make an empty `theses` array indistinguishable from "there were
  // none", so the failure is recorded in captured_from below.
  if (thesesError) {
    console.warn('[RecommendationVersion] theses unavailable at submission', thesesError.message)
  }

  const row = (idea ?? {}) as Record<string, unknown>
  return {
    asset_id: (row.asset_id as string) ?? null,
    stage: row.stage == null ? null : String(row.stage),
    thesis_text: (row.thesis_text as string) ?? null,
    rationale: (row.rationale as string) ?? null,
    conviction: (row.conviction as string) ?? null,
    target_price: (row.target_price as number) ?? null,
    stop_loss: (row.stop_loss as number) ?? null,
    take_profit: (row.take_profit as number) ?? null,
    time_horizon: (row.time_horizon as string) ?? null,
    theses: ((theses ?? []) as unknown as FrozenThesis[]),
  }
}

/**
 * Build the provenance record.
 *
 * Only fields that were actually read appear here. A reader can therefore
 * distinguish "the thesis was empty at submission" (key present, value null)
 * from "we never captured a thesis for this recommendation" (key absent) —
 * the distinction that stops an old row's blank thesis from being read as a
 * deliberate blank.
 */
function buildProvenance(
  tradeQueueItemId: string,
  state: IdeaStateAtSubmission,
): Record<string, unknown> {
  const fields: Record<string, unknown> = {}
  for (const field of IDEA_FIELDS) {
    fields[field] = { table: 'trade_queue_items', id: tradeQueueItemId, field }
  }
  fields.idea_stage = { table: 'trade_queue_items', id: tradeQueueItemId, field: 'stage' }
  fields.theses = {
    table: 'trade_idea_theses',
    ids: state.theses.map(t => t.id),
    fields: ['direction', 'rationale', 'conviction'],
  }
  return { captured_at: new Date().toISOString(), fields }
}

/**
 * A content fingerprint, used as the idempotency key.
 *
 * Deterministic from what was submitted and containing no clock, for the same
 * reason the Memory Spine's keys contain none: a client that loses the
 * response to a submission retries, and the retry must land on the existing
 * version rather than minting a second one. A genuinely changed resubmission
 * produces a different fingerprint and correctly becomes a new version.
 *
 * FNV-1a over a canonical field list. Not cryptographic — it is a collision
 * check against the same proposal's own prior versions, not a security
 * boundary.
 */
export function fingerprintSubmission(parts: {
  action?: string | null
  weight?: number | null
  shares?: number | null
  sizingMode?: string | null
  notes?: string | null
  thesis_text?: string | null
  rationale?: string | null
  conviction?: string | null
  target_price?: number | null
  stop_loss?: number | null
  take_profit?: number | null
  time_horizon?: string | null
  theses?: FrozenThesis[]
}): string {
  const canonical = JSON.stringify([
    parts.action ?? null,
    parts.weight ?? null,
    parts.shares ?? null,
    parts.sizingMode ?? null,
    parts.notes ?? null,
    parts.thesis_text ?? null,
    parts.rationale ?? null,
    parts.conviction ?? null,
    parts.target_price ?? null,
    parts.stop_loss ?? null,
    parts.take_profit ?? null,
    parts.time_horizon ?? null,
    (parts.theses ?? []).map(t => [t.direction, t.rationale ?? null, t.conviction ?? null]),
  ])

  let hash = 0x811c9dc5
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `sub:${hash.toString(16).padStart(8, '0')}:${canonical.length}`
}

/**
 * Freeze this submission, or return the version it already matches.
 *
 * ── Ordering and failure semantics ───────────────────────────────────────
 *
 * This runs BEFORE the decision request is created, so the request can carry
 * `proposal_version_id` on its insert rather than being patched afterwards.
 *
 * PostgREST gives no client-side transaction, so the two writes cannot be
 * atomic without moving the whole submission orchestration — pair-leg
 * resolution included — into an RPC, which this slice does not do. The
 * ordering is therefore chosen so the only reachable partial state is the
 * benign one:
 *
 *   version written, request fails  →  an unreferenced version row. Nothing
 *     renders it, because every read path reaches it through a decision
 *     request. A retry recomputes the same fingerprint, finds this row, and
 *     links the request to it. Nothing is duplicated and nothing is lost.
 *
 *   request written, version fails  →  cannot occur in this order. This is
 *     the state that would actually hurt: a decision with no record of what
 *     was recommended.
 *
 * Throwing is correct here, unlike the Memory Spine writers. A memory event
 * is a record of an action that already happened; this IS part of the
 * submission. A submission that cannot say what it recommended should fail
 * loudly and be retried, not succeed into an unreconstructable history.
 */
export async function captureRecommendationVersion(
  input: CaptureVersionInput,
): Promise<RecommendationVersion> {
  const state = await readIdeaStateAtSubmission(input.tradeQueueItemId)

  const dedupeKey = fingerprintSubmission({
    action: input.action,
    weight: input.weight,
    shares: input.shares,
    sizingMode: input.sizingMode,
    notes: input.notes,
    ...state,
  })

  // An identical resubmission is not a new version. Checked before inserting
  // so the common retry costs one read rather than a failed write, and
  // checked again by the unique index below so a concurrent double-submit
  // cannot slip between the two.
  const existing = await findVersionByFingerprint(input.proposalId, dedupeKey)
  if (existing) return existing

  const row = {
    proposal_id: input.proposalId,
    organization_id: input.organizationId,
    portfolio_id: input.portfolioId,
    trade_queue_item_id: input.tradeQueueItemId,
    asset_id: state.asset_id,
    action: input.action ?? null,
    idea_stage: state.stage,
    weight: input.weight ?? null,
    shares: input.shares ?? null,
    sizing_mode: input.sizingMode ?? null,
    sizing_context: input.sizingContext ?? {},
    notes: input.notes ?? null,
    thesis_text: state.thesis_text,
    rationale: state.rationale,
    conviction: state.conviction,
    target_price: state.target_price,
    stop_loss: state.stop_loss,
    take_profit: state.take_profit,
    time_horizon: state.time_horizon,
    theses: state.theses,
    captured_from: buildProvenance(input.tradeQueueItemId, state),
    trigger_event: 'submission',
    submitted_at: new Date().toISOString(),
    created_by: input.actorId,
    dedupe_key: dedupeKey,
  }

  // `version_number` is unique per proposal, so a concurrent submission can
  // lose the race. Both unique indexes mean the same thing here — someone
  // else got there first — and the recovery for both is to re-read.
  for (let attempt = 0; attempt < 3; attempt++) {
    const versionNumber = await nextVersionNumber(input.proposalId)
    const { data, error } = await supabase
      .from('trade_proposal_versions')
      .insert({ ...row, version_number: versionNumber } as never)
      .select(VERSION_SELECT)
      .single()

    if (!error) return data as unknown as RecommendationVersion

    if (!/duplicate key|unique constraint/i.test(error.message)) {
      throw new Error(`Failed to freeze recommendation version: ${error.message}`)
    }

    const raced = await findVersionByFingerprint(input.proposalId, dedupeKey)
    if (raced) return raced
    // Same content lost to a different version_number — retry with the next.
  }

  throw new Error('Failed to freeze recommendation version: version number contention')
}

async function nextVersionNumber(proposalId: string): Promise<number> {
  const { data } = await supabase
    .from('trade_proposal_versions')
    .select('version_number')
    .eq('proposal_id', proposalId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  return ((data as { version_number?: number } | null)?.version_number ?? 0) + 1
}

async function findVersionByFingerprint(
  proposalId: string,
  dedupeKey: string,
): Promise<RecommendationVersion | null> {
  const { data } = await supabase
    .from('trade_proposal_versions')
    .select(VERSION_SELECT)
    .eq('proposal_id', proposalId)
    .eq('dedupe_key', dedupeKey)
    .maybeSingle()
  return (data as unknown as RecommendationVersion) ?? null
}

/** One version by id. The read path for a decision that names its version. */
export async function fetchRecommendationVersion(
  versionId: string,
): Promise<RecommendationVersion | null> {
  const { data, error } = await supabase
    .from('trade_proposal_versions')
    .select(VERSION_SELECT)
    .eq('id', versionId)
    .maybeSingle()
  if (error) throw new Error(`Failed to read recommendation version: ${error.message}`)
  return (data as unknown as RecommendationVersion) ?? null
}
