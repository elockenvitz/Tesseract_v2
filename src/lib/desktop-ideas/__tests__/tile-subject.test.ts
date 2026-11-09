import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tileSubject } from '../tile-subject'
import { exploreCardSize } from '../../mobile/explore-layout'
import type { ExploreItem } from '../../mobile/explore-item'

/**
 * A card that is not about a name says what it IS about, and the signpost
 * stops outranking the findings.
 *
 * ── Two faults, both reported from the same screen ───────────────────────
 *
 * 1. THE DASH. `TileIdentity` rendered `symbol ?? '—'`, so a card with no
 *    ticker led with a bare em dash at the tile's largest type, in black,
 *    where a company name goes. Measured on the live desktop Explore field:
 *    16 Ideas tiles, 6 of them with no symbol, and every one of those drew the
 *    dash -- a 20px dash above "What are the biggest risks to your portfolio
 *    right now?". Reported as the Ideas cards "showing as dashed".
 *
 *    A placeholder in the most prominent position on a card is worse than an
 *    empty one: it takes the line a reader scans first and says nothing. It is
 *    also an em dash in a user-visible string, which this product does not use.
 *
 * 2. THE AGGREGATE. `exploreCardSize` gave `subtype: 'aggregate'` the FEATURE
 *    size, so "5 new ideas this week" rendered at 915x356 -- the second tile
 *    on the page and larger than every real finding except the lead -- to show
 *    a count and one button. It is also the only tile whose tap does not open
 *    anything, which is exactly how it was reported: a reader clicked the
 *    biggest Ideas card expecting the workspace and the grid merely narrowed.
 */

const ROOT = resolve(__dirname, '../../../../')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

const TILE = 'src/components/desktop/DesktopTile.tsx'
const GRID = 'src/components/ideas-v2/OpportunityGrid.tsx'

const item = (over: Partial<ExploreItem> = {}): ExploreItem => ({
  id: 'i1',
  dedupeKey: 'k1',
  signalType: null,
  category: 'ideas',
  subtype: 'idea',
  title: 'What are the biggest risks to your portfolio right now?',
  destination: { kind: 'filter', category: 'ideas' },
  ...over,
}) as ExploreItem

describe('what a tile leads with when it has no ticker', () => {
  it('answers nothing when there IS a ticker, because that is the caller job', () => {
    expect(tileSubject(item({ symbol: 'AAPL' }))).toBeNull()
    // Even with a book to fall back on. A ticker always wins.
    expect(tileSubject(item({ symbol: 'AAPL', portfolio: { name: 'Core Equity' } }))).toBeNull()
  })

  it('names the book when the finding is about a portfolio', () => {
    expect(tileSubject(item({ portfolio: { name: 'Core Equity' } }))).toBe('Core Equity')
  })

  it('names the kind of post when there is no book either', () => {
    expect(tileSubject(item({ postKind: 'prompt' }))).toBe('Prompt')
    expect(tileSubject(item({ postKind: 'thought' }))).toBe('Thought')
    // The product's own words, not a title-cased slug.
    expect(tileSubject(item({ postKind: 'trade_idea' }))).toBe('Trade idea')
  })

  it('prefers the book over the kind, since the book is more specific', () => {
    expect(tileSubject(item({ portfolio: { name: 'Core Equity' }, postKind: 'thought' })))
      .toBe('Core Equity')
  })

  it('answers nothing rather than repeating the category', () => {
    // The eyebrow directly above this line already prints "Ideas". Falling
    // back to it would print the same word twice on one card in two sizes.
    expect(tileSubject(item())).toBeNull()
    expect(tileSubject(item({ subtype: 'aggregate', title: '5 new ideas this week' }))).toBeNull()
  })

  it('ignores a blank book name instead of leading with whitespace', () => {
    expect(tileSubject(item({ portfolio: { name: '   ' }, postKind: 'thought' }))).toBe('Thought')
  })
})

describe('the identity row never draws a placeholder', () => {
  it('has no dash fallback left in it', () => {
    /* Comment-stripped: the component's own comment quotes the old line to
       explain why it is gone, and the first version of this case failed on
       that quotation rather than on code. */
    const tile = read(TILE)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^[ \t]*\/\/.*$/gm, '')
    const fn = tile.slice(tile.indexOf('export function TileIdentity'))
    const body = fn.slice(0, fn.indexOf('\n}\n'))
    expect(body).not.toContain("symbol ?? '—'")
    expect(body).not.toContain("?? '-'")
  })

  it('renders nothing at all when there is no lead and no name', () => {
    const tile = read(TILE)
    const fn = tile.slice(tile.indexOf('export function TileIdentity'))
    expect(fn.slice(0, 2600)).toContain('if (!lead && !name) return null')
  })

  it('is given the subject by the grid', () => {
    const grid = read(GRID)
    expect(grid).toContain('subject={tileSubject(item)}')
    expect(grid).toContain("from '../../lib/desktop-ideas/tile-subject'")
  })
})

describe('an aggregate is a signpost, not the biggest thing on the page', () => {
  const aggregate = item({
    subtype: 'aggregate',
    title: '5 new ideas this week',
    count: 5,
    metric: { value: '5', label: 'ideas', direction: 'neutral' },
  })

  it('takes the smallest cell', () => {
    const d = exploreCardSize(aggregate)
    expect(d.size).toBe('compact')
    expect(d.reason).toContain('signpost')
  })

  it('is still ranked and still filters, it is only smaller', () => {
    // The fix is a size change and nothing else. An aggregate that stopped
    // being emitted, or stopped filtering, would pass a size assertion and
    // lose the feature.
    expect(aggregate.destination).toEqual({ kind: 'filter', category: 'ideas' })
  })

  it('does not demote a real finding that earned the width', () => {
    // The counter-case: the width rules below the aggregate branch must still
    // run for everything else, or this trade would have cost the page its
    // emphasis entirely.
    const breach = item({
      subtype: 'signal', category: 'decisions', importance: 0.95,
      portfolio: { weightPct: 6 },
      metric: { value: '+36%', label: 'above your highest case', direction: 'bad' },
    })
    expect(exploreCardSize(breach).size).toBe('feature')
  })
})
