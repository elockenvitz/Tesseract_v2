/**
 * Proof that the chart workspace survives a tab switch.
 *
 * The defect was structural, not incidental: `renderTabContent` mounts only
 * the ACTIVE tab, so leaving Charting unmounts the page and every `useState`
 * in it. The selected asset, timeframe and indicators were owned by a
 * component that the navigation destroys.
 *
 * These tests simulate the unmount/remount honestly — by discarding the
 * component's state entirely and reading the store back, which is exactly
 * what React does — rather than by rendering and hoping.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  chartingWorkspaceKey,
  chartingWorkspaceStore,
  clearChartingWorkspaces,
  readChartingWorkspace,
  writeChartingWorkspace,
} from '../workspace-state'
import { clearProviderCaches } from '../../market-data/provider-routing'

interface Workspace {
  panels: { id: string; symbol: string; timeFrame: string; indicators: string[] }[]
  activePanel: string
  viewMode: string
}

const AAPL: Workspace = {
  panels: [{ id: '1', symbol: 'AAPL', timeFrame: '1Y', indicators: ['sma', 'rsi'] }],
  activePanel: '1',
  viewMode: 'single',
}

beforeEach(() => clearChartingWorkspaces())

/* ────────────────── the actual thing the user complained about ─────────── */

describe('leaving Charting and coming back', () => {
  it('restores the selected asset, timeframe and indicators', () => {
    const key = chartingWorkspaceKey('user-1', 'org-1', 'charting')

    // On Charting: the person picks AAPL, 1Y, two indicators.
    writeChartingWorkspace(key, AAPL)

    // Tab switch to Overview. The page unmounts; all of its state is gone.
    // Nothing is carried in a variable here on purpose — that IS the unmount.

    // Back to Charting: a fresh mount reads the store before defaulting.
    const restored = readChartingWorkspace<Workspace>(key)
    expect(restored).not.toBeNull()
    expect(restored!.panels[0].symbol).toBe('AAPL')
    expect(restored!.panels[0].timeFrame).toBe('1Y')
    expect(restored!.panels[0].indicators).toEqual(['sma', 'rsi'])
    expect(restored!.activePanel).toBe('1')
    expect(restored!.viewMode).toBe('single')
  })

  it('survives any number of switches, not just the first', () => {
    const key = chartingWorkspaceKey('user-1', 'org-1', 'charting')
    writeChartingWorkspace(key, AAPL)
    for (let i = 0; i < 5; i++) {
      const seen = readChartingWorkspace<Workspace>(key)
      expect(seen!.panels[0].symbol, `round ${i}`).toBe('AAPL')
    }
  })

  it('keeps two Charting tabs independent', () => {
    // A shared slot would make the second tab overwrite the first's symbol.
    const a = chartingWorkspaceKey('user-1', 'org-1', 'charting')
    const b = chartingWorkspaceKey('user-1', 'org-1', 'charting-2')
    writeChartingWorkspace(a, AAPL)
    writeChartingWorkspace(b, { ...AAPL, panels: [{ ...AAPL.panels[0], symbol: 'MSFT' }] })
    expect(readChartingWorkspace<Workspace>(a)!.panels[0].symbol).toBe('AAPL')
    expect(readChartingWorkspace<Workspace>(b)!.panels[0].symbol).toBe('MSFT')
  })

  it('returns null for a tab nothing was stored for, so the page defaults', () => {
    const key = chartingWorkspaceKey('user-1', 'org-1', 'charting')
    expect(readChartingWorkspace<Workspace>(key)).toBeNull()
  })
})

/* ───────────────────── account and organization boundaries ────────────── */

