import type { RankedItem } from './feed-priority'

/**
 * What the reader meets next, once the ranking has said what matters.
 *
 * ── The order this replaces ───────────────────────────────────────────────
 *
 * `MobileDashboard` composed its feed in three moves:
 *
 *   1. `diversify(ranked)` — break up runs of one SignalType.
 *   2. split the result by tier into `lead` (≤ 1) and `tail`.
 *   3. `lead ++ interleaveByKind(tail, { seed })`.
 *
 * Step 2 undoes step 1. Diversity's whole mechanism is reaching DOWN the
 * ranking for an alternative — that is what the escalating tier reach is for —
 * and then the split gathers every tier-0/1 card back together and pushes every
 * alternative it found into the tail. Measured on a reconstructed pool of 109
 * candidates: the longest single-family run is 45 before diversity, 7 after it,
 * and **45 again** after the split. The pass ran, worked, and was discarded.
 *
 * Step 3 had two more problems. `interleaveByKind` buckets by ENTRY KIND — the
 * name of the hook that produced the row — so `crowding`, `no_target`,
 * `target_hit`, `target_expired` and the two conviction types are one bucket
 * called `lens`, and `maxRun: 1` is satisfied completely by a feed that shows
 * all six back to back. And it draws with a seeded weighted random, so the tail
 * was a different order on every visit.
 *
 * ── What this does instead ────────────────────────────────────────────────
 *
 * One greedy pass over the whole ranked list, with a bounded lookahead. At each
 * step it asks: which candidates are close enough to the head to be a credible
 * substitute for it, and of those, which repeats the least of what the reader
 * just saw? Priority decides WHO MAY COMPETE; repetition decides who wins among
 * equals. Those are two separate questions and they are never blended into one
 * number, which is what makes the result explainable — see `ComposeTraceRow`.
 *
 * No seed, no clock, no randomness. The same input produces the same order.
 *
 * ── Why this is not a scoring term ────────────────────────────────────────
 *
 * Kept from `diversify`, whose reasoning was right: repetition is a property of
 * a SEQUENCE, not of a card. A card's priority must not depend on what happened
 * to precede it, or it cannot be tested, compared or explained.
 */

/** How many cards of one family may sit back to back. */
const MAX_RUN = 2

/**
 * How many cards about one NAME may sit back to back.
 *
 * Two, matching the family rule. Two findings on AAPL read as one story — the
 * position broke its framework and is also the most crowded name in the book is
 * a coherent thing to be told twice. Four consecutive AAPL cards is a briefing
 * about AAPL that the reader did not ask for.
 */
const MAX_SUBJECT_RUN = 2

/**
 * How close an alternative must be to count as a substitute.
 *
 * Inherited unchanged from `diversify`, where it was argued for: an alternative
 * may only step in when it was close to winning anyway. This is also the whole
 * of the critical-cluster override — see the note on `ComposeTraceRow.reason`.
 */
const TOLERANCE = 0.15

/**
 * How far down the tiers a substitute may come from.
 *
 * Two. The tier is the hard semantic partition — "the price has left the
 * framework" against "somebody wrote a thing" — and a news story must never be
 * pulled above a decision however monotonous the decisions get.
 */
const MAX_TIER_REACH = 2

/**
 * How far ahead to look for a substitute.
 *
 * Bounded, so the pass is O(n · LOOKAHEAD) rather than O(n²). Twelve is
 * comfortably more than the tolerance window ever contains in practice: the
 * candidates within 0.15 of the head are almost always the next few, because
 * the list is sorted by exactly that number. A larger window would find the
 * same substitute more slowly.
 */
const LOOKAHEAD = 12

/** How far back "the reader just saw this family" reaches. */
const FAMILY_WINDOW = 4

/** How far back "the reader just saw this name" reaches. */
const SUBJECT_WINDOW = 6

/**
 * A category may not take more than this many of the opening cards.
 *
 * Carried over from `diversify`, where it was introduced because a desk whose
 * decisions tier is full satisfies the family rule completely while showing one
 * category for three screens — every adjacent pair is a different family, and
 * News, which is tier 4, is never reached at all.
 *
 * A cap, not a quota: nothing is promoted to fill a category, and if no
 * credible alternative exists the cap does not bind.
 */
