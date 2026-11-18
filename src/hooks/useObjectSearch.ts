import { useMemo } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { usePilotMode } from './usePilotMode'
import { TAB_TYPE_TO_PILOT_FEATURE } from '../lib/pilot/pilot-access'
import { CANONICAL_HOME_TAB } from '../lib/tabStateManager'

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
  /*
    The home row points at the CANONICAL home, `today`, not at the legacy
    `dashboard` id.

    `handleSearchResult` turns a page hit into a tab whose id is this id, and
    activates a tab that already carries it. Pointing at `dashboard` therefore
    built a SECOND home beside the real one: on a phone both ids render the
    ideas feed, so searching "home" left the user with two tabs called Ideas
    and landed them on the newer, legacy one. The drawer's Ideas row was
    repointed for exactly this reason; search still held the old id.
  */
  /*
    The Ideas keywords moved ONTO this row when the separate `ideas` row below
    was removed. `DashboardNext` carries Ideas and Explore as its two lenses,
    so a reader typing "explore" or "screening" wants this surface -- and a
    search term that found a door we removed, finding nothing instead, is the
    half-fix the launcher comment warns about.
  */
  /*
    The `today` row's keywords moved ONTO this one for the same reason the
    Ideas keywords did, and because leaving them on a second row was an actual
    defect rather than a tidiness question: that row carried `id: 'today'` as
    well, so both rendered with the React key `page-today`. Searching
    "attention", "dashboard", "decisions" or "today" put two children with the
    same key in the list -- React logged
    "Encountered two children with the same key, page-today" on every such
    search, and the behaviour when it happens is documented as unsupported.
    Both rows opened the identical tab, so there was never a second door for a
    reader to choose; there was one door drawn twice.
  */
  { id: CANONICAL_HOME_TAB.id, title: 'Dashboard', type: 'page' as const, subtitle: 'Attention feed and Explore', keywords: ['home', 'main', 'overview', 'dashboard', 'ideas', 'opportunities', 'screening', 'explore', 'attention', 'today', 'alerts', 'flags', 'urgent', 'review', 'notifications', 'priorities', 'todo', 'decisions'] },
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
  /* `ideas` is retired as a DOOR. Its two lenses are the Dashboard's, so its
     row and its keywords are on the Dashboard entry above. The tab type still
     exists and still renders for a saved session or a deep link. */
  { id: 'outcomes', title: 'Outcomes', type: 'page' as const, subtitle: 'Decisions and results', keywords: ['decisions', 'execution', 'results', 'approved', 'trades'] },
  /* My Priorities is retired. Its question — what needs me now — is Today's,
     and the attention keywords that used to find it now do. */
  /* The separate `today` row is retired. It shared `id: 'today'` with the
     Dashboard row above and opened the same tab, so it was a duplicate React
     key rather than a second destination. Its keywords are on that row. */
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

/**
 * The static page matches, as pure string work.
 *
 * Lifted out of the `queryFn` so it can run without one. Inside it, these
 * were gated behind the whole network waterfall: typing "chart" showed
 * nothing at all until the RPC and the portfolio read came back, even though
 * "Charting" is a compile-time constant in this very file.
 */
/**
 * The `global_search` RPC, cast once.
 *
 * It is not in the generated database types, so the call needs a cast either
 * way. Doing it here keeps the cast off the call site and lets the result be
 * typed properly rather than as `any`.
 *
 * ── `.bind(supabase)`, and why its absence emptied the whole search ───────
 *
 * `const rpc = supabase.rpc` detaches the method from the client. Called as a
 * bare function its `this` is undefined, and the first thing `rpc` does is
 * read `this.rest`, so every call threw
 *
 *   TypeError: Cannot read properties of undefined (reading 'rest')
 *
 * before a request was ever made. Observed in the browser on the running app:
 * typing a ticker produced no network request at all, and the query in the
 * React Query cache sat at `status: "error"` with exactly that message.
 *
 * Nothing in the interface said so. The thrown error is not the `{ error }`
 * the `if (error)` branch below checks -- that branch is for an RPC that
 * ANSWERS with a failure -- so it escaped the queryFn, React Query held no
 * data, and the dropdown rendered its empty state. Every object search in the
 * application said "No results": assets, themes, portfolios, users, projects,
 * lists, workflows, teams, notebooks and model files alike. Only the static
 * page rows survived, because they are matched locally.
 *
 * The cast is what hid it. `as unknown as (fn, args) => …` describes a plain
 * function, so TypeScript stopped tracking that this value needs a receiver,
 * and a method being torn off its object became invisible at the call site.
 */
