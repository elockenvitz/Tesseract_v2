/**
 * The pool has to do three things, and each of them was a real defect in the
 * fixed-slice loop it replaces.
 *
 *  1. Never exceed the limit. The limit is the only protection the upstream
 *     provider and the page's own socket budget have.
 *  2. Never idle a worker while work remains. That is the whole point: the
 *     slice loop ran at the speed of its slowest member and then slept.
 *  3. Never mislabel a result. Positional pairing is what stops a slow
 *     symbol's price being attached to a fast symbol's ticker.
 */
import { describe, it, expect, vi } from 'vitest'
import { mapWithConcurrency, fulfilledValues } from '../concurrent-map'

/** A deferred, so a test can decide exactly when a given item finishes. */
function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

describe('mapWithConcurrency respects the limit', () => {
  it('never has more than `limit` calls in flight', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 30 }, (_, i) => i)

    const results = await mapWithConcurrency(items, 4, async (n) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
      return n * 2
    })

    expect(peak).toBe(4)
    expect(results).toHaveLength(30)
    expect(fulfilledValues(results)).toEqual(items.map(n => n * 2))
  })

  it('does not start more workers than there are items', async () => {
    let peak = 0, inFlight = 0
    await mapWithConcurrency([1, 2], 50, async (n) => {
      inFlight++; peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--; return n
    })
    // Two items cannot put fifty calls in the air, and a pool that opened
    // fifty sockets for two symbols would be worse than the loop it replaces.
    expect(peak).toBe(2)
  })

  it('treats a nonsensical limit as one rather than hanging', async () => {
    // A limit of 0 starting zero workers would never resolve. Hanging the
    // quote fetch forever is a worse answer than ignoring a bad argument.
    const out = await mapWithConcurrency([1, 2, 3], 0, async n => n)
    expect(fulfilledValues(out)).toEqual([1, 2, 3])
  })

  it('returns immediately for an empty list', async () => {
    const fn = vi.fn()
    expect(await mapWithConcurrency([], 5, fn)).toEqual([])
    expect(fn).not.toHaveBeenCalled()
  })
})

describe('a finished worker takes the next item at once', () => {
  it('does not wait for the slow item in its own batch', async () => {
    /*
     * THE REGRESSION THIS PINS.
     *
     * With a fixed slice of 2, items 2 and 3 cannot start until BOTH 0 and 1
     * have settled — so a slow item 0 holds up everything behind it. With a
     * pool of 2, item 1 finishing frees its worker immediately and item 2
     * starts while item 0 is still outstanding.
     *
     * Asserted on observed order, not on a clock, so it cannot flake.
     */
    const started: number[] = []
    const slow = deferred<string>()

    const items = [0, 1, 2, 3]
    const run = mapWithConcurrency(items, 2, async (n) => {
      started.push(n)
      if (n === 0) return slow.promise      // never settles until we say so
      return `done-${n}`
    })

    // Let the microtask queue drain so every freed worker has taken its next.
    await new Promise(r => setTimeout(r, 5))

    // 0 is still in flight, yet 1, 2 and 3 have all been started.
    expect(started).toEqual([0, 1, 2, 3])

    slow.resolve('done-0')
    const out = await run
    expect(fulfilledValues(out)).toEqual(['done-0', 'done-1', 'done-2', 'done-3'])
  })

  it('adds no delay of its own between items', async () => {
    /*
     * The 200 ms inter-batch sleep is what this module exists to delete. A
     * pool that reintroduced any fixed pause would pass every other test
     * here, so the absence of one is asserted directly.
     */
    const timestamps: number[] = []
    await mapWithConcurrency(Array.from({ length: 12 }, (_, i) => i), 1, async () => {
      timestamps.push(Date.now())
    })
    const gaps = timestamps.slice(1).map((t, i) => t - timestamps[i])
    // Serial, single-worker, no awaited work: every gap must be ~0.
    expect(Math.max(...gaps)).toBeLessThan(50)
  })
})

describe('a failure is isolated and positional', () => {
  it('one rejection does not cancel the rest', async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      if (n === 2) throw new Error('no price for 2')
      return n * 10
    })

    expect(out.map(r => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled', 'fulfilled'])
    expect(fulfilledValues(out)).toEqual([10, 30, 40])
    expect((out[1] as { reason: Error }).reason.message).toBe('no price for 2')
  })

  it('pairs each result with its own input, whatever order they finish in', async () => {
    /*
     * Deliberately finishes in reverse. A pool that pushed results as they
     * completed would return ['d','c','b','a'] here — and in the quote fetch
     * that is AAPL's price under NVDA's ticker, which reads as a data problem
     * rather than a bug.
     */
    const delays = [40, 30, 20, 10]
    const out = await mapWithConcurrency(['a', 'b', 'c', 'd'], 4, async (s, i) => {
      await new Promise(r => setTimeout(r, delays[i]))
      return s.toUpperCase()
    })
    expect(fulfilledValues(out)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('passes the index through, so a caller can pair on it too', async () => {
    const out = await mapWithConcurrency(['x', 'y'], 2, async (s, i) => `${i}:${s}`)
    expect(fulfilledValues(out)).toEqual(['0:x', '1:y'])
  })
})

describe('fulfilledValues', () => {
  it('drops the failures and keeps the order', () => {
    expect(fulfilledValues([
      { status: 'fulfilled', value: 1 },
      { status: 'rejected', reason: new Error('x') },
      { status: 'fulfilled', value: 3 },
    ])).toEqual([1, 3])
  })
})
