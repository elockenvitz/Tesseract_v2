/**
 * One asset's phone state never becomes another's.
 *
 * ── The defect, and how it differs from the desktop one ───────────────────
 *
 * The shell rendered this page unkeyed, so React kept ONE instance and swapped
 * the `asset` prop when the reader moved to a different asset. Both of this
 * page's values are seeded once, at mount:
 *
 *     subPage  = asset.focus ? 'case' : 'snapshot'
 *     bookId   = asset.portfolioId ?? null
 *
 * so neither was re-derived for the new asset.
 *
 * The desktop version of this bug also corrupted STORAGE, because AssetTab
 * persists and its save effect wrote the previous asset's state under the new
 * asset's id. This page persists nothing, so that half does not apply — and
 * saying so matters, because the remaining half is still serious: `bookId` is
 * handed to the Snapshot and to Decision Memory as `portfolioId`. Opening a
 * name from a portfolio lens and then opening a second name scoped the second
 * name's position and decision history to the FIRST name's book.
 *
 * These cases render the real component and read what it actually shows,
 * rather than asserting on the shape of the source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/* The panels are stubbed so the assertions read THIS page's wiring rather
   than four other components' data fetching. The Snapshot stub prints the
   book it was scoped to, which is the value the defect corrupted. */
vi.mock('../MobileInvestmentSnapshot', () => ({
  MobileInvestmentSnapshot: ({ assetId, portfolioId }: { assetId: string; portfolioId: string | null }) =>
    <div data-testid="snapshot" data-asset={assetId} data-book={String(portfolioId)} />,
}))
vi.mock('../MobileDecisionMemory', () => ({
  MobileDecisionMemory: ({ assetId, portfolioId }: { assetId: string; portfolioId: string | null }) =>
    <div data-testid="memory" data-asset={assetId} data-book={String(portfolioId)} />,
}))
vi.mock('../MobileCaseView', () => ({
  MobileCaseView: ({ assetId }: { assetId: string }) =>
    <div data-testid="case" data-asset={assetId} />,
}))
vi.mock('../../TickerQuoteBadge', () => ({ TickerQuoteBadge: () => <span /> }))
vi.mock('../../ExpandableText', () => ({ ExpandableText: () => <span /> }))
vi.mock('../../../../hooks/useAssetTradeIdeas', () => ({ useAssetTradeIdeas: () => ({ ideas: [], isLoading: false }) }))
vi.mock('../../../../hooks/useAssetRecentDecisions', () => ({
  useAssetRecentDecisions: () => ({ decisions: [], isLoading: false }),
  getDecisionLabel: () => '',
}))
vi.mock('../../../../hooks/useAssetHeaderContext', () => ({ useAssetHeaderContext: () => ({ headerContext: null, isLoading: false }) }))
vi.mock('../../../../hooks/useAssetPortfolioWeights', () => ({ useAssetPortfolioWeights: () => ({ weights: [], isLoading: false }) }))
vi.mock('../../../../hooks/useAssetLiveWeights', () => ({ useAssetLiveWeights: () => ({ weights: [], isLoading: false }) }))

const { MobileAssetPage } = await import('../MobileAssetPage')

const AMZN = { id: 'amzn', symbol: 'AMZN', portfolioId: 'book-vision-fund', focus: 'target' as const, focusRequestId: 'r-1' }
const TSLA = { id: 'tsla', symbol: 'TSLA', portfolioId: null, focusRequestId: 'r-2' }

const activeTab = () =>
  screen.getAllByTestId(/^mobile-asset-tab-/)
    .find(b => b.getAttribute('aria-current') === 'true')
    ?.getAttribute('data-testid')?.replace('mobile-asset-tab-', '') ?? null

/* The book is only on screen where it is USED — Snapshot and Decision Memory.
   On the Case tab there is nothing scoped by it, so read it from Snapshot and
   move there first when the page landed elsewhere. */
const goTo = (tab: string) => fireEvent.click(screen.getByTestId(`mobile-asset-tab-${tab}`))
const bookOnScreen = () => {
  if (!screen.queryByTestId('snapshot')) goTo('snapshot')
  return screen.queryByTestId('snapshot')?.getAttribute('data-book') ?? null
}

beforeEach(() => cleanup())

