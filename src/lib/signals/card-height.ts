import type { SignalType } from './contract'

/**
 * How much room a card is entitled to, from a vocabulary of three.
 *
 * ── The measurement ───────────────────────────────────────────────────────
 *
 * Every tile rendered at exactly one viewport. Measured across all 31 gallery
 * fixtures at 390x844, the share of that height carrying ink ran from 19% to
 * 72%, and the space that was not ink did not spread out — it pooled into one
 * contiguous band between the last content and the sticky action bar:
 *
 *     no_research      19%   a 603px blank band on a 247px card
 *     research_stale   26%   517px
 *     news             28%   497px
 *     thought          32%   496px
 *
 * ── How the tiers were derived, and the first attempt that was wrong ──────
 *
 * The first cut measured "natural height" by releasing the forced height and
 * letting the card size to content. That under-measures, badly, for every card
 * whose inner regions are flex-grow claimants: with no definite height to
 * distribute, an evidence band or a detail region collapses toward its floor
 * and reports a card far shorter than one that can actually show its content.
 * Tiers built on it clipped `active-risk-real` by 31px and `recommendation` by
 * 36px — caught by the layout suite, not by the eye.
 *
 * What the tiers are built on instead is a binary search, per fixture, for the
 * smallest slot height at which NOTHING clips: no content below the action
 * bar, no scroll-clipped detail, carousel or context-chip row. That is a
 * measurement of the card's real requirement rather than of its collapse.
 *
 *     279  news              531  scenario_gap
 *     346  research_stale    571  trade_idea
 *     370  no_research       614  conviction_oversized
 *     374  awaiting_review   643  crowding
 *     382  thought           651  no_target
 *     400  target_expired    701  active_risk
 *                            706  recommendation
 *
 * ── Why the minimum is a floor and not the tier ───────────────────────────
 *
 * `target_expired` survives at 400px, and it would be wrong to give it 400px.
 * The distinction the ink measurements make is between cards that ABSORB spare
 * height and cards that POOL it. On the ladder families the carousel band takes
 * the slack through `grow-[999]`, so at one viewport their largest internal gap
 * is only 52-57px and 60-72% of the card is ink — the space is going into a
 * bigger chart, which is the whole value of the card. On the text-and-chips
 * families nothing claims the slack, so it collects into one dead band: 497px
 * on news, 603px on an unwritten position.
 *
 * So a family is sized down when its extra height was pooling, and left at one
 * viewport when its extra height was being spent on the visual. That is why
 * `scenario_gap` keeps a full screen despite needing only 531px, and why
 * `news` does not despite the same argument being available.
 *
 * ── Why three declared sizes rather than content height ───────────────────
 *
 * Free content sizing was tried on this surface and reverted, for a reason
 * recorded in `SignalCardView`: a news card at 327px beside a scenario card at
 * 844 "does not feel like advancing through decisions; it felt like a list
 * that could not decide what it was". That objection is to ARBITRARINESS, not
 * to variation — 327px is merely where a fixture's text ran out. A declared
 * 384px is a decision, and it reads as one.
 *
 * ── Why keyed by type, and why the table is partial ───────────────────────
 *
 * The tier has to be known before the card is built, because `FeedSlot`
 * reserves a box for entries it has not mounted. The type is the one thing
 * about an entry that is knowable that early — `rankInputFor` already derives
 * it for every entry on every pass.
 *
 * Each entry here is the MAXIMUM natural height measured across every fixture
 * of that type, rounded up. `no_research` spans 247-510px across its three
 * fixtures and is therefore sized for 510, not for its median: a tier that
 * fits the average of a family clips the tail of it. Types with no fixture get
 * `full`, which is one viewport — exactly today's behaviour. A type added
 * later cannot be silently clipped by a guess made here.
 */
/**
 * ── V2: where the remaining dead space actually lives ─────────────────────
 *
 * The tiers above removed the pooled space on every family that had a
 * flexible region. What was left, measured per fixture at 390x844, turned out
 * to be attributable to one element — `[data-slot="body-spacer"]`, which grows
 * at factor 1 against the workspace's 999 so that leftover space collects
 * ABOVE the description rather than below it:
 *
 *     fixture                          tier  spacer  largest gap
 *     portfolio-unwritten-immaterial   448    207        207
 *     portfolio-unwritten-position     448    121        121
 *     portfolio-written-material       448    121        121
 *     long-label                       844    218        259
 *     every other fixture              ---     14      <= 101
 *
 * The spacer is the whole gap on exactly those four, and 14px everywhere
 * else. It is not the defect, though: it grows only on a card with NO other
 * flexible claimant — no carousel and no detail region — and on such a card
 * the free space exists whatever absorbs it. Capping the spacer moves the hole
 * below the description instead of above it, which a previous pass measured at
 * 212px and rejected. The hole is the tier exceeding the content.
 *
 * ── Why no presentation signal was added here, yet ────────────────────────
 *
 * The obvious next move is to split a family by whether its card carries a
 * flexible region, resolved before mount. The feed even has the pure predicate
 * for one half of it — `framingWantsJudgment(framing)`, over a framing the
 * entry already carries and the filter already reads.
 *
 * It was not added, because following the measurement to its end says the four
 * fixtures above are not what the feed renders. An insight entry always
 * receives a case pane — `MobileDashboard` pushes `casePane` on both sides of
 * its `insightCapital` branch — so a shipping capital card is `merged`, and a
 * merged card absorbs its slack in the carousel band. The gallery's capital
 * fixtures are plain `card:` entries with no panes at all, which is a
 * composition the feed does not produce. `respond-no-target` is the same card
 * WITH a pane, and it measures 68% ink and a 31px gap in the same 448px box.
 *
 * So a signal derived from these four would be fitted to a fixture artifact.
 * The honest next step is to make the gallery mount the shipping composition
 * for capital cards and re-measure; if a real pane-less variant survives that,
 * the split is justified and `framingWantsJudgment` is the predicate to hang
 * it on. Sized to a fixture, a tier clips the card it was supposed to fit.
 */
