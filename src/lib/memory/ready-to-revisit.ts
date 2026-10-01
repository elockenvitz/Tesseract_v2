/**
 * READY TO REVISIT — the first candidate that exists because of memory.
 *
 * ── What makes this different from every other producer ─────────────────
 *
 * Every other evaluator in the product infers that something deserves
 * attention: a thesis looks stale, a proposal has waited, a reconciliation
 * did not match. Those are the system's opinions, and they are reasonable
 * ones, but the user never asked for any of them.
 *
 * This one exists because a person explicitly said "bring this back to me
 * on the 15th". The claim is not "we think you should look at this" — it is
 * "you told us to show you this today, and here is what moved while you
 * were gone". That is the difference between a product that nags and a
 * product that remembers, and it is why this candidate is allowed to be
 * confident where the others hedge.
 *
 * Generic staleness is deliberately NOT this. An idea nobody touched for
 * three weeks is `THESIS_STALE`'s business. This family is only ever
 * intentional parking.
 *
 * ── Ownership ────────────────────────────────────────────────────────────
 *
 * The producer makes the claim. It does not rank it, draw it, or decide
 * which surface shows it — see `lib/feed/candidate`. Facts come from
 * `what-changed`, which is deterministic; nothing here asks a model
 * anything.
 */
import type { FeedCandidate } from '../feed/candidate'
import { candidateToDecisionItem } from '../feed/to-decision-item'
import type { DecisionItem } from '../../engine/decisionEngine/types'
import type { RevisitCandidate } from './due-obligations'
import { OBLIGATION_KINDS } from './obligations'
import { renderableFacts, type ChangeFact } from './what-changed'

export const READY_TO_REVISIT_KIND = 'READY_TO_REVISIT'

/** How many facts a tile shows before it becomes a wall. */
export const MAX_FACTS_SHOWN = 3

export interface ReadyToRevisitInput {
  candidates: RevisitCandidate[]
  /** Facts by `tradeQueueItemId`, from `fetchChangeFacts`. */
  factsBySubject: Map<string, ChangeFact[]>
  /** Candidate ids the reader has personally dismissed. */
  dismissedIds?: ReadonlySet<string>
  now: Date
}

/**
 * Is this worth putting in front of someone?
 *
 * Every clause is a reason NOT to show it, and each one is a real case:
 *
 *   not due            they asked for the 15th; today is the 3rd.
 *   unresolved         RLS hid the subject, or the row is gone. A candidate
 *                      that cannot name what it is about must not speak.
 *   terminal           decided, archived or deleted while parked. The
 *                      obligation stays open — only a real action clears
 *                      it and nobody performed one — but there is nothing
 *                      to resume.
 *   dismissed          the reader already said not this. Honoured here
 *                      rather than at render, so a dismissed candidate does
 *                      not occupy a ranking slot.
 *
 * Cleared obligations never reach this function: `fetchObligations` filters
 * on `cleared_at is null`, which is why there is no clause for it.
 */
export function isEligible(
  c: RevisitCandidate,
  dismissedIds: ReadonlySet<string> | undefined,
): boolean {
  if (c.dueState !== 'due') return false
  if (!c.resolved) return false
  if (c.terminal) return false
  if (dismissedIds?.has(candidateId(c))) return false
  return true
}

/**
 * Stable across regenerations.
 *
 * The obligation's id and nothing time-varying. An id carrying the day
 * count would change every morning and make each dismissal an orphan — the
 * defect `lib/attention-state/suppression` documents and two existing
 * producers already have.
 */
export function candidateId(c: RevisitCandidate): string {
  return `ready-to-revisit-${c.obligationId}`
}

/**
 * The claim, in the product's own words.
 *
 * Says what is true and no more. It does not say why the work was parked —
 * we recorded that it WAS, never the reasoning — and it does not interpret
 * the facts it carries.
 */
function reasonFor(c: RevisitCandidate, factCount: number): string {
  const when =
    c.daysOverdue <= 0 ? 'today'
    : c.daysOverdue === 1 ? 'yesterday'
    : `${c.daysOverdue} days ago`

  const subject = c.kind === OBLIGATION_KINDS.decisionRevisit ? 'this recommendation' : 'this idea'
  const head = `You asked to revisit ${subject} ${when}.`
  return factCount > 0 ? `${head} Some things changed while it was parked.` : head
}

/**
 * Severity, from the user's own schedule.
 *
 * Deliberately shallow. An obligation a month overdue is louder than one
 * due this morning, and that is the whole of it — this producer has no
 * opinion about whether the underlying idea is important, because the user
 * already expressed theirs by parking it.
 */
function severityFor(daysOverdue: number): FeedCandidate['severity'] {
  if (daysOverdue >= 14) return 'orange'
  if (daysOverdue >= 1) return 'yellow'
  return 'info'
}

