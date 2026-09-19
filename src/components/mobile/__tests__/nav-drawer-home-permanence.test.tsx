/**
 * Home is navigation. Open tabs are state. The second must never hide the first.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Around five open tabs, Home > Ideas disappeared from the phone drawer.
 *
 * Two faults compounded. The drawer drew the Home row as `{ideasTab && …}` —
 * a reflection of an open tab rather than a fixed destination. And the phone
 * tab cap in `DashboardPage` exempted `'dashboard'`, the id the home tab had
 * when the cap was written, so the canonical `today` tab was closable. Home is
 * the first tab of a session, so it sits at the front of `tabs`, which is
 * exactly where the cap's `slice(0, …)` takes from. Opening a sixth tab closed
 * the home tab first, and the Home section went with it.
 *
 * So the reader lost their way back to the feed by doing nothing more unusual
 * than opening things.
 *
 * The cap now exempts both ids, and the row is drawn unconditionally, pinned
 * outside the scroller. The tab-set assertions live in
 * `mobile-tab-cap.test`; these are about what the drawer shows.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))

import { MobileNavDrawer } from '../MobileNavDrawer'
import { CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID } from '../../../lib/tabStateManager'

afterEach(cleanup)

const homeTab = { ...CANONICAL_HOME_TAB, isActive: true } as any

/** `n` ordinary workspace tabs, the kind a busy session accumulates. */
function workspaces(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `asset-${i}`,
    title: `TICK${i}`,
    type: 'asset',
    data: { symbol: `TICK${i}` },
  })) as any[]
}

function view(tabs: any[], activeTabId = CANONICAL_HOME_TAB.id) {
  cleanup()
  const onTabChange = vi.fn()
  const onSearchResult = vi.fn()
  const r = render(
    <MobileNavDrawer
      open
      onClose={() => {}}
      onSearchResult={onSearchResult}
      tabs={tabs}
      activeTabId={activeTabId}
      onTabChange={onTabChange}
      onTabClose={() => {}}
    />,
  )
  return { ...r, onTabChange, onSearchResult }
}

/** The drawer portals to body. */
const body = () => document.body.textContent ?? ''
/**
 * The PINNED Home row.
 *
 * Scoped, because the Core list also carries an Ideas row pointing at the same
 * canonical home — a duplicate destination that predates this fix and is left
 * alone here. `getByText('Ideas')` would find both.
 */
const homeBlock = () => screen.getByTestId('drawer-home')
const homeRow = () => homeBlock().querySelector('button') as HTMLElement

describe('Home survives any number of open tabs', () => {
  it.each([0, 1, 5, 10, 25])('is visible with %i workspace tabs open', n => {
    view([homeTab, ...workspaces(n)])

    expect(body()).toContain('Home')
    expect(homeRow()).toBeTruthy()
  })

  it('is visible even when the home tab itself is gone', () => {
    // The state the cap used to leave behind. Permanent navigation cannot be
    // contingent on a tab that something else is allowed to close.
    view(workspaces(8), 'asset-3')

    expect(body()).toContain('Home')
    expect(homeRow()).toBeTruthy()
  })

  it('is visible for a restored session that never carried a home tab', () => {
    view(workspaces(3), 'asset-0')

    expect(homeRow()).toBeTruthy()
  })
})

describe('open tabs stay reachable underneath it', () => {
  it('still lists recent workspaces beside a permanent Home', () => {
    view([homeTab, ...workspaces(5)])

    expect(body()).toContain('Recent')
    expect(screen.getByText('TICK4')).toBeTruthy()
  })

  it('scrolls the tabs, not the Home row', () => {
    view([homeTab, ...workspaces(12)])
    const home = homeRow()
    // The drawer portals to body, so the scroller is not under `container`.
    const scroller = document.querySelector('.overflow-y-auto.overscroll-contain') as HTMLElement

    // Home sits outside the scroll region, so a long list cannot push it away.
    expect(scroller).toBeTruthy()
    expect(scroller.contains(home)).toBe(false)
  })

  it('gives the scroller a min-height of zero so it can actually shrink', () => {
    // Without `min-h-0` a flex child refuses to shrink below its content, and
    // the scroll region grows instead of scrolling — which is how a long tab
    // list pushes fixed chrome off a short screen.
    view([homeTab, ...workspaces(12)])
    const scroller = document.querySelector('.overflow-y-auto.overscroll-contain') as HTMLElement

    expect(scroller.className).toContain('min-h-0')
  })
})

describe('tapping Home goes to the one canonical home', () => {
  it('activates the existing home tab rather than opening another', () => {
    const { onTabChange, onSearchResult } = view([homeTab, ...workspaces(6)])

    fireEvent.click(homeRow())

    expect(onTabChange).toHaveBeenCalledWith(CANONICAL_HOME_TAB.id)
    expect(onSearchResult).not.toHaveBeenCalled()
  })

  it('asks for the canonical home by id when no home tab is open', () => {
    const { onSearchResult, onTabChange } = view(workspaces(6), 'asset-1')

    fireEvent.click(homeRow())

    // By id, so the shell's own match-on-id activates rather than duplicates.
    expect(onSearchResult).toHaveBeenCalledWith(
      expect.objectContaining({ id: CANONICAL_HOME_TAB.id, type: CANONICAL_HOME_TAB.type }),
    )
    expect(onTabChange).not.toHaveBeenCalled()
  })

  it('never asks for the legacy id, which would open a second home', () => {
    const { onSearchResult } = view(workspaces(6), 'asset-1')

    fireEvent.click(homeRow())

    expect(onSearchResult.mock.calls[0][0].id).not.toBe(LEGACY_DASHBOARD_ID)
  })

  it('activates a restored legacy home rather than opening the canonical one beside it', () => {
    const legacy = { id: LEGACY_DASHBOARD_ID, title: 'Dashboard', type: 'dashboard' } as any
    const { onTabChange } = view([legacy, ...workspaces(4)], LEGACY_DASHBOARD_ID)

    fireEvent.click(homeRow())

    expect(onTabChange).toHaveBeenCalledWith(LEGACY_DASHBOARD_ID)
  })
})

describe('the Home row knows whether it is where you are', () => {
  it('reads active when the canonical home is active', () => {
    view([homeTab, ...workspaces(4)], CANONICAL_HOME_TAB.id)

    expect(homeRow().className).toContain('font-semibold')
  })

  it('reads active for a restored legacy home too', () => {
    const legacy = { id: LEGACY_DASHBOARD_ID, title: 'Dashboard', type: 'dashboard' } as any
    view([legacy], LEGACY_DASHBOARD_ID)

    expect(homeRow().className).toContain('font-semibold')
  })

  it('reads inactive when the reader is on a workspace', () => {
    view([homeTab, ...workspaces(4)], 'asset-2')

    expect(homeRow().className).not.toContain('font-semibold')
  })

  it('reads inactive when no home tab exists at all', () => {
    view(workspaces(4), 'asset-2')

    expect(homeRow().className).not.toContain('font-semibold')
  })
})

describe('Home is not duplicated into the tab list', () => {
  it('keeps the home tab out of Recent, so the pinned row is the only copy of it', () => {
    view([homeTab, ...workspaces(3)])

    // The anchored tab is excluded from Recent. The Core list's own Ideas row
    // is a separate, pre-existing duplicate destination, noted not fixed here.
    expect(homeBlock().querySelectorAll('button')).toHaveLength(1)
    expect(screen.queryByText('TICK0')).toBeTruthy()
  })
})
