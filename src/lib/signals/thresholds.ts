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
 * How long a case may go unwritten before silence alone is worth a screen.
 *
 * ── Why 90, and why it is absolute ────────────────────────────────────────
 *
 * The Research family previously used `STALE_DAYS = 30` as a candidate gate,
 * with the extra condition that silence was never sufficient on its own: a card
 * needed a 15% move or a 5%+ position that had been quiet three times as long.
 * That rule was written when "last touched" meant any note, thought or
 * contribution — a number that moved whenever anything happened near the asset.
 *
 * Now that the anchor is a section save and nothing else (`case-state.ts`),
 * thirty days is far too short: it is roughly "has anyone edited the case this
 * month", which most cases will fail forever. Ninety days is a claim about
 * investment work — a quarter without revisiting a written case is worth a
 * look — and it is deliberately ABSOLUTE rather than a percentile of what this
 * organisation happens to have written. If every case in a book is currently
 * stale, that is a true and useful statement about the book. Rescaling until
 * some of them look healthy would be the product lying to make itself calmer.
 *
 * Silence is now sufficient at this threshold, which is the one behavioural
 * reversal here. It is safe because it is also the WEAKEST framing in the
 * family and ranks last within it — an unanswered piece of evidence or an
 * unaccounted 30% move will always lead it. See `RESEARCH_FRAMING_BASE`.
 */
export const RESEARCH_STALE_DAYS = 90

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

/*
 * `MATERIAL_WEIGHT_PCT` and `LONG_SILENCE_DAYS` used to live here, and gated
 * the old size-alone Research path: a 5%+ position quiet for 90 days earned a
 * card on size alone. `RESEARCH_STALE_DAYS` replaced that rule outright, and
 * nothing else imported either constant — `explore-layout` states its own.
 *
 * They are removed rather than left exported, because a threshold nothing reads
 * is a threshold somebody will later assume is in force. Size still matters to
 * Research; it enters through `materialityBand` in `feed-priority`, where it
 * orders cards WITHIN a tier and can never create one. Weight is importance,
 * never severity.
 */

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
