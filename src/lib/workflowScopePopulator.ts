/**
 * workflowScopePopulator
 *
 * Populates a new run (workflow branch) based on the template's scope_type.
 * - asset:     existing path via addAssetsToWorkflowByUniverse
 * - portfolio: queries workflow_portfolio_selections → inserts portfolio_workflow_progress rows
 * - general:   inserts a single general_workflow_progress row + instantiates general_checklist_items
 */

import { supabase } from './supabase'

export type ScopeType = 'asset' | 'portfolio' | 'general'

/**
 * Populate a new run based on scope type.
 *
 * @param branchId      The newly created branch/run workflow ID
 * @param templateId    The root parent workflow ID (template)
 * @param scopeType     'asset' | 'portfolio' | 'general'
 * @param universeRules Raw universe rules from DB (only used for asset scope)
 */
export async function populateRunByScope(
  branchId: string,
  templateId: string,
  scopeType: ScopeType,
  universeRules?: any[]
): Promise<void> {
  switch (scopeType) {
    case 'asset':
      await populateAssetRun(branchId, universeRules)
      break
    case 'portfolio':
      await populatePortfolioRun(branchId, templateId)
      break
    case 'general':
      await populateGeneralRun(branchId, templateId)
      break
  }
}

/** Asset scope: delegate to existing addAssetsToWorkflowByUniverse */
async function populateAssetRun(branchId: string, universeRules?: any[]) {
  if (!universeRules || universeRules.length === 0) return

  const { addAssetsToWorkflowByUniverse } = await import('./universeAssetMatcher')
  const rules = universeRules.map(r => {
    const config = r.rule_config || {}
    let values: string[] = []

    switch (r.rule_type) {
      case 'coverage':
        values = config.analyst_user_ids || []
        break
      case 'list':
        values = config.list_ids || []
        break
      case 'theme':
        values = config.theme_ids || []
        break
      case 'sector':
        values = config.sectors || []
        break
      case 'priority':
        values = config.levels || []
        break
      case 'portfolio':
        values = config.values || config.portfolio_ids || []
        break
      default:
        values = config.values || []
    }

    return {
      id: r.id,
      type: r.rule_type === 'coverage' ? 'analyst' : r.rule_type,
      values,
      operator: r.combination_operator,
    }
  })

  await addAssetsToWorkflowByUniverse(branchId, rules, 'OR')
}

/** Portfolio scope: query selections from template → create progress rows */
async function populatePortfolioRun(branchId: string, templateId: string) {
  const { data: selections, error: selError } = await supabase
    .from('workflow_portfolio_selections')
    .select('portfolio_id')
    .eq('workflow_id', templateId)

  if (selError) {
    console.error('Error fetching portfolio selections:', selError)
    throw selError
  }

  if (!selections || selections.length === 0) return

  const now = new Date().toISOString()
  const progressRecords = selections.map(s => ({
    portfolio_id: s.portfolio_id,
    workflow_id: branchId,
    is_started: true,
    is_completed: false,
    started_at: now,
    created_at: now,
    updated_at: now,
  }))

  const { error } = await supabase
    .from('portfolio_workflow_progress')
    .upsert(progressRecords, {
      onConflict: 'portfolio_id,workflow_id',
      ignoreDuplicates: true,
    })

  if (error) {
    console.error('Error inserting portfolio progress:', error)
    throw error
  }
}

/** General scope: single progress row + instantiate checklist items from stage definitions */
async function populateGeneralRun(branchId: string, templateId: string) {
  // Fetch stages for the template (including checklist_items templates)
  const { data: stages } = await supabase
    .from('workflow_stages')
    .select('stage_key, sort_order, stage_description, checklist_items')
    .eq('workflow_id', templateId)
    .order('sort_order', { ascending: true })

  const firstStageKey = stages?.[0]?.stage_key || null

  // Create single progress row
  const now = new Date().toISOString()
  const { error: progressError } = await supabase
    .from('general_workflow_progress')
    .upsert({
      workflow_id: branchId,
      current_stage_key: firstStageKey,
      is_started: true,
      is_completed: false,
      started_at: now,
      created_at: now,
      updated_at: now,
    }, {
      onConflict: 'workflow_id',
      ignoreDuplicates: true,
    })

  if (progressError) {
    console.error('Error inserting general progress:', progressError)
    throw progressError
  }

  // Instantiate checklist items from stage templates
  if (stages && stages.length > 0) {
    const checklistRows: {
      workflow_id: string
      stage_id: string
      item_id: string
      item_text: string
      item_type?: string
      sort_order: number
      completed: boolean
      status: string
    }[] = []

    for (const stage of stages) {
      const rawItems: any[] = (stage.checklist_items as any[]) || []
      rawItems.forEach((item, idx) => {
        // Handle both string format and object format {text, item_type}
        const text = typeof item === 'string' ? item : item?.text
        const itemType = typeof item === 'object' ? (item?.item_type || 'operational') : 'operational'
        if (!text || !text.trim()) return
        checklistRows.push({
          workflow_id: branchId,
          stage_id: stage.stage_key,
          item_id: `item_${idx}`,
          item_text: text.trim(),
          item_type: itemType,
          sort_order: idx,
          completed: false,
          status: 'unchecked',
        })
      })
    }

    if (checklistRows.length > 0) {
      const { error: checklistError } = await supabase
        .from('general_checklist_items')
        .upsert(checklistRows, {
          onConflict: 'workflow_id,stage_id,item_id',
          ignoreDuplicates: true,
        })

      if (checklistError) {
        console.error('Error inserting checklist items:', checklistError)
        throw checklistError
      }
    }
  }
}