const OPENING = 8
const MAX_OPENING_PER_CATEGORY = 4

/**
 * What the reader asked for, which decides which rules are allowed to run.
 *
 * `mixed`     nothing selected. Category cap, family rule, name rule.
 * `category`  "show me Portfolio". Diversifying ACROSS categories would insert
 *             what they excluded, so the cap is off; the family and name rules
 *             stay, because "Portfolio" is not a request for six identical
 *             Portfolio questions.
 * `type`      "show me No core thesis". They named the family, so the family
 *             rule is off. The name rule stays: one asset can carry the same
 *             finding in several books.
 */
export type ComposeScope = 'mixed' | 'category' | 'type'

export interface ComposeOptions<T> {
  /**
   * The product family — finer than the category, and finer than `SignalType`
   * wherever one type covers two findings.
   *
   * This is the whole reason the old pass could not see the reported problem.
   * `diversify` keyed on `SignalType`, and `scenario_gap` is BOTH "a held
   * position has left its framework" (Portfolio) and "an unheld name is outside
   * its range" (Decisions), while `no_research` is both "no core thesis" and,
   * on a material position, an unwritten-position card. The reader sees four
   * different pills; the old rule saw two types.
   *
   * The vocabulary already exists and no new one is invented here — see
   * `portfolioFilterKey` and `researchFilterKey`.
   */
  familyOf: (item: T) => string | null
  /** The ticker a card is about, where it has one. */
  subjectOf: (item: T) => string | null
  /** The canonical category, for the opening cap. Omitted, the cap is off. */
  categoryOf?: (item: T) => string | null
  scope?: ComposeScope
  maxRun?: number
  maxSubjectRun?: number
  tolerance?: number
  lookahead?: number
  familyWindow?: number
  subjectWindow?: number
  /** Build the per-card explanation. Off by default; on in dev and in tests. */
  trace?: boolean
}

/**
 * Why one card ended up where it did.
 *
 * ── Why this is not optional in spirit ────────────────────────────────────
 *
 * A ranking nobody can interrogate is a ranking that rots: the next person to
 * find a card in the wrong place has no move except to add a coefficient and
 * hope. Every number here is one this pass actually read.
 *
 * `reason` is also where the critical-cluster override becomes visible. There
 * is no threshold that says "this cluster is important enough to repeat" —
 * there is only `competitors`. Three framework breaks scoring 1.00, 1.00 and
 * 0.84 against a next-best 0.83 produce an empty competitor set at the third,
 * so the run continues and the trace says `no-competitor`. The same three
 * against a 0.95 alternative produce a competitor, and it is taken. The
 * override is the relative comparison, not a finance rule bolted on top.
 */
export interface ComposeTraceRow {
  /** Position in the ranked list, before this pass. 1-based. */
  rankBefore: number
  /** Position in the composed feed. 1-based. */
  rankAfter: number
  id: string
  family: string | null
  subject: string | null
  category: string | null
  tier: number
  /** `priority.total`. */
  total: number
  /** The score this pass actually compared — total less the coverage lift. */
  comparable: number
  /** Components, for the "why is this ranked here at all" half of the question. */
  components: Record<string, number>
  /** How many candidates in the window were close enough to substitute. */
  competitors: number
  /**
   * What the head of the pool scored when this card was chosen. Equal to
   * `comparable` when this card WAS the head.
   */
  headComparable: number
  /** `comparable` minus `headComparable`. Zero or negative. */
  priorityCost: number
  reason:
    | 'head'                 // the ranking's own choice, taken untouched
    | 'no-competitor'        // head repeated, but nothing was close enough
    | 'family-run'           // pulled up because the head would repeat a family
    | 'subject-run'          // pulled up because the head would repeat a name
    | 'category-cap'         // pulled up because a category had taken the opening
    | 'recent-family'        // pulled up on the softer "seen this recently" rule
    | 'recent-subject'
}

export interface ComposeResult<T> {
  order: RankedItem<T>[]
  /** Empty unless `trace` was requested. */
  trace: ComposeTraceRow[]
}

