import type { Severity, SignalType, Surface } from '../../lib/signals/contract'

/**
 * What a card calls itself, and what colour it wears.
 *
 * ── Why the kind, not the surface ─────────────────────────────────────────
 *
 * The eyebrow showed the surface: four values across seventeen types. Stale
 * coverage, a missing thesis, a conflicting view and an expired target all
 * rendered as the single word "Research", so the feed looked like one thing
 * repeated rather than a queue of different findings. Nobody can scan that, and
 * "why is everything called Research" is the correct reaction to it.
 *
 * The kind is the label now. The surface survives as the colour that carries
 * it, which is what a surface is actually good for — grouping without naming.
 *
 * ── Why colour at all ─────────────────────────────────────────────────────
 *
 * The card was black, white and grey, with a single coloured dot. That reads as
 * a spreadsheet row: correct, legible, and giving the eye no reason to move.
 * A feed people scroll needs the next card to look different from the last one
 * before a word is read.
 *
 * The restraint is that colour means something and is never decorative. Hue is
 * the surface — where the finding comes from. Weight is severity. Nothing is
 * tinted to be pretty, so a red card is always worth more attention than an
 * amber one, and a reader can learn that in a day and rely on it after.
 */

export const KIND_LABEL: Record<SignalType, string> = {
  active_risk: 'Active risk',
  crowding: 'Crowded name',
  conviction_undersized: 'Undersized',
  conviction_oversized: 'Oversized',
  recommendation: 'Awaiting decision',
  scenario_gap: 'Case vs price',
  /**
   * The two Research entries are CATEGORY labels, not card labels.
   *
   * They name what a filter selects, and each type now covers several
   * framings — so a label precise enough for one member is false for another.
   * "Unreviewed change" was false for a case where nothing changed; "No thesis"
   * was false for a case whose thesis is the one section that IS written.
   *
   * Broad here, exact on the card: `buildInsightCard` sets `kindLabel` from the
   * framing, and `SignalCardView` prefers it. This map keeps serving Curate's
   * option list and the empty-state sentence, where a per-framing word would be
   * a filter nobody asked for.
   */
  research_stale: 'Needs review',
  no_research: 'Case gaps',
  target_hit: 'Target reached',
  target_expired: 'Target expired',
  // "No target" is ambiguous on a feed that also carries active-weight and
  // conviction cards, where "target" means a target weight. This one is about
  // a price target and nothing else.
  no_target: 'No price target',
  team_focus: 'Team focus',
  thought: 'Thought',
  trade_idea: 'Trade idea',
  pair_trade: 'Pair trade',
  research_note: 'Research note',
  thesis_update: 'Thesis update',
  discussion: 'Discussion',
  thesis_conflict: 'Disagreement',
  catalyst_ahead: 'Catalyst near',
  project_overdue: 'Overdue',
  awaiting_review: 'Needs review',
  news: 'News',
  unusual_move: 'Unusual move',
  earnings_ahead: 'Earnings ahead',
  earnings_result: 'Earnings result',
  corporate_action: 'Corporate action',
  economic_release: 'Economic release',
}

export interface SurfaceSkin {
  /** The eyebrow chip: kind label sits in this. */
  chip: string
  /** Tint behind the metric block, so the number is the loudest thing. */
  metricWell: string
  /** Hairline at the very top of the card — the first thing the eye meets. */
  topRule: string
  /** Accent used for small marks: the "why" affordance, the detail border. */
  accentText: string
}

/**
 * Four surfaces, four hues, deliberately far apart so two cards in a row are
 * distinguishable at a glance rather than on inspection.
 */
export const SURFACE_SKIN: Record<Surface, SurfaceSkin> = {
  risk: {
    chip: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
    metricWell: 'bg-gradient-to-br from-rose-50 to-transparent dark:from-rose-500/10',
    topRule: 'bg-gradient-to-r from-rose-500 via-rose-400 to-transparent',
    accentText: 'text-rose-600 dark:text-rose-400',
  },
  research: {
    chip: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
    metricWell: 'bg-gradient-to-br from-indigo-50 to-transparent dark:from-indigo-500/10',
    topRule: 'bg-gradient-to-r from-indigo-500 via-indigo-400 to-transparent',
    accentText: 'text-indigo-600 dark:text-indigo-400',
  },
  market: {
    chip: 'bg-teal-100 text-teal-700 dark:bg-teal-500/15 dark:text-teal-300',
    metricWell: 'bg-gradient-to-br from-teal-50 to-transparent dark:from-teal-500/10',
    topRule: 'bg-gradient-to-r from-teal-500 via-teal-400 to-transparent',
    accentText: 'text-teal-600 dark:text-teal-400',
  },
  workflow: {
    chip: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
    metricWell: 'bg-gradient-to-br from-amber-50 to-transparent dark:from-amber-500/10',
    topRule: 'bg-gradient-to-r from-amber-500 via-amber-400 to-transparent',
    accentText: 'text-amber-700 dark:text-amber-400',
  },
  // Violet, and distinct from `research` indigo on purpose. These cards carry
  // what a colleague said rather than what the data noticed, and a reader
  // scanning the feed should be able to tell a person's view from a machine's
  // observation before reading a word of either.
  desk: {
    chip: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
    metricWell: 'bg-gradient-to-br from-violet-50 to-transparent dark:from-violet-500/10',
    topRule: 'bg-gradient-to-r from-violet-500 via-violet-400 to-transparent',
    accentText: 'text-violet-600 dark:text-violet-400',
  },
}

/**
 * Severity is weight, not hue.
 *
 * Keeping it out of the colour channel is what lets hue mean "where this came
 * from" consistently. A critical market card and a critical risk card are
 * different colours and equally urgent, which is the correct relationship — the
 * alternative makes every urgent thing look like a risk item.
 */
export const SEVERITY_MARK: Record<Severity, string> = {
  critical: 'h-2 w-2 rounded-full bg-rose-500 ring-2 ring-rose-500/25',
  attention: 'h-2 w-2 rounded-full bg-amber-500',
  informational: 'h-1.5 w-1.5 rounded-full bg-gray-300 dark:bg-gray-600',
}

/** Only the truly urgent gets a top rule; otherwise it stops meaning anything. */
export const showsTopRule = (severity: Severity) => severity === 'critical'

/**
 * Whether a card's body IS the finding, or merely describes it.
 *
 * ── Why one line is the default ───────────────────────────────────────────
 *
 * Every card's body was two clamped lines. On a card whose prose is supporting
 * context — "Taylor does not like to order food delivery", "NKE: needs a proper
 * review before I would call it either way" — those two lines plus their margin
 * cost about 60px, taken from the chart directly above them, on the region the
 * card exists to show. Multiplied across the feed it is why the price charts
 * felt like miniatures of the case-vs-price one.
 *
 * So supporting prose gets ONE line and a tap to read the rest, and the space
 * goes back to the visual.
 *
 * ── The exception, which is not a special case ────────────────────────────
 *
 * On the post kinds the prose is not describing the finding, it IS the finding:
 * a colleague's thought, a research note, a thesis update, a discussion. There
 * is no chart competing for the room — the words are what the reader came for.
 * Clamping those to one line would be the same mistake in the other direction.
 *
 * Derived from the type rather than set per card, so a new card type inherits
 * the right treatment instead of having to remember to ask for it.
 */
const PRIMARY_PROSE: ReadonlySet<SignalType> = new Set<SignalType>([
  'thought', 'research_note', 'thesis_update', 'discussion',
])

export function bodyIsPrimaryProse(type: SignalType): boolean {
  return PRIMARY_PROSE.has(type)
}
