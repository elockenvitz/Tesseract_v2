import React from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow, format } from 'date-fns'
import { History as HistoryIcon, Plus, Edit3 } from 'lucide-react'
import { useThemeAggregateHistory } from '../../../hooks/useThemeResearch'
import type { ThemeResearchActiveTab } from './ThemeContributionSection'

interface ThemeThesisHistoryViewProps {
  themeId: string
  viewFilter: ThemeResearchActiveTab
}

function userDisplay(u: { first_name: string | null; last_name: string | null; email: string | null } | null): string {
  if (!u) return 'Unknown'
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email?.split('@')[0] || 'Unknown'
}

function initials(u: { first_name: string | null; last_name: string | null; email: string | null } | null): string {
  const first = (u?.first_name || u?.email || '?').charAt(0).toUpperCase()
  const last = (u?.last_name || '').charAt(0).toUpperCase()
  return (first + last).slice(0, 2) || '?'
}

export function ThemeThesisHistoryView({ themeId, viewFilter }: ThemeThesisHistoryViewProps) {
  const filterUserId = viewFilter === 'aggregated' ? null : viewFilter
  const { data, isLoading } = useThemeAggregateHistory(themeId, filterUserId)

  if (isLoading) {
    return <div className="h-40 bg-gray-100 rounded-lg animate-pulse" />
  }
  if (!data || data.length === 0) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
        <HistoryIcon className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No revision history yet.</p>
      </div>
    )
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg">
      <ol className="relative">
        {data.map((ev, i) => {
          const isCreation = !!ev.is_creation
          const Icon = isCreation ? Plus : Edit3
          return (
            <li key={ev.id} className={clsx(
              'flex items-start gap-3 p-4',
              i !== 0 && 'border-t border-gray-100'
            )}>
              <div className="shrink-0 relative">
                <div className={clsx(
                  'w-8 h-8 rounded-full flex items-center justify-center',
                  isCreation ? 'bg-emerald-50 text-emerald-600' : 'bg-blue-50 text-blue-600'
                )}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="font-medium text-sm text-gray-900">{userDisplay(ev.user)}</span>
                  <span className="text-xs text-gray-500">
                    {isCreation ? 'added' : 'edited'}
                  </span>
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 text-[10px] font-medium">
                    {ev.field?.name || ev.contribution?.section || 'field'}
                  </span>
                  <span className="text-xs text-gray-400">
                    · {formatDistanceToNow(new Date(ev.changed_at), { addSuffix: true })}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono ml-auto">
                    {format(new Date(ev.changed_at), 'yyyy-MM-dd HH:mm')}
                  </span>
                </div>
                {ev.new_content ? (
                  <div
                    className="text-sm text-gray-600 prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0 line-clamp-3"
                    dangerouslySetInnerHTML={{ __html: ev.new_content }}
                  />
                ) : null}
              </div>
              <div className="shrink-0 w-8 h-8 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-semibold">
                {initials(ev.user)}
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
