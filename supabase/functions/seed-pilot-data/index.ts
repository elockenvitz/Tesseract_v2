/**
 * seed-pilot-data — Creates demo users and sample content for pilot clients.
 *
 * Called after ClientOnboardingWizard completes. Creates two demo users
 * (Emily Thompson as PM, David Mitchell as Analyst) with realistic trade
 * workflow content so the pilot user sees a populated platform.
 *
 * Endpoints:
 * - POST /seed-pilot-data          — Seed demo users + sample content
 * - DELETE /seed-pilot-data        — Remove all demo data for an org
 *
 * Input (POST): { organization_id, portfolio_id }
 * Input (DELETE): { organization_id }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// CORS
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://tesseract.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Demo User Definitions
// ============================================================================

const DEMO_PM = {
  name: 'Emily Thompson',
  email_prefix: 'demo-pm',
  role: 'pm' as const,
}

const DEMO_ANALYST = {
  name: 'David Mitchell',
  email_prefix: 'demo-analyst',
  role: 'analyst' as const,
}

// ============================================================================
// Sample Content — Trade ideas seeded per portfolio template
// ============================================================================

// We pick from well-known tickers that appear in all templates.
// The seed function resolves these against the assets table at runtime.
const SAMPLE_TRADE_IDEAS = [
  // PM ideas (Emily) — mix of stages
  {
    authorRole: 'pm' as const,
    symbol: 'NVDA',
    action: 'add',
    stage: 'idea',
    rationale: 'AI infrastructure spend continues to accelerate. Data center revenue beat estimates by 18% last quarter. Adding to existing position ahead of next earnings cycle.',
    urgency: 'medium',
  },
  {
    authorRole: 'pm' as const,
    symbol: 'AAPL',
    action: 'trim',
    stage: 'discussing',
    rationale: 'iPhone cycle peaking and services growth decelerating. Valuation stretched at 32x forward — trimming to fund higher-conviction names.',
    urgency: 'low',
  },
  {
    authorRole: 'pm' as const,
    symbol: 'MSFT',
    action: 'add',
    stage: 'deep_research',
    rationale: 'Azure growth re-accelerating with AI workloads. Copilot monetization starting to show in enterprise segment. Increasing weight to reflect durable cloud tailwind.',
    urgency: 'medium',
  },
  // Analyst ideas (David) — proposals flowing up to PM
  {
    authorRole: 'analyst' as const,
    symbol: 'AMZN',
    action: 'buy',
    stage: 'idea',
    rationale: 'AWS margin expansion story underappreciated. Retail profitability inflecting. Sum-of-parts analysis suggests 20% upside from current levels.',
    urgency: 'medium',
  },
  {
    authorRole: 'analyst' as const,
    symbol: 'META',
    action: 'add',
    stage: 'discussing',
    rationale: 'Reels monetization gap closing faster than consensus expects. Cost discipline holding. Engagement metrics across family of apps at all-time highs.',
    urgency: 'low',
  },
]

// Simulation variant (PM sizes a trade in the lab)
const SAMPLE_VARIANT = {
  authorRole: 'pm' as const,
  symbol: 'NVDA',
  action: 'add' as const,
  sizing_input: '+0.5',
}

// Decision request (analyst asks PM to review)
const SAMPLE_DECISION_REQUEST = {
  // References the AMZN trade idea (index 3 in SAMPLE_TRADE_IDEAS)
  tradeIdeaIndex: 3,
  urgency: 'medium',
  context_note: 'AWS re-acceleration thesis is well-supported by channel checks. Recommend initiating at 2% weight.',
}

// Accepted trade (PM committed one)
const SAMPLE_ACCEPTED_TRADE = {
  symbol: 'MSFT',
  action: 'add',
  sizing_input: '+0.5',
  acceptance_note: 'Adding 50bps on Azure re-acceleration thesis. Will revisit after Q2 earnings.',
  source: 'trade_lab',
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  try {
    if (req.method === 'POST') {
      return await handleSeed(req, admin)
    } else if (req.method === 'DELETE') {
      return await handleCleanup(req, admin)
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    console.error('seed-pilot-data error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ============================================================================
// Seed Handler
// ============================================================================

async function handleSeed(req: Request, admin: ReturnType<typeof createClient>) {
  const { organization_id, portfolio_id } = await req.json()

  if (!organization_id || !portfolio_id) {
    return new Response(JSON.stringify({ error: 'organization_id and portfolio_id required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Check if demo users already exist for this org
  const { data: existingMembers } = await admin
    .from('organization_memberships')
    .select('user_id')
    .eq('organization_id', organization_id)

  const existingIds = (existingMembers || []).map((m: { user_id: string }) => m.user_id)

  // Check if any existing members are demo users
  if (existingIds.length > 0) {
    const { data: existingDemoUsers } = await admin.auth.admin.listUsers()
    const demoUsersAlready = existingDemoUsers?.users?.filter(
      u => u.app_metadata?.is_demo_user && existingIds.includes(u.id)
    )
    if (demoUsersAlready && demoUsersAlready.length > 0) {
      return new Response(JSON.stringify({
        error: 'Demo users already exist for this organization',
        demo_user_ids: demoUsersAlready.map(u => u.id),
      }), {
        status: 409,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  const orgShort = organization_id.slice(0, 8)

  // ── 1. Create demo auth users ─────────────────────────────────

  const pmUser = await admin.auth.admin.createUser({
    email: `${DEMO_PM.email_prefix}-${orgShort}@demo.tesseract.app`,
    email_confirm: true,
    user_metadata: {
      full_name: DEMO_PM.name,
      is_demo_user: true,
      demo_org_id: organization_id,
    },
    app_metadata: {
      is_demo_user: true,
      demo_org_id: organization_id,
      demo_role: 'pm',
    },
  })

  if (pmUser.error) throw new Error(`Failed to create PM user: ${pmUser.error.message}`)
  const pmId = pmUser.data.user.id

  const analystUser = await admin.auth.admin.createUser({
    email: `${DEMO_ANALYST.email_prefix}-${orgShort}@demo.tesseract.app`,
    email_confirm: true,
    user_metadata: {
      full_name: DEMO_ANALYST.name,
      is_demo_user: true,
      demo_org_id: organization_id,
    },
    app_metadata: {
      is_demo_user: true,
      demo_org_id: organization_id,
      demo_role: 'analyst',
    },
  })

  if (analystUser.error) throw new Error(`Failed to create Analyst user: ${analystUser.error.message}`)
  const analystId = analystUser.data.user.id

  // ── 2. Set current_organization_id on users table ─────────────

  await admin.from('users').update({ current_organization_id: organization_id }).eq('id', pmId)
  await admin.from('users').update({ current_organization_id: organization_id }).eq('id', analystId)

  // ── 3. Add to organization_memberships ────────────────────────

  await admin.from('organization_memberships').insert([
    {
      organization_id,
      user_id: pmId,
      role: 'pm',
      status: 'active',
      is_org_admin: false,
    },
    {
      organization_id,
      user_id: analystId,
      role: 'analyst',
      status: 'active',
      is_org_admin: false,
    },
  ])

  // ── 4. Add to portfolio_team ──────────────────────────────────

  await admin.from('portfolio_team').insert([
    { portfolio_id, user_id: pmId, role: 'pm' },
    { portfolio_id, user_id: analystId, role: 'analyst' },
  ])

  // ── 5. Set user_capabilities ──────────────────────────────────

  await admin.from('user_capabilities').insert([
    {
      user_id: pmId,
      portfolio_id,
      can_create_trade_ideas: true,
      can_move_trade_ideas: true,
      can_delete_trade_ideas: true,
      can_restore_trade_ideas: true,
      can_create_shared_views: true,
      can_manage_portfolio_working_set: true,
      can_create_trade_plans: true,
      can_send_to_desk: true,
      can_approve_trade_plans: true,
      can_view_archived_activity: true,
      can_export_activity: true,
      is_portfolio_admin: true,
      is_org_admin: false,
    },
    {
      user_id: analystId,
      portfolio_id,
      can_create_trade_ideas: true,
      can_move_trade_ideas: true,
      can_delete_trade_ideas: false,
      can_restore_trade_ideas: false,
      can_create_shared_views: true,
      can_manage_portfolio_working_set: false,
      can_create_trade_plans: true,
      can_send_to_desk: false,
      can_approve_trade_plans: false,
      can_view_archived_activity: false,
      can_export_activity: false,
      is_portfolio_admin: false,
      is_org_admin: false,
    },
  ])

  // ── 6. Resolve asset IDs from symbols ─────────────────────────

  const allSymbols = [
    ...SAMPLE_TRADE_IDEAS.map(t => t.symbol),
    SAMPLE_VARIANT.symbol,
    SAMPLE_ACCEPTED_TRADE.symbol,
  ]
  const uniqueSymbols = [...new Set(allSymbols)]

  const { data: assets } = await admin
    .from('assets')
    .select('id, symbol')
    .in('symbol', uniqueSymbols)

  const assetMap = new Map<string, string>((assets || []).map((a: { id: string; symbol: string }) => [a.symbol, a.id]))

  // Skip content seeding for symbols not in the assets table
  const resolvedTradeIdeas = SAMPLE_TRADE_IDEAS.filter(t => assetMap.has(t.symbol))

  // ── 7. Seed trade ideas (trade_queue_items) ───────────────────

  const tradeIdeaRows = resolvedTradeIdeas.map(idea => ({
    portfolio_id,
    asset_id: assetMap.get(idea.symbol)!,
    action: idea.action,
    stage: idea.stage,
    status: 'idea',
    rationale: idea.rationale,
    thesis_text: idea.rationale,
    urgency: idea.urgency,
    created_by: idea.authorRole === 'pm' ? pmId : analystId,
    sharing_visibility: 'portfolio',
    visibility_tier: 'active',
    origin_type: 'manual',
  }))

  const { data: insertedIdeas, error: ideasErr } = await admin
    .from('trade_queue_items')
    .insert(tradeIdeaRows)
    .select('id, asset_id, action, created_by')

  if (ideasErr) throw new Error(`Failed to seed trade ideas: ${ideasErr.message}`)

  // ── 8. Seed trade lab + variant ───────────────────────────────

  // trade_labs has a 1:1 relationship with portfolios — check if one exists
  let labId: string

  const { data: existingLab } = await admin
    .from('trade_labs')
    .select('id')
    .eq('portfolio_id', portfolio_id)
    .maybeSingle()

  if (existingLab) {
    labId = existingLab.id
  } else {
    const { data: newLab, error: labErr } = await admin
      .from('trade_labs')
      .insert({
        portfolio_id,
        name: 'Trade Lab',
        created_by: pmId,
      })
      .select('id')
      .single()

    if (labErr) throw new Error(`Failed to create trade lab: ${labErr.message}`)
    labId = newLab.id
  }

  // Create a variant if the symbol resolved
  let variantId: string | null = null
  if (assetMap.has(SAMPLE_VARIANT.symbol)) {
    const variantAssetId = assetMap.get(SAMPLE_VARIANT.symbol)!

    // Find the matching trade idea for linking
    const matchingIdea = insertedIdeas?.find(
      (i: { asset_id: string }) => i.asset_id === variantAssetId
    )

    const { data: variant, error: varErr } = await admin
      .from('lab_variants')
      .insert({
        lab_id: labId,
        asset_id: variantAssetId,
        portfolio_id,
        action: SAMPLE_VARIANT.action,
        sizing_input: SAMPLE_VARIANT.sizing_input,
        sizing_spec: {
          framework: 'weight_delta',
          raw_input: SAMPLE_VARIANT.sizing_input,
          value: 0.5,
          unit: 'weight',
          mode: 'delta',
        },
        trade_queue_item_id: matchingIdea?.id || null,
        created_by: pmId,
        visibility_tier: 'active',
      })
      .select('id')
      .single()

    if (varErr) throw new Error(`Failed to create lab variant: ${varErr.message}`)
    variantId = variant.id

    // Also create matching simulation_trade
    await admin.from('simulation_trades').insert({
      simulation_id: labId,
      asset_id: variantAssetId,
      portfolio_id,
      action: SAMPLE_VARIANT.action,
      created_by: pmId,
    })
  }

  // ── 9. Seed decision request ──────────────────────────────────

  let decisionRequestId: string | null = null
  const drIdea = resolvedTradeIdeas[SAMPLE_DECISION_REQUEST.tradeIdeaIndex]
  const drTradeItem = insertedIdeas?.find(
    (i: { asset_id: string; created_by: string }) =>
      i.asset_id === assetMap.get(drIdea?.symbol) && i.created_by === analystId
  )

  if (drTradeItem) {
    const { data: dr, error: drErr } = await admin
      .from('decision_requests')
      .insert({
        trade_queue_item_id: drTradeItem.id,
        portfolio_id,
        requested_by: analystId,
        urgency: SAMPLE_DECISION_REQUEST.urgency,
        context_note: SAMPLE_DECISION_REQUEST.context_note,
        status: 'pending',
      })
      .select('id')
      .single()

    if (drErr) throw new Error(`Failed to create decision request: ${drErr.message}`)
    decisionRequestId = dr.id
  }

  // ── 10. Seed accepted trade ───────────────────────────────────

  let acceptedTradeId: string | null = null
  if (assetMap.has(SAMPLE_ACCEPTED_TRADE.symbol)) {
    const atAssetId = assetMap.get(SAMPLE_ACCEPTED_TRADE.symbol)!
    const matchingIdea = insertedIdeas?.find(
      (i: { asset_id: string; created_by: string }) =>
        i.asset_id === atAssetId && i.created_by === pmId
    )

    const { data: at, error: atErr } = await admin
      .from('accepted_trades')
      .insert({
        portfolio_id,
        asset_id: atAssetId,
        action: SAMPLE_ACCEPTED_TRADE.action,
        sizing_input: SAMPLE_ACCEPTED_TRADE.sizing_input,
        sizing_spec: {
          framework: 'weight_delta',
          raw_input: SAMPLE_ACCEPTED_TRADE.sizing_input,
          value: 0.5,
          unit: 'weight',
          mode: 'delta',
        },
        source: SAMPLE_ACCEPTED_TRADE.source,
        acceptance_note: SAMPLE_ACCEPTED_TRADE.acceptance_note,
        accepted_by: pmId,
        trade_queue_item_id: matchingIdea?.id || null,
        lab_variant_id: variantId,
        execution_status: 'not_started',
        reconciliation_status: 'pending',
        is_active: true,
      })
      .select('id')
      .single()

    if (atErr) throw new Error(`Failed to create accepted trade: ${atErr.message}`)
    acceptedTradeId = at.id
  }

  // ── Done ──────────────────────────────────────────────────────

  return new Response(JSON.stringify({
    success: true,
    demo_users: {
      pm: { id: pmId, name: DEMO_PM.name },
      analyst: { id: analystId, name: DEMO_ANALYST.name },
    },
    seeded: {
      trade_ideas: insertedIdeas?.length || 0,
      lab_variant: variantId ? 1 : 0,
      decision_requests: decisionRequestId ? 1 : 0,
      accepted_trades: acceptedTradeId ? 1 : 0,
    },
    processedAt: new Date().toISOString(),
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ============================================================================
// Cleanup Handler — Remove all demo data for an org
// ============================================================================

async function handleCleanup(req: Request, admin: ReturnType<typeof createClient>) {
  const { organization_id } = await req.json()

  if (!organization_id) {
    return new Response(JSON.stringify({ error: 'organization_id required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // Find demo users for this org via app_metadata
  const { data: allUsers } = await admin.auth.admin.listUsers()
  const demoUsers = allUsers?.users?.filter(
    u => u.app_metadata?.is_demo_user && u.app_metadata?.demo_org_id === organization_id
  ) || []

  if (demoUsers.length === 0) {
    return new Response(JSON.stringify({ success: true, removed: 0 }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const demoUserIds = demoUsers.map(u => u.id)

  // Delete in dependency order (most dependent first)
  // accepted_trade_comments, decision_requests, accepted_trades,
  // lab_variants, simulation_trades, trade_queue_items,
  // user_capabilities, portfolio_team, organization_memberships

  await admin.from('accepted_trade_comments').delete().in('created_by', demoUserIds)
  await admin.from('decision_requests').delete().in('requested_by', demoUserIds)
  await admin.from('accepted_trades').delete().in('accepted_by', demoUserIds)
  await admin.from('lab_variants').delete().in('created_by', demoUserIds)
  await admin.from('simulation_trades').delete().in('created_by', demoUserIds)
  await admin.from('trade_queue_items').delete().in('created_by', demoUserIds)
  await admin.from('user_capabilities').delete().in('user_id', demoUserIds)
  await admin.from('portfolio_team').delete().in('user_id', demoUserIds)
  await admin.from('organization_memberships').delete().in('user_id', demoUserIds)

  // Delete auth users
  for (const userId of demoUserIds) {
    await admin.auth.admin.deleteUser(userId)
  }

  return new Response(JSON.stringify({
    success: true,
    removed: demoUsers.length,
    removed_user_ids: demoUserIds,
    processedAt: new Date().toISOString(),
  }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
