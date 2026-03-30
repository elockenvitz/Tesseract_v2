/**
 * UniverseView Component
 *
 * Universe tab for a recurring process.
 * Sections:
 *   1. Universe Scope summary bar (count + health dot + preview button)
 *   2. Selection Rules (SimplifiedUniverseBuilder)
 *   3. Full preview modal (UniversePreviewModal)
 */

import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Eye, Info, X, Plus, Search } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { Button } from '../../ui/Button'
import { SimplifiedUniverseBuilder } from '../SimplifiedUniverseBuilder'
import { UniversePreviewModal } from '../../modals/UniversePreviewModal'

export interface FilterRule {
  id: string
  type: string
  operator: any
  values: any
  combineWith?: 'AND' | 'OR'
}

export interface DropdownOption {
  value: string
  label: string
}

export interface UniverseViewProps {
  workflowId: string
  rules: FilterRule[]
  isEditMode?: boolean
  canEdit?: boolean
  analysts?: DropdownOption[]
  lists?: DropdownOption[]
  themes?: DropdownOption[]
  portfolios?: DropdownOption[]
  onRulesChange?: (rules: FilterRule[]) => void
  onSave?: () => void
  /** Number of assets in the currently active run (if any) */
  activeRunAssetCount?: number
  scopeType?: 'asset' | 'portfolio' | 'general'
  /** For portfolio-scoped: the selected portfolios */
  selectedPortfolios?: { id: string; name: string }[]
  /** For portfolio-scoped: available portfolios to add */
  availablePortfolios?: { id: string; name: string }[]
  onAddPortfolio?: (portfolioId: string) => void
  onRemovePortfolio?: (portfolioId: string) => void
}

// ─── Asset matching (mirrors UniversePreviewModal logic) ─────

async function resolveRuleAssetIds(rule: FilterRule): Promise<string[]> {
  if (!Array.isArray(rule.values)) return []

  switch (rule.type) {
    case 'analyst': {
      const { data } = await supabase.from('coverage').select('asset_id').in('user_id', rule.values).eq('is_active', true).order('asset_id', { ascending: true })
      return data?.map(r => r.asset_id) || []
    }
    case 'list': {
      const { data } = await supabase.from('asset_list_items').select('asset_id').in('list_id', rule.values)
      return data?.map(r => r.asset_id) || []
    }
    case 'theme': {
      const { data } = await supabase.from('theme_assets').select('asset_id').in('theme_id', rule.values)
      return data?.map(r => r.asset_id) || []
    }
    case 'sector': {
      const { data } = await supabase.from('assets').select('id').in('sector', rule.values)
      return data?.map(r => r.id) || []
    }
    case 'priority': {
      const { data } = await supabase.from('assets').select('id').in('priority', rule.values)
      return data?.map(r => r.id) || []
    }
    case 'symbol': {
      const { data } = await supabase.from('assets').select('id').in('symbol', rule.values)
      return data?.map(r => r.id) || []
    }
    case 'portfolio': {
      const { data } = await supabase.from('portfolio_holdings').select('asset_id').in('portfolio_id', rule.values)
      return [...new Set(data?.map(r => r.asset_id) || [])]
    }
    default:
      return []
  }
}

async function resolveUniverse(rules: FilterRule[]): Promise<string[]> {
  let result: Set<string> | null = null

  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    const ids = await resolveRuleAssetIds(rule)
    const ruleSet = new Set(ids)

    if (i === 0) {
      if (rule.operator === 'includes') {
        result = ruleSet
      } else {
        const { data } = await supabase.from('assets').select('id')
        const all = new Set(data?.map(a => a.id) || [])
        ruleSet.forEach(id => all.delete(id))
        result = all
      }
    } else {
      const combinator = rule.combineWith || 'OR'
      if (rule.operator === 'includes') {
        if (combinator === 'AND') {
          result = new Set([...result!].filter(id => ruleSet.has(id)))
        } else {
          ruleSet.forEach(id => result!.add(id))
        }
      } else {
        ruleSet.forEach(id => result!.delete(id))
      }
    }
  }

  return result ? Array.from(result) : []
}

// ─── Portfolio Scope Editor ──────────────────────────────────

