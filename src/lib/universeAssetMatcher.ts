import { supabase } from './supabase'

export interface UniverseRule {
  id: string
  type: 'analyst' | 'list' | 'theme' | 'sector' | 'priority' | 'stage' | 'portfolio'
  values: string[] | string
  operator?: 'AND' | 'OR'
}

/**
 * Get asset IDs matching a single universe rule
 */
async function getAssetIdsForRule(rule: UniverseRule): Promise<string[]> {
  // Handle array values (multi-select filters)
  if (Array.isArray(rule.values)) {
    switch (rule.type) {
      case 'analyst':
        const { data: coverageAssets } = await supabase
          .from('coverage')
          .select('asset_id')
          .in('user_id', rule.values)
          .eq('is_active', true)
          .order('asset_id', { ascending: true })
        return coverageAssets?.map(c => c.asset_id) || []

      case 'list':
        const { data: listAssets } = await supabase
          .from('asset_list_items')
          .select('asset_id')
          .in('list_id', rule.values)
        return listAssets?.map(l => l.asset_id) || []

      case 'theme':
        const { data: themeAssets } = await supabase
          .from('theme_assets')
          .select('asset_id')
          .in('theme_id', rule.values)
        return themeAssets?.map(t => t.asset_id) || []

      case 'sector':
        const { data: sectorAssets, error: sectorError } = await supabase
          .from('assets')
          .select('id')
          .in('sector', rule.values)
        if (sectorError) {
          console.error('❌ Sector query error:', sectorError)
        }
        return sectorAssets?.map(a => a.id) || []

      case 'priority':
        const { data: priorityAssets } = await supabase
          .from('assets')
          .select('id')
          .in('priority', rule.values)
        return priorityAssets?.map(a => a.id) || []

      case 'portfolio':
        const { data: portfolioHoldings } = await supabase
          .from('portfolio_holdings')
          .select('asset_id')
          .in('portfolio_id', rule.values)
        const uniqueAssetIds = [...new Set((portfolioHoldings || []).map(h => h.asset_id))]
        return uniqueAssetIds

      default:
        console.warn('⚠️ Unknown rule type:', rule.type)
        return []
    }
  }

  console.warn('⚠️ Rule has no array values')
  return []
}

/**
 * Get all asset IDs matching universe rules
 * @param rules - Array of universe rules
 * @param combineOperator - How to combine rules: 'AND' (intersection) or 'OR' (union)
 */
export async function getMatchingAssetIds(
  rules: UniverseRule[],
  combineOperator: 'AND' | 'OR' = 'OR'
): Promise<string[]> {
  if (!rules || rules.length === 0) {
    return []
  }

  // Get asset IDs for each rule
  const ruleAssetSets = await Promise.all(
    rules.map(rule => getAssetIdsForRule(rule))
  )

  // Combine based on operator
  if (combineOperator === 'AND') {
    // Intersection: Only assets that match ALL rules
    if (ruleAssetSets.length === 0) return []

    let result = new Set(ruleAssetSets[0])
    for (let i = 1; i < ruleAssetSets.length; i++) {
      const currentSet = new Set(ruleAssetSets[i])
      result = new Set([...result].filter(id => currentSet.has(id)))
    }

    return Array.from(result)
  } else {
    // Union: Assets that match ANY rule
    const result = new Set<string>()
    ruleAssetSets.forEach(assetSet => {
      assetSet.forEach(id => result.add(id))
    })

    return Array.from(result)
  }
}

/**
 * Add assets to a workflow based on universe rules
 * @param workflowId - The workflow ID to add assets to
 * @param rules - Universe rules to evaluate
 * @param combineOperator - How to combine rules
 */
export async function addAssetsToWorkflowByUniverse(
  workflowId: string,
  rules: UniverseRule[],
  combineOperator: 'AND' | 'OR' = 'OR'
): Promise<{ added: number; errors: number }> {
  // Get matching asset IDs
  const assetIds = await getMatchingAssetIds(rules, combineOperator)

  if (assetIds.length === 0) {
    return { added: 0, errors: 0 }
  }

  // Create asset_workflow_progress records for each asset
  // Auto-start workflows for branch workflows (when assets are added via universe rules)
  const now = new Date().toISOString()
  const progressRecords = assetIds.map(assetId => ({
    asset_id: assetId,
    workflow_id: workflowId,
    is_started: true,
    is_completed: false,
    started_at: now,
    created_at: now,
    updated_at: now
  }))

  // Insert in batches to avoid hitting limits
  const batchSize = 100
  let added = 0
  let errors = 0

  for (let i = 0; i < progressRecords.length; i += batchSize) {
    const batch = progressRecords.slice(i, i + batchSize)

    const { error } = await supabase
      .from('asset_workflow_progress')
      .upsert(batch, {
        onConflict: 'asset_id,workflow_id',
        ignoreDuplicates: true
      })

    if (error) {
      console.error(`❌ Error inserting batch ${i / batchSize + 1}:`, error)
      errors += batch.length
    } else {
      added += batch.length
    }
  }

  return { added, errors }
}