/**
 * A card's score with the coverage lift removed.
 *
 * Inherited from `diversify`, and for the reason its comment gives: "is there a
 * credible alternative?" must not be answered by whose names the reader
 * follows. Comparing raw totals let the coverage bonus push every uncovered
 * alternative outside the tolerance, so the rule silently stopped binding and
 * the feed became nothing but covered names. Coverage still decides the ORDER,
 * through `compareRanked`; it just does not decide who counts as a competitor.
 */
const comparableTotal = <T>(r: RankedItem<T>): number =>
  r.priority.total - (r.priority.components.coverage ?? 0)

/**
 * The repetition cost of taking a candidate next, as an ordered tuple.
 *
 * ── Why a tuple and not a weighted sum ────────────────────────────────────
 *
 * A sum needs coefficients, and coefficients here would be invented: there is
 * no defensible exchange rate between "this is the third No core thesis in a
 * row" and "this is the second AAPL card in six". Comparing lexicographically
 * needs only an ORDER, and the order is a product judgement that can be stated
 * and argued with:
 *
 *   0. a category has already taken its share of the opening   (mixed only)
 *   1. taking this would run a family past `maxRun`
 *   2. taking this would run a name past `maxSubjectRun`
 *   3. this family appeared within the last `familyWindow`
 *   4. this name appeared within the last `subjectWindow`
 *
 * Hard runs before soft recency, and family before name, because a run of one
 * question is what makes a feed read as a database dump — the reported problem
 * — while a name recurring four cards later is merely a little repetitive.
 *
 * Every entry is 0 or 1, so a tuple of zeros means "nothing about this card
 * repeats anything", which is the fast path.
 */
type Cost = [number, number, number, number, number]

const costIsZero = (c: Cost) => c[0] === 0 && c[1] === 0 && c[2] === 0 && c[3] === 0 && c[4] === 0

const compareCost = (a: Cost, b: Cost): number => {
  for (let i = 0; i < 5; i++) if (a[i] !== b[i]) return a[i] - b[i]
  return 0
}

/**
 * Which dimension a substitute actually improved on, for the trace.
 *
 * The dimension the CHOSEN card beat the head on, not the head's own worst
 * dimension. Those differ, and reading the head's was actively misleading:
 * deep in the tail, where every remaining candidate is the same family, the
 * pass still swaps two of them to avoid repeating a ticker — and the trace
 * called that `family-run`, which says a family was broken up when none was.
 */
const REASON_FOR: Record<number, ComposeTraceRow['reason']> = {
  0: 'category-cap',
  1: 'family-run',
  2: 'subject-run',
  3: 'recent-family',
  4: 'recent-subject',
}

