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

/**
 * How many cards of one family may sit back to back.
 *
 * ── Why one, and what the measurement said ────────────────────────────────
 *
 * It was two, and two is what the reader kept seeing: manual QA reported long
 * runs of one visible family followed by long runs of another. Measured on a
 * production-shaped pool of 94 — dominated by attention and ideas, with a
 * thinner spine of decision cards — the composed feed had a longest run of 9
 * and 21 adjacent same-family pairs out of 93.
 *
 * One is the rule the reader actually wants: prefer not to place two of a
 * family together. It stays a PREFERENCE rather than a quota, because the cost
 * bit only wins when a competitor exists inside the tolerance — so a run
 * continues wherever nothing comparable is available, which is exactly the tail
 * of a feed that has run out of variety.
 *
 * Measured, same pool: longest run 9 → 3, adjacent pairs 21 → 2, with the worst
 * priority cost moving only from −0.138 to −0.143. Nothing is buried for it.
 */
const MAX_RUN = 1

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
 * ── The tier reach, and why there is no longer a constant here ────────────
 *
 * There was a `MAX_TIER_REACH = 2`, and its reasoning was that the tier is the
 * hard semantic partition — "the price has left the framework" against
 * "somebody wrote a thing" — so a news story must never be pulled above a
 * decision however monotonous the decisions get.
 *
 * The guarantee is right and it is kept. The mechanism was wrong twice over.
 *
 * It was redundant: the score bound already refuses a news card at 0.30
 * against a framework break at 1.00, and refuses it for the honest reason,
 * which is that it is WORSE rather than that a partition forbade it. Anything
 * the tier bound stopped, the score bound stopped first.
 *
 * And it was expensive. Stated as a partition it also forbade every HARMLESS
 * swap across the line — a post at 0.505 standing in for an overdue item at
 * 0.576 is a tier apart and a twentieth of a point apart — and those swaps are
 * most of the variety a mixed feed has to work with. Manual QA counted seven
 * consecutive Overdue tiles behind a wall that existed to prevent an inversion
 * that the score bound was already preventing.
 *
 * Tier still decides the ranked order this pass reads, in `compareRanked`,
 * which is where a semantic partition belongs.
 */

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

/**
 * How far to look when the head would repeat a FAMILY.
 *
 * ── Why the ordinary bound could not reach ────────────────────────────────
 *
 * The same reason the question axis needed its own: the ranked list is sorted
 * by score, so one family that dominates a band of the pool occupies a
 * contiguous stretch of it. Twelve is not enough to see past a stretch of
 * eighteen overdue items, so the search found no alternative, the run
 * continued, and the trace said `no-competitor` while a perfectly good
 * substitute sat at position 20.
 *
 * The TOLERANCE is deliberately not widened with it. Measured on the same pool,
 * an alternative family is already reachable at 91 of 94 positions at 0.15, so
 * the score bound was never what was binding — and raising it to 0.45 made the
 * result WORSE (longest run 3 → 5, adjacent pairs 2 → 4) while more than
 * doubling the worst priority cost, −0.143 to −0.315. Reach further; do not
 * lower the bar.
 */
const FAMILY_BREAK_LOOKAHEAD = 48

/**
 * How many cards asking the same READER QUESTION may sit back to back.
 *
 * The question is `readerQuestionFor` — what the card asks the reader to think
 * about — and it is deliberately neither the family nor the category.
 *
 * The family is too fine: `familyOf` splits research into five framings, so
 * "No core thesis", "Incomplete case", "New evidence", "Material move" and
 * "Quiet since" are five families and one question. Measured on the production
 * pool, the longest run of one question was 32 cards while every family rule
 * was satisfied.
 *
 * The category is not it either, and this was tried first. A category is where
 * a card FILES, not what it asks:
 *
 *     target_hit       decisions
 *     target_expired   decisions
 *     no_target        portfolio
 *
 * Three cards, two categories, one question — so a category-keyed rule reads
 * the third as variety and lets exactly the reported run through.
 */
const MAX_QUESTION_RUN = 2

/** How far back "the reader just saw this question" reaches. */
const QUESTION_WINDOW = 3

