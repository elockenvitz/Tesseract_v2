/**
 * Process failures, as canonical candidates.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 *
 * Ideas answers "what has gone wrong with my positions?" definitively — every
 * price-versus-framework and portfolio-framework detector in the product now
 * ranks through one engine. It answers "what has gone wrong with my process?"
 * not at all. Nothing on that surface tells a reader that a trade the desk
 * approved three days ago has never been logged as executed.
 *
 * Two findings migrate here, chosen because they are the two whose semantics
 * survive normalization without inventing anything:
 *
 *   EXECUTION_NOT_CONFIRMED → `execution_unconfirmed`  tier 0
 *   OVERDUE_DELIVERABLE     → `project_overdue`        tier 3
 *
 * The other five Decision Engine evaluators stay where they are. Each needs
 * either a new type or a judgement about what it means, and doing five at once
 * would make the ranking change unreviewable.
 *
 * ── What is deliberately not carried across ───────────────────────────────
 *
 * `sortScore` and `decisionTier`. The engine ranks with its own numbers on its
 * own scale for its own surface; importing them would be a second scoring
 * system wearing `priorityFor`'s field names. Only the SEMANTICS move —
 * severity, age, entity, what kind of failure it is — and the canonical model
 * scores them the way it scores everything else.
 */

import type { Severity, SignalType } from '../signals/contract'
import type { PriorityInput } from '../signals/feed-priority'
import { scopeRelevanceFor, EMPTY_COVERAGE_INDEX, type CoverageIndex } from '../signals/coverage-relevance'
import type { DispositionMap } from '../signals/dispositions'

/** The Decision Engine's item shape, structurally. */
export interface ProcessFinding {
  id: string
  titleKey?: string
  title?: string
  description?: string
  severity: string
  createdAt?: string
  context?: {
    assetId?: string
    assetTicker?: string
    portfolioId?: string
    portfolioName?: string
    tradeIdeaId?: string
    projectId?: string
    projectName?: string
    overdueDays?: number
    action?: string
  }
  children?: ProcessFinding[]
}

export interface ProcessRankContext {
  coverageIndex?: CoverageIndex
  dispositions?: DispositionMap
}

/**
 * The engine's colour ladder, read as the contract's severity.
 *
 * `red` is `critical`, `orange` and `yellow` are `attention`, everything below
 * is informational. A direct translation rather than a re-judgement: the
 * evaluators already decided how bad each condition is from real thresholds,
 * and second-guessing that here would put the same decision in two places.
 */
function severityOf(engineSeverity: string): Severity {
  if (engineSeverity === 'red') return 'critical'
  if (engineSeverity === 'orange' || engineSeverity === 'yellow') return 'attention'
  return 'informational'
}

const MAPPED: Record<string, SignalType> = {
  EXECUTION_NOT_CONFIRMED: 'execution_unconfirmed',
  OVERDUE_DELIVERABLE: 'project_overdue',
}

/** The canonical type a process finding ranks as, or null if it should not. */
export function canonicalProcessType(titleKey: string | undefined): SignalType | null {
  if (!titleKey) return null
  return MAPPED[titleKey] ?? null
}

/**
 * Where an answer about a process finding is filed.
 *
 * ── Object identity, never the ticker ─────────────────────────────────────
 *
 * This is the part that has to be right. A process failure is about a WORKFLOW
 * OBJECT — this trade, this deliverable — not about a name. Two approved trades
 * on NVDA that are both unexecuted are two failures with two fixes, and keying
 * them on the asset would make answering one silence the other. A deliverable
 * has no asset at all.
 *
 * So the entity is the trade idea id or the deliverable id, which is stable
 * across every rebuild of the finding and is exactly what the CTA acts on.
 *
 * Returns null when the underlying object id is missing, which makes the
 * finding non-dismissible rather than dismissible under a guessed key. See
 * `processSupportsTriage`.
 */
export function processDispositionRef(
  finding: ProcessFinding,
): { type: SignalType; entityId: string } | null {
  const type = canonicalProcessType(finding.titleKey)
  if (!type) return null

  const entityId = type === 'execution_unconfirmed'
    ? finding.context?.tradeIdeaId
    // The deliverable, not the project: a project with three overdue items has
    // three findings, and collapsing them onto the project would answer all
    // three with one tap.
    : deliverableIdFrom(finding.id)

  return entityId ? { type, entityId } : null
}

/** `a4-deliverable-{id}` — the evaluator's own id carries the object. */
function deliverableIdFrom(id: string): string | undefined {
  const match = /^a4-deliverable-(.+)$/.exec(id)
  return match?.[1]
}

/**
 * Whether Snooze and Dismiss can safely act on this finding.
 *
 * ── Why both are currently false ──────────────────────────────────────────
 *
 * The Decision Engine marks both of these `dismissible: false`, and it is
 * right to. Neither is a matter of opinion: an approved trade is either logged
 * as executed or it is not, and a deliverable is either done or overdue. Both
 * resolve THEMSELVES the moment the underlying object changes — the evaluators
 * recompute from live data and stop emitting — so "snooze" would hide a fact
 * that is still true and "dismiss" would hide one the reader cannot make
 * untrue by deciding not to look at it.
 *
 * There is a second, harder reason to leave them off: durable attention state
 * — personal versus shared semantics, identity, and what a dismissal means for
 * a finding somebody else also sees — is being settled elsewhere. A process
 * failure is shared state in a way a personal thought is not, and writing a
 * personal disposition against it would prejudge that contract.
 *
 * So the row renders without those actions and keeps its CTA. Correct identity
 * and an honest absence beat action parity.
 */
