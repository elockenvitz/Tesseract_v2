/**
 * What the phone nav drawer says is open.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The drawer anchors the home surface in its own "Home" section, labelled
 * Ideas, above the Recent list. It found that tab by id — and the id it
 * looked for was `dashboard`, which was the home id when the section was
 * written.
 *
 * The home later became `today`. The lookup then missed, so the Home section
 * disappeared and the home tab fell through into Recent under its desktop
 * title. A phone that had just opened on the ideas feed showed a drawer
 * saying "Dashboard" was the open surface, with no Home > Ideas at all.
 *
 * The Core list had the matching half of the same bug: its Ideas row was
 * still the legacy `dashboard` entry, so tapping it opened a second home tab
 * beside the real one instead of activating it.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))

import { MobileNavDrawer } from '../MobileNavDrawer'
import { DesktopOnlyCard } from '../DesktopOnlyCard'
import { CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID, LEGACY_DASHBOARD_TITLE } from '../../../lib/tabStateManager'
import { getMobileNavSurfaces, getMobileSupport, isDesktopOnly } from '../../../lib/mobile/mobile-surfaces'

/** The drawer portals to document.body, so assert against the body. */
const body = () => document.body.textContent ?? ''

/** The session a phone actually logs in with: the canonical home, alone. */
const homeTab = { ...CANONICAL_HOME_TAB, isActive: true } as any

function view(over: any = {}) {
  const onTabChange = vi.fn()
  const onSearchResult = vi.fn()
  document.body.innerHTML = ''
  const r = render(
    <MobileNavDrawer
      open
      onClose={() => {}}
      onSearchResult={onSearchResult}
      tabs={[homeTab]}
      activeTabId={CANONICAL_HOME_TAB.id}
      onTabChange={onTabChange}
      onTabClose={() => {}}
      {...over}
    />,
  )
  return { ...r, onTabChange, onSearchResult }
}

describe('the drawer names the home surface Ideas', () => {
  it('shows a Home section for the canonical home tab', () => {
    view()
    expect(body()).toContain('Home')
    expect(body()).toContain('Ideas')
  })

  it('does not list the home tab under Recent as "Dashboard"', () => {
    // The exact symptom: the feed was on screen while the drawer said the
    // open surface was Dashboard.
    view()
    expect(body()).not.toContain('Recent')
    expect(body()).not.toContain(CANONICAL_HOME_TAB.title)
  })

  it('activates the existing home tab rather than opening another', () => {
    const { onTabChange } = view()
    const home = [...document.body.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Ideas')!
    fireEvent.click(home)
    expect(onTabChange).toHaveBeenCalledWith(CANONICAL_HOME_TAB.id)
  })

  it('still anchors a legacy-only session on its dashboard tab', () => {
    // A session saved before the home was renamed has no `today` tab. It
    // should still get a Home row, not lose one.
    const legacy = { id: LEGACY_DASHBOARD_ID, title: 'Dashboard', type: 'dashboard', isActive: true }
    const { onTabChange } = view({ tabs: [legacy], activeTabId: LEGACY_DASHBOARD_ID })
    const home = [...document.body.querySelectorAll('button')]
      .find(b => b.textContent?.trim() === 'Ideas')!
    fireEvent.click(home)
    expect(onTabChange).toHaveBeenCalledWith(LEGACY_DASHBOARD_ID)
  })

  it('keeps a restored legacy tab in Recent when it is not the home', () => {
    // Both present: `today` anchors Home, and the legacy tab stays reachable
    // under the name the restore path gives it instead of vanishing.
    view({ tabs: [homeTab, { id: LEGACY_DASHBOARD_ID, title: LEGACY_DASHBOARD_TITLE, type: 'dashboard' }] })
    expect(body()).toContain('Recent')
    expect(body()).toContain(LEGACY_DASHBOARD_TITLE)
  })
})

describe('there is one route to Ideas, and it is the pinned one', () => {
  /*
    The Core list used to carry its own Ideas row, and had to: the Home section
    was drawn only when a home tab happened to be open, so Core was the reliable
    way back. Home is permanent now — drawn whether or not a tab exists, opening
    the canonical home by id — and the Core row became a second control doing
    the identical thing in the same drawer.
  */
  it('offers no Ideas row under Core', () => {
    expect(getMobileNavSurfaces('core').filter(s => s.title === 'Ideas')).toHaveLength(0)
  })

  it('offers no Ideas row in any group', () => {
    const everywhere = (['core', 'work', 'admin'] as const)
      .flatMap(g => getMobileNavSurfaces(g))
      .filter(s => s.title === 'Ideas')

    expect(everywhere).toEqual([])
  })

  it('keeps `today` registered as a full phone surface all the same', () => {
    // Dropping the ENTRY rather than its nav flag would default `today` to
    // desktop-only, which is how the home tab once served a "Dashboard is
    // desktop only" card to every phone that opened it.
    expect(getMobileSupport(CANONICAL_HOME_TAB.type)).toBe('full')
    expect(isDesktopOnly(CANONICAL_HOME_TAB.type)).toBe(false)
  })

  it('draws exactly one Ideas control in the whole drawer', () => {
    view()
    const ideas = Array.from(document.body.querySelectorAll('button'))
      .filter(b => b.textContent?.trim() === 'Ideas')

    expect(ideas).toHaveLength(1)
  })

  it('and that one is the pinned Home row', () => {
    const { onTabChange } = view()
    const ideas = Array.from(document.body.querySelectorAll('button'))
      .find(b => b.textContent?.trim() === 'Ideas')!

    expect(document.body.querySelector('[data-testid="drawer-home"]')!.contains(ideas)).toBe(true)

    fireEvent.click(ideas)
    expect(onTabChange).toHaveBeenCalledWith(CANONICAL_HOME_TAB.id)
  })
})

describe('the desktop-only dead end keeps the way home', () => {
  it('offers Ideas first, even though Ideas left the Core nav list', () => {
    // This card is where a phone lands on a surface it cannot use, so the
    // route back matters more here than anywhere. The list was
    // `getMobileNavSurfaces('core')` and Ideas was simply the first entry.
    document.body.innerHTML = ''
    const { container } = render(<DesktopOnlyCard type="research-v2" onOpenSurface={() => {}} />)

    const first = container.querySelectorAll('button')[0]
    expect(first.textContent).toContain('Ideas')
  })

  it('sends the canonical home id, so it activates rather than duplicates', () => {
    const onOpenSurface = vi.fn()
    document.body.innerHTML = ''
    const { container } = render(<DesktopOnlyCard type="research-v2" onOpenSurface={onOpenSurface} />)

    fireEvent.click(container.querySelectorAll('button')[0])

    expect(onOpenSurface).toHaveBeenCalledWith(
      expect.objectContaining({ id: CANONICAL_HOME_TAB.type, type: CANONICAL_HOME_TAB.type }),
    )
  })

  it('lists it once, not twice', () => {
    document.body.innerHTML = ''
    const { container } = render(<DesktopOnlyCard type="research-v2" onOpenSurface={() => {}} />)

    expect([...container.querySelectorAll('button')].filter(b => b.textContent?.includes('Ideas')))
      .toHaveLength(1)
  })
})
