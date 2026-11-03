import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { buildActiveRiskCard } from '../../../lib/signals/builders/activeRisk'
import type { CardResult, SignalCard } from '../../../lib/signals/contract'
import type { AttentionEntry } from '../../../hooks/useDesktopAttentionFeed'

/**
 * Which card is drawn in full once a workspace is open beside the feed.
 *
 * ── The report ────────────────────────────────────────────────────────────
 *
 * "Can we make it so that if I have a card selected, that card is expanded in
 * the left hand pane but if not selected it just shows the truncated summary.
 * I think that would make things cleaner and easier to digest."
 *
 * The feed had it exactly the other way round. `SelectedSummary` collapsed the
 * SELECTED card to a line and left every other card in full, on the recorded
 * reasoning that the open item's workspace is two inches to the right and a
 * reader must still be able to scan past it to something better.
 *
 * The first half is still true -- the chosen card does not draw an
 * independently interactive copy of the pane beside it -- and the second half
 * was answered at the wrong width. Selecting opens the workspace, which takes
 * this column down to a ~26rem rail, and in that rail forty full cards pushed
 * the one the reader had chosen off the screen.
 *
 * ── Why this renders instead of reading the source ───────────────────────
 *
 * The rule is React state, not a container query, so it IS observable in
 * jsdom: which subtree a card renders is the whole claim. `feed-rail.test.ts`
 * reads CSS because the rule it guards is `@container`, which jsdom never
 * evaluates; this one has no such excuse.
 */

const feed = vi.hoisted(() => ({ entries: [] as AttentionEntry[] }))

vi.mock('../../../hooks/useDesktopAttentionFeed', () => ({
  useDesktopAttentionFeed: () => ({
    entries: feed.entries,
    isLoading: false,
    isError: false,
    retry: () => {},
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: () => {},
  }),
}))
vi.mock('../../../hooks/usePilotOnboarding', () => ({
  usePilotOnboarding: () => ({ markIdeasViewed: () => {}, markSignalWorked: () => {} }),
}))
/* A network read, and the only other one this component makes. */
vi.mock('../../../hooks/mobile/usePriceHistory', () => ({
  usePriceHistory: () => ({ data: new Map(), isLoading: false, isFetched: true }),
}))

const { IdeasExplore } = await import('../IdeasExplore')

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const SYMBOLS = ['MSFT', 'AMZN', 'JNJ']

const ENTRIES: AttentionEntry[] = SYMBOLS.map((symbol, i) => ({
  key: `k${i}`,
  card: unwrap(buildActiveRiskCard({
    assetId: `a${i}`, symbol, companyName: `${symbol} Inc.`,
    weightPct: 6.2 + i, benchmarkWeightPct: 3.1,
    portfolioId: 'p1', portfolioName: 'Core Equity',
    /* Relative, for the reason the SignalCardView suite records: a pinned
       date crosses a formatter band and fails on a day nobody chose. */
    asOf: new Date(Date.now() - 16 * 86_400_000).toISOString(),
  })),
  item: null,
  input: null,
  family: 'conviction',
  source: null,
})) as AttentionEntry[]

/**
 * The full card and the one-line summary, told apart structurally.
 *
 * `feed-tile-cols` is the wrapper the full card renders inside and the
 * summary does not, so counting it counts expanded cards without depending on
 * any word either version happens to print.
 */
const expanded = (el: HTMLElement) => el.querySelectorAll('.feed-tile-cols').length

const tiles = () => [...document.querySelectorAll('.feed-tile')] as HTMLElement[]

/* `CuratePanel` reads the facet vocabulary through React Query. It is disabled
   without an org and resolves to nothing, but the hook still needs a client. */
const mount = (selectedKey?: string) => render(
  <QueryClientProvider client={new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })}>
    <IdeasExplore onSelect={() => {}} selectedKey={selectedKey ?? null} />
  </QueryClientProvider>,
)

describe('the feed is a rail once a workspace is open beside it', () => {
  it('draws every card in full while nothing is selected', () => {
    feed.entries = ENTRIES
    mount()
    const all = tiles()
    expect(all).toHaveLength(3)
    for (const t of all) expect(expanded(t)).toBe(1)
  })

  it('expands the chosen card and summarises the rest', () => {
    feed.entries = ENTRIES
    mount('k1')
    const all = tiles()
    expect(all).toHaveLength(3)

    /* The chosen one keeps its card. It used to be the only collapsed one. */
    expect(expanded(all[1])).toBe(1)
    expect(all[1].textContent).toContain('AMZN')

    /* And the two the reader is not working are one line each. */
    expect(expanded(all[0])).toBe(0)
    expect(expanded(all[2])).toBe(0)
    /* Still enough to switch to: the family, the headline and the figure. */
    expect(all[0].textContent).toContain('MSFT')
    expect(all[0].textContent).toContain(ENTRIES[0].card.headline)
  })
})
