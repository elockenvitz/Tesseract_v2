/**
 * What can happen to a requirement, and what it is called.
 *
 * ── The defect this replaces ────────────────────────────────────────────
 *
 * One handler cycled `unchecked → completed → na → unchecked`, and the
 * controls on top of it were labelled by where the reader thought they
 * were going. So "Reopen", pressed on a finished requirement, marked it
 * Not Applicable — and because N/A counts as satisfying a stage, the
 * progress count did not move either. The reader had no way to tell.
 *
 * Here each action names its destination and is rejected from any state it
 * does not apply to. A label can no longer perform a different transition,
 * because the action IS the label.
 *
 * ── Deliberate omission ─────────────────────────────────────────────────
 *
 * There is no `completed → na`. Marking a finished requirement irrelevant
 * is two decisions — it was not done after all, and it did not need doing
 * — so it takes two actions: Reopen, then Mark not applicable. That is the
 * explicit sequence rather than a shortcut that quietly discards a
 * completion and its attribution.
 *
 * ── What is preserved ───────────────────────────────────────────────────
 *
 * The stored vocabulary is unchanged: `unchecked | completed | na` in
 * `asset_checklist_items.status`, with `completed` boolean alongside it.
 * `na` still satisfies a stage requirement — `isItemDone` in
 * `InvestmentTimeline` treats `completed` and `na` alike, and nothing here
 * changes that rule.
 */

/** As stored in `asset_checklist_items.status`. */
export type RequirementStatus = 'unchecked' | 'completed' | 'na'

export type RequirementAction = 'complete' | 'reopen' | 'mark_na' | 'restore'

/** The row shape both the rail and the cards already hold. */
export interface StatusBearing {
  status?: RequirementStatus | string | null
  completed?: boolean
}

/**
 * The status of a row, from either representation.
 *
 * `status` is authoritative; `completed` is the older column and still the
 * only signal on rows written before `status` existed.
 */
export function statusOf(item: StatusBearing): RequirementStatus {
  const s = item.status
  if (s === 'completed' || s === 'na' || s === 'unchecked') return s
  return item.completed ? 'completed' : 'unchecked'
}

/** `completed` and `na` both satisfy a stage. Unchanged, deliberately. */
export const isSatisfied = (status: RequirementStatus) =>
  status === 'completed' || status === 'na'

/** Every legal move. Anything absent here is rejected. */
const TRANSITIONS: Record<RequirementAction, { from: RequirementStatus; to: RequirementStatus }> = {
  complete: { from: 'unchecked', to: 'completed' },
  reopen: { from: 'completed', to: 'unchecked' },
  mark_na: { from: 'unchecked', to: 'na' },
  restore: { from: 'na', to: 'unchecked' },
}

export const ACTION_LABEL: Record<RequirementAction, string> = {
  complete: 'Mark complete',
  reopen: 'Reopen',
  mark_na: 'Mark not applicable',
  restore: 'Restore',
}

/**
 * The action a single control should perform in a given state — the rail's
 * circle, where there is room for one target and not three.
 *
 * N/A restores rather than completing: a requirement ruled irrelevant has
 * not been done, and the control must not claim it was.
 */
export function primaryAction(status: RequirementStatus): RequirementAction {
  if (status === 'completed') return 'reopen'
  if (status === 'na') return 'restore'
  return 'complete'
}

/**
 * The actions offered beside the primary one, where there is room for them
 * — the detail surface. Ordered as they should appear.
 */
export function secondaryActions(status: RequirementStatus): RequirementAction[] {
  return status === 'unchecked' ? ['mark_na'] : []
}

export interface TransitionResult {
  ok: boolean
  /** Only when `ok`. */
  to?: RequirementStatus
  /** Only when not `ok` — says why, for a toast rather than a throw. */
  reason?: string
}

/**
 * Whether an action applies, and where it leads.
 *
 * Rejection is a value, not an exception: a stale click arriving after
 * somebody else changed the row should tell the reader what happened, not
 * take the surface down.
 */
export function resolveTransition(from: RequirementStatus, action: RequirementAction): TransitionResult {
  const t = TRANSITIONS[action]
  if (!t) return { ok: false, reason: `Unknown action "${action}".` }
  if (t.from !== from) {
    if (action === 'mark_na' && from === 'completed') {
      return { ok: false, reason: 'Reopen this requirement before marking it not applicable.' }
    }
    return { ok: false, reason: `This requirement is ${describe(from)}, so it cannot be ${ACTION_LABEL[action].toLowerCase()}ed.` }
  }
  return { ok: true, to: t.to }
}

export function describe(status: RequirementStatus): string {
  if (status === 'completed') return 'complete'
  if (status === 'na') return 'not applicable'
  return 'open'
}

/**
 * The completion metadata a destination implies.
 *
 * `undefined` is how the existing mutation clears a column — it writes
 * `completedAt || null` — so reopening and restoring drop the timestamp and
 * the actor, which is the established behaviour and the only honest one: a
 * requirement that is open again was not completed by anybody.
 *
 * `na` keeps carrying a stamp and an actor, as it does today: somebody
 * decided it did not apply, and that decision has an author.
 */
export function completionMetadata(to: RequirementStatus, actorId: string | undefined, now = () => new Date().toISOString()) {
  const satisfied = isSatisfied(to)
  return {
    completed: to === 'completed',
    status: to,
    completedAt: satisfied ? now() : undefined,
    completedBy: satisfied ? actorId : undefined,
  }
}
