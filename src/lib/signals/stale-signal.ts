/**
 * Which assets a reader has already engaged, with nothing else attached.
 *
 * ── What used to live here, and where it went ─────────────────────────────
 *
 * This file held the unreviewed-change rule: `staleContextFor` (30 days plus a
 * 15% move, or a 5% position quiet for 90) and `staleCopy`. Both are gone, and
 * they are gone rather than deprecated because the anchor they measured from
 * was wrong. `lastTouch` was the newest of any note, any quick thought and any
 * contribution in ANY section — so evidence arriving made a case look freshly
 * reviewed, and "new evidence since review" could not be expressed at all.
 *
 * The replacement is `lib/research/case-state.ts`, which anchors on non-empty
 * CORE sections only and returns one of five framings. It is pure for the same
 * reason this file is (below), so nothing about the gallery constraint changed.
 *
 * ── Why what remains is still here ────────────────────────────────────────
 *
 * `judgmentTouches` is not a research rule. It reads the FEED's disposition
 * store, which is keyed by card type and entity and belongs with the signal
 * layer, and it is consumed by the research scan as one input among several.
 * Moving it into the research domain would put a feed concern inside the case
 * model.
 *
 * Pure by necessity, not by taste. The card gallery is a standalone Vite entry
 * with no Supabase env where `supabase.ts` throws at module load — so a fixture
 * importing a helper through the hook takes the whole gallery down, React never
 * mounts, and every layout assertion fails at once with no test naming the
 * cause. That has happened twice here already.
 */

import { BASELINE_TOLERANCE_DAYS, DAY_MS } from './thresholds'

/**
 * Re-exported so the hook keeps one import site while the numbers themselves
 * live in `thresholds.ts` — see that file for why they are collected there.
 */
export { BASELINE_TOLERANCE_DAYS, DAY_MS }

/**
 * The assets a reader has engaged with by recording a judgment.
 *
 * A structured judgment IS engagement. Somebody who tapped "View holds" last
 * Tuesday revisited the investment; raising an unreviewed-change card at them
 * because no PROSE was written would punish using the feed exactly as designed.
 * The judgment layer exists so thinking can be recorded without writing.
 *
 * Pure, and separate from the store read, because the fiddly part is the key:
 * entries are `{signalType}:{entityId}` and the entity of a research card is
 * the asset, so only the first colon separates. Splitting on every colon would
 * truncate the id and the engagement would silently never match.
 */
export function judgmentTouches(
  store: Record<string, { at?: string | null }>,
): Array<{ entityId: string; at: string }> {
  const out: Array<{ entityId: string; at: string }> = []
  for (const [key, value] of Object.entries(store ?? {})) {
    const sep = key.indexOf(':')
    if (sep < 0) continue
    const entityId = key.slice(sep + 1)
    if (!entityId || !value?.at) continue
    const t = new Date(value.at).getTime()
    if (!Number.isFinite(t)) continue
    out.push({ entityId, at: new Date(t).toISOString() })
  }
  return out
}
