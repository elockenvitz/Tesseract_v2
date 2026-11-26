/**
 * The bar under the cursor, in numbers.
 *
 * A crosshair tells a reader where they are pointing. It does not tell them
 * what traded there, and on this chart nothing did -- the open, high, low,
 * close and volume of the bar being pointed at were in memory and never
 * shown. Reading a value off the price axis by eye is the thing a terminal
 * exists to make unnecessary.
 *
 * Sits over the top-left of the canvas, which is the corner a price series
 * is least likely to occupy, and goes transparent to the pointer so it can
 * never swallow a click meant for the chart or for a mark.
 */
import { clsx } from 'clsx'
import { formatMoney } from '../../../lib/market-data/currency'
import type { OHLC } from '../engine/types'
/* The two formatters live in `lib/charting` because the crosshair's axis
   label needs `formatBarTime` too, and the two must agree -- when they did
   not, the readout said "Nov 9, 2026" and the label under the same
   crosshair said "Nov 3, 2026, 06:09 PM". */
import { formatBarTime, formatVolume } from '../../../lib/charting/bar-format'

export interface OhlcReadoutProps {
  bar: OHLC | null
  /** The bar size, so the timestamp can be shown at the right precision. */
  interval: string
}

export function OhlcReadout({ bar, interval }: OhlcReadoutProps) {
  if (!bar) return null

  /*
   * Green or red is the bar's own direction -- close against open -- not its
   * direction against the bar before it. Those differ, and on this surface
   * the first is the one a candle would be drawn with, so the colour and the
   * candle agree.
   */
  const up = bar.close >= bar.open

  return (
    <div
      data-charting-ohlc
      className="pointer-events-none absolute left-3 top-2 z-10 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded bg-white/85 px-2 py-1 font-mono text-[11px] tabular-nums backdrop-blur dark:bg-gray-900/85"
    >
      <span className="text-gray-500 dark:text-gray-400">{formatBarTime(bar.time, interval)}</span>
      <Field label="O" value={formatMoney(bar.open)} />
      <Field label="H" value={formatMoney(bar.high)} />
      <Field label="L" value={formatMoney(bar.low)} />
      <Field
        label="C"
        value={formatMoney(bar.close)}
        className={up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}
      />
      {/*
        Volume is omitted rather than shown as 0 when the feed did not send
        it. A zero share count is a claim that nothing traded, which is a
        very different statement from "this feed does not carry volume".
      */}
      {bar.volume > 0 && <Field label="V" value={formatVolume(bar.volume)} />}
    </div>
  )
}

function Field({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-gray-400">{label}</span>{' '}
      <span className={clsx('text-gray-900 dark:text-gray-100', className)}>{value}</span>
    </span>
  )
}
