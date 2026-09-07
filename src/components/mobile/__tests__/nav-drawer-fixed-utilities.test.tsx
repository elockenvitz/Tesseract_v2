/**
 * Search and Home are utilities, and utilities do not scroll away.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Home was pinned in the previous stage and Search was not. Search sat inside
 * the scroll region, under the org switcher, so on a session with many open
 * tabs the two controls a reader reaches for most were pushed off the top of
 * the drawer by a Recent list they were not looking for. Those two controls are
 * the reason to open the drawer at all.
 *
 * The order is deliberate rather than incidental: search finds anything, Home
 * returns to the one place, and everything below is browsing.
 *
 * These assert structure rather than pixels. jsdom lays nothing out, so what
 * can be proved is which region each control lives in — which is exactly what
 * the bug was.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))

import { MobileNavDrawer } from '../MobileNavDrawer'
import { CANONICAL_HOME_TAB } from '../../../lib/tabStateManager'

afterEach(cleanup)

const homeTab = { ...CANONICAL_HOME_TAB, isActive: true } as any

const workspaces = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `asset-${i}`, title: `TICK${i}`, type: 'asset', data: { symbol: `TICK${i}` },
  })) as any[]

function view(tabs: any[], activeTabId = CANONICAL_HOME_TAB.id) {
  cleanup()
  const onTabChange = vi.fn()
  const onSearchResult = vi.fn()
  const onOpenSearch = vi.fn()
  const onClose = vi.fn()
  const r = render(
    <MobileNavDrawer
      open
      onClose={onClose}
      onSearchResult={onSearchResult}
      onOpenSearch={onOpenSearch}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      onTabClose={() => {}}
    />,
  )
  return { ...r, onTabChange, onSearchResult, onOpenSearch, onClose }
}

const search = () => screen.getByTestId('drawer-search')
const homeBlock = () => screen.getByTestId('drawer-home')
const scroller = () =>
  document.querySelector('.overflow-y-auto.overscroll-contain.pb-safe') as HTMLElement

describe('neither utility lives in the scroll region', () => {
  it.each([0, 5, 12, 30])('search stays out of the scroller with %i tabs', n => {
    view([homeTab, ...workspaces(n)])

    expect(scroller().contains(search())).toBe(false)
  })

  it.each([0, 5, 12, 30])('home stays out of the scroller with %i tabs', n => {
    view([homeTab, ...workspaces(n)])

    expect(scroller().contains(homeBlock())).toBe(false)
  })

  it('keeps both visible when the home tab itself is gone', () => {
    view(workspaces(10), 'asset-4')

    expect(search()).toBeTruthy()
    expect(homeBlock()).toBeTruthy()
  })
})

describe('search sits above home, and both above the lists', () => {
  it('orders search, then home, then the scroller', () => {
    view([homeTab, ...workspaces(6)])
    const order = (el: Element) =>
      // 4 = DOCUMENT_POSITION_FOLLOWING
      // eslint-disable-next-line no-bitwise
      el.compareDocumentPosition(homeBlock()) & 4

    // Search precedes Home.
    expect(order(search())).toBeTruthy()
    // Home precedes the scroller.
    // eslint-disable-next-line no-bitwise
    expect(homeBlock().compareDocumentPosition(scroller()) & 4).toBeTruthy()
  })

  it('puts Recent directly below Home, above the catalogue', () => {
    // Recent is contextual navigation — where this reader already is. Core is
    // the application catalogue. Under a pinned Home the useful next thing is
    // the former.
    view([homeTab, ...workspaces(4)])
    const text = scroller().textContent ?? ''

    expect(text.indexOf('Recent')).toBe(0)
    expect(text.indexOf('Recent')).toBeLessThan(text.indexOf('Core'))
  })

  it('orders the whole scroller Recent, Core, Work, Analysis, Help', () => {
    view([homeTab, ...workspaces(4)])
    const text = scroller().textContent ?? ''

    // Read the section labels off the rendered order rather than looking each
    // one up, so a section appearing in the wrong place fails rather than
    // merely comparing a list against itself.
    const rendered = [...(scroller().querySelectorAll('span.uppercase'))]
      .map(el => el.textContent?.trim())

    expect(rendered).toEqual(['Recent', 'Core', 'Work', 'Analysis', 'Help'])
    expect(text.indexOf('Recent')).toBe(0)
  })

  it('makes Core the first scrollable section when nothing is open', () => {
    view([homeTab])
    const text = scroller().textContent ?? ''

    expect(text).not.toContain('Recent')
    expect(text.indexOf('Core')).toBe(0)
  })

  it.each([1, 5, 12, 30])('keeps Recent first with %i open workspaces', n => {
    view([homeTab, ...workspaces(n)])
    const text = scroller().textContent ?? ''

    expect(text.indexOf('Recent')).toBe(0)
    expect(text.indexOf('Recent')).toBeLessThan(text.indexOf('Core'))
  })

  it('scrolls Recent with the rest rather than pinning it', () => {
    view([homeTab, ...workspaces(10)])

    // Contextual navigation, but still navigation: only Search and Home are
    // fixed, and Recent must not join them.
    expect(scroller().textContent).toContain('Recent')
    expect(scroller().contains(search())).toBe(false)
    expect(scroller().contains(homeBlock())).toBe(false)
  })
})

describe('the scroller is the only thing that scrolls', () => {
  it('can shrink, so a long list scrolls rather than pushing the utilities out', () => {
    view([homeTab, ...workspaces(20)])

    expect(scroller().className).toContain('flex-1')
    expect(scroller().className).toContain('min-h-0')
  })

  it('keeps the fixed blocks from shrinking under pressure', () => {
    view([homeTab, ...workspaces(20)])

    expect(search().parentElement!.className).toContain('flex-shrink-0')
    expect(homeBlock().className).toContain('flex-shrink-0')
  })

  it('still lists the open workspaces underneath', () => {
    view([homeTab, ...workspaces(5)])

    expect(scroller().textContent).toContain('TICK4')
  })
})

describe('the controls still work, and only exist once', () => {
  it('opens the search overlay and closes the drawer', () => {
    const { onClose } = view([homeTab])
    const events: Event[] = []
    const listener = (e: Event) => events.push(e)
    window.addEventListener('open-mobile-search', listener)

    fireEvent.click(search())

    window.removeEventListener('open-mobile-search', listener)
    expect(events).toHaveLength(1)
    expect(onClose).toHaveBeenCalled()
  })

  it('still activates the canonical home from the Ideas row', () => {
    const { onTabChange } = view([homeTab, ...workspaces(8)])

    fireEvent.click(homeBlock().querySelector('button')!)

    expect(onTabChange).toHaveBeenCalledWith(CANONICAL_HOME_TAB.id)
  })

  it('draws one search control and one Ideas control', () => {
    view([homeTab, ...workspaces(6)])

    expect(screen.getAllByTestId('drawer-search')).toHaveLength(1)
    expect(
      [...document.body.querySelectorAll('button')].filter(b => b.textContent?.trim() === 'Ideas'),
    ).toHaveLength(1)
  })

  it('is absent when the host offers no search, rather than rendering a dead row', () => {
    cleanup()
    render(
      <MobileNavDrawer
        open
        onClose={() => {}}
        tabs={[homeTab]}
        activeTabId={CANONICAL_HOME_TAB.id}
        onTabChange={() => {}}
        onTabClose={() => {}}
      />,
    )

    expect(screen.queryByTestId('drawer-search')).toBeNull()
  })
})

describe('the utilities are compact without losing their targets', () => {
  it('keeps search at 44px, the smallest a thumb should be asked for', () => {
    view([homeTab])

    expect(search().className).toContain('h-11')
  })

  it('keeps the Ideas row at 48px', () => {
    view([homeTab])

    expect(homeBlock().querySelector('button')!.className).toContain('h-12')
  })

  it('gives the pinned Home label less padding than a scrolling section', () => {
    view([homeTab])
    const label = homeBlock().querySelector('.px-4') as HTMLElement

    expect(label.className).toContain('pt-2')
    expect(label.className).not.toContain('pt-4')
  })

  it('still names the section Home, so the hierarchy reads as before', () => {
    view([homeTab])

    expect(homeBlock().textContent).toContain('Home')
    expect(homeBlock().textContent).toContain('Ideas')
  })
})
