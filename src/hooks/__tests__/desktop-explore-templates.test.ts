import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { outsizedActiveRisk, type HoldingLike } from '../../lib/mobile/feed-templates'
import { templatesToExplore } from '../../lib/mobile/explore-adapters'

/**
 * The market templates reach the desktop field, and the active-risk one is
 * given the whole book.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * `useDesktopExplore` never called `templatesToExplore`, and said so: its
 * `missing` list pushed `'templates'` on EVERY render, unconditionally. So the
 * surface reported "no market templates" whether or not there were any -- the
 * identical defect the news entry had, which the comment two lines above it
 * described while the templates line reproduced it.
 *
 * The stated reason was that the six builders need quotes, market events and a
 * symbol-to-asset map "that only MobileDashboard assembles". Two of those are
 * hooks keyed off a symbol list the file already computes for news, and the
 * third is a projection of producer output already in memory.
 *
 * ── The trap this file mostly exists for ─────────────────────────────────
 *
 * `outsizedActiveRisk` prints "X is your largest overweight at +N%". That is a
 * claim about THE BOOK, not about the names on screen. The convenient wiring
 * was to feed it the dozen names the lenses surfaced -- and it would still
 * have printed the superlative, now false. This codebase has a documented
 * defect class for precisely that (portfolio holdings collapsing wherever they
 * are aggregated), so the population is the whole organisation's exposures via
 * `lenses.weightIndex`, labelled by `lenses.symbolByAssetId`.
 *
 * That is also why `symbolByAssetId` exists at all: `weightIndex` is a
 * complete set of weights whose entries name the BOOK and never the name, so
 * without labels it can only be ranked over the subset you can label.
 */

const ROOT = resolve(__dirname, '../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const HOOK = 'src/hooks/useDesktopExplore.ts'
const LENSES = 'src/hooks/mobile/usePortfolioLenses.ts'

/** Source with comments stripped, for any assertion about code. */
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')

const holding = (over: Partial<HoldingLike> = {}): HoldingLike => ({
  assetId: 'a1',
  symbol: 'AAPL',
  weight: 6,
  benchmarkWeight: 3,
  ...over,
})

describe('the desktop field draws the market templates', () => {
  it('calls the adapter rather than leaving the producer uncalled', () => {
    const s = codeOf(HOOK)
    expect(s).toContain('templatesToExplore(templateCards)')
  })

  it('builds all six families, not a convenient subset', () => {
    const s = codeOf(HOOK)
    for (const builder of [
      'unusualMovers', 'outsizedActiveRisk', 'earningsAhead',
      'earningsResult', 'corporateActions', 'economicReleases',
    ]) {
      expect(s, builder).toContain(`...${builder}(`)
    }
  })

  it('stops claiming templates are missing when there are some', () => {
    // The unconditional `gaps.push('templates')` is the bug. A gap report that
    // is always true tells a reader nothing and hides the one case it should
    // have caught.
    const s = codeOf(HOOK)
    expect(s).toContain("if (!templateCards.length) gaps.push('templates')")
    expect(s).not.toMatch(/^\s*gaps\.push\('templates'\)/m)
  })

  it('asks the market about the same budgeted names news asks about', () => {
    // Each name costs provider calls. Keying these off a second, wider list
    // would quietly multiply that, and the budget is documented on
    // `newsSymbols` only.
    const s = codeOf(HOOK)
    expect(s).toContain('useMarketEvents(newsSymbols, { enabled })')
    expect(s).toMatch(/useMarketData\(newsSymbols, \{\s*enabled: enabled && newsSymbols\.length > 0,?\s*\}\)/)
  })

  it('gates both new queries with the surface', () => {
    // An inactive Explore must hold no request open; the news query already
    // obeyed this and a new one that did not would be invisible.
    const s = codeOf(HOOK)
    const events = s.indexOf('useMarketEvents(')
    expect(events).toBeGreaterThan(-1)
    expect(s.slice(events, events + 120)).toContain('enabled')
  })

  it('recomposes when the templates change', () => {
    // `items` is a useMemo. Templates absent from its dependency list would
    // draw once, from whatever the first render happened to hold.
    const s = codeOf(HOOK)
    expect(s).toMatch(/\}, \[produced, news, deskBySymbol, templateCards, extra\]\)/)
  })
})

