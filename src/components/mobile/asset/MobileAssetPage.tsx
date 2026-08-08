import { useState } from 'react'
import { clsx } from 'clsx'
import { Briefcase, FileText, Layers, ListChecks, TrendingUp } from 'lucide-react'
import { MobileCaseView } from './MobileCaseView'
import { TickerQuoteBadge } from '../TickerQuoteBadge'
import { ExpandableText } from '../ExpandableText'
import { useAssetTradeIdeas } from '../../../hooks/useAssetTradeIdeas'
import { useAssetRecentDecisions, getDecisionLabel } from '../../../hooks/useAssetRecentDecisions'
import { useAssetHeaderContext } from '../../../hooks/useAssetHeaderContext'
import { useAssetPortfolioWeights } from '../../../hooks/useAssetPortfolioWeights'
import { useAssetLiveWeights } from '../../../hooks/useAssetLiveWeights'

interface MobileAssetPageProps {
  asset: { id: string; symbol: string; company_name?: string | null }
  onNavigate?: (result: any) => void
}

type SubPage = 'case' | 'decisions' | 'lists'

const SUB_PAGES: { key: SubPage; label: string; icon: typeof FileText }[] = [
  { key: 'case', label: 'Case', icon: FileText },
  { key: 'decisions', label: 'Decisions', icon: TrendingUp },
  { key: 'lists', label: 'Lists', icon: Layers },
]


/**
 * The asset page, built for a phone.
 *
 * The desktop AssetTab is 4,300 lines carrying four sub-pages, an
 * aggregated-versus-per-analyst view filter, four thesis view modes, custom
 * widgets, analyst estimates and consensus panels. Reflowing that onto 390px
 * was tried on the dashboard and did not converge; this reuses the same hooks
 * and rebuilds only the surface.
 *
 * Three tabs, because they answer the three questions worth asking on a phone:
 * what do we think (Case), what are we doing about it (Decisions), and where
 * does it sit (Lists). Process/workflow stays on desktop — stage management is
 * a wide control and a poor fit for a thumb.
 */
export function MobileAssetPage({ asset, onNavigate }: MobileAssetPageProps) {
  const [subPage, setSubPage] = useState<SubPage>('case')

  return (
    <div className="h-full flex flex-col bg-gray-50 dark:bg-gray-950">
      {/* Header: identity and price, nothing else. The desktop header also
          carries coverage, priority, workflow and visibility controls; on a
          phone those belong to the section that uses them. */}
      <div className="flex-shrink-0 px-3 pt-3 pb-2 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white truncate">
              {asset.symbol}
            </h1>
            {asset.company_name && (
              <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                {asset.company_name}
              </p>
            )}
          </div>
          <TickerQuoteBadge symbol={asset.symbol} showSymbol={false} className="shrink-0" />
        </div>
      </div>

      <div className="flex-shrink-0 flex items-stretch gap-1 px-2 py-1.5 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        {SUB_PAGES.map(p => {
          const Icon = p.icon
          const active = subPage === p.key
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setSubPage(p.key)}
              aria-current={active}
              className={clsx(
                'flex-1 flex items-center justify-center gap-1.5 h-9 rounded-lg text-sm font-medium transition-colors no-touch-target',
                active
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800'
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {p.label}
            </button>
          )
        })}
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3 pb-safe space-y-3">
        {subPage === 'case' && <MobileCaseView assetId={asset.id} symbol={asset.symbol} />}

        {subPage === 'decisions' && <DecisionsPanel assetId={asset.id} onNavigate={onNavigate} />}

        {subPage === 'lists' && <ListsPanel assetId={asset.id} onNavigate={onNavigate} />}
      </div>
    </div>
  )
}

/**
 * What is being done about this name — proposed and already decided.
 *
 * useAssetTradeIdeas filters to `outcome IS NULL`, so on its own this tab
 * showed only what was still open and silently dropped every idea that had
 * actually been decided. A tab called "Decisions" that cannot show a decision
 * is the wrong way round, so the resolved items are fetched alongside and
 * listed underneath.
 */
