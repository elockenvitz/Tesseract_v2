/**
 * Centralized note type taxonomy.
 *
 * Every note in the system carries exactly one type from this list.
 * Types are a controlled vocabulary — they are NOT free-form tags.
 *
 * Grouped by investment research lifecycle:
 *   Research           → research, analysis, earnings, model_valuation
 *   Decision Lifecycle → idea, decision, risk
 *   Interaction Logs   → meeting, call
 *
 * Architectural boundaries:
 *   - Thesis lives on the Asset page (canonical thesis field), NOT as a note type.
 *   - Observations / quick thoughts live in the Thought Capture system, NOT as a note type.
 *   - Notes represent structured, heavier-weight knowledge artifacts.
 */

export type NoteTypeId =
  | 'research' | 'analysis' | 'earnings' | 'model_valuation'
  | 'idea' | 'decision' | 'risk'
  | 'meeting' | 'call'

export interface NoteTypeConfig {
  id: NoteTypeId
  label: string
  group: NoteTypeGroup
  /** Tailwind dot / indicator color class */
  dotColor: string
  /** Badge variant key (maps to the Badge component's variant prop) */
  badgeVariant: 'default' | 'warning' | 'primary' | 'error' | 'success' | 'purple'
  /** Inline pill classes for list items (bg + text) */
  pillClasses: string
}

export type NoteTypeGroup = 'Research' | 'Decision Lifecycle' | 'Interaction Logs'

export const NOTE_TYPE_GROUPS: readonly NoteTypeGroup[] = [
  'Research',
  'Decision Lifecycle',
  'Interaction Logs',
] as const

export const NOTE_TYPES: readonly NoteTypeConfig[] = [
  // Research
  { id: 'research',         label: 'Research',           group: 'Research',           dotColor: 'bg-blue-400',    badgeVariant: 'primary', pillClasses: 'bg-blue-50 text-blue-700' },
  { id: 'analysis',         label: 'Analysis',           group: 'Research',           dotColor: 'bg-indigo-400',  badgeVariant: 'primary', pillClasses: 'bg-indigo-50 text-indigo-700' },
  { id: 'earnings',         label: 'Earnings Review',    group: 'Research',           dotColor: 'bg-emerald-400', badgeVariant: 'success', pillClasses: 'bg-emerald-50 text-emerald-700' },
  { id: 'model_valuation',  label: 'Model / Valuation',  group: 'Research',           dotColor: 'bg-cyan-400',    badgeVariant: 'primary', pillClasses: 'bg-cyan-50 text-cyan-700' },
  // Decision Lifecycle
  { id: 'idea',     label: 'Idea',            group: 'Decision Lifecycle', dotColor: 'bg-amber-400',   badgeVariant: 'warning', pillClasses: 'bg-amber-50 text-amber-700' },
  { id: 'decision', label: 'Decision',        group: 'Decision Lifecycle', dotColor: 'bg-violet-400',  badgeVariant: 'purple',  pillClasses: 'bg-violet-50 text-violet-700' },
  { id: 'risk',     label: 'Risk',            group: 'Decision Lifecycle', dotColor: 'bg-red-400',     badgeVariant: 'error',   pillClasses: 'bg-red-50 text-red-700' },
  // Interaction Logs
  { id: 'meeting',  label: 'Meeting',         group: 'Interaction Logs',   dotColor: 'bg-teal-400',    badgeVariant: 'success', pillClasses: 'bg-teal-50 text-teal-700' },
  { id: 'call',     label: 'Call',            group: 'Interaction Logs',   dotColor: 'bg-purple-400',  badgeVariant: 'purple',  pillClasses: 'bg-purple-50 text-purple-700' },
] as const

/** Fast lookup by id */
export const NOTE_TYPE_MAP = new Map<string, NoteTypeConfig>(
  NOTE_TYPES.map(t => [t.id, t])
)

/** Types grouped for dropdown rendering */
export const NOTE_TYPES_GROUPED: { group: NoteTypeGroup; types: NoteTypeConfig[] }[] =
  NOTE_TYPE_GROUPS.map(g => ({
    group: g,
    types: NOTE_TYPES.filter(t => t.group === g),
  }))

/**
 * Map legacy note_type values (from DB) to current IDs.
 * Existing notes with removed types resolve gracefully.
 *
 * Legacy mapping rationale:
 *   - thesis / thesis_update → research  (thesis now lives on Asset page, old thesis notes are research artifacts)
 *   - general → research                 (generic notes default to research)
 *   - research → research                (direct match, was previously mapped to analysis)
 *   - market_commentary → analysis       (structured commentary is analysis)
 *   - trade_rationale → idea             (trade rationale is an idea artifact)
 *   - risk_review → risk                 (direct semantic match)
 */
const LEGACY_TYPE_MAP: Record<string, NoteTypeId> = {
  // old → new
  thesis:            'research',
  thesis_update:     'research',
  general:           'research',
  research:          'research',
  risk_review:       'risk',
  trade_rationale:   'idea',
  market_commentary: 'analysis',
}

/** Resolve a note_type value (possibly null / legacy) to its config. Falls back to Research. */
export function getNoteType(type: string | null | undefined): NoteTypeConfig {
  if (!type) return NOTE_TYPE_MAP.get('research')!
  return NOTE_TYPE_MAP.get(type) ?? NOTE_TYPE_MAP.get(LEGACY_TYPE_MAP[type] ?? '') ?? NOTE_TYPE_MAP.get('research')!
}
