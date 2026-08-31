/**
 * What we decided, and how much of it we can actually prove.
 *
 * ── The record is `decision_requests`, not the idea's stage ───────────────
 *
 * `trade_idea_portfolios` looks like the decision track and carries
 * `decision_outcome`, `decision_reason`, `decided_by`, `decided_at`. In
 * production those columns are empty: 37 rows, 2 outcomes, 2 actors, ZERO
 * reasons. Building a memory surface on them would render a decision history
 * that is 95% blank.
 *
 * `decision_requests` is the real record -- 109 rows, 83 in the reviewing org,
 * with `status`, `reviewed_by`, `reviewed_at`, `decision_note`,
 * `submission_snapshot`, `deferred_until` and `accepted_trade_id`. It is keyed
 * on (trade_queue_item_id, portfolio_id), which is exactly the portfolio-scoped
 * identity a decision needs.
 *
 * ── Most "decision reasons" are not reasons ──────────────────────────────
 *
 * Of the 43 decision notes in the org:
 *
 *   37  "Self-proposed via Trade Lab Execute"
 *    4  "Withdrawn during cleanup -- no active recommendation for this..."
 *    1  "Backfilled: resolved by Trade Lab Execute (executed ...)"
 *    1  "i like this idea, makes sense"
 *
 * One is a human being explaining themselves. The rest are provenance strings
 * the system wrote about its own plumbing. Presenting them under "Why we
 * decided" would be the exact fabrication this surface exists to avoid, so
 * `provenanceOf` separates them and the UI labels them differently.
 *
 * The requester's `context_note` is more often genuine -- 22 of 83, 16 distinct
 * -- but it is why something was PROPOSED, not why it was DECIDED, and it is
 * labelled as such.
 *
 * ── Outcome is a category, never a grade ─────────────────────────────────
 *
 * Accepted is not good and rejected is not bad. A rejected buy that later rose
 * is not a proven mistake, and an accepted one that rose is not a proven skill.
 * So outcomes get restrained categorical chips and deliberately do NOT use the
 * critical/review/info severity palette: colouring history like an alert would
 * put a verdict on the screen that nobody computed.
 */

import type { EngagementTarget } from '../engagement'

/**
 * Every status the model defines.
 *
 * Production currently holds only accepted / withdrawn / pending; `rejected`
 * and `deferred` are real states of the workflow with zero rows today. They are
 * handled rather than assumed away, because a surface that silently drops a
 * status is a surface that loses decisions the moment someone records one.
 */
export type DecisionStatus =
  | 'pending' | 'under_review' | 'needs_discussion'
  | 'accepted' | 'accepted_with_modification'
  | 'rejected' | 'deferred' | 'withdrawn'

export const RESOLVED: ReadonlySet<DecisionStatus> = new Set<DecisionStatus>([
  'accepted', 'accepted_with_modification', 'rejected', 'deferred', 'withdrawn',
])

/**
 * A decision is (idea, portfolio, human outcome).
 *
 * The same idea reaching two books produces two decisions, and they can differ
 * -- a trim accepted in one fund and withdrawn in another are two separate
 * pieces of history. Nothing here is ever keyed on the idea alone.
 */
export interface DecisionRecord {
  id: string
  ideaId: string | null
  portfolioId: string
  portfolioName: string | null
  assetId: string | null
  symbol: string | null
  companyName: string | null

  status: DecisionStatus
  /** What was asked for: buy, trim, add, sell. */
  action: string | null

  /** Durable: who resolved it, and when. Null while pending. */
  decidedBy: string | null
  decidedByName: string | null
  decidedAt: string | null

  requestedByName: string | null
  requestedAt: string | null

  /** Raw text as stored. Read through `provenanceOf` before showing it. */
  decisionNote: string | null
  /** The requester's rationale at submission. Why PROPOSED, not why decided. */
  contextNote: string | null

  /** Sizing that was actually asked for. Durable at submission. */
  sizingWeight: number | null
  sizingShares: number | null
  /** Weight the book carried when this was submitted, where recorded. */
  baselineWeight: number | null

  deferredUntil: string | null

  /** Execution is a separate fact, joined not assumed. */
  execution: {
    id: string
    status: string | null
    completedAt: string | null
    executedByName: string | null
  } | null
}

/* --------------------------------------------------------------- outcomes */

/**
 * Outcome families.
 *
 * `withdrawn` is deliberately NOT folded into `rejected`. Withdrawn means the
 * requester pulled it; rejected means the PM declined it. They are different
 * pieces of history about different people, and the 29 withdrawn rows in this
 * org would otherwise read as 29 rejections nobody made.
 */
export type OutcomeKind = 'accepted' | 'declined' | 'withdrawn' | 'deferred' | 'open'

export function outcomeOf(status: DecisionStatus): OutcomeKind {
  switch (status) {
    case 'accepted':
    case 'accepted_with_modification': return 'accepted'
    case 'rejected': return 'declined'
    case 'withdrawn': return 'withdrawn'
    case 'deferred': return 'deferred'
    default: return 'open'
  }
}

