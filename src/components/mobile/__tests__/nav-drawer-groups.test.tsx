/**
 * Every surface the registry says is reachable on a phone is in the drawer.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `lib/mobile/mobile-surfaces.ts` is meant to be the ONE place "what works on
 * a phone" is decided — the file says so, and adding a mobile treatment is
 * supposed to be a one-line change there. The registry declares three groups:
 * core, work and admin. The drawer rendered core and work.
 *
 * So Organization, Allocation, Charting, Audit and Target Date were all
 * registered `inNav: true` with a read-only phone treatment, and had no route
 * to them from a phone at all. Nothing was broken-looking; they simply were
 * not there, and the registry quietly disagreed with the navigation for as
 * long as nobody enumerated it.
 *
 * This asserts the relationship rather than the list, so a surface added to
 * the registry tomorrow is covered without editing this file.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))

import { MobileNavDrawer } from '../MobileNavDrawer'
import { CANONICAL_HOME_TAB } from '../../../lib/tabStateManager'
import {
  MOBILE_SURFACES,
  getMobileNavSurfaces,
  type MobileSurfaceGroup,
} from '../../../lib/mobile/mobile-surfaces'

/** The drawer portals to document.body, so assert against the body. */
const body = () => document.body.textContent ?? ''

const homeTab = { ...CANONICAL_HOME_TAB, isActive: true } as any

afterEach(cleanup)

function view() {
  const onSearchResult = vi.fn()
  const r = render(
    <MobileNavDrawer
      open
      onClose={() => {}}
      onSearchResult={onSearchResult}
      tabs={[homeTab]}
      activeTabId={CANONICAL_HOME_TAB.id}
      onTabChange={() => {}}
      onTabClose={() => {}}
    />,
  )
  return { ...r, onSearchResult }
}

const GROUPS: MobileSurfaceGroup[] = ['core', 'work', 'admin']

describe('the drawer offers every group the registry defines', () => {
  it('has at least one nav surface in each group, or this test proves nothing', () => {
    for (const group of GROUPS) {
      expect(getMobileNavSurfaces(group).length).toBeGreaterThan(0)
    }
  })

  it('lists every registered nav surface, group by group', () => {
    view()
    const text = body()

    for (const group of GROUPS) {
      for (const surface of getMobileNavSurfaces(group)) {
        expect(text).toContain(surface.title)
      }
    }
  })

  it('names the admin group in the drawer, so its rows are not orphaned', () => {
    view()
    expect(body()).toContain('Analysis')
  })
})

describe('the admin surfaces actually open', () => {
  it.each(getMobileNavSurfaces('admin').map(s => [s.title, s.type, s.support] as const))(
    'opens %s on its registered tab type',
    (title, type) => {
      const { onSearchResult, getAllByText } = view()

      fireEvent.click(getAllByText(title as string)[0])

      expect(onSearchResult).toHaveBeenCalledWith(
        expect.objectContaining({ type, title }),
      )
    },
  )

  it('never routes one of them into a desktop-only placeholder', () => {
    for (const surface of getMobileNavSurfaces('admin')) {
      expect(surface.support).not.toBe('desktop-only')
    }
  })
})

describe('the registry and the drawer cannot drift apart', () => {
  it('has no nav-registered surface outside the groups the drawer renders', () => {
    const orphans = MOBILE_SURFACES
      .filter(s => s.inNav && s.support !== 'desktop-only')
      .filter(s => !GROUPS.includes(s.group))
      .map(s => s.type)

    expect(orphans).toEqual([])
  })
})
