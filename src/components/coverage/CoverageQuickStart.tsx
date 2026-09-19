import { useState } from 'react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, Loader2, Search, Sparkles, X } from 'lucide-react'

import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useMyCoverage } from '../../hooks/useMyCoverage'
import {
  mergeCandidates, newFromSector, toggleCandidate,
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
   * Whether a successful save is confirmed in place.
   *
   * True everywhere the card stays on screen afterwards, which is where a
   * confirmation is the only feedback there is.
   *
   * False on the pilot's first run, where declaring coverage is what replaces
   * this card with the mission. The confirmation rendered there for exactly
   * one refetch of `my-coverage` and was then thrown away — a success panel
   * nobody had time to read, arriving between the write and the screen that
   * write was for. With it off, the card holds its selection and its
   * "Following…" button until the surface changes underneath it.
   */
  confirmOnSave?: boolean
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

/**
 * Which list the reader is browsing.
 *
 * Search used to be a third one, which meant a reader with a ticker in mind
 * had to find and press a tab before they could type it. The box is always
 * there now and takes over the list while it has anything in it, so these are
 * only the two ways of browsing when you do not already know the name.
 */
type Source = 'holdings' | 'sectors'

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
/*
 * Skeleton geometry, written down rather than random.
 *
 * Uneven widths so the placeholder reads as text rather than as a progress
 * bar, and a fixed set so it does not reshuffle on every render.
 */
const ROW_SKELETON: [string, string][] = [
  ['3rem', '9rem'], ['2.5rem', '11rem'], ['3.25rem', '8rem'], ['2.75rem', '10rem'],
]
const SECTOR_PILL_SKELETON = ['5.5rem', '7rem', '4.5rem', '8rem', '6rem', '5rem', '7.5rem', '4rem']

const NON_COVERABLE_SECTORS = new Set(['cash', 'cash & equivalents', 'cash and equivalents'])

export function CoverageQuickStart({
  variant = 'card',
  onSaved,
  onDismiss,
  className,
  confirmOnSave = true,
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
   * One list, and search wins whenever there is a query.
   *
   * Search was a third source, so it was reachable only by first pressing a
   * tab — the reader had to tell the card what KIND of thing they were about
   * to do before doing it. Typing is now unambiguous on its own, and the
   * browse chips are for the reader who does not have a name in mind.
   */
  const isSearching = query.trim().length > 0
  const options = isSearching
    ? searchResults
    : source === 'sectors'
      ? constituents
      : suggestions
  const listLoading = isSearching
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
      onSaved?.(created)

      /*
       * Nothing moves.
       *
       * The rows the reader ticked stay ticked and the button stays on
       * "Following…" until the coverage read lands and the surface above
       * swaps this card for the mission. Clearing the selection and dropping
       * the button back to a disabled "Follow" for one round trip was a
       * second intermediate state between the write and its result, and the
       * reader had no use for either.
       */
      if (!confirmOnSave) return

      setSavedCount(prev => (prev ?? 0) + created)
      setSelected(new Map())
      setSaving(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      setError(`${message} Nothing was lost — your selection is still here, try again.`)
      /* Released here rather than in a `finally`: a save that succeeded on a
         surface about to be replaced deliberately stays held. A failed one
         must always come back, selection intact, so it can be retried. */
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
  /*
   * What the list is, said only where it adds something.
   *
   * Repeating the active chip's own label above it told the reader nothing
   * twice. On the browse list the useful fact is how many there are; when a
   * search or a sector has narrowed it, the useful fact is what narrowed it.
   */
  const remainingInSector = openSector
    ? newFromSector(constituents, selected, alreadyCovered)
    : 0

  const listTitle = isSearching
    ? `Matching “${query.trim()}”`
    : source === 'sectors'
      /* The sector's name only. It carried a selected count too, which at
         390px truncated the name it was appended to in order to repeat a
         number the footer already owns. */
      ? openSector
      : (options.length > 0 ? `${options.length} suggested` : null)

  const emptyMessage = isSearching
    ? 'No matching names.'
    : source === 'sectors'
      ? (openSector ? 'No names in this sector yet.' : 'Pick a sector above.')
      : 'Nothing to suggest yet — search for a name, or browse by sector.'

  return (
    <div
      data-slot="coverage-quick-start"
      className={clsx(
        'flex flex-col rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800',
        dense ? 'p-3' : roomy ? 'p-5' : 'p-4',
        className,
      )}
    >
      {savedCount !== null && (
        <div
          data-slot="coverage-quick-start-done"
          className="mb-3 flex items-start gap-2 rounded-lg bg-emerald-50 px-3 py-2 dark:bg-emerald-900/20"
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

      {/* ── Ask ──────────────────────────────────────────────────────────
          The question, once, at the size of a question. Everything under it
          was the same 11px as everything else, so the card had no hierarchy
          and read as a settings panel rather than as something being asked. */}
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className={clsx(
            'flex items-center gap-1.5 font-semibold text-gray-900 dark:text-white',
            roomy ? 'text-base' : 'text-sm',
          )}>
            <Sparkles className={clsx('text-primary-500', roomy ? 'h-4 w-4' : 'h-3.5 w-3.5')} />
            What do you follow?
          </h3>
          {/* Setup, and named as setup. It personalises what Tesseract puts in
              front of the reader; it is not one of the five steps and does not
              count toward finishing them. */}
          {/* One sentence. It said the same thing twice — what to pick, and
              that you can change it — and the card's job is to be answered,
              not read. */}
          <p className={clsx(
            'mt-0.5 leading-snug text-gray-500 dark:text-gray-400',
            roomy ? 'text-[13px]' : 'text-xs',
          )}>
            Tesseract uses this to decide what to put in front of you.
          </p>
        </div>
        {onDismiss && !roomy && (
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

      {/* ── Find ─────────────────────────────────────────────────────────
          Always here, and it takes over the list the moment it has anything
          in it. A reader who knows the ticker types it; a reader who does not
          uses the two chips underneath. It used to be a third tab, so finding
          a name you already had in mind began by telling the card what kind
          of thing you were about to do. */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          data-slot="coverage-quick-start-search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search a ticker or company"
          className={clsx(
            'w-full rounded-lg border border-gray-300 bg-white pl-9 pr-8 text-sm placeholder:text-gray-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-primary-500 dark:border-gray-600 dark:bg-gray-900 dark:text-white',
            roomy ? 'py-2.5' : 'py-2',
          )}
        />
        {isSearching && (
          <button
            data-slot="coverage-quick-start-search-clear"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="no-touch-target absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Browse, for the reader without a name in mind. Hidden while
          searching, because the list is not theirs to choose then. */}
      {!isSearching && (
        <div data-slot="coverage-quick-start-sources" className="mt-2.5 flex items-center gap-1.5">
          {(['holdings', 'sectors'] as Source[]).map(key => (
            <button
              key={key}
              data-slot={`coverage-source-${key}`}
              data-active={source === key ? 'true' : 'false'}
              onClick={() => { setSource(key); setOpenSector(null) }}
              className={clsx(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors',
                source === key
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'border border-gray-200 text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-600 dark:text-gray-300',
              )}
            >
              {SOURCE_LABEL[key]}
            </button>
          ))}
        </div>
      )}

      {/* Sector picking, until one is opened. Then its constituents render in
          the ordinary list below and the header becomes the way back. */}
      {!isSearching && source === 'sectors' && !openSector && (
        <div className="mt-2.5">
          {/* The pills are the content here. The rule they follow is worth one
              line, not three — it is still a selection of today's largest
              names and still not a standing rule. */}
          <p className="mb-2 text-[11px] leading-snug text-gray-500 dark:text-gray-400">
            Adds a sector&rsquo;s largest names as they are today, up to {SECTOR_CONSTITUENT_LIMIT}. Not a
            standing rule.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {/* Shaped like the pills they become, so the block does not jump
                from one line of text to six rows of chips. */}
            {sectorsLoading && SECTOR_PILL_SKELETON.map((w, i) => (
              <span
                key={i}
                aria-hidden="true"
                className="h-7 animate-pulse rounded-full bg-gray-100 dark:bg-gray-700"
                style={{ width: w }}
              />
            ))}
            {sectors.map(name => (
              <button
                key={name}
                data-slot="coverage-sector-option"
                onClick={() => setOpenSector(name)}
                className="rounded-full border border-gray-300 px-3 py-1 text-xs font-medium text-gray-700 transition-colors hover:border-primary-400 hover:bg-primary-50 hover:text-primary-700 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-primary-900/20"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Choose ───────────────────────────────────────────────────────
          The list always says what it is. Several sources reaching one
          unlabelled list is how a reader loses track of what they are looking
          at, and the sector controls used to sit above the heading rather
          than on it. */}
      <div className="mt-3 flex min-h-[1.5rem] items-center justify-between gap-3 border-b border-gray-100 pb-1.5 dark:border-gray-700">
        <p
          data-slot="coverage-quick-start-list-title"
          className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide text-gray-400"
        >
          {listTitle}
        </p>
        {!isSearching && source === 'sectors' && openSector && (
          <div className="flex shrink-0 items-center gap-2.5">
            {/*
              "Add all 0" was a live-looking control that could do nothing.
              Nothing left to add is a finished state, not a disabled button,
              and it is worth saying so.
            */}
            {constituentsLoading ? null : remainingInSector > 0 ? (
              <button
                data-slot="coverage-add-sector"
                onClick={addSector}
                className="rounded-lg border border-primary-200 px-2.5 py-1 text-xs font-semibold text-primary-700 transition-colors hover:bg-primary-50 dark:border-primary-800 dark:text-primary-300 dark:hover:bg-primary-900/20"
              >
                {/* Counted before it is pressed: a sector adding eleven names
                    and one adding none look identical on a button. */}
                Add all {remainingInSector}
              </button>
            ) : constituents.length > 0 ? (
              <span
                data-slot="coverage-sector-complete"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400"
              >
                <Check className="h-3 w-3" strokeWidth={3} /> All added
              </span>
            ) : null}
            {/* Navigation, and shaped like it. It read as a second call to
                action competing with the one beside it. */}
            <button
              data-slot="coverage-sector-back"
              onClick={() => setOpenSector(null)}
              className="inline-flex items-center gap-0.5 text-xs font-medium text-gray-500 transition-colors hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
              All sectors
            </button>
          </div>
        )}
      </div>

      {/*
        A floor as well as a ceiling.

        With only a ceiling the region was one line tall while a query was in
        flight and fifty rows tall a moment later, so opening a sector threw
        the footer half a screen down the page. The floor is four rows, which
        is what the skeleton draws.
      */}
      <div
        className={clsx(
          'overflow-y-auto',
          dense ? 'min-h-[11rem] max-h-52' : roomy ? 'min-h-[13rem] max-h-[min(28rem,44vh)]' : 'min-h-[12rem] max-h-64',
        )}
      >
        {/* Rows, not a spinner. The reader is about to read a list, and a
            centred spinner tells them nothing about what is coming. */}
        {listLoading && options.length === 0 && (
          <div aria-busy="true" aria-label="Loading">
            {ROW_SKELETON.map((w, i) => (
              <div key={i} aria-hidden="true" className={clsx('flex items-center gap-3 px-2', roomy ? 'py-2.5' : 'py-2')}>
                <span className="h-5 w-5 shrink-0 animate-pulse rounded-md bg-gray-100 dark:bg-gray-700" />
                <span className="min-w-0 flex-1 space-y-1.5">
                  <span className="block h-3 animate-pulse rounded bg-gray-100 dark:bg-gray-700" style={{ width: w[0] }} />
                  <span className="block h-2.5 animate-pulse rounded bg-gray-100 dark:bg-gray-700" style={{ width: w[1] }} />
                </span>
              </div>
            ))}
          </div>
        )}

        {!listLoading && options.length === 0 && (
          <p className="px-1 py-4 text-xs text-gray-400">{emptyMessage}</p>
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
                'flex w-full items-center gap-3 rounded-lg px-2 text-left transition-colors',
                roomy ? 'py-2.5' : 'py-2',
                /*
                  A staged row used to take a tinted block, so selecting forty
                  names turned the list into a wall of blue and the screen got
                  busier the further the reader got. The tick carries the
                  state; the row stays a row.
                */
                isCovered ? 'opacity-60' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50',
              )}
            >
              {/*
                A followed name and a staged one are not the same state, and
                they drew the identical filled primary check — so a list of
                names the reader already follows looked like a list they had
                just selected. Staged is the accent; followed is grey and done.
              */}
              <span
                className={clsx(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-md border',
                  isSelected
                    ? 'border-primary-500 bg-primary-500 text-white'
                    : isCovered
                      ? 'border-gray-300 bg-gray-200 text-gray-500 dark:border-gray-600 dark:bg-gray-600 dark:text-gray-300'
                      : 'border-gray-300 text-transparent dark:border-gray-600',
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-gray-900 dark:text-white">
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
          className="mt-2.5 rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </p>
      )}

      {/* ── Commit ───────────────────────────────────────────────────────
          One bar, always in the same place, under a rule that separates it
          from the list. The staged names and the button were two stacked
          blocks below a scrolling list, so on a long list the reader scrolled
          past what they were choosing to find out what they had chosen. */}
      {/*
        ── Commit ────────────────────────────────────────────────────────

        One count and one decision.

        The staged names were also listed here as removable chips, which is a
        second full copy of a fact the ticked rows already carry — and a copy
        that grew to fifty pills and pushed the button off the screen. Unstaging
        is what the row's own tick is for, which is where the reader ticked it.
        A count that does not move when the list does is what belongs here.
      */}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-gray-200 pt-3 dark:border-gray-700">
        <p
          data-slot="coverage-quick-start-status"
          className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400"
        >
          {selected.size === 0
            ? 'Nothing is saved until you confirm.'
            : `${selected.size} selected`}
        </p>
        <div className="flex shrink-0 items-center gap-1">
          {onDismiss && (
            <button
              data-slot="coverage-quick-start-skip"
              onClick={onDismiss}
              disabled={saving}
              className="rounded-lg px-2.5 py-2 text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Not now
            </button>
          )}
          <button
            data-slot="coverage-quick-start-save"
            onClick={save}
            disabled={selected.size === 0 || saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-primary-700 disabled:cursor-default disabled:opacity-40"
          >
            {/* The selection stays on screen through the write, so the button
                is the only thing that changes state. */}
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving
              ? 'Following…'
              : selected.size === 0
                ? 'Follow'
                : `Follow ${selected.size} ${selected.size === 1 ? 'name' : 'names'}`}
          </button>
        </div>
      </div>
    </div>
  )
}
