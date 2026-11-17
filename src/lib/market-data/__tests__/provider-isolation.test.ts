/**
 * The rule that makes Package 2A shippable: a licensed feed reaches one seat.
 *
 * EODHD is a single-seat subscription in a product with 28 organizations, so
 * every leak path here is a licensing breach, not a privacy nicety. The
 * awkward part is that the most likely leak makes NO request and writes NO
 * row: a cache key that omits the provider serves one account's licensed data
 * to the next account in the same browser tab, and nothing in any log would
 * ever show it.
 *
 * These are source-level guards. They are blunt, and they are the only kind
 * that can observe "no component anywhere does X".
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { quoteQueryKey } from '../polling'
import {
  clearProviderCaches,
  marketDataEntitlementKey,
  readEntitlementAnswer,
  shouldClearProviderCaches,
} from '../provider-routing'
import { referenceCache } from '../routed-quote'
import { symbolCache } from '../eodhd-symbol'

const SRC = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(SRC, p), 'utf8')
const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === '__tests__') continue
      walk(full, out)
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

const ALL_SRC_FILES = walk(SRC)

/* ─────────────────────────── cache keys carry provider ─────────────────── */

describe('no cache can serve one account the other account\'s licensed data', () => {
  it('puts the provider in the quote key', () => {
    /*
     * THE leak. Sign out of an entitled account and in as an unentitled one
     * in the same tab: with a key of `['market-data','quote',symbol]`, the
     * second session reads the first session's EODHD price straight from the
     * React Query cache. No request, no row, nothing to audit.
     */
    expect(quoteQueryKey('AAPL', 'eodhd')).not.toEqual(quoteQueryKey('AAPL', 'yahoo'))
    expect(quoteQueryKey('AAPL', 'eodhd')).toContain('eodhd')
  })

  it('defaults the quote key to the provider every user already has', () => {
    // So a call site that has not been taught about routing cannot
    // accidentally read an EODHD entry.
    expect(quoteQueryKey('AAPL')).toEqual(quoteQueryKey('AAPL', 'yahoo'))
  })

  it('puts the provider in the price-history key', () => {
    const src = stripComments(read('hooks/usePriceHistory.ts'))
    const key = /queryKey: \['price-history'[^\]]*\]/.exec(src)?.[0] ?? ''
    expect(key, 'the price-history query key was not found').not.toBe('')
    expect(key).toContain('provider')
  })

  it('puts the provider in the candlestick service cache key', () => {
    const src = stripComments(read('lib/chartData.ts'))
    const assignment = /const cacheKey = `[^`]*`/.exec(src)?.[0] ?? ''
    expect(assignment, 'the chart cache key was not found').not.toBe('')
    expect(assignment).toContain('${provider}')
  })

  it('keys the entitlement answer by user, so a sign-in cannot inherit one', () => {
    expect(marketDataEntitlementKey('user-a')).not.toEqual(marketDataEntitlementKey('user-b'))
    expect(marketDataEntitlementKey(null)).toEqual(['market-data', 'entitlement', null])
  })

  it('clears on a principal CHANGE, and not on a token refresh', () => {
    /*
     * Behaviour, not source text.
     *
     * The first version of this guard asserted the condition's source and
     * stayed green when the condition was disabled with `false &&`, because
     * the text was still in the file. The rule now lives in a pure function,
     * so disabling it fails here.
     */
    expect(shouldClearProviderCaches(null, 'user-a'), 'first sign-in: nothing cached to leak')
      .toBe(false)
    expect(shouldClearProviderCaches('user-a', 'user-a'), 'token refresh: keep the warm cache')
      .toBe(false)
    expect(shouldClearProviderCaches('user-a', 'user-b'), 'THE leak: a different account')
      .toBe(true)
    expect(shouldClearProviderCaches('user-a', null), 'sign-out').toBe(true)
  })

  it('clears BOTH module-level caches, not just one of them', () => {
    const cleared: string[] = []
    clearProviderCaches({
      clearCharts: () => cleared.push('charts'),
      clearReference: () => cleared.push('reference'),
    })
    expect(cleared.sort()).toEqual(['charts', 'reference'])
  })

  it('actually empties the reference and symbol caches, not just calls something', () => {
    referenceCache.set('SHEL.L', { currency: 'GBP' })
    symbolCache.set('SHEL', { ok: true, symbol: 'SHEL.L' })
    expect(referenceCache.size).toBe(1)
    expect(symbolCache.size).toBe(1)
    clearProviderCaches()
    expect(referenceCache.size, 'the reference cache survived').toBe(0)
    expect(symbolCache.size, 'the symbol cache survived').toBe(0)
  })

  it('wires the tested rule to the auth event', () => {
    /*
     * The one part that cannot be tested without a React renderer and a live
     * auth client: that the handler calls the two functions above. Narrow and
     * honest — the LOGIC is proven by the three tests before this one, and
     * this only checks it is reached.
     */
    const src = stripComments(read('lib/market-data/provider-routing.ts'))
    const handler = /onAuthStateChange\(\([\s\S]*?\n {4}\}\)/.exec(src)?.[0] ?? ''
    expect(handler, 'the auth-state handler was not found').not.toBe('')
    expect(handler.length).toBeGreaterThan(80)
    expect(handler).toMatch(/if \(shouldClearProviderCaches\(prev, next\)\) clearProviderCaches\(\)/)
  })
})

/* ─────────────────── EODHD never reaches a shared destination ──────────── */

describe('licensed data never reaches a shared destination', () => {
  const eodhdFiles = [
    'lib/market-data/eodhd-client.ts',
    'lib/market-data/eodhd-series.ts',
    'lib/market-data/eodhd-symbol.ts',
    'lib/market-data/routed-quote.ts',
    'lib/market-data/provider-routing.ts',
    'components/market-data/EodhdDiagnostic.tsx',
    'components/market-data/DataProvenanceBadge.tsx',
  ]

  it('writes to no database table from any EODHD code path', () => {
    for (const file of eodhdFiles) {
      const src = stripComments(read(file))
      expect(src, `${file} reaches the database directly`).not.toMatch(/\.from\(/)
      expect(src, `${file} writes`).not.toMatch(/\.(insert|upsert|update|delete)\(/)
    }
  })

  it('never names price_history_cache or market_data_cache', () => {
    /*
     * These are ORG-WIDE tables. A personally licensed figure written into
     * either one becomes every organization's data, which is the precise
     * breach the entitlement boundary exists to prevent.
     */
    for (const file of eodhdFiles) {
      // Comments stripped: these files DESCRIBE the rule in prose, and prose
      // cannot write a row. Only code counts.
      const src = stripComments(read(file))
      expect(src, `${file} names a shared cache table`).not.toMatch(
        /price_history_cache|market_data_cache/,
      )
    }
  })

  it('persists nothing to browser storage either', () => {
    for (const file of eodhdFiles) {
      const src = stripComments(read(file))
      expect(src, `${file} uses browser storage`).not.toMatch(
        /localStorage|sessionStorage|indexedDB/,
      )
    }
  })

  it('is not reachable from AI retrieval, reports or exports', () => {
    /*
     * Checked from the other direction: nothing under the AI, report or
     * export trees may import an EODHD module. A single import there would
     * put licensed prices into a shared conversation or a downloadable file.
     */
    const forbidden = ['lib/ai/', 'lib/reports/', 'lib/export', 'components/reports/']
    const offenders: string[] = []
    for (const file of ALL_SRC_FILES) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/')
      if (!forbidden.some(prefix => rel.startsWith(prefix))) continue
      const src = stripComments(readFileSync(file, 'utf8'))
      if (/market-data\/(eodhd|routed-quote|provider-routing)/.test(src)) offenders.push(rel)
    }
    expect(offenders).toEqual([])
  })
})

/* ──────────────────────── routing is server-decided ────────────────────── */

describe('the browser never decides entitlement for itself', () => {
  const routing = stripComments(read('lib/market-data/provider-routing.ts'))

  it('asks the server rather than comparing an id or an email', () => {
    /*
     * The brief is explicit: "Frontend provider routing should use verified
     * entitlement state, not a hardcoded user ID or email." A UUID or an
     * address in this file would be exactly that.
     */
    expect(routing).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
    expect(routing).not.toMatch(/@[\w-]+\.(com|io|dev|net|org)/)
    expect(routing).toMatch(/op: 'entitlement'/)
  })

  it('says yes only to a literal true under a literal ok', () => {
    /*
     * Behaviour, not source text. The earlier version matched
     * `/entitled === true/` anywhere in the file — and passed when the check
     * was weakened to a truthy test, because a DIFFERENT line further down
     * still contained the text.
     *
     * Every value below is truthy in JavaScript. None of them is a licence.
     */
    expect(readEntitlementAnswer({ ok: true, data: { entitled: true } }, null).entitled).toBe(true)

    for (const value of ['false', 'true', 1, {}, [], 'yes']) {
      expect(
        readEntitlementAnswer({ ok: true, data: { entitled: value } }, null).entitled,
        `${JSON.stringify(value)} became an entitlement`,
      ).toBe(false)
    }

    // `ok` must be a literal true as well.
    expect(readEntitlementAnswer({ ok: 1, data: { entitled: true } }, null).entitled).toBe(false)
    expect(readEntitlementAnswer({ data: { entitled: true } }, null).entitled).toBe(false)
  })

  it('answers no, with a reason, for every shape it cannot read', () => {
    // Never a throw: an exception would leave the provider undecided and the
    // chart empty, when the right outcome is the default provider.
    for (const body of [null, undefined, {}, 'nonsense', 42, { ok: false }]) {
      const answer = readEntitlementAnswer(body, null)
      expect(answer.entitled, `${JSON.stringify(body)}`).toBe(false)
      expect(answer.reason).toBeTruthy()
    }
  })

  it('treats an unreachable function as not entitled', () => {
    const answer = readEntitlementAnswer(null, new Error('network'))
    expect(answer).toEqual({ entitled: false, reason: 'unreachable' })
  })

  it('reports the server reason when there is one, without inventing one', () => {
    expect(readEntitlementAnswer({ ok: true, data: { entitled: false, reason: 'not_listed' } }, null))
      .toEqual({ entitled: false, reason: 'not_listed' })
  })

  it('maps the answer to the fail-safe provider', () => {
    expect(routing).toMatch(/entitled \? 'eodhd' : 'yahoo'/)
  })

  /*
   * Not duplicated here: "no shipped file imports the server entitlement
   * module" is already owned by `entitlement.test.ts`, and its version is
   * STRICTER — it matches the module's bare name anywhere in the file,
   * comments and string literals included, and has its own non-vacuity check
   * that the sweep read more than 500 files. A second, comment-stripping copy
   * of the same rule would only create a weaker one to argue with.
   */
})

/* ──────────────────────── price and trade safety (§4) ──────────────────── */

describe('EODHD prices are not bookable and holdings are untouched', () => {
  it('no EODHD module imports a trade or holdings write path', () => {
    const eodhdModules = [
      'lib/market-data/eodhd-client.ts',
      'lib/market-data/eodhd-series.ts',
      'lib/market-data/eodhd-symbol.ts',
      'lib/market-data/routed-quote.ts',
      'lib/market-data/provider-routing.ts',
    ]
    for (const file of eodhdModules) {
      const src = stripComments(read(file))
      expect(src, `${file} touches trades`).not.toMatch(
        /accepted_trades|createAcceptedTrade|portfolio_holdings|assertBookablePrice/,
      )
    }
  })

  it('leaves the bookable-price gate exactly where it was', () => {
    /*
     * `createAcceptedTrade` is the only insert into `accepted_trades`, which
     * is why the provenance gate lives at that one site. This change must not
     * have weakened it, and an EODHD price must not have become bookable by
     * reaching it through a new route.
     */
    const service = stripComments(read('lib/services/accepted-trade-service.ts'))
    expect(service).toMatch(/assertBookablePrice/)
    expect(service, 'an EODHD price reached the trade insert').not.toMatch(/eodhd/i)
  })

  it('never lets a provider name reach the sizing-price validator', () => {
    const validator = stripComments(read('lib/market-data/sizing-price.ts'))
    expect(validator).toMatch(/assertBookablePrice/)
    expect(validator, 'EODHD was added to the bookable set').not.toMatch(/eodhd/i)
  })
})
