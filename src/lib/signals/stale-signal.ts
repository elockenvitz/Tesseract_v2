/**
 * The unreviewed-change rule, with nothing else attached.
 *
 * Pure by necessity, not by taste. This lives apart from `useDerivedInsights`
 * because that hook imports `supabase`, and the card gallery is a standalone
 * Vite entry with no Supabase env where `supabase.ts` throws at module load —
 * so a fixture importing the copy helper through the hook takes the whole
 * gallery down, React never mounts, and every layout assertion fails at once
 * with no test naming the cause. That has happened twice here already. Same
 * split, same reason, as `feed-feedback` versus `feed-feedback-log`.
 *
 * The hook re-exports all of this, so callers do not need to know.
 */

import {
  BASELINE_TOLERANCE_DAYS, DAY_MS, LONG_SILENCE_DAYS,
  MATERIAL_WEIGHT_PCT, MOVE_PCT, STALE_DAYS,
} from './thresholds'

/**
 * Re-exported so the hook keeps one import site while the numbers themselves
 * live in `thresholds.ts` — see that file for why they are collected there.
 */
export { BASELINE_TOLERANCE_DAYS, DAY_MS, STALE_DAYS }

export type StaleContextKind =
  /** The price has moved materially since the view was last touched. */
  | 'price_move'
  /** A large position, silent for long enough that size alone earns a look. */
  | 'material_position'

export interface StaleContext {
  kind: StaleContextKind
  /** The facts, for the headline and for "why this surfaced". Never inferred. */
  movePct?: number
  weightPct?: number
  days: number
}

// The rule's numbers, and the reasoning for each, live in `thresholds.ts`.

/**
 * The trigger rule, as one pure function.
 *
 * Extracted so the rule can be tested directly. Buried inside the query it was
 * only reachable through a mocked Supabase client, which meant the interesting
 * cases — silence with no move, a move with no baseline, size just under the
 * bar — were tested by proxy or not at all.
 *
 * Returns null for "no reason to raise this", which is the common case and the
 * point of the phase.
 */
export function staleContextFor(input: {
  days: number
  /** Null when there is no usable baseline. Never substitute a zero here. */
  movePct: number | null
  weightPct: number | null
}): StaleContext | null {
  const { days, movePct, weightPct } = input
  if (days < STALE_DAYS) return null

  // Something changed and the view did not follow. The strong case.
  if (movePct != null && Math.abs(movePct) >= MOVE_PCT) {
    return { kind: 'price_move', movePct, days, weightPct: weightPct ?? undefined }
  }

  // Size alone is not an event — nothing happened, the position is simply large
  // and old — so it waits three times as long and never outranks a real change.
  if (weightPct != null && weightPct >= MATERIAL_WEIGHT_PCT && days >= LONG_SILENCE_DAYS) {
    return { kind: 'material_position', weightPct, days }
  }

  return null
}

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

/**
 * How the qualifying card describes itself.
 *
 * Pure and beside the rule that produces the context, because the copy IS the
 * rule made visible: the headline has to name whichever ingredient fired, and
 * the two paths say genuinely different things. A single sentence with the
 * numbers swapped in would claim an event on the size-alone path, where nothing
 * happened.
 */
export function staleCopy(input: {
  symbol: string
  context: StaleContext
  portfolioName?: string | null
}): { headline: string; body: string } {
  const { symbol, context, portfolioName } = input
  const where = portfolioName ?? 'the book'

  if (context.kind === 'price_move') {
    const move = Math.abs(context.movePct!).toFixed(0)
    const dir = context.movePct! >= 0 ? 'up' : 'down'
    return {
      // Names the CHANGE, not the silence.
      headline: `${symbol} has moved ${move}% since anyone last looked`,
      body: `The price is ${dir} ${move}% since the last recorded view${
        context.weightPct != null ? `, and it is ${context.weightPct.toFixed(1)}% of ${where}` : ''
      }. No thesis, judgment or decision has been recorded since.`,
    }
  }

  const weight = context.weightPct!.toFixed(1)
  return {
    headline: `${symbol} is a ${weight}% position nobody has revisited`,
    // Says plainly that nothing happened, so the card is not read as an event.
    body: `It is ${weight}% of ${where} and nothing has been recorded against it for ${context.days} days. Nothing has happened to it either; it is simply large and unexamined.`,
  }
}

