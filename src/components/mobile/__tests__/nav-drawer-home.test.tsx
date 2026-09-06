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
import { CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID, LEGACY_DASHBOARD_TITLE } from '../../../lib/tabStateManager'
import { getMobileNavSurfaces } from '../../../lib/mobile/mobile-surfaces'

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

describe('the Core Ideas row lands on the home tab', () => {
  it('is the canonical home surface, not the legacy one', () => {
    const ideas = getMobileNavSurfaces('core').filter(s => s.title === 'Ideas')
    expect(ideas).toHaveLength(1)
    // Tapping it sends `{ id: surface.type }`, which DashboardPage matches
    // against existing tab ids — so this type IS the home tab's id.
    expect(ideas[0].type).toBe(CANONICAL_HOME_TAB.id)
    expect(ideas[0].type).toBe(CANONICAL_HOME_TAB.type)
  })
})
