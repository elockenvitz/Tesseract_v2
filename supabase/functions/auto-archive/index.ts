/**
 * Auto-Archive Edge Function
 *
 * Archives items that have been in trash for longer than the retention period.
 * Designed to be run as a scheduled cron job (daily at 3 AM UTC recommended).
 *
 * Endpoints:
 * - POST /auto-archive - Run the auto-archive job
 * - GET /auto-archive/status - Get current trash counts
 *
 * Configuration:
 * - Default retention: 30 days
 * - Batch size: 100 items per run
 *
 * Schedule with:
 * supabase functions schedule auto-archive --cron "0 3 * * *"
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// ============================================================================
// CORS Headers
// ============================================================================

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// Types
// ============================================================================

interface ArchiveResult {
  tradeIdeasArchived: number
  tradePlansArchived: number
  errors: string[]
  processedAt: string
}

interface TrashStatus {
  tradeIdeasInTrash: number
  tradePlansInTrash: number
  oldestTradeIdea: string | null
  oldestTradePlan: string | null
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_RETENTION_DAYS = 30
const DEFAULT_BATCH_SIZE = 100

// System actor for audit events
const SYSTEM_ACTOR = {
  id: '00000000-0000-0000-0000-000000000001',
  type: 'system',
  role: 'system',
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const url = new URL(req.url)
    const path = url.pathname.replace('/auto-archive', '')

    // Route handling
    if (path === '/status' && req.method === 'GET') {
      const status = await getTrashStatus(supabase)
      return new Response(JSON.stringify(status), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (req.method === 'POST' || req.method === 'GET') {
      // Parse configuration from request body or query params
      let retentionDays = DEFAULT_RETENTION_DAYS
      let batchSize = DEFAULT_BATCH_SIZE

      if (req.method === 'POST') {
        try {
          const body = await req.json()
          retentionDays = body.retention_days ?? DEFAULT_RETENTION_DAYS
          batchSize = body.batch_size ?? DEFAULT_BATCH_SIZE
        } catch {
          // Use defaults if body parsing fails
        }
      } else {
        retentionDays = parseInt(url.searchParams.get('retention_days') || '') || DEFAULT_RETENTION_DAYS
        batchSize = parseInt(url.searchParams.get('batch_size') || '') || DEFAULT_BATCH_SIZE
      }

      const result = await runAutoArchive(supabase, retentionDays, batchSize)

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    console.error('Auto-archive error:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
        processedAt: new Date().toISOString(),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    )
  }
})

// ============================================================================
// Auto-Archive Logic
// ============================================================================

async function runAutoArchive(
  supabase: ReturnType<typeof createClient>,
  retentionDays: number,
  batchSize: number
): Promise<ArchiveResult> {
  const result: ArchiveResult = {
    tradeIdeasArchived: 0,
    tradePlansArchived: 0,
    errors: [],
    processedAt: new Date().toISOString(),
  }

  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - retentionDays)
  const cutoffIso = cutoffDate.toISOString()

  const batchId = crypto.randomUUID()

  // Archive trade ideas
  try {
    const tradeIdeaCount = await archiveTradeIdeas(
      supabase,
      cutoffIso,
      batchSize,
      batchId,
      retentionDays
    )
    result.tradeIdeasArchived = tradeIdeaCount
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(`Trade ideas: ${message}`)
    console.error('Failed to archive trade ideas:', error)
  }

  // Archive trade plans
  try {
    const tradePlanCount = await archiveTradePlans(
      supabase,
      cutoffIso,
      batchSize,
      batchId,
      retentionDays
    )
    result.tradePlansArchived = tradePlanCount
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    result.errors.push(`Trade plans: ${message}`)
    console.error('Failed to archive trade plans:', error)
  }

  console.log(
    `[AutoArchive] Completed: ${result.tradeIdeasArchived} ideas, ${result.tradePlansArchived} plans archived`
  )

  return result
}

async function archiveTradeIdeas(
  supabase: ReturnType<typeof createClient>,
  cutoffIso: string,
  batchSize: number,
  batchId: string,
  retentionDays: number
): Promise<number> {
  // Find trade ideas to archive
  const { data: items, error: findError } = await supabase
    .from('trade_queue_items')
    .select('id, stage, outcome, action, asset_id, portfolio_id, deleted_at')
    .eq('visibility_tier', 'trash')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoffIso)
    .limit(batchSize)

  if (findError) {
    throw new Error(`Failed to find trade ideas: ${findError.message}`)
  }

  if (!items || items.length === 0) {
    return 0
  }

  const now = new Date().toISOString()

  // Update to archive
  const { error: updateError } = await supabase
    .from('trade_queue_items')
    .update({
      visibility_tier: 'archive',
      archived_at: now,
      updated_at: now,
    })
    .in(
      'id',
      items.map((t) => t.id)
    )

  if (updateError) {
    throw new Error(`Failed to update trade ideas: ${updateError.message}`)
  }

  // Emit audit events
  for (const item of items) {
    await supabase.from('audit_events').insert({
      occurred_at: now,
      actor_id: SYSTEM_ACTOR.id,
      actor_type: SYSTEM_ACTOR.type,
      actor_role: SYSTEM_ACTOR.role,
      entity_type: 'trade_idea',
      entity_id: item.id,
      entity_display_name: `${item.action.toUpperCase()} trade`,
      action_type: 'auto_archive',
      action_category: 'system',
      from_state: {
        stage: item.stage,
        outcome: item.outcome,
        visibility_tier: 'trash',
      },
      to_state: {
        stage: item.stage,
        outcome: item.outcome,
        visibility_tier: 'archive',
      },
      changed_fields: ['visibility_tier', 'archived_at'],
      metadata: {
        batch_id: batchId,
        reason: `Auto-archived after ${retentionDays} days in trash`,
        deleted_at: item.deleted_at,
        portfolio_id: item.portfolio_id,
      },
      org_id: 'default-org',
    })
  }

  return items.length
}

async function archiveTradePlans(
  supabase: ReturnType<typeof createClient>,
  cutoffIso: string,
  batchSize: number,
  batchId: string,
  retentionDays: number
): Promise<number> {
  // Find trade plans to archive
  const { data: items, error: findError } = await supabase
    .from('trade_plans')
    .select('id, name, status, portfolio_id, deleted_at')
    .eq('visibility_tier', 'trash')
    .not('deleted_at', 'is', null)
    .lt('deleted_at', cutoffIso)
    .limit(batchSize)

  if (findError) {
    throw new Error(`Failed to find trade plans: ${findError.message}`)
  }

  if (!items || items.length === 0) {
    return 0
  }

  const now = new Date().toISOString()

  // Update to archive
  const { error: updateError } = await supabase
    .from('trade_plans')
    .update({
      visibility_tier: 'archive',
      archived_at: now,
      updated_at: now,
    })
    .in(
      'id',
      items.map((p) => p.id)
    )

  if (updateError) {
    throw new Error(`Failed to update trade plans: ${updateError.message}`)
  }

  // Emit audit events
  for (const item of items) {
    await supabase.from('audit_events').insert({
      occurred_at: now,
      actor_id: SYSTEM_ACTOR.id,
      actor_type: SYSTEM_ACTOR.type,
      actor_role: SYSTEM_ACTOR.role,
      entity_type: 'trade_plan',
      entity_id: item.id,
      entity_display_name: item.name,
      action_type: 'auto_archive',
      action_category: 'system',
      from_state: {
        status: item.status,
        visibility_tier: 'trash',
      },
      to_state: {
        status: item.status,
        visibility_tier: 'archive',
      },
      changed_fields: ['visibility_tier', 'archived_at'],
      metadata: {
        batch_id: batchId,
        reason: `Auto-archived after ${retentionDays} days in trash`,
        deleted_at: item.deleted_at,
        portfolio_id: item.portfolio_id,
      },
      org_id: 'default-org',
    })
  }

  return items.length
}

// ============================================================================
// Status Helper
// ============================================================================

async function getTrashStatus(
  supabase: ReturnType<typeof createClient>
): Promise<TrashStatus> {
  // Get trade ideas in trash
  const { data: tradeIdeas, error: ideaError } = await supabase
    .from('trade_queue_items')
    .select('id, deleted_at')
    .eq('visibility_tier', 'trash')
    .order('deleted_at', { ascending: true })
    .limit(1000)

  if (ideaError) {
    throw new Error(`Failed to get trade ideas: ${ideaError.message}`)
  }

  // Get trade plans in trash
  const { data: tradePlans, error: planError } = await supabase
    .from('trade_plans')
    .select('id, deleted_at')
    .eq('visibility_tier', 'trash')
    .order('deleted_at', { ascending: true })
    .limit(1000)

  if (planError) {
    throw new Error(`Failed to get trade plans: ${planError.message}`)
  }

  return {
    tradeIdeasInTrash: tradeIdeas?.length || 0,
    tradePlansInTrash: tradePlans?.length || 0,
    oldestTradeIdea: tradeIdeas?.[0]?.deleted_at || null,
    oldestTradePlan: tradePlans?.[0]?.deleted_at || null,
  }
}
