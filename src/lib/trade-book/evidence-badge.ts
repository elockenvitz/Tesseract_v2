/**
 * Trade Book — what the execution claim is actually worth.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 *
 * `tradeLifecyclePhase` derives one phase from `execution_status`,
 * `reconciliation_status` and the staleness flag, and `complete` + `matched`
 * comes out as `settled`. The phase model is correct and is NOT changed here:
 * those columns say what they say, and every filter, rollup and section
 * header in the Trade Book depends on them continuing to say it.
 *
 * What a phase cannot carry is who stands behind the claim. `settled` is
 * reached identically by:
 *
 *   - a trade the app applied to the model book and watched move
 *   - a trade a PM approved, which the pilot ASSUMED filled
 *   - a trade whose evidence row was written by a migration in April
 *   - a trade with no evidence row at all
 *
 * Tesseract has no broker or OMS connection, so in production today NONE of
 * them is externally confirmed. A green "Settled" pill on its own invites a
 * trader to stop chasing a fill that never happened.
 *
 * So the grade is rendered as a second, smaller badge beside the phase pill,
 * from `portfolio_trade_events` evidence, exactly as the `needs_review`
 * severity badge already works. Nothing about the pill, the phase, the
 * columns or the holdings math moves.
 *
 * ── Why the Trade Book badges `verified` and Outcomes does not ──────────
 *
 * `EXECUTION_PROOF_PLAIN` maps `verified` to null on purpose: on the Outcomes
 * ledger, qualifying the normal case puts a label on every row and teaches
 * the reader to skip it. The Trade Book is the surface where someone decides
 * whether a fill still needs chasing, and there "the app moved its own
 * numbers" is the single most useful thing to know. The two surfaces are
 * answering different questions, so they draw the line in different places,
 * deliberately.
 */
import type { ExecutionProof } from '../../types/decision-timeline'
import type { LifecyclePhase } from './lifecycle'

/**
 * A grade, or one of the two ways there is no grade.
 *
 * `none` and `unavailable` are kept apart because they are different claims.
 * `none` says "this trade has no execution evidence", which is a fact about
 * the trade and is true of one production row. `unavailable` says "I could
 * not find out", which is a fact about this request, and conflating them
 * would have the UI assert something it never learned.
 */
export type EvidenceState = ExecutionProof | 'none' | 'unavailable'

export interface EvidenceBadge {
  /** Short, for a badge beside the phase pill. */
  label: string
  /** The full sentence, on hover. */
  title: string
  pillClass: string
}

export const EVIDENCE_BADGE: Record<EvidenceState, EvidenceBadge> = {
  broker_confirmed: {
    label: 'Confirmed',
    title: 'Confirmed by an authority outside Tesseract.',
    pillClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  },
  verified: {
    label: 'Model',
    title:
      'Applied to the modeled book and observed there. No broker confirmed this fill.',
    pillClass: 'bg-sky-100 text-sky-800 dark:bg-sky-900/30 dark:text-sky-300',
  },
  attested: {
    label: 'Reported',
    title:
      'A person states this executed away from the app. No system observed it.',
    pillClass: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  },
  assumed: {
    label: 'Assumed',
    title:
      'Pilot policy: a PM approved, so a fill was assumed. Nobody observed or confirmed one.',
    pillClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  },
  backfilled: {
    label: 'Imported',
    title: 'The evidence for this trade was written by a migration, not by a live execution.',
    pillClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  },
  unattributed: {
    label: 'Unknown',
    title: 'The evidence for this trade records no provenance. How it executed is not known.',
    pillClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  },
  none: {
    label: 'No evidence',
    title: 'No execution evidence exists for this trade.',
    pillClass: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
  },
  unavailable: {
    label: 'Unavailable',
    title:
      'Execution evidence could not be loaded. This says nothing about whether the trade executed.',
    pillClass: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
  },
}

/**
 * Phases that assert something about execution, and so have a claim to
 * qualify.
 *
 * `queued`, `working` and `cancelled` assert the opposite or nothing at all,
 * and badging them would put evidence wording on rows where no fill has been
 * claimed. `awaiting_recon` is included because it is reached by
 * `complete` + `pending`, which is a trader saying it is done.
 */
const PHASES_CLAIMING_EXECUTION: readonly LifecyclePhase[] = [
  'settled',
  'awaiting_recon',
  'needs_review',
]

/**
 * Which evidence badge, if any, belongs on a row.
 *
 * Returns `null` when the phase makes no execution claim. Otherwise always
 * returns a state, including `none` and `unavailable`: once the UI has said
 * a trade executed, declining to say on what basis is the gap this exists to
 * close.
 */
export function evidenceStateFor(input: {
  phase: LifecyclePhase
  /** The grade, or null/undefined when the trade has no visible evidence. */
  proof: ExecutionProof | null | undefined
  /** True while the evidence read is in flight or after it failed. */
  unavailable?: boolean
}): EvidenceState | null {
  if (!PHASES_CLAIMING_EXECUTION.includes(input.phase)) return null
  if (input.unavailable) return 'unavailable'
  return input.proof ?? 'none'
}
