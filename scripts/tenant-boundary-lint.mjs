#!/usr/bin/env node
/**
 * Tenant Boundary Linter
 *
 * Validates multi-org isolation invariants against the Supabase database:
 *   1. Every non-exempt table has RLS enabled
 *   2. Every non-global table has organization_id OR is in the FK-chain exempt list
 *   3. org_id columns are NOT NULL (except grandfathered)
 *   4. Tables with org_id have at least one RLS policy
 *   5. No unknown tables exist (any new table must be categorized)
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... node scripts/tenant-boundary-lint.mjs
 *
 * Exit code 0 = all checks pass, 1 = violations found.
 */

import { createClient } from '@supabase/supabase-js'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('ERROR: Set SUPABASE_URL and SUPABASE_SERVICE_KEY (or VITE_ variants)')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

// ---------------------------------------------------------------------------
// GLOBAL_TABLES — tables that are intentionally NOT org-scoped.
// Each entry has a short rationale.
// ---------------------------------------------------------------------------
const GLOBAL_TABLES = {
  // --- Platform identity & auth ---
  users:                          'User accounts — cross-org identity',
  organizations:                  'Org registry — the org table itself',
  organization_memberships:       'Org membership join — has org_id',
  organization_invites:           'Org invites — has org_id',
  organization_audit_log:         'Org audit log — has org_id',
  organization_contacts:          'Org contacts — has org_id',

  // --- User-personal (scoped by auth.uid(), not org) ---
  user_preferences:               'Per-user settings, cross-org',
  user_profile_extended:          'Extended profile, cross-org',
  user_onboarding_status:         'Onboarding state, cross-org',
  user_ai_config:                 'AI preferences, per-user',
  user_ai_column_selections:      'AI column picks, per-user',
  user_quick_prompt_history:      'AI prompt history, per-user',
  user_saved_views:               'Saved table views, per-user',
  user_actions:                   'Action log, per-user',
  user_asset_flags:               'Asset flags, per-user',
  user_asset_layout_selections:   'Layout picks, per-user',
  user_asset_page_layouts:        'Page layouts, per-user',
  user_asset_page_preferences:    'Page prefs, per-user',
  user_asset_priorities:          'Priority rankings, per-user',
  user_asset_references:          'Saved references, per-user',
  user_asset_widget_values:       'Widget data, per-user',
  user_asset_widgets:             'Widget config, per-user',
  personal_tasks:                 'Personal to-do items, per-user',
  attention_user_state:           'Attention tracking, per-user',
  author_follows:                 'Author follow list, per-user',
  idea_bookmarks:                 'Bookmarked ideas, per-user',
  outcome_preferences:            'Outcome prefs, per-user',
  rating_ev_suppressions:         'Suppressed ratings, per-user',
  asset_followup_suppressions:    'Followup suppressions, per-user',
  individual_allocation_views:    'Personal allocation views, per-user',
  calendar_connections:           'Calendar OAuth, per-user',
  connected_calendars:            'Calendar links, per-user',
  external_calendar_events:       'Synced external events, per-user',
  calendar_sync_logs:             'Calendar sync logs, per-user',
  calendar_event_reminders:       'Reminders, per-user',
  chart_annotations:              'Chart annotations, per-user',

  // --- Global reference data (shared across all orgs) ---
  assets:                         'Security master — global reference',
  asset_classes:                  'Asset class taxonomy — global',
  asset_earnings_dates:           'Earnings calendar — global',
  analyst_estimates:              'Consensus estimates — global',
  analyst_estimate_history:       'Estimate history — global',
  analyst_ratings:                'Consensus ratings — global',
  analyst_rating_history:         'Rating history — global',
  analyst_price_targets:          'Price targets — global',
  analyst_price_target_history:   'PT history — global',
  analyst_performance_snapshots:  'Analyst perf — global',
  estimate_metrics:               'Estimate metrics defs — global',
  price_history_cache:            'Price cache — global',
  price_targets:                  'User price targets — global',
  price_target_history:           'PT history — global',
  price_target_outcomes:          'PT outcomes — global',

  // --- AI / platform system ---
  platform_ai_config:             'Platform AI settings — singleton',
  ai_column_library:              'AI column defs — has nullable org_id',
  ai_column_cache:                'AI column cache — ephemeral',
  ai_conversations:               'AI chat sessions — per-user',
  ai_usage_log:                   'AI usage tracking — per-user',
  ai_asset_insights:              'AI insights cache — per-asset',

  // --- System event tables ---
  activity_events:                'Cross-feature activity feed',
  audit_events:                   'Detailed audit trail',
  notifications:                  'User notifications — per-user',
}

