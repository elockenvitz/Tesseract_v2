/**
 * What the feed shows once it has shown everything.
 *
 * ── The requirement ───────────────────────────────────────────────────────
 *
 * The feed has no bottom. A reader who keeps swiping keeps getting tiles, and
 * when there is no unique content left the tiles repeat rather than the scroll
 * stopping.
 *
 * And a repeat is not a replay. "The order could and should be different if
 * duplicates are showing" — so the second pass must not be the first pass
 * again, or the feed reads as a loop rather than as continuing.
 *
 * ── What was here before ──────────────────────────────────────────────────
 *
 * One source cycled. `MobileDashboard` re-emitted the derived insights once per
 * round when the server ran out of posts, and everything else — attention,
 * lenses, scenarios, news, market templates — appeared once and never again. So
 * "endless" meant an endless stream of research prompts with the rest of the
 * product missing from it.
 *
 * ── Why a rotation of the RANKED list and not of the composed one ─────────
 *
 * Rotating the composed order would be simpler and would not do the job. A
 * rotation preserves every adjacency except at one seam, so the reader meets
 * the same tiles beside the same neighbours in the same runs, just entered at a
 * different point. That is a replay with a different starting page.
 *
 * Rotating the RANKED list before composing changes what the greedy pass sees
 * at every step: a different card leads, so a different family is spaced
 * against, so different substitutions win all the way down. Same membership,
 * genuinely different sequence.
 *
 * ── Why the offset is the golden ratio and not the round number ───────────
 *
 * `round * k` for a fixed k lands on a repeating set of offsets as soon as the
 * round count and the pool size share a factor, and a pool size is arbitrary.
 * Stepping by the golden ratio is the standard way to spread successive
 * offsets over a range without repeating early — consecutive rounds land far
 * apart and the sequence does not settle into a short period.
 *
 * No clock and no randomness: the offset is a function of the round index
 * alone, so the same round always composes the same way and the feed survives
 * a remount without reordering under the reader.
 */

/** The reciprocal of the golden ratio. See the note above. */
const GOLDEN = 0.618_033_988_749_895

/**
 * Where round `n` starts in the ranked list.
 *
 * Round 0 is always the ranked order untouched, which is what keeps the first
 * pass the honest one: the most important card in the pool opens the feed, and
 * nothing about repetition reaches it.
 */
export function roundOffset(round: number, length: number): number {
  if (round <= 0 || length <= 1) return 0
  return Math.floor(length * ((round * GOLDEN) % 1)) % length
}

/**
 * One round's worth of candidates, in the order that round should compose in.
 *
 * A rotation rather than a shuffle: every card appears exactly once per round,
 * and the relative order of the cards after the cut is unchanged, so the
 * ranking still means something inside a round.
 */
export function rotateForRound<T>(items: readonly T[], round: number): T[] {
  const at = roundOffset(round, items.length)
  if (at === 0) return [...items]
  return [...items.slice(at), ...items.slice(0, at)]
}
