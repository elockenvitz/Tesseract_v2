import { clsx } from 'clsx'
import { Scale, Layers3 } from 'lucide-react'
import { FeedTileHeader } from './FeedTileHeader'
import { FeedKindBadge } from './FeedKindBadge'
import type { ConvictionGap, CrowdedName } from '../../hooks/mobile/usePortfolioLenses'

interface ConvictionTileProps {
  gap: ConvictionGap
  onAssetClick?: (assetId: string, symbol: string) => void
  onFilterKind?: () => void
}

const money = (n: number) =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `$${(n / 1e3).toFixed(0)}K`
  : `$${n.toFixed(0)}`

/**
 * Conviction against position size.
 *
 * Every other portfolio surface reports what a position *is*. This asks
 * whether its size matches the view being taken on it, which is a question
 * nobody is otherwise prompted to answer — and the two corners it surfaces are
 * the ones that go unnoticed longest. A name everyone agrees is cheap, held at
 * 0.4%, earns nothing if it works. A 6% position whose own base target implies
 * no upside is a bet on a view that has already been abandoned on paper.
 *
 * Conviction is the base price target rather than a rating: a rating is a
 * label picked from a list, a target is a number someone had to defend.
 */
export function ConvictionGapTile({ gap, onAssetClick, onFilterKind }: ConvictionTileProps) {
  const under = gap.direction === 'underweight'
  const upside = Math.round(gap.upsidePct * 100)

  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <FeedTileHeader
        badge={
          <FeedKindBadge
            icon={Scale}
            label="Sizing"
            chip="bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300"
            onFilter={onFilterKind}
            filterLabel="Show only sizing checks"
          />
        }
        headline={under ? 'Conviction without size' : 'Size without conviction'}
      />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-5 pb-4">
        <button
          type="button"
          onClick={() => onAssetClick?.(gap.assetId, gap.symbol)}
          className="text-left no-touch-target"
        >
          <div className="text-[34px] font-black leading-none tracking-[-0.035em] text-gray-900 dark:text-white">
            {gap.symbol}
          </div>
          {gap.companyName && (
            <div className="mt-1 text-[13px] font-medium text-gray-500 dark:text-gray-400 truncate">
              {gap.companyName}
            </div>
          )}
        </button>

        {/* The two numbers side by side, because the tension between them is
            the entire point — reading either alone says nothing. */}
        <div className="mt-6 grid grid-cols-2 gap-3">
          <Figure
            label="Implied upside"
            value={`${upside > 0 ? '+' : ''}${upside}%`}
            tone={upside >= 25 ? 'good' : upside <= 5 ? 'bad' : 'flat'}
            note="to base target"
          />
          <Figure
            label="Position"
            value={`${gap.weightPct.toFixed(1)}%`}
            tone={under ? 'bad' : 'good'}
            note={gap.portfolioName}
          />
        </div>

        <p className="mt-6 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
          {under ? (
            <>
              The base case says <strong>{gap.symbol}</strong> is worth {upside}% more
              than it trades at, and it is {gap.weightPct.toFixed(1)}% of{' '}
              {gap.portfolioName}. If the view is right, the position is too small
              to matter.
            </>
          ) : (
            <>
              <strong>{gap.symbol}</strong> is {gap.weightPct.toFixed(1)}% of{' '}
              {gap.portfolioName}, and the base target implies{' '}
              {upside <= 0 ? 'no upside left' : `only ${upside}% upside`}. The size
              is carrying a view the target no longer supports.
            </>
          )}
        </p>

        <p className="mt-4 text-[12px] text-gray-400 dark:text-gray-500">
          Based on the most recent base price target. If that number is stale, this
          is telling you that too.
        </p>
      </div>
    </div>
  )
}

interface CrowdedTileProps {
  name: CrowdedName
  onAssetClick?: (assetId: string, symbol: string) => void
  onFilterKind?: () => void
}

/**
 * One name, several portfolios.
 *
 * Per-portfolio views are correct and individually reassuring: 3% here, 4%
 * there, nothing out of line anywhere. The exposure only becomes visible when
 * the books are looked at together, which no other screen does — so a name can
 * become the firm's largest single bet without any one view ever showing it.
 */
export function CrowdedNameTile({ name, onAssetClick, onFilterKind }: CrowdedTileProps) {
  return (
    <div className="relative w-full h-full flex flex-col bg-white dark:bg-gray-900">
      <FeedTileHeader
        badge={
          <FeedKindBadge
            icon={Layers3}
            label="Crowding"
            chip="bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"
            onFilter={onFilterKind}
            filterLabel="Show only crowding"
          />
        }
        headline={`Held in ${name.portfolioCount} portfolios`}
      />

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pt-5 pb-4">
        <button
          type="button"
          onClick={() => onAssetClick?.(name.assetId, name.symbol)}
          className="text-left no-touch-target"
        >
          <div className="text-[34px] font-black leading-none tracking-[-0.035em] text-gray-900 dark:text-white">
            {name.symbol}
          </div>
          {name.companyName && (
            <div className="mt-1 text-[13px] font-medium text-gray-500 dark:text-gray-400 truncate">
              {name.companyName}
            </div>
          )}
        </button>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <Figure
            label="Portfolios"
            value={String(name.portfolioCount)}
            tone={name.portfolioCount >= 4 ? 'bad' : 'flat'}
            note="hold this name"
          />
          <Figure
            label="Largest weight"
            value={`${name.maxWeightPct.toFixed(1)}%`}
            tone={name.maxWeightPct >= 5 ? 'bad' : 'flat'}
            note="in one book"
          />
        </div>

        <p className="mt-6 text-[15px] leading-relaxed text-gray-700 dark:text-gray-300">
          <strong>{name.symbol}</strong> is held across {name.portfolioCount}{' '}
          portfolios, {money(name.totalValue)} in total. Each position looks
          reasonable on its own — the concentration only exists at the firm level.
        </p>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {name.portfolioNames.slice(0, 6).map(p => (
            <span
              key={p}
              className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-[11px] font-medium text-gray-600 dark:text-gray-300"
            >
              {p}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Figure({
  label, value, note, tone,
}: {
  label: string
  value: string
  note?: string
  tone: 'good' | 'bad' | 'flat'
}) {
  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 px-3.5 py-3">
      <div className="text-[10px] font-bold uppercase tracking-[0.06em] text-gray-400">
        {label}
      </div>
      <div
        className={clsx(
          'mt-1 text-[26px] font-black leading-none tracking-[-0.03em]',
          tone === 'good' && 'text-emerald-500 dark:text-emerald-400',
          tone === 'bad' && 'text-rose-500 dark:text-rose-400',
          tone === 'flat' && 'text-gray-900 dark:text-white',
        )}
      >
        {value}
      </div>
      {note && (
        <div className="mt-1 text-[11px] text-gray-400 dark:text-gray-500 truncate">{note}</div>
      )}
    </div>
  )
}
