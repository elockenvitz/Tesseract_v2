/**
 * The compatibility boundary for a retired surface.
 *
 * Two claims worth pinning: a saved session still opens something, and it does
 * not open two of them.
 */

import { describe, it, expect } from 'vitest'
import {
  canonicalTabTarget, isLegacyTabType, migrateLegacyTabs, LEGACY_TAB_ALIASES,
} from '../legacy-tab-aliases'

const tab = (id: string, type: string, data: unknown = null) =>
  ({ id, type, title: 'x', data })

describe('canonicalTabTarget', () => {
  it('sends the retired ideas app to the canonical one', () => {
    expect(canonicalTabTarget(tab('idea-generator', 'idea-generator'))).toEqual({
      id: 'ideas', type: 'ideas', title: 'Ideas', data: undefined,
    })
  })

  /**
   * The id moves too, because the shell reuses a tab by id. Leaving it would
   * put two tabs on one application, which is the duplicate this prevents.
   */
  it('rewrites the id, not only the type', () => {
    expect(canonicalTabTarget(tab('idea-generator', 'idea-generator')).id).toBe('ideas')
  })

  /**
   * Filters, view mode and a selected thought belonged to an application that
   * no longer exists. Carrying them over would invent a state nobody chose.
   */
  it('drops state that has no counterpart', () => {
    const out = canonicalTabTarget(tab('idea-generator', 'idea-generator', {
      initialFilters: { scope: 'team', view: 'discovery' },
      selectedThoughtId: 'abc',
    }))
    expect(out.data).toBeUndefined()
  })

  it('leaves every other tab exactly as it is', () => {
    const t = tab('asset-1', 'asset', { symbol: 'AAPL' })
    expect(canonicalTabTarget(t)).toBe(t)
  })

  /**
   * `ideas-v2` is the Dashboard's Ideas LENS, not an application. Aliasing it
   * to the standalone app would move a reader to a surface they never chose.
   */
  it('does not alias the dashboard ideas lens', () => {
    expect(isLegacyTabType('ideas-v2')).toBe(false)
    expect(LEGACY_TAB_ALIASES['ideas-v2']).toBeUndefined()
    const t = tab('ideas-v2', 'ideas-v2')
    expect(canonicalTabTarget(t)).toBe(t)
  })

  it('tolerates a descriptor with no type', () => {
    const t = { id: 'x' }
    expect(canonicalTabTarget(t)).toBe(t)
  })

  it('sends the legacy desktop Dashboard to the canonical one', () => {
    expect(canonicalTabTarget(tab('dashboard', 'dashboard'))).toEqual({
      id: 'today', type: 'today', title: 'Dashboard', data: undefined,
    })
  })

  /**
   * The rewrite is device-blind on purpose, and safe because `DashboardPage`
   * already routes `today` on a phone into `renderDashboardContent()`, which
   * returns `MobileDashboard` — the same component `dashboard` reached there.
   * This pins the target so a future change to the alias cannot quietly send a
   * phone somewhere `MobileDashboard` does not live.
   */
  it('targets the type that a phone already resolves to MobileDashboard', () => {
    expect(LEGACY_TAB_ALIASES['dashboard'].type).toBe('today')
    expect(LEGACY_TAB_ALIASES['dashboard'].id).toBe('today')
  })

  /**
   * My Priorities was a shell over the attention system, which is what Today
   * reads. Retiring it removed a second front door, not a capability, so the
   * tab that meant "show me what needs me" resolves to the surface that still
   * answers that.
   */
  it('sends the retired Priorities app to Today', () => {
    expect(canonicalTabTarget(tab('priorities', 'priorities'))).toEqual({
      id: 'today', type: 'today', title: 'Today', data: undefined,
    })
  })

  /**
   * `prioritizer` was the original id for the same page — `DashboardPage`
   * rendered both through one `case` — so both are live in saved sessions.
   * Aliasing only the newer one would leave older sessions resolving to
   * nothing.
   */
  it('sends the older Priorities id to Today as well', () => {
    expect(canonicalTabTarget(tab('prioritizer', 'prioritizer'))).toEqual({
      id: 'today', type: 'today', title: 'Today', data: undefined,
    })
    expect(isLegacyTabType('prioritizer')).toBe(true)
  })

  /** Both ids land on one tab, not two views of a page that is gone. */
  it('gives both Priorities ids the same target', () => {
    expect(LEGACY_TAB_ALIASES['priorities']).toEqual(LEGACY_TAB_ALIASES['prioritizer'])
  })
})

