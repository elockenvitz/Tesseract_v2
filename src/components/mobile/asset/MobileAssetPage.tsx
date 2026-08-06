import { useState } from 'react'
import { clsx } from 'clsx'
import { Briefcase, FileText, Layers, ListChecks, TrendingUp } from 'lucide-react'
import { MobileCaseView } from './MobileCaseView'
import { TickerQuoteBadge } from '../TickerQuoteBadge'
import { ExpandableText } from '../ExpandableText'
import { useAssetTradeIdeas } from '../../../hooks/useAssetTradeIdeas'
import { useAssetHeaderContext } from '../../../hooks/useAssetHeaderContext'
import { useAssetPortfolioWeights } from '../../../hooks/useAssetPortfolioWeights'

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
        {subPage === 'case' && <MobileCaseView assetId={asset.id} />}

        {subPage === 'decisions' && <DecisionsPanel assetId={asset.id} onNavigate={onNavigate} />}

        {subPage === 'lists' && <ListsPanel assetId={asset.id} onNavigate={onNavigate} />}
      </div>
    </div>
  )
}

function DecisionsPanel({
  assetId,
  onNavigate,
}: {
  assetId: string
  onNavigate?: (result: any) => void
}) {
  const { ideas, isLoading } = useAssetTradeIdeas({ assetId, limit: 25 })

  if (isLoading) return <PanelSkeleton />
  if (!ideas.length) {
    return <EmptyPanel icon={TrendingUp} message="Nothing in flight on this name." />
  }

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

          {idea.rationale && <ExpandableText text={idea.rationale} lines={3} />}

          <p className="mt-1.5 text-[11px] text-gray-400 truncate">
            {idea.portfolio?.name ?? 'No portfolio'}
            {idea.creator &&
              ` · ${[idea.creator.first_name, idea.creator.last_name].filter(Boolean).join(' ')}`}
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
  const { data: weights = [], isLoading: weightsLoading } = useAssetPortfolioWeights(assetId)

  if (isLoading || weightsLoading) return <PanelSkeleton />

  const groups = [
    {
      title: 'Portfolios',
      icon: Briefcase,
      rows: weights.map(w => ({
        id: w.portfolioId,
        name: w.name,
        weight: w.weight,
        shares: w.shares,
        marketValue: w.marketValue,
        asOf: w.asOf,
      })),
      type: 'portfolio',
      // Weights come from periodic position snapshots, so the date they were
      // struck belongs on screen. "Current" with no date invites acting on a
      // number that may be weeks old.
      asOf: weights[0]?.asOf ?? null,
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
                  as of {formatAsOf(group.asOf)}
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
                      {row.marketValue != null && (
                        <span className="block text-[10px] text-gray-400 tabular-nums">
                          {formatCompactUsd(row.marketValue)}
                        </span>
                      )}
                    </span>
                  ) : 'asOf' in row ? (
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
