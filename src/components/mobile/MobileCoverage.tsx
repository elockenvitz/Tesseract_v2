import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Search, Users, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useOrganization } from '../../contexts/OrganizationContext'

interface MobileCoverageProps {
  onAssetSelect?: (result: any) => void
}

type View = 'assets' | 'analysts' | 'gaps'

const VIEWS: { key: View; label: string }[] = [
  { key: 'assets', label: 'Assets' },
  { key: 'analysts', label: 'Analysts' },
  { key: 'gaps', label: 'Gaps' },
]

interface CoverageRow {
  asset_id: string
  symbol: string
  company_name: string | null
  sector: string | null
  analysts: { id: string; name: string; isLead: boolean }[]
}

/**
 * Coverage on a phone.
 *
 * The desktop surface is a 7,000-line manager with four views, the flagship
 * being an analyst-by-asset matrix. The registry called that desktop-only and
 * was right about the matrix specifically — a two-dimensional grid whose axes
 * are both unbounded has no phone layout, and there is no arrangement of it
 * that is not a lie about how much you can see.
 *
 * But the matrix is a presentation, not the question. What coverage answers is
 * "who owns this name", "what does this person own", and "what does nobody
 * own" — three lists, each of which is a perfectly good phone screen. Those are
 * what this is. Editing, history, workload analytics and bulk reassignment stay
 * on desktop, which is where the consequences of getting them wrong are
 * visible.
 *
 * The coverage read is filtered by organization_id in the query rather than
 * after it. Filtering client-side would have every org's rows cross the wire
 * and sit in the cache, which is what the org-scope guard exists to catch —
 * and it did catch it here. That means a separate query key from the desktop
 * manager's unscoped `all-coverage`, so the two do not share a cache entry.
 */
