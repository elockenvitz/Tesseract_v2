/**
 * CreateCorrectionModal — proper modal for the post-reconciliation
 * correction flow on an accepted trade. Replaces the back-to-back
 * `window.prompt` calls that were used before, which looked unprofessional
 * and gave the PM no context about the original trade.
 *
 * A correction creates a SECOND accepted_trade with `corrects_accepted_trade_id`
 * pointing back at the original. The original stays visible in the Trade
 * Book (so the audit trail is intact) with a "→ corrected by" link.
 */

import { useEffect, useMemo, useState } from 'react'
import { X, Wrench, AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import { Button } from '../ui/Button'
import type { AcceptedTradeWithJoins } from '../../types/trading'

interface CreateCorrectionModalProps {
  isOpen: boolean
  trade: AcceptedTradeWithJoins | null
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (sizingInput: string, note: string) => void
}

function fmtNumber(n: number | null | undefined, decimals = 2): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function signedPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toFixed(2)}%`
}

function signedShares(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const sign = n > 0 ? '+' : n < 0 ? '−' : ''
  return `${sign}${Math.abs(n).toLocaleString()}`
}

export function CreateCorrectionModal({
  isOpen,
  trade,
  isSubmitting = false,
  onClose,
  onSubmit,
}: CreateCorrectionModalProps) {
  const [sizing, setSizing] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Re-prime state whenever we open for a new trade so the form doesn't
  // carry over a previous correction's draft. Prefill sizing with the
  // original's sizing_input so the PM only has to edit the delta.
  useEffect(() => {
    if (isOpen && trade) {
      setSizing(trade.sizing_input || '')
      setNote('')
      setError(null)
    }
  }, [isOpen, trade?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Escape to close
  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  // Nothing to render when closed or no trade focus — keeping early
  // returns after hooks so the hook order is stable across renders.
  const sizingHasChanged = useMemo(
    () => !!trade && sizing.trim() !== (trade.sizing_input || '').trim(),
    [sizing, trade],
  )
  if (!isOpen || !trade) return null

  const handleSubmit = () => {
    const s = sizing.trim()
    if (!s) {
      setError('Enter a corrected sizing value to continue.')
      return
    }
    if (!sizingHasChanged) {
      setError('Corrected sizing matches the original — change the value or cancel.')
      return
    }
    setError(null)
    onSubmit(s, note.trim())
  }

  const symbol = trade.asset?.symbol || '—'
  const companyName = trade.asset?.company_name || ''

  return (
    <div className="fixed inset-0 z-[60]">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 flex items-center justify-center p-4 pointer-events-none">
        <div
          className="relative w-full max-w-xl bg-white dark:bg-gray-900 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden pointer-events-auto"
          role="dialog"
          aria-modal="true"
          aria-labelledby="correction-modal-title"
        >
          {/* Header */}
          <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-gray-200 dark:border-gray-700">
            <div className="flex items-start gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center flex-shrink-0">
                <Wrench className="w-4 h-4 text-amber-600 dark:text-amber-400" />
              </div>
              <div className="min-w-0">
                <h2 id="correction-modal-title" className="text-base font-semibold text-gray-900 dark:text-white">
                  Correct {symbol}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Creates a new trade linked to the original. The original stays in the Trade Book for audit.
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-md hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 flex-shrink-0"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="px-5 py-4 space-y-4">
            {/* Original trade context — gives the PM the anchor they're
                correcting against without making them cross-reference the
                table behind the modal. */}
            <section className="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40 px-3 py-2.5">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1.5">
                Original trade
              </div>
              <div className="flex items-center justify-between gap-3 mb-1">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{symbol}</span>
                    <span
                      className={clsx(
                        'inline-block px-1.5 py-0.5 text-[9px] font-semibold uppercase rounded',
                        trade.action === 'buy' || trade.action === 'add'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
                      )}
                    >
                      {trade.action}
                    </span>
                  </div>
                  {companyName && (
                    <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{companyName}</div>
                  )}
                </div>
                <div className="text-right text-xs tabular-nums">
                  <div className="text-gray-500 dark:text-gray-400">
                    Sizing input
                  </div>
                  <div className="font-mono font-semibold text-gray-900 dark:text-white">
                    {trade.sizing_input || '—'}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-[11px] tabular-nums pt-2 border-t border-gray-200 dark:border-gray-700/60">
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Tgt Wt</div>
                  <div className="font-mono text-gray-900 dark:text-white">
                    {trade.target_weight != null ? `${fmtNumber(trade.target_weight)}%` : '—'}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Δ Wt</div>
                  <div className="font-mono text-gray-900 dark:text-white">
                    {signedPct(trade.delta_weight)}
                  </div>
                </div>
                <div>
                  <div className="text-gray-500 dark:text-gray-400">Δ Shrs</div>
                  <div className="font-mono text-gray-900 dark:text-white">
                    {signedShares(trade.delta_shares)}
                  </div>
                </div>
              </div>
            </section>

            {/* Corrected sizing input */}
            <section>
              <label
                htmlFor="correction-sizing"
                className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1"
              >
                Corrected sizing
              </label>
              <input
                id="correction-sizing"
                type="text"
                autoFocus
                value={sizing}
                onChange={(e) => { setSizing(e.target.value); if (error) setError(null) }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
                placeholder="e.g. 2.5, +0.5, #500"
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm font-mono text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500"
                disabled={isSubmitting}
              />
              <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-gray-500 dark:text-gray-400">
                <span><code className="text-blue-600 dark:text-blue-400">2.5</code> target 2.5% weight</span>
                <span><code className="text-blue-600 dark:text-blue-400">+0.5</code> add 0.5% weight</span>
                <span><code className="text-blue-600 dark:text-blue-400">-0.25</code> reduce 0.25%</span>
                <span><code className="text-blue-600 dark:text-blue-400">#500</code> target 500 shares</span>
                <span><code className="text-blue-600 dark:text-blue-400">#+100</code> add 100 shares</span>
                <span><code className="text-blue-600 dark:text-blue-400">#-50</code> reduce 50 shares</span>
              </div>
            </section>

            {/* Reason */}
            <section>
              <label
                htmlFor="correction-note"
                className="block text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-1"
              >
                Reason for correction
              </label>
              <textarea
                id="correction-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                placeholder="Why is this being corrected? E.g., fill came in lighter than expected, sizing miscommunication, portfolio rebalance."
                className="w-full px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500 resize-none"
                disabled={isSubmitting}
              />
              <p className="mt-1 text-[11px] text-gray-400 dark:text-gray-500">
                Defaults to "PM correction" if left blank.
              </p>
            </section>

            {error && (
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs text-red-700 dark:text-red-400">
                <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-px" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-800/40">
            <Button variant="outline" size="sm" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !sizing.trim() || !sizingHasChanged}
              className="bg-amber-600 hover:bg-amber-700 border-amber-600 hover:border-amber-700"
            >
              <Wrench className="w-3.5 h-3.5 mr-1" />
              {isSubmitting ? 'Creating…' : 'Create correction'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
