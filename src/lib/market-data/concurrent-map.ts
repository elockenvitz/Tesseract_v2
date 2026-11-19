/**
 * Run an async function over a list, several at a time.
 *
 * ── The shape this replaces ──────────────────────────────────────────────
 *
 * The quote fetch walked its symbols in fixed slices and SLEPT between them:
 *
 *     for (let i = 0; i < symbols.length; i += 5) {
 *       await Promise.allSettled(symbols.slice(i, i + 5).map(fetchOne))
 *       if (i + 5 < symbols.length) await new Promise(r => setTimeout(r, 200))
 *     }
 *
 * Two separate costs, and the second is the larger one.
 *
 * A fixed slice runs at the speed of its SLOWEST member: four replies that
 * arrive in 80 ms wait for the fifth at 900 ms before anything else starts.
 * The sleep then adds a flat 200 ms per slice regardless of what happened.
 * Measured on the production Dashboard, 65 symbols took **7028 ms** end to
 * end while the median individual request was **152 ms**.
 *
 * A pool has neither property: a worker that finishes takes the next item
 * immediately, so the only limit is how many are allowed in the air at once.
 *
 * ── Why a limit at all, rather than firing all of them ───────────────────
 *
 * The limit is not about our own server. It is about what sits behind it:
 * the quote path proxies Yahoo, which does throttle, and a browser that
 * opens sixty-five sockets at once also starves every other request the page
 * needs — including the ones the reader is actually waiting for.
 *
 * So this bounds concurrency and does nothing else. It adds no delay, no
 * retry, no backoff and no schedule. Pacing that a provider has not asked
 * for is latency the reader pays for nothing, and the measurement that
 * motivated this module is exactly that bill.
 *
 * ── Failures ─────────────────────────────────────────────────────────────
 *
 * `settled`, like `Promise.allSettled`: one symbol that cannot be priced
 * must not cancel the other sixty-four. The caller decides what an absent
 * quote means — this returns the outcome and takes no view.
 *
 * Results come back positionally, so `out[i]` is the outcome for `items[i]`
 * no matter what order the work finished in. A caller that paired results to
 * inputs by completion order would mislabel prices, which is the kind of
 * defect that looks like a data problem for a week.
 */

/** One item's outcome, positionally matched to the input. */
export type Settled<T> =
  | { status: 'fulfilled'; value: T }
  | { status: 'rejected'; reason: unknown }

/**
 * Apply `fn` across `items` with at most `limit` calls in flight.
 *
 * `limit` is clamped to at least 1: a limit of 0 or a negative one would
 * otherwise start no workers and hang forever on a list that has work in it,
 * which is a worse failure than ignoring a nonsensical argument.
 */
export async function mapWithConcurrency<I, O>(
  items: readonly I[],
  limit: number,
  fn: (item: I, index: number) => Promise<O>,
): Promise<Settled<O>[]> {
  const out: Settled<O>[] = new Array(items.length)
  if (items.length === 0) return out

  const width = Math.max(1, Math.min(Math.floor(limit) || 1, items.length))
  let next = 0

  /*
   * Each worker pulls the next index and runs it, rather than being handed a
   * fixed share up front. A static split would reintroduce the problem this
   * module exists to remove: the worker holding the one slow symbol finishes
   * long after the others have gone idle.
   */
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        out[i] = { status: 'fulfilled', value: await fn(items[i], i) }
      } catch (reason) {
        out[i] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: width }, worker))
  return out
}

/**
 * The values from a `settled` run, with the failures dropped.
 *
 * Deliberately not a default: a caller that wants to know a symbol failed
 * reads the outcomes. This is for the common case where an absent quote and
 * a failed quote mean the same thing to the reader — nothing to show.
 */
export function fulfilledValues<O>(results: readonly Settled<O>[]): O[] {
  const out: O[] = []
  for (const r of results) if (r && r.status === 'fulfilled') out.push(r.value)
  return out
}
