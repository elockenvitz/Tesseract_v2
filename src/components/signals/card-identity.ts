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
  // Was 'Going stale', which named the silence. The trigger is now a change
  // the recorded view has not answered, so the label names that instead.
  research_stale: 'Unreviewed change',
  no_research: 'No thesis',
  target_hit: 'Target reached',
  target_expired: 'Target expired',
  no_target: 'No target',
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