function callGlobalSearch(
  query: string,
): Promise<{ data: GlobalSearchRpc | null; error: unknown }> {
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>,
  ) => Promise<{ data: GlobalSearchRpc | null; error: unknown }>
  return rpc('global_search', { search_query: query, result_limit: 5 })
}

export function matchStaticPages(
  pages: readonly { id: string; title: string; subtitle: string; type: 'page'; keywords: string[] }[],
  query: string,
): SearchResult[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  return pages
    .filter(page =>
      page.title.toLowerCase().includes(q) ||
      page.subtitle.toLowerCase().includes(q) ||
      page.keywords.some(kw => kw.includes(q)),
    )
    .map(page => ({
      id: page.id,
      title: page.title,
      subtitle: page.subtitle,
      type: page.type,
      data: { pageType: page.id },
    }))
}

/**
 * @param debouncedQuery drives the network query.
 * @param liveQuery drives the LOCAL matches, so they can appear on the
 *   keystroke instead of 250 ms later. Defaults to the debounced value, which
 *   keeps existing callers behaving as before.
 */
export function useObjectSearch(debouncedQuery: string, liveQuery?: string) {
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

  /*
   * `isError` is reported because a failure and a genuine absence of matches
   * are different answers and were being drawn identically. When the RPC
   * threw, this hook returned the same empty list it returns for a nonsense
   * search term, and the dropdown said "No results for AAPL" -- a confident,
   * wrong statement about the organization's data. The consumer decides how
   * to say "this did not work"; the hook's job is to stop pretending it did.
   */
  const { data: results = [], isFetching, isError } = useQuery({
    // Re-key on the access state so a flag change forces a fresh result list.
    queryKey: ['global-search', debouncedQuery, isPilotForGate, JSON.stringify(pilotMode.access)],
    queryFn: async () => {
      if (!debouncedQuery.trim()) return []

      const matchingPages = matchStaticPages(visibleStaticPages, debouncedQuery)

      /*
       * Two independent round trips, in parallel.
       *
       * These ran in series, and nothing about them required it: the RPC
       * searches `portfolios.name`, this searches `portfolios.portfolio_id`
       * (the mnemonic), and neither reads the other's output. Measured
       * against 24h of production logs the RPC averages 234 ms and the
       * portfolios read 568 ms, so serialising them cost about 800 ms of the
       * wait before any result could render -- roughly 3.0 s at p95.
       */
      const [rpcResult, mnemonicResult] = await Promise.all([
        callGlobalSearch(debouncedQuery.trim()),
        /*
         * An explicit .eq('organization_id') would be *narrower* than the
         * policy and would hide legacy rows carrying team_id with a null
         * organization_id.
         */
        supabase
          // org-scope-exempt: portfolios RLS is genuinely org-aware
          // ("Org members can view portfolios in current org"), unlike asset_lists.
          .from('portfolios')
          .select('id, name, description, benchmark, portfolio_id')
          .ilike('portfolio_id', `%${debouncedQuery.trim()}%`)
          .limit(5),
      ])

      const { data, error } = rpcResult

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

        // Already fetched above, in parallel with the RPC rather than after it.
        const { data: mnemonicHits } = mnemonicResult

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

  /**
   * The local matches, available on the keystroke.
   *
   * `localResults` takes the LIVE query, not the debounced one, because
   * nothing here waits on anything: it is a substring test over a constant
   * array. Returning it separately means the dropdown can show "Charting"
   * the moment you type "chart", while the remote rows arrive behind it.
   *
   * Deduplicated against the remote list because the `queryFn` also includes
   * the static matches -- it has to, since its result is what the cache
   * replays on a warm query.
   */
  const localResults = useMemo(
    () => matchStaticPages(visibleStaticPages, liveQuery ?? debouncedQuery),
    [visibleStaticPages, liveQuery, debouncedQuery],
  )

  return { results: results as SearchResult[], isFetching, isError, localResults }
}