/**
 * How far to search, and how far down to reach, to BREAK a question run.
 *
 * ── Why the ordinary bounds cannot do it ──────────────────────────────────
 *
 * Measured on the live feed: 48 of 151 cards were `no_research`, producing a
 * 28-card run of the same question and, before it, 14 targets together. The
 * question rule was on and never fired, for two reasons that have nothing to
 * do with the rule:
 *
 *   `LOOKAHEAD` is 12, and inside a 28-card homogeneous stretch every one of
 *   the next twelve asks the same question. The composer could not SEE an
 *   alternative.
 *
 *   `TOLERANCE` is 0.15, and the pool is stratified by question: `no_research`
 *   is tier 1 with base 0.55, while the workflow cards that could break it are
 *   tier 3. Nothing within 0.15 was ever going to be a different question.
 *
 * So when the hard cap is already breached the search widens — far enough to
 * see past a long stretch, and lenient enough to reach the next stratum.
 *
 * ── What does NOT widen ───────────────────────────────────────────────────
 *
 * `MAX_TIER_REACH`. The tier partition is the semantic one and the comment on
 * it is right that it cannot be relaxed: from a tier-1 head this still reaches
 * tiers 1-3 and never tier 4, so a workflow card may break a thesis run and a
 * news card may not. Ranking stays sovereign, nothing is dropped, and the
 * escalation only ever applies to a card whose run cap is ALREADY exceeded.
 */
const QUESTION_BREAK_LOOKAHEAD = 48
const QUESTION_BREAK_TOLERANCE = 0.45

/** How far back "the reader just saw this family" reaches. */
const FAMILY_WINDOW = 4

/** How far back "the reader just saw this name" reaches. */
const SUBJECT_WINDOW = 6

/**
 * The window the reader actually judges the feed by, and how much of it one
 * kind of work may take.
 *
 * ── Why runs were not enough ──────────────────────────────────────────────
 *
 * Manual QA, after the run rules brought the longest exact-family run to two:
 * "the sequence technically avoids huge exact-family runs but still feels
 * semantically repetitive — many Trade Ideas / Thoughts / Pair Trades
 * clustered together, then many No Core Thesis / New Research tiles."
 *
 * Both observations are correct and neither is a run. A run rule constrains
 * ADJACENCY; a phone screen is a WINDOW. This passes every rule in this file:
 *
 *   idea  idea  news  idea  idea  news
 *
 * — longest family run 2, longest question run 2, and four of the six tiles on
 * the screen are somebody's posts.
 *
 * ── Why the two clusters the reader named are the same defect ─────────────
 *
 * They are one gap seen at two levels of the existing model:
 *
 *   Trade idea, Thought, Research note   3 families, 1 question, 1 category
 *   Case gaps, Needs review, Coverage
 *   gap, Team focus, Disagreement        5 families, 4 questions, 1 category
 *
 * The first cluster the question axis already groups, and the run rule caps it
 * at two consecutive — but not at four in six. The second the question axis
 * deliberately does NOT group: a missing thesis and a stale one are different
 * questions and the model is right that they are. What they share is the
 * CATEGORY, which is the product's own name for a kind of work, and which this
 * file only ever used to cap the opening.
 *
 * So the axis was not missing. It was already computed, already passed in, and
 * only consulted for the first eight cards.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * No value may take more than half of any window of `VIEWPORT` cards, on any
 * of the three axes. A cap and not a quota, exactly like everything else here:
 * nothing is promoted to fill a gap, and where no comparable alternative
 * exists the cap does not bind and the more important card still wins.
 */
const VIEWPORT = 6
const MAX_PER_VIEWPORT = 3

/**
 * The share of the feed one VISIBLE FAMILY may take, anywhere in it.
 *
 * ── Why a share, and why this is the strongest rule in the file ───────────
 *
 * Every other constant here is an absolute count inside a fixed window, and
 * every one of them stops binding after the opening. Manual QA, with all of
 * them passing: seven consecutive Overdue tiles.
 *
 * The reason none of them fired is not that the numbers were wrong. It is that
 * they were all expressed as a COST, and a cost only wins when the substitution
 * scan finds a competitor within `TOLERANCE`. The ranked list is sorted by
 * score and scores come mostly from a per-type constant, so one family occupies
 * a contiguous block in which — by construction — no competitor is within 0.15
 * of the head. The trace said `no-competitor` and the run continued. The rules
 * were structurally unable to bind precisely where the clustering was worst.
 *
 * So this one is not a cost that can be outvoted. It is a hard gate, it is
 * stated as a share rather than a count, and it applies to the whole feed
 * rather than to an opening:
 *
 *   no visible family may take more than two of any ten consecutive cards
 *
 * Two of ten is the product requirement stated directly. The reader judges the
 * feed by scrolling, so the window is what a reader passes through rather than
 * what fits on one screen, and it runs the length of the feed because a rule
 * that stopped after the opening is the rule that produced the report.
 *
 * ── What a share cap can and cannot promise ───────────────────────────────
 *
 * It binds while the pool has the variety to satisfy it. A desk with forty
 * overdue items and twelve of everything else cannot be shown a feed that is a
 * fifth overdue for very long, whatever this file does — the rest of the feed
 * runs out first and the tail goes uniform. That is arithmetic, not a defect,
 * and it is why the fallback below degrades rather than throws: when nothing
 * eligible is left, the least repetitive card still wins.
 *
 * The VISIBLE family and not the lane, the category or the question. Those
 * three are what the model thinks a card is; this is what the tile prints, and
 * repetition is a complaint about what the reader can see.
 */
