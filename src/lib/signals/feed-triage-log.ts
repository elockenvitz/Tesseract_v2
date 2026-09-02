import type { SignalCard } from './contract'
import { dispositionEntityFor } from './dispositions'
import { syncDisposition } from './disposition-sync'
import { TRIAGE_JUDGMENT, recordTriage, triageQuietDays, type TriageAction } from './feed-triage'
import { DAY_MS } from './thresholds'

/**
 * The write half of feed triage.
 *
 * Split from `feed-triage.ts` for the same reason `feed-feedback-log` is split
 * from `feed-feedback`: this reaches Supabase and that one must not. The pure
 * half is in the gallery's import graph, and `src/lib/supabase.ts` throws at
 * module load when its environment variables are absent — a single import there
 * blanks the gallery before React mounts, and every layout test then waits out
 * its 30-second timeout reporting the wrong cause. `scripts/gallery-purity.mjs`
 * exists because that has happened three times.
 *
 * So the rule this file follows is the one already established: pure decision,
 * impure recording, and the split is where Supabase enters rather than where it
 * would be tidiest.
 */

/**
 * Snooze or Dismiss, locally and durably.
 *
 * Returns the LOCAL boolean synchronously — the caller is a click handler that
 * hides a card, and it must not wait on a round trip to do it. A control that
 * shows a confident result over a write that silently failed is worse than one
 * that admits it, and `localStorage` is the store that decides whether the card
 * comes back on the next open of THIS browser.
 *
 * The durable write follows on its own. Its failure is logged inside
 * `syncDisposition` and is not the reader's problem: the card is already gone
 * from their screen, and the worst case is that a second device asks once more.
 */
export function recordTriageDurably(
  userId: string,
  card: SignalCard,
  action: TriageAction,
  now: number = Date.now(),
): boolean {
  const stuck = recordTriage(userId, card, action, now)

  void syncDisposition({
    type: card.type,
    subject: dispositionEntityFor(card),
    // Both triage verbs are `settled` — see `TRIAGE_JUDGMENT`. Neither says the
    // finding was wrong, which is what `rejected` means, so neither writes a
    // dismissal window. The distinction between them is the number of days,
    // and that comes from `judgment-policy` rather than from here.
    kind: 'settled',
    key: TRIAGE_JUDGMENT[action].key,
    // Not a judgment about the investment. Anything reading these back to count
    // what analysts concluded must exclude `triage`, and now it can.
    intent: 'triage',
    until: now + triageQuietDays(action) * DAY_MS,
  })

  return stuck
}
