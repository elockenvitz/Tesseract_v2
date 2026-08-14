import { clsx } from 'clsx'
import { TickerQuoteBadge } from './TickerQuoteBadge'

interface FeedTileTitleProps {
  /** The instruction, e.g. "buy" / "sell" / "add" / "trim". */
  action?: string | null
  symbol?: string | null
  /** Pair trades name both sides instead of a single symbol. */
  longSymbols?: string[]
  shortSymbols?: string[]
  /** Used when the tile leads with a headline rather than an instruction. */
  headline?: string | null
  subtitle?: string | null
  /** Quote shown beside the title. Omitted for pair trades, whose legs each
   *  carry their own inside the carousel. */
  quoteSymbol?: string | null
  quoteCompanyName?: string | null
  className?: string
}

/**
 * The instruction band between a tile's header and its chart.
 *
 * Every tile leads with what it is asking of the reader — "SELL DASH", "BUY
 * MSFT" — before any supporting detail. Trade ideas previously buried this in
 * a small chip below the chart, so the same instruction read completely
 * differently depending on whether it arrived as an idea or as a decision.
 *
 * The quote sits here rather than in the header, where it collided with
 * attribution. Its symbol is suppressed when the title already names it: a
 * row reading "BUY MSFT   MSFT $412.30" says the ticker twice and spends the
 * width that the price and company name need.
 */
export function FeedTileTitle({
  action,
  symbol,
  longSymbols = [],
  shortSymbols = [],
  headline,
  subtitle,
  quoteSymbol,
  quoteCompanyName,
  className,
}: FeedTileTitleProps) {
  const isPair = longSymbols.length > 0 || shortSymbols.length > 0
  const hasTitle = isPair || !!action || !!symbol || !!headline

  // Nothing to title means the quote gets the band to itself, at full size,
  // rather than being squeezed into a corner of an empty row.
  if (!hasTitle && quoteSymbol) {
    return (
      <div className={clsx('flex-shrink-0 px-3 pt-1.5 pb-1', className)}>
        <TickerQuoteBadge symbol={quoteSymbol} companyName={quoteCompanyName} variant="lead" />
        {subtitle && (
          <p className="mt-1 text-[13px] leading-snug font-medium text-gray-500 dark:text-gray-400">{subtitle}</p>
        )}
      </div>
    )
  }

  return (
    <div className={clsx('flex-shrink-0 px-3 pt-2.5 pb-1.5', className)}>
      <div className="flex items-start justify-between gap-2">
        {/* 30px, tight tracking, black weight.
            This is the one element a reader should land on before deciding
            whether to stop scrolling, and at text-2xl/bold it was only a step
            above the 13px chrome around it. The jump from 10px badge to 30px
            instruction is what makes the tile resolve at a glance instead of
            asking to be read. Tight tracking keeps a long "SELL DASH" on one
            line at the larger size. */}
        <h2 className="min-w-0 text-[30px] font-black leading-[1.05] tracking-[-0.035em]">
          {isPair ? (
            // Both sides named and coloured. A plain "A / B vs C / D" left the
            // reader guessing which side was being bought.
            <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[22px]">
              {longSymbols.length > 0 && (
                <span className="text-emerald-500 dark:text-emerald-400">
                  BUY {longSymbols.join(' / ')}
                </span>
              )}
              {longSymbols.length > 0 && shortSymbols.length > 0 && (
                <span className="text-gray-400 text-sm font-semibold uppercase tracking-wide">vs</span>
              )}
              {shortSymbols.length > 0 && (
                <span className="text-rose-500 dark:text-rose-400">
                  SELL {shortSymbols.join(' / ')}
                </span>
              )}
            </span>
          ) : action || symbol ? (
            <>
              {action && <span className={actionTone(action)}>{action.toUpperCase()}</span>}
              {action && symbol ? ' ' : null}
              {symbol && <span className="text-gray-900 dark:text-white">{symbol}</span>}
            </>
          ) : (
            <span className="text-[22px] text-gray-900 dark:text-white">{headline}</span>
          )}
        </h2>

        {quoteSymbol && (
          <TickerQuoteBadge
            symbol={quoteSymbol}
            companyName={quoteCompanyName}
            showSymbol={quoteSymbol !== symbol}
            className="shrink-0 pt-0.5"
          />
        )}
      </div>

      {subtitle && (
        <p className="mt-1 text-[13px] leading-snug font-medium text-gray-500 dark:text-gray-400">{subtitle}</p>
      )}
    </div>
  )
}

/** Green buys, red sells — the same mapping the rest of the app uses. */
function actionTone(action: string): string {
  const a = action.toLowerCase()
  if (a === 'buy' || a === 'add') return 'text-emerald-500 dark:text-emerald-400'
  if (a === 'sell' || a === 'trim') return 'text-rose-500 dark:text-rose-400'
  return 'text-gray-900 dark:text-white'
}