export const OUTCOME_LABEL: Record<OutcomeKind, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
  deferred: 'Deferred',
  open: 'Awaiting decision',
}

/** Longer form, for the one place a status nuance is worth spelling out. */
export function statusDetail(d: DecisionRecord): string | null {
  if (d.status === 'accepted_with_modification') return 'Accepted with modification'
  if (d.status === 'under_review') return 'Under review'
  if (d.status === 'needs_discussion') return 'Needs discussion'
  return null
}

/* ------------------------------------------------------------ provenance */

/**
 * Who wrote this text, and therefore what it may be called.
 *
 * The system writes notes into the same column a person does. Matching is on
 * the literal prefixes production actually contains rather than on a fuzzy
 * heuristic, so a human note that happens to mention Trade Lab is not
 * misclassified as machinery. Anything unmatched is treated as human, because
 * the failure that matters is presenting a machine string as reasoning -- not
 * the reverse.
 */
export type Provenance = 'human' | 'system'

const SYSTEM_PREFIXES = [
  'Self-proposed via',
  'Withdrawn during cleanup',
  'Backfilled:',
  'Auto-',
  'Resolved by Trade Lab',
]

export function provenanceOf(note: string | null | undefined): Provenance | null {
  const t = (note ?? '').trim()
  if (!t) return null
  return SYSTEM_PREFIXES.some(p => t.startsWith(p)) ? 'system' : 'human'
}

/** The label the reason module is allowed to use for this text. */
export function reasonLabel(p: Provenance): string {
  return p === 'human' ? 'Why we decided' : 'System record'
}

/* ------------------------------------------------------ what we can prove */

/**
 * Which historical facts this decision actually carries.
 *
 * Used by the workspace to decide what to render, so a module never appears
 * with today's number wearing a historical label. Everything false here is a
 * gap in the data, not a gap in the UI.
 */
export interface Provable {
  /** reviewed_by + reviewed_at exist. */
  actorAndDate: boolean
  /** A human wrote the decision note. */
  humanReason: boolean
  /** The requester wrote a submission rationale. */
  submissionReason: boolean
  /** The sizing that was requested. */
  requestedSizing: boolean
  /** The book weight at submission, from submission_snapshot. */
  weightAtDecision: boolean
  /** A price was captured at decision time (decision_price_snapshots). */
  priceAtDecision: boolean
  /** An accepted_trade resolves, so execution is a fact rather than a guess. */
  execution: boolean
}

export function provable(d: DecisionRecord, priceAtDecision?: number | null): Provable {
  return {
    actorAndDate: !!d.decidedAt && !!d.decidedBy,
    humanReason: provenanceOf(d.decisionNote) === 'human',
    submissionReason: !!d.contextNote?.trim(),
    requestedSizing: d.sizingWeight != null || d.sizingShares != null,
    weightAtDecision: d.baselineWeight != null,
    priceAtDecision: priceAtDecision != null && priceAtDecision > 0,
    execution: !!d.execution,
  }
}

/**
 * Facts this product cannot reconstruct for any decision, at all.
 *
 * Stated as data rather than left implicit, so the workspace can say what it
 * does not know instead of quietly omitting it — a reader who sees no thesis
 * module cannot tell "unchanged" from "never recorded".
 */
export const NOT_RECORDED_AT_DECISION = [
  'the thesis as written that day',
  'the price target then in force',
  'the scenario ladder then in force',
  'which research had been read',
] as const

/* --------------------------------------------------------------- summary */

/** One line naming the decision, built only from durable fields. */
export function headline(d: DecisionRecord): string {
  const act = (d.action ?? 'trade').toUpperCase()
  const t = d.symbol ?? 'this name'
  return `${act} ${t} — ${OUTCOME_LABEL[outcomeOf(d.status)]}`
}

/**
 * What is worth saying about this decision beyond its label.
 *
 * Never a judgment. It states what was decided, by whom, and what followed —
 * and where nothing followed, it says that rather than implying failure.
 */
export function summaryOf(d: DecisionRecord): string {
  const t = d.symbol ?? 'this name'
  const who = d.decidedByName ?? 'someone'
  const size = d.sizingWeight != null ? ` at ${d.sizingWeight.toFixed(1)}%` : ''

  switch (outcomeOf(d.status)) {
    case 'accepted': {
      const opened = `${who} accepted a ${d.action ?? 'trade'} in ${t}${size}`
      // Three distinct states, not two. An execution that exists and has not
      // completed is neither "executed" nor "nothing was recorded" -- saying
      // the latter contradicted the chronology directly beneath it.
      if (d.execution?.completedAt) return `${opened}, and it was executed.`
      if (d.execution) return `${opened}. An execution was raised but has not completed.`
      return `${opened}. No execution is recorded against it.`
    }
    case 'declined':
      return `${who} declined a ${d.action ?? 'trade'} in ${t}${size}.`
    case 'withdrawn':
      // The requester pulled it. Nobody declined anything.
      return `The request to ${d.action ?? 'trade'} ${t}${size} was withdrawn before a decision was recorded.`
    case 'deferred':
      return d.deferredUntil
        ? `${who} deferred a ${d.action ?? 'trade'} in ${t} until ${new Date(d.deferredUntil).toLocaleDateString()}.`
        : `${who} deferred a ${d.action ?? 'trade'} in ${t}.`
    case 'open':
      return `A ${d.action ?? 'trade'} in ${t}${size} is still awaiting a decision.`
  }
}