export type CardTier = 'compact' | 'medium' | 'standard' | 'full'

/**
 * Measured types only. The comment on each line is that type's largest
 * minimum-safe height across every fixture of it, which is what its tier has
 * to clear. Sized for the tail of a family, never its median: `no_research`
 * runs 246-370px across three fixtures and is sized for 370.
 */
const TIER_BY_TYPE: Partial<Record<SignalType, CardTier>> = {
  // Text and chips. Nothing here claims spare height, so spare height became a
  // dead band. Sized at 448px for the largest real requirement in the group:
  // a `no_research` card with its judgment pane open needs 430px, measured by
  // the phone suite's own reach test rather than by a synthetic probe, which
  // put it 60px lower and clipped two answer controls.
  news: 'compact',              // 279
  thought: 'compact',           // 382
  research_stale: 'compact',    // 434
  awaiting_review: 'compact',   // 475

  /**
   * Its own step, because neither neighbour fits it.
   *
   * Both `no_research` fixtures render the shipping composition — an insight
   * entry always receives a case pane — and they are not the same height. The
   * immaterial stake fits 448px; the one carrying 38.5% of a book adds a hero
   * row and two why-now lines, needs 483px, and clipped a paragraph by 35px at
   * compact.
   *
   * Standard was tried first, on the theory that a card with a pane is merged
   * and a merged card spends slack on its carousel band rather than pooling
   * it. Measured, it does not: one pane is not a carousel, so at 736px the
   * same three fixtures fell to 42-47% ink with 107-223px bands — worse than
   * the clip being fixed. Hence a step between, sized to the tail.
   */
  no_research: 'medium',        // 483

  // Carries a visual, but was still pooling 150-285px at one viewport.
  // Largest minimum in this group is `recommendation` at 706px.
  trade_idea: 'standard',           // 571
  conviction_oversized: 'standard', // 614
  crowding: 'standard',             // 643
  no_target: 'standard',            // 651
  active_risk: 'standard',          // 701
  recommendation: 'standard',       // 706

  // scenario_gap (531) and target_expired (400) are deliberately absent: they
  // spend a full screen on the ladder rather than pooling it. See the header.
}

export function cardTier(type: SignalType | null | undefined): CardTier {
  return (type && TIER_BY_TYPE[type]) || 'full'
}

/**
 * The height a slot holding this tier occupies.
 *
 * `max-h-full` is the ceiling, and the unit matters more than it looks.
 *
 * ── Why this was `min(..., 100dvh)`, and why that was wrong ───────────────
 *
 * The ceiling exists to keep the gesture contract: a card never exceeds the
 * scroller, so it never grows an inner vertical scroller to fight the feed for
 * a drag. `100dvh` was the wrong measure of "the scroller". The feed is NOT
 * the viewport — the app chrome above it takes roughly 110px — so the two are
 * interchangeable only on a tall phone, which is the one this was measured on.
 *
 * Found on a real device at 400x700, where the numbers separate:
 *
 *     viewport            700px
 *     100dvh              700px
 *     the feed scroller   590px
 *     standard tier       min(46rem, 100dvh) = 700px  <- 110px TALLER than
 *                                                        the box it lives in
 *
 * A card 110px taller than its scroller puts its sticky action bar below the
 * visible area and pushes the content above it out of view. That is the "note
 * covered by the action region", the "excessive height" and the "dead space"
 * at once — and none of it reproduces at 390x844, where the scroller is 734
 * and the tier is 736, two pixels over. The claim this comment used to make,
 * that a short phone "degrades correctly", was never measured and was false.
 *
 * `max-h-full` resolves against the PARENT — the slot, sized by the scroller —
 * so the cap is the thing the card actually has to fit inside, on every
 * viewport, in a unit that cannot drift from it. Still fully deterministic: a
 * collapsed slot and a mounted one both compute `min(tier, scroller)`, so the
 * windowing geometry is unchanged.
 */
export const TIER_HEIGHT: Record<CardTier, string> = {
  compact: 'h-[28rem] max-h-full',
  medium: 'h-[32rem] max-h-full',
  standard: 'h-[46rem] max-h-full',
  full: 'h-full',
}

/** Pixel heights, for tests and for fixtures that need a number. */
export const TIER_PX: Record<CardTier, number> = {
  compact: 448,
  medium: 512,
  standard: 736,
  full: 844,
}
