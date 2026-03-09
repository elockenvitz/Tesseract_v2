/**
 * Centralized note type taxonomy.
 *
 * Every note in the system carries exactly one type from this list.
 * Types are a controlled vocabulary — they are NOT free-form tags.
 */

export type NoteTypeId = 'general' | 'research' | 'analysis' | 'idea' | 'meeting' | 'call'
  | 'thesis_update' | 'earnings' | 'risk_review' | 'trade_rationale' | 'market_commentary'

export interface NoteTypeConfig {
  id: NoteTypeId
  label: string
  /** Tailwind dot / indicator color class */
  dotColor: string
  /** Badge variant key (maps to the Badge component's variant prop) */
  badgeVariant: 'default' | 'warning' | 'primary' | 'error' | 'success' | 'purple'
  /** Inline pill classes for list items (bg + text) */
  pillClasses: string
}

export const NOTE_TYPES: readonly NoteTypeConfig[] = [
  // Portfolio-log categories (shown first in type selector)
  { id: 'thesis_update',     label: 'Portfolio Thesis',  dotColor: 'bg-blue-400',    badgeVariant: 'primary', pillClasses: 'bg-blue-50 text-blue-700' },
  { id: 'risk_review',       label: 'Risk Log',          dotColor: 'bg-red-400',     badgeVariant: 'error',   pillClasses: 'bg-red-50 text-red-700' },
  { id: 'trade_rationale',   label: 'Trade Idea',        dotColor: 'bg-orange-400',  badgeVariant: 'warning', pillClasses: 'bg-orange-50 text-orange-700' },
  { id: 'market_commentary', label: 'Macro View',        dotColor: 'bg-teal-400',    badgeVariant: 'default', pillClasses: 'bg-teal-50 text-teal-700' },
  { id: 'earnings',          label: 'Earnings',          dotColor: 'bg-emerald-400', badgeVariant: 'success', pillClasses: 'bg-emerald-50 text-emerald-700' },
  { id: 'research',          label: 'Decision',          dotColor: 'bg-indigo-400',  badgeVariant: 'primary', pillClasses: 'bg-indigo-50 text-indigo-700' },
  // Legacy types (still selectable for backward compatibility)
  { id: 'general',  label: 'General',  dotColor: 'bg-gray-400',    badgeVariant: 'default', pillClasses: 'bg-gray-100 text-gray-600' },
  { id: 'analysis', label: 'Analysis', dotColor: 'bg-blue-400',    badgeVariant: 'primary', pillClasses: 'bg-blue-50 text-blue-700' },
  { id: 'idea',     label: 'Trade Idea', dotColor: 'bg-rose-400',  badgeVariant: 'error',   pillClasses: 'bg-rose-50 text-rose-700' },
  { id: 'meeting',  label: 'Meeting',  dotColor: 'bg-emerald-400', badgeVariant: 'success', pillClasses: 'bg-emerald-50 text-emerald-700' },
  { id: 'call',     label: 'Call',     dotColor: 'bg-purple-400',  badgeVariant: 'purple',  pillClasses: 'bg-purple-50 text-purple-700' },
] as const

/** Fast lookup by id */
export const NOTE_TYPE_MAP = new Map<string, NoteTypeConfig>(
  NOTE_TYPES.map(t => [t.id, t])
)

/** Resolve a note_type value (possibly null) to its config. Falls back to General. */
export function getNoteType(type: string | null | undefined): NoteTypeConfig {
  return NOTE_TYPE_MAP.get(type ?? '') ?? NOTE_TYPES[0]
}
