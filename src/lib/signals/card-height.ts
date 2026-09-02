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
export type CardTier = 'compact' | 'standard' | 'full'

/**
 * Measured types only. The comment on each line is that type's largest
 * minimum-safe height across every fixture of it, which is what its tier has
 * to clear. Sized for the tail of a family, never its median: `no_research`
 * runs 246-370px across three fixtures and is sized for 370.
 */
const TIER_BY_TYPE: Partial<Record<SignalType, CardTier>> = {
  // Text and chips. Nothing here claims spare height, so spare height became a
  // dead band. Sized for `no_research` at 495px, the largest in the group.
  news: 'compact',              // 279
  thought: 'compact',           // 382
  research_stale: 'compact',    // 434
  awaiting_review: 'compact',   // 475
  no_research: 'compact',       // 495

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
 * `min(..., 100dvh)` is the ceiling that keeps the gesture contract: a card
 * never exceeds the viewport, so it never grows an inner vertical scroller to
 * fight the feed for a drag. On a short phone the lower tiers collapse into
 * the viewport height and the feed degrades to what it does today, which is
 * the correct failure.
 */
export const TIER_HEIGHT: Record<CardTier, string> = {
  compact: 'h-[min(32rem,100dvh)]',
  standard: 'h-[min(46rem,100dvh)]',
  full: 'h-full',
}

/** Pixel heights, for tests and for fixtures that need a number. */
export const TIER_PX: Record<CardTier, number> = {
  compact: 512,
  standard: 736,
  full: 844,
}
