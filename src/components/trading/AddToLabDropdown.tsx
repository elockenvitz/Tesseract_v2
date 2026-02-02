import { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronDown, Plus } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { useToast } from '../common/Toast'
import { emitAuditEvent } from '../../lib/audit'
import { clsx } from 'clsx'
import type { TradeQueueItemWithDetails } from '../../types/trading'

interface AddToLabDropdownProps {
  trade: TradeQueueItemWithDetails
  existingLabIds?: string[]
  onSuccess?: () => void
}

export function AddToLabDropdown({ trade, existingLabIds = [], onSuccess }: AddToLabDropdownProps) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const toast = useToast()
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const existingLabIdSet = new Set(existingLabIds)

  // Fetch trade labs with portfolio info
  const { data: allLabsWithPortfolios, isLoading } = useQuery({
    queryKey: ['all-trade-labs-with-portfolios'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_labs')
        .select(`
          id,
          name,
          portfolio_id,
          portfolios (id, name)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      return data as Array<{
        id: string
        name: string
        portfolio_id: string
        portfolios: { id: string; name: string } | null
      }>
    },
    enabled: isOpen,
  })

  // Get available portfolios (those not already linked)
  const availablePortfolios = allLabsWithPortfolios?.filter(lab => !existingLabIdSet.has(lab.id)) || []

  // Add to lab mutation
  const addToLabMutation = useMutation({
    mutationFn: async ({ labId, labName, portfolioId, portfolioName }: { labId: string; labName: string; portfolioId: string; portfolioName: string }) => {
      const { data, error } = await supabase
        .from('trade_lab_idea_links')
        .insert({
          trade_lab_id: labId,
          trade_queue_item_id: trade.id,
          created_by: user?.id,
        })
        .select()
        .single()

      if (error) {
        if (error.code === '23505') {
          return { isExisting: true, portfolioName, labId }
        }
        throw error
      }

      // Emit audit event
      if (user?.id) {
        await emitAuditEvent({
          actor: { id: user.id, type: 'user' },
          entity: {
            type: 'trade_idea',
            id: trade.id,
            displayName: `${trade.action?.toUpperCase()} ${trade.assets?.symbol || 'trade'}`,
          },
          action: { type: 'attach', category: 'relationship' },
          state: {
            from: null,
            to: { trade_lab_id: labId, trade_lab_name: labName },
          },
          metadata: {
            ui_source: 'add_to_lab_dropdown',
            trade_lab_id: labId,
            portfolio_id: portfolioId,
          },
          orgId: user.id,
          assetSymbol: trade.assets?.symbol,
        })
      }

      return { link: data, portfolioName, labId, isExisting: false }
    },
    onSuccess: (data) => {
      if (data.isExisting) {
        toast.info('Already added', `Already in ${data.portfolioName}`)
      } else {
        toast.success('Added', `Added to ${data.portfolioName}`)
      }
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-links', trade.id] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusions', trade.id] })
      queryClient.invalidateQueries({ queryKey: ['all-trade-labs-with-portfolios'] })
      setIsOpen(false)
      onSuccess?.()
    },
    onError: (error: any) => {
      if (error.code === '42501' || error.message?.includes('permission')) {
        toast.error('Permission Denied', 'You do not have permission to add to this portfolio')
      } else {
        toast.error('Failed to Add', error.message)
      }
    }
  })

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="gap-1"
      >
        <Plus className="h-4 w-4" />
        Add to Lab
        <ChevronDown className={clsx("h-3 w-3 transition-transform", isOpen && "rotate-180")} />
      </Button>

      {isOpen && (
        <div className="absolute right-0 mt-1 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 py-1">
          {isLoading ? (
            <div className="px-3 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
              Loading...
            </div>
          ) : availablePortfolios.length === 0 ? (
            <div className="px-3 py-3 text-center text-sm text-gray-500 dark:text-gray-400">
              {existingLabIds.length > 0 ? 'Added to all portfolios' : 'No portfolios available'}
            </div>
          ) : (
            availablePortfolios.map(lab => (
              <button
                key={lab.id}
                onClick={() => addToLabMutation.mutate({
                  labId: lab.id,
                  labName: lab.name,
                  portfolioId: lab.portfolio_id,
                  portfolioName: lab.portfolios?.name || 'Unknown'
                })}
                disabled={addToLabMutation.isPending}
                className="w-full px-3 py-2 text-sm text-left hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-900 dark:text-white transition-colors"
              >
                {lab.portfolios?.name || 'Unknown Portfolio'}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
