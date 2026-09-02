import type { SignalType } from './contract'

/**
 * How much room a card is allowed to take, from a vocabulary of three.
 *
 * ── The measurement this exists to answer ─────────────────────────────────
 *
 * Every card rendered at exactly one viewport (844px on the reference phone),
 * and a pass over the gallery measured how much of that height carried ink:
 *
 *     news              28%   a 497px contiguous blank band
 *     thought           35%   460px
 *     research_stale    34%   428px
 *     awaiting_review   41%
 *     scenario_gap      54-67%
 *     active_risk       51-55%
 *
 * No card exceeded 67%. Releasing the forced height and measuring what the
 * content actually asks for gave a distribution with three clear clusters and
 * almost no within-type variance:
 *
 *     338-418px   news, thought, research_stale
 *     547-637px   awaiting_review, target_expired, scenario_gap, trade_idea, crowding
 *     695-739px   active_risk, conviction_*, recommendation, no_target
 *
 * ── Why three tiers rather than content height ────────────────────────────
 *
 * Free content sizing was tried and reverted, for a reason recorded in
 * `signal-cards.spec.ts`: "a news card at 327px next to a scenario card at 844
 * does not read as 'this one is brief', it reads as a surface that cannot
 * decide what it is". That objection is about ARBITRARINESS, not about
 * variation — a card that is 327px because that is where its text happened to
 * stop looks accidental. Three declared sizes do not: they read as a decision,
 * the way a headline and a caption read as a decision rather than as two font
 * sizes that came out different.
 *
 * The one-viewport rule replaced it, and its own premise — recorded in the
 * same file — was that "a card gets a screen AND has to earn it". The
 * measurement above is that premise failing: four families cannot earn a
 * screen, and were padded to one anyway.
 *
 * ── Why keyed by type, and why the table is partial ───────────────────────
 *
 * Within-type variance is under 20px across the fixtures, so the type predicts
 * the content height almost exactly. It is a partial table on purpose: only
 * types whose natural height was actually MEASURED get an entry. Anything else
 * falls to `tall`, which is one viewport — precisely today's behaviour. A type
 * added later cannot be silently clipped by a guess made here; it keeps the
 * full screen until somebody measures it.
 *
 * This is a layout decision about a rendered card, which is why it is a table
 * here and not a branch in `SignalCardView`. The rule that component holds —
 * no per-type branch in the renderer — is about what a card SAYS. It says the
 * same thing at every tier.
 */
export type CardTier = 'compact' | 'standard' | 'tall'

/**
 * Measured types only. See the header for why this is deliberately partial.
 *
 * The tier is chosen one step ABOVE the measured content height, never at it:
 * a compact card measured at 418px gets 464px, so the clamp lines that keep a
 * long headline honest have the same slack they have today. The headroom is
 * roughly proportional across the three (46px / 43px / 59px), so no tier is
 * meaningfully tighter against its content than its neighbours.
 */
const TIER_BY_TYPE: Partial<Record<SignalType, CardTier>> = {
  // 345-418px measured.
  news: 'compact',
  thought: 'compact',
  research_stale: 'compact',
  // 547-637px measured.
  awaiting_review: 'standard',
  target_expired: 'standard',
  scenario_gap: 'standard',
  trade_idea: 'standard',
  crowding: 'standard',
  // 695-739px measured — a full screen, which is also the default.
  active_risk: 'tall',
  conviction_oversized: 'tall',
  conviction_undersized: 'tall',
  recommendation: 'tall',
  no_target: 'tall',
}

export function cardTier(type: SignalType): CardTier {
  return TIER_BY_TYPE[type] ?? 'tall'
}

/**
 * The height a slot holding this tier occupies.
 *
 * `min(..., 100dvh)` is the ceiling that keeps the gesture contract: a card
 * never exceeds the viewport, so it never grows an inner vertical scroller to
 * fight the feed for a drag. On a short phone the two lower tiers collapse
 * into the viewport height and the feed degrades to what it does today, which
 * is the correct failure.
 */
export const TIER_HEIGHT: Record<CardTier, string> = {
  compact: 'h-[min(29rem,100dvh)]',
  standard: 'h-[min(42.5rem,100dvh)]',
  tall: 'h-full',
}

/** Pixel heights, for the tests and the fixtures that need a number. */
export const TIER_PX: Record<CardTier, number> = {
  compact: 464,
  standard: 680,
  tall: 844,
}
