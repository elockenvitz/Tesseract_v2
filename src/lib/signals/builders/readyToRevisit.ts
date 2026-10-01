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

  const when = parkedPhrase(input.daysOverdue)

  /**
   * One region, one job — and the first draft broke that rule.
   *
   * It put every fact label in the CHIPS and the same labels again in the
   * detail. The 390px screenshot showed what that costs: the chip row
   * overflowed and clipped "Core Equity" mid-word, the body went
   * unrendered, and the three facts appeared twice on one screen. The
   * contract warns about exactly this for metrics ("the same value on
   * screen twice... guaranteed to collide"); it applies to lists too.
   *
   * So:
   *   headline  what you did, and when
   *   metric    how long it has been
   *   body      WHAT MOVED, in one line
   *   chips     WHERE YOU LEFT IT, plus the book
   *   detail    the facts, each with its source and as-of dates
   */
  const body = input.facts.length
    ? `While it was parked: ${input.facts.map(f => f.label.toLowerCase()).join(', ')}` +
      (input.totalFactCount > input.facts.length
        ? `, and ${input.totalFactCount - input.facts.length} more.`
        : '.')
    : 'Nothing has been recorded against it since.'

  /**
   * Where you left it — short, few, and never the facts.
   *
   * These were invisible in the first draft because the fact labels had
   * taken the row. They are the thing a reader needs in order to pick the
   * work back up, so they get the chips.
   */
  const context: CardContextChip[] = []
  if (input.stage) context.push({ label: titleCase(input.stage) })
  if (input.conviction) context.push({ label: `${titleCase(input.conviction)} conviction` })
  if (!input.stage && !input.conviction) context.push({ label: 'Still undecided' })
  if (input.portfolioName) context.push({ label: input.portfolioName })

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
      name: input.companyName ?? input.symbol,
      ticker: input.symbol,
    },
    context,
    actions: {
      // `inline: false` is the rare, deliberate case the contract warns
      // about. Resuming parked work means going back to the work — there is
      // nothing to resolve from inside a card, and pretending otherwise
      // would be a button that looks like it finishes something.
      primary: { id: 'open_idea', label: 'Resume work', inline: false },
      /*
       * No quick actions.
       *
       * The obvious candidate is "snooze again", and it is wrong as a
       * button: re-parking is a decision about a date, which is the
       * one-line form on the idea itself, not a one-tap default. Giving it
       * button weight would make deferring easier than resuming on a card
       * whose entire purpose is to get the work resumed.
       */
      quick: [],
      /*
       * Re-park and dismiss live here. Non-empty by contract, and rightly:
       * a reminder you cannot put down is one people learn to scroll past,
       * which would undo the thing this card is for.
       *
       * Dismissing is personal suppression of the CARD. It does not clear
       * the obligation — only a real resume does, per the rules in
       * lib/memory/obligations — so the work stays owed and findable.
       */
      menu: [
        { id: 'snooze', label: 'Remind me later', inline: true },
        { id: 'dismiss', label: 'Not now', inline: true },
      ],
      open: { label: 'Open idea', href: '/trade-queue' },
    },
    provenance: {
      // When the work was parked — not when this ran. "Why am I seeing
      // this" has an unusually good answer on this card: because you said
      // so, on a date, and here it is.
      occurredAt: input.parkedAt,
      reason: `You asked to revisit this${input.dueAt ? ` on ${input.dueAt.slice(0, 10)}` : ''}.`,
    },
    expiry: { staleAfterDays: 30 },
    // Same claim recurring = same obligation. Deliberately NOT the idea:
    // parking the same idea again later is a new promise and deserves its
    // own card rather than being deduped against the fulfilled one.
    dedupeKey: `ready_to_revisit:${input.obligationId}`,
  })
}
