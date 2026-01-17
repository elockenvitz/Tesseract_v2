import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  GitCompare,
  ChevronDown,
  ArrowRight,
  Plus,
  Minus,
  Edit3,
  Target,
  AlertTriangle,
  DollarSign,
  FileText,
  Sparkles,
  Loader2
} from 'lucide-react'
import { format } from 'date-fns'
import type { HistoryEvent } from '../../hooks/useContributions'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

interface VersionSnapshot {
  timestamp: Date
  content: Record<string, string | null>
  priceTarget: number | null
}

interface ComparisonResult {
  section: string
  oldContent: string | null
  newContent: string | null
  changeType: 'added' | 'removed' | 'modified' | 'unchanged'
}

interface DiffPart {
  type: 'unchanged' | 'added' | 'removed'
  text: string
}

interface VersionComparisonProps {
  events: HistoryEvent[]
  onGenerateComparison?: (oldDate: Date, newDate: Date) => Promise<string>
  isGeneratingComparison?: boolean
  className?: string
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const sectionConfig = {
  thesis: { icon: Target, label: 'Investment Thesis', color: 'text-primary-600' },
  where_different: { icon: Sparkles, label: 'Where Different', color: 'text-purple-600' },
  risks_to_thesis: { icon: AlertTriangle, label: 'Risks to Thesis', color: 'text-amber-600' },
  price_target: { icon: DollarSign, label: 'Price Target', color: 'text-green-600' },
  reference: { icon: FileText, label: 'Supporting Docs', color: 'text-blue-600' }
}

// ============================================================================
// DIFF ALGORITHM
// ============================================================================

function computeWordDiff(oldText: string | null, newText: string | null): DiffPart[] {
  if (!oldText && !newText) return []
  if (!oldText) return [{ type: 'added', text: newText! }]
  if (!newText) return [{ type: 'removed', text: oldText }]

  const oldWords = oldText.split(/\s+/).filter(w => w.length > 0)
  const newWords = newText.split(/\s+/).filter(w => w.length > 0)

  const m = oldWords.length
  const n = newWords.length

  // LCS table
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldWords[i - 1].toLowerCase() === newWords[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack
  const parts: DiffPart[] = []
  let i = m, j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldWords[i - 1].toLowerCase() === newWords[j - 1].toLowerCase()) {
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

  // Merge consecutive parts
  const merged: DiffPart[] = []
  for (const part of parts) {
    const last = merged[merged.length - 1]
    if (last && last.type === part.type) {
      last.text += ' ' + part.text
    } else {
      merged.push({ ...part })
    }
  }

  return merged
}

// ============================================================================
// DIFF VIEW COMPONENT
// ============================================================================

function DiffDisplay({ oldContent, newContent }: { oldContent: string | null; newContent: string | null }) {
  const diff = computeWordDiff(oldContent, newContent)

  if (diff.length === 0) {
    return <span className="text-gray-400 italic text-sm">No content</span>
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
// CHANGE SUMMARY COMPONENT
// ============================================================================

interface ChangeSummaryProps {
  comparisons: ComparisonResult[]
}

function ChangeSummary({ comparisons }: ChangeSummaryProps) {
  const stats = useMemo(() => {
    let added = 0
    let removed = 0
    let modified = 0
    let wordsAdded = 0
    let wordsRemoved = 0

    comparisons.forEach(c => {
      if (c.changeType === 'added') added++
      else if (c.changeType === 'removed') removed++
      else if (c.changeType === 'modified') modified++

      // Count words
      const oldWords = c.oldContent?.split(/\s+/).filter(w => w.length > 0).length || 0
      const newWords = c.newContent?.split(/\s+/).filter(w => w.length > 0).length || 0

      if (newWords > oldWords) wordsAdded += (newWords - oldWords)
      else wordsRemoved += (oldWords - newWords)
    })

    return { added, removed, modified, wordsAdded, wordsRemoved }
  }, [comparisons])

  return (
    <div className="flex items-center gap-4 text-xs">
      {stats.added > 0 && (
        <span className="flex items-center gap-1 text-green-600">
          <Plus className="w-3 h-3" />
          {stats.added} section{stats.added !== 1 ? 's' : ''} added
        </span>
      )}
      {stats.removed > 0 && (
        <span className="flex items-center gap-1 text-red-600">
          <Minus className="w-3 h-3" />
          {stats.removed} section{stats.removed !== 1 ? 's' : ''} removed
        </span>
      )}
      {stats.modified > 0 && (
        <span className="flex items-center gap-1 text-amber-600">
          <Edit3 className="w-3 h-3" />
          {stats.modified} section{stats.modified !== 1 ? 's' : ''} modified
        </span>
      )}
      <span className="text-gray-400">|</span>
      <span className="text-gray-500">
        {stats.wordsAdded > 0 && <span className="text-green-600">+{stats.wordsAdded}</span>}
        {stats.wordsAdded > 0 && stats.wordsRemoved > 0 && ' / '}
        {stats.wordsRemoved > 0 && <span className="text-red-600">-{stats.wordsRemoved}</span>}
        {(stats.wordsAdded > 0 || stats.wordsRemoved > 0) && ' words'}
      </span>
    </div>
  )
}

// ============================================================================
// SECTION COMPARISON CARD
// ============================================================================

interface SectionCardProps {
  comparison: ComparisonResult
  viewMode: 'side-by-side' | 'inline'
}

function SectionCard({ comparison, viewMode }: SectionCardProps) {
  const config = sectionConfig[comparison.section as keyof typeof sectionConfig] || {
    icon: FileText,
    label: comparison.section,
    color: 'text-gray-600'
  }
  const Icon = config.icon

  const changeStyles = {
    added: 'border-l-4 border-l-green-500',
    removed: 'border-l-4 border-l-red-500',
    modified: 'border-l-4 border-l-amber-500',
    unchanged: 'border-l-4 border-l-gray-200'
  }

  if (comparison.changeType === 'unchanged') {
    return null
  }

  return (
    <div className={clsx(
      'bg-white rounded-lg border border-gray-200 overflow-hidden',
      changeStyles[comparison.changeType]
    )}>
      {/* Header */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-100 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className={clsx('w-4 h-4', config.color)} />
          <span className="text-sm font-medium text-gray-900">{config.label}</span>
        </div>
        <span className={clsx(
          'text-xs px-2 py-0.5 rounded',
          comparison.changeType === 'added' && 'bg-green-100 text-green-700',
          comparison.changeType === 'removed' && 'bg-red-100 text-red-700',
          comparison.changeType === 'modified' && 'bg-amber-100 text-amber-700'
        )}>
          {comparison.changeType}
        </span>
      </div>

      {/* Content */}
      <div className="p-4">
        {viewMode === 'side-by-side' ? (
          <div className="grid grid-cols-2 gap-4">
            {/* Old version */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Previous</p>
              <div className={clsx(
                'p-3 rounded bg-gray-50 min-h-[60px]',
                !comparison.oldContent && 'flex items-center justify-center'
              )}>
                {comparison.oldContent ? (
                  <p className="text-sm text-gray-600">{comparison.oldContent}</p>
                ) : (
                  <span className="text-xs text-gray-400 italic">No content</span>
                )}
              </div>
            </div>

            {/* New version */}
            <div>
              <p className="text-xs font-medium text-gray-500 mb-2">Current</p>
              <div className={clsx(
                'p-3 rounded bg-gray-50 min-h-[60px]',
                !comparison.newContent && 'flex items-center justify-center'
              )}>
                {comparison.newContent ? (
                  <p className="text-sm text-gray-700">{comparison.newContent}</p>
                ) : (
                  <span className="text-xs text-gray-400 italic">No content</span>
                )}
              </div>
            </div>
          </div>
        ) : (
          <DiffDisplay oldContent={comparison.oldContent} newContent={comparison.newContent} />
        )}
      </div>
    </div>
  )
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function VersionComparison({
  events,
  onGenerateComparison,
  isGeneratingComparison = false,
  className
}: VersionComparisonProps) {
  const [viewMode, setViewMode] = useState<'side-by-side' | 'inline'>('inline')
  const [selectedOldDate, setSelectedOldDate] = useState<string>('')
  const [selectedNewDate, setSelectedNewDate] = useState<string>('')
  const [aiSummary, setAiSummary] = useState<string | null>(null)

  // Get unique dates from events
  const availableDates = useMemo(() => {
    const dateMap = new Map<string, Date>()
    events.forEach(e => {
      const key = format(e.timestamp, 'yyyy-MM-dd')
      if (!dateMap.has(key)) {
        dateMap.set(key, e.timestamp)
      }
    })
    return Array.from(dateMap.entries())
      .sort((a, b) => b[1].getTime() - a[1].getTime())
      .map(([key, date]) => ({
        key,
        label: format(date, 'MMM d, yyyy'),
        date
      }))
  }, [events])

  // Build version snapshots
  const snapshots = useMemo(() => {
    const snapshotMap = new Map<string, VersionSnapshot>()

    // Sort events by date ascending
    const sortedEvents = [...events].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())

    // Build cumulative state at each date
    const currentState: Record<string, string | null> = {}
    let currentPriceTarget: number | null = null

    sortedEvents.forEach(e => {
      const dateKey = format(e.timestamp, 'yyyy-MM-dd')

      if (e.type === 'price_target') {
        currentPriceTarget = e.priceTarget || null
      } else if (e.content !== undefined) {
        currentState[e.type] = e.content
      }

      snapshotMap.set(dateKey, {
        timestamp: e.timestamp,
        content: { ...currentState },
        priceTarget: currentPriceTarget
      })
    })

    return snapshotMap
  }, [events])

  // Compute comparison
  const comparisons = useMemo((): ComparisonResult[] => {
    if (!selectedOldDate || !selectedNewDate) return []

    const oldSnapshot = snapshots.get(selectedOldDate)
    const newSnapshot = snapshots.get(selectedNewDate)

    if (!oldSnapshot || !newSnapshot) return []

    const results: ComparisonResult[] = []
    const allSections = new Set([
      ...Object.keys(oldSnapshot.content),
      ...Object.keys(newSnapshot.content)
    ])

    allSections.forEach(section => {
      const oldContent = oldSnapshot.content[section] || null
      const newContent = newSnapshot.content[section] || null

      let changeType: ComparisonResult['changeType']
      if (!oldContent && newContent) changeType = 'added'
      else if (oldContent && !newContent) changeType = 'removed'
      else if (oldContent !== newContent) changeType = 'modified'
      else changeType = 'unchanged'

      results.push({ section, oldContent, newContent, changeType })
    })

    // Add price target comparison
    if (oldSnapshot.priceTarget !== newSnapshot.priceTarget) {
      results.push({
        section: 'price_target',
        oldContent: oldSnapshot.priceTarget ? `$${oldSnapshot.priceTarget}` : null,
        newContent: newSnapshot.priceTarget ? `$${newSnapshot.priceTarget}` : null,
        changeType: !oldSnapshot.priceTarget ? 'added' :
          !newSnapshot.priceTarget ? 'removed' : 'modified'
      })
    }

    return results.filter(r => r.changeType !== 'unchanged')
  }, [selectedOldDate, selectedNewDate, snapshots])

  // Handle AI comparison
  const handleGenerateComparison = async () => {
    if (!onGenerateComparison || !selectedOldDate || !selectedNewDate) return

    const oldDate = snapshots.get(selectedOldDate)?.timestamp
    const newDate = snapshots.get(selectedNewDate)?.timestamp

    if (!oldDate || !newDate) return

    try {
      const summary = await onGenerateComparison(oldDate, newDate)
      setAiSummary(summary)
    } catch (error) {
      console.error('Failed to generate comparison:', error)
    }
  }

  if (events.length === 0) {
    return (
      <div className={clsx(
        'bg-white border border-gray-200 rounded-lg p-6 text-center',
        className
      )}>
        <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">No versions to compare</p>
        <p className="text-xs text-gray-400 mt-1">Make some changes to start tracking versions</p>
      </div>
    )
  }

  if (availableDates.length < 2) {
    return (
      <div className={clsx(
        'bg-white border border-gray-200 rounded-lg p-6 text-center',
        className
      )}>
        <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
        <p className="text-sm text-gray-500">Need at least 2 versions to compare</p>
        <p className="text-xs text-gray-400 mt-1">Currently only 1 version available</p>
      </div>
    )
  }

  return (
    <div className={clsx('bg-white border border-gray-200 rounded-lg overflow-hidden', className)}>
      {/* Header */}
      <div className="px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 mb-3">
          <GitCompare className="w-4 h-4 text-gray-500" />
          <h3 className="text-sm font-semibold text-gray-900">Version Comparison</h3>
        </div>

        {/* Version selectors */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Old version */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">From:</span>
            <div className="relative">
              <select
                value={selectedOldDate}
                onChange={(e) => {
                  setSelectedOldDate(e.target.value)
                  setAiSummary(null)
                }}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 cursor-pointer min-w-[140px]"
              >
                <option value="">Select date...</option>
                {availableDates.map(d => (
                  <option key={d.key} value={d.key} disabled={d.key === selectedNewDate}>
                    {d.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          <ArrowRight className="w-4 h-4 text-gray-400" />

          {/* New version */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">To:</span>
            <div className="relative">
              <select
                value={selectedNewDate}
                onChange={(e) => {
                  setSelectedNewDate(e.target.value)
                  setAiSummary(null)
                }}
                className="appearance-none pl-3 pr-8 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 cursor-pointer min-w-[140px]"
              >
                <option value="">Select date...</option>
                {availableDates.map(d => (
                  <option key={d.key} value={d.key} disabled={d.key === selectedOldDate}>
                    {d.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            </div>
          </div>

          {/* View mode toggle */}
          <div className="flex items-center gap-1 ml-auto bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setViewMode('inline')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors',
                viewMode === 'inline'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Inline
            </button>
            <button
              onClick={() => setViewMode('side-by-side')}
              className={clsx(
                'px-2 py-1 text-xs rounded transition-colors',
                viewMode === 'side-by-side'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              )}
            >
              Side-by-Side
            </button>
          </div>
        </div>
      </div>

      {/* Comparison content */}
      <div className="p-4">
        {selectedOldDate && selectedNewDate ? (
          comparisons.length > 0 ? (
            <div className="space-y-4">
              {/* Change summary */}
              <div className="pb-3 border-b border-gray-100">
                <ChangeSummary comparisons={comparisons} />
              </div>

              {/* AI Summary */}
              {onGenerateComparison && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-600" />
                      <span className="text-sm font-medium text-purple-900">AI Comparison Summary</span>
                    </div>
                    {!aiSummary && (
                      <button
                        onClick={handleGenerateComparison}
                        disabled={isGeneratingComparison}
                        className={clsx(
                          'flex items-center gap-1.5 px-3 py-1 text-xs font-medium rounded-lg transition-colors',
                          isGeneratingComparison
                            ? 'bg-purple-100 text-purple-400 cursor-not-allowed'
                            : 'bg-purple-600 text-white hover:bg-purple-700'
                        )}
                      >
                        {isGeneratingComparison ? (
                          <>
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Analyzing...
                          </>
                        ) : (
                          <>
                            <Sparkles className="w-3 h-3" />
                            Generate
                          </>
                        )}
                      </button>
                    )}
                  </div>
                  {aiSummary ? (
                    <p className="text-sm text-purple-800">{aiSummary}</p>
                  ) : (
                    <p className="text-xs text-purple-600">
                      Click "Generate" to get an AI-powered summary of what changed between these versions.
                    </p>
                  )}
                </div>
              )}

              {/* Section comparisons */}
              {comparisons.map((comparison, idx) => (
                <SectionCard key={idx} comparison={comparison} viewMode={viewMode} />
              ))}
            </div>
          ) : (
            <div className="text-center py-8">
              <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No changes between these versions</p>
            </div>
          )
        ) : (
          <div className="text-center py-8">
            <GitCompare className="w-8 h-8 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Select two versions to compare</p>
            <p className="text-xs text-gray-400 mt-1">
              Choose a "From" and "To" date above
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

export default VersionComparison