export function composeFeed<T>(
  ranked: RankedItem<T>[],
  options: ComposeOptions<T>,
): ComposeResult<T> {
  const {
    familyOf, subjectOf, categoryOf,
    scope = 'mixed',
    maxRun = MAX_RUN,
    maxSubjectRun = MAX_SUBJECT_RUN,
    tolerance = TOLERANCE,
    lookahead = LOOKAHEAD,
    familyWindow = FAMILY_WINDOW,
    subjectWindow = SUBJECT_WINDOW,
    trace = false,
  } = options

  // Nothing to arrange. Returned as-is rather than copied, so the caller's
  // identity checks are trivially true for the degenerate cases.
  if (ranked.length < 3) return { order: ranked, trace: [] }

  /** Family diversity is off when the reader named the family. */
  const familyRuleOn = scope !== 'type'
  /** The opening cap is off when the reader named the category. */
  const categoryCapOn = scope === 'mixed' && !!categoryOf

  const rankBefore = new Map<RankedItem<T>, number>()
  ranked.forEach((r, i) => rankBefore.set(r, i + 1))

  const pool = [...ranked]
  const out: RankedItem<T>[] = []
  const rows: ComposeTraceRow[] = []

  /** Families and names already emitted, most recent last. */
  const familySeq: (string | null)[] = []
  const subjectSeq: (string | null)[] = []
  /** How many of the opening each category has taken. */
  const openingCount = new Map<string, number>()

  /** How many of the last `n` emitted cards share this value. */
  const runOf = (seq: (string | null)[], v: string | null): number => {
    if (v == null) return 0
    let k = 0
    for (let i = seq.length - 1; i >= 0 && seq[i] === v; i--) k += 1
    return k
  }
  const seenWithin = (seq: (string | null)[], v: string | null, n: number): boolean =>
    v != null && seq.slice(Math.max(0, seq.length - n)).includes(v)

  const costOf = (r: RankedItem<T>): Cost => {
    const fam = familyOf(r.item)
    const sub = subjectOf(r.item)
    const cat = categoryOf?.(r.item) ?? null

    const categoryOver = categoryCapOn && out.length < OPENING && cat != null
      && (openingCount.get(cat) ?? 0) >= MAX_OPENING_PER_CATEGORY ? 1 : 0
    const familyOver = familyRuleOn && runOf(familySeq, fam) >= maxRun ? 1 : 0
    const subjectOver = runOf(subjectSeq, sub) >= maxSubjectRun ? 1 : 0
    const familyRecent = familyRuleOn && seenWithin(familySeq, fam, familyWindow) ? 1 : 0
    const subjectRecent = seenWithin(subjectSeq, sub, subjectWindow) ? 1 : 0

    return [categoryOver, familyOver, subjectOver, familyRecent, subjectRecent]
  }

  while (pool.length) {
    const head = pool[0]
    const headCost = costOf(head)
    const headComparable = comparableTotal(head)

    let index = 0
    let chosenCost = headCost
    let competitors = 0

    /**
     * Only scan when taking the head would repeat something. A feed with
     * nothing to fix pays one cost evaluation per card and no scan at all,
     * which is the common case once the opening is past.
     */
    if (!costIsZero(headCost)) {
      const limit = Math.min(pool.length, lookahead)
      for (let i = 1; i < limit; i++) {
        const c = pool[i]
        /**
         * Competitive, on the two bounds `diversify` established.
         *
         * The tier bound is the one that cannot be relaxed: it is what stops
         * variety reaching past the semantic partition for something merely
         * different. The score bound is what makes the whole critical-cluster
         * question answer itself — an alternative that was never close does
         * not get a vote on whether a strong run continues.
         */
        if (c.priority.tier - head.priority.tier > MAX_TIER_REACH) continue
        if (comparableTotal(c) < headComparable - tolerance) continue
        competitors += 1
        const cost = costOf(c)
        if (compareCost(cost, chosenCost) < 0) {
          chosenCost = cost
          index = i
        }
      }
    }

    const chosen = pool.splice(index, 1)[0]
    out.push(chosen)

    if (trace) {
      const bindingDim = index === 0
        ? -1
        : chosenCost.findIndex((v, i) => v < headCost[i])
      rows.push({
        rankBefore: rankBefore.get(chosen) ?? 0,
        rankAfter: out.length,
        id: chosen.input.id,
        family: familyOf(chosen.item),
        subject: subjectOf(chosen.item),
        category: categoryOf?.(chosen.item) ?? null,
        tier: chosen.priority.tier,
        total: chosen.priority.total,
        comparable: comparableTotal(chosen),
        components: { ...chosen.priority.components },
        competitors,
        headComparable,
        priorityCost: comparableTotal(chosen) - headComparable,
        reason: index === 0
          ? (costIsZero(headCost) ? 'head' : 'no-competitor')
          : REASON_FOR[bindingDim] ?? 'head',
      })
    }

    const fam = familyOf(chosen.item)
    const sub = subjectOf(chosen.item)
    familySeq.push(fam)
    subjectSeq.push(sub)
    if (categoryCapOn) {
      const c = categoryOf?.(chosen.item) ?? null
      if (c) openingCount.set(c, (openingCount.get(c) ?? 0) + 1)
    }
  }

  return { order: out, trace: rows }
}

/**
 * The longest run of one value, for tests and the dev trace.
 *
 * Exported because "how long is the worst run" is the metric this whole module
 * exists to move, and a test asserting it should measure it the same way the
 * overlay reports it.
 */
export function longestRun<T>(items: T[], key: (item: T) => string | null): number {
  let best = 0
  let cur = 0
  let prev: string | null | undefined
  for (const it of items) {
    const k = key(it)
    if (k != null && k === prev) cur += 1
    else { cur = 1; prev = k }
    if (cur > best) best = cur
  }
  return best
}
