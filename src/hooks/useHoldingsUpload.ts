import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'

// ─── Types ────────────────────────────────────────────────────

export interface HoldingsUploadConfig {
  id: string
  organization_id: string
  portfolio_id: string | null
  name: string
  description: string | null
  column_mappings: Record<string, string>
  skip_rows: number
  date_format: string
  is_default: boolean
  source_label: string | null
  created_at: string
}

export interface ParsedPosition {
  symbol: string
  shares: number
  price: number | null
  market_value: number | null
  cost_basis: number | null
  weight_pct: number | null
  sector: string | null
  asset_class: string | null
  asset_id: string | null // resolved from assets table
  warning: string | null  // e.g., "Symbol not found in asset database"
}

export interface ParseResult {
  positions: ParsedPosition[]
  warnings: string[]
  errors: string[]
  totalRows: number
  skippedRows: number
}

export interface UploadLogEntry {
  id: string
  portfolio_id: string
  snapshot_id: string | null
  filename: string
  snapshot_date: string
  positions_count: number
  warnings: any[]
  errors: any[]
  status: 'success' | 'partial' | 'failed'
  uploaded_by: string
  created_at: string
}

// ─── Standard field keys recognized by the upload system ─────

export const STANDARD_FIELDS = [
  { key: 'symbol', label: 'Symbol / Ticker', required: true },
  { key: 'shares', label: 'Shares / Quantity', required: true },
  { key: 'price', label: 'Price', required: false },
  { key: 'market_value', label: 'Market Value', required: false },
  { key: 'cost_basis', label: 'Cost Basis', required: false },
  { key: 'weight_pct', label: 'Weight %', required: false },
  { key: 'sector', label: 'Sector', required: false },
  { key: 'asset_class', label: 'Asset Class', required: false },
] as const

// ─── CSV Parsing ─────────────────────────────────────────────

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

export function parseHoldingsCSV(
  csvText: string,
  columnMappings: Record<string, string>,
  skipRows: number = 0
): ParseResult {
  const rows = parseCSV(csvText, skipRows)
  if (rows.length < 2) return { positions: [], warnings: [], errors: ['File has no data rows'], totalRows: 0, skippedRows: skipRows }

  const headers = rows[0].map(h => h.trim())
  const dataRows = rows.slice(1)

  // Build column index map
  const colIndex: Record<string, number> = {}
  for (const [field, csvHeader] of Object.entries(columnMappings)) {
    const idx = headers.findIndex(h => h.toLowerCase() === csvHeader.toLowerCase())
    if (idx >= 0) colIndex[field] = idx
  }

  if (colIndex['symbol'] === undefined) {
    return { positions: [], warnings: [], errors: ['Symbol column not found in CSV headers'], totalRows: dataRows.length, skippedRows: skipRows }
  }
  if (colIndex['shares'] === undefined) {
    return { positions: [], warnings: [], errors: ['Shares/Quantity column not found in CSV headers'], totalRows: dataRows.length, skippedRows: skipRows }
  }

  const positions: ParsedPosition[] = []
  const warnings: string[] = []
  const errors: string[] = []

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const symbol = row[colIndex['symbol']]?.trim()
    if (!symbol) { warnings.push(`Row ${i + 2}: empty symbol, skipped`); continue }

    const sharesVal = parseNumber(row[colIndex['shares']])
    if (sharesVal === null) { warnings.push(`Row ${i + 2}: invalid shares for ${symbol}, skipped`); continue }

    positions.push({
      symbol: symbol.toUpperCase(),
      shares: sharesVal,
      price: colIndex['price'] !== undefined ? parseNumber(row[colIndex['price']]) : null,
      market_value: colIndex['market_value'] !== undefined ? parseNumber(row[colIndex['market_value']]) : null,
      cost_basis: colIndex['cost_basis'] !== undefined ? parseNumber(row[colIndex['cost_basis']]) : null,
      weight_pct: colIndex['weight_pct'] !== undefined ? parseNumber(row[colIndex['weight_pct']]) : null,
      sector: colIndex['sector'] !== undefined ? row[colIndex['sector']]?.trim() || null : null,
      asset_class: colIndex['asset_class'] !== undefined ? row[colIndex['asset_class']]?.trim() || null : null,
      asset_id: null,
      warning: null,
    })
  }

  return { positions, warnings, errors, totalRows: dataRows.length, skippedRows: skipRows }
}

// ─── Auto-detect column mappings ─────────────────────────────

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

export function autoDetectMappings(headers: string[]): Record<string, string> {
  const mappings: Record<string, string> = {}
  const normalizedHeaders = headers.map(h => h.toLowerCase().trim())

  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    for (const alias of aliases) {
      const idx = normalizedHeaders.findIndex(h => h === alias)
      if (idx >= 0 && !Object.values(mappings).includes(headers[idx])) {
        mappings[field] = headers[idx]
        break
      }
    }
  }

  return mappings
}

