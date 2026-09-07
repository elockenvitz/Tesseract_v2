/**
 * The phone tab cap must never close the home tab.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `DashboardPage` caps the open tab set on a phone, because the drawer lists
 * five recent workspaces and anything past that would stay open, holding its
 * queries and editor state, while being invisible and unreachable.
 *
 * The exemption named `'dashboard'` — the id the home tab had when the cap was
 * written. The canonical home became `today`, so the home tab was closable, and
 * it is the FIRST tab of a session, which is exactly where `slice(0, …)` takes
 * from. Opening a sixth tab therefore closed home first, and the drawer's Home
 * section, drawn only when that tab existed, went with it.
 *
 * The same `dashboard` → `today` slip has now been found three times: in the
 * drawer's Home lookup, in the search page shortcut, and here. The rule is the
 * same each time — never write the id, ask `tabStateManager` for it — so this
 * asserts the selection over both ids rather than over one literal.
 *
 * The cap's own selection logic is reproduced here rather than exported: it is
 * four lines inside a `useEffect`, and lifting it out to test it would be a
 * larger change than the fix. The source assertion below is what stops the two
 * drifting apart.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID } from '../../tabStateManager'

const MOBILE_TAB_LIMIT = 5
const HOME_IDS = new Set<string>([CANONICAL_HOME_TAB.id, LEGACY_DASHBOARD_ID])

interface T { id: string; isBlank?: boolean }

/** Exactly what the effect in DashboardPage does, minus the closing. */
function tabsTheCapWouldClose(tabs: T[], activeTabId: string): string[] {
  const closable = tabs.filter(t => !HOME_IDS.has(t.id) && !t.isBlank)
  if (closable.length <= MOBILE_TAB_LIMIT) return []
  return closable
    .slice(0, closable.length - MOBILE_TAB_LIMIT)
    .filter(t => t.id !== activeTabId)
    .map(t => t.id)
}

const home = { id: CANONICAL_HOME_TAB.id }
const legacyHome = { id: LEGACY_DASHBOARD_ID }
const work = (n: number): T[] => Array.from({ length: n }, (_, i) => ({ id: `asset-${i}` }))

describe('the home tab is never what the cap closes', () => {
  it.each([6, 8, 12, 30])('survives a session of %i workspace tabs', n => {
    const closed = tabsTheCapWouldClose([home, ...work(n)], 'asset-0')

    expect(closed).not.toContain(CANONICAL_HOME_TAB.id)
  })

  it('survives even though it is the oldest tab, which is what the cap takes', () => {
    // The mechanism of the bug: home is first in the array and `slice(0, …)`
    // takes from the front.
    const closed = tabsTheCapWouldClose([home, ...work(8)], 'asset-7')

    expect(closed[0]).toBe('asset-0')
    expect(closed).not.toContain(CANONICAL_HOME_TAB.id)
  })

  it('spares a restored legacy home too', () => {
    const closed = tabsTheCapWouldClose([legacyHome, ...work(8)], 'asset-7')

    expect(closed).not.toContain(LEGACY_DASHBOARD_ID)
  })

  it('spares both if a session somehow carries both', () => {
    const closed = tabsTheCapWouldClose([home, legacyHome, ...work(8)], 'asset-7')

    expect(closed).not.toContain(CANONICAL_HOME_TAB.id)
    expect(closed).not.toContain(LEGACY_DASHBOARD_ID)
  })
})

describe('the cap still does its job', () => {
  it('leaves the set alone at or under the limit', () => {
    expect(tabsTheCapWouldClose([home, ...work(MOBILE_TAB_LIMIT)], 'asset-0')).toEqual([])
  })

  it('closes the oldest excess once the limit is passed', () => {
    const closed = tabsTheCapWouldClose([home, ...work(8)], 'asset-7')

    expect(closed).toEqual(['asset-0', 'asset-1', 'asset-2'])
  })

  it('never closes the tab being looked at', () => {
    const closed = tabsTheCapWouldClose([home, ...work(8)], 'asset-0')

    expect(closed).not.toContain('asset-0')
  })

  it('does not count the home tab toward the limit', () => {
    // Five workspaces plus home is five workspaces, not six.
    expect(tabsTheCapWouldClose([home, ...work(5)], 'asset-0')).toEqual([])
  })

  it('ignores blank tabs, which hold nothing to reclaim', () => {
    const withBlanks = [home, ...work(5), { id: 'blank-1', isBlank: true }]
    expect(tabsTheCapWouldClose(withBlanks, 'asset-0')).toEqual([])
  })
})

describe('the shipped cap matches this model', () => {
  const page = readFileSync(
    resolve(__dirname, '../../../pages/DashboardPage.tsx'),
    'utf8',
  )

  it('exempts the home ids by constant, never by literal', () => {
    expect(page).toContain('const HOME_TAB_IDS = new Set<string>([CANONICAL_HOME_TAB.id, LEGACY_DASHBOARD_ID])')
    expect(page).toContain('!HOME_TAB_IDS.has(t.id)')
  })

  it('no longer names the legacy id on its own, which is what broke it', () => {
    expect(page).not.toContain("t.id !== 'dashboard' && !t.isBlank")
  })

  it('keeps the same limit this model assumes', () => {
    expect(page).toContain(`const MOBILE_TAB_LIMIT = ${MOBILE_TAB_LIMIT}`)
  })
})
