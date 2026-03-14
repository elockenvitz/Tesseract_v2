/**
 * ThesesDebatePanel — Bull vs Bear side-by-side debate view.
 *
 * Renders inside the trade idea detail modal's "Debate" tab.
 * Shows bullish theses on the left, bearish on the right.
 */

import { useState, useEffect, useRef } from 'react'
import { TrendingUp, TrendingDown, Plus, Pencil, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useTheses, useCreateThesis, useDeleteThesis, useUpdateThesis } from '../../hooks/useTheses'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import type { ThesisWithUser, ThesisConviction, ThesisDirection } from '../../types/trading'

interface ThesesDebatePanelProps {
  tradeIdeaId: string
  onAddThesis: (direction?: 'bull' | 'bear') => void
  readOnly?: boolean
  /** Trade idea's original rationale — auto-seeds as the creator's thesis */
  ideaRationale?: string | null
  /** Trade idea action (buy/sell) — determines which side the rationale seeds */
  ideaAction?: string | null
  /** Trade idea creator ID */
  ideaCreatedBy?: string | null
}

const CONVICTION_BADGE: Record<string, { label: string; color: string }> = {
  low: { label: 'Low', color: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400' },
  medium: { label: 'Med', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400' },
  high: { label: 'High', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400' },
}

function formatName(user: ThesisWithUser['users']): string {
  if (!user) return 'Unknown'
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ')
  return name || user.email?.split('@')[0] || 'Unknown'
}

function ThesisCard({
  thesis,
  isAuthor,
  onEdit,
  onDelete,
  readOnly,
}: {
  thesis: ThesisWithUser
  isAuthor: boolean
  onEdit: () => void
  onDelete: () => void
  readOnly?: boolean
}) {
  const conviction = thesis.conviction ? CONVICTION_BADGE[thesis.conviction] : null
  const isBull = thesis.direction === 'bull'

  return (
    <div className={clsx(
      'rounded-lg border p-3 transition-colors',
      isBull
        ? 'border-emerald-200/60 dark:border-emerald-800/40 bg-emerald-50/50 dark:bg-emerald-900/10'
        : 'border-red-200/60 dark:border-red-800/40 bg-red-50/50 dark:bg-red-900/10'
    )}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-xs font-semibold text-gray-700 dark:text-gray-300 truncate">
            {formatName(thesis.users)}
          </span>
          {conviction && (
            <span className={clsx('text-[10px] font-medium px-1.5 py-0.5 rounded', conviction.color)}>
              {conviction.label}
            </span>
          )}
        </div>
        {isAuthor && !readOnly && (
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={onEdit}
              className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded"
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              onClick={onDelete}
              className="p-1 text-gray-400 hover:text-red-500 rounded"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        )}
      </div>
      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
        {thesis.rationale}
      </p>
      <div className="mt-1.5 text-[10px] text-gray-400">
        {new Date(thesis.created_at).toLocaleDateString()}
      </div>
    </div>
  )
}

export function ThesesDebatePanel({ tradeIdeaId, onAddThesis, readOnly, ideaRationale, ideaAction, ideaCreatedBy }: ThesesDebatePanelProps) {
  const { user } = useAuth()
  const { data: theses = [], isLoading } = useTheses(tradeIdeaId)
  const createMutation = useCreateThesis()
  const deleteMutation = useDeleteThesis(tradeIdeaId)
  const updateMutation = useUpdateThesis(tradeIdeaId)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editRationale, setEditRationale] = useState('')
  const [editConviction, setEditConviction] = useState<ThesisConviction>('medium')

  // Auto-seed the creator's rationale as a thesis on first view
  const seededRef = useRef(false)
  useEffect(() => {
    if (seededRef.current || isLoading || !ideaRationale?.trim() || !ideaCreatedBy) return
    // Check if the creator already has a thesis
    const direction: ThesisDirection = (ideaAction === 'sell' || ideaAction === 'trim') ? 'bear' : 'bull'
    const alreadyHasThesis = theses.some(t => t.created_by === ideaCreatedBy && t.direction === direction)
    if (alreadyHasThesis) {
      seededRef.current = true
      return
    }
    seededRef.current = true
    createMutation.mutate({
      tradeQueueItemId: tradeIdeaId,
      direction,
      rationale: ideaRationale.trim(),
      conviction: 'medium',
    })
  }, [isLoading, theses, ideaRationale, ideaAction, ideaCreatedBy, tradeIdeaId])

  const bullTheses = theses.filter(t => t.direction === 'bull')
  const bearTheses = theses.filter(t => t.direction === 'bear')

  const handleStartEdit = (thesis: ThesisWithUser) => {
    setEditingId(thesis.id)
    setEditRationale(thesis.rationale)
    setEditConviction(thesis.conviction || 'medium')
  }

  const handleSaveEdit = async () => {
    if (!editingId || !editRationale.trim()) return
    await updateMutation.mutateAsync({
      thesisId: editingId,
      input: { rationale: editRationale.trim(), conviction: editConviction },
    })
    setEditingId(null)
  }

  const handleDelete = async (thesisId: string) => {
    await deleteMutation.mutateAsync(thesisId)
  }

  if (isLoading) {
    return <div className="text-sm text-gray-400 py-8 text-center">Loading debate...</div>
  }

  if (theses.length === 0 && readOnly) {
    return <div className="text-sm text-gray-400 py-8 text-center">No theses yet.</div>
  }

  return (
    <div className="space-y-3">
      {/* Header with counts */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 text-xs font-medium">
          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
            <TrendingUp className="h-3.5 w-3.5" />
            {bullTheses.length} Bull
          </span>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
            <TrendingDown className="h-3.5 w-3.5" />
            {bearTheses.length} Bear
          </span>
        </div>
        {!readOnly && (
          <Button variant="ghost" size="sm" onClick={() => onAddThesis()}>
            <Plus className="h-3.5 w-3.5 mr-1" />
            Take a Side
          </Button>
        )}
      </div>

      {/* Side-by-side columns */}
      <div className="grid grid-cols-2 gap-3">
        {/* Bull column */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              Bullish
            </span>
          </div>
          {bullTheses.length === 0 ? (
            <div className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              No bull theses
              {!readOnly && (
                <button
                  onClick={() => onAddThesis('bull')}
                  className="block mx-auto mt-1 text-emerald-600 hover:text-emerald-700 font-medium"
                >
                  Be first
                </button>
              )}
            </div>
          ) : (
            bullTheses.map(t =>
              editingId === t.id ? (
                <EditCard
                  key={t.id}
                  rationale={editRationale}
                  conviction={editConviction}
                  onRationaleChange={setEditRationale}
                  onConvictionChange={setEditConviction}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                  saving={updateMutation.isPending}
                  direction="bull"
                />
              ) : (
                <ThesisCard
                  key={t.id}
                  thesis={t}
                  isAuthor={user?.id === t.created_by}
                  onEdit={() => handleStartEdit(t)}
                  onDelete={() => handleDelete(t.id)}
                  readOnly={readOnly}
                />
              )
            )
          )}
        </div>

        {/* Bear column */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingDown className="h-3.5 w-3.5 text-red-500" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-red-600 dark:text-red-400">
              Bearish
            </span>
          </div>
          {bearTheses.length === 0 ? (
            <div className="text-xs text-gray-400 py-4 text-center border border-dashed border-gray-200 dark:border-gray-700 rounded-lg">
              No bear theses
              {!readOnly && (
                <button
                  onClick={() => onAddThesis('bear')}
                  className="block mx-auto mt-1 text-red-600 hover:text-red-700 font-medium"
                >
                  Be first
                </button>
              )}
            </div>
          ) : (
            bearTheses.map(t =>
              editingId === t.id ? (
                <EditCard
                  key={t.id}
                  rationale={editRationale}
                  conviction={editConviction}
                  onRationaleChange={setEditRationale}
                  onConvictionChange={setEditConviction}
                  onSave={handleSaveEdit}
                  onCancel={() => setEditingId(null)}
                  saving={updateMutation.isPending}
                  direction="bear"
                />
              ) : (
                <ThesisCard
                  key={t.id}
                  thesis={t}
                  isAuthor={user?.id === t.created_by}
                  onEdit={() => handleStartEdit(t)}
                  onDelete={() => handleDelete(t.id)}
                  readOnly={readOnly}
                />
              )
            )
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline edit card
// ---------------------------------------------------------------------------

function EditCard({
  rationale,
  conviction,
  onRationaleChange,
  onConvictionChange,
  onSave,
  onCancel,
  saving,
  direction,
}: {
  rationale: string
  conviction: ThesisConviction
  onRationaleChange: (v: string) => void
  onConvictionChange: (v: ThesisConviction) => void
  onSave: () => void
  onCancel: () => void
  saving: boolean
  direction: 'bull' | 'bear'
}) {
  const isBull = direction === 'bull'
  return (
    <div className={clsx(
      'rounded-lg border p-3',
      isBull
        ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
        : 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20'
    )}>
      <textarea
        value={rationale}
        onChange={e => onRationaleChange(e.target.value)}
        className="w-full h-20 px-2 py-1.5 text-sm rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 resize-none focus:ring-1 focus:ring-blue-400"
        autoFocus
      />
      <div className="flex items-center justify-between mt-2">
        <div className="inline-flex gap-0.5 p-0.5 bg-gray-100 dark:bg-gray-700 rounded">
          {(['low', 'medium', 'high'] as const).map(c => (
            <button
              key={c}
              onClick={() => onConvictionChange(c)}
              className={clsx(
                'px-2 py-0.5 text-[10px] font-medium rounded capitalize',
                conviction === c
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500'
              )}
            >
              {c}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          <button onClick={onCancel} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            onClick={onSave}
            disabled={saving || !rationale.trim()}
            className={clsx(
              'px-2 py-1 text-xs font-medium rounded text-white',
              isBull ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-red-600 hover:bg-red-700',
              (saving || !rationale.trim()) && 'opacity-50'
            )}
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
