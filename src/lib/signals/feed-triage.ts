import type { SignalCard } from './contract'
import { dispositionEntityFor, recordDisposition } from './dispositions'
import { policyForJudgment } from './judgment-policy'
import { DAY_MS } from './thresholds'

/**
 * Snooze and Dismiss, written to the store the feed already reads.
 *
 * ── Why this is four lines of glue and not a mechanism ────────────────────
 *
 * Both controls have been in every card's overflow menu since the contract was
 * written — `TRIAGE` in `builders/shared` puts them there, and the contract
 * says a card you cannot get rid of trains people to scroll past the surface.
 * Neither did anything: `MobileDashboard` passed `onSnooze={() => {}}` and
 * `onDismiss={() => {}}` at six of its seven card call sites.
 *
 * The temptation is a snooze store. There must not be one. The feed already
 * has exactly one answer to "stop showing me this for a while" — a
 * `Disposition` keyed by `type + entity`, read back through
 * `judgment-policy` when the feed is ranked — and a second store would mean two
 * rules over one surface disagreeing about how long an answer lasts. That is
 * not hypothetical: it is the bug this phase removed, where `renderCard`
 * applied `isDisposedOf`'s 90-day window on top of the policy's 30, so a card
 * could be admitted by the ranking and then render nothing at all.
 *
 * So triage is a JUDGMENT with a key of its own, classified in
 * `judgment-policy` alongside every other key the surface can write. One store,
 * one rule, one place to change the windows.
 *
 * ── What it deliberately does NOT do ──────────────────────────────────────
 *
 * No audit row, and no quick thought. `recordSignalJudgment` writes both,
 * because an analyst answering "the thesis is intact" is a decision the firm
 * should be able to find later. "Not now" is not a decision about the
 * investment — it is a statement about a screen — and filing it in the research
 * record would put housekeeping in the audit trail.
 *
 * No feed-quality telemetry either. `Dismiss` says nothing about whether the
 * card was worth raising; that claim has its own vocabulary and its own store
 * in `feed-feedback`, deliberately kept apart.
 */

export type TriageAction = 'snooze' | 'dismiss'

/**
 * The judgment each control writes.
 *
 * `kind` is `settled` rather than `rejected` on both. `rejected` means "not a
 * useful finding for this name", which is the strongest thing a reader can say
 * about the surface — and neither of these says it. Somebody clearing their
 * screen has not told us the card was wrong.
 */
export const TRIAGE_JUDGMENT: Record<TriageAction, {
  key: string
  label: string
  question: string
}> = {
  snooze: {
    key: 'feed_snoozed',
    label: 'Snooze for a week',
    question: 'Feed triage',
  },
  dismiss: {
    key: 'feed_dismissed',
    label: 'Dismiss',
    question: 'Feed triage',
  },
}

/**
 * How long the card stays away, from the one place that decides it.
 *
 * Read from `judgment-policy` rather than declared here, so the window the
 * ranking enforces and the window the record is retained for cannot drift
 * apart. `loadDispositions` drops a record once `until` has passed, so a spent
 * snooze cleans itself up.
 */
export function triageQuietDays(action: TriageAction): number {
  return policyForJudgment(TRIAGE_JUDGMENT[action].key).quietDays
}

/**
 * Record a triage decision. Returns false when storage refused the write.
 *
 * The boolean matters for the same reason it matters on a verdict: a control
 * that shows a confident result over a write that silently failed is worse than
 * one that admits it — the reader believes the card is gone, it returns
 * tomorrow, and they stop trusting the menu.
 */
export function recordTriage(
  userId: string,
  card: SignalCard,
  action: TriageAction,
  now: number = Date.now(),
): boolean {
  const j = TRIAGE_JUDGMENT[action]
  return recordDisposition(userId, card.type, dispositionEntityFor(card), {
    kind: 'settled',
    key: j.key,
    label: j.label,
    question: j.question,
    cardType: card.type,
    until: now + triageQuietDays(action) * DAY_MS,
  })
}
