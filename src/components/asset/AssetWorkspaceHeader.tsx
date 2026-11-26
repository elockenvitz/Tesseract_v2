import { useState, type ComponentProps, type ElementType } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, ExternalLink, Briefcase, List, Tag, FolderKanban, Sparkles } from 'lucide-react'
import { CoverageDisplay } from '../coverage/CoverageDisplay'
import { AssetContextStrip } from './AssetContextStrip'
import type { StripCell } from '../../lib/asset-workspace/strip-targets'
import { AssetAttentionBand } from './AssetAttentionBand'
import { useAssetHeaderContext } from '../../hooks/useAssetHeaderContext'
import { askAI, type EngagementTarget } from '../../lib/engagement'
import { CompanyMark } from '../common/CompanyMark'
import { presentQuote, provenanceCaption } from '../../lib/market-data/quote-provenance'
import { identityFacts } from '../../lib/asset-workspace/identity-facts'
import type { RoutedQuote } from '../../lib/market-data/routed-quote'
import type { WorkspaceDestination, SignalFocus } from '../../lib/asset-workspace/context'

type CoverageProps = ComponentProps<typeof CoverageDisplay>

interface AssetLike {
  id: string
  symbol?: string | null
  company_name?: string | null
  portfolioId?: string | null
  portfolioName?: string | null
  origin?: string | null
  /* Instrument identity, straight off `assets`. All optional and all
     rendered only when present — a security that has not been enriched
     shows fewer facts, never a guessed exchange or a default currency. */
  exchange?: string | null
  currency?: string | null
  asset_type?: string | null
  mic?: string | null
  isin?: string | null
}

type ListFocus = 'portfoliosContent' | 'listsContent' | 'themesContent' | 'projectsContent'

interface Props {
  asset: AssetLike
  sector?: string | null
  /**
   * The routed quote, with its provenance intact.
   *
   * Was narrowed to `{ price, change, changePercent }`, which threw away the
   * currency, the unit, the delivery term and the as-of before the header
   * could render them — so the band had no way to be honest about the number
   * it was showing even in principle. `RoutedQuote` is what the caller
   * already holds.
   */
  quote: RoutedQuote | null
  spot: number | null
  headerContext: ReturnType<typeof useAssetHeaderContext>
  coverage: CoverageProps['coverage']
  thesisStatuses?: CoverageProps['thesisStatuses']
  coveringUserIds: string[]
  onFocus: (destination: WorkspaceDestination, focus?: SignalFocus) => void
  onNavigate?: (tab: { id: string; title: string; type: string; data?: unknown }) => void
  /**
   * A context-strip cell was pressed.
   *
   * Was `onOpenSubPage(sub)`. The strip was naming a PAGE, which is why its
   * three Research cells landed wherever Research was last scrolled to — the
   * strip cannot know where the rating or the targets are drawn. It now names
   * the fact and the page resolves it.
   */
  onJumpTo: (cell: StripCell) => void
  onOpenList: (focus: ListFocus) => void
  /** When collapsed, the context strip is hidden but identity, price, attention,
   *  Ask AI and (below, in the page) the tabs stay — a compact working bar. */
  collapsed: boolean
  /** Toggle the collapse state — the control now lives in the band itself. */
  onToggleCollapse: () => void
}


/**
 * UX2 Phase 1 — the deep-navy asset identity band.
 *
 * One band replaces the former stack (identity row + state chips + context strip
 * + arrival row). It carries: ticker + company together, price/change, the Ask AI
 * action (same `askAI` engagement target the arrival bar used), the ⚡ attention
 * trigger (the one A1 resolver, shown as a popover — no second data path), and the
 * collapsible investment-context strip. No new data: every number is read by the
 * components it already belonged to. Presentation only.
 */