const FAMILY_SHARE_WINDOW = 10
const MAX_PER_FAMILY_SHARE = 2

/**
 * The briefing window, and how much of it one KIND OF WORK may take.
 *
 * -- Why a fifth axis, and why it is the strongest one ----------------------
 *
 * Manual QA, with every rule in this file passing: "Needs Review, Overdue,
 * Coverage Gap, Needs Review, Coverage Gap, Overdue". Measured on a
 * pilot-shaped pool the composed top ten held four reader questions and four
 * categories -- the acceptance criteria, met -- while seven of the ten cards
 * were amber and all seven said something needs looking at.
 *
 * The model had four names for one lane. `research_stale` prints the same two
 * words as `awaiting_review`, coverage was filed under research, and a
 * recommendation is filed under decisions; each of those is correct on its own
 * terms and none of them is visible to a reader holding a phone. See
 * `brief-class`, which is the coarser axis that was missing.
 *
 * Ten, because that is what manual acceptance is now judged on: the first one
 * or two phone screens.
 *
 * Three, chosen by product after seeing both. Measured on the pilot-shaped
 * pool, where the ranked top ten is nine tenths one lane:
 *
 *   cap off   work 5, desk 2, market 2, judgment 1
 *   cap 4     work 4, desk 3, market 2, judgment 1
 *   cap 3     work 3, desk 3, market 3, judgment 1
 *
 * Four was tried first and shipped for a day. It moved one card in the opening
 * and product acceptance called the result too small to change how the feed
 * reads, which is a judgement about the product and not about the numbers.
 *
 * Three is not free and the cost is recorded here rather than in a commit
 * message nobody will find. On that pool it takes two cards out of the opening:
 *
 *   research_stale  0.629, attention   position  8 -> 11
 *   awaiting_review 0.553, CRITICAL    position  9 -> 19
 *
 * and the slots go to a post at 0.505 and two news items at 0.345 and 0.337.
 * The largest single sacrifice is 0.292, inside `SCREEN_TOLERANCE` and
 * therefore inside the bar every other rule in this file already answers to —
 * but it is a critical-severity row leaving the first screen for an
 * informational one, which is the sharpest edge this rule has.
 *
 * Two things keep that honest rather than arbitrary. The tolerance still binds,
 * so a materially better card is never displaced; and the head of the ranking
 * is still the head of the feed, because nothing precedes it and a rule about
 * what has already been shown cannot reach it.
 */
const BRIEF_WINDOW = 10
const MAX_PER_BRIEF = 3
/**
 * The bar a substitute must clear to break a saturated screen.
 *
 * ── Chosen from the distribution, not picked ──────────────────────────────
 *
 * The ordinary 0.15 cannot reach a different category at all in a pool
 * stratified by category — which is every real pool, because the tiers ARE
 * roughly categories. Measured on the production-shaped pool, sweeping the bar:
 *
 *   0.15  0.20  0.25   no change whatsoever; the rule never binds
 *   0.30         windows dominated by one category 20 → 9, by one question
 *                14 → 9, worst displacement −0.295
 *   0.35  0.45   identical to 0.30
 *
 * So there is one step in the whole range and 0.30 is where it is. Anything
 * lower buys nothing; anything higher costs more displacement for no further
 * improvement. It is deliberately tighter than `QUESTION_BREAK_TOLERANCE`,
 * which stays where it was.
 */
const SCREEN_TOLERANCE = 0.30

/**
 * The bar a substitute must clear to break a family that has taken its share.
 *
 * ── Why the share rule needs its own, and why it is bracketed ─────────────
 *
 * The share cap is the only rule here stated in the reader's own terms, so it
 * is the one that must actually bind. The pool it has to bind in is stratified
 * by type: on the pilot-shaped pool the overdue block sits at 0.576 and the
 * posts and news items that could break it sit at 0.34 to 0.40. That is a gap
 * of about 0.24, so a bar tighter than that admits nothing and the cap is
 * decorative — which is exactly how seven consecutive Overdue tiles shipped
 * with every rule in this file passing.
 *
 * It is bounded at the other end by the guarantee it must not break. A
 * maximal tier-0 framework break at 1.00 must never be interrupted by a
 * rounding-error crowding card at ~0.34, a distance of about 0.66. Between
 * those two brackets there is a wide margin and 0.35 sits in it: comfortably
 * past the stratum gap, comfortably short of the inversion.
 *
 * Both brackets are tests rather than prose. See `feed-compose`'s critical
 * cluster case for the upper one and `feed-scheduler` for the lower.
 *
 * It applies ONLY where the share cap is already breached, which is the same
 * discipline every other escalation in this file answers to: a wider bar is
 * earned by a rule that has already failed, never offered up front.
 */
