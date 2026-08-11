/**
 * Mixes feed sources so consecutive screens are not all the same kind.
 *
 * Concatenating sources produces "all decisions, then all projects, then all
 * ideas" — every block feels like a different app, and whichever source is
 * longest buries the rest. Sorting everything by score alone does not fix it
 * either, because scores are computed per-source on different scales and one
 * source reliably wins.
 *
 * Two rules:
 *
 *  1. Never emit more than `maxRun` consecutive entries of the same kind while
 *     another kind still has items, so the feed never reads as "all decisions,
 *     then all ideas".
 *  2. Within a kind, order by weighted random draw rather than by rank — a
 *     high-scoring item is very likely to appear early, but the deal is
 *     different every time.
 *
 * Rule 2 exists because rank-ordering made the feed identical on every visit.
 * The sources return the same rows in the same order, so sorting each by score
 * re-deals the same hand; varying only *which kind* comes next rotates the
 * same cards past the reader. Importance should bias position, not fix it.
 *
 * Randomness is seeded, not `Math.random()`: a given render is reproducible,
 * so the order is stable while the user scrolls and a bug report can be
 * replayed. A refresh passes a new seed and genuinely re-deals.
 */

export interface InterleavableEntry {
  /** Source bucket — 'attention', 'idea', 'news'… */
  kind: string
  /** Higher is more relevant. Only compared within a kind. */
  score: number
}

export interface InterleaveOptions {
  /** Max consecutive entries of one kind before another must be emitted. */
  maxRun?: number
  /**
   * Kinds that may lead regardless of score. Used so the single most pressing
   * decision opens the feed even when an idea outranks it on its own scale.
   */
  leadWith?: string
  /**
   * Varies which kind is chosen at each step. Without it, strict
   * highest-score-first with maxRun=1 produces a fixed rotation —
   * attention, idea, signal, attention, idea, signal — which reads as
   * "sorted by type" even though it is technically interleaved.
   *
   * Seeded rather than `Math.random()` so a given feed render is
   * reproducible: pass a per-mount seed and the order varies between
   * refreshes but is stable while the user scrolls, and a bug report can
   * be replayed.
   */
  seed?: number
  /**
   * How strongly rank should determine position *within* a kind.
   *
   *   0    — ignore score; a uniform shuffle.
   *   1    — probability proportional to weight.
   *   2–3  — the top few items are very likely to lead, the tail still moves.
   *   Infinity — strict rank order (the old behaviour).
   *
   * Applies only when `seed` is set. Default 2: the feed opens with something
   * that genuinely matters most of the time, without ever being the same
   * deal twice.
   */
  priorityBias?: number
}

/**
 * Order items so higher-scoring ones are *likely* to come first without being
 * guaranteed to — Efraimidis–Spirakis weighted sampling without replacement.
 *
 * Each item draws a key of `u^(1/w)`; sorting by that key descending yields a
 * permutation where the chance of an item leading is proportional to its
 * weight. Raising the normalised score to `bias` sharpens or flattens that
 * preference.
 *
 * This is the piece that makes the feed feel alive. Sorting each source
 * strictly by score is what made every visit identical: the sources return the
 * same rows in the same order, so a deterministic sort re-deals exactly the
 * same hand, and shuffling only *which kind* comes next just rotates the same
 * cards past the reader.
 */
function weightedOrder<T extends InterleavableEntry>(
  items: T[],
  random: () => number,
  bias: number
): T[] {
  if (items.length < 2) return items
  if (!Number.isFinite(bias)) return [...items].sort((a, b) => b.score - a.score)

  const scores = items.map(i => i.score)
  const min = Math.min(...scores)
  const max = Math.max(...scores)
  const span = max - min

  return items
    .map(item => {
      // Normalise into (0,1]. The floor keeps the weakest item's weight above
      // zero so it can still surface occasionally rather than being pinned to
      // the bottom of every deal.
      const normalised = span > 0 ? (item.score - min) / span : 1
      const weight = Math.pow(0.05 + 0.95 * normalised, bias)
      const u = Math.max(random(), Number.EPSILON)
      return { item, key: Math.pow(u, 1 / weight) }
    })
    .sort((a, b) => b.key - a.key)
    .map(entry => entry.item)
}

/** Small deterministic PRNG (mulberry32). Adequate for shuffling a feed. */
function makeRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function interleaveByKind<T extends InterleavableEntry>(
  entries: T[],
  { maxRun = 1, leadWith, seed, priorityBias = 2 }: InterleaveOptions = {}
): T[] {
  const random = seed == null ? null : makeRandom(seed)
  // Bucket, preserving each source's own ordering by score.
  const buckets = new Map<string, T[]>()
  for (const entry of entries) {
    const bucket = buckets.get(entry.kind)
    if (bucket) bucket.push(entry)
    else buckets.set(entry.kind, [entry])
  }
  // Within a kind: weighted-random when seeded, strict rank otherwise. The
  // unseeded path stays deterministic so tests and bug reports can rely on it.
  for (const [kind, bucket] of buckets) {
    buckets.set(
      kind,
      random ? weightedOrder(bucket, random, priorityBias) : bucket.sort((a, b) => b.score - a.score)
    )
  }

  const out: T[] = []

  // Optional lead item: the most pressing entry of one kind opens the feed, so
  // something urgent is never pushed below content that merely scores well.
  if (leadWith) {
    const lead = buckets.get(leadWith)
    if (lead?.length) out.push(lead.shift() as T)
  }

  let runKind: string | null = out.length ? out[out.length - 1].kind : null
  let runLength = out.length ? 1 : 0

  while (true) {
    const available = [...buckets.entries()].filter(([, items]) => items.length > 0)
    if (!available.length) break

    // Prefer a kind that would not extend the current run.
    const eligible = available.filter(([kind]) => !(kind === runKind && runLength >= maxRun))
    const pool = eligible.length ? eligible : available

    let bestKind: string
    if (random) {
      // Weighted pick among the permitted kinds. Weighting by remaining count
      // keeps a large source flowing rather than starving behind a small one,
      // while the randomness stops the output settling into a fixed rotation.
      const weights = pool.map(([, items]) => items.length)
      const total = weights.reduce((a, b) => a + b, 0)
      let roll = random() * total
      bestKind = pool[pool.length - 1][0]
      for (let i = 0; i < pool.length; i++) {
        roll -= weights[i]
        if (roll <= 0) {
          bestKind = pool[i][0]
          break
        }
      }
    } else {
      // Highest-scoring head among the permitted kinds.
      bestKind = pool[0][0]
      let bestScore = pool[0][1][0].score
      for (const [kind, items] of pool) {
        if (items[0].score > bestScore) {
          bestScore = items[0].score
          bestKind = kind
        }
      }
    }

    const chosen = buckets.get(bestKind)!.shift() as T
    out.push(chosen)

    if (bestKind === runKind) {
      runLength += 1
    } else {
      runKind = bestKind
      runLength = 1
    }
  }

  return out
}
