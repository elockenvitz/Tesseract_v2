/**
 * Mixes feed sources so consecutive screens are not all the same kind.
 *
 * Concatenating sources produces "all decisions, then all projects, then all
 * ideas" — every block feels like a different app, and whichever source is
 * longest buries the rest. Sorting everything by score alone does not fix it
 * either, because scores are computed per-source on different scales and one
 * source reliably wins.
 *
 * The rule here: never emit more than `maxRun` consecutive entries of the same
 * kind while any other kind still has items. Within that constraint, always
 * take the highest-scoring available entry, so relevance still drives order —
 * diversity is a tie-breaker, not a shuffle. Deliberately deterministic:
 * randomising would make the feed feel arbitrary and make bug reports
 * impossible to reproduce.
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
  { maxRun = 1, leadWith, seed }: InterleaveOptions = {}
): T[] {
  const random = seed == null ? null : makeRandom(seed)
  // Bucket, preserving each source's own ordering by score.
  const buckets = new Map<string, T[]>()
  for (const entry of entries) {
    const bucket = buckets.get(entry.kind)
    if (bucket) bucket.push(entry)
    else buckets.set(entry.kind, [entry])
  }
  for (const bucket of buckets.values()) bucket.sort((a, b) => b.score - a.score)

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
