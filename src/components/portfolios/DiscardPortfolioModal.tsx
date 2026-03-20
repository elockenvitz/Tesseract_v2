import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Archive, Ban, BarChart3, FlaskConical, FileSpreadsheet, ClipboardList, FileText, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import { useToast } from '../common/Toast'
import { logOrgActivity } from '../../lib/org-activity-log'

interface Blocker {
  type: string
  count: number
  label: string
}

interface DiscardPortfolioModalProps {
  isOpen: boolean
  onClose: () => void
  portfolio: { id: string; name: string } | null
  onArchiveInstead?: () => void
  organizationId?: string
}

const BLOCKER_ICONS: Record<string, typeof BarChart3> = {
  holdings: BarChart3,
  variants: FlaskConical,
  trade_sheets: FileSpreadsheet,
  accepted_trades: ClipboardList,
  notes: FileText,
}

export function DiscardPortfolioModal({ isOpen, onClose, portfolio, onArchiveInstead, organizationId }: DiscardPortfolioModalProps) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [blockers, setBlockers] = useState<Blocker[] | null>(null)
  const [checkDone, setCheckDone] = useState(false)

  const resetState = () => {
    setReason('')
    setBlockers(null)
    setCheckDone(false)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const discardMutation = useMutation({
    mutationFn: async (portfolioId: string) => {
      const { data, error } = await supabase.rpc('discard_portfolio', {
        p_portfolio_id: portfolioId,
        p_reason: reason.trim() || null,
      })
      if (error) throw error
      return data as { discarded: boolean; blockers: Blocker[] }
    },
    onSuccess: (result, portfolioId) => {
      if (result.discarded) {
        toast.success('Portfolio discarded')
        queryClient.invalidateQueries({ queryKey: ['all-portfolios'] })
        queryClient.invalidateQueries({ queryKey: ['portfolios-org'] })
        if (organizationId) {
          logOrgActivity({
            organizationId,
            action: 'portfolio.discarded',
            targetType: 'portfolio',
            targetId: portfolioId,
            details: { name: portfolio?.name, reason: reason.trim() || undefined },
            entityType: 'portfolio',
            actionType: 'discarded',
          })
        }
        handleClose()
      } else {
        setBlockers(result.blockers)
        setCheckDone(true)
      }
    },
    onError: (error: any) => {
      toast.error(error?.message || 'Failed to discard portfolio')
    },
  })

  if (!isOpen || !portfolio) return null

  const hasBlockers = checkDone && blockers && blockers.length > 0

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={handleClose} />
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-xl shadow-xl max-w-md w-full mx-auto">
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 text-gray-400 hover:text-gray-600"
          >
            <X className="h-5 w-5" />
          </button>

          <div className="p-6">
            {/* Icon */}
            <div className="flex items-center justify-center mb-4">
              <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center">
                <Ban className="h-6 w-6 text-gray-500" />
              </div>
            </div>

            <div className="text-center mb-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-1">
                Discard Portfolio
              </h3>
              <p className="text-sm text-gray-600">
                Discard removes this portfolio from the product and AI analysis. It can be restored by an Org Admin.
              </p>
            </div>

            {/* Blockers */}
            {hasBlockers && (
              <div className="mb-5 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                <div className="flex items-start gap-2 mb-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                  <p className="text-sm font-medium text-amber-800">
                    Cannot discard — portfolio has meaningful history:
                  </p>
                </div>
                <ul className="ml-6 space-y-1">
                  {blockers!.map((b) => {
                    const Icon = BLOCKER_ICONS[b.type] || AlertTriangle
                    return (
                      <li key={b.type} className="flex items-center gap-2 text-sm text-amber-700">
                        <Icon className="w-3.5 h-3.5 shrink-0" />
                        {b.label}
                      </li>
                    )
                  })}
                </ul>
                {onArchiveInstead && (
                  <button
                    onClick={() => {
                      handleClose()
                      onArchiveInstead()
                    }}
                    className="mt-3 w-full flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-amber-800 bg-amber-100 hover:bg-amber-200 rounded-lg transition-colors"
                  >
                    <Archive className="w-4 h-4" />
                    Archive instead
                  </button>
                )}
              </div>
            )}

            {/* Reason + confirm */}
            {!hasBlockers && (
              <>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Reason <span className="text-gray-400">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Created in error, duplicate"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-400 focus:border-gray-400"
                    autoFocus
                  />
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={handleClose} className="flex-1">
                    Cancel
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() => discardMutation.mutate(portfolio.id)}
                    loading={discardMutation.isPending}
                    className="flex-1"
                  >
                    <Ban className="w-4 h-4 mr-1" />
                    Discard
                  </Button>
                </div>
              </>
            )}

            {hasBlockers && (
              <div className="flex gap-3">
                <Button variant="outline" onClick={handleClose} className="flex-1">
                  Close
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
