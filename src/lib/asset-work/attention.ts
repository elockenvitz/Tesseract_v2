/**
 * Whose move is it?
 *
 * The Work surface splits pending decision requests into two groups, and the
 * split is a PERMISSION question, not a status question. Getting it wrong in
 * either direction is bad in a specific way:
 *
 *   · an analyst shown "Needs your action" on a request only a PM can resolve
 *     is told to do something the UI will then refuse;
 *   · a PM whose request is filed under "Awaiting others" never learns it is
 *     waiting on them.
 *
 * ── Where the permission actually comes from ─────────────────────────────
 *
 * `portfolio_team` rows for this user with `role IN ('pm','admin')`. That is
 * the same source `ThoughtsSection` uses to decide whether to render the
 * decide buttons, and reusing it is deliberate: two surfaces that compute
 * "may I decide this" differently will disagree, and the one that disagrees
 * optimistically is the one that lies.
 *
 * NOTE — there are two membership tables in this schema, `portfolio_team` and
 * `portfolio_memberships`, and a collaborator added through one is invisible
 * to code reading the other. That duplication is known and deliberately not
 * addressed here; this module follows `portfolio_team` because the decision
 * path already does. Resolving it is its own change.
 *
 * ── What this is NOT ─────────────────────────────────────────────────────
 *
 * Not a new permission model. It reads the ids the caller already fetched and
 * sorts rows into two lists. Nothing here grants anything, and the server
 * refuses a decision this function mislabels.
 */

export type DecisionRequestStatus = string | null | undefined

export interface WorkDecisionRequest {
  id: string
  /** The book the decision is for. Null means it cannot be attributed, and an
   *  unattributable request is never "yours" — see below. */
  portfolioId: string | null
  /** Who asked. */
  requestedBy: string | null
  /** Raw status from `decision_requests`. Only unresolved rows are work. */
  status: DecisionRequestStatus
  /** Seeded tutorial rows, which must never be presented as real work. */
  isExample?: boolean
}

/** Statuses that mean the request is still open. Anything else is history. */
const OPEN_STATUSES = new Set(['pending', 'open', 'submitted', 'awaiting_decision'])

export function isOpenRequest(status: DecisionRequestStatus): boolean {
  if (!status) return true   // a row with no status has not been resolved
  return OPEN_STATUSES.has(String(status).toLowerCase())
}

export interface AttentionSplit<T> {
  /** Open requests this user is empowered to resolve. */
  needsYourAction: T[]
  /** Open requests this user raised, or is otherwise watching, that someone
   *  else must resolve. */
  awaitingOthers: T[]
}

/**
 * Split open requests by who must act.
 *
 * `pmPortfolioIds` is the set of books where this user is pm or admin.
 *
 * A request lands in exactly one list, and a request that is neither mine to
 * decide nor mine to have raised lands in NEITHER — it belongs to a book I can
 * see but have no part in, and surfacing it as my attention would make the
 * count meaningless.
 */
export function splitAttention<T extends WorkDecisionRequest>(
  requests: readonly T[],
  opts: { userId: string | null | undefined; pmPortfolioIds: readonly string[] },
): AttentionSplit<T> {
  const pm = new Set(opts.pmPortfolioIds)
  const needsYourAction: T[] = []
  const awaitingOthers: T[] = []

  for (const r of requests) {
    if (!isOpenRequest(r.status)) continue
    if (r.isExample) continue

    /*
     * A request with no portfolio cannot be matched against the books this
     * user manages, so it is never claimed as theirs to decide. If they
     * raised it, it is still theirs to watch.
     */
    const mineToDecide = !!r.portfolioId && pm.has(r.portfolioId)
    const mineToWatch = !!opts.userId && r.requestedBy === opts.userId

    if (mineToDecide) needsYourAction.push(r)
    else if (mineToWatch) awaitingOthers.push(r)
  }

  return { needsYourAction, awaitingOthers }
}

/**
 * The one-line summary for the collapsed Work header.
 *
 * Returns null when there is nothing waiting, so the caller renders no
 * attention area at all rather than an empty box — an "0 items" row trains
 * people to stop reading the one place that is supposed to interrupt them.
 */
export function attentionSummary(split: AttentionSplit<unknown>): string | null {
  const you = split.needsYourAction.length
  const others = split.awaitingOthers.length
  if (you === 0 && others === 0) return null
  if (you > 0 && others > 0) {
    return `${you} need${you === 1 ? 's' : ''} your action · ${others} awaiting others`
  }
  if (you > 0) return `${you} need${you === 1 ? 's' : ''} your action`
  return `${others} awaiting others`
}