const SHARE_BREAK_TOLERANCE = 0.35

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
  /**
   * What this card asks the reader to think about — see `readerQuestionFor`.
   *
   * Optional, and the rule is off without it. Coarser than the family and
   * orthogonal to the category; it is the axis the reported repetition is
   * actually about.
   */
  questionOf?: (item: T) => string | null
  /** The ticker a card is about, where it has one. */
  subjectOf: (item: T) => string | null
  /** The canonical category, for the opening cap. Omitted, the cap is off. */
  categoryOf?: (item: T) => string | null
  /**
   * Which lane of the briefing this card is -- see `brief-class`.
   *
   * Optional, and the rule is off without it. Coarser than the category and
   * coarser than the question: it is the axis a reader judges a screen by.
   */
  briefOf?: (item: T) => string | null
  scope?: ComposeScope
  maxRun?: number
  maxQuestionRun?: number
  maxSubjectRun?: number
  tolerance?: number
  lookahead?: number
  familyWindow?: number
  questionWindow?: number
  subjectWindow?: number
  /** How many cards the briefing cap applies to. */
  briefWindow?: number
  /** How much of that opening one lane may take. Raise it to switch the cap off. */
  maxPerBrief?: number
  /** The trailing window the family share is measured over. */
  shareWindow?: number
  /**
   * How many of that window one visible family may take.
   *
   * Two of ten is the product requirement. Raise it to switch the cap off,
   * which is how a test measures what the cap is worth.
   */
  maxPerFamilyShare?: number
  /**
   * Whether a critical card in the ranked opening is owed a seat in it.
   *
   * True in production and everywhere else. False exists so a test can measure
   * what the protection is worth, the same way `maxPerBrief: 99` measures what
   * the cap is worth — a rule whose effect cannot be turned off cannot be shown
   * to have one.
   */
  protectCritical?: boolean
  /** The screen the saturation rule measures. */
  viewport?: number
  /** How much of that screen one value may take. Raise it to switch the rule off. */
  maxPerViewport?: number
  /** The score bar a substitute must clear to break a saturated screen. */
  screenTolerance?: number
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
    | 'question-run'         // pulled up because the head would repeat a question
    | 'family-run'           // pulled up because the head would repeat a family
    | 'subject-run'          // pulled up because the head would repeat a name
    | 'reserved-seat'        // pulled up because the opening owed a critical a seat
    | 'share-cap'            // pulled up because one family had taken its share
    | 'brief-cap'            // pulled up because one lane had taken the screen
    | 'brief-screen'
    | 'category-cap'         // pulled up because a category had taken the opening
    | 'category-screen'      // pulled up because one kind of work filled the screen
    | 'question-screen'
    | 'family-screen'
    | 'recent-question'      // pulled up on the softer "seen this recently" rule
    | 'recent-family'
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
 *   0. the opening has only enough seats left for the protected items
 *   1. this FAMILY has already taken its share of the last `shareWindow`
 *   2. this LANE has already taken its share of the first screen (mixed only)
 *   3. a category has already taken its share of the opening   (mixed only)
 *   4. taking this would run a QUESTION past `maxCategoryRun`
 *   5. taking this would run a family past `maxRun`
 *   6. taking this would run a name past `maxSubjectRun`
 *   7. this LANE would take more than half the viewport
 *   8. this CATEGORY would take more than half the viewport
 *   9. this QUESTION would take more than half the viewport
 *  10. this FAMILY would take more than half the viewport
 *  11. this question appeared within the last `categoryWindow`
 *  12. this family appeared within the last `familyWindow`
 *  13. this name appeared within the last `subjectWindow`
 *
 * The share cap first, then the briefing cap, then hard runs, then screen
 * saturation, then soft recency; and within each band, the coarsest axis first.
 *
 * The share cap outranks everything except a reserved seat because it is the
 * only rule stated as a proportion of what the reader actually scrolls past,
 * and it is the only one that runs the whole length of the feed. Every rule
 * below it stops binding after the opening or measures a single screen, and a
 * feed composed only of those is the feed that produced the report.
 *
 * The lane cap outranks everything because it is the only rule stated in terms
 * of what the reader is judged to have received: one screen, and what was on
 * it. It applies to the opening alone and stops binding after that, so the rest
 * of the feed is composed exactly as it was.
 *
 * Saturation sits above recency because "four of the last six were this" is a
 * stronger statement about the screen than "one of the last three was", and
 * below the runs because a run is still the most visible repetition there is.
 *
 * The question axis is new and sits ABOVE the family, because the family was
 * standing in for it and is too fine to do the job: five research framings are
 * five families and one question, so the family rule interleaved them and the
 * reader still met five research chores in a row. Measured on the production
 * pool the longest run of one question was 32 cards. The family rule stays
 * because within a question the framings are still worth separating.
 *
 * Every entry is 0 or 1, so a tuple of zeros means "nothing about this card
 * repeats anything", which is the fast path.
 */