/**
 * Produce the candidates.
 *
 * Pure: takes resolved obligations and pre-fetched facts, returns claims.
 * No I/O, so it is testable without a database and cannot introduce a
 * per-candidate query.
 */
export function readyToRevisitCandidates(input: ReadyToRevisitInput): FeedCandidate[] {
  const out: FeedCandidate[] = []

  for (const c of input.candidates) {
    if (!isEligible(c, input.dismissedIds)) continue

    // Keyed by the idea. For a deferred recommendation the subject is the
    // decision request, and the facts were gathered against the idea
    // behind it — looking them up by subjectId would quietly return none.
    const facts = renderableFacts(input.factsBySubject.get(c.ideaId ?? c.subjectId) ?? [])
    const shown = facts.slice(0, MAX_FACTS_SHOWN)

    out.push({
      id: candidateId(c),
      kind: READY_TO_REVISIT_KIND,
      subjectType: c.kind === OBLIGATION_KINDS.decisionRevisit ? 'decision' : 'idea',
      subjectId: c.subjectId,
      organizationId: '',
      reason: reasonFor(c, shown.length),
      severity: severityFor(c.daysOverdue),
      // When they parked it. What "how long has this been waiting" measures
      // from — not when the obligation came due, and not when this ran.
      occurredAt: c.parkedAt,
      facts: {
        symbol: c.symbol,
        companyName: c.companyName,
        portfolioName: c.portfolioName,
        portfolioId: c.portfolioId,
        assetId: c.assetId,
        parkedAt: c.parkedAt,
        dueAt: c.dueAt,
        daysOverdue: c.daysOverdue,
        daysParked: c.daysParked,
        // Where you left it. Canonical columns, rendered only if present.
        stage: c.stage,
        conviction: c.conviction,
        // The deterministic changes, flattened so the contract stays a
        // record of scalars. The full objects travel in `changeFacts`.
        changeCount: facts.length,
        changeSummary: shown.map(f => f.label).join(' · ') || null,
      },
      provenance: {
        producer: 'evaluator:readyToRevisit',
        sourceType: 'memory_obligations',
        sourceId: c.obligationId,
      },
      // The reason this exists at all. Not decoration: a reader can follow
      // it to the row that says a person asked for this.
      memoryRefs: [{ kind: 'obligation', id: c.obligationId }],
      actions: [
        { actionKey: 'RESUME_WORK', payload: { tradeQueueItemId: c.subjectId, href: c.href } },
      ],
    })
  }

  return out
}

/**
 * The same claims, drawn the way the current surfaces draw things.
 *
 * `decisionTier: 'coverage'` deliberately. Parked work is the reader's own
 * queue, not a capital or integrity event, and the tier dominates ranking —
 * promoting it would let a quiet reminder outrank an unreconciled trade.
 * The small `userRequested` bonus lifts it within its tier instead.
 */
export function evaluateReadyToRevisit(input: ReadyToRevisitInput): DecisionItem[] {
  return readyToRevisitCandidates(input).map(c =>
    candidateToDecisionItem(c, {
      title: 'Ready to revisit',
      titleKey: READY_TO_REVISIT_KIND,
      category: 'process',
      decisionTier: 'coverage',
      userRequested: true,
      chips: [
        { label: 'Ticker', value: String(c.facts?.symbol ?? '') },
        { label: 'Portfolio', value: String(c.facts?.portfolioName ?? '') },
        { label: 'Parked', value: `${c.facts?.daysParked ?? 0}d` },
      ],
      ctaLabels: { RESUME_WORK: 'Resume work' },
    }),
  )
}

/**
 * The facts a tile should draw, in order, capped.
 *
 * Kept beside the producer so the tile and the `changeSummary` string above
 * can never disagree about which three were chosen.
 */
export function factsForTile(
  factsBySubject: Map<string, ChangeFact[]>,
  subjectId: string,
): ChangeFact[] {
  return renderableFacts(factsBySubject.get(subjectId) ?? []).slice(0, MAX_FACTS_SHOWN)
}

/** The fact key for a candidate — its idea, falling back to its subject. */
export function factKeyFor(c: Pick<RevisitCandidate, 'ideaId' | 'subjectId'>): string {
  return c.ideaId ?? c.subjectId
}

/**
 * "Where you left it", as one line.
 *
 * Returns null when neither field is set rather than printing "Unknown ·
 * Unknown". A tile with nothing to say here should omit the section.
 */
export function whereYouLeftIt(stage: string | null, conviction: string | null): string | null {
  const parts = [
    stage ? titleCase(stage) : null,
    conviction ? `${titleCase(conviction)} conviction` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}
