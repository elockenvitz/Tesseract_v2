/**
 * Activation — the four facts worth knowing about a new professional user.
 *
 * ── What activation means here ────────────────────────────────────────────
 *
 * A user is activated when BOTH are true:
 *
 *   1. Tesseract understands meaningful coverage context for them, and
 *   2. they have captured a judgment or action on a name in that context.
 *
 * Account creation is not activation. Nor is finishing a checklist — the
 * existing pilot funnel measures exactly that and reports 7 of 26 users
 * "graduated" while the whole system contains one recorded judgment, which is
 * how a funnel can be green and the product still not have happened to anyone.
 *
 * ── Why audit_events and not pilot_telemetry_events ───────────────────────
 *
 * `pilot_telemetry_events` is fire-and-forget, banner-gated, and known to
 * under-report: an event only fires if the user saw the banner that fires it,
 * so it measures banner exposure at least as much as it measures behaviour.
 * The ops funnel already has to blend it with durable artifacts to get an
 * honest number.
 *
 * `audit_events` is the durable, queryable, org-scoped, checksummed log this
 * product already keeps, and `record_judgment` — half of the activation
 * definition — is *already written there* by the mobile feed. Putting the
 * other half in the same table means activation is one query over one table
 * rather than a join across two stores with different reliability.
 *
 * It also constrains us usefully: `audit_events.entity_type` has a CHECK, and
 * `user` and `coverage` are both on it, so these milestones needed no
 * migration. `action_type` is deliberately unconstrained, so the new members
 * live in the TypeScript union and nowhere else.
 *
 * ── This is not an analytics platform ─────────────────────────────────────
 *
 * Four milestones, each written at most once per user per organization. No
 * event stream, no funnel tables, no session replay. If a fifth is ever needed
 * the bar is: would a product decision change based on it, and can it be
 * derived from what is already recorded? The second question kills most
 * candidates — "first relevant Idea viewed" survived only because nothing else
 * distinguishes "saw something about their names" from "opened the app".
 */

import { emitAuditEvent } from '../audit/audit-service'
import { supabase } from '../supabase'

/**
 * The milestones, in the order they can occur.
 *
 * `coverage_established` and `first_judgment` are the two halves of the
 * definition. `first_relevant_idea_viewed` sits between them and exists to
 * answer the one diagnostic question the other three cannot: when a user
 * establishes coverage and then never records a judgment, did the product
 * fail to surface anything, or surface something they did not act on?
 */
export type ActivationMilestone =
  | 'coverage_established'
  | 'first_relevant_idea_viewed'
  | 'first_judgment'
  | 'activated'

export const ACTIVATION_MILESTONES: readonly ActivationMilestone[] = [
  'coverage_established',
  'first_relevant_idea_viewed',
  'first_judgment',
  'activated',
] as const

/**
 * Per-session write guard, keyed `<milestone>:<user>:<org>`.
 *
 * The same lesson `usePilotProgress` learned the expensive way: milestone
 * marks are fired from effects, effects re-fire, and an unguarded mark once
 * put 10,000 rows into `pilot_telemetry_events`. Checked synchronously so
 * concurrent calls in the same microtask coordinate, and consulted BEFORE the
 * network read — a guard that only dedupes after an await does not dedupe a
 * burst.
 *
 * Session-scoped on purpose. It is a burst guard, not the source of truth:
 * `audit_events` is, and `hasMilestone` reads it.
 */
const marked = new Set<string>()

const key = (m: ActivationMilestone, userId: string, orgId: string) =>
  `${m}:${userId}:${orgId}`

/** Testing seam. */
export function __resetActivationGuard(): void {
  marked.clear()
}

export interface ActivationContext {
  userId: string
  orgId: string | null
  /** Denormalised for the audit row so the log reads without a join. */
  actorEmail?: string | null
  actorName?: string | null
}

export interface MarkMilestoneOptions {
  /** Free-form context. Kept small — this is a milestone, not a payload. */
  metadata?: Record<string, unknown>
}

/**
 * Record a milestone, at most once per user per organization.
 *
 * Returns true when this call is the one that wrote it. Fire-and-forget from
 * the caller's perspective: every failure path returns false rather than
 * throwing, because a measurement must never break the thing it measures.
 *
 * `orgId` is required by `audit_events` and there is no sensible fallback — a
 * milestone with no tenant is not attributable to anything and would corrupt
 * every per-org count. A null org is a silent no-op, matching how
 * `recordSignalJudgment` treats the same case.
 */
export async function markActivationMilestone(
  milestone: ActivationMilestone,
  ctx: ActivationContext,
  opts: MarkMilestoneOptions = {},
): Promise<boolean> {
  const { userId, orgId } = ctx
  if (!userId || !orgId) return false

  const guardKey = key(milestone, userId, orgId)
  if (marked.has(guardKey)) return false
  marked.add(guardKey)

  try {
    if (await hasMilestone(milestone, { userId, orgId })) return false

    const id = await emitAuditEvent({
      actor: { id: userId, type: 'user' },
      // The milestone is a fact about the user, so the user is the entity.
      // Anchoring it to the coverage row or the asset would make "is this user
      // activated" a question about some other object's history.
      entity: { type: 'user', id: userId, displayName: ctx.actorName ?? undefined },
      action: { type: milestone, category: 'system' },
      state: {},
      orgId,
      actorEmail: ctx.actorEmail ?? undefined,
      actorName: ctx.actorName ?? undefined,
      metadata: { ...opts.metadata, milestone },
    })

    return id !== null
  } catch {
    // Never surface. See the module comment.
    marked.delete(guardKey)
    return false
  }
}

/** Whether a milestone has already been recorded for this user in this org. */
export async function hasMilestone(
  milestone: ActivationMilestone,
  ctx: Pick<ActivationContext, 'userId' | 'orgId'>,
): Promise<boolean> {
  if (!ctx.userId || !ctx.orgId) return false

  const { data, error } = await supabase
    .from('audit_events')
    .select('id')
    .eq('entity_type', 'user')
    .eq('entity_id', ctx.userId)
    .eq('org_id', ctx.orgId)
    .eq('action_type', milestone)
    .limit(1)

  if (error) return false
  return (data?.length ?? 0) > 0
}

/**
 * Promote to activated when both halves are in place.
 *
 * Deliberately derived rather than tracked: `activated` is a conclusion about
 * two other milestones, and a separately-maintained flag is a thing that can
 * disagree with them. Call this after marking either half; it is a cheap
 * no-op once the guard has seen it.
 */
export async function evaluateActivation(ctx: ActivationContext): Promise<boolean> {
  const { userId, orgId } = ctx
  if (!userId || !orgId) return false
  if (marked.has(key('activated', userId, orgId))) return false

  const [coverage, judgment] = await Promise.all([
    hasMilestone('coverage_established', { userId, orgId }),
    hasMilestone('first_judgment', { userId, orgId }),
  ])

  if (!coverage || !judgment) return false

  return markActivationMilestone('activated', ctx, {
    metadata: { basis: 'coverage_established + first_judgment' },
  })
}