type Cost = [
  number, number, number, number, number,
  number, number, number, number, number,
  number, number, number, number,
]

const costIsZero = (c: Cost) => c.every(v => v === 0)

const compareCost = (a: Cost, b: Cost): number => {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i]
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
  0: 'reserved-seat',
  1: 'share-cap',
  2: 'brief-cap',
  3: 'category-cap',
  4: 'question-run',
  5: 'family-run',
  6: 'subject-run',
  7: 'brief-screen',
  8: 'category-screen',
  9: 'question-screen',
  10: 'family-screen',
  11: 'recent-question',
  12: 'recent-family',
  13: 'recent-subject',
}

export function composeFeed<T>(
  ranked: RankedItem<T>[],
  options: ComposeOptions<T>,
): ComposeResult<T> {
  const {
    familyOf, subjectOf, categoryOf, questionOf, briefOf,
    scope = 'mixed',
    maxRun = MAX_RUN,
    maxQuestionRun = MAX_QUESTION_RUN,
    maxSubjectRun = MAX_SUBJECT_RUN,
    tolerance = TOLERANCE,
    lookahead = LOOKAHEAD,
    familyWindow = FAMILY_WINDOW,
    questionWindow = QUESTION_WINDOW,
    subjectWindow = SUBJECT_WINDOW,
    briefWindow = BRIEF_WINDOW,
    maxPerBrief = MAX_PER_BRIEF,
    shareWindow = FAMILY_SHARE_WINDOW,
    maxPerFamilyShare = MAX_PER_FAMILY_SHARE,
    protectCritical = true,
    viewport = VIEWPORT,
    maxPerViewport = MAX_PER_VIEWPORT,
    screenTolerance = SCREEN_TOLERANCE,
    trace = false,
  } = options

  // Nothing to arrange. Returned as-is rather than copied, so the caller's
  // identity checks are trivially true for the degenerate cases.
  if (ranked.length < 3) return { order: ranked, trace: [] }

  /** Family diversity is off when the reader named the family. */
  const familyRuleOn = scope !== 'type'
  /** The opening cap is off when the reader named the category. */
  const categoryCapOn = scope === 'mixed' && !!categoryOf
  /** Question diversity is off when the reader named what they wanted. */
  const questionRuleOn = scope === 'mixed' && !!questionOf
  /**
   * The briefing cap, on only for an unfiltered feed.
   *
   * A reader who asked for one family is not being handed a briefing and must
   * not have one composed for them -- the same reasoning that switches the
   * category cap off.
   */
  const briefRuleOn = scope === 'mixed' && !!briefOf
  /**
   * The share cap, off for the same reason the briefing cap is.
   *
   * A reader who asked for one family is asking to see that family, and
   * holding it to two of every ten would be answering a question they did not
   * put. It stays on for `category`, which is a request for a kind of work and
   * not for six identical tiles.
   */
  const shareRuleOn = scope !== 'type' && maxPerFamilyShare > 0

  const rankBefore = new Map<RankedItem<T>, number>()
  ranked.forEach((r, i) => rankBefore.set(r, i + 1))

  /**
   * Every axis, resolved once per card instead of once per comparison.
   *
   * The selection pass asks for a card's family several times per step and the
   * candidate set below asks for it once more, so an un-memoised `familyOf`
   * would be called on the order of n^2 times. The resolvers reach into entry
   * shapes and one of them re-derives a signal type, so this is not free.
   */
  const famOf = new Map<RankedItem<T>, string | null>()
  for (const r of ranked) famOf.set(r, familyOf(r.item))
  const famKey = (r: RankedItem<T>) => famOf.get(r) ?? null

  const pool = [...ranked]
  const out: RankedItem<T>[] = []
  const rows: ComposeTraceRow[] = []

  /** Questions, families, categories and names already emitted, most recent last. */
  const questionSeq: (string | null)[] = []
  const familySeq: (string | null)[] = []
  const subjectSeq: (string | null)[] = []
  const categorySeq: (string | null)[] = []
  const briefSeq: (string | null)[] = []
  /** How many of the opening screen each lane has taken, NOT counting protected. */
  const briefCount = new Map<string, number>()

  /**
   * The items the opening owes a seat to, and the seats each lane must keep.
   *
   * -- The report ----------------------------------------------------------
   *
   * With the lane cap at three, a critical review at 0.553 left the first
   * screen for a news item at 0.345. That is priority sovereignty inverted: the
   * cap is a rule about how a screen READS, and it had started deciding what
   * the reader is allowed to be told.
   *
   * -- What protection means here ------------------------------------------
   *
   * Not exemption. A critical card is not excused from composition -- five of
   * them in a row is still a bad screen and the run and recency rules still
   * space them. What it is owed is a SEAT: if it was in the ranked top ten on
   * merit, it is somewhere in the first ten when the reader arrives.
   *
   * Two mechanisms, both bounded to the opening:
   *
   *   the allowance   a lane's cap counts only its unprotected members, so a
   *                   lane with protected members reserves those slots and its
   *                   weaker same-lane cards give way first -- which is the
   *                   substitution asked for rather than a blanket pass
   *   the reservation once the seats left equal the protected cards still
   *                   waiting, only protected cards may take them
   *
   * The second is what makes the guarantee total. Diversity runs freely while
   * the window is loose and yields only at the point where one more unprotected
   * card would cost a critical its place.
   *
   * -- Why the seats are now bounded per FAMILY ----------------------------
   *
   * As written, a lane could reserve as many seats as it had criticals, and
   * the note above claiming that bounded concentration was wrong. Manual QA:
   * eight critical Overdue cards in the ranked opening reserved six of the ten
   * seats, produced six consecutive Overdue tiles, and pushed the highest
   * scoring card in the whole pool from first place to twelfth. Protection
   * against an inversion had become the cause of one.
   *
   * The mistake was granularity. "Did a critical card that earned the opening
   * get to be in it" is a good question; "how many of one tile may sit
   * together" is a different one, and `protectedPerLane` answered the second
   * at LANE granularity -- coarser than what the reader sees, so Overdue,
   * Needs Review and Coverage Gap pooled their claims into one.
   *
   * So a family may claim at most `maxPerFamilyShare` seats, the same two of
   * ten the share cap allows. Of eight critical Overdue cards, two are owed a
   * place in the opening and the other six appear further down. Nothing is
   * dropped; being edged out by others of your own type means arriving later.
   *
   * The claim is taken in ranked order, so the two that keep their seats are
   * the two that earned them.
   */
  const protectedIds = new Set<string>()
  const protectedPerLane = new Map<string, number>()
  if (briefRuleOn && protectCritical) {
    const claimedPerFamily = new Map<string | null, number>()
    for (const r of ranked.slice(0, briefWindow)) {
      if (r.input.severity !== 'critical') continue
      const fam = famKey(r)
      const claimed = claimedPerFamily.get(fam) ?? 0
      if (shareRuleOn && claimed >= maxPerFamilyShare) continue
      claimedPerFamily.set(fam, claimed + 1)
      protectedIds.add(r.input.id)
      const lane = briefOf?.(r.item) ?? null
      if (lane) protectedPerLane.set(lane, (protectedPerLane.get(lane) ?? 0) + 1)
    }
  }
  let protectedLeft = protectedIds.size
  const isProtected = (r: RankedItem<T>) => protectedIds.has(r.input.id)
  /** Seats a lane may give to cards that are not owed one. */
  const allowanceFor = (lane: string): number =>
    Math.max(0, maxPerBrief - (protectedPerLane.get(lane) ?? 0))
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

  /**
   * Would taking this card push its value past its share of a window?
   *
   * The same arithmetic as `saturates` below, with the window and the bound
   * named by the caller: the share cap measures what a reader SCROLLS past,
   * which is ten cards, while saturation measures what fits on one screen.
   *
   * A null value never exceeds anything, for the same reason it never
   * saturates: an absent value is not a repetition.
   */
  const exceedsShare = (
    seq: (string | null)[], v: string | null, window: number, max: number,
  ): boolean => {
    if (v == null) return false
    let n = 1
    for (let i = seq.length - 1; i >= Math.max(0, seq.length - (window - 1)); i--) {
      if (seq[i] === v) n += 1
    }
    return n > max
  }

  /**
   * Would taking this card make its value more than half of a screen?
   *
   * Counts the value in the last `VIEWPORT - 1` emitted cards and adds this
   * one, so the window under test is exactly the screen the reader would be
   * looking at with this card on it. Null values — a tile with no subject, an
   * untyped entry — never saturate: an absent value is not a repetition.
   */
  const saturates = (seq: (string | null)[], v: string | null): boolean => {
    if (v == null) return false
    let n = 1
    for (let i = seq.length - 1; i >= Math.max(0, seq.length - (viewport - 1)); i--) {
      if (seq[i] === v) n += 1
    }
    return n > maxPerViewport
  }

  const costOf = (r: RankedItem<T>): Cost => {
    const fam = famKey(r)
    const sub = subjectOf(r.item)
    const cat = categoryOf?.(r.item) ?? null
    const q = questionOf?.(r.item) ?? null
    const lane = briefOf?.(r.item) ?? null

    /**
     * One lane may not take more than its share of the first screen.
     *
     * Counted over the opening only. After `briefWindow` cards the reader has
     * had their briefing and the rest of the feed is ranked and spaced exactly
     * as it was -- a cap that ran forever would be a quota, which this is not.
     */
    const owed = isProtected(r)
    /**
     * The share cap, and the only rule here that runs the whole feed.
     *
     * A protected card is exempt, the same way it is exempt from the lane cap:
     * its seat was reserved and the reservation is already family-bounded to
     * this same number, so the two cannot disagree.
     */
    const shareOver = shareRuleOn && !owed
      && exceedsShare(familySeq, fam, shareWindow, maxPerFamilyShare) ? 1 : 0
    /**
     * The seats left, against the cards still owed one.
     *
     * Equality rather than a margin: while there is slack the composer is free,
     * and it tightens exactly one card before the guarantee would break.
     */
    const reserved = briefRuleOn && !owed && out.length < briefWindow
      && (briefWindow - out.length) <= protectedLeft ? 1 : 0
    const briefOver = briefRuleOn && !owed && out.length < briefWindow && lane != null
      && (briefCount.get(lane) ?? 0) >= allowanceFor(lane) ? 1 : 0
    const categoryOver = categoryCapOn && out.length < OPENING && cat != null
      && (openingCount.get(cat) ?? 0) >= MAX_OPENING_PER_CATEGORY ? 1 : 0
    /**
     * The question axis, and it is only on when the reader has not named one.
     * Asking for Research and being handed Research is not repetition, it is
     * the answer — the same reasoning that switches the family rule off.
     */
    const questionOver = questionRuleOn && runOf(questionSeq, q) >= maxQuestionRun ? 1 : 0
    const familyOver = familyRuleOn && runOf(familySeq, fam) >= maxRun ? 1 : 0
    const subjectOver = runOf(subjectSeq, sub) >= maxSubjectRun ? 1 : 0
    /**
     * The screen, on each axis the reader can perceive.
     *
     * Gated by the same scope rules as the run above them: a reader who asked
     * for Research is not being repeated at by Research, and a reader who
     * named a family is not being repeated at by that family.
     */
    const briefScreen = briefRuleOn && saturates(briefSeq, lane) ? 1 : 0
    const categoryScreen = categoryCapOn && saturates(categorySeq, cat) ? 1 : 0
    const questionScreen = questionRuleOn && saturates(questionSeq, q) ? 1 : 0
    const familyScreen = familyRuleOn && saturates(familySeq, fam) ? 1 : 0

    const questionRecent = questionRuleOn && seenWithin(questionSeq, q, questionWindow) ? 1 : 0
    const familyRecent = familyRuleOn && seenWithin(familySeq, fam, familyWindow) ? 1 : 0
    const subjectRecent = seenWithin(subjectSeq, sub, subjectWindow) ? 1 : 0

    return [reserved, shareOver, briefOver, categoryOver,
            questionOver, familyOver, subjectOver,
            briefScreen, categoryScreen, questionScreen, familyScreen,
            questionRecent, familyRecent, subjectRecent]
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
      /**
       * A breached question cap earns a wider search. Index 1 of the cost
       * tuple is the question run; see the constants for why the ordinary
       * bounds cannot reach across a stratified pool.
       */
      const breakingQuestionRun = headCost[4] === 1
      /**
       * Index 2 is the family RUN, index 5 the softer "seen it recently".
       *
       * Both earn the wider search, and the second one matters as much as the
       * first: measured on a production-shaped pool, escalating only on the
       * hard cap left the longest run at 5 and 4 adjacent pairs, where
       * escalating on either brought them to 3 and 2. The soft signal is what
       * spaces a family out once the run itself is already broken, and it was
       * failing for the same reason — twelve places is not far enough to see
       * past a contiguous stretch of one family in a score-sorted list.
       *
       * The tolerance is not widened with either. See `FAMILY_BREAK_LOOKAHEAD`.
       */
      const breakingFamilyRun = headCost[5] === 1 || headCost[12] === 1
      /**
       * Saturation earns the wide REACH and never the wide tolerance.
       *
       * A screen filled by one category is the same stratification problem the
       * question run has — the alternative is far down a score-sorted list —
       * so the reach has to escalate or the rule cannot bind. The tolerance is
       * a different matter: measured on the production pool, lowering the bar
       * to 0.45 admitted worse substitutes and made the family sequence WORSE
       * while more than doubling what the pass costs. See `feed-variety`,
       * which holds that measurement as a test.
       */
      /**
       * The lane cap earns the same reach and the same bar as saturation.
       *
       * It is the same stratification problem in a stronger form: a pilot pool
       * is mostly one lane, so the alternative is far down a score-sorted list
       * and is worth less. `screenTolerance` is what decides how much less is
       * too much, and the lane cap does not get its own number.
       */
      const breakingScreen =
        headCost[2] === 1 || headCost[7] === 1 || headCost[8] === 1 || headCost[9] === 1
      /** Index 1 is the share cap, and it earns the widest bar of all. */
      const breakingShare = headCost[1] === 1
      const reach = breakingShare ? pool.length
        : breakingQuestionRun ? QUESTION_BREAK_LOOKAHEAD
        : breakingScreen ? QUESTION_BREAK_LOOKAHEAD
        : breakingFamilyRun ? FAMILY_BREAK_LOOKAHEAD
        : lookahead
      const slack = breakingShare ? SHARE_BREAK_TOLERANCE
        : breakingQuestionRun ? QUESTION_BREAK_TOLERANCE
        : breakingScreen ? screenTolerance
        : tolerance
      /**
       * Who may compete, and why the candidate set is no longer a window.
       *
       * ── What a window could not see ─────────────────────────────────────
       *
       * The scan looked at the next `reach` entries of a score-sorted list, and
       * a score is mostly a per-type constant, so one family occupies a
       * contiguous stretch of that list. Inside a stretch longer than the reach
       * every candidate is the same family, the pass found nothing to swap in,
       * the trace said `no-competitor`, and the run continued. Widening the
       * reach was tried twice — twelve to forty-eight — and only moved the
       * length of stretch that defeats it.
       *
       * The fix is not a wider window. It is to stop looking at a window: the
       * FIRST card of every other family is always a candidate, wherever it
       * sits. That set is at most one per family, about twenty, so the pass
       * gets cheaper rather than dearer, and it can never fail to see an
       * alternative that exists.
       *
       * The ordinary window is kept alongside it. Reaching deeper INTO a family
       * is what breaks up a run of one ticker or one question within a single
       * family, which the heads alone cannot do.
       */
      const limit = Math.min(pool.length, reach)
      const seenFamilies = new Set<string | null>([famKey(head)])
      const candidates: number[] = []
      for (let i = 1; i < pool.length; i++) {
        const fam = famKey(pool[i])
        if (i < limit) {
          candidates.push(i)
          seenFamilies.add(fam)
          continue
        }
        if (seenFamilies.has(fam)) continue
        seenFamilies.add(fam)
        candidates.push(i)
      }
      for (const i of candidates) {
        const c = pool[i]
        /**
         * Competitive on the score bound alone.
         *
         * The tier bound that used to sit here is gone. It said a news card
         * must never interrupt a decision, which is a guarantee worth keeping —
         * but the score bound already keeps it, and keeps it honestly: a news
         * card at 0.30 loses to a framework break at 1.00 because it is WORSE,
         * not because a partition forbade it. Stated as a partition it also
         * forbade every harmless swap across the line, which is most of the
         * variety a mixed feed has available to it.
         *
         * Tier still decides the ranked order this pass reads. See
         * `compareRanked`.
         */
        if (comparableTotal(c) < headComparable - slack) continue
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

    const fam = famKey(chosen)
    const sub = subjectOf(chosen.item)
    const chosenCat = categoryOf?.(chosen.item) ?? null
    questionSeq.push(questionOf?.(chosen.item) ?? null)
    familySeq.push(fam)
    subjectSeq.push(sub)
    categorySeq.push(chosenCat)
    const chosenLane = briefOf?.(chosen.item) ?? null
    briefSeq.push(chosenLane)
    if (briefRuleOn && isProtected(chosen)) {
      protectedLeft -= 1
    } else if (briefRuleOn && chosenLane) {
      // Protected cards occupy their reserved seat rather than the lane's cap.
      briefCount.set(chosenLane, (briefCount.get(chosenLane) ?? 0) + 1)
    }
    if (categoryCapOn) {
      const c = chosenCat
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
