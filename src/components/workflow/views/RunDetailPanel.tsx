/**
 * RunDetailPanel
 *
 * Thin router that dispatches to the correct scope-specific panel
 * based on the run's scope_type (asset, portfolio, general).
 *
 * Renders the shared header (back button, name, version chip)
 * and delegates the body to a scope-specific child.
 */

import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Tag } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { AssetRunDetailPanel } from './AssetRunDetailPanel'
import { PortfolioRunDetailPanel } from './PortfolioRunDetailPanel'
import { GeneralRunDetailPanel } from './GeneralRunDetailPanel'

interface WorkflowStage {
  id: string
  stage_key: string
  stage_label: string
  stage_color: string
  sort_order: number
}

export interface RunDetailPanelProps {
  branchId: string
  branchName: string
  parentWorkflowName: string
  workflowStages: WorkflowStage[]
  userId: string
  onBack: () => void
  templateVersionNumber?: number | null
  onNavigate?: (result: { id: string; title: string; type: string; data?: any }) => void
}

type ScopeType = 'asset' | 'portfolio' | 'general'

export function RunDetailPanel({
  branchId,
  branchName,
  parentWorkflowName,
  workflowStages,
  userId,
  onBack,
  templateVersionNumber,
  onNavigate,
}: RunDetailPanelProps) {
  // Fetch scope_type for this branch
  const { data: scopeData } = useQuery({
    queryKey: ['run-scope-type', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('workflows')
        .select('scope_type, status')
        .eq('id', branchId)
        .single()
      if (error) throw error
      return data
    },
    enabled: !!branchId,
    staleTime: 1000 * 60 * 5,
  })

  const scopeType: ScopeType = (scopeData?.scope_type || 'asset') as ScopeType
  const isRunEnded = scopeData?.status === 'inactive'

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      {/* Shared header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center space-x-3">
          <button
            onClick={onBack}
            className="text-gray-500 hover:text-gray-700 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{branchName}</h2>
            <div className="flex items-center space-x-2">
              <p className="text-sm text-gray-500">{parentWorkflowName}</p>
              {templateVersionNumber != null && templateVersionNumber > 0 ? (
                <span
                  className="inline-flex items-center space-x-1 px-1.5 py-0 text-[10px] font-medium rounded bg-gray-100 text-gray-500 leading-4"
                  title={`Process definition v${templateVersionNumber}`}
                >
                  <Tag className="w-2.5 h-2.5" />
                  <span>v{templateVersionNumber}</span>
                </span>
              ) : (
                <span
                  className="inline-flex items-center px-1.5 py-0 text-[10px] font-medium rounded bg-gray-100 text-gray-400 leading-4"
                  title="No definition version assigned"
                >
                  v—
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Scope-specific body */}
      <div className="flex-1 p-6 bg-gray-50 overflow-y-auto space-y-6">
        {scopeType === 'portfolio' ? (
          <PortfolioRunDetailPanel
            branchId={branchId}
            workflowStages={workflowStages}
            isRunEnded={isRunEnded}
            onNavigateToPortfolio={onNavigate ? (portfolioId, portfolioName, portfolioMnemonic) => {
              onNavigate({ id: portfolioId, title: portfolioName, type: 'portfolio', data: { id: portfolioId, name: portfolioName, portfolio_id: portfolioMnemonic, initialTab: 'processes', _navTs: Date.now() } })
            } : undefined}
          />
        ) : scopeType === 'general' ? (
          <GeneralRunDetailPanel
            branchId={branchId}
            workflowStages={workflowStages}
            userId={userId}
            isRunEnded={isRunEnded}
          />
        ) : (
          <AssetRunDetailPanel
            branchId={branchId}
            workflowStages={workflowStages}
            userId={userId}
            onNavigate={onNavigate}
            isRunEnded={isRunEnded}
          />
        )}
      </div>
    </div>
  )
}
