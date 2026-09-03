/**
 * Which Dashboard a returning session lands on.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `/dashboard` restores the tab the user was last on. Nothing in the product
 * injects the legacy `dashboard` tab into a session any more — it is reachable
 * only from the launcher's More group — but sessions persist, and one written
 * before that change still carries it, titled plainly "Dashboard".
 *
 * Restored, it sat beside the canonical Dashboard under an identical name and,
 * being the tab that was last active, took the home slot. A returning user met
 * two tabs called "Dashboard", landed on the older surface, and could only
 * reach the current product by clearing sessionStorage.
 *
 * ── What is deliberately NOT asserted ─────────────────────────────────────
 *
 * That the Dashboard always wins. A persisted workspace is a choice and is
 * still honoured: someone who left on an Asset tab comes back to it. The only
 * case re-anchored is the one nobody chose.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

// The page pulls the whole desktop product in behind it, including the
// Supabase client, which throws at import when no environment is configured.
// None of it is exercised here — this is about one pure function reading
// sessionStorage — so the module graph is stubbed at its heaviest edges.
vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), auth: {} },
}))
vi.mock('../../components/layout/Layout', () => ({ Layout: () => null }))
vi.mock('../../components/tabs/AssetTab', () => ({ AssetTab: () => null }))
vi.mock('../../components/dashboard/DashboardShell', () => ({
  DashboardShell: () => null,
  LENS_FOR_TAB: {},
}))

import { getInitialTabState } from '../DashboardPage'
import {
  CANONICAL_HOME_TAB, LEGACY_DASHBOARD_ID, LEGACY_DASHBOARD_TITLE,
} from '../../lib/tabStateManager'

const USER = 'u1'
const ORG = 'o1'
const KEY = `tesseract_tabs_${USER}_${ORG}`

/** Write a session exactly as TabStateManager would have persisted it. */
function saveSession(tabs: any[], activeTabId: string) {
  sessionStorage.setItem(KEY, JSON.stringify({
    tabs, activeTabId, tabStates: {}, version: 3, userId: USER, orgId: ORG,
  }))
}

const legacyTab = (over: any = {}) => ({
  id: LEGACY_DASHBOARD_ID, title: 'Dashboard', type: 'dashboard', isActive: false, ...over,
})
const canonicalTab = (over: any = {}) => ({ ...CANONICAL_HOME_TAB, isActive: false, ...over })
const assetTab = (over: any = {}) => ({
  id: 'asset-nvda', title: 'NVDA', type: 'asset', isActive: false, ...over,
})

const read = () => getInitialTabState(USER, ORG)
const titles = (r: ReturnType<typeof read>) => r.tabs.map(t => t.title)
const activeTab = (r: ReturnType<typeof read>) => r.tabs.find(t => t.isActive)

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
})

describe('returning to /dashboard', () => {
  it('A. a fresh session opens on the canonical Dashboard', () => {
    const r = read()
    expect(r.activeTabId).toBe(CANONICAL_HOME_TAB.id)
    expect(r.tabs).toHaveLength(1)
    expect(activeTab(r)?.type).toBe('today')
  })

  it('B. a session already on the canonical Dashboard is left alone', () => {
    saveSession([canonicalTab({ isActive: true }), assetTab()], CANONICAL_HOME_TAB.id)
    const r = read()
    expect(r.activeTabId).toBe(CANONICAL_HOME_TAB.id)
    // The other workspace is still open.
    expect(r.tabs.map(t => t.id)).toContain('asset-nvda')
  })

  it('C. a session left on the legacy Dashboard lands on the canonical one', () => {
    saveSession([legacyTab({ isActive: true })], LEGACY_DASHBOARD_ID)
    const r = read()

    expect(r.activeTabId).toBe(CANONICAL_HOME_TAB.id)
    expect(activeTab(r)?.type).toBe('today')
    // Demoted, not deleted: still reachable, no longer the home.
    expect(r.tabs.map(t => t.id)).toContain(LEGACY_DASHBOARD_ID)
  })

  it('D. a session holding both never shows two tabs called Dashboard', () => {
    saveSession(
      [legacyTab({ isActive: true }), canonicalTab()],
      LEGACY_DASHBOARD_ID,
    )
    const r = read()

    expect(r.activeTabId).toBe(CANONICAL_HOME_TAB.id)
    const dashboards = titles(r).filter(t => t === 'Dashboard')
    expect(dashboards).toHaveLength(1)
    expect(titles(r)).toContain(LEGACY_DASHBOARD_TITLE)
  })

  it('E. unrelated workspaces are preserved, and their order is not shuffled', () => {
    saveSession(
      [legacyTab({ isActive: true }), assetTab(), { id: 'lab', title: 'Trade Lab', type: 'trade-lab', isActive: false }],
      LEGACY_DASHBOARD_ID,
    )
    const r = read()

    const ids = r.tabs.map(t => t.id)
    expect(ids).toContain('asset-nvda')
    expect(ids).toContain('lab')
    // Nothing was dropped; the canonical home was added.
    expect(ids).toContain(CANONICAL_HOME_TAB.id)
    expect(ids.indexOf('asset-nvda')).toBeLessThan(ids.indexOf('lab'))
  })

  it('F. a deliberately chosen workspace still wins over the Dashboard', () => {
    // The rule is narrow on purpose. Someone who left on an Asset tab did
    // choose it, and comes back to it.
    saveSession([canonicalTab(), assetTab({ isActive: true })], 'asset-nvda')
    const r = read()

    expect(r.activeTabId).toBe('asset-nvda')
    expect(activeTab(r)?.type).toBe('asset')
  })

  it('re-anchors only when the legacy tab was the active one', () => {
    // Legacy present but not active, and a real workspace chosen: untouched.
    saveSession([legacyTab(), assetTab({ isActive: true })], 'asset-nvda')
    const r = read()
    expect(r.activeTabId).toBe('asset-nvda')
    // It is still renamed, because two Dashboards may never share a name.
    expect(titles(r)).toContain(LEGACY_DASHBOARD_TITLE)
  })
})

describe('what writes a legacy Dashboard into storage', () => {
  it('no longer manufactures one when a tab saves its own state first', async () => {
    // `saveTabState` used to synthesise a main state containing a legacy
    // `dashboard` tab, marked active, for a user who had never opened one --
    // which the next load then restored them onto.
    const { TabStateManager } = await import('../../lib/tabStateManager')
    TabStateManager.saveTabState('asset-nvda', { view: 'thesis' }, USER, ORG)

    const saved = JSON.parse(sessionStorage.getItem(KEY)!)
    expect(saved.activeTabId).toBe(CANONICAL_HOME_TAB.id)
    expect(saved.tabs.map((t: any) => t.id)).not.toContain(LEGACY_DASHBOARD_ID)
    // The state it was actually asked to save is still there.
    expect(saved.tabStates['asset-nvda']).toEqual({ view: 'thesis' })
  })
})