describe('a workspace belongs to one principal', () => {
  it('does not show one account another account selections', () => {
    /*
     * THE leak a plain tab id would have left: sign out, sign in as somebody
     * else on the same machine, open Charting, and find the previous
     * account's symbols and comparison series sitting there.
     */
    const mine = chartingWorkspaceKey('user-1', 'org-1', 'charting')
    const theirs = chartingWorkspaceKey('user-2', 'org-1', 'charting')
    expect(mine).not.toBe(theirs)

    writeChartingWorkspace(mine, AAPL)
    expect(readChartingWorkspace<Workspace>(theirs)).toBeNull()
  })

  it('partitions by organization as well as by account', () => {
    // The same person in two orgs is two workspaces: a symbol they follow in
    // one is not necessarily one they are allowed to see in the other.
    const orgA = chartingWorkspaceKey('user-1', 'org-a', 'charting')
    const orgB = chartingWorkspaceKey('user-1', 'org-b', 'charting')
    expect(orgA).not.toBe(orgB)
    writeChartingWorkspace(orgA, AAPL)
    expect(readChartingWorkspace<Workspace>(orgB)).toBeNull()
  })

  it('refuses to persist without a principal', () => {
    /*
     * A null key must not write. An unauthenticated or still-resolving
     * session writing into some shared slot is how a real principal would
     * later read somebody else's state.
     */
    for (const key of [
      chartingWorkspaceKey(null, 'org-1', 'charting'),
      chartingWorkspaceKey(undefined, 'org-1', 'charting'),
      chartingWorkspaceKey('user-1', 'org-1', null),
      chartingWorkspaceKey('user-1', 'org-1', undefined),
    ]) {
      expect(key).toBeNull()
      writeChartingWorkspace(key, AAPL)
    }
    expect(chartingWorkspaceStore.size, 'a null key wrote an entry').toBe(0)
    expect(readChartingWorkspace<Workspace>(null)).toBeNull()
  })

  it('still distinguishes a signed-in user with no organization', () => {
    // 'no-org' is a real slot, not a missing one — it just is not shared.
    const key = chartingWorkspaceKey('user-1', null, 'charting')
    expect(key).toBe('user-1:no-org:charting')
    writeChartingWorkspace(key, AAPL)
    expect(readChartingWorkspace<Workspace>(key)!.panels[0].symbol).toBe('AAPL')
  })
})

/* ──────────────────────────── the clear works ─────────────────────────── */

describe('the principal change empties the map', () => {
  it('actually empties it, observed rather than asserted by regex', () => {
    writeChartingWorkspace(chartingWorkspaceKey('user-1', 'org-1', 'charting'), AAPL)
    writeChartingWorkspace(chartingWorkspaceKey('user-2', 'org-1', 'charting'), AAPL)
    expect(chartingWorkspaceStore.size).toBe(2)

    clearChartingWorkspaces()

    expect(chartingWorkspaceStore.size).toBe(0)
  })

  it('is wired into the provider cache clear, and that clear calls it', () => {
    /*
     * Behavioural, with injected dependencies, because the source-text form
     * of this assertion is the one that went green in Package 2A with the
     * clear disabled by `false &&`.
     */
    const calls: string[] = []
    clearProviderCaches({
      clearCharts: () => calls.push('charts'),
      clearReference: () => calls.push('reference'),
      clearWorkspaces: () => calls.push('workspaces'),
    })
    expect(calls).toContain('workspaces')
    expect(calls).toHaveLength(3)
  })
})

/* ───────────────────── the page really uses the store ─────────────────── */

