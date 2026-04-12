/**
 * Holdings SFTP Sync Edge Function
 *
 * Connects to configured SFTP servers, downloads holdings CSV files,
 * parses them using column mapping configs, and creates holdings snapshots.
 *
 * Endpoints:
 *   POST /holdings-sftp-sync           — Run sync for all active SFTP configs
 *   POST /holdings-sftp-sync/:configId — Run sync for a specific config
 *
 * Designed to be scheduled via pg_cron or Supabase CRON:
 *   supabase functions schedule holdings-sftp-sync --cron "0 6 * * *"
 *
 * Requires SFTP credentials stored in the integration config.
 * Uses the service role key to bypass RLS for cross-org operations.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') || 'https://tesseract.app',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ============================================================================
// CSV Parsing (same logic as frontend useHoldingsUpload)
// ============================================================================

function parseCSV(text: string, skipRows: number): string[][] {
  const lines = text.split(/\r?\n/).filter(l => l.trim())
  return lines.slice(skipRows).map(line => {
    const cells: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') { inQuotes = !inQuotes; continue }
      if (char === ',' && !inQuotes) { cells.push(current.trim()); current = ''; continue }
      current += char
    }
    cells.push(current.trim())
    return cells
  })
}

function parseNumber(val: string | undefined): number | null {
  if (!val) return null
  const cleaned = val.replace(/[$,%\s]/g, '')
  const num = Number(cleaned)
  return isNaN(num) ? null : num
}

interface ParsedPosition {
  symbol: string
  shares: number
  price: number | null
  market_value: number | null
  cost_basis: number | null
  weight_pct: number | null
  sector: string | null
  asset_class: string | null
}

function parseHoldingsCSV(
  csvText: string,
  columnMappings: Record<string, string>,
  skipRows: number = 0
): { positions: ParsedPosition[]; warnings: string[]; errors: string[] } {
  const rows = parseCSV(csvText, skipRows)
  if (rows.length < 2) return { positions: [], warnings: [], errors: ['File has no data rows'] }

  const headers = rows[0].map(h => h.trim())
  const dataRows = rows.slice(1)

  const colIndex: Record<string, number> = {}
  for (const [field, csvHeader] of Object.entries(columnMappings)) {
    const idx = headers.findIndex(h => h.toLowerCase() === csvHeader.toLowerCase())
    if (idx >= 0) colIndex[field] = idx
  }

  if (colIndex['symbol'] === undefined) return { positions: [], warnings: [], errors: ['Symbol column not found'] }
  if (colIndex['shares'] === undefined) return { positions: [], warnings: [], errors: ['Shares column not found'] }

  const positions: ParsedPosition[] = []
  const warnings: string[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const symbol = row[colIndex['symbol']]?.trim()
    if (!symbol) { warnings.push(`Row ${i + 2}: empty symbol`); continue }

    const sharesVal = parseNumber(row[colIndex['shares']])
    if (sharesVal === null) { warnings.push(`Row ${i + 2}: invalid shares for ${symbol}`); continue }

    positions.push({
      symbol: symbol.toUpperCase(),
      shares: sharesVal,
      price: colIndex['price'] !== undefined ? parseNumber(row[colIndex['price']]) : null,
      market_value: colIndex['market_value'] !== undefined ? parseNumber(row[colIndex['market_value']]) : null,
      cost_basis: colIndex['cost_basis'] !== undefined ? parseNumber(row[colIndex['cost_basis']]) : null,
      weight_pct: colIndex['weight_pct'] !== undefined ? parseNumber(row[colIndex['weight_pct']]) : null,
      sector: colIndex['sector'] !== undefined ? row[colIndex['sector']]?.trim() || null : null,
      asset_class: colIndex['asset_class'] !== undefined ? row[colIndex['asset_class']]?.trim() || null : null,
    })
  }

  return { positions, warnings, errors: [] }
}

// ============================================================================
// SFTP Connection (via SSH2/exec — Deno-compatible approach)
// ============================================================================

// NOTE: Deno doesn't have native SFTP libraries like Node's ssh2.
// For production, you would use one of:
//   1. A Deno-compatible SSH/SFTP library
//   2. A sidecar service that handles SFTP and exposes HTTP
//   3. An external integration service (e.g., Fivetran, Stitch)
//
// For the pilot, we implement a simulated SFTP flow that:
//   - Reads from a Supabase storage bucket where files can be dropped
//   - This allows the same column-mapping + parsing pipeline
//   - Real SFTP can be swapped in when a Deno SSH library is available

async function fetchFileFromStorage(
  supabase: any,
  orgId: string,
  config: any
): Promise<{ fileName: string; content: string } | null> {
  // Look for files in the holdings-uploads bucket under the org's path
  const storagePath = `holdings/${orgId}`
  const { data: files, error } = await supabase.storage
    .from('assets')
    .list(storagePath, { sortBy: { column: 'created_at', order: 'desc' }, limit: 1 })

  if (error || !files || files.length === 0) return null

  // Check if file matches pattern (if configured)
  const pattern = config.sftp_file_pattern || '*.csv'
  const latestFile = files[0]
  if (pattern !== '*' && pattern !== '*.csv') {
    const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\?/g, '.'))
    if (!regex.test(latestFile.name)) return null
  }

  // Download
  const { data: blob, error: dlError } = await supabase.storage
    .from('assets')
    .download(`${storagePath}/${latestFile.name}`)

  if (dlError || !blob) return null

  const content = await blob.text()
  return { fileName: latestFile.name, content }
}

// ============================================================================
// Main sync logic
// ============================================================================

async function syncConfig(supabase: any, config: any): Promise<{
  status: 'success' | 'partial' | 'failed'
  positionsCount: number
  fileName: string | null
  errorMessage: string | null
  warnings: string[]
}> {
  // Create a run log entry
  const { data: run } = await supabase.from('holdings_integration_runs').insert({
    config_id: config.id,
    organization_id: config.organization_id,
    status: 'running',
  }).select('id').single()

  try {
    // 1. Fetch file
    const file = await fetchFileFromStorage(supabase, config.organization_id, config)
    if (!file) {
      throw new Error('No matching file found')
    }

    // 2. Get column mapping
    let mappings: Record<string, string> = {}
    if (config.column_mapping_config_id) {
      const { data: mapConfig } = await supabase
        .from('holdings_upload_configs')
        .select('column_mappings, skip_rows')
        .eq('id', config.column_mapping_config_id)
        .single()
      if (mapConfig) mappings = mapConfig.column_mappings || {}
    }

    // If no saved mapping, try auto-detect
    if (Object.keys(mappings).length === 0) {
      const firstLine = file.content.split(/\r?\n/).find((l: string) => l.trim())
      if (firstLine) {
        const headers = firstLine.split(',').map((h: string) => h.replace(/"/g, '').trim())
        mappings = autoDetectMappings(headers)
      }
    }

    // 3. Parse
    const skipRows = config.column_mapping_config_id ? 0 : 0 // Could come from config
    const result = parseHoldingsCSV(file.content, mappings, skipRows)

    if (result.errors.length > 0) {
      throw new Error(result.errors.join('; '))
    }

    if (result.positions.length === 0) {
      throw new Error('No positions parsed from file')
    }

    // 4. Resolve symbols
    const symbols = result.positions.map(p => p.symbol)
    const { data: assets } = await supabase
      .from('assets')
      .select('id, symbol')
      .in('symbol', symbols)
    const assetMap = new Map((assets || []).map((a: any) => [a.symbol, a.id]))

    // 5. Determine portfolio (use config's portfolio_id, or find first in org)
    let portfolioId = config.portfolio_id
    if (!portfolioId) {
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id')
        .eq('organization_id', config.organization_id)
        .eq('is_active', true)
        .limit(1)
      portfolioId = portfolios?.[0]?.id
    }

    if (!portfolioId) {
      throw new Error('No portfolio found for this organization')
    }

    // 6. Create snapshot
    const today = new Date().toISOString().split('T')[0]
    const totalMarketValue = result.positions.reduce((s, p) => s + (p.market_value || 0), 0)

    const { data: snapshot, error: snapErr } = await supabase
      .from('portfolio_holdings_snapshots')
      .upsert({
        portfolio_id: portfolioId,
        organization_id: config.organization_id,
        snapshot_date: today,
        source: config.integration_type === 'sftp' ? 'custodian_feed' : 'api_sync',
        total_market_value: totalMarketValue || null,
        total_positions: result.positions.length,
      }, { onConflict: 'portfolio_id,snapshot_date' })
      .select('id')
      .single()

    if (snapErr) throw new Error(`Snapshot creation failed: ${snapErr.message}`)

    // 7. Delete existing positions for this snapshot (upsert approach)
    await supabase.from('portfolio_holdings_positions')
      .delete()
      .eq('snapshot_id', snapshot.id)

    // 8. Insert positions
    const positionRows = result.positions.map(p => ({
      snapshot_id: snapshot.id,
      portfolio_id: portfolioId,
      organization_id: config.organization_id,
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

    const { error: posErr } = await supabase
      .from('portfolio_holdings_positions')
      .insert(positionRows)

    if (posErr) throw new Error(`Position insert failed: ${posErr.message}`)

    // 9. Update run log
    const status = result.warnings.length > 0 ? 'partial' : 'success'
    await supabase.from('holdings_integration_runs').update({
      status,
      completed_at: new Date().toISOString(),
      file_name: file.fileName,
      positions_count: result.positions.length,
      warnings: result.warnings,
      snapshot_id: snapshot.id,
    }).eq('id', run.id)

    // 10. Update config status
    await supabase.from('holdings_integration_configs').update({
      last_run_at: new Date().toISOString(),
      last_success_at: new Date().toISOString(),
      last_error: null,
      consecutive_failures: 0,
      updated_at: new Date().toISOString(),
    }).eq('id', config.id)

    return {
      status,
      positionsCount: result.positions.length,
      fileName: file.fileName,
      errorMessage: null,
      warnings: result.warnings,
    }

  } catch (err: any) {
    // Update run as failed
    if (run?.id) {
      await supabase.from('holdings_integration_runs').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: err.message,
      }).eq('id', run.id)
    }

    // Update config with error
    await supabase.from('holdings_integration_configs').update({
      last_run_at: new Date().toISOString(),
      last_error: err.message,
      consecutive_failures: (config.consecutive_failures || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', config.id)

    return {
      status: 'failed',
      positionsCount: 0,
      fileName: null,
      errorMessage: err.message,
      warnings: [],
    }
  }
}

// Auto-detect column mappings from headers
const HEADER_ALIASES: Record<string, string[]> = {
  symbol: ['symbol', 'ticker', 'security', 'cusip', 'isin', 'security id', 'instrument'],
  shares: ['shares', 'quantity', 'qty', 'units', 'position', 'shares/par'],
  price: ['price', 'last price', 'close', 'closing price', 'market price', 'px'],
  market_value: ['market value', 'mkt val', 'market val', 'mv', 'value', 'notional'],
  cost_basis: ['cost', 'cost basis', 'avg cost', 'book value', 'book cost'],
  weight_pct: ['weight', 'weight %', 'wt%', 'pct', 'allocation', '%'],
  sector: ['sector', 'gics sector', 'industry sector'],
  asset_class: ['asset class', 'asset type', 'security type', 'type'],
}

function autoDetectMappings(headers: string[]): Record<string, string> {
  const mappings: Record<string, string> = {}
  const normalized = headers.map(h => h.toLowerCase().trim())
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalized.findIndex(h => h === alias)
      if (idx >= 0 && !Object.values(mappings).includes(headers[idx])) {
        mappings[field] = headers[idx]
        break
      }
    }
  }
  return mappings
}

// ============================================================================
// HTTP Handler
// ============================================================================

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, serviceRoleKey)

    const url = new URL(req.url)
    const pathParts = url.pathname.split('/').filter(Boolean)
    const configId = pathParts.length > 1 ? pathParts[pathParts.length - 1] : null

    let configs: any[]

    if (configId && configId !== 'holdings-sftp-sync') {
      // Single config run
      const { data, error } = await supabase
        .from('holdings_integration_configs')
        .select('*')
        .eq('id', configId)
        .single()
      if (error) throw new Error(`Config not found: ${error.message}`)
      configs = [data]
    } else {
      // All active configs
      const { data, error } = await supabase
        .from('holdings_integration_configs')
        .select('*')
        .eq('is_active', true)
        .in('integration_type', ['sftp', 'api'])
      if (error) throw new Error(`Failed to fetch configs: ${error.message}`)
      configs = data || []
    }

    const results = []
    for (const config of configs) {
      const result = await syncConfig(supabase, config)
      results.push({
        configId: config.id,
        configName: config.name,
        orgId: config.organization_id,
        ...result,
      })
    }

    return new Response(JSON.stringify({
      processed: results.length,
      succeeded: results.filter(r => r.status === 'success' || r.status === 'partial').length,
      failed: results.filter(r => r.status === 'failed').length,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
