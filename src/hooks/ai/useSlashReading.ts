/**
 * The read behind a market-data Slash Command.
 *
 * `/price.AAPL` used to expand into the sentence "What is the current price
 * of AAPL?" and the reader sent it. A deterministic command became a model
 * request: latency, cost, and an answer that might come back hedged,
 * rounded, or about a different day. This does the lookup instead.
 *
 * ── What it reads, and under whose authority ────────────────────────────
 *
 * `marketDataReader.latestClose`, which goes through
 * `price_history_cache` under the CALLER's own RLS -- the same path the
 * asset page's own price band uses. No new table, no new policy, no
 * privileged function, and nothing a reader could not already see. The
 * figure arrives wrapped in `Observed`, so its provider, how it reached us
 * and the date it was TRUE travel with it rather than beside it.
 *
 * ── Symbol resolution is not string matching ───────────────────────────
 *
 * `/price.LRCX` is a ticker, and a ticker is not an identity: it can be
 * reissued after a delisting, and two listings can share one. So it goes
 * through `assetAccess.resolveSymbol`, which reports `ambiguous`
 * separately -- and an ambiguous ticker is REPORTED, never silently
 * resolved to the first candidate. Picking one would put a figure from the
 * wrong instrument in front of a reader with full provenance attached to
 * it, which is worse than no figure.
 *
 * ── Why this is a hook and not part of the pure module ─────────────────
 *
 * It needs Supabase. The classification, the formatting and the provenance
 * sentence live in `lib/ai/slash-market-data.ts`, where they can be tested
 * without a database; this is only the fetch.
 */
import { useQuery } from '@tanstack/react-query'
import { marketDataReader } from '../../lib/market-data/supabase-price-source'
import { assetAccess } from '../../lib/market-data/supabase-asset-source'
import { DEFAULT_SERIES_POINTS } from '../../lib/market-data'
import {
  slashDataKind, isRetrievableData, type SlashReading,
} from '../../lib/ai/slash-market-data'

export interface UseSlashReadingArgs {
  /** The command id, e.g. `price`. */
  id: string | null
  /** The ticker the reader attached, upper-cased. */
  symbol: string | null
}

/**
 * Null when there is nothing to read -- no command, no symbol, or a command
 * the store cannot answer. The caller renders the blocker in that case,
 * which is a statement rather than a pending request.
 */
export function useSlashReading({ id, symbol }: UseSlashReadingArgs): SlashReading | null {
  const enabled = !!id && !!symbol && isRetrievableData(id)

  const query = useQuery({
    queryKey: ['slash-reading', id, symbol],
    enabled,
    /*
     * A minute. A close does not change intraday, and a reader typing
     * `/price.AAPL` twice in one thought should not pay for two reads.
     * Short enough that the nightly job's result shows up the same session.
     */
    staleTime: 60_000,
    retry: false,
    queryFn: async (): Promise<SlashReading> => {
      const cmd = id as string
      const ticker = symbol as string
      const base: SlashReading = { state: 'loading', id: cmd, symbol: ticker }

      const resolution = await assetAccess.resolveSymbol(ticker)

      if (resolution.status === 'not_found') {
        return {
          ...base, state: 'empty',
          detail: `No instrument called ${ticker} is in your universe.`,
        }
      }
      if (resolution.status === 'ambiguous') {
        /* Reported, not resolved. See the header. */
        const names = resolution.candidates
          .map(c => c.recordedSymbol + (c.mic ? ` (${c.mic})` : ''))
          .join(', ')
        return {
          ...base, state: 'empty',
          detail: `${ticker} matches more than one instrument (${names}). Open the one you mean and ask there.`,
        }
      }

      const ref = resolution.ref
      const kind = slashDataKind(cmd)

      if (kind === 'change') {
        /*
         * Two closes, differenced. The SERIES read rather than two single
         * reads, because the second-newest close is whatever the series
         * says it is -- subtracting a day from today's date lands on a
         * weekend or a holiday and finds nothing.
         */
        const series = await marketDataReader.closeSeries(ref, { points: Math.min(8, DEFAULT_SERIES_POINTS) })
        const bars = series.observed?.value ?? []
        if (bars.length < 2) {
          return {
            ...base, state: 'empty',
            detail: bars.length === 1
              ? `Only one close is stored for ${series.displaySymbol}, so there is nothing to compare it with.`
              : `No closes are stored for ${series.displaySymbol}.`,
          }
        }
        /*
         * ASCENDING. `fetchBars` sorts that way (reads.ts) because that is how
         * a chart draws, so the two most recent are the LAST two. Reading
         * `bars[0]` and `bars[1]` here would difference the two oldest closes
         * in the window and attach correct provenance to a wrong number.
         */
        const newest = bars[bars.length - 1]
        const prior = bars[bars.length - 2]
        return {
          ...base,
          state: 'ok',
          symbol: series.displaySymbol,
          observed: { ...series.observed!, value: newest.close },
          verdict: series.verdict,
          label: 'Change on the last stored session',
          previous: { close: prior.close, date: prior.date },
        }
      }

      const read = await marketDataReader.latestClose(ref)
      if (!read.observed) {
        return {
          ...base, state: 'empty',
          symbol: read.displaySymbol,
          detail: `Nothing is stored for ${read.displaySymbol} yet.`,
        }
      }

      if (kind === 'volume') {
        /*
         * `latestClose` returns the CLOSE, so the volume has to come off
         * the same bar rather than from a second read of a possibly
         * different day. One point, newest first.
         */
        const series = await marketDataReader.closeSeries(ref, { points: 1 })
        /* Last, not first -- ascending order again. One point makes them the
           same bar today, and a budget change tomorrow would make them differ
           silently. */
        const vbars = series.observed?.value ?? []
        const bar = vbars[vbars.length - 1]
        if (!bar || bar.volume == null) {
          return {
            ...base, state: 'empty',
            symbol: read.displaySymbol,
            detail: `No volume is stored for ${read.displaySymbol} on ${read.observed.effectiveAt.slice(0, 10)}.`,
          }
        }
        return {
          ...base,
          state: 'ok',
          symbol: series.displaySymbol,
          observed: { ...series.observed!, value: bar.volume },
          verdict: series.verdict,
          label: 'Volume on the last stored session',
        }
      }

      return {
        ...base,
        state: 'ok',
        symbol: read.displaySymbol,
        observed: read.observed,
        verdict: read.verdict,
        /* The reader's own label. "Last close", never "Current price" -- a
           holdings mark carrying the second label is a defect this codebase
           has already had, and the label is produced beside the number for
           exactly that reason. */
        label: read.label,
      }
    },
  })

  if (!enabled || !id || !symbol) return null
  if (query.isPending) return { state: 'loading', id, symbol }
  if (query.isError) {
    return {
      state: 'error', id, symbol,
      /* What failed, never a guess at why. A read that threw says nothing
         about whether the figure exists. */
      detail: 'The lookup failed. Asking again may work.',
    }
  }
  return query.data ?? { state: 'error', id, symbol, detail: 'The lookup returned nothing.' }
}