function DecisionsPanel({
  assetId,
  onNavigate,
}: {
  assetId: string
  onNavigate?: (result: any) => void
}) {
  const { ideas, isLoading } = useAssetTradeIdeas({ assetId, limit: 25 })
  const { decisions, isLoading: decisionsLoading } = useAssetRecentDecisions({ assetId, limit: 25 })

  if (isLoading || decisionsLoading) return <PanelSkeleton />
  if (!ideas.length && !decisions.length) {
    return <EmptyPanel icon={TrendingUp} message="Nothing proposed or decided on this name." />
  }

  return (
    <div className="space-y-4">
      {ideas.length > 0 && (
        <div className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            In flight · {ideas.length}
          </h2>
          <InFlightList ideas={ideas} onNavigate={onNavigate} />
        </div>
      )}

      {decisions.length > 0 && (
        <div className="space-y-2">
          <h2 className="px-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
            Decided · {decisions.length}
          </h2>
          <div className="space-y-2">
            {decisions.map(d => (
              <button
                key={d.id}
                type="button"
                onClick={() =>
                  onNavigate?.({ id: 'outcomes', title: 'Decision Outcomes', type: 'outcomes', data: null })
                }
                className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 active:bg-gray-50 dark:active:bg-gray-800"
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span
                    className={clsx(
                      'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                      DECISION_TONE(d.outcome, d.decision_outcome)
                    )}
                  >
                    {getDecisionLabel(d.action, d.outcome, d.decision_outcome)}
                  </span>
                  {d.proposed_weight != null && (
                    <span className="text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                      {d.proposed_weight}%
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-[11px] text-gray-400">
                    {formatAsOf(d.outcome_at ?? d.decided_at ?? '')}
                  </span>
                </div>

                {d.rationale && <ExpandableText text={d.rationale} lines={3} />}

                <p className="mt-1.5 text-[11px] text-gray-400 truncate">
                  {d.portfolio?.name ?? 'No portfolio'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/** Rejected and deferred read differently from executed; colour says which. */
function DECISION_TONE(outcome: string | null, decisionOutcome: string | null): string {
  const v = outcome ?? decisionOutcome
  if (v === 'rejected') return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
  if (v === 'deferred') return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
  return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
}

function InFlightList({
  ideas,
  onNavigate,
}: {
  ideas: ReturnType<typeof useAssetTradeIdeas>['ideas']
  onNavigate?: (result: any) => void
}) {
  return (
    <div className="space-y-2">
      {ideas.map(idea => (
        <button
          key={idea.id}
          type="button"
          onClick={() =>
            onNavigate?.({ id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue', data: null })
          }
          className="w-full text-left rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 active:bg-gray-50 dark:active:bg-gray-800"
        >
          <div className="flex items-center gap-2 mb-1.5">
            <span
              className={clsx(
                'px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide',
                idea.action === 'buy' || idea.action === 'add'
                  ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                  : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
              )}
            >
              {idea.action}
            </span>
            <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 truncate">
              {idea.stage?.replace(/_/g, ' ')}
            </span>
            {/* Stated only when it exists. proposed_weight is optional, and a
                blank "—%" reads as a missing number rather than an absent one. */}
            {idea.proposed_weight != null && (
              <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                {idea.proposed_weight}%
              </span>
            )}
          </div>

          {/* The card fetched urgency, shares, target price, conviction and
              horizon and displayed none of them, so an idea with a full case
              behind it read as a bare action and a stage. */}
          {(idea.target_price != null ||
            idea.proposed_shares != null ||
            idea.conviction ||
            idea.time_horizon ||
            idea.urgency) && (
            <div className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500 dark:text-gray-400">
              {idea.target_price != null && (
                <span>
                  Target{' '}
                  <span className="font-semibold tabular-nums text-gray-700 dark:text-gray-200">
                    ${Number(idea.target_price).toFixed(2)}
                  </span>
                </span>
              )}
              {idea.proposed_shares != null && (
                <span className="tabular-nums">
                  {Number(idea.proposed_shares).toLocaleString()} sh
                </span>
              )}
              {idea.conviction && <span className="capitalize">{idea.conviction} conviction</span>}
              {idea.time_horizon && <span>{idea.time_horizon.replace(/_/g, ' ')}</span>}
              {idea.urgency && idea.urgency !== 'medium' && (
                <span className="capitalize font-medium text-amber-600 dark:text-amber-400">
                  {idea.urgency} urgency
                </span>
              )}
            </div>
          )}

          {idea.rationale && <ExpandableText text={idea.rationale} lines={3} />}

          <p className="mt-1.5 text-[11px] text-gray-400 truncate">
            {idea.portfolio?.name ?? 'No portfolio'}
            {idea.creator &&
              ` · ${[idea.creator.first_name, idea.creator.last_name].filter(Boolean).join(' ')}`}
            {` · ${formatAsOf(idea.updated_at)}`}
          </p>
        </button>
      ))}
    </div>
  )
}

function ListsPanel({
  assetId,
  onNavigate,
}: {
  assetId: string
  onNavigate?: (result: any) => void
}) {
  const { listsMine, listsShared, themes, isLoading } = useAssetHeaderContext(assetId)
  // Snapshot weights arrive in one query; the repriced ones need a quote for
  // every holding in the book. Show the snapshot immediately and upgrade it,
  // rather than holding the whole panel behind ~40 requests per portfolio.
  const { data: snapshotWeights = [], isLoading: weightsLoading } = useAssetPortfolioWeights(assetId)
  const { data: liveWeights, isFetching: repricing } = useAssetLiveWeights(assetId)

  if (isLoading || weightsLoading) return <PanelSkeleton />

  const live = new Map((liveWeights ?? []).map(w => [w.portfolioId, w]))

  const groups = [
    {
      title: 'Portfolios',
      icon: Briefcase,
      rows: snapshotWeights.map(w => {
        const repriced = live.get(w.portfolioId)
        return {
          id: w.portfolioId,
          name: w.name,
          weight: repriced?.weight ?? w.weight,
          marketValue: repriced?.marketValue ?? w.marketValue,
          isRepriced: repriced?.weight != null,
          // A portfolio missing prices has an incomplete denominator, which
          // overstates every weight in it. Say so rather than imply precision.
          unpricedCount: repriced?.unpricedCount ?? 0,
          holdingsCount: repriced?.holdingsCount ?? 0,
          asOf: w.asOf,
        }
      }),
      type: 'portfolio',
      asOf: repricing ? 'repricing' : live.size > 0 ? 'live' : snapshotWeights[0]?.asOf ?? null,
    },
    { title: 'My lists', icon: ListChecks, rows: listsMine ?? [], type: 'list' },
    { title: 'Shared lists', icon: ListChecks, rows: listsShared ?? [], type: 'list' },
    { title: 'Themes', icon: Layers, rows: themes ?? [], type: 'theme' },
  ].filter(g => g.rows.length > 0)

  if (!groups.length) {
    return <EmptyPanel icon={Layers} message="Not in any portfolio, list or theme." />
  }

  return (
    <div className="space-y-3">
      {groups.map(group => {
        const Icon = group.icon
        return (
          <section
            key={group.title}
            className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 overflow-hidden"
          >
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 dark:border-gray-800">
              <Icon className="h-4 w-4 text-gray-400 shrink-0" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {group.title}
              </h3>
              {group.asOf ? (
                <span className="ml-auto text-[11px] text-gray-400">
                  {group.asOf === 'repricing'
                    ? 'repricing…'
                    : group.asOf === 'live'
                      ? 'at last close'
                      : `as of ${formatAsOf(group.asOf)}`}
                </span>
              ) : (
                <span className="ml-auto text-xs text-gray-400">{group.rows.length}</span>
              )}
            </div>
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {group.rows.map((row: any) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() =>
                    onNavigate?.({
                      id: row.id,
                      title: row.name,
                      type: group.type,
                      data: row,
                    })
                  }
                  className="w-full flex items-center gap-2 min-h-[44px] px-3 py-2 text-left active:bg-gray-50 dark:active:bg-gray-800"
                >
                  <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200 truncate">
                    {row.name}
                  </span>
                  {row.weight != null ? (
                    <span className="shrink-0 text-right">
                      <span className="block text-sm font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                        {row.weight.toFixed(2)}%
                      </span>
                      {row.unpricedCount > 0 ? (
                        <span className="block text-[10px] text-amber-600 dark:text-amber-400">
                          {row.unpricedCount} of {row.holdingsCount} unpriced
                        </span>
                      ) : row.marketValue != null ? (
                        <span className="block text-[10px] text-gray-400 tabular-nums">
                          {formatCompactUsd(row.marketValue)}
                          {!row.isRepriced && ` · ${formatAsOf(row.asOf)}`}
                        </span>
                      ) : null}
                    </span>
                  ) : 'unpricedCount' in row ? (
                    // Held, but the snapshot carried no weight. Saying so beats
                    // printing 0.00%, which asserts the position is negligible.
                    <span className="shrink-0 text-[11px] text-gray-400">weight n/a</span>
                  ) : null}
                </button>
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** Snapshot dates are calendar days; time of day would be noise. */
function formatAsOf(date: string): string {
  const parsed = new Date(date)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function formatCompactUsd(value: number): string {
  const abs = Math.abs(value)
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}m`
  if (abs >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  return `$${value.toFixed(0)}`
}

function PanelSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map(i => (
        <div
          key={i}
          className="h-20 rounded-xl bg-gray-100 dark:bg-gray-800 animate-pulse"
        />
      ))}
    </div>
  )
}

function EmptyPanel({ icon: Icon, message }: { icon: typeof Layers; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-gray-400">
      <Icon className="h-8 w-8 opacity-50" />
      <p className="text-sm">{message}</p>
    </div>
  )
}
