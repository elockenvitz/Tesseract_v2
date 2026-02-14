import React, { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  Clock,
  Sparkles,
  DollarSign,
  ChevronRight,
  GitCompare,
  Lightbulb,
  ChevronDown,
  ChevronUp,
  Filter,
  Zap,
  Gauge
} from 'lucide-react'
import { formatDistanceToNow, format, differenceInMinutes } from 'date-fns'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useHistoryEvolutionAnalysis, type HistoryEvent, type EvolutionAnalysis } from '../../hooks/useContributions'
import { useAssetRevisions, useUpdateRevisionNote, type RevisionRow } from '../../hooks/useAssetRevisions'
import { EvolutionOverview, type EvolutionStats, type Sentiment } from './EvolutionOverview'
import { EvolutionTimeline } from './EvolutionTimeline'
import { RevisionCompare } from './RevisionCompare'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface ThesisHistoryViewProps {
  assetId: string
  viewFilter: 'aggregated' | string
  className?: string
}

type ViewMode = 'latest' | 'timeline' | 'compare'
type HistoryFilter = 'all' | 'thesis' | 'where_different' | 'risks_to_thesis' | 'price_target' | 'rating' | 'reference'

// ============================================================================
// REVISION SESSION GROUPING (client-side until DB revision sessions exist)
// ============================================================================

interface RevisionSession {
  id: string
  userId: string
  userName: string
  startedAt: Date
  lastActivityAt: Date
  events: HistoryEvent[]
}

const MAX_SESSION_WINDOW_MIN = 30
const INACTIVITY_CUTOFF_MIN = 10

/** Groups events into revision sessions. Events must be sorted desc by timestamp. */
function groupIntoSessions(events: HistoryEvent[]): RevisionSession[] {
  if (events.length === 0) return []

  const sessions: RevisionSession[] = []
  let current: RevisionSession | null = null

  // Walk events in chronological order so we build sessions forward
  const chronological = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

  for (const event of chronological) {
    const fitsCurrentSession =
      current &&
      current.userId === event.userId &&
      differenceInMinutes(event.timestamp, current.startedAt) <= MAX_SESSION_WINDOW_MIN &&
      differenceInMinutes(event.timestamp, current.lastActivityAt) <= INACTIVITY_CUTOFF_MIN

    if (fitsCurrentSession && current) {
      current.events.push(event)
      current.lastActivityAt = event.timestamp
    } else {
      current = {
        id: `session-${event.id}`,
        userId: event.userId,
        userName: event.userName,
        startedAt: event.timestamp,
        lastActivityAt: event.timestamp,
        events: [event],
      }
      sessions.push(current)
    }
  }

  // Return newest-first
  return sessions.reverse()
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const filterConfig: { value: HistoryFilter; label: string; color: string }[] = [
  { value: 'all', label: 'All', color: 'text-gray-600' },
  { value: 'thesis', label: 'Thesis', color: 'text-primary-600' },
  { value: 'where_different', label: 'Different', color: 'text-purple-600' },
  { value: 'risks_to_thesis', label: 'Risks', color: 'text-amber-600' },
  { value: 'price_target', label: 'Targets', color: 'text-green-600' },
  { value: 'reference', label: 'Docs', color: 'text-blue-600' },
]

// ============================================================================
// SIMPLE DIFF FUNCTION
// ============================================================================

interface DiffPart {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

function getWordBase(word: string): string {
  return word.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
}

function wordsMatch(a: string, b: string): boolean {
  if (a === b) return true
  return getWordBase(a) === getWordBase(b) && getWordBase(a).length > 0
}

function computeSimpleDiff(oldText: string | null, newText: string | null): DiffPart[] {
  if (!oldText && !newText) return []
  if (!oldText) return [{ type: 'added', text: newText! }]
  if (!newText) return [{ type: 'removed', text: oldText }]

  const oldWords = oldText.split(/\s+/).filter(w => w.length > 0)
  const newWords = newText.split(/\s+/).filter(w => w.length > 0)

  const m = oldWords.length
  const n = newWords.length

  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (wordsMatch(oldWords[i - 1], newWords[j - 1])) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  const parts: DiffPart[] = []
  let i = m, j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && wordsMatch(oldWords[i - 1], newWords[j - 1])) {
      parts.unshift({ type: 'unchanged', text: newWords[j - 1] })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      parts.unshift({ type: 'added', text: newWords[j - 1] })
      j--
    } else if (i > 0) {
      parts.unshift({ type: 'removed', text: oldWords[i - 1] })
      i--
    }
  }

  const result: DiffPart[] = []
  for (const part of parts) {
    const last = result[result.length - 1]
    if (last && last.type === part.type) {
      last.text += ' ' + part.text
    } else {
      result.push({ ...part })
    }
  }

  return result
}

// ============================================================================
// DIFF DISPLAY COMPONENT
// ============================================================================