function PortfolioScopeEditor({
  selectedPortfolios,
  availablePortfolios,
  canEdit,
  onAdd,
  onRemove,
}: {
  selectedPortfolios: { id: string; name: string }[]
  availablePortfolios: { id: string; name: string }[]
  canEdit: boolean
  onAdd?: (id: string) => void
  onRemove?: (id: string) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)
  const selectedIds = new Set(selectedPortfolios.map(p => p.id))
  const unselected = availablePortfolios.filter(p => !selectedIds.has(p.id) && p.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="text-2xl font-bold text-gray-900">{selectedPortfolios.length}</span>
          <p className="text-xs text-gray-500 mt-0.5">
            {selectedPortfolios.length === 1 ? 'Portfolio in scope' : 'Portfolios in scope'}
          </p>
        </div>
        {canEdit && !isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="px-3 py-1.5 text-xs font-medium text-gray-600 border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
          >
            Edit Portfolios
          </button>
        )}
        {isEditing && (
          <button
            onClick={() => { setIsEditing(false); setShowAdd(false); setConfirmRemove(null) }}
            className="px-3 py-1.5 text-xs font-medium text-blue-600 border border-blue-200 rounded-md hover:bg-blue-50 transition-colors"
          >
            Done
          </button>
        )}
      </div>

      {/* Add portfolio dropdown — only in edit mode */}
      {isEditing && showAdd && (
        <div className="mb-3 border border-gray-200 rounded-lg bg-white shadow-sm">
          <div className="p-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search portfolios..."
                className="w-full text-sm pl-8 pr-3 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400"
                autoFocus
              />
            </div>
          </div>
          <div className="max-h-[180px] overflow-y-auto border-t border-gray-100">
            {unselected.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-4">No portfolios available to add</p>
            ) : unselected.map(p => (
              <button
                key={p.id}
                onClick={() => { onAdd!(p.id); setSearch(''); setShowAdd(false) }}
                className="w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-b-0"
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio list */}
      <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
        {selectedPortfolios.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">No portfolios selected</p>
        ) : selectedPortfolios.map(p => (
          <div key={p.id} className="flex items-center justify-between px-3 py-2.5">
            <span className="text-sm font-medium text-gray-900">{p.name}</span>
            {isEditing && onRemove && (
              confirmRemove === p.id ? (
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">Remove?</span>
                  <button onClick={() => { onRemove(p.id); setConfirmRemove(null) }} className="text-[11px] font-medium text-red-600 hover:text-red-700">Yes</button>
                  <button onClick={() => setConfirmRemove(null)} className="text-[11px] text-gray-400 hover:text-gray-600">No</button>
                </div>
              ) : (
                <button onClick={() => setConfirmRemove(p.id)} className="text-[11px] text-gray-400 hover:text-red-600 transition-colors">
                  Remove
                </button>
              )
            )}
          </div>
        ))}
      </div>

      {/* Add button — only in edit mode, below the list */}
      {isEditing && onAdd && !showAdd && (
        <button
          onClick={() => { setShowAdd(true); setSearch('') }}
          className="mt-2 w-full px-3 py-2 text-sm text-gray-500 border border-dashed border-gray-200 rounded-lg hover:border-gray-300 hover:text-gray-700 transition-colors text-center"
        >
          <Plus className="w-3.5 h-3.5 inline mr-1" />Add Portfolio
        </button>
      )}
    </div>
  )
}

// ─── Component ───────────────────────────────────────────────

export function UniverseView({
  workflowId,
  rules,
  isEditMode = false,
  canEdit = false,
  analysts = [],
  lists = [],
  themes = [],
  portfolios = [],
  onRulesChange,
  onSave,
  activeRunAssetCount,
  scopeType = 'asset',
  selectedPortfolios = [],
  availablePortfolios = [],
  onAddPortfolio,
  onRemovePortfolio,
}: UniverseViewProps) {
  const [showPreview, setShowPreview] = useState(false)
  const hasRules = rules.length > 0

  // Universe scope: count for hero card
  const { data: universeMatch, isLoading: isLoadingMatch } = useQuery({
    queryKey: ['universe-scope', workflowId, rules],
    queryFn: async () => {
      if (rules.length === 0) return { count: null }

      const matchedIds = await resolveUniverse(rules)

      // Apply overrides
      const { data: overrides } = await supabase
        .from('workflow_universe_overrides')
        .select('asset_id, override_type')
        .eq('workflow_id', workflowId)

      const addedIds = new Set(
        (overrides || []).filter((o: any) => o.override_type === 'add').map((o: any) => o.asset_id)
      )
      const removedIds = new Set(
        (overrides || []).filter((o: any) => o.override_type === 'remove').map((o: any) => o.asset_id)
      )

      const finalSet = new Set(matchedIds.filter(id => !removedIds.has(id)))
      addedIds.forEach(id => finalSet.add(id))

      return { count: finalSet.size }
    },
    staleTime: 60_000
  })

  const matchCount = universeMatch?.count ?? null

  // Stub: universe delta since last run (Part 6 future hook)
  // When backend provides previous-run snapshot, populate these.
  const addedSinceLastRun: number | null = null
  const removedSinceLastRun: number | null = null
  const hasDelta = addedSinceLastRun !== null || removedSinceLastRun !== null

  return (
    <div className="space-y-4">
      {/* ─── Active run warning ────────────────────── */}
      {activeRunAssetCount != null && activeRunAssetCount > 0 && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-amber-800 dark:text-amber-200">Active run in progress</p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Changes to the universe will apply to the <strong>next run</strong>. The current run has {activeRunAssetCount} asset{activeRunAssetCount !== 1 ? 's' : ''} already in progress and will not be affected.
            </p>
          </div>
        </div>
      )}

      {/* ─── Scope (hero card) ────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        {scopeType === 'portfolio' ? (
          <PortfolioScopeEditor
            selectedPortfolios={selectedPortfolios}
            availablePortfolios={availablePortfolios}
            canEdit={canEdit}
            onAdd={onAddPortfolio}
            onRemove={onRemovePortfolio}
          />
        ) : (
        <>
          <div className="flex items-start justify-between">
            <div>
              {isLoadingMatch ? (
                <div className="h-8 w-16 bg-gray-100 rounded animate-pulse mb-1" />
              ) : !hasRules ? (
                <span className="text-2xl font-bold text-amber-600">All</span>
              ) : matchCount !== null ? (
                <span className="text-2xl font-bold text-gray-900">{matchCount}</span>
              ) : (
                <span className="text-2xl font-bold text-gray-300">—</span>
              )}
              <p className="text-xs text-gray-500 mt-0.5">
                {!hasRules ? 'No selection rules — every asset is in scope' : 'Matching assets'}
              </p>
            </div>
            {hasRules && matchCount !== null && matchCount > 0 && (
              <Button size="sm" variant="outline" onClick={() => setShowPreview(true)} className="mt-1">
                <Eye className="w-3.5 h-3.5 mr-1" />Preview
              </Button>
            )}
          </div>
          {hasDelta && (
            <div className="flex items-center space-x-3 mt-2 pt-2 border-t border-gray-100">
              {addedSinceLastRun !== null && addedSinceLastRun > 0 && (
                <span className="text-xs text-emerald-600 font-medium">+{addedSinceLastRun} new since last run</span>
              )}
              {removedSinceLastRun !== null && removedSinceLastRun > 0 && (
                <span className="text-xs text-red-500 font-medium">&minus;{removedSinceLastRun} removed</span>
              )}
            </div>
          )}
        </>
        )}
      </div>

      {/* ─── Selection Rules (asset scope only) ──────────── */}
      {scopeType !== 'portfolio' && (
        <>
          <div className="border-t border-gray-100" />
          <SimplifiedUniverseBuilder
            workflowId={workflowId}
            rules={rules}
            onRulesChange={onRulesChange || (() => {})}
            onSave={onSave || (() => {})}
            isEditable={canEdit}
            canEdit={canEdit}
            isEditMode={isEditMode}
            analysts={analysts}
            lists={lists}
            themes={themes}
            portfolios={portfolios}
          />
        </>
      )}

      {/* ─── Preview Modal ─────────────────────────────────── */}
      {showPreview && (
        <UniversePreviewModal
          workflowId={workflowId}
          rules={rules}
          onClose={() => setShowPreview(false)}
        />
      )}
    </div>
  )
}
