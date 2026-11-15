/**
 * Searching an asset while ACT AI is expanded has to show you the asset.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Expanded, the communication pane is `left-0 right-0 top-16 bottom-0`. It
 * covers the tab strip and the whole page, and the only control left in reach
 * is the header. So the header search bar — the one thing a reader can still
 * click — opened the asset tab BEHIND the conversation. Nothing on screen
 * changed. Searching an asset from inside ACT AI looked like it had navigated
 * within ACT AI, because afterwards ACT AI was still all there was to see.
 *
 * ── Why this renders `Layout` instead of reproducing its wiring ───────────
 *
 * The wiring IS the subject. `capture-draft.test` rebuilds Layout's drawer
 * props inside the test file to observe their order, which is fine for an
 * ordering claim but cannot fail when the real wiring changes — and the real
 * wiring is exactly what was wrong here. So the pane state is read off a
 * stubbed `CommunicationPane` that reports the props Layout actually passed
 * it, after a click on a stubbed `Header` that calls the prop Layout actually
 * gave it.
 *
 * ── What is deliberately NOT asserted ─────────────────────────────────────
 *
 * Anything about the search box, the result list, or what an asset tab
 * renders. Collapsing is not conditional on the destination: the pane covers
 * the page whatever the reader was going to look at.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

let isMobile = false

/* The chrome, reduced to the one prop under test. */
vi.mock('../Header', () => ({
  Header: ({ onSearchResult, onShowAI }: any) => (
    <div>
      <button
        data-testid="header-search-hit"
        onClick={() => onSearchResult({ id: 'a-1', title: 'AAPL', type: 'asset', data: {} })}
      >
        AAPL
      </button>
      <button data-testid="header-ai" onClick={onShowAI}>ACT AI</button>
    </div>
  ),
}))
/* The pane, reporting the state Layout put it in. */
vi.mock('../../communication/CommunicationPane', () => ({
  CommunicationPane: ({ isOpen, isFullscreen, onToggleFullscreen }: any) => (
    <div
      data-testid="pane"
      data-open={isOpen ? 'yes' : 'no'}
      data-fullscreen={isFullscreen ? 'yes' : 'no'}
    >
      <button data-testid="pane-expand" onClick={onToggleFullscreen}>Expand</button>
    </div>
  ),
}))
vi.mock('../TabManager', () => ({ TabManager: () => <div data-testid="tab-strip" /> }))
vi.mock('../../notifications/NotificationPane', () => ({ NotificationPane: () => null }))
vi.mock('../../mobile/MobileNavDrawer', () => ({
  MobileNavDrawer: ({ onSearchResult }: any) => (
    <button
      data-testid="drawer-hit"
      onClick={() => onSearchResult({ id: 'a-1', title: 'AAPL', type: 'asset', data: {} })}
    >
      AAPL
    </button>
  ),
}))
vi.mock('../../mobile/OverflowAuditOverlay', () => ({ OverflowAuditOverlay: () => null }))
vi.mock('../../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ ilike: () => ({ limit: () => ({ data: [] }) }) }) }) },
}))
vi.mock('../../../lib/engagement', () => ({ subscribeToEngagement: () => () => {} }))
vi.mock('../../../hooks/useNotifications', () => ({
  useNotifications: () => ({ hasUnreadNotifications: false }),
}))
vi.mock('../../../stores/sidebarStore', () => ({
  useSidebarStore: () => ({
    sidebarMode: 'capture', selectedItem: null,
    openCaptureSidebar: () => {}, openInspector: () => {}, backToCapture: () => {},
  }),
}))
vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ isOrgArchived: false, currentOrgId: 'o1' }),
}))
vi.mock('../../../hooks/useMediaQuery', () => ({ useIsMobile: () => isMobile }))

import { Layout } from '../Layout'

const TABS = [{ id: 't-home', title: 'Ideas', type: 'today', data: null } as any]

/* A component, not a bare `<div>`: Layout clones its child with `onCite` and
   `isFocusMode`, which React warns about on a DOM element. */
const Page = () => <div data-testid="page" />

function renderShell() {
  const opened: any[] = []
  render(
    <Layout
      tabs={TABS}
      activeTabId="t-home"
      onTabChange={() => {}}
      onTabClose={() => {}}
      onNewTab={() => {}}
      onTabReorder={() => {}}
      onSearchResult={result => opened.push(result)}
    >
      <Page />
    </Layout>,
  )
  return opened
}

const pane = () => screen.getByTestId('pane')
const openAi = () => fireEvent.click(screen.getByTestId('header-ai'))
const expand = () => fireEvent.click(screen.getByTestId('pane-expand'))

beforeEach(() => { isMobile = false })
afterEach(cleanup)

describe('the desktop rail', () => {
  it('is expanded over the page once the reader expands it', () => {
    /* Pinned so the assertions below cannot quietly start from a rail that
       was never covering anything. */
    renderShell()
    openAi()
    expand()
    expect(pane().getAttribute('data-fullscreen')).toBe('yes')
  })

  it('collapses when a header search result navigates', () => {
    const opened = renderShell()
    openAi()
    expand()

    fireEvent.click(screen.getByTestId('header-search-hit'))

    expect(pane().getAttribute('data-fullscreen')).toBe('no')
    expect(opened).toEqual([{ id: 'a-1', title: 'AAPL', type: 'asset', data: {} }])
  })

  it('stays open, because the reader did not close the conversation', () => {
    /*
     * The difference between collapsing and closing. A reader who asks about
     * a name and then goes to look at it wants both; discarding the thread
     * would punish them for doing the second thing.
     */
    renderShell()
    openAi()
    expand()

    fireEvent.click(screen.getByTestId('header-search-hit'))

    expect(pane().getAttribute('data-open')).toBe('yes')
  })

  it('leaves a pane that was already narrow exactly as it was', () => {
    /* At 384px the page is visible beside it, so there is nothing to get out
       of the way and nothing should move. */
    renderShell()
    openAi()

    fireEvent.click(screen.getByTestId('header-search-hit'))

    expect(pane().getAttribute('data-open')).toBe('yes')
    expect(pane().getAttribute('data-fullscreen')).toBe('no')
  })

  it('navigates when the pane was never opened at all', () => {
    const opened = renderShell()

    fireEvent.click(screen.getByTestId('header-search-hit'))

    expect(opened.length).toBe(1)
    expect(pane().getAttribute('data-open')).toBe('no')
  })
})

describe('the phone sheet', () => {
  beforeEach(() => { isMobile = true })

  it('hides, because a sheet has no narrow form to collapse into', () => {
    const opened = renderShell()
    openAi()
    expect(pane().getAttribute('data-open')).toBe('yes')

    fireEvent.click(screen.getByTestId('header-search-hit'))

    expect(pane().getAttribute('data-open')).toBe('no')
    expect(opened.length).toBe(1)
  })

  it('hides for the nav drawer too, on the same seam', () => {
    /* The drawer had its own inline copy of this rule. It now shares one, so
       the two cannot drift apart. */
    renderShell()
    openAi()

    fireEvent.click(screen.getByTestId('drawer-hit'))

    expect(pane().getAttribute('data-open')).toBe('no')
  })
})