export function processSupportsTriage(): boolean {
  return false
}

/**
 * A process finding, as the canonical ranker reads it.
 *
 * Returns null for a titleKey this does not map, which the caller filters —
 * so the five evaluators that have not migrated cannot leak in through a
 * default.
 */
export function processPriorityInput(
  finding: ProcessFinding,
  ctx: ProcessRankContext,
): PriorityInput | null {
  const type = canonicalProcessType(finding.titleKey)
  if (!type) return null

  const isDeliverable = type === 'project_overdue'
  const assetId = finding.context?.assetId ?? null

  return {
    id: finding.id,
    type,
    severity: severityOf(finding.severity),
    /**
     * When the failure started, not when the query ran.
     *
     * `createdAt` is `decided_at` for an unconfirmed execution and the
     * deliverable's own creation for an overdue item — both real events, so
     * recency is meaningful here in a way it was not for the generated signals.
     */
    occurredAt: finding.createdAt ?? null,
    /**
     * A trade the desk approved is a position it intends to hold; the size is
     * not on the finding, so the neutral held band applies. A deliverable is
     * not a position at all and says so.
     */
    held: !isDeliverable,
    weightPct: null,
    deviationPct: null,
    /**
     * `overdueDays` feeds the ranker's own promotion rule: `priorityFor`
     * lifts a tier-3 workflow item into tier 2 once it is severely overdue,
     * because a project three weeks late with somebody waiting is a real
     * failure rather than housekeeping. Passing it is what makes that rule
     * reachable from this source.
     */
    overdueDays: finding.context?.overdueDays ?? null,
    /**
     * Scope only where the finding genuinely has an asset.
     *
     * A deliverable is not asset-scoped, and pretending otherwise would let a
     * reader's coverage lift a piece of project admin. `scopeRelevanceFor`
     * answers `unknown` for a null id, which is neutral — the documented
     * refusal, not a penalty.
     */
    scope: scopeRelevanceFor(
      ctx.coverageIndex ?? EMPTY_COVERAGE_INDEX,
      isDeliverable ? null : assetId,
    ),
    // Not triageable yet — see `processSupportsTriage`. Reading a disposition
    // for a key nothing can write would be theatre.
    judgment: null,
  }
}

/**
 * Flatten a Decision Engine slice into leaf findings.
 *
 * Neither of the two migrated keys is rolled up today — `ROLLUP_CONFIGS`
 * covers PROPOSAL_AWAITING_DECISION, THESIS_STALE and IDEA_NOT_SIMULATED — but
 * a rollup added later would otherwise silently swallow its children, and a
 * finding that disappears because somebody grouped it is the failure mode this
 * whole line of work has been removing.
 */
export function flattenProcessFindings(
  items: readonly ProcessFinding[] | null | undefined,
): ProcessFinding[] {
  const out: ProcessFinding[] = []
  const walk = (list: readonly ProcessFinding[]) => {
    for (const item of list) {
      if (item.children?.length) walk(item.children)
      else out.push(item)
    }
  }
  walk(items ?? [])
  return out
}

/**
 * Where a reader goes to fix this, and what clears it if they do not.
 *
 * ── Navigation, never mutation ────────────────────────────────────────────
 *
 * The cockpit routes to the surface that already owns the shared write.
 * Logging an execution has permissions, a confirmation step and a trade-queue
 * UI; reproducing any of that in a feed row would be a second implementation
 * of somebody else's workflow, and the one that drifts.
 *
 * `route` mirrors the evaluator's own CTA — `OPEN_TRADE_QUEUE_EXECUTION` and
 * `OPEN_PROJECT` — so the two surfaces send a reader to the same place.
 * Returns null when the destination cannot be addressed, and the row then
 * renders no primary action rather than a button that goes nowhere.
 */
export interface ProcessResolution {
  /** Imperative and specific. Never "View". */
  label: string
  /**
   * What clears the alert, for a finding the reader cannot dismiss.
   *
   * Short enough to survive the row. It shares a line with the reason chips and
   * truncates before them, so a sentence-length note reads as a bug — the first
   * version rendered as "Clears when the execution is logge".
   */
  note: string
  /** The in-app destination. Null when there is nothing safe to route to. */
  route: { kind: 'trade-queue' | 'project'; id: string } | null
}

export function processResolution(finding: ProcessFinding): ProcessResolution | null {
  const type = canonicalProcessType(finding.titleKey)
  if (!type) return null

  if (type === 'execution_unconfirmed') {
    const tradeIdeaId = finding.context?.tradeIdeaId
    return {
      label: 'Confirm execution',
      note: 'Clears once logged',
      route: tradeIdeaId ? { kind: 'trade-queue', id: tradeIdeaId } : null,
    }
  }

  const projectId = finding.context?.projectId
  return {
    label: 'Open deliverable',
    note: 'Clears once completed',
    route: projectId ? { kind: 'project', id: projectId } : null,
  }
}
