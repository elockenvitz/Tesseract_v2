import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/**
 * A provider's schema stops at the adapter.
 *
 * ── Why a lint and not a type ─────────────────────────────────────────────
 *
 * `usePriceHistory` reads `meta.regularMarketPrice` off an untyped `any` and
 * `ChartView` renders `quoteData.regularMarketPrice` straight into JSX. Neither
 * is visible to the type checker, because the provider response is parsed as
 * `any` at the fetch boundary — which is precisely how a vendor field reaches a
 * React component without anyone deciding it should. The same shape of miss is
 * why `assets-restricted-columns.test.ts` is a grep: a column name inside a
 * string is invisible to every other tool in the repo.
 *
 * ── The cost of leaking ───────────────────────────────────────────────────
 *
 * `regularMarketPrice` is a Yahoo word. A component that names it cannot be
 * served by Alpha Vantage, which calls the same number `05. price`, or by IEX,
 * which calls it `latestPrice`. Three spellings of one idea, and all three
 * already appear in this codebase. Replacing a provider means finding every
 * component that learned one vocabulary — which is the vendor lock-in this lane
 * exists to prevent, arriving one field at a time rather than by contract.
 *
 * ── A ratchet, not a gate ─────────────────────────────────────────────────
 *
 * Two leaks exist today and both are named below with what they cost. They are
 * not deleted here: `usePriceHistory` parses a live Yahoo proxy response and
 * rewriting it means introducing an adapter, which is a separate change with
 * its own risk. Recording them as a fixed, enumerated debt is honest; deleting
 * the check until they are fixed is not, because it is exactly while a
 * migration is half-done that the third leak gets written.
 *
 * The count may only go down. Adding a vendor field name anywhere in `src/`
 * outside the adapter layer fails this test with the file and line.
 */

/**
 * Field names that belong to one provider's wire format.
 *
 * Yahoo, Alpha Vantage and IEX respectively. Each is a name for a number the
 * contracts in `contracts.ts` already have a neutral word for.
 */
const VENDOR_FIELDS = [
  'regularMarketPrice',
  'chartPreviousClose',
  'regularMarketDayHigh',
  'regularMarketDayLow',
  'regularMarketVolume',
  'regularMarketOpen',
  'Global Quote',
  'Time Series (Daily)',
  'bestMatches',
  'latestPrice',
  'iexRealtimePrice',
  'previousVolume',
]

/**
 * Where a vendor vocabulary is allowed to exist.
 *
 * The adapter layer's whole job is to speak both languages, and this test file
 * has to name the words in order to ban them.
 */
const ADAPTER_LAYER = [
  join('src', 'lib', 'financial-data'),
  join('src', 'lib', 'market-data', '__tests__'),
]

/**
 * The two leaks that exist today, each with what it costs.
 *
 * May only shrink. A new entry here is a review conversation, not a formality.
 */
const KNOWN_LEAKS: Record<string, string> = {
  [join('src', 'hooks', 'usePriceHistory.ts')]:
    'Parses the Yahoo chart proxy response inline. Needs a ProviderAdapter to sit between it and the wire.',
  [join('src', 'components', 'rich-text-editor', 'extensions', 'chart', 'ChartView.tsx')]:
    'Renders a Yahoo field directly into JSX. Should read a PriceQuote.',
}

const SRC = join(process.cwd(), 'src')

function sourceFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue
      out.push(...sourceFiles(full))
      continue
    }
    if (/\.tsx?$/.test(entry)) out.push(full)
  }
  return out
}

/**
 * Comments are stripped first, so prose explaining the ban does not trip it.
 * Borrowed wholesale from `assets-restricted-columns.test.ts`, which met the
 * same problem: the doc comment naming a forbidden word is not a use of it.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

function isAdapterLayer(rel: string): boolean {
  return ADAPTER_LAYER.some(prefix => rel === prefix || rel.startsWith(prefix + sep))
}

describe('provider vocabulary does not leak past the adapter', () => {
  const offenders = new Map<string, string[]>()

  for (const file of sourceFiles(SRC)) {
    const rel = relative(process.cwd(), file)
    if (isAdapterLayer(rel)) continue

    const code = stripComments(readFileSync(file, 'utf8'))
    const lines = code.split('\n')
    const hits: string[] = []
    for (let i = 0; i < lines.length; i++) {
      for (const field of VENDOR_FIELDS) {
        if (lines[i].includes(field)) hits.push(`${rel}:${i + 1} ${field}`)
      }
    }
    if (hits.length) offenders.set(rel, hits)
  }

  it('adds no leak beyond the two already recorded', () => {
    const unexpected = [...offenders.entries()]
      .filter(([rel]) => !(rel in KNOWN_LEAKS))
      .flatMap(([, hits]) => hits)

    expect(
      unexpected,
      'A provider field name reached application code. Map it in a ProviderAdapter and ' +
        'give the consumer a PriceQuote or a ReferenceRecord from src/lib/market-data/contracts.ts.',
    ).toEqual([])
  })

  it('keeps the recorded debt at two files and no more', () => {
    expect(offenders.size).toBeLessThanOrEqual(Object.keys(KNOWN_LEAKS).length)
  })

  it('still finds the leaks it claims exist, so the scan is proven to run', () => {
    /**
     * A grep that silently stops matching passes forever. This asserts the
     * positive: at least one known leak is still detected, so a zero from the
     * check above means "clean" rather than "did not look".
     */
    const found = [...offenders.keys()].filter(rel => rel in KNOWN_LEAKS)
    expect(found.length).toBeGreaterThan(0)
  })
})

describe('the domain contracts name nothing vendor-specific', () => {
  it('carries no provider field name in its own type definitions', () => {
    for (const name of ['contracts.ts', 'identity.ts', 'freshness.ts', 'paging.ts']) {
      const code = stripComments(readFileSync(join(SRC, 'lib', 'market-data', name), 'utf8'))
      for (const field of VENDOR_FIELDS) {
        expect(code.includes(field), `${name} names ${field}`).toBe(false)
      }
    }
  })
})
