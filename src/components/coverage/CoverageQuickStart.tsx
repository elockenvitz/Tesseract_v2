import { useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, Check, Loader2, Search, Sparkles, X } from 'lucide-react'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useMyCoverage } from '../../hooks/useMyCoverage'

/**
 * "What do you follow?" — asked once, answerable in under a minute, on either
 * shell.
 *
 * ── Why this is not another wizard step ───────────────────────────────────
 *
 * A five-step blocking SetupWizard already asks a version of this question.
 * Thirteen users completed it and nine declared a `sector_focus` — and every
 * one of those answers landed in `user_profile_extended`, which is read by one
 * display column in the governance surface and nothing else. The product
 * collected the right information and then did not act on it.
 *
 * So this is not a questionnaire. It writes real `coverage` rows in the
 * personal lane — the same rows the asset page, thesis tabs, notifications and
 * the org chart already read — which means answering it changes what the
 * product shows you about thirty seconds later. That is the difference between
 * onboarding and a form.
 *
 * ── Suggestions are suggestions ───────────────────────────────────────────
 *
 * Nothing here is saved until the reader presses the button. Holdings in
 * particular are offered and never assumed: a position is a fact about a
 * portfolio and coverage is a claim about attention, and silently converting
 * one into the other would put words in a professional's mouth about what they
 * are responsible for. Every suggestion starts unselected.
 *
 * ── What a personal declaration deliberately cannot say ───────────────────
 *
 * No role picker, no "Lead Analyst", no team, no `is_lead`, no analyst
 * selector, no organization selector. A self-declaration that could assert
 * organizational authority is the provenance problem Stage 3.5 closed on
 * `user_id`, arriving through a different column. The write goes through
 * `useMyCoverage`, whose data layer reads the owner from the live session and
 * has no parameter for any of those fields; RLS and a CHECK constraint refuse
 * them independently.
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
  /** Called after a successful save, with how many names were added. */
  onSaved?: (count: number) => void
  /** Where "see what's happening" goes. Absent on surfaces already showing it. */
  onGoToIdeas?: () => void
  /** Rendered as a dismiss affordance when supplied. */
  onDismiss?: () => void
  /**
   * The confirmation state, when a caller keeps it somewhere this component
   * cannot lose it.
   *
   * `savedCount` below is ordinary component state, and on the mobile dashboard
   * this component is REPLACED about a second after the confirm is pressed —
   * the coverage write re-ranks the feed and the feed re-render swaps the
   * subtree. The reader was returned to the selection screen with their rows
   * already saved. A caller that outlives the swap passes the count back in;
   * FirstSessionCoveragePrompt does exactly that.
   */
  savedCount?: number | null
  className?: string
}

interface AssetOption {
  id: string
  symbol: string
  company_name: string | null
  sector: string | null
  /** Why this name is being offered, shown to the reader. */
  reason?: 'holding' | 'sector' | 'team'
}

const REASON_LABEL: Record<NonNullable<AssetOption['reason']>, string> = {
  holding: 'In your book',
  sector: 'Your sector',
  team: 'Your team covers',
}