// ---------------------------------------------------------------------------
// FK_CHAIN_TABLES — tables without organization_id that inherit org scope
// through foreign key chains (e.g., workflow_stages → workflows → org).
// RLS on these tables uses membership checks on the parent chain.
// ---------------------------------------------------------------------------
const FK_CHAIN_TABLES = {
  // --- Teams / Portfolios chain ---
  team_memberships:               'teams.organization_id via team_id',
  team_access_requests:           'teams via team_id',
  team_research_fields:           'teams via team_id',
  portfolios:                     'teams.organization_id via team_id',
  portfolio_memberships:          'portfolios → teams chain',
  portfolio_holdings:             'portfolios → teams chain',
  portfolio_benchmark_weights:    'portfolios → teams chain',
  portfolio_notes:                'portfolios → teams chain',
  portfolio_team:                 'portfolios → teams chain',
  portfolio_trades:               'portfolios → teams chain',
  portfolio_universe_assets:      'portfolios → teams chain',
  portfolio_universe_filters:     'portfolios → teams chain',
  portfolio_workflow_progress:    'portfolios → teams chain',

  // --- Org chart chain ---
  org_chart_node_links:           'org_chart_nodes.organization_id',
  org_chart_node_members:         'org_chart_nodes.organization_id',

  // --- Workflow chain (workflows.organization_id) ---
  workflow_stages:                'workflows.organization_id via workflow_id',
  workflow_stage_content_tiles:   'workflow_stages → workflows chain',
  workflow_stakeholders:          'workflows via workflow_id',
  workflow_collaborations:        'workflows via workflow_id',
  workflow_favorites:             'workflows via workflow_id',
  workflow_portfolio_selections:  'workflows via workflow_id',
  workflow_access_requests:       'workflows via workflow_id',
  workflow_automation_rules:      'workflows via workflow_id',
  workflow_rule_executions:       'workflow_automation_rules → workflows',
  workflow_checklist_templates:   'workflows via workflow_id',
  workflow_templates:             'workflows via workflow_id',
  workflow_template_versions:     'workflow_templates → workflows',
  workflow_universe_overrides:    'workflows via workflow_id',
  workflow_universe_rules:        'workflows via workflow_id',
  general_checklist_items:        'workflows chain',
  general_workflow_progress:      'workflows chain',
  stage_assignments:              'workflow_stages → workflows',
  asset_stage_deadlines:          'workflow_stages → workflows',
  asset_workflow_priorities:      'workflows chain',
  asset_workflow_progress:        'workflows chain',

  // --- Project chain (projects.organization_id) ---
  project_assignments:            'projects.organization_id via project_id',
  project_attachments:            'projects via project_id',
  project_comments:               'projects via project_id',
  project_comment_reactions:      'project_comments → projects chain',
  project_activity:               'projects via project_id',
  project_collections:            'projects.organization_id via org scope',
  project_contexts:               'projects via project_id',
  project_deliverables:           'projects via project_id',
  project_dependencies:           'projects via project_id',
  project_org_groups:             'projects via project_id',
  project_tag_assignments:        'projects / project_tags chain',
  project_tags:                   'projects.organization_id via org scope',
  project_teams:                  'projects via project_id',
  deliverable_assignments:        'project_deliverables → projects',

  // --- Theme chain (themes.organization_id) ---
  theme_assets:                   'themes.organization_id via theme_id',
  theme_collaborations:           'themes via theme_id',
  theme_notes:                    'themes via theme_id',

  // --- Calendar events chain ---
  // calendar_events has org_id directly

  // --- Conversation chain (conversations.organization_id) ---
  conversation_messages:          'conversations.organization_id via conversation_id',
  conversation_participants:      'conversations via conversation_id',
  messages:                       'direct messages — RLS by participant',

  // --- Coverage chain ---
  coverage:                       'portfolios → teams → org chain',
  coverage_history:               'coverage chain',
  coverage_portfolios:            'coverage chain',
  coverage_requests:              'coverage chain',

  // --- Asset research chain ---
  asset_notes:                    'RLS via user ownership / team membership',
  asset_revisions:                'asset_notes chain',
  asset_revision_events:          'asset_revisions chain',
  asset_field_history:            'research_fields chain',
  asset_contributions:            'research chain',
  asset_contribution_history:     'research chain',
  field_contributions:            'research_fields chain',
  field_contribution_history:     'research_fields chain',
  contribution_reactions:         'field_contributions chain',
  contribution_replies:           'field_contributions chain',
  contribution_summaries:         'field_contributions chain',
  contribution_visibility_targets: 'field_contributions chain',
  research_field_access_requests: 'research_fields chain',
  research_field_viewers:         'research_fields chain',

  // --- Asset checklist chain ---
  asset_checklist_items:          'RLS via workflow → org chain',
  asset_checklist_attachments:    'asset_checklist_items chain',
  checklist_item_comments:        'asset_checklist_items chain',
  checklist_comment_mentions:     'checklist_item_comments chain',
  checklist_comment_references:   'checklist_item_comments chain',
  checklist_task_assignments:     'asset_checklist_items chain',

  // --- Asset tags chain ---
  asset_tag_assignments:          'asset_tags chain',
  asset_tags:                     'RLS via user ownership',
  asset_team_history:             'teams chain',
  asset_team_members:             'teams chain',

  // --- Asset models chain ---
  asset_models:                   'RLS via user ownership',
  model_files:                    'asset_models chain',
  model_versions:                 'asset_models chain',
  model_template_collaborations:  'model_templates chain',

  // --- Asset lists chain ---
  asset_lists:                    'RLS via user ownership',
  asset_list_items:               'asset_lists chain',
  asset_list_activity:            'asset_lists chain',
  asset_list_collaborations:      'asset_lists chain',
  asset_list_favorites:           'asset_lists chain',
  asset_list_groups:              'asset_lists chain',
  asset_list_suggestions:         'asset_lists chain',
  asset_list_user_state:          'asset_lists chain',
  list_kanban_boards:             'asset_lists chain',
  list_kanban_lanes:              'list_kanban_boards chain',
  list_kanban_lane_items:         'list_kanban_lanes chain',

  // --- Allocation chain ---
  allocation_attachments:         'allocation_periods.organization_id chain',
  allocation_cell_notes:          'allocation chain',
  allocation_comments:            'allocation chain',
  allocation_history:             'allocation chain',
  allocation_team_members:        'allocation chain',
  allocation_votes:               'allocation chain',
  official_allocation_views:      'allocation chain',

  // --- Trade Lab chain (trade_labs RLS via portfolio membership) ---
  trade_labs:                     'RLS via user_is_portfolio_member(portfolio_id)',
  lab_variants:                   'trade_labs → portfolios chain',
  trade_sheets:                   'trade_labs → portfolios chain',
  trade_lab_views:                'trade_labs chain',
  trade_lab_view_members:         'trade_lab_views chain',
  trade_lab_idea_links:           'trade_labs chain',
  trade_lab_simulation_items:     'trade_labs chain',
  simulations:                    'trade_labs → portfolios chain',
  simulation_trades:              'simulations chain',
  simulation_shares:              'simulations chain',
  simulation_snapshots:           'simulations chain',
  simulation_share_events:        'simulation_shares chain',
  simulation_suggestions:         'simulations chain',
  simulation_collaborators:       'simulations chain',

  // --- Trade ideas / plans chain ---
  trade_plans:                    'portfolios chain',
  trade_plan_items:               'trade_plans chain',
  trade_proposals:                'portfolios chain',
  trade_proposal_versions:        'trade_proposals chain',
  trade_events:                   'portfolios chain',
  trade_idea_portfolios:          'portfolios chain',
  trade_idea_topics:              'topics chain',
  trade_queue_items:              'portfolios chain',
  trade_queue_comments:           'trade_queue_items chain',
  trade_queue_votes:              'trade_queue_items chain',
  pair_trades:                    'portfolios chain',
  asset_rounding_configs:         'portfolios chain',

  // --- TDF chain (target_date_funds.organization_id) ---
  tdf_comments:                   'target_date_funds chain',
  tdf_executed_trades:            'target_date_funds chain',
  tdf_glide_path_targets:        'target_date_funds chain',
  tdf_holdings:                   'target_date_funds chain',
  tdf_holdings_snapshots:         'target_date_funds chain',
  tdf_notes:                      'target_date_funds chain',
  tdf_trade_proposals:            'target_date_funds chain',
  tdf_trade_proposal_items:       'tdf_trade_proposals chain',
  tdf_underlying_funds:           'target_date_funds chain',

  // --- Quick thoughts chain ---
  quick_thoughts:                 'RLS via user ownership',
  quick_thought_topics:           'quick_thoughts chain',
  thought_reactions:              'quick_thoughts chain',
  idea_reactions:                 'quick_thoughts chain',

  // --- Template / notebook chain ---
  template_collaborations:        'text_templates chain',
  template_tag_assignments:       'template_tags chain',
  template_tags:                  'text_templates chain',
  note_collaborations:            'asset_notes chain',
  note_versions:                  'asset_notes chain',
  custom_notebook_notes:          'custom_notebooks chain',
  layout_collaborations:          'user_asset_page_layouts chain',

  // --- Scenarios chain ---
  scenarios:                      'portfolios chain',

  // --- Table content sources ---
  table_column_content_sources:   'RLS via user ownership',
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function run() {
  let violations = 0
  const results = []

  // Fetch all public tables
  const { data: tables, error: tablesErr } = await supabase.rpc('get_tenant_lint_tables')

  // Fallback: use raw SQL if RPC doesn't exist
  let allTables
  if (tablesErr) {
    // Use direct query approach
    const { data, error } = await supabase.from('information_schema_tables_v').select('*')
    if (error) {
      // Last resort: run via postgrest
      console.log('INFO: Using fallback table enumeration')
      allTables = await fetchTablesViaRawQuery()
    } else {
      allTables = data
    }
  } else {
    allTables = tables
  }

  if (!allTables) {
    allTables = await fetchTablesViaRawQuery()
  }

  // CHECK 1: RLS disabled
  console.log('\n=== CHECK 1: RLS Enabled ===')
  const rlsDisabled = allTables.filter(t => !t.rls_enabled)
  if (rlsDisabled.length === 0) {
    console.log('PASS: All tables have RLS enabled')
  } else {
    for (const t of rlsDisabled) {
      console.log(`FAIL: ${t.table_name} — RLS disabled`)
      violations++
    }
  }
  results.push({ check: 'rls_enabled', failures: rlsDisabled.length })

  // CHECK 2: Unknown tables (not in any category)
  console.log('\n=== CHECK 2: Table Categorization ===')
  const knownTables = new Set([
    ...Object.keys(GLOBAL_TABLES),
    ...Object.keys(FK_CHAIN_TABLES),
  ])
  const orgIdTables = new Set(allTables.filter(t => t.has_org_id).map(t => t.table_name))
  // Tables with org_id are also known
  for (const name of orgIdTables) knownTables.add(name)

  const unknownTables = allTables.filter(t => !knownTables.has(t.table_name))
  if (unknownTables.length === 0) {
    console.log('PASS: All tables are categorized')
  } else {
    for (const t of unknownTables) {
      console.log(`FAIL: ${t.table_name} — not in GLOBAL_TABLES, FK_CHAIN_TABLES, or has org_id`)
      violations++
    }
  }
  results.push({ check: 'table_categorization', failures: unknownTables.length })

  // CHECK 3: Nullable org_id (grandfathered list)
  console.log('\n=== CHECK 3: org_id NOT NULL ===')
  const GRANDFATHERED_NULLABLE = new Set([
    'ai_column_library', 'coverage_settings', 'investment_case_templates',
    'model_templates', 'rating_scales', 'research_fields',
  ])
  const nullableOrgId = allTables.filter(
    t => t.has_org_id && t.org_id_nullable === 'YES' && !GRANDFATHERED_NULLABLE.has(t.table_name)
  )
  if (nullableOrgId.length === 0) {
    console.log('PASS: No new nullable org_id columns')
  } else {
    for (const t of nullableOrgId) {
      console.log(`FAIL: ${t.table_name} — organization_id is nullable (not grandfathered)`)
      violations++
    }
  }
  results.push({ check: 'org_id_not_null', failures: nullableOrgId.length })

  // CHECK 4: Tables with org_id must have at least one RLS policy
  console.log('\n=== CHECK 4: org_id Tables Have Policies ===')
  const orgTablesNoPolicies = allTables.filter(
    t => t.has_org_id && t.policy_count === 0
  )
  if (orgTablesNoPolicies.length === 0) {
    console.log('PASS: All org_id tables have RLS policies')
  } else {
    for (const t of orgTablesNoPolicies) {
      console.log(`FAIL: ${t.table_name} — has org_id but zero RLS policies`)
      violations++
    }
  }
  results.push({ check: 'org_tables_have_policies', failures: orgTablesNoPolicies.length })

  // CHECK 5: FK-chain tables must have RLS policies
  console.log('\n=== CHECK 5: FK-Chain Tables Have Policies ===')
  const fkChainNoPolicies = allTables.filter(
    t => FK_CHAIN_TABLES[t.table_name] && t.policy_count === 0
  )
  if (fkChainNoPolicies.length === 0) {
    console.log('PASS: All FK-chain tables have RLS policies')
  } else {
    for (const t of fkChainNoPolicies) {
      console.log(`FAIL: ${t.table_name} — FK-chain table with zero policies`)
      violations++
    }
  }
  results.push({ check: 'fk_chain_have_policies', failures: fkChainNoPolicies.length })

  // Summary
  console.log('\n=== SUMMARY ===')
  console.log(`Tables scanned: ${allTables.length}`)
  console.log(`  - With org_id: ${orgIdTables.size}`)
  console.log(`  - Global/user-personal: ${Object.keys(GLOBAL_TABLES).length}`)
  console.log(`  - FK-chain scoped: ${Object.keys(FK_CHAIN_TABLES).length}`)
  for (const r of results) {
    const icon = r.failures === 0 ? 'PASS' : 'FAIL'
    console.log(`  ${icon}: ${r.check} (${r.failures} violations)`)
  }

  if (violations > 0) {
    console.log(`\nTOTAL VIOLATIONS: ${violations}`)
    process.exit(1)
  } else {
    console.log('\nAll checks passed.')
    process.exit(0)
  }
}

/**
 * Fetches table metadata using Supabase's built-in RPC.
 * Falls back to a simplified approach if the custom RPC doesn't exist.
 */
async function fetchTablesViaRawQuery() {
  // Use the pg_catalog approach via a known-safe query pattern
  // We query the information_schema + pg_class data we need
  const query = `
    SELECT
      c.relname AS table_name,
      c.relrowsecurity AS rls_enabled,
      EXISTS (
        SELECT 1 FROM information_schema.columns col
        WHERE col.table_schema = 'public'
          AND col.table_name = c.relname
          AND col.column_name = 'organization_id'
      ) AS has_org_id,
      (SELECT col.is_nullable FROM information_schema.columns col
       WHERE col.table_schema = 'public'
         AND col.table_name = c.relname
         AND col.column_name = 'organization_id') AS org_id_nullable,
      (SELECT count(*)::int FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  `

  // Use the Supabase SQL endpoint via rpc or direct fetch
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
    },
    body: JSON.stringify({ query }),
  })

  if (res.ok) {
    return await res.json()
  }

  // If exec_sql doesn't exist, try a pg_net or direct approach
  // Last resort: hardcoded fetch from pg tables
  console.error('ERROR: Cannot query table metadata. Ensure SUPABASE_SERVICE_KEY is set.')
  console.error('You can also create the helper RPC: see scripts/tenant-boundary-lint.sql')
  process.exit(2)
}

run().catch((err) => {
  console.error('Linter crashed:', err)
  process.exit(2)
})
