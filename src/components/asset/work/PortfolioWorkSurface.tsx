import { clsx } from 'clsx'
import { Lightbulb } from 'lucide-react'
import { ContextualWorkHeader } from './ContextualWorkHeader'
import {
  IDEA_STAGES, IDEA_STAGE_CONFIG, stageIndex, toIdeaStage,
} from '../../../lib/ideas/stage-model'

/**
 * A book, seen from one name in it.
 *
 * ── Why the numbers come from the caller ────────────────────────────────
 *
 * They are `exposureIn(portfolioId)`, which is `buildBook` — the canonical
 * holdings reduction, one snapshot per position, with the position's own
 * as-of date. This component computes nothing and must not: the 190.91%
 * weight that started this whole lane came from a second place deriving an
 * exposure its own way, and a portfolio surface that recomputed a weight
 * would be exactly that mistake again with a better view.
 *
 * Ideas are matched on portfolio ID, never on name. Two books can share a
 * name across organizations, and a surface that attributed one firm's idea
 * to another firm's book because the strings matched would be worse than
 * showing nothing.
 */

export interface PortfolioExposure {
  weightPct: number
  marketValue: number
  shares: number
  /** The holdings snapshot this line came from. Never omitted. */
  asOf: string | null
  bookValue: number
}

export interface PortfolioWorkSurfaceIdea {
  id: string
  action?: string | null
  stage?: string | null
  rationale?: string | null
}

interface Props {
  portfolio: { id: string; name: string }
  assetSymbol?: string | null
  /** Null while the books load; absent when the asset is not held. */
  exposure: PortfolioExposure | null
  exposureLoading?: boolean
  /** Open ideas on THIS asset in THIS book, matched by id. */
  ideas: readonly PortfolioWorkSurfaceIdea[]
  back: { label: string; onBack: () => void }
  onOpenFull: () => void
  onOpenIdea?: (ideaId: string) => void
  /** Opens the existing Add Idea modal with this asset AND this book set. */
  onStartIdea?: () => void
  className?: string
}

const money = (n: number) =>
  '$' + (Math.abs(n) >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2))

const stamp = (iso: string | null | undefined): string | null => {
  if (!iso) return null
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500'

export function PortfolioWorkSurface({
  portfolio, assetSymbol, exposure, exposureLoading, ideas, back, onOpenFull, onOpenIdea,
  onStartIdea, className,
}: Props) {
  const asOf = stamp(exposure?.asOf)

  return (
    <section className={clsx('min-w-0', className)} data-testid="portfolio-work-surface">
      <ContextualWorkHeader
        title={portfolio.name}
        kindLabel="Portfolio"
        detail={
          exposureLoading
            ? 'Reading the book…'
            : exposure
              ? `${assetSymbol ?? 'This asset'} is held${asOf ? ` · book as of ${asOf}` : ''}`
              : `${assetSymbol ?? 'This asset'} is not held in this book`
        }
        back={back}
        openFull={{ label: 'Open the full portfolio', onOpen: onOpenFull }}
      />

      <div className="border-b border-gray-200 py-3 dark:border-gray-700">
        <span className={clsx(EYEBROW, 'mb-2 block')}>The position</span>
        {exposureLoading ? (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-[46px] animate-pulse rounded-md bg-gray-100 dark:bg-gray-800" />
            ))}
          </div>
        ) : !exposure ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="portfolio-not-held">
            No position in this book. The sidebar lists it because this asset
            has been held or traded here before.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 lg:grid-cols-4" data-testid="portfolio-position">
            <div>
              <span className={EYEBROW}>Weight</span>
              <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                {exposure.bookValue > 0 ? `${exposure.weightPct.toFixed(2)}%` : '—'}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                {exposure.bookValue > 0 ? `of ${money(exposure.bookValue)}` : 'book value unavailable'}
              </p>
            </div>
            <div>
              <span className={EYEBROW}>Market value</span>
              <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                {money(exposure.marketValue)}
              </p>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">at the book price</p>
            </div>
            <div>
              <span className={EYEBROW}>Shares</span>
              <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">
                {Math.round(exposure.shares).toLocaleString('en-US')}
              </p>
            </div>
            <div>
              <span className={EYEBROW}>As of</span>
              <p className="text-[15px] font-semibold text-gray-900 dark:text-gray-100">{asOf ?? '—'}</p>
              <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                {asOf ? 'holdings snapshot' : 'no snapshot date recorded'}
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="py-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className={EYEBROW}>Open ideas in this book</span>
          {/*
            Creating the idea from the book that will hold it is the whole
            point of the shortcut: the modal needs a portfolio, and this is
            the one place in the app that already knows which.
          */}
          {onStartIdea && (
            <button
              type="button"
              data-testid="portfolio-start-idea"
              onClick={onStartIdea}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary-700"
            >
              <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />
              Start an idea here
            </button>
          )}
        </div>
        {ideas.length === 0 ? (
          <p className="text-[12px] text-gray-500 dark:text-gray-400" data-testid="portfolio-no-ideas">
            No open ideas on {assetSymbol ?? 'this asset'} in this book.
          </p>
        ) : (
          <ul className="space-y-1" data-testid="portfolio-ideas">
            {ideas.map(i => {
              /*
                How far along, not just what it is called. The stage is
                normalised first because production still holds
                pre-migration values, and a raw one would light no pip at
                all — the reader would see an idea apparently at no stage.
              */
              const at = i.stage ? toIdeaStage(i.stage) : null
              const reached = at ? stageIndex(at) : -1
              return (
                <li key={i.id}>
                  <button
                    type="button"
                    onClick={() => onOpenIdea?.(i.id)}
                    disabled={!onOpenIdea}
                    data-testid={`portfolio-idea-${i.id}`}
                    className="w-full rounded-md border border-transparent px-2 py-2 text-left hover:border-gray-200 hover:bg-gray-50 disabled:cursor-default dark:hover:border-gray-700 dark:hover:bg-gray-800"
                  >
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="text-[13px] font-medium text-gray-900 dark:text-gray-100">
                        {(i.action ?? 'Idea').toUpperCase()}
                      </span>
                      {at && (
                        <>
                          <span
                            className="flex items-center gap-0.5"
                            data-testid={`portfolio-idea-track-${i.id}`}
                            aria-hidden="true"
                          >
                            {IDEA_STAGES.map((s, n) => (
                              <span
                                key={s}
                                className={clsx(
                                  'h-1 w-4 rounded-full',
                                  n <= reached
                                    ? 'bg-primary-600'
                                    : 'bg-gray-200 dark:bg-gray-700',
                                )}
                              />
                            ))}
                          </span>
                          <span className="text-[11px] text-gray-500 dark:text-gray-400">
                            {IDEA_STAGE_CONFIG[at].label}
                          </span>
                        </>
                      )}
                    </span>
                    {i.rationale && (
                      <span className="mt-0.5 line-clamp-1 block text-[12px] text-gray-600 dark:text-gray-300">
                        {i.rationale}
                      </span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </section>
  )
}