// ─── Hook ────────────────────────────────────────────────────

export function useHoldingsUpload(portfolioId: string | undefined) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  // Fetch upload configs for current org
  const { data: configs = [] } = useQuery({
    queryKey: ['holdings-upload-configs', currentOrgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holdings_upload_configs')
        .select('*')
        .eq('organization_id', currentOrgId!)
        .order('name')
      if (error) throw error
      return (data || []) as HoldingsUploadConfig[]
    },
    enabled: !!currentOrgId,
  })

  // Fetch upload history
  const { data: uploadHistory = [] } = useQuery({
    queryKey: ['holdings-upload-log', portfolioId],
    queryFn: async () => {
      let query = supabase
        .from('holdings_upload_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20)

      if (portfolioId) query = query.eq('portfolio_id', portfolioId)

      const { data, error } = await query
      if (error) throw error
      return (data || []) as UploadLogEntry[]
    },
    enabled: !!currentOrgId,
  })

  // Resolve symbols against assets table
  const resolveSymbols = async (symbols: string[]): Promise<Map<string, string>> => {
    const { data } = await supabase
      .from('assets')
      .select('id, symbol')
      .in('symbol', symbols)
    const map = new Map<string, string>()
    for (const a of data || []) map.set(a.symbol, a.id)
    return map
  }

  // Upload holdings
  const uploadMutation = useMutation({
    mutationFn: async ({
      positions,
      snapshotDate,
      source = 'manual_upload',
      filename,
      configId,
    }: {
      positions: ParsedPosition[]
      snapshotDate: string
      source?: string
      filename: string
      configId?: string
    }) => {
      if (!user?.id || !currentOrgId || !portfolioId) throw new Error('Missing context')

      // Resolve symbols
      const symbolMap = await resolveSymbols(positions.map(p => p.symbol))
      const resolved = positions.map(p => ({
        ...p,
        asset_id: symbolMap.get(p.symbol) || null,
        warning: symbolMap.has(p.symbol) ? null : `Symbol "${p.symbol}" not found in asset database`,
      }))

      const warnings = resolved.filter(p => p.warning).map(p => p.warning!)
      const totalMarketValue = resolved.reduce((s, p) => s + (p.market_value || 0), 0)

      // Create snapshot
      const { data: snapshot, error: snapErr } = await supabase
        .from('portfolio_holdings_snapshots')
        .insert({
          portfolio_id: portfolioId,
          organization_id: currentOrgId,
          snapshot_date: snapshotDate,
          source,
          total_market_value: totalMarketValue || null,
          total_positions: resolved.length,
          uploaded_by: user.id,
        })
        .select('id')
        .single()

      if (snapErr) throw snapErr

      // Bulk insert positions
      const positionRows = resolved.map(p => ({
        snapshot_id: snapshot.id,
        portfolio_id: portfolioId,
        organization_id: currentOrgId,
        asset_id: p.asset_id,
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

      if (posErr) throw posErr

      // Log the upload
      await supabase.from('holdings_upload_log').insert({
        organization_id: currentOrgId,
        portfolio_id: portfolioId,
        snapshot_id: snapshot.id,
        config_id: configId || null,
        filename,
        snapshot_date: snapshotDate,
        positions_count: resolved.length,
        warnings,
        status: warnings.length > 0 ? 'partial' : 'success',
        uploaded_by: user.id,
      })

      return { snapshotId: snapshot.id, positionsCount: resolved.length, warnings }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holdings-snapshots'] })
      queryClient.invalidateQueries({ queryKey: ['holdings-positions'] })
      queryClient.invalidateQueries({ queryKey: ['holdings-upload-log'] })
      queryClient.invalidateQueries({ queryKey: ['portfolio-holdings'] })
    },
  })

  // Save a column mapping config
  const saveConfig = useMutation({
    mutationFn: async (config: {
      name: string
      column_mappings: Record<string, string>
      skip_rows?: number
      source_label?: string
    }) => {
      if (!currentOrgId || !user?.id) throw new Error('Not authenticated')

      const { data, error } = await supabase
        .from('holdings_upload_configs')
        .insert({
          organization_id: currentOrgId,
          portfolio_id: portfolioId || null,
          name: config.name,
          column_mappings: config.column_mappings,
          skip_rows: config.skip_rows || 0,
          source_label: config.source_label || null,
          created_by: user.id,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['holdings-upload-configs'] })
    },
  })

  return {
    configs,
    uploadHistory,
    uploadMutation,
    saveConfig,
    resolveSymbols,
  }
}
