import { useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { usePilotMode } from './usePilotMode'
import { TAB_TYPE_TO_PILOT_FEATURE } from '../lib/pilot/pilot-access'

/**
 * "Take me to the thing called X" — search over object *names*.
 *
 * Lifted out of GlobalSearch so the phone's full-screen search can render the
 * same results inline instead of in a dropdown. Previously this logic was
 * welded to the component that drew the floating panel, so the only way to get
 * these results was to also get the panel — which on a phone covered the
 * keyword results sitting underneath it.
 *
 * The companion is useExploreSearch, which searches prose rather than names.
 * The two answer different questions and the phone shows both.
 */

export interface SearchResult {
  id: string
  title: string
  type: 'asset' | 'portfolio' | 'theme' | 'note' | 'list' | 'tdf' | 'allocation-period' | 'user' |
        'workflow' | 'workflow-template' | 'project' | 'notebook' | 'model-template' | 'model-file' |
        'text-template' | 'team' | 'calendar-event' | 'capture' | 'page'
  subtitle?: string
  data: any
}

// Static pages/tabs that should be discoverable via search
export const STATIC_PAGES = [
  { id: 'dashboard', title: 'Dashboard', type: 'page' as const, subtitle: 'Home dashboard overview', keywords: ['home', 'main', 'overview'] },
  { id: 'assets-list', title: 'Assets', type: 'page' as const, subtitle: 'Browse all assets', keywords: ['stocks', 'securities', 'holdings'] },
  { id: 'portfolios-list', title: 'Portfolios', type: 'page' as const, subtitle: 'Manage portfolios', keywords: ['funds', 'accounts'] },
  { id: 'themes-list', title: 'Themes', type: 'page' as const, subtitle: 'Investment themes', keywords: ['sectors', 'categories'] },
  { id: 'notes-list', title: 'Notes', type: 'page' as const, subtitle: 'Research notes', keywords: ['documents', 'memos', 'research'] },
  { id: 'lists', title: 'Lists', type: 'page' as const, subtitle: 'Asset lists and watchlists', keywords: ['watchlist', 'screening'] },
  { id: 'tdf-list', title: 'Target Date Funds', type: 'page' as const, subtitle: 'TDF management', keywords: ['tdf', 'retirement', 'glide path'] },
  { id: 'projects-list', title: 'Projects', type: 'page' as const, subtitle: 'All projects', keywords: ['tasks', 'work'] },
  { id: 'workflows', title: 'Process', type: 'page' as const, subtitle: 'Recurring investment processes', keywords: ['automation', 'process', 'workflow'] },
  { id: 'calendar', title: 'Calendar', type: 'page' as const, subtitle: 'Events and schedule', keywords: ['events', 'schedule', 'meetings', 'earnings'] },
  { id: 'trade-lab', title: 'Trade Lab', type: 'page' as const, subtitle: 'Trade analysis and simulation', keywords: ['trading', 'backtest', 'simulation', 'orders'] },
  { id: 'trade-queue', title: 'Idea Pipeline', type: 'page' as const, subtitle: 'Pending trades', keywords: ['orders', 'execution', 'trading'] },
  { id: 'trade-book', title: 'Trade Book', type: 'page' as const, subtitle: 'Accepted trades and execution tracking', keywords: ['accepted', 'execution', 'book', 'commitment', 'trading', 'plans', 'approvals'] },
  { id: 'charting', title: 'Charting', type: 'page' as const, subtitle: 'Technical charts', keywords: ['charts', 'technical', 'graphs', 'price'] },
  { id: 'asset-allocation', title: 'Asset Allocation', type: 'page' as const, subtitle: 'Portfolio allocation analysis', keywords: ['allocation', 'weights', 'rebalance'] },
  // Prioritizer removed - consolidated into All Priorities
  { id: 'idea-generator', title: 'Idea Generator', type: 'page' as const, subtitle: 'Investment ideas', keywords: ['ideas', 'opportunities', 'screening'] },
  { id: 'outcomes', title: 'Outcomes', type: 'page' as const, subtitle: 'Decisions and results', keywords: ['decisions', 'execution', 'results', 'approved', 'trades'] },
  { id: 'priorities', title: 'My Priorities', type: 'page' as const, subtitle: 'What needs your attention right now', keywords: ['attention', 'alerts', 'flags', 'urgent', 'review', 'notifications', 'priorities', 'todo', 'decisions'] },
  { id: 'files', title: 'Files', type: 'page' as const, subtitle: 'File management', keywords: ['documents', 'uploads', 'models'] },
  { id: 'templates', title: 'Templates', type: 'page' as const, subtitle: 'Model and text templates', keywords: ['models', 'spreadsheets'] },
  { id: 'organization', title: 'Organization', type: 'page' as const, subtitle: 'Team and settings', keywords: ['team', 'settings', 'users', 'members'] },
  { id: 'audit', title: 'Activity History', type: 'page' as const, subtitle: 'Track all changes and actions', keywords: ['audit', 'activity', 'history', 'log', 'trail', 'changes', 'compliance'] },
  { id: 'coverage', title: 'Coverage', type: 'page' as const, subtitle: 'Analyst coverage assignments', keywords: ['analysts', 'coverage', 'assignments', 'team', 'responsibilities'] },
]

/**
 * Shape of the `global_search` RPC.
 *
 * The generated Supabase types do not include this function, so the client
 * infers its argument as `undefined` and its result as `never` — which made
 * every field access below a type error (25 of them, carried silently in
 * GlobalSearch since the RPC was introduced). Declaring the contract here is
 * what the code always assumed; the cast is confined to the one call.
 */
interface GlobalSearchRpc {
  assets?: any[]
  themes?: any[]
  portfolios?: any[]
  asset_lists?: any[]
  workflows?: any[]
  projects?: any[]
  users?: any[]
  tdfs?: any[]
  notebooks?: any[]
  teams?: any[]
  model_files?: any[]
}

export function useObjectSearch(debouncedQuery: string) {
  const pilotMode = usePilotMode()

  // Pilot users see only the pages they actually have access to right now —
  // search results expand naturally as features unlock. Hidden features stay
  // out of search so a pilot can't navigate to a page that's gated behind a
  // CTA they haven't reached yet.
  const isPilotForGate = pilotMode.effectiveIsPilot && !pilotMode.hasGraduated
  const visibleStaticPages = useMemo(() => {
    if (!isPilotForGate) return STATIC_PAGES
    return STATIC_PAGES.filter(page => {
      const featureKey = TAB_TYPE_TO_PILOT_FEATURE[page.id]
      // Pages with no mapped feature are out of the pilot loop entirely.
      if (!featureKey) return false
      return pilotMode.access[featureKey] !== 'hidden'
    })
  }, [isPilotForGate, pilotMode.access])

  const { data: results = [], isFetching } = useQuery({
    // Re-key on the access state so a flag change forces a fresh result list.
    queryKey: ['global-search', debouncedQuery, isPilotForGate, JSON.stringify(pilotMode.access)],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return []

      const q = debouncedQuery.trim().toLowerCase()

      const matchingPages = visibleStaticPages.filter(page =>
        page.title.toLowerCase().includes(q) ||
        page.subtitle.toLowerCase().includes(q) ||
        page.keywords.some(kw => kw.includes(q))
      ).map(page => ({
        id: page.id,
        title: page.title,
        subtitle: page.subtitle,
        type: page.type,
        data: { pageType: page.id }
      }))

      // Single RPC call to search all tables at once
      const { data, error } = await (supabase.rpc as any)('global_search', {
        search_query: debouncedQuery.trim(),
        result_limit: 5
      }) as { data: GlobalSearchRpc | null; error: any }

      if (error) {
        console.error('Search error:', error)
        return matchingPages
      }

      const results: SearchResult[] = [...matchingPages]

      if (data?.assets) {
        results.push(...data.assets.map((asset: any) => ({
          id: asset.id, title: asset.symbol, subtitle: asset.company_name,
          type: 'asset' as const, data: asset
        })))
      }
      if (data?.themes) {
        results.push(...data.themes.map((theme: any) => ({
          id: theme.id, title: theme.name,
          subtitle: theme.description || `${theme.theme_type || 'general'} theme`,
          type: 'theme' as const, data: theme
        })))
      }
      {
        // Merge RPC portfolio results with a direct portfolio_id (mnemonic) search
        const rpcPortfolios: any[] = data?.portfolios || []
        const rpcIds = new Set(rpcPortfolios.map((p: any) => p.id))

        // Also search by portfolio_id mnemonic (RPC only searches name).
        // An explicit .eq('organization_id') would be *narrower* than the
        // policy and would hide legacy rows carrying team_id with a null
        // organization_id.
        const { data: mnemonicHits } = await supabase
          // org-scope-exempt: portfolios RLS is genuinely org-aware
          // ("Org members can view portfolios in current org"), unlike asset_lists.
          .from('portfolios')
          .select('id, name, description, benchmark, portfolio_id')
          .ilike('portfolio_id', `%${debouncedQuery.trim()}%`)
          .limit(5)

        const allPortfolios = [...rpcPortfolios]
        // `portfolio_id` (the mnemonic) is absent from the generated types, so
        // the select resolves to `never` and every field read below is an error.
        for (const p of ((mnemonicHits as any[]) || [])) {
          if (!rpcIds.has(p.id)) {
            allPortfolios.push(p)
            rpcIds.add(p.id)
          }
        }

        if (allPortfolios.length > 0) {
          // Fetch portfolio_id for any RPC results that don't have it
          const needMnemonic = allPortfolios.filter(p => !p.portfolio_id).map(p => p.id)
          let mnemonicMap = new Map<string, string>()
          if (needMnemonic.length > 0) {
            const { data: mnemonics } = await supabase
              .from('portfolios')
              .select('id, portfolio_id')
              .in('id', needMnemonic)
            mnemonicMap = new Map((mnemonics || []).map((m: any) => [m.id, m.portfolio_id]))
          }

          results.push(...allPortfolios.map((p: any) => ({
            id: p.id, title: p.name,
            subtitle: p.description || `Portfolio${p.benchmark ? ` • ${p.benchmark}` : ''}`,
            type: 'portfolio' as const, data: { ...p, portfolio_id: p.portfolio_id || mnemonicMap.get(p.id) }
          })))
        }
      }
      if (data?.asset_lists) {
        results.push(...data.asset_lists.map((list: any) => ({
          id: list.id, title: list.name,
          subtitle: list.description || 'Asset list',
          type: 'list' as const, data: list
        })))
      }
      if (data?.workflows) {
        results.push(...data.workflows.map((w: any) => ({
          id: w.id, title: w.name, subtitle: w.description || `${w.status || 'active'} workflow`,
          type: 'workflow' as const, data: w
        })))
      }
      if (data?.projects) {
        results.push(...data.projects.map((p: any) => ({
          id: p.id, title: p.title,
          subtitle: `${p.status || 'active'}${p.priority ? ` • ${p.priority}` : ''}`,
          type: 'project' as const, data: p
        })))
      }
      if (data?.users) {
        results.push(...data.users.map((user: any) => {
          const fullName = user.first_name && user.last_name
            ? `${user.first_name} ${user.last_name}`
            : user.email?.split('@')[0] || 'Unknown'
          return {
            id: user.id, title: fullName, subtitle: user.email || '',
            type: 'user' as const, data: { id: user.id, full_name: fullName, email: user.email }
          }
        }))
      }
      if (data?.tdfs) {
        results.push(...data.tdfs.map((tdf: any) => ({
          id: tdf.id, title: tdf.name,
          subtitle: `Target Year: ${tdf.target_year}${tdf.fund_code ? ` • ${tdf.fund_code}` : ''}`,
          type: 'tdf' as const, data: tdf
        })))
      }
      if (data?.notebooks) {
        results.push(...data.notebooks.map((n: any) => ({
          id: n.id, title: n.name, subtitle: n.description || 'Custom notebook',
          type: 'notebook' as const, data: n
        })))
      }
      if (data?.teams) {
        results.push(...data.teams.map((t: any) => ({
          id: t.id, title: t.name, subtitle: t.description || 'Team',
          type: 'team' as const, data: t
        })))
      }
      if (data?.model_files) {
        results.push(...data.model_files.map((f: any) => ({
          id: f.id, title: f.filename,
          subtitle: f.symbol ? `${f.symbol} - ${f.company_name}` : 'Model file',
          type: 'model-file' as const, data: { ...f, assetId: f.asset_id }
        })))
      }

      return results
    },
    enabled: debouncedQuery.length > 1,
    staleTime: 60000,
    placeholderData: keepPreviousData
  })

  return { results: results as SearchResult[], isFetching }
}
