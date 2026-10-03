/**
 * Writing obligations.
 *
 * `authenticated` holds SELECT on `memory_obligations` and nothing else, so
 * every write here goes through a SECURITY DEFINER RPC that checks org
 * membership itself. That is the existing posture and this module does not
 * widen it — it is the reason a client cannot forge an obligation into
 * another tenant, and the reason this file contains no `.insert()`.
 *
 * ── Failure model ────────────────────────────────────────────────────────
 *
 * These never throw. The canonical column — `revisit_at`,
 * `deferred_until` — is written first and is what actually suppresses the
 * work, so a failed obligation write loses the proactive "you asked to
 * revisit this" prompt, not the parking itself. Blocking a user from
 * snoozing an idea because an append-only table was briefly unavailable
 * would be a worse product than one that occasionally fails to remind.
 *
 * The gap is recoverable: every obligation here is derivable from the
 * canonical columns, so a later sweep can raise what is missing.
 */
import { supabase } from '../supabase'
import { CLEAR_REASONS, OBLIGATION_KINDS, type ClearReason, type ObligationKind } from './obligations'

export interface SyncObligationResult {
  /** The open obligation's id, when one exists after this call. */
  obligationId: string | null
  action: 'raised' | 'superseded' | 'cleared' | 'unchanged' | 'failed'
}

/* ── Ideas ─────────────────────────────────────────────────────────────── */

export interface SyncIdeaRevisitInput {
  organizationId: string | null
  tradeQueueItemId: string
  ownerId: string
  /** Null means the snooze was cleared — cancel the obligation. */
  revisitAt: string | null
  /**
   * What the person said they were waiting for. Optional, and theirs.
   *
   * Passed straight through to the RPC. Nothing here interprets it,
   * normalises it beyond trimming, or fills it in when absent — an empty
   * reason is a true record of someone who did not give one.
   */
  waitingFor?: string | null
}

/**
 * Bring an idea's revisit obligation into line with its `revisit_at`.
 *
 * Three cases, and the awkward one is the third:
 *
 *   a date, no open obligation   raise
 *   a different date             supersede — one transaction, old row
 *                                preserved and cleared, new row raised
 *   no date                      cancel the open obligation
 *
 * Supersede rather than update, because "parked until the 15th, then moved
 * to the 30th" is two facts and the first one happened. Rewriting due_at in
 * place would make the record say the user always meant the 30th.
 *
 * Repeated clicks are safe at the database: `supersede_memory_obligation`
 * returns the existing row untouched when the date has not moved, and
 * `memory_obligations_open_uk` permits only one open obligation per
 * (org, kind, subject, owner) regardless.
 */
export async function syncIdeaRevisitObligation(
  input: SyncIdeaRevisitInput,
): Promise<SyncObligationResult> {
  if (!input.organizationId) {
    // No org means no tenancy for the row, and a tenancy-less obligation is
    // one no reader can safely show. Skip rather than guess.
    return { obligationId: null, action: 'failed' }
  }

  if (input.revisitAt) {
    return supersede({
      organizationId: input.organizationId,
      kind: OBLIGATION_KINDS.ideaRevisit,
      subjectType: 'idea',
      subjectId: input.tradeQueueItemId,
      ownerId: input.ownerId,
      dueAt: input.revisitAt,
      sourceType: 'trade_queue_items',
      sourceId: input.tradeQueueItemId,
      provenance: 'ui:snooze-idea',
      waitingFor: input.waitingFor ?? null,
    })
  }

  return clearOpen({
    organizationId: input.organizationId,
    kind: OBLIGATION_KINDS.ideaRevisit,
    subjectId: input.tradeQueueItemId,
    ownerId: input.ownerId,
    reason: CLEAR_REASONS.cancelled,
  })
}

/* ── Decisions ─────────────────────────────────────────────────────────── */

export interface SyncDecisionRevisitInput {
  organizationId: string | null
  decisionRequestId: string
  ownerId: string
  /**
   * The deferral's date. NULL when the PM deferred on a condition rather
   * than a date — see `deferral-semantics.ts`. A null-due obligation is
   * still raised: it stays outstanding and discoverable, it simply never
   * becomes automatically "due", which is the truth about what we can
   * evaluate.
   */
  deferredUntil: string | null
  /** False cancels the obligation (the deferral was resolved or undone). */
  stillDeferred: boolean
}