describe('active risk is ranked over the whole book', () => {
  it('reads the organisation-wide exposure index, not the lens selections', () => {
    const s = codeOf(HOOK)
    expect(s).toContain('lenses?.weightIndex')
    expect(s).toContain('lenses?.symbolByAssetId')
    // The subset that would have made the superlative false.
    expect(s).not.toMatch(/outsizedActiveRisk\(\s*(produced|deskBySymbol)/)
  })

  it('is labelled from a map that covers every holding the query read', () => {
    const lenses = codeOf(LENSES)
    expect(lenses).toContain('symbolByAssetId')
    // Built in the same pass as weightIndex, over `holdings` -- not over the
    // dozen rows each lens selected.
    const build = lenses.indexOf('const symbolByAssetId = new Map<string, string>()')
    const loop = lenses.indexOf('for (const h of holdings)', build)
    expect(build).toBeGreaterThan(-1)
    expect(loop).toBeGreaterThan(build)
    expect(lenses).toContain('symbolByAssetId.set(h.asset_id, ticker)')
  })

  it('is returned, and present on the empty result too', () => {
    const lenses = codeOf(LENSES)
    expect(lenses).toMatch(/weightIndex,\s*symbolByAssetId,/)
    // Every early return must satisfy the type, or a consumer reads
    // `undefined` where it expects a Map.
    const empty = lenses.slice(lenses.indexOf('const empty: PortfolioLenses = {'))
    expect(empty.slice(0, 400)).toContain('symbolByAssetId: new Map()')
    expect(empty.slice(0, 400)).toContain('weightIndex: new Map()')
  })

  it('skips an exposure the book cannot support rather than reading it as zero', () => {
    // `benchmarkPct` null means "no benchmark file", NOT "the benchmark does
    // not hold it". Defaulting it to 0 turns "we cannot say" into the much
    // stronger "all of this is active risk", which the builder then prints.
    const s = codeOf(HOOK)
    expect(s).toContain('if (e.portfolioPct == null || e.benchmarkPct == null) continue')
    expect(s).not.toMatch(/benchmarkWeight: e\.benchmarkPct \?\? 0/)
    expect(s).not.toMatch(/weight: e\.portfolioPct \?\? 0/)
  })
})

describe('what the builder does with the population it is given', () => {
  it('names the largest active weight in the set, which is why the set matters', () => {
    // The behaviour that makes a narrowed population a false statement rather
    // than merely a shorter list.
    const [card] = outsizedActiveRisk([
      holding({ assetId: 'a1', symbol: 'AAPL', weight: 6, benchmarkWeight: 3 }),
      holding({ assetId: 'a2', symbol: 'MSFT', weight: 12, benchmarkWeight: 4 }),
    ])
    expect(card.symbol).toBe('MSFT')
    expect(card.headline).toContain('largest overweight')
  })

  it('would have said AAPL had it only been shown the names on screen', () => {
    const [card] = outsizedActiveRisk([
      holding({ assetId: 'a1', symbol: 'AAPL', weight: 6, benchmarkWeight: 3 }),
    ])
    expect(card.symbol).toBe('AAPL')
    expect(card.headline).toContain('largest overweight')
  })

  it('survives the adapter with its asset, so the tile can open the name', () => {
    const [item] = templatesToExplore(
      outsizedActiveRisk([holding({ assetId: 'asset-7', symbol: 'MSFT', weight: 9, benchmarkWeight: 2 })]),
    )
    expect(item.assetId).toBe('asset-7')
    expect(item.destination).toMatchObject({ kind: 'action', action: 'open_asset', assetId: 'asset-7' })
  })
})
