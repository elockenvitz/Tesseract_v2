/**
 * PilotTeaserModal — shown when a pilot user clicks a teaser (preview-level)
 * or hidden surface. Explains positioning: "this connects after a simulated
 * decision is accepted."
 */

import { Lock, Sparkles, X } from 'lucide-react'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'

interface PilotTeaserModalProps {
  isOpen: boolean
  featureLabel: string
  reason?: 'preview' | 'hidden'
  onClose: () => void
  onGoToTradeLab?: () => void
}

export function PilotTeaserModal({
  isOpen, featureLabel, reason = 'preview', onClose, onGoToTradeLab,
}: PilotTeaserModalProps) {
  if (!isOpen) return null

  const headline = reason === 'preview'
    ? `${featureLabel} is available after your first decision`
    : `${featureLabel} is not available in this pilot`

  const copy = reason === 'preview'
    ? `This connects after a simulated decision is accepted. We're starting with the decision simulation workflow first, so you can feel the whole loop.`
    : `This surface is turned off for the pilot. We're keeping the experience focused on the decision simulation workflow.`

  return (
    <div className="fixed inset-0 z-[100] overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-md w-full mx-auto transform transition-all overflow-hidden">
          {/* Header strip */}
          <div className="bg-gradient-to-r from-primary-50 to-purple-50 dark:from-primary-900/20 dark:to-purple-900/20 px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between">
            <div className="flex items-center gap-2">
              <div className={clsx(
                'w-8 h-8 rounded-lg flex items-center justify-center',
                reason === 'preview' ? 'bg-primary-100 text-primary-600' : 'bg-gray-200 text-gray-600'
              )}>
                {reason === 'preview' ? <Sparkles className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              </div>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-primary-700 dark:text-primary-400">
                  Pilot mode
                </div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white leading-tight">
                  {headline}
                </h3>
              </div>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 shrink-0">
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="px-5 py-4 space-y-3">
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              {copy}
            </p>
            {reason === 'preview' && (
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1 list-disc pl-4">
                <li>Review the staged idea in Trade Lab</li>
                <li>Adjust sizing and evaluate decision impact</li>
                <li>Accept — and {featureLabel} opens automatically</li>
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700 flex items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={onClose}>
              Got it
            </Button>
            {onGoToTradeLab && (
              <Button size="sm" onClick={onGoToTradeLab}>
                Go to Trade Lab
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
