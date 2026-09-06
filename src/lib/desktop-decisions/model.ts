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

  /**
   * The batch this trade was committed in, where it was committed in one.
   *
   * ── Why the domain needs this ────────────────────────────────────────────
   *
   * A batch is ONE decision act. Five trades approved together were one
   * thing a person did, and the five `accepted_trades` rows are its execution
   * legs. Without the batch id the two are indistinguishable downstream, and
   * a lens asking "which decisions have no reason recorded" asks five times
   * about one act.
   *
   * Both identities are kept. `execution.id` is still the individual leg and
   * is what the trade blotter, the fill and the executor belong to; this is
   * the shared act above it. Replacing one with the other would trade a
   * duplicate-question bug for a lost-detail one.
   *
   * Null is the ordinary case for a trade committed on its own, and the
   * grouping falls back to per-trade behaviour for it -- never to a
   * heuristic. Two trades on the same name, in the same book, seconds apart,
   * by the same person are still two decisions unless the database says they
   * were one.
   */
  batch: {
    id: string
    name: string | null
    /**
     * `trade_batches.description`: the closest thing the schema has to a
     * batch-level rationale, and the field the Trade Book's own batch view
     * writes when a user explains a batch. Read, never inferred.
     */
    description: string | null
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
/**
 * What this lens is FOR: the decisions that still want something.
 *
 * ── Reversing a documented decision, on purpose ──────────────────────────
 *
 * The workspace carried this note: "A grid of near-identical cards each
 * repeating 'Revisit this decision' read as an inbox to work through -- the
 * mental model this surface must not have." It was written after a stage
 * where every card shouted the same call to action, and the fix at the time
 * was to make the surface a record instead.
 *
 * The reader has now asked for the opposite, in plain terms: "I should not
 * see decisions I have made, I should see decisions I need to make or
 * decisions I have made that need rationales."
 *
 * They are right, and the old note diagnosed the wrong cause. What made the
 * surface feel like an inbox was not that it had work in it -- it was that
 * every card demanded the SAME work regardless of what it actually needed.
 * A queue of two genuinely different jobs is not that: one asks for an
 * answer, the other asks for the reasoning behind an answer already given,
 * and they are different asks that deserve different cards.
 *
 * What was decided AND explained is history. It is still readable -- nothing
 * is deleted, and the detail pane opens any record -- but it does not spend a
 * tile on a surface whose question is what needs doing.
 */
export type DecisionWork =
  | 'decide'   // nobody has answered it
  | 'explain'  // answered, with no human reason on the record

/**
 * Does a human reason exist for this decision act?
 *
 * ── Why the batch counts ─────────────────────────────────────────────────
 *
 * A batch is one act. When somebody writes down why they approved a batch,
 * they have explained every trade in it -- and `trade_batches.description` is
 * where the Trade Book's own batch view puts that text. Requiring the same
 * sentence to be copied onto all five legs would be asking a person to
 * explain one decision five times because the fills happen to be five rows.
 *
 * The reverse is refused. A note on ONE leg is not a reason for the batch:
 * `decisionNote` belongs to that trade's own request, and reading it upward
 * would let an execution remark about a partial fill stand as the rationale
 * for four unrelated names. So a leg note explains only its own leg, and a
 * batch description explains the whole act.
 */
export function hasHumanReason(d: DecisionRecord): boolean {
  if (provenanceOf(d.decisionNote) === 'human') return true
  return provenanceOf(d.batch?.description) === 'human'
}

export function workOf(d: DecisionRecord): DecisionWork | null {
  if (outcomeOf(d.status) === 'open') return 'decide'
  /*
   * A system note is not a rationale. `provenanceOf` already separates the
   * two, because "status changed by workflow" is a log line and the question
   * this lens asks is why a person chose what they chose.
   *
   * Withdrawn is deliberately excluded: the requester pulled it before anyone
   * ruled, so there is no decision to explain and asking for one would be
   * asking the desk to justify something it never did.
   */
  if (d.status === 'withdrawn') return null
  return hasHumanReason(d) ? null : 'explain'
}

/**
 * The decision act a finding belongs to.
 *
 * ── Why this is an id and not a rendered string ──────────────────────────
 *
 * Everything downstream -- a disposition, a discussion thread, an Ask AI
 * turn, a rationale someone writes, a future composer deciding two findings
 * are the same situation -- needs to agree on WHICH act it is talking about.
 * That agreement has to rest on a database id, not on a card's text or on a
 * guess from timestamps.
 *
 * Real ids only. Two trades group when the database says they were committed
 * in the same batch, and never because they share a ticker, a book, a person
 * or a minute. Those coincidences are what a heuristic would call one
 * decision, and they are routinely five.
 *
 * ── A batch only speaks for a COMMITTED act ──────────────────────────────
 *
 * The batch subject applies to a resolved record, because a batch is a record
 * of what was committed -- nothing in one is still awaiting an answer. A
 * pending request keeps its own identity even where a batch id is attached to
 * it, or an unanswered question would be filed under an act that has not
 * happened, and answering one request would look like answering the batch.
 *
 * This was found by the test that asserts eligibility is untouched: a pending
 * row carrying a batch came back as `trade_batch:...`, which is exactly the
 * confusion between decision act and execution leg this stage exists to stop.
 */
export function subjectOf(d: DecisionRecord): string {
  const committed = d.batch != null && RESOLVED.has(d.status)
  return committed ? `trade_batch:${d.batch!.id}` : `decision_request:${d.id}`
}

/**
 * One situation per decision act.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 *
 * Five trades approved as one batch, none of them explained, produced five
 * separate "no reason recorded" cards: five rows asking one question about
 * one thing somebody did. That is the repetition this lens exists to avoid,
 * arriving through the data instead of through the layout.
 *
 * Grouping applies to the EXPLAIN work only. A batch is a record of what was
 * committed, so every trade in one has already been answered; nothing in a
 * batch is ever awaiting a decision, and `decide` work stays per request
 * because each pending request is genuinely its own unanswered question.
 *
 * Legs are kept, not summarised away. The group carries every underlying
 * record so the card can say how many, which names, which books, and so a
 * reader can still open any single one.
 */
export interface DecisionSituation {
  /** `trade_batch:<id>` or `decision_request:<id>`. Stable across reloads. */
  subject: string
  work: DecisionWork
  /** The record that represents the act on a card. */
  lead: DecisionRecord
  /**
   * EVERY leg of the act, explained or not, in the order they were given.
   *
   * This used to hold only the legs that still owed a reason, which made the
   * act unable to describe itself: a batch of five where three are explained
   * is a different situation from one where none are, and a list containing
   * only the two stragglers cannot tell a reader which they are looking at.
   * "Preserves all underlying trades" means all of them.
   */
  legs: DecisionRecord[]
  /** The subset with no reason recorded -- what the card is actually asking. */
  owed: DecisionRecord[]
  batch: DecisionRecord['batch']
}

export function groupIntoSituations(rows: DecisionRecord[]): DecisionSituation[] {
  /*
   * Every leg of every batch present, gathered before anything is filtered.
   *
   * The legs of an act are not the same set as the work in it. A batch of
   * five where three carry reasons still HAS five legs, and a card that can
   * only see the two stragglers cannot say "three of five explained" -- it
   * cannot even say how big the act was. Filtering first threw that away.
   *
   * Only committed records, because `subjectOf` only grants a batch subject
   * to one: an unresolved request that happens to carry a batch id is its own
   * question, and counting it as a leg would inflate the act.
   */
  const membersOf = new Map<string, DecisionRecord[]>()
  for (const d of rows) {
    if (!d.batch || !RESOLVED.has(d.status)) continue
    const key = subjectOf(d)
    const list = membersOf.get(key)
    if (list) list.push(d)
    else membersOf.set(key, [d])
  }

  const out: DecisionSituation[] = []
  const seen = new Set<string>()

  for (const d of rows) {
    const work = workOf(d)
    if (!work) continue

    /*
     * Only a batched EXPLAIN collapses. Everything else is its own situation:
     * `subjectOf` already refuses a batch subject for anything unresolved, so
     * this and the identity rule cannot drift apart.
     */
    if (work !== 'explain' || !d.batch) {
      out.push({
        subject: subjectOf(d), work, lead: d, legs: [d], owed: [d], batch: d.batch,
      })
      continue
    }

    const key = subjectOf(d)
    if (seen.has(key)) continue
    seen.add(key)

    const legs = membersOf.get(key) ?? [d]
    out.push({
      subject: key,
      work,
      lead: d,
      legs,
      owed: legs.filter(l => !hasHumanReason(l)),
      batch: d.batch,
    })
  }

  return out
}

/**
 * Work first, and within it the thing that has waited longest.
 *
 * An unanswered request outranks an unexplained one: the book is waiting on a
 * person for the first and only on a record for the second.
 */
export function compareWork(a: DecisionRecord, b: DecisionRecord): number {
  const wa = workOf(a), wb = workOf(b)
  if (wa !== wb) return wa === 'decide' ? -1 : 1
  const at = (wa === 'decide' ? a.requestedAt : a.decidedAt) ?? ''
  const bt = (wb === 'decide' ? b.requestedAt : b.decidedAt) ?? ''
  if (at !== bt) return at < bt ? -1 : 1
  return a.id.localeCompare(b.id)
}

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