describe('the Charting page is wired to it', () => {
  const page = readFileSync(resolve(__dirname, '../../../pages/ChartingPage.tsx'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')

  it('seeds its state from the store before defaulting', () => {
    expect(page.length).toBeGreaterThan(2000)
    /*
     * Order matters and is the whole fix: `readChartingWorkspace(...) ??
     * getDefaultChartingState()`. Defaulting first and restoring afterwards
     * would flash the empty chart and refetch before the real symbol landed.
     */
    expect(page).toMatch(
      /readChartingWorkspace<[^>]*>\(workspaceKey,\s*CHARTING_WORKSPACE_CODEC\)\s*\?\?\s*getDefaultChartingState\(\)/,
    )
  })

  it('reads through the codec, so a reload restores and not just a tab switch', () => {
    /*
     * Without a codec the store is memory-only by design, and a reload
     * returns "No Symbol Selected". The codec argument is what makes the
     * durable layer apply -- see `workspace-durability.test.ts` for the
     * behaviour and `pages/__tests__/charting-workspace-codec.test.ts` for
     * the codec itself.
     */
    expect(page).toMatch(/readChartingWorkspace<[^>]*>\(\s*workspaceKey,\s*CHARTING_WORKSPACE_CODEC/)
    expect(page).toMatch(/CHARTING_WORKSPACE_CODEC,?\s*\)/)
  })

  it('writes on change rather than at unmount', () => {
    /*
     * An unmount-time save is the wrong shape here: React gives no guarantee
     * that a cleanup sees the latest state when a PARENT stops rendering the
     * child, and that is exactly how this page is removed.
     */
    const effect = /useEffect\(\(\) => \{\s*writeChartingWorkspace[\s\S]*?\}, \[([^\]]*)\]\)/.exec(page)
    expect(effect, 'the persist effect was not found').not.toBeNull()
    const deps = effect![1]
    for (const dep of ['workspaceKey', 'panels', 'activePanel', 'viewMode']) {
      expect(deps, `${dep} is missing from the persist effect`).toContain(dep)
    }
  })

  it('keys on the principal, not on the tab alone', () => {
    expect(page).toMatch(/chartingWorkspaceKey\(\s*user\?\.id\s*,\s*currentOrgId\s*,\s*workspaceId\s*\)/)
  })

  it('does not persist transient menu state', () => {
    // A reopened tab showing the indicator menu already open would be
    // restoring a transient, not a choice.
    const effect = /writeChartingWorkspace<[^>]*>\(\s*workspaceKey,\s*\{([^}]*)\}/.exec(page)?.[1] ?? ''
    expect(effect, 'the persisted payload was not found').not.toBe('')
    expect(effect).not.toMatch(/show[A-Z]/)
    expect(effect).not.toMatch(/searchQuery|contextMenu/)
  })

  it('changes a timeframe or frequency by MERGING, so the symbol survives', () => {
    /*
     * The other half of "switching combinations must not reset the selected
     * asset". Persistence across a tab switch is no use if changing the
     * interval replaces the panel instead of updating it.
     */
    const update = /const updatePanel = useCallback\(\([\s\S]*?\}, \[\]\)/.exec(page)?.[0] ?? ''
    expect(update, 'updatePanel was not found').not.toBe('')
    expect(update).toMatch(/p\.id === panelId \? \{ \.\.\.p, \.\.\.updates \} : p/)
  })

  it('never sets symbol in the same update as a timeframe or frequency', () => {
    // An update carrying both would be the regression: picking Weekly would
    // also rewrite which asset is charted.
    const calls = page.match(/updatePanel\([^,]+, \{[\s\S]*?\n {4}\}\)/g) ?? []
    expect(calls.length, 'no updatePanel calls were found').toBeGreaterThan(0)
    for (const call of calls) {
      if (/timeFrame|customRange|selectedFreq/.test(call)) {
        expect(call, `a timeframe update also writes symbol:\n${call}`).not.toMatch(/\bsymbol:/)
      }
    }
  })

  it('is given a tab id by the dashboard', () => {
    const dash = readFileSync(resolve(__dirname, '../../../pages/DashboardPage.tsx'), 'utf8')
    const node = /<ChartingPage[\s\S]*?\/>/.exec(dash)?.[0] ?? ''
    expect(node, 'the ChartingPage element was not found').not.toBe('')
    expect(node).toMatch(/workspaceId=\{activeTab\.id\}/)
  })
})
