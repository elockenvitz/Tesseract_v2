/**
 * AddThesisModal — Add a bull/bear thesis or context note to a trade idea.
 *
 * Simple modal: pick direction (bull/bear) or context type (catalyst/risk/context),
 * write rationale, optionally set conviction for directional theses.
 * One thesis per user per direction (upserts on conflict).
 */

import { useState, useEffect } from 'react'
import { X, TrendingUp, TrendingDown, Zap, ShieldAlert, FileText } from 'lucide-react'
import { clsx } from 'clsx'
import { useCreateThesis } from '../../hooks/useTheses'
import { Button } from '../ui/Button'
import type { ThesisDirection, ThesisConviction } from '../../types/trading'

type ThesisCategory = 'directional' | 'context'

interface AddThesisModalProps {
  isOpen: boolean
  onClose: () => void
  tradeIdeaId: string
  assetSymbol?: string
  /** Pre-select direction based on context */
  defaultDirection?: ThesisDirection
  onCreated?: () => void
}

export function AddThesisModal({
  isOpen,
  onClose,
  tradeIdeaId,
  assetSymbol,
  defaultDirection,
  onCreated,
}: AddThesisModalProps) {
  const createMutation = useCreateThesis()

  const isContextDefault = defaultDirection === 'catalyst' || defaultDirection === 'risk' || defaultDirection === 'context'
  const [category, setCategory] = useState<ThesisCategory>(isContextDefault ? 'context' : 'directional')
  const [direction, setDirection] = useState<ThesisDirection>(defaultDirection || 'bull')
  const [rationale, setRationale] = useState('')
  const [conviction, setConviction] = useState<ThesisConviction>('medium')

  useEffect(() => {
    if (isOpen) {
      const ctx = defaultDirection === 'catalyst' || defaultDirection === 'risk' || defaultDirection === 'context'
      setCategory(ctx ? 'context' : 'directional')
      setDirection(defaultDirection || 'bull')
      setRationale('')
      setConviction('medium')
    }
  }, [isOpen, defaultDirection])

  const handleSubmit = async () => {
    if (!rationale.trim()) return

    try {
      await createMutation.mutateAsync({
        tradeQueueItemId: tradeIdeaId,
        direction,
        rationale: rationale.trim(),
        conviction: category === 'directional' ? conviction : undefined,
      })
      onCreated?.()
      onClose()
    } catch (err) {
      console.error('[AddThesisModal] Failed to create thesis:', err)
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">
              {category === 'directional' ? 'Add Argument' : 'Add Context'}{' '}
              {assetSymbol && <span className="text-gray-400 font-normal">on {assetSymbol}</span>}
            </h2>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {category === 'directional'
                ? 'Share your directional thesis for this trade idea'
                : 'Add catalyst, risk, or context notes (non-directional)'}
            </p>
          </div>
          <button onClick={onClose} type="button" className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-4">
          {/* Category toggle: Directional vs Context */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Type
            </label>
            <div className="flex gap-2">
              <button
                onClick={() => { setCategory('directional'); setDirection('bull') }}
                className={clsx(
                  'flex-1 px-3 py-1.5 rounded-lg border-2 font-medium text-xs transition-all text-center',
                  category === 'directional'
                    ? 'border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-600'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                )}
              >
                Directional Thesis
              </button>
              <button
                onClick={() => { setCategory('context'); setDirection('catalyst') }}
                className={clsx(
                  'flex-1 px-3 py-1.5 rounded-lg border-2 font-medium text-xs transition-all text-center',
                  category === 'context'
                    ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-600'
                    : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                )}
              >
                Context / Catalyst / Risk
              </button>
            </div>
          </div>

          {/* Direction or context-type selector */}
          {category === 'directional' ? (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Direction
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setDirection('bull')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 font-medium text-sm transition-all',
                    direction === 'bull'
                      ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <TrendingUp className="h-4 w-4" />
                  Bullish
                </button>
                <button
                  onClick={() => setDirection('bear')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg border-2 font-medium text-sm transition-all',
                    direction === 'bear'
                      ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400 dark:border-red-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <TrendingDown className="h-4 w-4" />
                  Bearish
                </button>
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Context Type
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setDirection('catalyst')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 font-medium text-xs transition-all',
                    direction === 'catalyst'
                      ? 'border-amber-500 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <Zap className="h-3.5 w-3.5" />
                  Catalyst
                </button>
                <button
                  onClick={() => setDirection('risk')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 font-medium text-xs transition-all',
                    direction === 'risk'
                      ? 'border-orange-500 bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 dark:border-orange-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Risk
                </button>
                <button
                  onClick={() => setDirection('context')}
                  className={clsx(
                    'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border-2 font-medium text-xs transition-all',
                    direction === 'context'
                      ? 'border-violet-500 bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-600'
                      : 'border-gray-200 dark:border-gray-600 text-gray-500 hover:border-gray-300'
                  )}
                >
                  <FileText className="h-3.5 w-3.5" />
                  Why Now
                </button>
              </div>
            </div>
          )}

          {/* Conviction — only for directional theses */}
          {category === 'directional' && (
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
                Conviction
              </label>
              <div className="inline-flex gap-1 p-0.5 bg-gray-100 dark:bg-gray-700 rounded-lg">
                {(['low', 'medium', 'high'] as const).map(c => (
                  <button
                    key={c}
                    onClick={() => setConviction(c)}
                    className={clsx(
                      'px-3 py-1 text-[11px] font-medium rounded-md transition-colors capitalize',
                      conviction === c
                        ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm'
                        : 'text-gray-500 hover:text-gray-700'
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Rationale */}
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-1.5">
              {category === 'directional' ? 'Thesis / Rationale' : 'Details'} <span className="text-red-500">*</span>
            </label>
            <textarea
              value={rationale}
              onChange={e => setRationale(e.target.value)}
              placeholder={
                direction === 'bull'
                  ? 'Why are you bullish? What fundamentals support this position?'
                  : direction === 'bear'
                  ? 'Why are you bearish? What headwinds concern you?'
                  : direction === 'catalyst'
                  ? 'What specific catalyst or event could move this? Timeline?'
                  : direction === 'risk'
                  ? 'What are the key risks or downside scenarios?'
                  : 'Why now? What timing factors are relevant?'
              }
              className="w-full h-28 px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 focus:ring-2 focus:ring-blue-400 focus:border-blue-400 resize-none placeholder:text-gray-400"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-gray-200 dark:border-gray-700">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleSubmit}
            disabled={createMutation.isPending || !rationale.trim()}
            className={clsx(
              direction === 'bull' ? '!bg-emerald-600 hover:!bg-emerald-700'
                : direction === 'bear' ? '!bg-red-600 hover:!bg-red-700'
                : direction === 'catalyst' ? '!bg-amber-600 hover:!bg-amber-700'
                : direction === 'risk' ? '!bg-orange-600 hover:!bg-orange-700'
                : '!bg-violet-600 hover:!bg-violet-700'
            )}
          >
            {createMutation.isPending ? 'Saving...' : (
              direction === 'bull' ? 'Add Bullish Thesis'
              : direction === 'bear' ? 'Add Bearish Thesis'
              : direction === 'catalyst' ? 'Add Catalyst'
              : direction === 'risk' ? 'Add Risk'
              : 'Add Context'
            )}
          </Button>
        </div>

        {createMutation.isError && (
          <div className="px-4 pb-3 text-xs text-red-600">
            Failed to save. Please try again.
          </div>
        )}
      </div>
    </div>
  )
}
