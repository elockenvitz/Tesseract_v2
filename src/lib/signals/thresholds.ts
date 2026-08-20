/**
 * Product hypotheses, in one place, with the reasoning attached.
 *
 * These are not tuning constants. Each one encodes a claim about when an
 * investment fact becomes worth a screen, and every one of them is a guess we
 * expect to revise once the feed has been used in anger. Scattered through the
 * modules that consume them, revising a guess means finding every copy first —
 * and the copies drift, so "the 15% rule" quietly becomes three different rules.
 *
 * Nothing here is retuned as part of collecting it. The numbers are exactly the
 * ones Phase 7 shipped; only their address has changed.
 */

/** One day, in milliseconds. Used everywhere a gap is measured. */
export const DAY_MS = 86_400_000

// ─────────────────────────────────────────────────────────────────────────────
// Unreviewed change (Phase 7)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How long a recorded view must have gone untouched before it is even a
 * candidate. Silence is never sufficient on its own — see `MOVE_PCT`.
 */
export const STALE_DAYS = 30

/**
 * The move at which an unrevised view starts to matter.
 *
 * Deliberately distinct from every other move threshold in the codebase:
 * `unusualMovers` uses 3% for a single day, target-implausibility uses 3x, and
 * upside is strong or spent at 25%/5%. None of those is "has the price moved
 * enough since somebody last looked". 15% is roughly where a position's sizing
 * conversation changes.
 */
export const MOVE_PCT = 15

/** The weight at which a position is large enough to earn a look on size. */
export const MATERIAL_WEIGHT_PCT = 5

/**
 * The clock for the size-alone path, three times the ordinary one.
 *
 * A big position is not an EVENT — nothing happened, it is simply large and
 * old — so it must not compete with a card about something that changed.
 */
export const LONG_SILENCE_DAYS = 90

/**
 * A close more than this far before the touch is not a baseline for the touch.
 * Also bounds the price window that fetches those closes, so the two uses have
 * to stay the same number.
 */
export const BASELINE_TOLERANCE_DAYS = 30

// ─────────────────────────────────────────────────────────────────────────────
// Framework deviation (Phase 8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * When a price through a modelled case stops being a wobble.
 *
 * Matches the rule `scenarioGap.ts` already used to promote a card to
 * `critical`, lifted here so the ranking model and the card severity cannot
 * disagree about what "materially through" means.
 */
export const MATERIAL_DEVIATION_PCT = 15

/** Where a deviation stops being large and starts being a different problem. */
export const SEVERE_DEVIATION_PCT = 30

// ─────────────────────────────────────────────────────────────────────────────
// Workflow (Phase 8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * How overdue an assigned piece of work has to be before it stops being
 * housekeeping. Below this a workflow card ranks under every investment
 * signal; above it, it may be promoted — see `feed-priority.ts`.
 */
export const SEVERELY_OVERDUE_DAYS = 14