export function CoverageQuickStart({
  variant = 'card',
  onSaved,
  onGoToIdeas,
  onDismiss,
  className,
  savedCount: savedCountProp = null,
}: CoverageQuickStartProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const coverage = useMyCoverage()

  const [query, setQuery] = useState('')
  /** Staged, not saved. Nothing reaches the database until Save. */
  const [selected, setSelected] = useState<Map<string, AssetOption>>(new Map())
  const [saving, setSaving] = useState(false)
  const [ownSavedCount, setSavedCount] = useState<number | null>(null)
  /**
   * Either this instance saved, or the caller is holding the result of a save
   * whose instance no longer exists. Both mean: show the confirmation.
   */
  const savedCount = ownSavedCount ?? savedCountProp
  const [error, setError] = useState<string | null>(null)

  /**
   * Candidates, in the order a professional would recognise them.
   *
   * Holdings first: every provisioned workspace has a seeded portfolio, so this
   * is the one list guaranteed to be non-empty on a first session, and "the
   * names already in your book" needs no explanation.
   *
   * Then the sector the user already told the setup wizard about — Phase 5 of
   * this stage exists because that answer is sitting in `user_profile_extended`
   * unused, and asking again would be the product not listening.
   *
   * Then what the rest of the workspace already covers, which is the useful
   * signal for someone invited into a configured team.
   */
  const { data: suggestions = [], isLoading: suggestionsLoading } = useQuery({
    queryKey: ['coverage-quick-start-suggestions', user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AssetOption[]> => {
      const [holdingsRes, profileRes, teamRes] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('asset_id, assets:asset_id(id, symbol, company_name, sector)')
          .limit(60),
        supabase
          .from('user_profile_extended')
          .select('sector_focus')
          .eq('user_id', user!.id)
          .maybeSingle(),
        supabase
          .from('coverage')
          .select('asset_id, assets:asset_id(id, symbol, company_name, sector)')
          .eq('organization_id', currentOrgId!)
          .eq('is_active', true)
          .limit(40),
      ])

      const out = new Map<string, AssetOption>()

      for (const row of (holdingsRes.data ?? []) as any[]) {
        const a = row.assets
        if (a?.id && !out.has(a.id)) out.set(a.id, { ...a, reason: 'holding' })
      }

      const sectors: string[] = ((profileRes.data as any)?.sector_focus as string[]) ?? []
      if (sectors.length > 0) {
        const { data } = await supabase
          .from('assets')
          .select('id, symbol, company_name, sector')
          .in('sector', sectors)
          .order('market_cap', { ascending: false, nullsFirst: false })
          .limit(20)
        for (const a of (data ?? []) as AssetOption[]) {
          if (!out.has(a.id)) out.set(a.id, { ...a, reason: 'sector' })
        }
      }

      for (const row of (teamRes.data ?? []) as any[]) {
        const a = row.assets
        if (a?.id && !out.has(a.id)) out.set(a.id, { ...a, reason: 'team' })
      }

      return [...out.values()].slice(0, 30)
    },
  })

  /**
   * Search is unscoped by organization on purpose: `assets` is a shared
   * catalogue, not tenant data. Coverage OF an asset is tenant data, and that
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

  /** Already covered — shown as done, never re-savable. */
  const alreadyCovered = coverage.assetIds

  const toggle = (asset: AssetOption) => {
    if (alreadyCovered.has(asset.id)) return
    setError(null)
    setSelected(prev => {
      const next = new Map(prev)
      if (next.has(asset.id)) next.delete(asset.id)
      else next.set(asset.id, asset)
      return next
    })
  }

  const save = async () => {
    if (selected.size === 0) return
    setSaving(true)
    setError(null)
    const ids = [...selected.keys()]
    try {
      // Sequential rather than a multi-row insert: `coverage` carries an INSERT
      // trigger chain and the data layer de-duplicates per asset, so each row
      // needs its own round trip. A partial failure keeps what landed, which is
      // the right outcome — the user asked for five names and got four.
      let ok = 0
      for (const id of ids) {
        await coverage.add(id)
        ok += 1
      }
      setSavedCount(ok)
      setSelected(new Map())
      onSaved?.(ok)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      setError(`${message} Nothing was lost — your selection is still here, try again.`)
    } finally {
      setSaving(false)
    }
  }

  const dense = variant === 'sheet'

  // ── Confirmation ─────────────────────────────────────────────────────────
  // Concise on purpose. One sentence about what Tesseract will do with it, and
  // a way onwards. Over-explaining here is how a 40-second task becomes a
  // dialogue somebody dismisses.
  if (savedCount !== null) {
    return (
      <div
        data-slot="coverage-quick-start-done"
        className={clsx(
          'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
          dense ? 'p-3' : 'p-4',
          className,
        )}
      >
        <div className="flex items-start gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-3 w-3" strokeWidth={3} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-gray-900 dark:text-white">
              Following {savedCount} {savedCount === 1 ? 'name' : 'names'}
            </p>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Tesseract will use this to decide what to put in front of you. You can
              change it any time from Coverage.
            </p>
            {onGoToIdeas && (
              <button
                data-slot="coverage-quick-start-to-ideas"
                onClick={onGoToIdeas}
                className="mt-2.5 inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-primary-700"
              >
                See what&rsquo;s happening
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      data-slot="coverage-quick-start"
      className={clsx(
        'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        dense ? 'p-3' : 'p-4',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
            <Sparkles className="h-3.5 w-3.5 text-primary-500" />
            What do you follow?
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Pick the names you actively watch. Tesseract uses this to decide what to
            show you.
          </p>
        </div>
        {onDismiss && (
          <button
            data-slot="coverage-quick-start-dismiss"
            onClick={onDismiss}
            aria-label="Dismiss"
            className="no-touch-target -m-1 shrink-0 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
        <input
          data-slot="coverage-quick-start-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a ticker or company"
          className="w-full rounded-lg border border-gray-300 bg-white py-2 pl-8 pr-3 text-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white"
        />
      </div>

      {!query.trim() && suggestions.length > 0 && (
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
          Suggestions — nothing is saved until you confirm
        </p>
      )}

      <div className={clsx('overflow-y-auto', dense ? 'max-h-52' : 'max-h-64')}>
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
          const isCovered = alreadyCovered.has(asset.id)
          const isSelected = selected.has(asset.id)
          return (
            <button
              key={asset.id}
              data-slot="coverage-quick-start-option"
              data-selected={isSelected ? 'true' : 'false'}
              onClick={() => toggle(asset)}
              disabled={isCovered || saving}
              className={clsx(
                'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors',
                isCovered
                  ? 'opacity-50'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
              )}
            >
              <span
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                  isSelected || isCovered
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : 'border-gray-300 text-transparent dark:border-gray-600',
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
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
              {isCovered ? (
                <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-gray-400">
                  Following
                </span>
              ) : asset.reason && !query.trim() ? (
                <span className="shrink-0 text-[10px] text-gray-400">
                  {REASON_LABEL[asset.reason]}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {error && (
        <p
          data-slot="coverage-quick-start-error"
          role="alert"
          className="mt-2 rounded-lg bg-red-50 px-2.5 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-3 flex items-center gap-2">
        <button
          data-slot="coverage-quick-start-save"
          onClick={save}
          disabled={selected.size === 0 || saving}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-default disabled:opacity-40"
        >
          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {selected.size === 0
            ? 'Select names to follow'
            : `Follow ${selected.size} ${selected.size === 1 ? 'name' : 'names'}`}
        </button>
        {onDismiss && (
          <button
            data-slot="coverage-quick-start-skip"
            onClick={onDismiss}
            disabled={saving}
            className="rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            Not now
          </button>
        )}
      </div>
    </div>
  )
}