export function AssetWorkspaceHeader({
  asset, sector, quote, spot, headerContext, coverage, thesisStatuses,
  coveringUserIds, onFocus, onNavigate, onJumpTo, onOpenList, collapsed, onToggleCollapse,
}: Props) {
  const [showTickerDropdown, setShowTickerDropdown] = useState(false)

  // All price presentation decisions in one place, including the refusals.
  const p = presentQuote(quote, asset.currency)
  const caption = provenanceCaption(p)
  const up = p.direction === 'up'

  /* Venue, currency, security type — placeholders dropped rather than
     printed. `assets.exchange` is the literal string 'Unknown' for every
     security in this database, so rendering the column verbatim would put a
     venue we never checked into the most prominent line on the page. */
  const facts = identityFacts({
    exchange: asset.exchange,
    quoteCurrency: p.currencyCode,
    assetCurrency: asset.currency,
    assetType: asset.asset_type,
  })

  const portfolioCount = headerContext?.portfolios?.length ?? 0

  const askTarget: EngagementTarget = {
    objectType: 'asset',
    objectId: asset.id,
    label: asset.company_name ? `${asset.symbol} — ${asset.company_name}` : (asset.symbol ?? 'Asset'),
    symbol: asset.symbol ?? undefined,
    assetId: asset.id,
    portfolioId: asset.portfolioId ?? undefined,
    portfolioName: asset.portfolioName ?? undefined,
    origin: { itemId: asset.id, surface: asset.origin ?? 'asset' },
  }

  const rows: Array<{ icon: ElementType; label: string; count: number; focus: ListFocus }> = [
    { icon: Briefcase, label: 'portfolio', count: headerContext?.portfolios?.length ?? 0, focus: 'portfoliosContent' },
    { icon: List, label: 'list', count: (headerContext?.listsShared?.length ?? 0) + (headerContext?.listsMine?.length ?? 0), focus: 'listsContent' },
    { icon: Tag, label: 'theme', count: headerContext?.themes?.length ?? 0, focus: 'themesContent' },
    { icon: FolderKanban, label: 'project', count: headerContext?.projectsCount ?? 0, focus: 'projectsContent' },
  ]

  return (
    // -mt-4 pulls the band up over the sticky header's pt-4, so the navy band
    // meets the workspace tab bar with no white gutter between them.
    <div className="ux2-band -mx-8 -mt-4 px-8 pt-4 pb-3">
      <div className="flex items-start justify-between gap-6">
        {/* Identity: ticker + company together, then price/change */}
        <div className="relative flex min-w-0 gap-3">
          {/* The mark sits OUTSIDE the text column so the two text rows align
              to each other rather than each indenting past the logo. */}
          <CompanyMark symbol={asset.symbol} name={asset.company_name} size="lg" className="mt-0.5" />

          <div className="flex flex-col min-w-0">
            <div className="flex items-baseline gap-3 flex-wrap">
              <button
                onClick={() => setShowTickerDropdown(v => !v)}
                aria-haspopup="dialog"
                aria-expanded={showTickerDropdown}
                className="ux2-band-ink text-2xl font-bold tracking-tight flex items-baseline gap-1.5 group hover:opacity-90"
              >
                {/* No chevron. The ticker is the control — it underlines on
                    hover, which says "this does something" without spending
                    a glyph beside the asset's name to say it. */}
                <span className="group-hover:underline underline-offset-4 decoration-white/30">{asset.symbol}</span>
              </button>
              <span className="ux2-band-muted text-base font-normal truncate max-w-[34ch]">{asset.company_name}</span>

              {p.priceText ? (
                <span className="flex items-baseline gap-2 ml-1">
                  <span className="ux2-band-ink text-xl font-semibold tabular-nums tracking-tight">{p.priceText}</span>
                  {/* Absent when the provider gave no usable previous close.
                      The price stands alone rather than carrying a change
                      computed against a zero. */}
                  {p.changeText && (
                    <span className={clsx('text-sm font-semibold tabular-nums', up ? 'ux2-pos' : 'ux2-neg')}>
                      {p.changeText}{p.changePercentText && <> {p.changePercentText}</>}
                    </span>
                  )}
                </span>
              ) : (
                <span className="ux2-band-muted text-sm ml-1" data-testid="asset-price-unavailable">
                  {p.unavailable}
                </span>
              )}
            </div>

            {/* The metadata row. One line, muted, fixed order: venue,
                currency, security type, then exposure and the price's
                provenance. Everything here is either read off a column or
                stated by the provider. Nothing is inferred. */}
            <div className="mt-1 flex items-center gap-2 flex-wrap text-xs ux2-band-muted">
              {facts.length > 0 && (
                <span className="tracking-wide">{facts.join(' · ')}</span>
              )}

              {/* Held or not held, which is the first thing a PM looks for
                  and was previously only reachable by opening a popover. */}
              {!headerContext?.isLoading && !headerContext?.isError && (
                <>
                  {facts.length > 0 && <span aria-hidden="true">·</span>}
                  <button
                    type="button"
                    onClick={() => portfolioCount > 0 && onOpenList('portfoliosContent')}
                    disabled={portfolioCount === 0}
                    className={clsx(
                      'tracking-wide',
                      portfolioCount > 0
                        ? 'underline-offset-4 hover:underline cursor-pointer'
                        : 'cursor-default',
                    )}
                  >
                    {portfolioCount > 0
                      ? `Held in ${portfolioCount} portfolio${portfolioCount === 1 ? '' : 's'}`
                      : 'Not held'}
                  </button>
                </>
              )}

              {caption && (
                <>
                  <span aria-hidden="true">·</span>
                  <span
                    className={clsx('tracking-wide', p.isStale && 'ux2-neg font-medium')}
                    title={p.asOfISO ?? undefined}
                  >
                    {p.isStale ? `Stale: ${caption}` : caption}
                  </span>
                </>
              )}
            </div>
          </div>

          {showTickerDropdown && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowTickerDropdown(false)} />
              <div className="absolute top-full left-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl z-20 p-4 min-w-[320px] max-h-viewport-70 overflow-y-auto text-left">
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Coverage</h4>
                      {onNavigate && (
                        <button
                          onClick={() => { setShowTickerDropdown(false); onNavigate({ id: 'coverage', title: 'Coverage', type: 'coverage', data: { assetId: asset.id, assetSymbol: asset.symbol } }) }}
                          className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                        >
                          <span>Go to Coverage</span><ExternalLink className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                    <CoverageDisplay
                      assetId={asset.id}
                      coverage={coverage || []}
                      showHeader={false}
                      thesisStatuses={thesisStatuses}
                      showThesisStatus={true}
                      onUserClick={(u) => { if (onNavigate) onNavigate({ id: u.id, title: u.full_name, type: 'user', data: u }) }}
                    />
                  </div>
                  {sector && (
                    <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-1">Sector</h4>
                      <p className="text-sm text-gray-900 dark:text-gray-100">{sector}</p>
                    </div>
                  )}
                  <div className="pt-4 border-t border-gray-200 dark:border-gray-700">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Context</h4>
                    {headerContext?.isError ? (
                      <p className="text-xs text-gray-400 italic">Context unavailable</p>
                    ) : headerContext?.isLoading ? (
                      <div className="space-y-2">{[1, 2, 3, 4].map(i => <div key={i} className="h-5 bg-gray-100 dark:bg-gray-700 rounded animate-pulse" />)}</div>
                    ) : (
                      <div className="space-y-1">
                        {rows.map(({ icon: Icon, label, count, focus }) => (
                          <div key={focus} className="flex items-center justify-between py-1 group/row">
                            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
                              <Icon className="w-3.5 h-3.5 text-gray-400" />
                              <span>{count > 0 ? `${count} ${label}${count !== 1 ? 's' : ''}` : `No ${label}s`}</span>
                            </div>
                            {count > 0 && (
                              <button
                                onClick={() => { setShowTickerDropdown(false); onOpenList(focus) }}
                                className="text-xs text-primary-600 hover:text-primary-700 font-medium opacity-0 group-hover/row:opacity-100 transition-opacity"
                              >
                                View
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Actions: Ask AI + the one attention surface, behind the ⚡ trigger */}
        <div className="flex items-center gap-2 shrink-0">
          <button type="button" onClick={() => askAI(askTarget)} className="ux2-band-chip">
            <Sparkles className="h-4 w-4" />
            <span>Ask AI</span>
          </button>
          <AssetAttentionBand
            variant="popover"
            assetId={asset.id}
            symbol={asset.symbol ?? null}
            portfolioId={null}
            coveringUserIds={coveringUserIds}
            spot={spot}
            onFocus={onFocus}
          />
          {/* Collapse/expand the investment-context strip — compact, in-band. */}
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-pressed={collapsed}
            aria-label={collapsed ? 'Expand header' : 'Collapse header'}
            title={collapsed ? 'Show investment context' : 'Hide investment context'}
            className="ux2-band-iconbtn"
          >
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {!collapsed && (
        <AssetContextStrip
          assetId={asset.id}
          symbol={asset.symbol ?? null}
          spot={spot}
          onJump={onJumpTo}
          variant="band"
          className="mt-3"
        />
      )}
    </div>
  )
}
