import { useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { Check, Loader2, Search, Sparkles, X } from 'lucide-react'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useMyCoverage } from '../../hooks/useMyCoverage'
import {
  mergeCandidates, newFromSector, removeCandidate, toggleCandidate,
  type CoverageCandidate,
} from '../../lib/coverage/quick-start-selection'
import { coverageSuggestionsKey, fetchCoverageSuggestions } from '../../lib/coverage/quick-start-suggestions'

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
 * `variant` changes density and nothing else. `page` is the desktop pilot
 * home, where this card is the entire screen rather than one module among
 * several — the same content with room to work in, because a 16rem scroll box
 * alone on a 1400px display is a form pretending to be a widget. Both shells read the same
 * `useMyCoverage` state and write the same rows, so coverage declared on a
 * phone at 7am is present on the desktop at 9. Building a second mobile
 * onboarding state was the thing most worth not doing here.
 */

interface CoverageQuickStartProps {
  variant?: 'card' | 'sheet' | 'page'
  /** Called after a successful save, with how many names were added. */
  onSaved?: (count: number) => void
  /**
   * Where the reader goes after saving, when the caller has somewhere better
   * than the feed.
   *
   * On the pilot home that is the mission they were already in the middle of.
   * "See what's happening" sent them to a feed instead, which is a different
   * activity and reads as the end of onboarding rather than a step in it.
   */
  onContinue?: { label: string; onClick: () => void }
  /**
   * The canonical coverage surface, when this reader may actually reach it.
   *
   * Omitted rather than disabled when access is gated: a control that explains
   * why it cannot be pressed is worse than one that was never offered.
   */
  onManageCoverage?: () => void
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

type AssetOption = CoverageCandidate

/*
 * The right-hand label on a candidate row.
 *
 * A holding names its actual portfolio instead — see `portfolioLabel` — because
 * "In holdings" told the reader nothing they could act on. The generic label
 * survives only as the fallback for a holding whose portfolio RLS did not
 * return.
 */
const REASON_LABEL: Record<NonNullable<AssetOption['reason']>, string> = {
  holding: 'Preloaded',
  sector: 'Your sector',
  team: 'Your team covers',
  search: '',
}

/**
 * Which portfolios hold this name, in the smallest truthful form.
 *
 * One name reads as one name. Several read as the first plus a count, because
 * the row is 40px wide and "held in three books, and here they are" is a
 * question for the asset page.
 */
function portfolioLabel(asset: AssetOption): string | null {
  const names = asset.portfolioNames ?? []
  if (names.length === 0) return null
  return names.length === 1 ? names[0] : `${names[0]} +${names.length - 1}`
}

/** Which source the reader is picking from. */
type Source = 'holdings' | 'sectors' | 'companies'

const SOURCE_LABEL: Record<Source, string> = {
  /*
   * Named for what it actually is.
   *
   * A pilot workspace is provisioned with a seeded template portfolio, and the
   * query behind this reads `portfolio_holdings` with no portfolio or user
   * filter. Calling it "Current holdings" invited a reader to treat a sample
   * book as their own positions.
   */
  holdings: 'Preloaded portfolio',
  sectors: 'Sectors',
  companies: 'Companies',
}

/*
 * Capped, and the reader sees exactly what they got.
 *
 * A sector is not a rule here — the coverage model has no rule lane and
 * inventing one would be a migration — so pressing a sector stages its current
 * constituents as ordinary names. The cap keeps "Financials" from silently
 * staging four hundred rows, and everything staged is listed and individually
 * removable before anything is written.
 */
const SECTOR_CONSTITUENT_LIMIT = 50

/**
 * Sector values that are not a research universe.
 *
 * `assets.sector` carries a few classifications that describe what an
 * instrument IS rather than what it is about, and offering them here invites a
 * reader to "follow cash". Matched case-insensitively because the catalogue is
 * not consistent about capitalisation.
 */
const NON_COVERABLE_SECTORS = new Set(['cash', 'cash & equivalents', 'cash and equivalents'])

export function CoverageQuickStart({
  variant = 'card',
  onSaved,
  onDismiss,
  className,
  savedCount: savedCountProp = null,
}: CoverageQuickStartProps) {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const coverage = useMyCoverage()

  const [source, setSource] = useState<Source>('holdings')
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
    queryKey: coverageSuggestionsKey(user?.id ?? null, currentOrgId),
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 5 * 60_000,
    queryFn: () => fetchCoverageSuggestions(user!.id, currentOrgId!),
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

  /**
   * The sectors that exist in the catalogue.
   *
   * `assets` is a shared catalogue and PostgREST has no DISTINCT, so this is a
   * capped scan of one column, deduped here and cached for the session. It is
   * deliberately not derived from holdings: a reader following a sector they
   * hold nothing in is the normal case, and offering only what is already
   * owned would make this a second holdings list.
   */
  const { data: sectors = [], isLoading: sectorsLoading } = useQuery({
    queryKey: ['coverage-quick-start-sectors'],
    enabled: source === 'sectors',
    staleTime: 30 * 60_000,
    queryFn: async (): Promise<string[]> => {
      const { data, error } = await supabase
        .from('assets')
        .select('sector')
        .not('sector', 'is', null)
        .limit(2000)
      if (error) throw error
      const seen = new Set<string>()
      for (const row of (data ?? []) as { sector: string | null }[]) {
        const value = row.sector?.trim()
        // `Cash` is a holding classification, not a sector anybody covers.
        // Following it would stage cash instruments as names to watch.
        if (value && !NON_COVERABLE_SECTORS.has(value.toLowerCase())) seen.add(value)
      }
      return [...seen].sort((a, b) => a.localeCompare(b))
    },
  })

  /**
   * The sector the reader is looking at, and the names in it NOW.
   *
   * Largest first, because a sector's constituents are not equally worth
   * following and a reader scanning fifty tickers needs the ones that matter
   * at the top.
   */
  const [openSector, setOpenSector] = useState<string | null>(null)
  const { data: constituents = [], isFetching: constituentsLoading } = useQuery({
    queryKey: ['coverage-quick-start-constituents', openSector],
    enabled: !!openSector,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AssetOption[]> => {
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name, sector')
        .eq('sector', openSector!)
        .order('market_cap', { ascending: false, nullsFirst: false })
        .limit(SECTOR_CONSTITUENT_LIMIT)
      if (error) throw error
      return ((data ?? []) as AssetOption[]).map(a => ({
        ...a, reason: 'sector' as const, viaSector: openSector!,
      }))
    },
  })

  /*
   * One list, three sources. Companies is the existing search; holdings is the
   * existing suggestion set; sectors shows constituents once one is opened.
   */
  const options = source === 'companies'
    ? (query.trim() ? searchResults : [])
    : source === 'sectors'
      ? constituents
      : suggestions
  const listLoading = source === 'companies'
    ? searching
    : source === 'sectors'
      ? constituentsLoading
      : suggestionsLoading

  /** Already covered — shown as done, never re-savable. */
  const alreadyCovered = coverage.assetIds

  const toggle = (asset: AssetOption) => {
    setError(null)
    setSelected(prev => toggleCandidate(prev, asset, alreadyCovered))
  }

  /* Everything the open sector would add that is not already staged or
     covered. The merge rule refuses duplicates, so pressing it twice is
     harmless and pressing it after searching the same name changes nothing. */
  const addSector = () => {
    setError(null)
    setSelected(prev => mergeCandidates(prev, constituents, alreadyCovered))
  }

  const save = async () => {
    if (selected.size === 0) return
    setSaving(true)
    setError(null)
    const ids = [...selected.keys()]
    try {
      /*
       * One read and one insert for the whole selection.
       *
       * This was a sequential loop — a lookup and an insert per name, plus a
       * cache invalidation per name — so a fifty-name sector was a hundred
       * round trips and fifty re-rankings of the feed index. Long enough that
       * the reader assumes it has hung, which is exactly what was reported.
       *
       * The dedupe did not go away; it moved into the batch, which reads the
       * whole asset set once. `created` is what was actually written, so a
       * selection where eight were already covered reports forty-two.
       */
      const created = await coverage.addMany(ids)
      setSavedCount(prev => (prev ?? 0) + created)
      setSelected(new Map())
      onSaved?.(created)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      setError(`${message} Nothing was lost — your selection is still here, try again.`)
    } finally {
      setSaving(false)
    }
  }

  const dense = variant === 'sheet'
  /* The card IS the screen: it gets the height a full display can spare. */
  const roomy = variant === 'page'

  /*
   * ── Confirmation, and why it is no longer a screen ──────────────────────
   *
   * Saving used to REPLACE the picker with a done panel, so the reader had
   * declared four names and had no way to declare a fifth without leaving and
   * coming back. That was survivable while the coverage manager was one click
   * away; on the pilot home it is not reachable at all, so the picker was a
   * one-shot.
   *
   * It is a line above the picker now. The count accumulates across saves, and
   * the surface the reader was using is still there underneath it.
   *
   * The onward buttons are gone with the panel. "See what's happening" sent
   * somebody mid-onboarding to a feed, and "Continue getting started" was a
   * control that did nothing on a page they were already on.
   */
  return (
    <div
      data-slot="coverage-quick-start"
      className={clsx(
        'rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        dense ? 'p-3' : roomy ? 'p-5' : 'p-4',
        className,
      )}
    >
      {savedCount !== null && (
        <div
          data-slot="coverage-quick-start-done"
          className="mb-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-2.5 py-2 dark:bg-emerald-900/20"
        >
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
            <Check className="h-2.5 w-2.5" strokeWidth={3} />
          </span>
          <p className="text-xs leading-snug text-emerald-800 dark:text-emerald-200">
            <span className="font-semibold">
              Following {savedCount} {savedCount === 1 ? 'name' : 'names'}.
            </span>{' '}
            Tesseract will use this to decide what to put in front of you. Add more below
            whenever you like.
          </p>
        </div>
      )}

      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
            <Sparkles className="h-3.5 w-3.5 text-primary-500" />
            Set up your coverage
          </h3>
          {/* Setup, and named as setup. It personalises what Tesseract puts in
              front of the reader; it is not one of the five steps and does not
              count toward finishing them. */}
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            Tell Tesseract which names and sectors matter to you. It uses this to decide
            what to surface — you can change it at any time.
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

      {/* Three ways in, one selection out. A reader who thinks in sectors, one
          who thinks in positions and one who has a name in mind all reach the
          same staged list. */}
      <div data-slot="coverage-quick-start-sources" className="mb-2 flex items-center gap-1">
        {(['holdings', 'sectors', 'companies'] as Source[]).map(key => (
          <button
            key={key}
            data-slot={`coverage-source-${key}`}
            data-active={source === key ? 'true' : 'false'}
            onClick={() => { setSource(key); setOpenSector(null) }}
            className={clsx(
              'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
              source === key
                ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-700/50',
            )}
          >
            {SOURCE_LABEL[key]}
          </button>
        ))}
      </div>

      {source === 'companies' && (
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
      )}

      {/* Sector picking, until one is opened. Then its constituents render in
          the ordinary list below and this becomes the way back. */}
      {source === 'sectors' && (
        <div className="mb-2">
          {openSector ? (
            <div className="flex items-center justify-between gap-2">
              <button
                onClick={() => setOpenSector(null)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400"
              >
                All sectors
              </button>
              <button
                data-slot="coverage-add-sector"
                onClick={addSector}
                disabled={constituentsLoading || newFromSector(constituents, selected, alreadyCovered) === 0}
                className="rounded-lg bg-primary-600 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-40"
              >
                {/* Counted before it is pressed: a sector adding eleven names
                    and one adding none look identical on a button. */}
                Add {newFromSector(constituents, selected, alreadyCovered)} from {openSector}
                {constituents.length >= SECTOR_CONSTITUENT_LIMIT ? ' (top 50)' : ''}
              </button>
            </div>
          ) : (
            <>
              <p className="mb-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
                Adds the largest names in a sector as they are today, up to {SECTOR_CONSTITUENT_LIMIT}.
                It is a selection, not a standing rule &mdash; companies that join the sector later
                are not added for you.
              </p>
              <div className="flex flex-wrap gap-1">
                {sectorsLoading && (
                  <span className="flex items-center gap-1.5 py-1 text-xs text-gray-400">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading sectors&hellip;
                  </span>
                )}
                {sectors.map(name => (
                  <button
                    key={name}
                    data-slot="coverage-sector-option"
                    onClick={() => setOpenSector(name)}
                    className="rounded-full border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:border-primary-400 hover:text-primary-700 dark:border-gray-600 dark:text-gray-200"
                  >
                    {name}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {source === 'holdings' && suggestions.length > 0 && (
        <p className="mb-1.5 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
          Start with names from the sample portfolio already loaded into your pilot
          workspace. Nothing is saved until you confirm.
        </p>
      )}

      {/* Capped against the viewport rather than a fixed rem on `page`, so a
          laptop and a large monitor both fill what they have without the list
          growing past the fold. */}
      <div className={clsx('overflow-y-auto', dense ? 'max-h-52' : roomy ? 'max-h-[min(30rem,48vh)]' : 'max-h-64')}>
        {listLoading && options.length === 0 && (
          <div className="flex items-center gap-2 px-1 py-3 text-xs text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
          </div>
        )}

        {!listLoading && options.length === 0 && (
          <p className="px-1 py-3 text-xs text-gray-400">
            {source === 'companies'
              ? (query.trim() ? 'No matching names.' : 'Search for a ticker or company.')
              : source === 'sectors'
                ? (openSector ? 'No names in this sector yet.' : 'Pick a sector above.')
                : 'No holdings to suggest yet - try Sectors or Companies.'}
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
              ) : portfolioLabel(asset) ? (
                /* The book it is actually in, which is the fact worth knowing
                   when deciding whether to follow it. */
                <span className="shrink-0 max-w-[45%] truncate text-[10px] text-gray-400">
                  {portfolioLabel(asset)}
                </span>
              ) : asset.reason && REASON_LABEL[asset.reason] ? (
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

      {selected.size > 0 && (
        <div data-slot="coverage-quick-start-selection" className="mt-2.5 border-t border-gray-100 pt-2.5 dark:border-gray-700">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
            {selected.size} selected
          </p>
          {/* Every staged name, removable one at a time. A sector press can
              stage fifty; nobody should have to accept all fifty to accept
              most of them. */}
          <div className={clsx('flex flex-wrap gap-1 overflow-y-auto', roomy ? 'max-h-40' : 'max-h-24')}>
            {[...selected.values()].map(asset => (
              <span
                key={asset.id}
                data-slot="coverage-selected-chip"
                className="inline-flex items-center gap-1 rounded-full bg-primary-50 py-0.5 pl-2 pr-1 text-xs font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-200"
              >
                {asset.symbol}
                {asset.viaSector && (
                  <span className="text-[10px] font-normal text-primary-400">{asset.viaSector}</span>
                )}
                <button
                  onClick={() => setSelected(prev => removeCandidate(prev, asset.id))}
                  aria-label={`Remove ${asset.symbol}`}
                  className="no-touch-target rounded-full p-0.5 hover:bg-primary-100 dark:hover:bg-primary-800"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        </div>
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
