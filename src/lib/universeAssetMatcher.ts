import { supabase } from './supabase'

export interface UniverseRule {
  id: string
  type: 'analyst' | 'list' | 'theme' | 'sector' | 'priority' | 'stage'
  values: string[] | string
  operator?: 'AND' | 'OR'
}

/**
 * Get asset IDs matching a single universe rule
 */
async function getAssetIdsForRule(rule: UniverseRule): Promise<string[]> {
  console.log('🔍 Processing rule:', rule)

  // Handle array values (multi-select filters)
  if (Array.isArray(rule.values)) {
    console.log('📋 Rule has array values:', rule.values)

    switch (rule.type) {
      case 'analyst':
        const { data: coverageAssets } = await supabase
          .from('coverage')
          .select('asset_id')
          .in('user_id', rule.values)
        console.log(`✅ Analyst filter found ${coverageAssets?.length || 0} assets`)
        return coverageAssets?.map(c => c.asset_id) || []

      case 'list':
        const { data: listAssets } = await supabase
          .from('asset_list_items')
          .select('asset_id')
          .in('list_id', rule.values)
        console.log(`✅ List filter found ${listAssets?.length || 0} assets`)
        return listAssets?.map(l => l.asset_id) || []

      case 'theme':
        const { data: themeAssets } = await supabase
          .from('theme_assets')
          .select('asset_id')
          .in('theme_id', rule.values)
        console.log(`✅ Theme filter found ${themeAssets?.length || 0} assets`)
        return themeAssets?.map(t => t.asset_id) || []

      case 'sector':
        const { data: sectorAssets, error: sectorError } = await supabase
          .from('assets')
          .select('id')
          .in('sector', rule.values)
        if (sectorError) {
          console.error('❌ Sector query error:', sectorError)
        }
        console.log(`✅ Sector filter found ${sectorAssets?.length || 0} assets for sectors:`, rule.values)
        return sectorAssets?.map(a => a.id) || []

      case 'priority':
        const { data: priorityAssets } = await supabase
          .from('assets')
          .select('id')
          .in('priority', rule.values)
        console.log(`✅ Priority filter found ${priorityAssets?.length || 0} assets`)
        return priorityAssets?.map(a => a.id) || []

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
    console.log('📭 No rules provided, returning empty set')
    return []
  }

  console.log(`🎯 Getting assets for ${rules.length} rules with ${combineOperator} operator`)

  // Get asset IDs for each rule
  const ruleAssetSets = await Promise.all(
    rules.map(rule => getAssetIdsForRule(rule))
  )

  console.log('📊 Asset sets per rule:', ruleAssetSets.map(s => s.length))

  // Combine based on operator
  if (combineOperator === 'AND') {
    // Intersection: Only assets that match ALL rules
    if (ruleAssetSets.length === 0) return []

    let result = new Set(ruleAssetSets[0])
    for (let i = 1; i < ruleAssetSets.length; i++) {
      const currentSet = new Set(ruleAssetSets[i])
      result = new Set([...result].filter(id => currentSet.has(id)))
    }

    console.log(`✅ AND operation resulted in ${result.size} assets`)
    return Array.from(result)
  } else {
    // Union: Assets that match ANY rule
    const result = new Set<string>()
    ruleAssetSets.forEach(assetSet => {
      assetSet.forEach(id => result.add(id))
    })

    console.log(`✅ OR operation resulted in ${result.size} assets`)
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
  console.log(`🚀 Adding assets to workflow ${workflowId} based on universe rules`)

  // Get matching asset IDs
  const assetIds = await getMatchingAssetIds(rules, combineOperator)

  if (assetIds.length === 0) {
    console.log('📭 No assets match the universe rules')
    return { added: 0, errors: 0 }
  }

  console.log(`📝 Found ${assetIds.length} assets to add to workflow`)

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
      console.log(`✅ Added batch ${i / batchSize + 1} (${batch.length} assets)`)
    }
  }

  console.log(`🎉 Finished: ${added} assets added, ${errors} errors`)
  return { added, errors }
}
