import { clsx } from 'clsx'
import {
  Beaker, BookOpen, Briefcase, Calendar, Camera, Clock, FileSpreadsheet, FileText,
  FileType, FolderKanban, GitBranch, LayoutDashboard, Lightbulb, List, PieChart,
  Search, Tag, TrendingUp, User, Users,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * One row in the phone's search list.
 *
 * Apps, objects and topic mentions all render through this. They were three
 * separate presentations at first — a dropdown of pages, a list of named
 * matches, a list of prose hits — and reading them as one list meant learning
 * three layouts to answer one question. A single row means rank is the only
 * thing distinguishing results, which is what rank is for.
 *
 * `matchedIn` and `excerpt` are optional rather than a separate row type: a
 * result found in a thesis has something to explain, and one found by name does
 * not. The row simply omits what is absent instead of branching.
 */

export interface SearchRowKind {
  icon: LucideIcon
  label: string
  tone: string
}

export const KIND_STYLE: Record<string, SearchRowKind> = {
  page: { icon: LayoutDashboard, label: 'App', tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800' },
  asset: { icon: TrendingUp, label: 'Asset', tone: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' },
  portfolio: { icon: Briefcase, label: 'Portfolio', tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' },
  theme: { icon: Tag, label: 'Theme', tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' },
  list: { icon: List, label: 'List', tone: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30' },
  note: { icon: FileText, label: 'Note', tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30' },
  idea: { icon: Lightbulb, label: 'Idea', tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' },
  project: { icon: FolderKanban, label: 'Project', tone: 'text-violet-600 bg-violet-50 dark:bg-violet-900/30' },
  workflow: { icon: GitBranch, label: 'Process', tone: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30' },
  'workflow-template': { icon: GitBranch, label: 'Process', tone: 'text-orange-500 bg-orange-50 dark:bg-orange-900/30' },
  user: { icon: User, label: 'Person', tone: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
  team: { icon: Users, label: 'Team', tone: 'text-teal-600 bg-teal-50 dark:bg-teal-900/30' },
  notebook: { icon: BookOpen, label: 'Notebook', tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30' },
  tdf: { icon: Clock, label: 'TDF', tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-900/30' },
  'allocation-period': { icon: PieChart, label: 'Allocation', tone: 'text-rose-600 bg-rose-50 dark:bg-rose-900/30' },
  'model-file': { icon: FileSpreadsheet, label: 'Model', tone: 'text-green-600 bg-green-50 dark:bg-green-900/30' },
  'model-template': { icon: FileSpreadsheet, label: 'Model', tone: 'text-green-600 bg-green-50 dark:bg-green-900/30' },
  'text-template': { icon: FileType, label: 'Template', tone: 'text-sky-600 bg-sky-50 dark:bg-sky-900/30' },
  'calendar-event': { icon: Calendar, label: 'Event', tone: 'text-red-500 bg-red-50 dark:bg-red-900/30' },
  capture: { icon: Camera, label: 'Capture', tone: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-900/30' },
  'trade-lab': { icon: Beaker, label: 'Trade Lab', tone: 'text-pink-600 bg-pink-50 dark:bg-pink-900/30' },
}

const FALLBACK: SearchRowKind = {
  icon: Search,
  label: 'Result',
  tone: 'text-gray-400 bg-gray-100 dark:bg-gray-800',
}

export interface UnifiedResult {
  key: string
  kind: string
  title: string
  subtitle?: string
  /** Where the term was found, when it was found in prose rather than a name. */
  matchedIn?: string
  /** The matching prose, trimmed around the hit. */
  excerpt?: string
  score: number
  select: () => void
}

export function SearchResultRow({ result }: { result: UnifiedResult }) {
  const style = KIND_STYLE[result.kind] ?? FALLBACK
  const Icon = style.icon

  return (
    <button
      type="button"
      onClick={result.select}
      className="w-full text-left px-4 py-3 flex items-start gap-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <span className={clsx('shrink-0 mt-0.5 h-9 w-9 rounded-lg flex items-center justify-center', style.tone)}>
        <Icon className="h-4 w-4" />
      </span>

      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {result.title}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
            {style.label}
          </span>
        </span>

        {result.subtitle && (
          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {result.subtitle}
          </span>
        )}

        {/* Only for prose hits. Without it a topic result is a name with no
            visible connection to what was typed. */}
        {result.matchedIn && (
          <span className="block text-[11px] text-gray-400 mt-0.5">
            matched in {result.matchedIn}
          </span>
        )}

        {result.excerpt && (
          <span className="block text-xs text-gray-600 dark:text-gray-300 mt-1 line-clamp-2 leading-snug">
            {result.excerpt}
          </span>
        )}
      </span>
    </button>
  )
}
