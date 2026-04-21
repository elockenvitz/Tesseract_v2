import React, { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  Play,
  CheckCircle2,
  RotateCcw,
  Plus,
  Trash2,
  ChevronRight,
  ListChecks,
  Repeat,
  X,
  Search,
  Settings2,
} from 'lucide-react'
import { Button } from '../../ui/Button'
import {
  useThemeWorkflows,
  type ThemeWorkflow,
  type ThemeWorkflowStage,
} from '../../../hooks/useThemeWorkflows'

interface ThemeProcessesPanelProps {
  themeId: string
}

export function ThemeProcessesPanel({ themeId }: ThemeProcessesPanelProps) {
  const {
    joined,
    unjoined,
    isLoading,
    joinWorkflow,
    startWorkflow,
    setStage,
    completeWorkflow,
    restartWorkflow,
    removeWorkflow,
  } = useThemeWorkflows(themeId)

  const [showPicker, setShowPicker] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(2)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-lg animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Process</h2>
          <p className="text-xs text-gray-500">Recurring workflows applied to this theme.</p>
        </div>
        <Button size="sm" onClick={() => setShowPicker(true)} disabled={unjoined.length === 0}>
          <Plus className="w-4 h-4 mr-1" />
          Add process
        </Button>
      </div>

      {joined.length === 0 ? (
        <div className="bg-gray-50 border border-dashed border-gray-300 rounded-lg p-8 text-center">
          <ListChecks className="w-8 h-8 text-gray-300 mx-auto mb-2" />
          <p className="text-sm text-gray-700 font-medium">No processes yet</p>
          <p className="text-xs text-gray-500 mt-1 mb-4">
            Attach a recurring process to run repeatedly against this theme (e.g., monthly refresh, catalyst review).
          </p>
          {unjoined.length > 0 ? (
            <Button size="sm" onClick={() => setShowPicker(true)}>
              <Plus className="w-4 h-4 mr-1" />
              Add a process
            </Button>
          ) : (
            <p className="text-xs text-gray-500 italic">
              No theme-scoped processes yet. Create one in <span className="font-medium">Processes</span> (top nav) with scope "Theme".
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {joined.map(w => (
            <ThemeProcessCard
              key={w.id}
              workflow={w}
              onStart={() => startWorkflow(w.id)}
              onComplete={() => completeWorkflow(w.id)}
              onRestart={() => restartWorkflow(w.id)}
              onRemove={() => removeWorkflow(w.id)}
              onSelectStage={(stageKey) => setStage({ workflowId: w.id, stageKey })}
            />
          ))}
        </div>
      )}

      {showPicker && (
        <ProcessPickerModal
          candidates={unjoined}
          onClose={() => setShowPicker(false)}
          onPick={async (wfId) => {
            await joinWorkflow({ workflowId: wfId, startImmediately: true })
            setShowPicker(false)
          }}
        />
      )}
    </div>
  )
}

// =========================================================================
// Single-workflow card with stage tiles
// =========================================================================

function ThemeProcessCard({
  workflow, onStart, onComplete, onRestart, onRemove, onSelectStage,
}: {
  workflow: ThemeWorkflow
  onStart: () => Promise<void> | void
  onComplete: () => Promise<void> | void
  onRestart: () => Promise<void> | void
  onRemove: () => Promise<void> | void
  onSelectStage: (stageKey: string) => Promise<void> | void
}) {
  const stages = workflow.stages || []
  const progress = workflow.progress ?? null
  const activeIdx = useMemo(() => {
    if (!progress?.current_stage_key) return -1
    return stages.findIndex(s => s.stage_key === progress.current_stage_key)
  }, [stages, progress?.current_stage_key])

  const isStarted = !!progress?.is_started
  const isCompleted = !!progress?.is_completed

  return (
    <div
      className={clsx(
        'bg-white border border-gray-200 rounded-lg border-l-4 overflow-hidden transition-all',
        'hover:shadow-sm'
      )}
      style={{ borderLeftColor: workflow.color || '#3b82f6' }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-100 gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{workflow.name}</h3>
            {workflow.cadence_timeframe && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-violet-50 text-violet-700">
                <Repeat className="w-2.5 h-2.5" /> {workflow.cadence_timeframe}
              </span>
            )}
            {isCompleted ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-50 text-emerald-700">
                <CheckCircle2 className="w-2.5 h-2.5" /> Completed
              </span>
            ) : isStarted ? (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-sky-50 text-sky-700">
                In progress
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-600">
                Not started
              </span>
            )}
          </div>
          {workflow.description && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{workflow.description}</p>
          )}
          {progress?.started_at && !isCompleted && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Started {formatDistanceToNow(new Date(progress.started_at), { addSuffix: true })}
            </p>
          )}
          {progress?.completed_at && isCompleted && (
            <p className="text-[11px] text-gray-400 mt-0.5">
              Completed {formatDistanceToNow(new Date(progress.completed_at), { addSuffix: true })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {!isStarted && !isCompleted && (
            <Button size="sm" onClick={() => onStart()}>
              <Play className="w-3.5 h-3.5 mr-1" />
              Start
            </Button>
          )}
          {isStarted && !isCompleted && (
            <Button size="sm" onClick={() => onComplete()}>
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              Complete
            </Button>
          )}
          {isCompleted && (
            <Button size="sm" variant="outline" onClick={() => onRestart()}>
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              Restart
            </Button>
          )}
          <button
            onClick={() => onRemove()}
            className="p-1.5 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded"
            title="Remove from this theme"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Stage tiles */}
      {stages.length > 0 && (
        <div className="px-4 py-3">
          <div className="flex items-center gap-1 overflow-x-auto">
            {stages.map((s, i) => (
              <React.Fragment key={s.stage_key}>
                <StageTile
                  stage={s}
                  isCompleted={isCompleted || i < activeIdx}
                  isActive={i === activeIdx && !isCompleted}
                  isUpcoming={i > activeIdx && !isCompleted}
                  onClick={() => onSelectStage(s.stage_key)}
                />
                {i < stages.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StageTile({
  stage, isCompleted, isActive, isUpcoming, onClick,
}: {
  stage: ThemeWorkflowStage
  isCompleted: boolean
  isActive: boolean
  isUpcoming: boolean
  onClick: () => void
}) {
  const label = stage.stage_label || stage.stage_key
  return (
    <button
      onClick={onClick}
      className={clsx(
        'group shrink-0 min-w-[8rem] max-w-[12rem] border rounded-lg px-3 py-2 text-left transition-all',
        isActive && 'bg-primary-50 border-primary-300 ring-1 ring-primary-200',
        isCompleted && 'bg-emerald-50 border-emerald-200',
        isUpcoming && 'bg-white border-gray-200 hover:border-gray-300',
      )}
      style={isActive && stage.stage_color ? { borderColor: stage.stage_color } : undefined}
    >
      <div className="flex items-center gap-2">
        {isCompleted ? (
          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
        ) : (
          <div
            className={clsx(
              'w-3.5 h-3.5 rounded-full border-2 shrink-0',
              isActive ? 'border-primary-500 bg-white' : 'border-gray-300'
            )}
            style={isActive && stage.stage_color ? { borderColor: stage.stage_color } : undefined}
          />
        )}
        <span className={clsx(
          'text-xs font-medium truncate',
          isActive ? 'text-primary-700' : isCompleted ? 'text-emerald-700' : 'text-gray-700'
        )}>
          {label}
        </span>
      </div>
      {Array.isArray(stage.checklist_items) && stage.checklist_items.length > 0 && (
        <p className="text-[10px] text-gray-400 mt-1">
          {stage.checklist_items.length} {stage.checklist_items.length === 1 ? 'item' : 'items'}
        </p>
      )}
    </button>
  )
}

// =========================================================================
// Picker
// =========================================================================

function ProcessPickerModal({
  candidates, onClose, onPick,
}: {
  candidates: ThemeWorkflow[]
  onClose: () => void
  onPick: (workflowId: string) => Promise<void> | void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter(w =>
      w.name.toLowerCase().includes(q)
      || (w.description || '').toLowerCase().includes(q)
    )
  }, [candidates, query])

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-xl w-full">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Add process to theme</h2>
              <p className="text-xs text-gray-500">Pick a theme-scoped process to start running on this theme.</p>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="p-4">
            <div className="relative mb-3">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search processes..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-primary-300"
                autoFocus
              />
            </div>

            {filtered.length === 0 ? (
              <div className="text-center py-8 text-sm text-gray-500">
                {candidates.length === 0 ? (
                  <>
                    No theme-scoped processes available.{' '}
                    <span className="inline-flex items-center gap-1 text-gray-400">
                      <Settings2 className="w-3.5 h-3.5" />
                      Create one from the Processes page.
                    </span>
                  </>
                ) : 'No matches.'}
              </div>
            ) : (
              <ul className="divide-y divide-gray-100 max-h-80 overflow-y-auto">
                {filtered.map(w => (
                  <li key={w.id} className="flex items-center gap-3 py-2">
                    <div
                      className="w-2 h-8 rounded-full shrink-0"
                      style={{ backgroundColor: w.color || '#3b82f6' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{w.name}</p>
                      {w.description && (
                        <p className="text-xs text-gray-500 truncate">{w.description}</p>
                      )}
                    </div>
                    <Button size="sm" onClick={() => onPick(w.id)}>
                      <Plus className="w-3.5 h-3.5 mr-1" />
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
