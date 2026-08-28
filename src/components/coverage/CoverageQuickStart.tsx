import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, Plus, Search, X } from 'lucide-react'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useMyCoverage } from '../../hooks/useMyCoverage'

/**
 * "What do you follow?" — asked once, answerable in about twenty seconds, on
 * either shell.
 *
 * ── Why this is not a wizard step ─────────────────────────────────────────
 *
 * There is already a five-step blocking SetupWizard that asks a version of this
 * question. Thirteen users have completed it and nine of them declared a
 * `sector_focus`. Zero coverage rows exist outside the internal workspace,
 * because those answers land in `user_profile_extended`, which is read by one
 * display column in the governance surface and nothing else. The product
 * collected the right information and then did not act on it.
 *
 * So this is not another questionnaire. It writes real `coverage` rows — the
 * same rows the asset page, thesis tabs, notifications and the org chart
 * already read — which means answering it changes what the product shows you
 * about thirty seconds later. That is the difference between onboarding and a
 * form.
 *
 * ── Why it is skippable ───────────────────────────────────────────────────
 *
 * Nothing here blocks. A user who dismisses this and goes to look around gets
 * a generic feed, which is worse but not broken, and the prompt is still there
 * when they come back. A blocking gate would buy slightly better first-session
 * data at the cost of the users who bounce off it, and this product's problem
 * is not that people answer too few questions.
 *
 * ── One component, two shells ─────────────────────────────────────────────
 *
 * `variant` changes density and nothing else. Both shells read the same
 * `useMyCoverage` state and write the same rows, so coverage declared on a
 * phone at 7am is present on the desktop at 9. Building a second mobile
 * onboarding state was the thing most worth not doing here.
 */

interface CoverageQuickStartProps {
  variant?: 'card' | 'sheet'
  /** Called after at least one name is added, so a host can advance. */
  onEstablished?: (count: number) => void
  /** Rendered as a dismiss affordance when supplied. */
  onDismiss?: () => void
  className?: string
}

interface AssetOption {
  id: string
  symbol: string
  company_name: string | null
  sector: string | null
}