export async function syncDecisionRevisitObligation(
  input: SyncDecisionRevisitInput,
): Promise<SyncObligationResult> {
  if (!input.organizationId) return { obligationId: null, action: 'failed' }

  if (!input.stillDeferred) {
    return clearOpen({
      organizationId: input.organizationId,
      kind: OBLIGATION_KINDS.decisionRevisit,
      subjectId: input.decisionRequestId,
      ownerId: input.ownerId,
      reason: CLEAR_REASONS.terminal,
    })
  }

  return supersede({
    organizationId: input.organizationId,
    kind: OBLIGATION_KINDS.decisionRevisit,
    subjectType: 'decision',
    subjectId: input.decisionRequestId,
    ownerId: input.ownerId,
    dueAt: input.deferredUntil,
    sourceType: 'decision_requests',
    sourceId: input.decisionRequestId,
    provenance: 'ui:defer-recommendation',
  })
}

/* ── Clearing, from elsewhere in the lifecycle ─────────────────────────── */

/**
 * Clear an idea's revisit obligation because the work actually resumed.
 *
 * Called from the lifecycle points that mean the user came back to it — a
 * stage advance, a recommendation, a terminal outcome. NOT called when
 * someone merely views the idea: opening a page is not doing the work, and
 * an obligation that clears on sight is a reminder that deletes itself the
 * moment it is noticed.
 */
export async function clearIdeaRevisitObligation(args: {
  organizationId: string | null
  tradeQueueItemId: string
  ownerId?: string | null
  reason: ClearReason
}): Promise<SyncObligationResult> {
  if (!args.organizationId) return { obligationId: null, action: 'failed' }
  return clearOpen({
    organizationId: args.organizationId,
    kind: OBLIGATION_KINDS.ideaRevisit,
    subjectId: args.tradeQueueItemId,
    // Undefined matches any owner: whoever parked it, the work has resumed.
    ownerId: args.ownerId ?? undefined,
    reason: args.reason,
  })
}

/* ── RPC plumbing ──────────────────────────────────────────────────────── */

async function supersede(args: {
  organizationId: string
  kind: ObligationKind
  subjectType: string
  subjectId: string
  ownerId: string | null
  dueAt: string | null
  sourceType: string
  sourceId: string
  provenance: string
  waitingFor?: string | null
}): Promise<SyncObligationResult> {
  try {
    const { data, error } = await supabase.rpc('supersede_memory_obligation' as never, {
      p_org_id: args.organizationId,
      p_kind: args.kind,
      p_subject_type: args.subjectType,
      p_subject_id: args.subjectId,
      p_owner_id: args.ownerId,
      p_due_at: args.dueAt,
      p_source_type: args.sourceType,
      p_source_id: args.sourceId,
      p_provenance: args.provenance,
      // Trimmed to null here as well as in the RPC: a caller passing "   "
      // should produce the same row as one passing nothing, whichever side
      // of the wire the check happens on.
      p_waiting_for: args.waitingFor?.trim() || null,
    } as never)
    if (error) {
      console.warn(`[obligations] ${args.kind} not recorded:`, error.message)
      return { obligationId: null, action: 'failed' }
    }
    return { obligationId: (data as unknown as string) ?? null, action: 'superseded' }
  } catch (err) {
    console.warn(`[obligations] ${args.kind} not recorded:`, err)
    return { obligationId: null, action: 'failed' }
  }
}

async function clearOpen(args: {
  organizationId: string
  kind: ObligationKind
  subjectId: string
  ownerId?: string | null
  reason: ClearReason
}): Promise<SyncObligationResult> {
  try {
    let query = supabase
      .from('memory_obligations')
      .select('id')
      .eq('organization_id', args.organizationId)
      .eq('kind', args.kind)
      .eq('subject_id', args.subjectId)
      .is('cleared_at', null)
    if (args.ownerId !== undefined) {
      query = args.ownerId === null ? query.is('owner_id', null) : query.eq('owner_id', args.ownerId)
    }

    const { data, error } = await query
    if (error) {
      console.warn(`[obligations] ${args.kind} clear lookup failed:`, error.message)
      return { obligationId: null, action: 'failed' }
    }

    const rows = (data ?? []) as unknown as { id: string }[]
    if (rows.length === 0) return { obligationId: null, action: 'unchanged' }

    for (const row of rows) {
      const { error: clearErr } = await supabase.rpc('clear_memory_obligation' as never, {
        p_obligation_id: row.id,
        p_provenance: args.reason,
      } as never)
      if (clearErr) {
        console.warn(`[obligations] ${args.kind} clear failed:`, clearErr.message)
        return { obligationId: row.id, action: 'failed' }
      }
    }
    return { obligationId: rows[0].id, action: 'cleared' }
  } catch (err) {
    console.warn(`[obligations] ${args.kind} clear failed:`, err)
    return { obligationId: null, action: 'failed' }
  }
}
