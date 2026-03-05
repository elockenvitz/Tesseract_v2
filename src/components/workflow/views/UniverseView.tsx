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
import { Eye } from 'lucide-react'
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
  onSave
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
      {/* ─── Scope (hero card) ────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <div className="flex items-start justify-between">
          {/* Left: count + label */}
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

          {/* Right: preview button */}
          {hasRules && matchCount !== null && matchCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowPreview(true)}
              className="mt-1"
            >
              <Eye className="w-3.5 h-3.5 mr-1" />
              Preview
            </Button>
          )}
        </div>

        {/* Part 6: delta since last run (renders only when data exists) */}
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
      </div>

      {/* ─── Divider ───────────────────────────────────────── */}
      <div className="border-t border-gray-100" />

      {/* ─── Selection Rules ───────────────────────────────── */}
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
