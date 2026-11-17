/**
 * The owner-only EODHD probe, run from inside the app.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Package 1's live validation was run by pasting a script into DevTools,
 * which meant reading a session token out of localStorage and sanitising
 * console output so a JWT could not end up in a copied result. That worked
 * and should not be how it works twice. This surface calls the same edge
 * function through the ordinary Supabase client, so the session JWT is
 * attached by supabase-js and never touched by any code here: there is no
 * token in this file, nothing to redact, and nothing to paste.
 *
 * ── Why it is safe to ship ───────────────────────────────────────────────
 *
 * It is rendered only when the server has said this session is entitled, and
 * it cannot widen that: every button below is one request to the same
 * function, which re-decides entitlement before it touches the provider. An
 * unentitled user who reached this component anyway would see the panel's
 * "not entitled" state and get 403s from every button.
 *
 * It writes nothing — no table, no shared cache, no export. Removing it is
 * deleting this file and one render site.
 */
import { useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import {
  eodhdBars,
  eodhdExchanges,
  eodhdLatest,
  eodhdReference,
  eodhdResolve,
} from '../../lib/market-data/eodhd-client'
import { useMarketDataEntitlement } from '../../lib/market-data/provider-routing'
import { windowForTimeframe } from '../../lib/market-data/eodhd-series'

type ProbeState = { label: string; status: 'ok' | 'failed'; summary: string }

/**
 * What a probe is allowed to show.
 *
 * Summaries only — counts, codes, the first and last timestamp. The point is
 * to answer "did this work and how fresh is it", which a shape summary
 * answers and a full payload dump does not answer any better. Keeping it to
 * summaries also means nothing on this panel is worth copying out of the app.
 */
function summarise(value: unknown): string {
  if (Array.isArray(value)) {
    const first = value[0] as Record<string, unknown> | undefined
    const last = value[value.length - 1] as Record<string, unknown> | undefined
    const stamp = (row: Record<string, unknown> | undefined) =>
      (row?.openedAt as string) ?? (row?.date as string) ?? (row?.code as string) ?? ''
    return `${value.length} rows${value.length ? ` · ${stamp(first)} → ${stamp(last)}` : ''}`
  }
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>
    const parts: string[] = []
    if (typeof row.value === 'number') parts.push(`value ${row.value}`)
    if (Array.isArray(row.value)) {
      const bars = row.value as Array<Record<string, unknown>>
      const stamp = (b: Record<string, unknown> | undefined) =>
        (b?.openedAt as string) ?? (b?.date as string) ?? ''
      parts.push(`${bars.length} bars`)
      if (bars.length) parts.push(`${stamp(bars[0])} → ${stamp(bars[bars.length - 1])}`)
    }
    if (row.value && typeof row.value === 'object' && !Array.isArray(row.value)) {
      const ref = row.value as Record<string, unknown>
      if (ref.symbol) parts.push(String(ref.symbol))
      if (ref.currency) parts.push(`currency ${ref.currency}`)
      if (ref.currencyUnit) {
        parts.push(`unit ${(ref.currencyUnit as Record<string, unknown>).code}`)
      }
      if (ref.exchangeLabel) parts.push(String(ref.exchangeLabel))
    }
    const source = row.source as Record<string, unknown> | undefined
    if (source?.delivery) parts.push(`delivery ${source.delivery}`)
    if (row.effectiveAt) parts.push(`effective ${row.effectiveAt}`)
    if (row.observedAt) parts.push(`observed ${row.observedAt}`)
    if (row.adjustment) parts.push(`basis ${row.adjustment}`)
    return parts.join(' · ') || 'ok'
  }
  return String(value)
}

export interface EodhdDiagnosticProps {
  /** Starting symbol. Editable, because resolving an unknown one is the point. */
  initialSymbol?: string
}

