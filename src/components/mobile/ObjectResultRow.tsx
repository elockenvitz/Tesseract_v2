import { clsx } from 'clsx'
import {
  Beaker, BookOpen, Briefcase, Calendar, Camera, Clock, FileSpreadsheet, FileText,
  FileType, FolderKanban, GitBranch, LayoutDashboard, List, PieChart, Search, Tag,
  TrendingUp, User, Users,
} from 'lucide-react'
import type { SearchResult } from '../../hooks/useObjectSearch'

/**
 * One named match, sized for a phone.
 *
 * The desktop row is built for a dropdown: 36px icon tiles, hover states and a
 * keyboard-selection highlight, inside a panel that caps at 420px. None of that
 * survives the move to a full-screen list — hover does not exist on touch, and
 * the selection ring is meaningless without arrow keys. This is the same
 * information at a tap-sized rhythm, matching ExploreResults directly below it
 * so the two sections read as one list rather than two pasted-together designs.
 */

const ICON: Record<string, { icon: typeof TrendingUp; tone: string }> = {
  asset: { icon: TrendingUp, tone: 'text-blue-600 bg-blue-50 dark:bg-blue-900/30' },
  portfolio: { icon: Briefcase, tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30' },
  theme: { icon: Tag, tone: 'text-indigo-600 bg-indigo-50 dark:bg-indigo-900/30' },
  note: { icon: FileText, tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800' },
  list: { icon: List, tone: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30' },
  tdf: { icon: Clock, tone: 'text-cyan-600 bg-cyan-50 dark:bg-cyan-900/30' },
  'allocation-period': { icon: PieChart, tone: 'text-rose-600 bg-rose-50 dark:bg-rose-900/30' },
  user: { icon: User, tone: 'text-gray-600 bg-gray-100 dark:bg-gray-800' },
  workflow: { icon: GitBranch, tone: 'text-orange-600 bg-orange-50 dark:bg-orange-900/30' },
  'workflow-template': { icon: GitBranch, tone: 'text-orange-500 bg-orange-50 dark:bg-orange-900/30' },
  project: { icon: FolderKanban, tone: 'text-violet-600 bg-violet-50 dark:bg-violet-900/30' },
  notebook: { icon: BookOpen, tone: 'text-amber-600 bg-amber-50 dark:bg-amber-900/30' },
  'model-template': { icon: FileSpreadsheet, tone: 'text-green-600 bg-green-50 dark:bg-green-900/30' },
  'model-file': { icon: FileSpreadsheet, tone: 'text-green-500 bg-green-50 dark:bg-green-900/30' },
  'text-template': { icon: FileType, tone: 'text-sky-600 bg-sky-50 dark:bg-sky-900/30' },
  team: { icon: Users, tone: 'text-teal-600 bg-teal-50 dark:bg-teal-900/30' },
  'calendar-event': { icon: Calendar, tone: 'text-red-500 bg-red-50 dark:bg-red-900/30' },
  capture: { icon: Camera, tone: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-900/30' },
  page: { icon: LayoutDashboard, tone: 'text-slate-600 bg-slate-100 dark:bg-slate-800' },
  'trade-lab': { icon: Beaker, tone: 'text-pink-600 bg-pink-50 dark:bg-pink-900/30' },
}

const LABEL: Record<string, string> = {
  page: 'Page',
  asset: 'Asset',
  portfolio: 'Portfolio',
  theme: 'Theme',
  list: 'List',
  note: 'Note',
  project: 'Project',
  workflow: 'Process',
  user: 'Person',
  team: 'Team',
  notebook: 'Notebook',
  tdf: 'TDF',
  'model-file': 'Model',
}

export function ObjectResultRow({
  result,
  onSelect,
}: {
  result: SearchResult
  onSelect: () => void
}) {
  const cfg = ICON[result.type] ?? { icon: Search, tone: 'text-gray-400 bg-gray-100 dark:bg-gray-800' }
  const Icon = cfg.icon

  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full text-left px-4 py-3 flex items-center gap-3 active:bg-gray-50 dark:active:bg-gray-800"
    >
      <span className={clsx('shrink-0 h-9 w-9 rounded-lg flex items-center justify-center', cfg.tone)}>
        <Icon className="h-4 w-4" />
      </span>

      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-2 min-w-0">
          <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
            {result.title}
          </span>
          <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-400">
            {LABEL[result.type] ?? result.type}
          </span>
        </span>
        {result.subtitle && (
          <span className="block text-xs text-gray-500 dark:text-gray-400 truncate mt-0.5">
            {result.subtitle}
          </span>
        )}
      </span>
    </button>
  )
}