export function MobileCoverage({ onAssetSelect }: MobileCoverageProps) {
  const { currentOrgId } = useOrganization()
  const [view, setView] = useState<View>('assets')
  const [search, setSearch] = useState('')

  const { data: coverageRecords, isLoading } = useQuery({
    queryKey: ['mobile-coverage', currentOrgId],
    enabled: !!currentOrgId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('coverage')
        .select('*, assets(*), portfolios(id, name, team_id), teams:org_chart_nodes!coverage_team_id_fkey(id, name, node_type, parent_id)')
        .eq('organization_id', currentOrgId!)
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data as any[]
    },
    staleTime: 30_000,
  })

  // Every asset in the org, so "nobody owns this" is answerable at all — the
  // coverage table by definition only contains names somebody already owns.
  const { data: allAssets } = useQuery({
    queryKey: ['assets-for-coverage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector, industry, country, exchange, market_cap')
        .order('symbol', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const byAsset = useMemo(() => {
    const map = new Map<string, CoverageRow>()
    for (const c of coverageRecords ?? []) {
      if (!c?.asset_id) continue
      if (!map.has(c.asset_id)) {
        map.set(c.asset_id, {
          asset_id: c.asset_id,
          symbol: c.assets?.symbol ?? '—',
          company_name: c.assets?.company_name ?? null,
          sector: c.assets?.sector ?? null,
          analysts: [],
        })
      }
      const name =
        [c.user?.first_name, c.user?.last_name].filter(Boolean).join(' ') ||
        c.user?.email ||
        c.user_name ||
        'Analyst'
      map.get(c.asset_id)!.analysts.push({ id: c.user_id, name, isLead: !!c.is_lead })
    }
    // Lead first, so the person answerable for the name reads first.
    for (const row of map.values()) {
      row.analysts.sort((a, b) => Number(b.isLead) - Number(a.isLead))
    }
    return map
  }, [coverageRecords, currentOrgId])

  const byAnalyst = useMemo(() => {
    const map = new Map<string, { name: string; assets: CoverageRow[] }>()
    for (const row of byAsset.values()) {
      for (const a of row.analysts) {
        if (!map.has(a.id)) map.set(a.id, { name: a.name, assets: [] })
        map.get(a.id)!.assets.push(row)
      }
    }
    return [...map.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.assets.length - a.assets.length)
  }, [byAsset])

  const gaps = useMemo(
    () => (allAssets ?? []).filter((a: any) => !byAsset.has(a.id)),
    [allAssets, byAsset]
  )

  const q = search.trim().toLowerCase()
  const matches = (s: string | null | undefined) => !q || (s ?? '').toLowerCase().includes(q)

  const assetRows = useMemo(
    () =>
      [...byAsset.values()]
        .filter(r => matches(r.symbol) || matches(r.company_name) || r.analysts.some(a => matches(a.name)))
        .sort((a, b) => a.symbol.localeCompare(b.symbol)),
    [byAsset, q]
  )
  const analystRows = useMemo(() => byAnalyst.filter(a => matches(a.name)), [byAnalyst, q])
  const gapRows = useMemo(
    () => gaps.filter((a: any) => matches(a.symbol) || matches(a.company_name)),
    [gaps, q]
  )

  const open = (asset: { id: string; symbol: string }) =>
    onAssetSelect?.({ id: asset.id, title: asset.symbol, type: 'asset', data: asset })

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-950">
      <div className="flex-shrink-0 px-3 pt-3 pb-2 space-y-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-1">
          {VIEWS.map(v => {
            const count = v.key === 'assets' ? byAsset.size : v.key === 'analysts' ? byAnalyst.length : gaps.length
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setView(v.key)}
                aria-current={view === v.key}
                className={clsx(
                  'flex-1 h-9 rounded-lg text-[13px] font-medium transition-colors no-touch-target',
                  view === v.key
                    ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                    : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
                )}
              >
                {v.label}
                <span className="ml-1 text-[11px] tabular-nums opacity-70">{count}</span>
              </button>
            )
          })}
        </div>

        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={view === 'analysts' ? 'Search analysts' : 'Search symbol or company'}
            className="w-full h-10 pl-8 pr-8 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-sm text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 flex items-center justify-center rounded-full text-gray-400"
              aria-label="Clear search"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-safe">
        {isLoading ? (
          <div className="p-3 space-y-2">
            {[0, 1, 2, 3, 4].map(i => (
              <div key={i} className="h-14 rounded-lg bg-gray-100 dark:bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : view === 'assets' ? (
          <RowList
            empty="No covered assets match that."
            rows={assetRows.map(r => ({
              key: r.asset_id,
              onClick: () => open({ id: r.asset_id, symbol: r.symbol }),
              title: r.symbol,
              subtitle: r.company_name,
              detail: r.analysts.map(a => a.name).join(', ') || 'No analyst',
              badge: r.analysts.find(a => a.isLead)?.name ? 'Lead' : undefined,
            }))}
          />
        ) : view === 'analysts' ? (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {analystRows.length === 0 ? (
              <Empty message="No analysts match that." />
            ) : (
              analystRows.map(a => (
                <div key={a.id} className="px-3 py-3">
                  <div className="flex items-center gap-2">
                    <Users className="h-4 w-4 shrink-0 text-gray-400" />
                    <span className="text-sm font-semibold text-gray-900 dark:text-white">{a.name}</span>
                    <span className="ml-auto text-[11px] tabular-nums text-gray-400">
                      {a.assets.length} {a.assets.length === 1 ? 'name' : 'names'}
                    </span>
                  </div>
                  {/* The names themselves, not just the count — a workload
                      number without its contents cannot be acted on. */}
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {a.assets.map(r => (
                      <button
                        key={r.asset_id}
                        type="button"
                        onClick={() => open({ id: r.asset_id, symbol: r.symbol })}
                        className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 active:bg-gray-200"
                      >
                        {r.symbol}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <RowList
            empty="Every asset has coverage."
            emptyIcon="ok"
            rows={gapRows.map((a: any) => ({
              key: a.id,
              onClick: () => open({ id: a.id, symbol: a.symbol }),
              title: a.symbol,
              subtitle: a.company_name,
              detail: a.sector ?? undefined,
              warn: true,
            }))}
          />
        )}
      </div>
    </div>
  )
}

function RowList({
  rows,
  empty,
  emptyIcon,
}: {
  rows: {
    key: string
    onClick: () => void
    title: string
    subtitle?: string | null
    detail?: string
    badge?: string
    warn?: boolean
  }[]
  empty: string
  emptyIcon?: 'ok'
}) {
  if (rows.length === 0) return <Empty message={empty} ok={emptyIcon === 'ok'} />
  return (
    <div className="divide-y divide-gray-100 dark:divide-gray-800">
      {rows.map(r => (
        <button
          key={r.key}
          type="button"
          onClick={r.onClick}
          className="w-full text-left px-3 py-3 active:bg-gray-50 dark:active:bg-gray-900"
        >
          <div className="flex items-center gap-2">
            {r.warn && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
            <span className="text-sm font-bold text-gray-900 dark:text-white">{r.title}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-500 dark:text-gray-400">
              {r.subtitle}
            </span>
            {r.badge && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                {r.badge}
              </span>
            )}
          </div>
          {r.detail && (
            <p className="mt-0.5 truncate text-[11px] text-gray-400">{r.detail}</p>
          )}
        </button>
      ))}
    </div>
  )
}

function Empty({ message, ok }: { message: string; ok?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-16 px-4 text-gray-400">
      {ok ? <Users className="h-8 w-8 opacity-50" /> : <Search className="h-8 w-8 opacity-50" />}
      <p className="text-sm text-center">{message}</p>
    </div>
  )
}