export function EodhdDiagnostic({ initialSymbol = 'AAPL.US' }: EodhdDiagnosticProps) {
  const { entitled, reason, isLoading: entitlementLoading } = useMarketDataEntitlement()
  const [symbol, setSymbol] = useState(initialSymbol)
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<ProbeState[]>([])

  if (entitlementLoading) {
    return (
      <div className="text-sm text-gray-500 dark:text-gray-400">
        Checking market-data entitlement...
      </div>
    )
  }

  if (!entitled) {
    /*
     * Shown, not hidden. A blank panel reads as a broken feature; saying the
     * account is not entitled is both true and the only thing this surface
     * could usefully tell an unentitled reader. It names no allowlist.
     */
    return (
      <div className="rounded border border-gray-200 p-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
        This account is not entitled to EODHD{reason ? ` (${reason})` : ''}. Market data is
        served by the default provider.
      </div>
    )
  }

  const run = async () => {
    setRunning(true)
    setResults([])
    const out: ProbeState[] = []
    const record = (label: string, res: { ok: boolean; data?: unknown; failure?: unknown }) => {
      out.push(
        res.ok
          ? { label, status: 'ok', summary: summarise(res.data) }
          : {
            label,
            status: 'failed',
            // The failure KIND is the useful part. `no_data` and
            // `unknown_symbol` look identical in a chart and mean opposite
            // things, which is the whole reason they are separate kinds.
            summary: `${(res.failure as { kind?: string })?.kind ?? 'failed'}: ${
              (res.failure as { detail?: string })?.detail ?? ''
            }`,
          },
      )
      setResults([...out])
    }

    const daily = windowForTimeframe('1M')
    const intraday = windowForTimeframe('5D')

    record('resolve', await eodhdResolve(symbol, 5))
    record('reference', await eodhdReference(symbol))
    record('latest quote', await eodhdLatest(symbol))
    record(`daily bars (${daily.from} → ${daily.to})`, await eodhdBars({
      symbol,
      from: daily.from,
      to: daily.to,
      interval: '1d',
    }))
    record(`5-minute bars (${intraday.from} → ${intraday.to})`, await eodhdBars({
      symbol,
      from: intraday.from,
      to: intraday.to,
      interval: '5m',
    }))

    // Venue discovery, filtered to Japan. This is the provider-supported way
    // to find Toyota's Tokyo suffix rather than guessing an identifier.
    const exchanges = await eodhdExchanges()
    if (exchanges.ok) {
      const japan = (exchanges.data ?? []).filter(
        e => e.country === 'Japan' || /tokyo|japan/i.test(e.name ?? ''),
      )
      record('Japan venues', {
        ok: true,
        data: japan.map(e => ({ code: e.code, name: e.name, currency: e.currency })),
      })
    } else {
      record('Japan venues', exchanges)
    }

    setRunning(false)
  }

  return (
    <div className="space-y-3 rounded border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <input
          value={symbol}
          onChange={e => setSymbol(e.target.value.trim())}
          placeholder="SYMBOL.EXCHANGE"
          className="w-48 rounded border border-gray-300 px-2 py-1 text-sm dark:border-gray-600 dark:bg-gray-800"
          aria-label="Symbol to probe"
        />
        <button
          onClick={run}
          disabled={running || !symbol}
          className="inline-flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm text-white disabled:opacity-50"
        >
          {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Run probes
        </button>
      </div>

      <p className="text-xs text-gray-500 dark:text-gray-400">
        Six requests against the authenticated market-data function. Read-only: nothing here
        writes to the database or to any shared cache.
      </p>

      {results.length > 0 && (
        <ul className="space-y-1 text-xs">
          {results.map((r, i) => (
            <li key={i} className="flex gap-2">
              <span
                className={
                  r.status === 'ok'
                    ? 'w-28 shrink-0 text-green-600 dark:text-green-400'
                    : 'w-28 shrink-0 text-amber-600 dark:text-amber-400'
                }
              >
                {r.status === 'ok' ? 'ok' : 'failed'}
              </span>
              <span className="w-56 shrink-0 text-gray-600 dark:text-gray-300">{r.label}</span>
              <span className="break-all text-gray-500 dark:text-gray-400">{r.summary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