function DiffView({ oldContent, newContent }: { oldContent: string | null; newContent: string | null }) {
  const diff = computeSimpleDiff(oldContent, newContent)

  if (diff.length === 0) {
    return <span className="text-gray-400 italic">No changes</span>
  }

  return (
    <div className="text-sm leading-relaxed">
      {diff.map((part, idx) => {
        const needsSpace = idx > 0
        if (part.type === 'unchanged') {
          return <span key={idx} className="text-gray-700">{needsSpace ? ' ' : ''}{part.text}</span>
        } else if (part.type === 'added') {
          return (
            <span key={idx}>
              {needsSpace ? ' ' : ''}
              <span className="bg-green-100 text-green-800 rounded px-0.5">{part.text}</span>
            </span>
          )
        } else {
          return (
            <span key={idx}>
              {needsSpace ? ' ' : ''}
              <span className="bg-red-100 text-red-800 line-through rounded px-0.5">{part.text}</span>
            </span>
          )
        }
      })}
    </div>
  )
}

// ============================================================================
// LIST VIEW TIMELINE EVENT
// ============================================================================

function TimelineEvent({ event }: { event: HistoryEvent }) {
  const typeConfig: Record<string, { color: string; label: string }> = {
    thesis: { color: 'text-primary-600', label: 'Investment Thesis' },
    where_different: { color: 'text-purple-600', label: 'Where Different' },
    risks_to_thesis: { color: 'text-amber-600', label: 'Risks to Thesis' },
    price_target: { color: 'text-green-600', label: 'Price Target' },
    rating: { color: 'text-indigo-600', label: 'Rating' },
    reference: { color: 'text-blue-600', label: 'Supporting Docs' }
  }

  const config = typeConfig[event.type] || { color: 'text-gray-600', label: event.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) }

  const priceChange = event.type === 'price_target' && event.priceTarget && event.previousPriceTarget
    ? ((event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget) * 100
    : null

  return (
    <div className="py-2 border-b border-gray-100 last:border-b-0">
      <div className="flex items-center gap-1.5 text-xs mb-1 flex-wrap">
        <span className={clsx('font-semibold', config.color)}>{config.label}</span>
        <span className="text-gray-300">·</span>
        <span className="font-medium text-gray-600">{event.userName}</span>
        <span className="text-gray-300">·</span>
        <span className="text-gray-400" title={format(event.timestamp, 'PPpp')}>
          {formatDistanceToNow(event.timestamp, { addSuffix: true })}
        </span>
      </div>

      {event.type === 'price_target' && (
        <div className="flex items-center gap-2 text-sm">
          {event.previousPriceTarget && (
            <>
              <span className="text-gray-400">${event.previousPriceTarget}</span>
              <ChevronRight className="w-3 h-3 text-gray-300" />
            </>
          )}
          <span className="font-semibold text-gray-900">${event.priceTarget}</span>
          {priceChange !== null && (
            <span className={clsx(
              'text-xs px-1 rounded',
              priceChange > 0 ? 'text-green-600' : priceChange < 0 ? 'text-red-600' : 'text-gray-500'
            )}>
              {priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%
            </span>
          )}
        </div>
      )}

      {event.type !== 'price_target' && (
        <div className="text-sm">
          {event.previousContent ? (
            <DiffView oldContent={event.previousContent} newContent={event.content || null} />
          ) : event.content ? (
            <span className="bg-green-100 text-green-800 rounded px-0.5">{event.content}</span>
          ) : null}
        </div>
      )}
    </div>
  )
}

// ============================================================================
// REVISION SESSION CARD (for Latest Changes view)
// ============================================================================

const categoryConfig: Record<string, { label: string; color: string }> = {
  thesis: { label: 'Thesis', color: 'text-primary-600' },
  where_different: { label: 'Where Different', color: 'text-purple-600' },
  risks_to_thesis: { label: 'Risks', color: 'text-amber-600' },
  price_target: { label: 'Valuation & Targets', color: 'text-green-600' },
  valuation_targets: { label: 'Valuation & Targets', color: 'text-green-600' },
  rating: { label: 'Rating', color: 'text-indigo-600' },
  reference: { label: 'Supporting', color: 'text-blue-600' },
}

const CONTEXT_EDIT_WINDOW_MS = 24 * 60 * 60 * 1000 // 24 hours

/** Whether the current user can edit contextualization on this revision. */
function canEditContext(
  revision: RevisionRow,
  currentUserId: string | undefined,
  now: Date = new Date()
): boolean {
  if (!currentUserId) return false
  if (revision.actor_user_id !== currentUserId) return false
  const createdAt = new Date(revision.created_at).getTime()
  return now.getTime() - createdAt <= CONTEXT_EDIT_WINDOW_MS
}

function ContextDisclosure({
  revisionId,
  text,
  editable,
  onSave,
  isSaving,
}: {
  revisionId: string
  text: string | null
  editable: boolean
  onSave: (revisionId: string, note: string | null) => void
  isSaving: boolean
}) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text || '')

  // Nothing to show: no text and not editable
  if (!text && !editable) return null

  // No text but editable → show CTA
  if (!text && editable) {
    if (editing) {
      return (
        <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
          <textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                onSave(revisionId, draft || null)
                setEditing(false)
              }
              if (e.key === 'Escape') { setEditing(false); setDraft('') }
            }}
            placeholder="Why were these changes made? What prompted this revision?"
            className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-gray-800 dark:text-gray-200 placeholder-gray-400 resize-none"
          />
          <div className="flex items-center gap-2 mt-1.5">
            <button
              onClick={() => { onSave(revisionId, draft || null); setEditing(false) }}
              disabled={isSaving || !draft.trim()}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-300"
            >
              Save
            </button>
            <button
              onClick={() => { setEditing(false); setDraft('') }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Cancel
            </button>
          </div>
        </div>
      )
    }

    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left px-3 py-1.5 border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <span className="text-xs text-gray-400 hover:text-gray-500">Contextualize changes</span>
      </button>
    )
  }

  // Text exists → collapsed disclosure
  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full flex items-center gap-1.5 px-3 py-1.5 text-left border-b border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      >
        <ChevronRight className="w-3 h-3 text-gray-400" />
        <span className="text-xs text-gray-500 font-medium">Context</span>
      </button>
    )
  }

  // Expanded: show text (with optional edit)
  if (editing) {
    return (
      <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
        <button
          onClick={() => { setOpen(false); setEditing(false); setDraft(text || '') }}
          className="flex items-center gap-1.5 mb-1.5"
        >
          <ChevronDown className="w-3 h-3 text-gray-400" />
          <span className="text-xs text-gray-500 font-medium">Context</span>
        </button>
        <textarea
          autoFocus
          rows={2}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              onSave(revisionId, draft || null)
              setEditing(false)
            }
            if (e.key === 'Escape') { setEditing(false); setDraft(text || '') }
          }}
          className="w-full text-xs bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-gray-800 dark:text-gray-200 placeholder-gray-400 resize-none"
        />
        <div className="flex items-center gap-2 mt-1.5">
          <button
            onClick={() => { onSave(revisionId, draft || null); setEditing(false) }}
            disabled={isSaving}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium disabled:text-gray-300"
          >
            Save
          </button>
          <button
            onClick={() => { setEditing(false); setDraft(text || '') }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/30">
      <div className="flex items-center justify-between mb-1">
        <button
          onClick={() => setOpen(false)}
          className="flex items-center gap-1.5"
        >
          <ChevronDown className="w-3 h-3 text-gray-400" />
          <span className="text-xs text-gray-500 font-medium">Context</span>
        </button>
        {editable && (
          <button
            onClick={() => { setDraft(text || ''); setEditing(true) }}
            className="text-xs text-gray-400 hover:text-gray-600"
          >
            Edit
          </button>
        )}
      </div>
      <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{text}</p>
    </div>
  )
}