export function CoverageQuickStart({
  variant = 'card',
  onEstablished,
  onDismiss,
  className,
}: CoverageQuickStartProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const coverage = useMyCoverage()

  const [query, setQuery] = useState('')
  const [pending, setPending] = useState<string | null>(null)

  const covered = coverage.assetIds

  /**
   * Suggestions, in the order a professional would actually recognise them.
   *
   * Holdings first. Every pilot workspace is provisioned with a seeded
   * portfolio, so this is the one list guaranteed to be non-empty on a first
   * session, and "the names already in your book" is a suggestion that needs no
   * explanation. Holdings are a *separate signal* from coverage and stay that
   * way — this offers them as candidates, it does not silently declare them.
   *
   * Then anything in the sector the user already told the setup wizard about.
   * That answer exists for nine users and has never been used for anything;
   * using it here is most of why this component can open with something useful
   * rather than an empty search box.
   */
  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery({
    queryKey: ['coverage-quick-start-suggestions', user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AssetOption[]> => {
      const [holdingsRes, profileRes] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('asset_id, assets:asset_id(id, symbol, company_name, sector)')
          .limit(60),
        supabase
          .from('user_profile_extended')
          .select('sector_focus')
          .eq('user_id', user!.id)
          .maybeSingle(),
      ])

      const out = new Map<string, AssetOption>()

      for (const row of (holdingsRes.data ?? []) as any[]) {
        const a = row.assets
        if (a?.id) out.set(a.id, a as AssetOption)
      }

      const sectors: string[] = ((profileRes.data as any)?.sector_focus as string[]) ?? []
      if (sectors.length > 0 && out.size < 24) {
        const { data } = await supabase
          .from('assets')
          .select('id, symbol, company_name, sector')
          .in('sector', sectors)
          .order('market_cap', { ascending: false, nullsFirst: false })
          .limit(24)
        for (const a of (data ?? []) as AssetOption[]) {
          if (!out.has(a.id)) out.set(a.id, a)
        }
      }

      return [...out.values()]
    },
  })

  /**
   * Search is unscoped by organization on purpose: `assets` is a shared
   * catalogue, not tenant data. Coverage of an asset is tenant data, and that
   * is the row this writes.
   */
  const { data: searchResults = [], isFetching: searching } = useQuery({
    queryKey: ['coverage-quick-start-search', query],
    enabled: query.trim().length >= 1,
    staleTime: 60_000,
    queryFn: async (): Promise<AssetOption[]> => {
      const escaped = query.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .or(`symbol.ilike.%${escaped}%,company_name.ilike.%${escaped}%`)
        .limit(20)
      if (error) throw error
      return (data ?? []) as AssetOption[]
    },
  })

  const options = query.trim() ? searchResults : suggestions
  const listLoading = query.trim() ? searching : suggestionsLoading

  const coveredList = useMemo(
    () =>
      coverage.rows
        .filter(r => r.assets)
        .map(r => ({
          assetId: r.asset_id,
          symbol: r.assets!.symbol,
          name: r.assets!.company_name,
          editable: r.coverage_scope === 'personal',
        })),
    [coverage.rows],
  )

  const toggle = async (asset: AssetOption) => {
    setPending(asset.id)
    try {
      if (covered.has(asset.id)) {
        await coverage.remove(asset.id)
      } else {
        await coverage.add(asset.id)
        onEstablished?.(covered.size + 1)
      }
    } catch {
      // useMyCoverage surfaces nothing on failure by design; the row simply
      // does not flip. A toast here would need a toast host on both shells.
    } finally {
      setPending(null)
    }
  }

  const dense = variant === 'sheet'

  return (
    <div
      className={clsx(
        'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        dense ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            What do you follow?
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Pick the names you watch. Tesseract uses this to decide what to show
            you — you can change it any time.
          </p>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            aria-label="Dismiss"
            className="no-touch-target -m-1 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {coveredList.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {coveredList.map(item => (
            <span
              key={item.assetId}
              className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-300"
            >
              {item.symbol}
              {item.editable ? (
                <button
                  onClick={() => toggle({ id: item.assetId, symbol: item.symbol, company_name: item.name, sector: null })}
                  aria-label={`Stop following ${item.symbol}`}
                  className="no-touch-target rounded-full p-0.5 hover:bg-primary-100 dark:hover:bg-primary-800"
                >
                  <X className="h-3 w-3" />
                </button>
              ) : (
                // Assigned by the organization. Shown because it is genuinely
                // part of what this person covers, not editable because it is
                // not their decision — and RLS would reject the write anyway.
                <span
                  title="Assigned by your organization"
                  className="px-0.5 text-[10px] uppercase tracking-wide opacity-60"
                >
                  team
                </span>
              )}
            </span>
          ))}
        </div>
      )}

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a ticker or company"
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        />
      </div>

      {!query.trim() && suggestions.length > 0 && (
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          From your book and focus
        </p>
      )}

      <div className={clsx('overflow-y-auto', dense ? 'max-h-56' : 'max-h-64')}>
        {listLoading && options.length === 0 && (
          <div className="flex items-center gap-2 px-1 py-3 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {!listLoading && options.length === 0 && (
          <p className="px-1 py-3 text-xs text-gray-400">
            {query.trim() ? 'No matching names.' : 'Search for a name to get started.'}
          </p>
        )}

        {options.map(asset => {
          const isCovered = covered.has(asset.id)
          const isPending = pending === asset.id
          return (
            <button
              key={asset.id}
              onClick={() => toggle(asset)}
              disabled={isPending}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                'hover:bg-gray-50 dark:hover:bg-gray-700/50',
                isPending && 'opacity-60',
              )}
            >
              <span
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                  isCovered
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-gray-300 text-transparent dark:border-gray-600',
                )}
              >
                {isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin text-gray-400" />
                ) : isCovered ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <Plus className="h-3 w-3 text-gray-400" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-white">
                  {asset.symbol}
                </span>
                {asset.company_name && (
                  <span className="block truncate text-xs text-gray-500 dark:text-gray-400">
                    {asset.company_name}
                  </span>
                )}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
