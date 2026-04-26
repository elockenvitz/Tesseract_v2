import { useState, useRef, useEffect, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import {
  TrendingUp, TrendingDown, Search, Send, Loader2, ChevronDown,
  Lock, Users, FolderKanban, ArrowLeftRight, X, AlertCircle
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useInvalidateAttention } from '../../hooks/useAttention'
import { emitAuditEvent } from '../../lib/audit'
import { clsx } from 'clsx'
import type { TradeAction } from '../../types/trading'
import { inferProvenance, type Provenance } from '../../lib/provenance'
import { ContextTagsInput, type ContextTag } from '../ui/ContextTagsInput'

// Shape of a row returned by the duplicate-idea queries below. Kept loose
// since we only project a handful of columns and don't need a full type.
interface ExistingIdeaRow {
  id: string
  asset_id?: string
  action: string | null
  stage: string | null
  created_at: string
  portfolio_id: string | null
  pair_id?: string | null
  origin_metadata?: Record<string, any> | null
  users?: { id: string; email: string | null; first_name: string | null; last_name: string | null } | null
}

function formatCreatorName(idea: ExistingIdeaRow): string {
  // Pilot-seeded ideas are technically authored by the org admin (or
  // the seed user) but the UI should attribute them to "Pilot" so the
  // demo doesn't expose the seed user's display name. Mirrors the
  // same convention used in DecisionInbox / Trade Lab author labels.
  if ((idea.origin_metadata as any)?.pilot_seed === true) return 'Pilot'

  const user = idea.users
  if (!user) return 'Unknown'
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  if (full) return full
  if (user.email) return user.email.split('@')[0]
  return 'Unknown'
}

// Open an existing pipeline idea: jump to the Idea Pipeline tab, then
// pop its detail modal once the tab has rendered. Mirrors the pattern
// used by LinkedObjectsPanel.
function openExistingIdea(tradeId: string) {
  try {
    window.dispatchEvent(new CustomEvent('openTradeQueue', { detail: { selectedTradeId: tradeId } }))
    requestAnimationFrame(() => {
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('openTradeIdeaModal', { detail: { tradeId } }))
      }, 50)
    })
  } catch { /* ignore */ }
}