describe('switching assets, as the shell now renders it (keyed by tab)', () => {
  it('gives the second asset its OWN landing tab and its OWN book', () => {
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    /* AMZN arrived with a focus, so it lands on Case, scoped to its book. */
    expect(activeTab()).toBe('case')

    /* The shell swaps the key with the asset, which is a remount. */
    rerender(<MobileAssetPage key="tsla" asset={TSLA} />)
    expect(activeTab()).toBe('snapshot')
    expect(screen.getByTestId('snapshot').getAttribute('data-asset')).toBe('tsla')
    expect(bookOnScreen()).toBe('null')
  })

  it('does not scope the second asset to the first asset\'s book', () => {
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    rerender(<MobileAssetPage key="tsla" asset={TSLA} />)
    expect(bookOnScreen()).not.toBe('book-vision-fund')
  })

  it('restores each asset\'s own landing when the reader returns', () => {
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    rerender(<MobileAssetPage key="tsla" asset={TSLA} />)
    rerender(<MobileAssetPage key="amzn" asset={AMZN} />)
    expect(activeTab()).toBe('case')
    expect(bookOnScreen()).toBe('book-vision-fund')
  })

  it('survives repeated switching without drifting', () => {
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    for (let i = 0; i < 4; i++) {
      rerender(<MobileAssetPage key="tsla" asset={TSLA} />)
      expect(activeTab()).toBe('snapshot')
      rerender(<MobileAssetPage key="amzn" asset={AMZN} />)
      expect(activeTab()).toBe('case')
    }
  })
})

describe('the original behaviour, kept here so the fix cannot quietly regress', () => {
  it('leaks the first asset\'s tab and book when the instance is REUSED', () => {
    /*
     * Exactly what the shell did before: same element type, no key, only the
     * prop changes. React reuses the instance, the mount-only seeds never run
     * again, and TSLA is shown on AMZN's tab scoped to AMZN's book.
     *
     * This is the assertion that fails if the key is ever dropped from
     * DashboardPage — paired with the source check below, which is what ties
     * this component-level proof to the real call site.
     */
    const { rerender } = render(<MobileAssetPage asset={AMZN} />)
    expect(activeTab()).toBe('case')

    rerender(<MobileAssetPage asset={TSLA} />)
    expect(activeTab()).toBe('case')               // leaked: should be 'snapshot'
    expect(screen.getByTestId('case').getAttribute('data-asset')).toBe('tsla')
  })
})

describe('a genuinely new request to an asset that is already open', () => {
  it('lands on Case again without a remount', () => {
    /*
     * Keying removed the remount for a repeat navigation to the SAME asset,
     * so the page consumes `focusRequestId` to tell a new request from the
     * one it already acted on.
     */
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    /* The reader moves away from Case of their own accord. */
    goTo('lists')
    expect(activeTab()).toBe('lists')

    rerender(<MobileAssetPage key="amzn" asset={{ ...AMZN, focusRequestId: 'r-9' }} />)
    expect(activeTab()).toBe('case')
  })

  it('does not drag the reader back when nothing new was requested', () => {
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    goTo('lists')
    /* Same request id: a re-render, not a new navigation. */
    rerender(<MobileAssetPage key="amzn" asset={{ ...AMZN }} />)
    expect(activeTab()).toBe('lists')
  })

  it('re-seeds the book a new request carries, including when it carries none', () => {
    const { rerender } = render(<MobileAssetPage key="amzn" asset={AMZN} />)
    expect(bookOnScreen()).toBe('book-vision-fund')
    rerender(<MobileAssetPage key="amzn" asset={{ ...AMZN, portfolioId: null, focusRequestId: 'r-9' }} />)
    expect(bookOnScreen()).toBe('null')
  })
})

describe('the shell actually passes the key', () => {
  const PAGE = readFileSync(path.join(process.cwd(), 'src/pages/DashboardPage.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')

  it('keys the phone asset page on the asset tab', () => {
    expect(PAGE).toMatch(/<MobileAssetPage key=\{activeTab\.id\} asset=\{activeTab\.data\}/)
  })

  it('keys both pages on the model tab, which renders the same two components', () => {
    expect(PAGE).toMatch(/<MobileAssetPage key=\{activeTab\.id\} asset=\{modelAsset\}/)
    expect(PAGE).toMatch(/<AssetTab key=\{activeTab\.id\} asset=\{modelAsset\}/)
  })

  it('leaves no asset-bearing page unkeyed', () => {
    const unkeyed = PAGE.match(/<(?:MobileAssetPage|AssetTab) asset=/g) ?? []
    expect(unkeyed).toEqual([])
  })
})
