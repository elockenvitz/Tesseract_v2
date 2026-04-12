/**
 * Holdings API — REST endpoint for programmatic holdings upload.
 *
 * Client IT teams or custodians call this endpoint with a Bearer API key
 * to push daily holdings data.
 *
 * Endpoints:
 *   POST /holdings-api/upload
 *     Headers: Authorization: Bearer hk_xxxxxxxx
 *     Body: {
 *       portfolio_id: "uuid" (optional — uses first active portfolio if omitted),
 *       snapshot_date: "2026-04-08" (optional — defaults to today),
 *       positions: [
 *         { symbol: "AAPL", shares: 1000, price: 180.50, market_value: 180500 },
 *         { symbol: "MSFT", shares: 500 }
 *       ]
 *     }
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://tesseract.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Simple SHA-256 hash for API key verification
async function hashKey(key: string): Promise<string> {
  const encoder = new TextEncoder()
  const data = encoder.encode(key)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  const hashArray = Array.from(new Uint8Array(hashBuffer))
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    // 1. Authenticate via API key
    const authHeader = req.headers.get('authorization') || ''
    const apiKey = authHeader.replace(/^Bearer\s+/i, '').trim()

    if (!apiKey || !apiKey.startsWith('hk_')) {
      return new Response(JSON.stringify({ error: 'Invalid API key format. Expected: Bearer hk_...' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const keyHash = await hashKey(apiKey)
    const { data: keyRecord, error: keyErr } = await supabase
      .from('holdings_api_keys')
      .select('id, organization_id, permissions, expires_at, is_active')
      .eq('key_hash', keyHash)
      .eq('is_active', true)
      .single()

    if (keyErr || !keyRecord) {
      return new Response(JSON.stringify({ error: 'Invalid or expired API key' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: 'API key has expired' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Update last_used_at
    await supabase.from('holdings_api_keys')
      .update({ last_used_at: new Date().toISOString() })
      .eq('id', keyRecord.id)

    // 2. Parse request body
    const body = await req.json()
    const { portfolio_id, snapshot_date, positions } = body

    if (!positions || !Array.isArray(positions) || positions.length === 0) {
      return new Response(JSON.stringify({ error: 'positions array is required and must not be empty' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 3. Resolve portfolio
    let portfolioId = portfolio_id
    if (!portfolioId) {
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id')
        .eq('organization_id', keyRecord.organization_id)
        .eq('is_active', true)
        .limit(1)
      portfolioId = portfolios?.[0]?.id
    }

    if (!portfolioId) {
      return new Response(JSON.stringify({ error: 'No portfolio found. Provide portfolio_id or create a portfolio first.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify portfolio belongs to the org
    const { data: portfolio } = await supabase
      .from('portfolios')
      .select('id, organization_id')
      .eq('id', portfolioId)
      .single()

    if (!portfolio || portfolio.organization_id !== keyRecord.organization_id) {
      return new Response(JSON.stringify({ error: 'Portfolio not found or does not belong to your organization' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 4. Validate positions
    const warnings: string[] = []
    const validPositions: any[] = []

    for (let i = 0; i < positions.length; i++) {
      const p = positions[i]
      if (!p.symbol || typeof p.symbol !== 'string') {
        warnings.push(`Position ${i}: missing or invalid symbol, skipped`)
        continue
      }
      if (p.shares === undefined || p.shares === null || isNaN(Number(p.shares))) {
        warnings.push(`Position ${i} (${p.symbol}): missing or invalid shares, skipped`)
        continue
      }
      validPositions.push({
        symbol: p.symbol.toUpperCase().trim(),
        shares: Number(p.shares),
        price: p.price != null ? Number(p.price) : null,
        market_value: p.market_value != null ? Number(p.market_value) : null,
        cost_basis: p.cost_basis != null ? Number(p.cost_basis) : null,
        weight_pct: p.weight_pct != null ? Number(p.weight_pct) : null,
        sector: p.sector || null,
        asset_class: p.asset_class || null,
      })
    }

    if (validPositions.length === 0) {
      return new Response(JSON.stringify({ error: 'No valid positions in payload', warnings }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 5. Resolve symbols against assets table
    const symbols = validPositions.map((p: any) => p.symbol)
    const { data: assets } = await supabase.from('assets').select('id, symbol').in('symbol', symbols)
    const assetMap = new Map((assets || []).map((a: any) => [a.symbol, a.id]))

    const unresolvedSymbols = symbols.filter(s => !assetMap.has(s))
    if (unresolvedSymbols.length > 0) {
      warnings.push(`Unresolved symbols: ${unresolvedSymbols.join(', ')}`)
    }

    // 6. Create snapshot
    const date = snapshot_date || new Date().toISOString().split('T')[0]
    const totalMarketValue = validPositions.reduce((s: number, p: any) => s + (p.market_value || 0), 0)

    const { data: snapshot, error: snapErr } = await supabase
      .from('portfolio_holdings_snapshots')
      .upsert({
        portfolio_id: portfolioId,
        organization_id: keyRecord.organization_id,
        snapshot_date: date,
        source: 'api_sync',
        total_market_value: totalMarketValue || null,
        total_positions: validPositions.length,
      }, { onConflict: 'portfolio_id,snapshot_date' })
      .select('id')
      .single()

    if (snapErr) {
      return new Response(JSON.stringify({ error: `Snapshot creation failed: ${snapErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 7. Replace positions for this snapshot
    await supabase.from('portfolio_holdings_positions').delete().eq('snapshot_id', snapshot.id)

    const positionRows = validPositions.map((p: any) => ({
      snapshot_id: snapshot.id,
      portfolio_id: portfolioId,
      organization_id: keyRecord.organization_id,
      asset_id: assetMap.get(p.symbol) || null,
      symbol: p.symbol,
      shares: p.shares,
      price: p.price,
      market_value: p.market_value,
      cost_basis: p.cost_basis,
      weight_pct: p.weight_pct,
      sector: p.sector,
      asset_class: p.asset_class,
    }))

    const { error: posErr } = await supabase.from('portfolio_holdings_positions').insert(positionRows)

    if (posErr) {
      return new Response(JSON.stringify({ error: `Position insert failed: ${posErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 8. Log the upload
    await supabase.from('holdings_upload_log').insert({
      organization_id: keyRecord.organization_id,
      portfolio_id: portfolioId,
      snapshot_id: snapshot.id,
      filename: `api_upload_${date}`,
      snapshot_date: date,
      positions_count: validPositions.length,
      warnings,
      status: warnings.length > 0 ? 'partial' : 'success',
      uploaded_by: keyRecord.created_by || keyRecord.id, // API key creator
    }).catch(() => {}) // Non-blocking

    return new Response(JSON.stringify({
      success: true,
      snapshot_id: snapshot.id,
      snapshot_date: date,
      positions_count: validPositions.length,
      warnings,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