// Render the inner content of an existing-idea row. Two-line layout:
//   row 1: action badge · stage · pair tag (left)        |  age (right)
//   row 2: creator name · portfolio name (truncated)
// Rationale is intentionally omitted — clicking the row opens the
// existing idea where the full thesis lives.
function renderExistingIdeaRow(
  idea: ExistingIdeaRow,
  portfolios: Array<{ id: string; name: string }> | undefined,
) {
  const portfolio = portfolios?.find(p => p.id === idea.portfolio_id)
  const created = new Date(idea.created_at)
  const daysAgo = Math.floor((Date.now() - created.getTime()) / 86_400_000)
  const ageLabel = daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`
  const stageLabel = (idea.stage || 'idea').replace(/_/g, ' ')
  const isLong = idea.action === 'buy' || idea.action === 'add'
  const creatorName = formatCreatorName(idea)
  return (
    <div className="flex flex-col gap-1 w-full min-w-0">
      <div className="flex items-center gap-1.5 w-full min-w-0">
        <span className={clsx(
          "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase flex-shrink-0",
          isLong ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
        )}>
          {idea.action}
        </span>
        <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 capitalize flex-shrink-0">
          {stageLabel}
        </span>
        {idea.pair_id && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 flex-shrink-0">
            pair
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-400 whitespace-nowrap flex-shrink-0 tabular-nums">
          {ageLabel}
        </span>
      </div>
      <div className="flex items-center gap-1.5 w-full min-w-0 text-[11px]">
        <span className="text-gray-700 font-medium truncate flex-shrink min-w-0">
          {creatorName}
        </span>
        {portfolio && (
          <>
            <span className="text-gray-300 flex-shrink-0">·</span>
            <span className="text-gray-500 truncate flex-1 min-w-0">
              {portfolio.name}
            </span>
          </>
        )}
      </div>
    </div>
  )
}

// Compact warning shown beneath each pair leg's chip stack when that
// leg's asset already has live ideas in the pipeline.
function PerLegDuplicateWarning({
  symbol,
  matches,
  portfolios,
}: {
  symbol: string
  matches: ExistingIdeaRow[]
  portfolios: Array<{ id: string; name: string }> | undefined
}) {
  return (
    <div className="mt-1 mb-2 p-2 bg-amber-50 border border-amber-200 rounded-md">
      <div className="flex items-center gap-1.5 mb-1.5">
        <AlertCircle className="h-3.5 w-3.5 text-amber-600" />
        <p className="text-[11px] font-medium text-amber-900">
          {symbol} already has {matches.length === 1 ? 'an idea' : `${matches.length} ideas`} in the pipeline
        </p>
      </div>
      <ul className="space-y-1">
        {matches.map(idea => (
          <li key={idea.id}>
            <button
              type="button"
              onClick={() => openExistingIdea(idea.id)}
              className="w-full flex items-center gap-2 px-2 py-1 bg-white border border-amber-200 rounded text-xs hover:border-amber-400 hover:bg-amber-50/60 transition-colors text-left"
            >
              {renderExistingIdeaRow(idea, portfolios)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

interface QuickTradeIdeaCaptureProps {
  onSuccess?: (tradeIdeaId?: string) => void
  onCancel?: () => void
  compact?: boolean
  autoFocus?: boolean
  // Provenance context (optional overrides for auto-detection)
  portfolioId?: string
  portfolioName?: string
  assetId?: string
  assetSymbol?: string
  assetName?: string
}


export function QuickTradeIdeaCapture({
  onSuccess,
  onCancel,
  compact = false,
  autoFocus = false,
  portfolioId: propPortfolioId,
  portfolioName: propPortfolioName,
  assetId: propAssetId,
  assetSymbol: propAssetSymbol,
  assetName: propAssetName,
}: QuickTradeIdeaCaptureProps) {
  const location = useLocation()

  // Trade type: single or pair
  const [tradeType, setTradeType] = useState<'single' | 'pair'>('single')

  // Asset search - single trade or long leg for pairs
  const [assetSearch, setAssetSearch] = useState('')
  const [selectedAsset, setSelectedAsset] = useState<{ id: string; symbol: string; company_name: string } | null>(null)
  const [showAssetDropdown, setShowAssetDropdown] = useState(false)

  // Context tags (entity-based)
  const [contextTags, setContextTags] = useState<ContextTag[]>([])

  // Multiple assets for pairs - long side
  const [longAssets, setLongAssets] = useState<{ id: string; symbol: string; company_name: string }[]>([])
  const [longSearch, setLongSearch] = useState('')
  const [showLongDropdown, setShowLongDropdown] = useState(false)

  // Multiple assets for pairs - short side
  const [shortAssets, setShortAssets] = useState<{ id: string; symbol: string; company_name: string }[]>([])
  const [shortSearch, setShortSearch] = useState('')
  const [showShortDropdown, setShowShortDropdown] = useState(false)

  // Trade details
  const [action, setAction] = useState<TradeAction>('buy')
  const urgency = 'medium' as const
  const [rationale, setRationale] = useState('')

  // Portfolio - multiple selection or none
  const [selectedPortfolioIds, setSelectedPortfolioIds] = useState<string[]>([])
  const [showPortfolioMenu, setShowPortfolioMenu] = useState(false)

  // Visibility - simplified to private or portfolio
  const [visibility, setVisibility] = useState<'private' | 'portfolio'>('private')
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)

  // Tick step 2 of the pilot Quick Capture banner the first time
  // BOTH a thesis and a portfolio are present. We fire from a
  // useEffect rather than per-keystroke so the event lands once
  // the user has both fields filled, not as they type each char.
  // Guarded by a ref so we only fire once per form lifecycle.
  const step2FiredRef = useRef(false)
  useEffect(() => {
    if (step2FiredRef.current) return
    if (rationale.trim().length > 0 && selectedPortfolioIds.length > 0) {
      step2FiredRef.current = true
      try { window.dispatchEvent(new CustomEvent('pilot-capture:thesis-portfolio-set')) } catch { /* ignore */ }
    }
  }, [rationale, selectedPortfolioIds])

  // Error state for inline feedback
  const [submitError, setSubmitError] = useState<string | null>(null)

  const searchInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const queryClient = useQueryClient()
  const invalidateAttention = useInvalidateAttention()

  // Search assets - primary
  const { data: assets } = useQuery({
    queryKey: ['assets-search-quick', assetSearch],
    queryFn: async () => {
      if (!assetSearch || assetSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${assetSearch}%,company_name.ilike.%${assetSearch}%`)
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: assetSearch.length >= 1,
  })

  // Search assets - long side for pairs
  const { data: longSearchResults } = useQuery({
    queryKey: ['assets-search-long', longSearch],
    queryFn: async () => {
      if (!longSearch || longSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${longSearch}%,company_name.ilike.%${longSearch}%`)
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: longSearch.length >= 1,
  })

  // Search assets - short side for pairs
  const { data: shortSearchResults } = useQuery({
    queryKey: ['assets-search-short', shortSearch],
    queryFn: async () => {
      if (!shortSearch || shortSearch.length < 1) return []
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .or(`symbol.ilike.%${shortSearch}%,company_name.ilike.%${shortSearch}%`)
        .limit(8)
      if (error) throw error
      return data
    },
    enabled: shortSearch.length >= 1,
  })

  // Fetch portfolios
  const { data: portfolios } = useQuery({
    queryKey: ['portfolios-list-quick'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('id, name')
        .order('name')
      if (error) throw error
      return data
    },
  })

  // Get the current asset ID for context lookup (single trade mode)
  const currentAssetId = tradeType === 'single' ? selectedAsset?.id : null

  // Fetch which portfolios hold the selected asset (for dropdown badges)
  const { data: portfoliosHoldingAsset } = useQuery({
    queryKey: ['portfolios-holding-asset-quick', currentAssetId],
    queryFn: async () => {
      if (!currentAssetId) return []
      const { data, error } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id')
        .eq('asset_id', currentAssetId)
        .gt('shares', 0)

      if (error) throw error
      return data?.map(h => h.portfolio_id) || []
    },
    enabled: !!currentAssetId && tradeType === 'single',
  })

  // Fetch detailed holdings for selected portfolios (for context display)
  const { data: portfolioContextData } = useQuery({
    queryKey: ['portfolio-context-quick', selectedPortfolioIds, currentAssetId],
    queryFn: async () => {
      if (selectedPortfolioIds.length === 0 || !currentAssetId) return []

      // Get holdings for the selected asset in all selected portfolios
      const { data: assetHoldings, error: assetError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .eq('asset_id', currentAssetId)
        .in('portfolio_id', selectedPortfolioIds)

      if (assetError) throw assetError

      // Get total portfolio values for weight calculation
      const { data: allHoldings, error: allError } = await supabase
        .from('portfolio_holdings')
        .select('portfolio_id, shares, price')
        .in('portfolio_id', selectedPortfolioIds)

      if (allError) throw allError

      // Calculate totals per portfolio
      const portfolioTotals: Record<string, number> = {}
      allHoldings?.forEach(h => {
        portfolioTotals[h.portfolio_id] = (portfolioTotals[h.portfolio_id] || 0) + (h.shares * h.price)
      })

      // Build result with context for each portfolio
      // TODO: Add benchmark weight when benchmark_holdings table is available
      return selectedPortfolioIds.map(portfolioId => {
        const holding = assetHoldings?.find(h => h.portfolio_id === portfolioId)
        const totalValue = portfolioTotals[portfolioId] || 0
        const marketValue = holding ? holding.shares * holding.price : 0
        const portfolioWeight = totalValue > 0 ? (marketValue / totalValue) * 100 : 0
        const benchmarkWeight: number | null = null // TODO: fetch from benchmark_holdings when available
        const activeWeight = benchmarkWeight !== null ? portfolioWeight - benchmarkWeight : null

        return {
          portfolioId,
          isOwned: !!holding && holding.shares > 0,
          shares: holding?.shares || 0,
          marketValue,
          portfolioWeight,
          benchmarkWeight,
          activeWeight,
          totalPortfolioValue: totalValue,
        }
      })
    },
    enabled: selectedPortfolioIds.length > 0 && !!currentAssetId && tradeType === 'single',
  })

  // Surface existing ideas for the same asset already in the pipeline so
  // the user can choose to work on the existing one instead of forking a
  // duplicate. Org scoping is handled by RLS on trade_queue_items
  // (visibility tier 'active' = non-archived live pipeline items).
  const { data: existingIdeasForAsset } = useQuery({
    queryKey: ['quick-capture-existing-ideas', currentAssetId],
    queryFn: async () => {
      if (!currentAssetId) return []
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select('id, action, stage, created_at, portfolio_id, pair_id, origin_metadata, users:created_by(id, email, first_name, last_name)')
        .eq('asset_id', currentAssetId)
        .eq('visibility_tier', 'active')
        .order('created_at', { ascending: false })
        .limit(10)
      if (error) throw error
      return (data ?? []) as unknown as ExistingIdeaRow[]
    },
    enabled: !!currentAssetId && tradeType === 'single',
    staleTime: 30_000,
  })

  // Stable, sorted IDs for pair leg duplicate detection — used in
  // queryKeys so React Query memoizes correctly when the user reorders
  // the chip list. Sorting also makes the exact-match comparison
  // independent of insertion order.
  const longIdsKey = useMemo(
    () => longAssets.map(a => a.id).sort().join(','),
    [longAssets]
  )
  const shortIdsKey = useMemo(
    () => shortAssets.map(a => a.id).sort().join(','),
    [shortAssets]
  )

  // Pair-trade duplicate detection. Runs two queries:
  //   1) ideas for any of the proposed leg assets — used to surface
  //      per-leg warnings (e.g. "AAPL already has a buy idea active").
  //   2) ideas for any candidate pair_id touching our assets — used
  //      to find an EXACT pair match (same long set + same short set
  //      with no extra legs). Exact matches block submit.
  // Both queries are bundled into one useQuery so a single cache
  // invalidation refreshes both views.
  const { data: pairDuplicateData } = useQuery({
    queryKey: ['quick-capture-pair-duplicate-check', longIdsKey, shortIdsKey],
    queryFn: async (): Promise<{
      perAsset: Record<string, ExistingIdeaRow[]>
      exactMatches: Array<{ pair_id: string; legs: ExistingIdeaRow[] }>
    }> => {
      const allLegIds = [...longAssets.map(a => a.id), ...shortAssets.map(a => a.id)]
      if (allLegIds.length === 0) return { perAsset: {}, exactMatches: [] }

      // Step 1: ideas for any of our leg assets.
      const { data: legIdeas, error } = await supabase
        .from('trade_queue_items')
        .select('id, asset_id, action, stage, created_at, portfolio_id, pair_id, origin_metadata, users:created_by(id, email, first_name, last_name)')
        .in('asset_id', allLegIds)
        .eq('visibility_tier', 'active')
        .order('created_at', { ascending: false })
      if (error) throw error

      const perAsset: Record<string, ExistingIdeaRow[]> = {}
      ;(legIdeas ?? []).forEach((idea: any) => {
        const aid = idea.asset_id as string
        if (!perAsset[aid]) perAsset[aid] = []
        perAsset[aid].push(idea as ExistingIdeaRow)
      })

      // Step 2: pull all legs of any candidate pair_id and check
      // whether the FULL set of (long, short) legs matches our proposal.
      // We can't trust step 1's row set alone — a candidate pair may
      // have extra legs we didn't query for, which would falsely pass
      // a same-size comparison.
      const candidatePairIds = Array.from(
        new Set((legIdeas ?? []).map((i: any) => i.pair_id).filter(Boolean) as string[])
      )
      if (candidatePairIds.length === 0 || longAssets.length === 0 || shortAssets.length === 0) {
        return { perAsset, exactMatches: [] }
      }

      const { data: allLegs, error: legsErr } = await supabase
        .from('trade_queue_items')
        .select('id, pair_id, asset_id, action, created_at, portfolio_id, stage, origin_metadata, users:created_by(id, email, first_name, last_name)')
        .in('pair_id', candidatePairIds)
        .eq('visibility_tier', 'active')
      if (legsErr) throw legsErr

      const byPairId = new Map<string, ExistingIdeaRow[]>()
      ;(allLegs ?? []).forEach((leg: any) => {
        const pid = leg.pair_id as string | null
        if (!pid) return
        if (!byPairId.has(pid)) byPairId.set(pid, [])
        byPairId.get(pid)!.push(leg as ExistingIdeaRow)
      })

      const proposedLongs = new Set(longAssets.map(a => a.id))
      const proposedShorts = new Set(shortAssets.map(a => a.id))
      const exactMatches: Array<{ pair_id: string; legs: ExistingIdeaRow[] }> = []

      for (const [pid, legs] of byPairId.entries()) {
        const existingLongs = new Set(
          legs.filter(l => l.action === 'buy' || l.action === 'add').map(l => l.asset_id as string)
        )
        const existingShorts = new Set(
          legs.filter(l => l.action === 'sell' || l.action === 'trim').map(l => l.asset_id as string)
        )
        const longsMatch =
          existingLongs.size === proposedLongs.size &&
          [...existingLongs].every(id => proposedLongs.has(id))
        const shortsMatch =
          existingShorts.size === proposedShorts.size &&
          [...existingShorts].every(id => proposedShorts.has(id))
        if (longsMatch && shortsMatch) {
          exactMatches.push({ pair_id: pid, legs })
        }
      }

      return { perAsset, exactMatches }
    },
    enabled: tradeType === 'pair' && (longAssets.length > 0 || shortAssets.length > 0),
    staleTime: 30_000,
  })

  const exactPairMatches = pairDuplicateData?.exactMatches ?? []
  const hasExactPairDuplicate = exactPairMatches.length > 0
  const perLegMatches = pairDuplicateData?.perAsset ?? {}

  useEffect(() => {
    if (autoFocus && searchInputRef.current) {
      searchInputRef.current.focus()
    }
  }, [autoFocus])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 120) + 'px'
    }
  }, [rationale])

  // Auto-populate asset from props (if provided)
  useEffect(() => {
    if (propAssetId && propAssetSymbol && !selectedAsset) {
      setSelectedAsset({
        id: propAssetId,
        symbol: propAssetSymbol,
        company_name: propAssetName || '',
      })
    }
  }, [propAssetId, propAssetSymbol, propAssetName])

  // Compute provenance from current context
  const provenance = useMemo<Provenance>(() => {
    return inferProvenance({
      pathname: location.pathname,
      assetId: selectedAsset?.id || propAssetId,
      assetSymbol: selectedAsset?.symbol || propAssetSymbol,
      assetName: selectedAsset?.company_name || propAssetName,
      portfolioId: propPortfolioId,
      portfolioName: propPortfolioName,
    })
  }, [location.pathname, selectedAsset, propAssetId, propAssetSymbol, propAssetName, propPortfolioId, propPortfolioName])

  const createTradeIdea = useMutation({
    mutationFn: async () => {
      // Clear any previous error
      setSubmitError(null)

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      if (tradeType === 'single' && !selectedAsset) {
        throw new Error('Missing required fields')
      }
      if (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0)) {
        throw new Error('Need at least one long and one short asset for pairs trade')
      }

      // If no portfolios selected, create a single idea without portfolio
      // Generate a pair_id if this is a pairs trade
      const pairId = tradeType === 'pair' ? crypto.randomUUID() : null

      // Map visibility to database-compatible value
      const dbVisibility = visibility === 'portfolio' ? 'team' : visibility

      // Create ONE trade idea (portfolio_id = null, linked to labs via trade_lab_idea_links)
      const inserts: any[] = []

      if (tradeType === 'single' && selectedAsset) {
        // Single trade - one idea
        // Use first selected portfolio as primary portfolio_id (also linked to labs for multi-portfolio)
        inserts.push({
          created_by: user.id,
          portfolio_id: selectedPortfolioIds.length > 0 ? selectedPortfolioIds[0] : null,
          asset_id: selectedAsset.id,
          action,
          urgency,
          rationale: rationale.trim() || null,
          stage: 'idea',
          status: 'idea',
          pair_id: null,
          sharing_visibility: dbVisibility,
          // Provenance
          origin_type: provenance.origin_type,
          origin_entity_type: provenance.origin_entity_type,
          origin_entity_id: provenance.origin_entity_id,
          origin_route: provenance.origin_route,
          origin_metadata: provenance.origin_metadata,
          // Context tags
          context_tags: contextTags,
        })
      } else if (tradeType === 'pair') {
        // Pairs/basket trade - all longs
        // Use first selected portfolio as primary portfolio_id
        const primaryPortfolioId = selectedPortfolioIds.length > 0 ? selectedPortfolioIds[0] : null
        longAssets.forEach(asset => {
          inserts.push({
            created_by: user.id,
            portfolio_id: primaryPortfolioId,
            asset_id: asset.id,
            action: 'buy',
            urgency,
            rationale: rationale.trim() || null,
            stage: 'idea',
            status: 'idea',
            pair_id: pairId,
            sharing_visibility: dbVisibility,
            // Provenance
            origin_type: provenance.origin_type,
            origin_entity_type: provenance.origin_entity_type,
            origin_entity_id: provenance.origin_entity_id,
            origin_route: provenance.origin_route,
            origin_metadata: provenance.origin_metadata,
            // Context tags
            context_tags: contextTags,
          })
        })
        // Pairs/basket trade - all shorts
        shortAssets.forEach(asset => {
          inserts.push({
            created_by: user.id,
            portfolio_id: primaryPortfolioId,
            asset_id: asset.id,
            action: 'sell',
            urgency,
            rationale: rationale.trim() || null,
            stage: 'idea',
            status: 'idea',
            pair_id: pairId,
            sharing_visibility: dbVisibility,
            // Provenance
            origin_type: provenance.origin_type,
            origin_entity_type: provenance.origin_entity_type,
            origin_entity_id: provenance.origin_entity_id,
            origin_route: provenance.origin_route,
            origin_metadata: provenance.origin_metadata,
            // Context tags
            context_tags: contextTags,
          })
        })
      }

      const { data, error } = await supabase
        .from('trade_queue_items')
        .insert(inserts)
        .select()

      if (error) throw error

      // Auto-link to trade labs for ALL selected portfolios (create labs if needed)
      if (data && data.length > 0 && selectedPortfolioIds.length > 0) {
        // Find existing trade labs for selected portfolios
        const { data: existingLabs } = await supabase
          .from('trade_labs')
          .select('id, portfolio_id')
          .in('portfolio_id', selectedPortfolioIds)

        const existingLabPortfolioIds = new Set(existingLabs?.map(l => l.portfolio_id) || [])

        // Find portfolios that need a lab created
        const portfoliosNeedingLabs = selectedPortfolioIds.filter(id => !existingLabPortfolioIds.has(id))

        // Create labs for portfolios that don't have one
        let newLabs: { id: string; portfolio_id: string }[] = []
        if (portfoliosNeedingLabs.length > 0) {
          // Get portfolio names for lab naming
          const { data: portfolioData } = await supabase
            .from('portfolios')
            .select('id, name')
            .in('id', portfoliosNeedingLabs)

          const labInserts = portfolioData?.map(p => ({
            portfolio_id: p.id,
            name: `${p.name} Trade Lab`,
            settings: {},
            created_by: user.id,
          })) || []

          if (labInserts.length > 0) {
            const { data: createdLabs } = await supabase
              .from('trade_labs')
              .insert(labInserts)
              .select('id, portfolio_id')

            newLabs = createdLabs || []
          }
        }

        // Combine existing and new labs
        const allLabs = [...(existingLabs || []), ...newLabs]

        if (allLabs.length > 0) {
          // Link EACH trade idea to ALL labs
          const labLinks: { trade_queue_item_id: string; trade_lab_id: string; created_by: string }[] = []

          data.forEach((tradeIdea: any) => {
            allLabs.forEach(lab => {
              labLinks.push({
                trade_queue_item_id: tradeIdea.id,
                trade_lab_id: lab.id,
                created_by: user.id,
              })
            })
          })

          if (labLinks.length > 0) {
            await supabase
              .from('trade_lab_idea_links')
              .insert(labLinks)

            // Emit 'attach' audit events for each lab link
            for (const link of labLinks) {
              const lab = allLabs.find(l => l.id === link.trade_lab_id)
              const trade = data.find((t: any) => t.id === link.trade_queue_item_id)
              if (lab && trade) {
                await emitAuditEvent({
                  actor: { id: user.id, type: 'user' },
                  entity: {
                    type: 'trade_idea',
                    id: trade.id,
                    displayName: `${trade.action?.toUpperCase()} trade idea`,
                  },
                  action: { type: 'attach', category: 'relationship' },
                  state: {
                    from: null,
                    to: { trade_lab_id: lab.id },
                  },
                  metadata: {
                    ui_source: 'quick_capture',
                    trade_lab_id: lab.id,
                    portfolio_id: lab.portfolio_id,
                  },
                  orgId: user.id, // Using user.id as org_id for now
                })
              }
            }
          }
        }
      }

      // Emit 'create' audit events for each trade idea
      for (const trade of data) {
        // Get asset symbol for display
        let assetSymbol = 'Unknown'
        if (tradeType === 'single' && selectedAsset) {
          assetSymbol = selectedAsset.symbol
        } else if (tradeType === 'pair') {
          const longAsset = longAssets.find(a => a.id === trade.asset_id)
          const shortAsset = shortAssets.find(a => a.id === trade.asset_id)
          assetSymbol = longAsset?.symbol || shortAsset?.symbol || 'Unknown'
        }

        await emitAuditEvent({
          actor: { id: user.id, type: 'user' },
          entity: {
            type: 'trade_idea',
            id: trade.id,
            displayName: `${trade.action?.toUpperCase()} ${assetSymbol}`,
          },
          action: { type: 'create', category: 'lifecycle' },
          state: {
            from: null,
            to: {
              stage: 'idea',
              action: trade.action,
              urgency: trade.urgency,
              visibility_tier: 'active',
            },
          },
          changedFields: ['stage', 'action', 'urgency', 'asset_id'],
          metadata: {
            ui_source: 'quick_capture',
            asset_id: trade.asset_id,
            asset_symbol: assetSymbol,
            trade_type: tradeType,
            pair_id: trade.pair_id,
          },
          orgId: user.id, // Using user.id as org_id for now
          assetSymbol,
        })
      }

      return data
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['trade-queue-items'] })
      queryClient.invalidateQueries({ queryKey: ['trade-ideas-feed'] })
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
      queryClient.invalidateQueries({ queryKey: ['trade-lab-inclusion-counts'] })
      queryClient.invalidateQueries({ queryKey: ['simulations'] })
      // Also invalidate attention queries so the Attention Dashboard updates immediately
      invalidateAttention()
      // Reset form
      setTradeType('single')
      setAssetSearch('')
      setSelectedAsset(null)
      setLongAssets([])
      setLongSearch('')
      setShortAssets([])
      setShortSearch('')
      setAction('buy')
      setRationale('')
      setContextTags([])
      setSelectedPortfolioIds([])
      setVisibility('private')
      setSubmitError(null)
      // Pass the first trade idea ID to the callback
      const firstTradeId = data?.[0]?.id
      onSuccess?.(firstTradeId)
    },
    onError: (error: Error) => {
      // Log error for debugging (dev only)
      if (import.meta.env.DEV) {
        console.error('Trade idea submission failed:', error)
      }

      // Show user-friendly error message
      if (error.message.includes('permission') || error.message.includes('RLS') || error.message.includes('policy')) {
        setSubmitError("Couldn't save trade idea due to permissions. Please try again or contact admin.")
      } else if (error.message.includes('Not authenticated')) {
        setSubmitError("You must be logged in to save a trade idea.")
      } else {
        setSubmitError("Failed to save trade idea. Please try again.")
      }
    },
  })

  const handleSubmit = () => {
    if (tradeType === 'single' && !selectedAsset) return
    if (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0)) return
    // Block exact-pair duplicates — user must remove a leg or open the
    // existing pair instead. Per-asset duplicates are non-blocking.
    if (tradeType === 'pair' && hasExactPairDuplicate) return
    createTradeIdea.mutate()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  const selectAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    setSelectedAsset(asset)
    setAssetSearch('')
    setShowAssetDropdown(false)
    // Tick step 1 of the pilot Quick Capture banner — picking a
    // ticker is the first concrete move on the form.
    try { window.dispatchEvent(new CustomEvent('pilot-capture:ticker-picked')) } catch { /* ignore */ }
  }

  const addLongAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    if (!longAssets.find(a => a.id === asset.id)) {
      setLongAssets([...longAssets, asset])
    }
    setLongSearch('')
    setShowLongDropdown(false)
  }

  const removeLongAsset = (assetId: string) => {
    setLongAssets(longAssets.filter(a => a.id !== assetId))
  }

  const addShortAsset = (asset: { id: string; symbol: string; company_name: string }) => {
    if (!shortAssets.find(a => a.id === asset.id)) {
      setShortAssets([...shortAssets, asset])
    }
    setShortSearch('')
    setShowShortDropdown(false)
  }

  const removeShortAsset = (assetId: string) => {
    setShortAssets(shortAssets.filter(a => a.id !== assetId))
  }

  const getVisibilityLabel = () => {
    if (visibility === 'private') return 'Private'
    if (visibility === 'portfolio') return 'Portfolio'
    return 'Select'
  }

  const getVisibilityIcon = () => {
    if (visibility === 'private') return <Lock className="h-3.5 w-3.5" />
    if (visibility === 'portfolio') return <Users className="h-3.5 w-3.5 text-blue-500" />
    return <Lock className="h-3.5 w-3.5" />
  }

  const handleVisibilitySelect = (type: 'private' | 'portfolio') => {
    setVisibility(type)
    setShowVisibilityMenu(false)
  }

  return (
    <>
    <div className={clsx(
      "bg-white rounded-lg border border-gray-200 shadow-sm",
      compact ? "p-3" : "p-4"
    )}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-green-600" />
          <span className="text-sm font-medium text-gray-700">Trade Idea</span>
        </div>

        {/* Trade type toggle */}
        <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
          <button
            type="button"
            onClick={() => {
              setTradeType('single')
              // When switching to single mode, prefill from first long asset
              if (longAssets.length > 0 && !selectedAsset) {
                setSelectedAsset(longAssets[0])
              }
              setLongAssets([])
              setShortAssets([])
              setLongSearch('')
              setShortSearch('')
            }}
            className={clsx(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
              tradeType === 'single'
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            Single
          </button>
          <button
            type="button"
            onClick={() => {
              setTradeType('pair')
              // When switching to pair mode, prefill long leg from current single asset
              if (selectedAsset && longAssets.length === 0) {
                setLongAssets([selectedAsset])
              }
              setSelectedAsset(null)
              setAssetSearch('')
            }}
            className={clsx(
              "px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
              tradeType === 'pair'
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <ArrowLeftRight className="h-3 w-3" />
            Pair
          </button>
        </div>
      </div>

      {/* Context Tags (optional, entity-based) */}
      <div className="mb-3">
        <ContextTagsInput
          value={contextTags}
          onChange={setContextTags}
          placeholder="Link to assets, themes, portfolios..."
          compact={compact}
        />
      </div>

      {/* Asset Search - Single Trade */}
      {tradeType === 'single' && (
        <>
          <div className="relative mb-3">
            {selectedAsset ? (
              <div className="flex items-center justify-between p-2 border border-gray-200 rounded-lg bg-gray-50">
                <div>
                  <span className="font-semibold text-gray-900">{selectedAsset.symbol}</span>
                  <span className="text-sm text-gray-500 ml-2">{selectedAsset.company_name}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAsset(null)
                    setShowAssetDropdown(true)
                  }}
                  className="text-xs text-primary-600 hover:text-primary-700"
                >
                  Change
                </button>
              </div>
            ) : (
              <>
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search asset..."
                  value={assetSearch}
                  onChange={(e) => {
                    setAssetSearch(e.target.value)
                    setShowAssetDropdown(true)
                  }}
                  onFocus={() => setShowAssetDropdown(true)}
                  onKeyDown={handleKeyDown}
                  className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                />
                {showAssetDropdown && assets && assets.length > 0 && (
                  <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                    {assets.map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => selectAsset(asset)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{asset.symbol}</span>
                        <span className="text-sm text-gray-500 ml-2">{asset.company_name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Duplicate idea warning — show when the selected asset already
              has live ideas in the pipeline. Informational only (does not
              block submission); encourages the user to click through to
              the existing idea instead of forking a parallel thread. */}
          {selectedAsset && existingIdeasForAsset && existingIdeasForAsset.length > 0 && (
            <div className="mb-3 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-start gap-2 mb-2">
                <AlertCircle className="h-4 w-4 text-amber-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-amber-900">
                    {existingIdeasForAsset.length === 1
                      ? `${selectedAsset.symbol} is already in the pipeline`
                      : `${selectedAsset.symbol} has ${existingIdeasForAsset.length} ideas in the pipeline`}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-0.5">
                    Consider working on the existing idea instead of creating a duplicate.
                  </p>
                </div>
              </div>
              <ul className="space-y-1">
                {existingIdeasForAsset.map(idea => (
                  <li key={idea.id}>
                    <button
                      type="button"
                      onClick={() => openExistingIdea(idea.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 bg-white border border-amber-200 rounded text-xs hover:border-amber-400 hover:bg-amber-50/60 transition-colors text-left"
                    >
                      {renderExistingIdeaRow(idea, portfolios)}
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-[10px] text-amber-700 mt-1.5 italic">
                Click an idea above to open it.
              </p>
            </div>
          )}

          {/* Action buttons - only for single trades */}
          <div className="flex gap-2 mb-3">
            {(['buy', 'sell'] as const).map((a) => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={clsx(
                  "flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all capitalize",
                  action === a
                    ? a === 'buy'
                      ? "border-green-500 bg-green-50 text-green-700"
                      : "border-red-500 bg-red-50 text-red-700"
                    : "border-gray-200 text-gray-600 hover:bg-gray-50"
                )}
              >
                {a === 'buy' ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                {a}
              </button>
            ))}
          </div>
        </>
      )}

      {/* Asset Search - Pairs/Basket Trade */}
      {tradeType === 'pair' && (
        <div className="space-y-3 mb-3">
          {/* Long side */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-green-600 bg-green-50 px-2 py-0.5 rounded">Long</span>
              {longAssets.length > 0 && (
                <span className="text-xs text-gray-400">{longAssets.length} selected</span>
              )}
            </div>
            {/* Selected long assets */}
            {longAssets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {longAssets.map(asset => (
                  <span
                    key={asset.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-green-50 border border-green-200 rounded-md text-xs"
                  >
                    <span className="font-medium text-green-700">{asset.symbol}</span>
                    <button
                      type="button"
                      onClick={() => removeLongAsset(asset.id)}
                      className="text-green-400 hover:text-green-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Per-leg duplicate warnings — long side */}
            {longAssets.map(asset => {
              const matches = perLegMatches[asset.id]
              if (!matches || matches.length === 0) return null
              return (
                <PerLegDuplicateWarning
                  key={`long-warn-${asset.id}`}
                  symbol={asset.symbol}
                  matches={matches}
                  portfolios={portfolios}
                />
              )
            })}
            {/* Long search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Add long position..."
                value={longSearch}
                onChange={(e) => {
                  setLongSearch(e.target.value)
                  setShowLongDropdown(true)
                }}
                onFocus={() => setShowLongDropdown(true)}
                onKeyDown={handleKeyDown}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
              {showLongDropdown && longSearchResults && longSearchResults.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {longSearchResults
                    .filter(asset => !longAssets.find(a => a.id === asset.id))
                    .map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => addLongAsset(asset)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{asset.symbol}</span>
                        <span className="text-sm text-gray-500 ml-2">{asset.company_name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>

          {/* Short side */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-red-600 bg-red-50 px-2 py-0.5 rounded">Short</span>
              {shortAssets.length > 0 && (
                <span className="text-xs text-gray-400">{shortAssets.length} selected</span>
              )}
            </div>
            {/* Selected short assets */}
            {shortAssets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {shortAssets.map(asset => (
                  <span
                    key={asset.id}
                    className="inline-flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-200 rounded-md text-xs"
                  >
                    <span className="font-medium text-red-700">{asset.symbol}</span>
                    <button
                      type="button"
                      onClick={() => removeShortAsset(asset.id)}
                      className="text-red-400 hover:text-red-600"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {/* Per-leg duplicate warnings — short side */}
            {shortAssets.map(asset => {
              const matches = perLegMatches[asset.id]
              if (!matches || matches.length === 0) return null
              return (
                <PerLegDuplicateWarning
                  key={`short-warn-${asset.id}`}
                  symbol={asset.symbol}
                  matches={matches}
                  portfolios={portfolios}
                />
              )
            })}
            {/* Short search */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input
                type="text"
                placeholder="Add short position..."
                value={shortSearch}
                onChange={(e) => {
                  setShortSearch(e.target.value)
                  setShowShortDropdown(true)
                }}
                onFocus={() => setShowShortDropdown(true)}
                onKeyDown={handleKeyDown}
                className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent"
              />
              {showShortDropdown && shortSearchResults && shortSearchResults.length > 0 && (
                <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                  {shortSearchResults
                    .filter(asset => !shortAssets.find(a => a.id === asset.id))
                    .map(asset => (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => addShortAsset(asset)}
                        className="w-full text-left px-3 py-2 hover:bg-gray-50"
                      >
                        <span className="font-medium text-gray-900">{asset.symbol}</span>
                        <span className="text-sm text-gray-500 ml-2">{asset.company_name}</span>
                      </button>
                    ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Exact-pair duplicate warning — same long set, same short set
          already exists in the pipeline. Disables submit so the user has
          to remove a leg or open the existing pair. */}
      {tradeType === 'pair' && hasExactPairDuplicate && (
        <div className="mb-3 p-2.5 bg-red-50 border border-red-300 rounded-lg">
          <div className="flex items-start gap-2 mb-2">
            <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-red-900">
                This exact pair is already in the pipeline
              </p>
              <p className="text-[11px] text-red-700 mt-0.5">
                A pair trade with these same legs already exists. Open it instead of creating a duplicate.
              </p>
            </div>
          </div>
          <ul className="space-y-1">
            {exactPairMatches.map(match => {
              const firstLeg = match.legs[0]
              if (!firstLeg) return null
              const longLegs = match.legs.filter(l => l.action === 'buy' || l.action === 'add')
              const shortLegs = match.legs.filter(l => l.action === 'sell' || l.action === 'trim')
              const created = new Date(firstLeg.created_at)
              const daysAgo = Math.floor((Date.now() - created.getTime()) / 86_400_000)
              const ageLabel = daysAgo <= 0 ? 'today' : daysAgo === 1 ? '1d ago' : `${daysAgo}d ago`
              const stageLabel = (firstLeg.stage || 'idea').replace(/_/g, ' ')
              return (
                <li key={match.pair_id}>
                  <button
                    type="button"
                    onClick={() => openExistingIdea(firstLeg.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 bg-white border border-red-200 rounded text-xs hover:border-red-400 hover:bg-red-50/60 transition-colors text-left"
                  >
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-purple-100 text-purple-700 flex-shrink-0">
                      pair
                    </span>
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 text-gray-700 capitalize flex-shrink-0">
                      {stageLabel}
                    </span>
                    <span className="text-gray-700 truncate flex-1 min-w-0">
                      {longLegs.length} long / {shortLegs.length} short
                    </span>
                    <span className="text-gray-400 whitespace-nowrap flex-shrink-0">
                      {ageLabel}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Rationale (Why Now) — 300 char limit matches the trade idea
          detail modal so long-form thoughts go in the thesis field instead */}
      <textarea
        ref={textareaRef}
        value={rationale}
        onChange={(e) => setRationale(e.target.value.slice(0, 300))}
        onKeyDown={handleKeyDown}
        placeholder="Why now? What's the catalyst or risk? (optional)"
        maxLength={300}
        className="w-full resize-none border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-400 caret-gray-900 min-h-[60px]"
        rows={2}
      />
      <div className="mt-1 mb-3 text-[10px] text-gray-400 tabular-nums text-right">
        {rationale.length}/300
      </div>

      {/* Portfolio selector — drops UP so it doesn't push the submit
          row off-screen, and confirms via a sticky Done button rather
          than requiring the user to click away. */}
      {portfolios && portfolios.length > 0 && (
        <div className="relative mb-3">
          <button
            type="button"
            onClick={() => setShowPortfolioMenu(!showPortfolioMenu)}
            className={clsx(
              "w-full flex items-center justify-between px-3 py-2 text-sm border rounded-lg transition-colors",
              showPortfolioMenu
                ? "border-primary-300 bg-primary-50/40 ring-2 ring-primary-100"
                : "border-gray-200 hover:bg-gray-50"
            )}
          >
            <div className="flex items-center gap-2">
              <FolderKanban className="h-3.5 w-3.5 text-gray-400" />
              <span className="text-gray-700">
                {selectedPortfolioIds.length === 0
                  ? 'No specific portfolio'
                  : selectedPortfolioIds.length === 1
                    ? portfolios.find(p => p.id === selectedPortfolioIds[0])?.name
                    : `${selectedPortfolioIds.length} portfolios`}
              </span>
            </div>
            <ChevronDown className={clsx("h-4 w-4 text-gray-400 transition-transform", showPortfolioMenu && "rotate-180")} />
          </button>

          {showPortfolioMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowPortfolioMenu(false)} />
              <div className="absolute z-20 w-full bottom-full mb-1.5 bg-white border border-gray-200 rounded-lg shadow-xl overflow-hidden flex flex-col">
                {/* Scrollable options */}
                <div className="max-h-56 overflow-y-auto py-1">
                  {/* No portfolio option */}
                  <button
                    type="button"
                    onClick={() => setSelectedPortfolioIds([])}
                    className={clsx(
                      "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-sm",
                      selectedPortfolioIds.length === 0 && "bg-primary-50"
                    )}
                  >
                    <div className={clsx(
                      "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                      selectedPortfolioIds.length === 0 ? "bg-primary-500 border-primary-500" : "border-gray-300"
                    )}>
                      {selectedPortfolioIds.length === 0 && <span className="text-white text-xs leading-none">✓</span>}
                    </div>
                    <span className="text-gray-600">No specific portfolio</span>
                  </button>

                  <div className="border-t border-gray-100 my-1" />

                  {/* Portfolio options */}
                  {portfolios.map(p => {
                    const isSelected = selectedPortfolioIds.includes(p.id)
                    const holdsAsset = portfoliosHoldingAsset?.includes(p.id)
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => {
                          if (isSelected) {
                            setSelectedPortfolioIds(selectedPortfolioIds.filter(id => id !== p.id))
                          } else {
                            setSelectedPortfolioIds([...selectedPortfolioIds, p.id])
                          }
                        }}
                        className={clsx(
                          "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-sm",
                          isSelected && "bg-primary-50"
                        )}
                      >
                        <div className={clsx(
                          "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                          isSelected ? "bg-primary-500 border-primary-500" : "border-gray-300"
                        )}>
                          {isSelected && <span className="text-white text-xs leading-none">✓</span>}
                        </div>
                        <span className="text-gray-700 flex-1 truncate">{p.name}</span>
                        {holdsAsset && (
                          <span className="text-[10px] bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded flex-shrink-0">
                            Held
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Sticky footer: selection count + Done */}
                <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-t border-gray-100 bg-gray-50">
                  <span className="text-[11px] text-gray-500">
                    {selectedPortfolioIds.length === 0
                      ? 'No portfolio'
                      : selectedPortfolioIds.length === 1
                        ? '1 portfolio selected'
                        : `${selectedPortfolioIds.length} portfolios selected`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowPortfolioMenu(false)}
                    className="px-3 py-1 bg-primary-600 text-white text-xs font-medium rounded-md hover:bg-primary-700 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Footer with visibility and submit */}
      <div className="pt-3 border-t border-gray-100">
        <div className="flex items-center justify-between">
          {/* Visibility selector */}
          <div className="relative">
          <button
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
            className="flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-800 px-2.5 py-1.5 rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            {getVisibilityIcon()}
            <span>{getVisibilityLabel()}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {showVisibilityMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowVisibilityMenu(false)} />
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 w-max max-w-[280px] z-20">
                <button
                  onClick={() => handleVisibilitySelect('private')}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                    visibility === 'private' && "bg-gray-50"
                  )}
                >
                  <Lock className="h-4 w-4 text-gray-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">Private</div>
                    <div className="text-xs text-gray-500">Only visible to you</div>
                  </div>
                </button>
                <button
                  onClick={() => handleVisibilitySelect('portfolio')}
                  className={clsx(
                    "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                    visibility === 'portfolio' && "bg-gray-50"
                  )}
                >
                  <Users className="h-4 w-4 text-blue-500" />
                  <div className="flex-1">
                    <div className="text-sm font-medium text-gray-900">Portfolio</div>
                    <div className="text-xs text-gray-500 whitespace-nowrap">Portfolio members can see</div>
                  </div>
                </button>
              </div>
            </>
          )}
        </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            {onCancel && (
              <button
                onClick={onCancel}
                className="px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 rounded-md border border-gray-200 hover:border-gray-300 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleSubmit}
              disabled={
                (tradeType === 'single' && !selectedAsset) ||
                (tradeType === 'pair' && (longAssets.length === 0 || shortAssets.length === 0)) ||
                (tradeType === 'pair' && hasExactPairDuplicate) ||
                createTradeIdea.isPending
              }
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap",
                ((tradeType === 'single' && selectedAsset) || (tradeType === 'pair' && longAssets.length > 0 && shortAssets.length > 0 && !hasExactPairDuplicate))
                  ? "bg-green-600 text-white hover:bg-green-700 shadow-sm"
                  : "bg-gray-100 text-gray-400 cursor-not-allowed"
              )}
            >
              {createTradeIdea.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              <span>Add</span>
            </button>
          </div>
        </div>

        {/* Error message */}
        {submitError && (
          <div className="mt-2 p-2 bg-red-50 border border-red-200 rounded-md">
            <p className="text-xs text-red-600">{submitError}</p>
          </div>
        )}

        {/* Visibility consequence + submission outcome */}
        <div className="flex items-center justify-between mt-2 text-[10px] text-gray-400">
          <span>
            {visibility === 'private' ? 'Only you' : 'Visible to portfolio members'}
          </span>
          <span>
            Adds to Idea Pipeline
          </span>
        </div>

      </div>
    </div>

    {/* Portfolio Context - show weight info for selected asset in each portfolio */}
    {tradeType === 'single' && selectedAsset && selectedPortfolioIds.length > 0 && portfolioContextData && portfolioContextData.length > 0 && (
      <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
        <div className="text-xs font-medium text-gray-600 mb-2">Portfolio Context</div>
        <div className="space-y-2">
          {portfolioContextData.map(context => {
            const portfolio = portfolios?.find(p => p.id === context.portfolioId)
            if (!portfolio) return null

            return (
              <div
                key={context.portfolioId}
                className="p-2 rounded-md bg-white border border-gray-200"
              >
                {/* Portfolio name and held badge */}
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-gray-800">{portfolio.name}</span>
                  <span className={clsx(
                    "text-[10px] px-1.5 py-0.5 rounded",
                    context.isOwned
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-100 text-gray-500"
                  )}>
                    {context.isOwned ? 'Held' : 'Not Held'}
                  </span>
                </div>

                {/* Weight info */}
                <div className="flex items-center gap-4 text-xs">
                  <div>
                    <div className="text-gray-400 text-[10px]">Portfolio</div>
                    <div className="font-medium text-gray-700">{context.portfolioWeight.toFixed(2)}%</div>
                  </div>
                  {context.benchmarkWeight !== null && (
                    <>
                      <div>
                        <div className="text-gray-400 text-[10px]">Benchmark</div>
                        <div className="font-medium text-gray-700">{context.benchmarkWeight.toFixed(2)}%</div>
                      </div>
                      <div>
                        <div className="text-gray-400 text-[10px]">Active</div>
                        <div className={clsx(
                          "font-medium",
                          context.activeWeight !== null && context.activeWeight > 0
                            ? "text-green-600"
                            : context.activeWeight !== null && context.activeWeight < 0
                              ? "text-red-600"
                              : "text-gray-700"
                        )}>
                          {context.activeWeight !== null
                            ? `${context.activeWeight >= 0 ? '+' : ''}${context.activeWeight.toFixed(2)}%`
                            : '—'}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )}
    </>
  )
}