/* --------------------------------------------------------------- ordering */

/**
 * Chronological, newest first.
 *
 * Deliberately NOT ranked by urgency, materiality or anything resembling a
 * priority score. Decisions is a memory surface: turning it into a second Today
 * would make the history a queue, and the most recent decision is the one a
 * reader is most likely looking for. Ties break on id so the list never
 * reorders between loads.
 */
export function compareDecisions(a: DecisionRecord, b: DecisionRecord): number {
  const at = a.decidedAt ?? a.requestedAt ?? ''
  const bt = b.decidedAt ?? b.requestedAt ?? ''
  if (at !== bt) return at < bt ? 1 : -1
  return a.id.localeCompare(b.id)
}

export function daysSince(iso: string | null): number | null {
  if (!iso) return null
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000))
}

/* -------------------------------------------------------------- engagement */

export function issueFor(d: DecisionRecord): string {
  return headline(d)
}

export function seedPromptFor(d: DecisionRecord, sincePct?: number | null): string {
  const t = d.symbol ?? 'this name'
  const when = d.decidedAt ? new Date(d.decidedAt).toLocaleDateString() : 'the time'
  const move = sincePct != null ? ` The stock has moved ${sincePct >= 0 ? '+' : ''}${sincePct.toFixed(1)}% since.` : ''

  switch (outcomeOf(d.status)) {
    case 'accepted':
      return `On ${when} we accepted a ${d.action ?? 'trade'} in ${t}.${move} Which assumptions behind that decision have since been tested, and which remain untested?`
    case 'declined':
      return `On ${when} we declined a ${d.action ?? 'trade'} in ${t}.${move} What would have had to be true for that to have been the wrong call, and is any of it true now?`
    case 'withdrawn':
      return `A proposed ${d.action ?? 'trade'} in ${t} was withdrawn before anyone decided.${move} What would make it worth raising again?`
    case 'deferred':
      return `We deferred a ${d.action ?? 'trade'} in ${t}.${move} What has changed since, and does the reason for waiting still hold?`
    case 'open':
      return `A ${d.action ?? 'trade'} in ${t} is still undecided.${move} What is the strongest case for acting, and for leaving it alone?`
  }
}

export function targetFor(d: DecisionRecord, sincePct?: number | null): EngagementTarget | null {
  if (!d.assetId) return null
  const chips: { label: string; value: string }[] = []
  chips.push({ label: 'Decision', value: OUTCOME_LABEL[outcomeOf(d.status)] })
  if (d.action) chips.push({ label: 'Action', value: d.action })
  if (d.decidedAt) chips.push({ label: 'Decided', value: new Date(d.decidedAt).toLocaleDateString() })
  if (d.decidedByName) chips.push({ label: 'By', value: d.decidedByName })
  if (d.sizingWeight != null) chips.push({ label: 'Sizing', value: `${d.sizingWeight.toFixed(1)}%` })
  if (d.baselineWeight != null) chips.push({ label: 'Weight then', value: `${d.baselineWeight.toFixed(1)}%` })
  if (provenanceOf(d.decisionNote) === 'human') chips.push({ label: 'Reason', value: 'recorded' })
  if (d.execution?.completedAt) chips.push({ label: 'Executed', value: new Date(d.execution.completedAt).toLocaleDateString() })
  if (sincePct != null) chips.push({ label: 'Since decision', value: `${sincePct >= 0 ? '+' : ''}${sincePct.toFixed(1)}%` })

  return {
    // The asset, which Discuss already supports. `decision` is not a
    // discussable object type and widening that constraint is not this pass's
    // business, so a thread attaches to the name and the decision travels in
    // the issue and the chips.
    objectType: 'asset',
    objectId: d.assetId,
    label: d.companyName ? `${d.symbol} — ${d.companyName}` : (d.symbol ?? 'Decision'),
    symbol: d.symbol ?? undefined,
    assetId: d.assetId,
    portfolioId: d.portfolioId,
    portfolioName: d.portfolioName ?? undefined,
    origin: { itemId: d.id, surface: 'decisions' },
    issue: {
      title: issueFor(d),
      detail: summaryOf(d),
      reason: `decision:${outcomeOf(d.status)}`,
      detectedAt: d.decidedAt ?? undefined,
    },
    seedPrompt: seedPromptFor(d, sincePct),
    contextChips: chips,
  }
}
