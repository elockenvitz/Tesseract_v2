/**
 * The card for work the reader parked and asked to see again.
 *
 * ── What makes it different on screen ────────────────────────────────────
 *
 * Every other card in the feed opens by telling the reader something they
 * did not know. This one opens by reminding them of something they decided:
 * "You parked NVDA 11 days ago." The authority comes from their own past
 * action, not from the system's analysis, and the copy is written to keep
 * that distinction audible.
 *
 * The structure follows it:
 *
 *   headline     what you did, and when          (your decision)
 *   body         where you left it               (your state)
 *   context      what moved while you were gone  (our facts)
 *   prompt       the question you now face
 *   action       back to the work
 *
 * ── The empty case is a first-class case ─────────────────────────────────
 *
 * A parked idea where nothing happened is still worth surfacing — that IS
 * the answer to "what did I miss", and it is a useful one. The card stays
 * honest rather than padding itself: no "no changes detected" filler, no
 * invented activity, and the body simply ends after where-you-left-it.
 */
import type { CardResult, CardContextChip } from '../contract'
import { suppress, emit } from '../contract'
import type { ChangeFact } from '../../memory/what-changed'

export interface ReadyToRevisitInput {
  obligationId: string
  /** The `trade_queue_items` row to return to. */
  tradeQueueItemId: string
  assetId: string | null
  symbol: string | null
  companyName: string | null
  portfolioId: string | null
  portfolioName: string | null
  /** When the user parked it. */
  parkedAt: string
  /** When they asked for it back. */
  dueAt: string | null
  daysOverdue: number
  /** Where they left it — canonical columns, either may be absent. */
  stage: string | null
  conviction: string | null
  /** Already filtered to renderable confidences and capped by the producer. */
  facts: ChangeFact[]
  /** Total found, which may exceed `facts.length`. */
  totalFactCount: number
}

/**
 * Severity from the reader's own schedule, and nothing else.
 *
 * This producer has no opinion about whether the underlying idea matters —
 * the reader already expressed theirs by parking it. All that is left to
 * grade is how long it has been sitting past the date they chose.
 */
function severityFor(daysOverdue: number): 'critical' | 'attention' | 'informational' {
  if (daysOverdue >= 14) return 'attention'
  return 'informational'
}

function titleCase(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase())
}

/** "today" / "yesterday" / "11 days ago" — never "0 days ago". */
export function parkedPhrase(daysOverdue: number): string {
  if (daysOverdue <= 0) return 'today'
  if (daysOverdue === 1) return 'yesterday'
  return `${daysOverdue} days ago`
}

/** "Researching · Medium conviction", or null when neither is known. */
export function whereYouLeftItLine(
  stage: string | null,
  conviction: string | null,
): string | null {
  const parts = [
    stage ? titleCase(stage) : null,
    conviction ? `${titleCase(conviction)} conviction` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function buildReadyToRevisitCard(input: ReadyToRevisitInput): CardResult {
  // No symbol means the subject could not be read — RLS, or the row is
  // gone. A card that cannot name what it is about must not render.
  if (!input.symbol || !input.assetId) {
    return suppress('insufficient_coverage', input.tradeQueueItemId, 'no resolvable asset')
  }

  const where = whereYouLeftItLine(input.stage, input.conviction)
  const when = parkedPhrase(input.daysOverdue)

  const body = where
    ? `You left it at ${where}.`
    : 'It is still undecided, exactly as you left it.'

  /**
   * "Since then", as chips rather than prose.
   *
   * Each is one deterministic fact with its own source. Rendering them as a
   * sentence would invite a model to join them into a narrative, and the
   * join is the part nobody can verify — "+8.4% and 3 new research items"
   * is two facts; "+8.4% on the back of new research" is a claim.
   */
  const context: CardContextChip[] = input.facts.map(f => ({
    label: f.label,
  }))

  if (input.totalFactCount > input.facts.length) {
    context.push({ label: `+${input.totalFactCount - input.facts.length} more` })
  }
  if (input.portfolioName) {
    context.push({ label: input.portfolioName })
  }

  /**
   * The metric is the wait, not a price.
   *
   * Tempting to put the price move here — it is the biggest number
   * available. But the card's claim is about memory, and a price in the
   * 38px slot would make it read as a price alert, which is the one thing
   * this card must not be mistaken for. The move stays a chip among the
   * other facts, where it is one piece of evidence rather than the point.
   */
  const metric = {
    value: `${Math.max(0, input.daysOverdue)}`,
    label: input.daysOverdue === 1 ? 'Day since you asked' : 'Days since you asked',
    direction: 'neutral' as const,
    source: 'stated' as const,
    asOf: input.dueAt ?? input.parkedAt,
  }

  return emit({
    // The obligation's id and nothing time-varying. An id carrying the day
    // count would change every morning and make each dismissal an orphan.
    id: `ready-to-revisit:${input.obligationId}`,
    type: 'ready_to_revisit',
    surface: 'workflow',
    severity: severityFor(input.daysOverdue),
    headline: `You parked ${input.symbol} ${when}`,
    metric,
    body,
    prompt: input.facts.length
      ? 'Does any of this change the call?'
      : 'Is this still worth doing?',
    entity: {
      kind: 'asset',
      id: input.assetId,
      label: input.symbol,
      sublabel: input.companyName ?? undefined,
    },
    context,
    actions: {
      primary: { id: 'open_idea', label: 'Resume work' },
    },
    provenance: {
      // Not a derivation. A row exists because a person asked for this.
      source: 'memory_obligations',
      asOf: input.parkedAt,
      detail: `You set this revisit date${input.dueAt ? ` for ${input.dueAt.slice(0, 10)}` : ''}.`,
    },
    expiry: { staleAfterDays: 30 },
    // Same claim recurring = same obligation. Not the same idea: parking it
    // again later is a new promise and deserves a new card.
    recurrenceKey: `ready_to_revisit:${input.obligationId}`,
    occurredAt: input.parkedAt,
  } as never)
}