describe('migrateLegacyTabs', () => {
  it('restores a saved legacy tab as the canonical one', () => {
    const { tabs, migrated } = migrateLegacyTabs(
      [tab('lab', 'trade-lab'), tab('idea-generator', 'idea-generator')],
      'lab',
    )
    expect(tabs.map(t => t.type)).toEqual(['trade-lab', 'ideas'])
    expect(migrated).toEqual(['idea-generator'])
  })

  /** A session holding both becomes a session holding one. */
  it('collapses a legacy tab onto an already-open canonical one', () => {
    const { tabs } = migrateLegacyTabs(
      [tab('ideas', 'ideas'), tab('idea-generator', 'idea-generator')],
      'ideas',
    )
    expect(tabs).toHaveLength(1)
    expect(tabs[0].id).toBe('ideas')
  })

  it('keeps the reader ordering when the legacy tab came first', () => {
    const { tabs } = migrateLegacyTabs(
      [tab('idea-generator', 'idea-generator'), tab('lab', 'trade-lab')],
      'lab',
    )
    expect(tabs.map(t => t.id)).toEqual(['ideas', 'lab'])
  })

  /** Otherwise the session restores with an active id no tab has. */
  it('follows the active tab through the rename', () => {
    const { activeTabId } = migrateLegacyTabs(
      [tab('dashboard', 'dashboard'), tab('idea-generator', 'idea-generator')],
      'idea-generator',
    )
    expect(activeTabId).toBe('ideas')
  })

  it('leaves an unrelated session untouched', () => {
    const input = [tab('lab', 'trade-lab'), tab('asset-1', 'asset')]
    const { tabs, activeTabId, migrated } = migrateLegacyTabs(input, 'asset-1')
    expect(tabs).toEqual(input)
    expect(activeTabId).toBe('asset-1')
    expect(migrated).toEqual([])
  })

  it('survives an empty or malformed session', () => {
    expect(migrateLegacyTabs([], null).tabs).toEqual([])
    expect(migrateLegacyTabs(undefined as never, undefined).tabs).toEqual([])
  })

  it('collapses a session holding both Dashboards onto the canonical one', () => {
    const { tabs, activeTabId } = migrateLegacyTabs(
      [tab('dashboard', 'dashboard'), tab('today', 'today'), tab('asset-1', 'asset')],
      'dashboard',
    )
    expect(tabs.filter(t => t.type === 'today')).toHaveLength(1)
    expect(tabs.map(t => t.id)).toEqual(['today', 'asset-1'])
    expect(activeTabId).toBe('today')
  })

  /** Both retirements at once, which is the shape of a genuinely old session. */
  it('migrates a session carrying both retired surfaces', () => {
    const { tabs, migrated } = migrateLegacyTabs(
      [tab('dashboard', 'dashboard'), tab('idea-generator', 'idea-generator')],
      'idea-generator',
    )
    expect(tabs.map(t => t.type)).toEqual(['today', 'ideas'])
    expect(migrated).toEqual(['dashboard', 'idea-generator'])
  })

  it('restores a saved Priorities tab as Today', () => {
    const { tabs, migrated } = migrateLegacyTabs(
      [tab('lab', 'trade-lab'), tab('priorities', 'priorities')],
      'lab',
    )
    expect(tabs.map(t => t.type)).toEqual(['trade-lab', 'today'])
    expect(migrated).toEqual(['priorities'])
  })

  /** A reader who was looking at Priorities is still looking at something. */
  it('follows an active Priorities tab through the rename', () => {
    const { activeTabId, tabs } = migrateLegacyTabs(
      [tab('lab', 'trade-lab'), tab('priorities', 'priorities')],
      'priorities',
    )
    expect(activeTabId).toBe('today')
    expect(tabs.some(t => t.id === 'today')).toBe(true)
  })

  /** Two doors onto one page must not restore as two tabs. */
  it('collapses Priorities onto an already-open Today', () => {
    const { tabs, activeTabId } = migrateLegacyTabs(
      [tab('today', 'today'), tab('priorities', 'priorities'), tab('asset-1', 'asset')],
      'priorities',
    )
    expect(tabs.filter(t => t.type === 'today')).toHaveLength(1)
    expect(tabs.map(t => t.id)).toEqual(['today', 'asset-1'])
    expect(activeTabId).toBe('today')
  })

  /** The old id and the new one were the same page; they collapse too. */
  it('collapses a session holding both Priorities ids', () => {
    const { tabs } = migrateLegacyTabs(
      [tab('prioritizer', 'prioritizer'), tab('priorities', 'priorities')],
      'prioritizer',
    )
    expect(tabs).toHaveLength(1)
    expect(tabs[0]).toMatchObject({ id: 'today', type: 'today' })
  })

  /** Nothing of the retired page's own state survives into Today. */
  it('drops Priorities view state rather than reinterpreting it', () => {
    const { tabs } = migrateLegacyTabs(
      [tab('priorities', 'priorities', { section: 'action_required', filter: 'overdue' })],
      'priorities',
    )
    expect(tabs[0].data).toBeUndefined()
  })
})