function RevisionSessionCard({
  session,
  defaultExpanded,
  significantOnly,
  revisionRow,
  currentUserId,
  viewFilter,
  onSaveNote,
  isSavingNote,
}: {
  session: RevisionSession
  defaultExpanded: boolean
  significantOnly: boolean
  revisionRow?: RevisionRow
  currentUserId?: string
  viewFilter: 'aggregated' | string
  onSaveNote?: (revisionId: string, note: string | null) => void
  isSavingNote?: boolean
}) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Filter events by significance if toggle is on
  // Tier 1 (material structured): price_target, risks_to_thesis (add/remove)
  // Tier 2 (text updates): thesis, where_different — hidden when significant only
  // Tier 3 (supporting): reference — hidden when significant only
  const visibleEvents = significantOnly
    ? session.events.filter(e => e.type === 'price_target' || e.type === 'risks_to_thesis' || e.type === 'rating')
    : session.events

  // Group events by category
  const categorized = useMemo(() => {
    const groups: Record<string, HistoryEvent[]> = {}
    for (const e of visibleEvents) {
      const cat = e.type
      if (!groups[cat]) groups[cat] = []
      groups[cat].push(e)
    }
    return groups
  }, [visibleEvents])

  const materialCount = session.events.filter(
    e => e.type === 'price_target' || e.type === 'risks_to_thesis' || e.type === 'rating'
  ).length

  const changeLabel = materialCount > 0
    ? `${materialCount} material change${materialCount !== 1 ? 's' : ''}`
    : `${session.events.length} change${session.events.length !== 1 ? 's' : ''}`

  // Derive view scope label from viewFilter (aggregated = Firm View, userId = user's first name View)
  const viewScopeLabel = viewFilter === 'aggregated'
    ? 'Firm View'
    : `${session.userName.split(' ')[0]} View`

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg transition-colors group"
      >
        <ChevronRight className="w-3.5 h-3.5 text-gray-400 group-hover:text-gray-600 flex-shrink-0" />
        <span className="text-xs text-gray-500">
          {format(session.lastActivityAt, 'MMM d')}
        </span>
        <span className="text-gray-300">·</span>
        <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
          {session.userName}
        </span>
        {viewScopeLabel && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-400">{viewScopeLabel}</span>
          </>
        )}
        <span className="text-gray-300">·</span>
        <span className="text-xs text-gray-500">{changeLabel}</span>
        {revisionRow?.revision_note && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-blue-500 truncate max-w-[200px]">{revisionRow.revision_note}</span>
          </>
        )}
      </button>
    )
  }

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
      {/* Session header */}
      <button
        onClick={() => !defaultExpanded && setExpanded(false)}
        className={clsx(
          'w-full flex items-center gap-2 px-3 py-2.5 text-left bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700',
          !defaultExpanded && 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
        )}
      >
        {!defaultExpanded && (
          <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
        )}
        <span className="text-xs font-medium text-gray-900 dark:text-gray-100">
          {session.userName}
        </span>
        {viewScopeLabel && (
          <>
            <span className="text-gray-300">·</span>
            <span className="text-xs text-gray-400">{viewScopeLabel}</span>
          </>
        )}
        <span className="text-gray-300">·</span>
        <span className="text-xs text-gray-500" title={format(session.lastActivityAt, 'PPpp')}>
          {formatDistanceToNow(session.lastActivityAt, { addSuffix: true })}
        </span>
        <span className="text-gray-300">·</span>
        <span className="text-xs text-gray-500">{changeLabel}</span>
      </button>

      {/* Contextualization (only if DB revision exists) */}
      {revisionRow && onSaveNote && (
        <ContextDisclosure
          revisionId={revisionRow.id}
          text={revisionRow.revision_note}
          editable={canEditContext(revisionRow, currentUserId)}
          onSave={onSaveNote}
          isSaving={isSavingNote || false}
        />
      )}

      {/* Categorized changes */}
      <div className="p-3 space-y-3">
        {Object.entries(categorized).map(([cat, catEvents]) => {
          const cfg = categoryConfig[cat] || { label: cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), color: 'text-gray-600' }
          return (
            <div key={cat}>
              <p className={clsx('text-xs font-semibold mb-1.5', cfg.color)}>{cfg.label}</p>
              <div className="space-y-0.5">
                {catEvents.map(event => (
                  <RevisionEventRow key={event.id} event={event} />
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Human-readable label for event type */
const typeLabel: Record<string, string> = {
  thesis: 'Investment Thesis',
  where_different: 'Where Different',
  risks_to_thesis: 'Risks to Thesis',
  reference: 'Supporting reference',
}

function RevisionEventRow({ event }: { event: HistoryEvent }) {
  // Price change with $ amounts (only when priceTarget is set)
  if (event.type === 'price_target' && event.priceTarget != null) {
    const priceChange = event.priceTarget && event.previousPriceTarget
      ? ((event.priceTarget - event.previousPriceTarget) / event.previousPriceTarget) * 100
      : null
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <DollarSign className="w-3 h-3 text-green-500 flex-shrink-0" />
        {event.scenarioLabel && (
          <span className="text-xs font-medium text-gray-500">{event.scenarioLabel}:</span>
        )}
        {event.previousPriceTarget && (
          <>
            <span className="text-gray-400">${event.previousPriceTarget}</span>
            <ChevronRight className="w-3 h-3 text-gray-300" />
          </>
        )}
        <span className="font-semibold text-gray-900 dark:text-gray-100">${event.priceTarget}</span>
        {priceChange !== null && (
          <span className={clsx(
            'text-xs px-1 rounded',
            priceChange > 0 ? 'text-green-600' : priceChange < 0 ? 'text-red-600' : 'text-gray-500'
          )}>
            ({priceChange > 0 ? '+' : ''}{priceChange.toFixed(1)}%)
          </span>
        )}
      </div>
    )
  }

  // Price target content events (prob/expiry — have content but no priceTarget)
  if (event.type === 'price_target' && event.content) {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <DollarSign className="w-3 h-3 text-green-500 flex-shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-xs">{event.content}</span>
      </div>
    )
  }

  // Rating event
  if (event.type === 'rating') {
    return (
      <div className="flex items-center gap-2 text-sm py-0.5">
        <Gauge className="w-3 h-3 text-indigo-500 flex-shrink-0" />
        <span className="text-gray-700 dark:text-gray-300 text-xs">{event.content}</span>
      </div>
    )
  }

  // Text-based change: structured label like "Investment Thesis updated (excerpt): ..."
  const friendlyType = typeLabel[event.type] || event.type.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const verb = event.previousContent ? 'updated' : 'added'
  const excerpt = event.content
    ? event.content.substring(0, 100) + (event.content.length > 100 ? '…' : '')
    : null

  return (
    <div className="flex items-start gap-2 text-sm py-0.5">
      <span className="text-gray-500 text-xs mt-0.5 flex-shrink-0 whitespace-nowrap">
        {friendlyType} {verb}{excerpt ? ':' : ''}
      </span>
      {excerpt && (
        <span className="text-gray-500 dark:text-gray-400 text-xs line-clamp-1 italic">
          {excerpt}
        </span>
      )}
    </div>
  )
}

// ============================================================================
// AI INSIGHTS PANEL
// ============================================================================

interface AIInsightsPanelProps {
  analysis: EvolutionAnalysis | null
}

function AIInsightsPanel({ analysis }: AIInsightsPanelProps) {
  const [expanded, setExpanded] = useState(true)

  // Don't show loading skeleton for cache checks — only render once we have data.
  // The "Analyze evolution" link handles the generating state separately.
  if (!analysis) return null

  return (
    <div className="bg-purple-50 border border-purple-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-purple-100 transition-colors"
      >
        <div className="flex items-center gap-2">
          <Lightbulb className="w-4 h-4 text-purple-600" />
          <span className="text-sm font-semibold text-purple-900">AI Evolution Insights</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-purple-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-purple-400" />
        )}
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Thesis Evolution Summary */}
          <div>
            <p className="text-xs font-medium text-purple-700 mb-1">Thesis Evolution</p>
            <p className="text-sm text-purple-900">{analysis.thesisEvolution}</p>
          </div>

          {/* Key Insights */}
          <div>
            <p className="text-xs font-medium text-purple-700 mb-2">Key Insights</p>
            <ul className="space-y-1.5">
              {analysis.insights.map((insight, idx) => (
                <li key={idx} className="flex items-start gap-2 text-sm text-purple-800">
                  <Sparkles className="w-3 h-3 text-purple-500 mt-0.5 flex-shrink-0" />
                  {insight}
                </li>
              ))}
            </ul>
          </div>

          {/* Price Target Summary */}
          {analysis.priceTargetSummary && (
            <div>
              <p className="text-xs font-medium text-purple-700 mb-1">Price Target Evolution</p>
              <p className="text-sm text-purple-800">{analysis.priceTargetSummary}</p>
            </div>
          )}

          {/* Risk Evolution */}
          {analysis.riskEvolution && (
            <div>
              <p className="text-xs font-medium text-purple-700 mb-1">Risk Perception</p>
              <p className="text-sm text-purple-800">{analysis.riskEvolution}</p>
            </div>
          )}

          {/* Conviction Indicators */}
          {analysis.convictionIndicators.length > 0 && (
            <div>
              <p className="text-xs font-medium text-purple-700 mb-2">Conviction Signals</p>
              <div className="flex flex-wrap gap-2">
                {analysis.convictionIndicators.map((indicator, idx) => (
                  <span
                    key={idx}
                    className="px-2 py-0.5 bg-purple-100 text-purple-700 text-xs rounded-full"
                  >
                    {indicator}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Generated timestamp */}
          <p className="text-xs text-purple-400 pt-2 border-t border-purple-200">
            Generated {formatDistanceToNow(new Date(analysis.generatedAt), { addSuffix: true })}
          </p>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// VIEW MODE TOGGLE
// ============================================================================

interface ViewModeToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  const modes: { value: ViewMode; label: string; icon: React.ElementType }[] = [
    { value: 'latest', label: 'Latest Changes', icon: Zap },
    { value: 'timeline', label: 'Timeline', icon: Clock },
    { value: 'compare', label: 'Compare', icon: GitCompare },
  ]

  return (
    <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-0.5">
      {modes.map(m => {
        const Icon = m.icon
        return (
          <button
            key={m.value}
            onClick={() => onChange(m.value)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded transition-colors',
              mode === m.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon className="w-3 h-3" />
            {m.label}
          </button>
        )
      })}
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function ThesisHistoryView({ assetId, viewFilter, className }: ThesisHistoryViewProps) {
  const { user } = useAuth()
  const [viewMode, setViewMode] = useState<ViewMode>('latest')
  const [typeFilter, setTypeFilter] = useState<HistoryFilter>('all')
  const [significantOnly, setSignificantOnly] = useState(false)

  // Fetch structured revision data (Phase 2)
  const { revisions } = useAssetRevisions(assetId)
  const updateNoteMutation = useUpdateRevisionNote(assetId)

  // Fetch contribution history
  const { data: contributionHistory = [], isLoading: loadingContributions } = useQuery({
    queryKey: ['contribution-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_contribution_history')
        .select(`
          id,
          contribution_id,
          old_content,
          new_content,
          changed_by,
          changed_at,
          user:users!asset_contribution_history_changed_by_fkey(id, first_name, last_name),
          contribution:asset_contributions!inner(section, asset_id)
        `)
        .eq('contribution.asset_id', assetId)
        .order('changed_at', { ascending: false })
        .limit(100)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch current contributions for user names
  const { data: contributions = [] } = useQuery({
    queryKey: ['contributions-all', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_contributions')
        .select(`
          id,
          section,
          content,
          created_by,
          updated_at,
          user:users!asset_contributions_created_by_fkey(id, first_name, last_name, full_name)
        `)
        .eq('asset_id', assetId)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch price target history
  const { data: priceTargetHistory = [], isLoading: loadingTargets } = useQuery({
    queryKey: ['price-target-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('price_targets')
        .select(`
          id,
          target_price,
          created_by,
          created_at,
          updated_at,
          user:users!price_targets_created_by_fkey(id, first_name, last_name, full_name)
        `)
        .eq('asset_id', assetId)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch reference history
  const { data: referenceHistory = [] } = useQuery({
    queryKey: ['reference-history', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_field_history')
        .select(`
          id,
          field_name,
          old_value,
          new_value,
          changed_by,
          changed_at,
          user:users!asset_field_history_changed_by_fkey(id, first_name, last_name)
        `)
        .eq('asset_id', assetId)
        .eq('field_name', 'thesis_references')
        .order('changed_at', { ascending: false })
        .limit(50)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: 5 * 60 * 1000
  })

  // Fetch coverage data
  const { data: coverageData = [] } = useQuery({
    queryKey: ['coverage', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('user_id')
        .eq('asset_id', assetId)
        .eq('is_active', true)

      if (error) throw error
      return data || []
    },
    enabled: !!assetId,
    staleTime: Infinity
  })

  const coveringIds = new Set(coverageData.map(c => c.user_id).filter(Boolean))

  // Build user lookup
  const userLookup = useMemo(() => {
    const lookup: Record<string, { name: string; isCovering: boolean }> = {}
    contributions.forEach((c: any) => {
      if (c.user) {
        lookup[c.created_by] = {
          name: c.user.full_name || `${c.user.first_name} ${c.user.last_name}`,
          isCovering: coveringIds.has(c.created_by)
        }
      }
    })
    priceTargetHistory.forEach((pt: any) => {
      if (pt.user && !lookup[pt.created_by]) {
        lookup[pt.created_by] = {
          name: pt.user.full_name || `${pt.user.first_name} ${pt.user.last_name}`,
          isCovering: coveringIds.has(pt.created_by)
        }
      }
    })
    referenceHistory.forEach((rh: any) => {
      if (rh.user && rh.changed_by && !lookup[rh.changed_by]) {
        lookup[rh.changed_by] = {
          name: `${rh.user.first_name || ''} ${rh.user.last_name || ''}`.trim() || 'Unknown',
          isCovering: coveringIds.has(rh.changed_by)
        }
      }
    })
    // Add revision actors
    revisions.forEach(r => {
      if (r.actor && !lookup[r.actor_user_id]) {
        lookup[r.actor_user_id] = {
          name: `${r.actor.first_name || ''} ${r.actor.last_name || ''}`.trim() || 'Unknown',
          isCovering: coveringIds.has(r.actor_user_id)
        }
      }
    })
    return lookup
  }, [contributions, priceTargetHistory, referenceHistory, revisions, coveringIds])

  // Build timeline events
  const events = useMemo(() => {
    const allEvents: HistoryEvent[] = []

    // Add contribution history events
    contributionHistory.forEach((h: any) => {
      const userName = h.user
        ? `${h.user.first_name || ''} ${h.user.last_name || ''}`.trim() || 'Unknown'
        : (userLookup[h.changed_by]?.name || 'Unknown')

      allEvents.push({
        id: h.id,
        type: h.contribution?.section || 'thesis',
        timestamp: new Date(h.changed_at),
        userId: h.changed_by,
        userName,
        content: h.new_content,
        previousContent: h.old_content
      })
    })

    // Add current contributions as latest events (if not in history)
    contributions.forEach((c: any) => {
      const hasHistory = contributionHistory.some((h: any) => h.contribution_id === c.id)
      if (!hasHistory && c.content) {
        const userInfo = userLookup[c.created_by] || { name: 'Unknown', isCovering: false }
        allEvents.push({
          id: `current-${c.id}`,
          type: c.section,
          timestamp: new Date(c.updated_at),
          userId: c.created_by,
          userName: userInfo.name,
          content: c.content
        })
      }
    })

    // Add price target events
    priceTargetHistory.forEach((pt: any, idx: number) => {
      const userInfo = userLookup[pt.created_by] || { name: 'Unknown', isCovering: false }
      const previousTarget = priceTargetHistory[idx + 1]

      allEvents.push({
        id: `pt-${pt.id}`,
        type: 'price_target',
        timestamp: new Date(pt.updated_at || pt.created_at),
        userId: pt.created_by,
        userName: userInfo.name,
        priceTarget: pt.target_price,
        previousPriceTarget: previousTarget?.target_price
      })
    })

    // Add reference events
    referenceHistory.forEach((rh: any) => {
      const userInfo = userLookup[rh.changed_by] || { name: 'Unknown', isCovering: false }

      allEvents.push({
        id: `ref-${rh.id}`,
        type: 'reference',
        timestamp: new Date(rh.changed_at),
        userId: rh.changed_by,
        userName: userInfo.name,
        content: rh.new_value,
        previousContent: rh.old_value
      })
    })

    // Add price target changes from DB revision events (valuation_targets category)
    // These are created when price targets are published via the draft/publish pattern
    revisions.forEach(revision => {
      const actorName = revision.actor
        ? `${revision.actor.first_name || ''} ${revision.actor.last_name || ''}`.trim() || 'Unknown'
        : 'Unknown'

      revision.events
        .filter(e => e.category === 'valuation_targets')
        .forEach(revEvent => {
          // Dedup: skip if there's already a price_target event from same user within 5min
          const revTs = new Date(revEvent.created_at).getTime()
          const isDuplicate = allEvents.some(existing =>
            existing.type === 'price_target' &&
            existing.userId === revision.actor_user_id &&
            Math.abs(existing.timestamp.getTime() - revTs) < 5 * 60 * 1000
          )
          if (isDuplicate) return

          // Parse field_key: targets.{scenario}.{metric} (new) or targets.{metric} (legacy)
          const segments = revEvent.field_key.split('.')
          let scenarioLabel: string | undefined
          let metric: string

          if (segments.length >= 3 && segments[0] === 'targets') {
            // New format: targets.bull.price → scenario=Bull, metric=price
            scenarioLabel = segments[1].charAt(0).toUpperCase() + segments[1].slice(1).replace(/_/g, ' ')
            metric = segments[2]
          } else if (segments.length === 2 && segments[0] === 'targets') {
            // Legacy format: targets.price → no scenario, metric=price
            metric = segments[1]
          } else {
            // Unknown field_key format
            allEvents.push({
              id: `rev-${revEvent.id}`,
              type: 'price_target',
              timestamp: new Date(revEvent.created_at),
              userId: revision.actor_user_id,
              userName: actorName,
              content: 'Targets updated',
            })
            return
          }

          if (metric === 'price') {
            allEvents.push({
              id: `rev-${revEvent.id}`,
              type: 'price_target',
              timestamp: new Date(revEvent.created_at),
              userId: revision.actor_user_id,
              userName: actorName,
              priceTarget: revEvent.after_value ? parseFloat(revEvent.after_value) : undefined,
              previousPriceTarget: revEvent.before_value ? parseFloat(revEvent.before_value) : undefined,
              scenarioLabel,
            })
          } else if (metric === 'prob' || metric === 'probability') {
            const before = revEvent.before_value ? parseFloat(revEvent.before_value) : null
            const after = revEvent.after_value ? parseFloat(revEvent.after_value) : null
            const delta = before != null && after != null ? after - before : null
            const deltaStr = delta != null ? `(${delta > 0 ? '+' : ''}${Math.round(delta)}pp)` : ''
            const prefix = scenarioLabel ? `${scenarioLabel} prob` : 'Prob'
            allEvents.push({
              id: `rev-${revEvent.id}`,
              type: 'price_target',
              timestamp: new Date(revEvent.created_at),
              userId: revision.actor_user_id,
              userName: actorName,
              content: `${prefix}: ${revEvent.before_value || '?'}% → ${revEvent.after_value || '?'}% ${deltaStr}`.trim(),
            })
          } else if (metric === 'expiry') {
            const prefix = scenarioLabel ? `${scenarioLabel} expiry` : 'Expiry'
            allEvents.push({
              id: `rev-${revEvent.id}`,
              type: 'price_target',
              timestamp: new Date(revEvent.created_at),
              userId: revision.actor_user_id,
              userName: actorName,
              content: `${prefix}: ${revEvent.before_value || 'none'} → ${revEvent.after_value || 'none'}`,
            })
          } else {
            allEvents.push({
              id: `rev-${revEvent.id}`,
              type: 'price_target',
              timestamp: new Date(revEvent.created_at),
              userId: revision.actor_user_id,
              userName: actorName,
              content: 'Targets updated',
            })
          }
        })

      // Rating events (category === 'rating')
      revision.events
        .filter(e => e.category === 'rating')
        .forEach(revEvent => {
          const revTs = new Date(revEvent.created_at).getTime()
          const isDuplicate = allEvents.some(existing =>
            existing.type === 'rating' &&
            existing.userId === revision.actor_user_id &&
            Math.abs(existing.timestamp.getTime() - revTs) < 5 * 60 * 1000
          )
          if (isDuplicate) return

          // Parse field_key: rating.{methodology}.value or rating.methodology
          const rSegments = revEvent.field_key.split('.')
          let ratingContent: string

          if (rSegments.length >= 3 && rSegments[0] === 'rating' && rSegments[2] === 'value') {
            const methodology = rSegments[1].replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
            ratingContent = `Rating (${methodology}): ${revEvent.before_value || '?'} → ${revEvent.after_value || '?'}`
          } else if (rSegments.length === 2 && rSegments[0] === 'rating' && rSegments[1] === 'methodology') {
            ratingContent = `Rating methodology: ${revEvent.before_value || '?'} → ${revEvent.after_value || '?'}`
          } else {
            ratingContent = `Rating: ${revEvent.before_value || '?'} → ${revEvent.after_value || '?'}`
          }

          allEvents.push({
            id: `rev-${revEvent.id}`,
            type: 'rating',
            timestamp: new Date(revEvent.created_at),
            userId: revision.actor_user_id,
            userName: actorName,
            content: ratingContent,
          })
        })
    })

    // Filter by viewFilter (user)
    let filtered = allEvents
    if (viewFilter !== 'aggregated') {
      filtered = allEvents.filter(e => e.userId === viewFilter)
    }

    // Sort by timestamp descending
    return filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
  }, [contributionHistory, contributions, priceTargetHistory, referenceHistory, revisions, userLookup, viewFilter])

  // Compute evolution stats
  const evolutionStats = useMemo((): EvolutionStats => {
    if (events.length === 0) {
      return {
        totalRevisions: 0,
        firstEditDate: null,
        lastEditDate: null,
        thesisChanges: 0,
        riskUpdates: 0,
        priceTargetRevisions: 0,
        whereDifferentChanges: 0,
        referenceChanges: 0,
        sentimentTrajectory: 'unknown'
      }
    }

    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
    const firstEvent = sortedEvents[0]
    const lastEvent = sortedEvents[sortedEvents.length - 1]

    // Detect sentiment from price target changes
    const priceEvents = events.filter(e => e.type === 'price_target' && e.priceTarget)
    let trajectory: EvolutionStats['sentimentTrajectory'] = 'stable'

    if (priceEvents.length >= 2) {
      const firstPrice = priceEvents[priceEvents.length - 1].priceTarget
      const lastPrice = priceEvents[0].priceTarget
      if (firstPrice && lastPrice) {
        const change = (lastPrice - firstPrice) / firstPrice
        if (change > 0.1) trajectory = 'more_bullish'
        else if (change < -0.1) trajectory = 'more_bearish'
      }
    }

    return {
      totalRevisions: events.length,
      firstEditDate: firstEvent.timestamp,
      lastEditDate: lastEvent.timestamp,
      thesisChanges: events.filter(e => e.type === 'thesis').length,
      riskUpdates: events.filter(e => e.type === 'risks_to_thesis').length,
      priceTargetRevisions: events.filter(e => e.type === 'price_target').length,
      whereDifferentChanges: events.filter(e => e.type === 'where_different').length,
      referenceChanges: events.filter(e => e.type === 'reference').length,
      sentimentTrajectory: trajectory
    }
  }, [events])

  // Use evolution analysis hook
  const userId = viewFilter !== 'aggregated' ? viewFilter : undefined
  const {
    analysis: evolutionAnalysis,
    isGenerating: isGeneratingAnalysis,
    isStale: isAnalysisStale,
    generateAnalysis
  } = useHistoryEvolutionAnalysis({
    assetId,
    userId,
    historyEvents: events
  })

  // Apply type filter
  const filteredEvents = useMemo(() => {
    if (typeFilter === 'all') return events
    return events.filter(e => e.type === typeFilter)
  }, [events, typeFilter])

  // Group events into revision sessions for Latest Changes view
  const sessions = useMemo(() => groupIntoSessions(filteredEvents), [filteredEvents])

  // Find last editor info for the change intelligence header
  const lastEditor = events.length > 0 ? events[0] : null

  const isLoading = loadingContributions || loadingTargets

  if (isLoading) {
    return (
      <div className={clsx('space-y-4', className)}>
        <div className="h-8 bg-gray-100 rounded animate-pulse" />
        <div className="h-32 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
        <div className="h-24 bg-gray-100 rounded animate-pulse" />
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <div className={clsx('text-center py-8', className)}>
        <Clock className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No history yet</p>
        <p className="text-xs text-gray-400 mt-1">Changes will be tracked as you edit</p>
      </div>
    )
  }

  return (
    <div className={clsx('space-y-4', className)}>
      {/* Change Intelligence Header */}
      <EvolutionOverview
        stats={evolutionStats}
        lastEditor={lastEditor ? { name: lastEditor.userName, date: lastEditor.timestamp } : undefined}
        isAnalyzing={isGeneratingAnalysis}
        hasAnalysis={!!evolutionAnalysis}
        isAnalysisStale={isAnalysisStale}
        onAnalyzeEvolution={() => generateAnalysis()}
      />

      {/* AI Insights Panel */}
      <AIInsightsPanel analysis={evolutionAnalysis} />

      {/* View Mode Toggle & Filters */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <ViewModeToggle mode={viewMode} onChange={setViewMode} />

          {/* Significant only toggle */}
          <button
            onClick={() => setSignificantOnly(!significantOnly)}
            className={clsx(
              'flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg transition-colors',
              significantOnly
                ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                : 'bg-gray-100 text-gray-500 hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400'
            )}
            title="Show only material changes (thesis, targets, risks)"
          >
            <Filter className="w-3 h-3" />
            Significant only
          </button>
        </div>

        {/* Type filter (only show for timeline view) */}
        {viewMode === 'timeline' && (
          <div className="flex items-center gap-1 flex-wrap">
            {filterConfig.map(f => (
              <button
                key={f.value}
                onClick={() => setTypeFilter(f.value)}
                className={clsx(
                  'px-2 py-0.5 text-xs rounded-full transition-colors',
                  typeFilter === f.value
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* View Content */}
      {viewMode === 'latest' && (() => {
        // When significant-only, skip sessions with no Tier 1 events
        const visibleSessions = significantOnly
          ? sessions.filter(s => s.events.some(e => e.type === 'price_target' || e.type === 'risks_to_thesis' || e.type === 'rating'))
          : sessions
        return (
        <div className="space-y-2">
          {visibleSessions.length > 0 ? (
            visibleSessions.map((session, idx) => {
              // Match session to DB revision row by user + time overlap
              const matchedRevision = revisions.find(r =>
                r.actor_user_id === session.userId &&
                Math.abs(new Date(r.last_activity_at).getTime() - session.lastActivityAt.getTime()) < 35 * 60 * 1000
              )
              return (
                <RevisionSessionCard
                  key={session.id}
                  session={session}
                  defaultExpanded={idx === 0}
                  significantOnly={significantOnly}
                  revisionRow={matchedRevision}
                  currentUserId={user?.id}
                  viewFilter={viewFilter}
                  onSaveNote={(revId, note) => updateNoteMutation.mutate({ revisionId: revId, note })}
                  isSavingNote={updateNoteMutation.isPending}
                />
              )
            })
          ) : (
            <p className="text-sm text-gray-400 text-center py-4">
              {significantOnly ? 'No significant changes' : `No ${typeFilter !== 'all' ? typeFilter.replace('_', ' ') + ' ' : ''}changes`}
            </p>
          )}

          {visibleSessions.length > 0 && (
            <button
              onClick={() => setViewMode('timeline')}
              className="w-full text-center text-xs text-gray-400 hover:text-gray-600 py-2 transition-colors"
            >
              View all in Timeline →
            </button>
          )}
        </div>
        )
      })()}

      {viewMode === 'timeline' && (
        <EvolutionTimeline
          events={filteredEvents}
          milestones={evolutionAnalysis?.keyMilestones}
        />
      )}

      {viewMode === 'compare' && (
        <RevisionCompare
          revisions={revisions}
          viewFilter={viewFilter}
          significantOnly={significantOnly}
        />
      )}
    </div>
  )
}
