import React, { useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Edit3,
  Palette,
  FileText,
  Archive,
  ArchiveRestore,
  Plus,
  Trash2,
  MessageSquare,
  Sparkles,
  Tag,
  Pencil,
} from 'lucide-react'
import { useThemeActivity, type ThemeActivityEvent, type ThemeActivityType } from '../../hooks/useThemeActivity'

interface ThemeActivityFeedProps {
  themeId: string
}

const LIFECYCLE_LABELS: Record<string, string> = {
  emerging: 'Emerging',
  active: 'Active',
  playing_out: 'Playing Out',
  played_out: 'Played Out',
  invalidated: 'Invalidated',
}

function actorName(ev: ThemeActivityEvent): string {
  const u = ev.actor
  if (!u) return 'Someone'
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email?.split('@')[0] || 'Someone'
}

function iconFor(type: ThemeActivityType) {
  switch (type) {
    case 'theme.created':              return Sparkles
    case 'theme.renamed':              return Pencil
    case 'theme.description_updated':  return FileText
    case 'theme.color_changed':        return Palette
    case 'theme.lifecycle_changed':    return Tag
    case 'theme.archived':             return Archive
    case 'theme.unarchived':           return ArchiveRestore
    case 'theme.asset_added':          return Plus
    case 'theme.asset_removed':        return Trash2
    case 'theme.contribution_added':   return Edit3
    case 'theme.discussion_posted':    return MessageSquare
    default:                           return Activity
  }
}

function actionText(ev: ThemeActivityEvent): React.ReactNode {
  const md = ev.metadata || {}
  switch (ev.activity_type) {
    case 'theme.created':
      return <>created this theme</>
    case 'theme.renamed':
      return <>renamed to <span className="font-medium text-gray-900">{md.new || '—'}</span></>
    case 'theme.description_updated':
      return <>updated the description</>
    case 'theme.color_changed':
      return <>changed the color</>
    case 'theme.lifecycle_changed': {
      const next = LIFECYCLE_LABELS[md.new] || md.new
      return <>set status to <span className="font-medium text-gray-900">{next}</span></>
    }
    case 'theme.archived':
      return <>archived the theme</>
    case 'theme.unarchived':
      return <>restored the theme</>
    case 'theme.asset_added':
      return <>added <span className="font-medium text-gray-900">{md.symbol || 'an asset'}</span></>
    case 'theme.asset_removed':
      return <>removed <span className="font-medium text-gray-900">{md.symbol || 'an asset'}</span></>
    case 'theme.contribution_added':
      return <>added a thesis contribution</>
    case 'theme.discussion_posted':
      return <>posted in discussion{md.visibility === 'shared' ? ' (shared)' : ''}</>
    default:
      return <>did something</>
  }
}

export function ThemeActivityFeed({ themeId }: ThemeActivityFeedProps) {
  const [expanded, setExpanded] = useState(true)
  const { events, isLoading } = useThemeActivity(themeId)

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(e => !e)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-200 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Recent Activity</h3>
          {events.length > 0 && (
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-gray-200 text-gray-700">
              {events.length}
            </span>
          )}
        </div>
        {expanded ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
      </button>

      {expanded && (
        <div className="p-4">
          {isLoading ? (
            <div className="space-y-2 animate-pulse">
              {[...Array(3)].map((_, i) => <div key={i} className="h-8 bg-gray-100 rounded" />)}
            </div>
          ) : events.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500">
              No activity yet. Changes will appear here.
            </div>
          ) : (
            <ol className="space-y-2">
              {events.map((ev) => {
                const Icon = iconFor(ev.activity_type)
                return (
                  <li key={ev.id} className="flex items-start gap-2.5 text-sm">
                    <div className={clsx(
                      'w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5',
                      'bg-gray-100 text-gray-600'
                    )}>
                      <Icon className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-gray-700">
                        <span className="font-medium text-gray-900">{actorName(ev)}</span>{' '}
                        {actionText(ev)}
                      </span>
                      <span className="ml-1.5 text-xs text-gray-500">
                        · {formatDistanceToNow(new Date(ev.created_at), { addSuffix: true })}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  )
}
