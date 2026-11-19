/**
 * Proof that the chart workspace survives a RELOAD, not just a tab switch.
 *
 * `workspace-state.test.ts` covers the in-memory layer and the tab switch.
 * This covers the durable one, and simulates a reload honestly: the memory
 * map is emptied -- which is exactly what a page load does to a module-level
 * `Map` -- and the workspace is read back from storage alone.
 *
 * The case that matters most is the `Date`. A `Date` does not survive
 * `JSON.parse(JSON.stringify(x))`; it returns as a string, and a string
 * reaching `ProChart` where a Date belongs throws on `.getTime()`. So the
 * fix for lost state could itself have shipped a broken chart.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  chartingWorkspaceKey,
  chartingWorkspaceStore,
  clearChartingWorkspaces,
  readChartingWorkspace,
  writeChartingWorkspace,
  type WorkspaceCodec,
} from '../workspace-state'

interface Panel {
  id: string
  symbol: string
  timeFrame: string
  indicators: string[]
  customRange?: { startDate: Date; endDate: Date; interval: string }
}
interface Workspace {
  panels: Panel[]
  activePanel: string
  viewMode: string
}

/** A codec in the shape the Charting page supplies. */
const codec: WorkspaceCodec<Workspace> = {
  toJSON: s => s,
  fromJSON: raw => {
    if (!raw || typeof raw !== 'object') return null
    const c = raw as Partial<Workspace>
    if (!Array.isArray(c.panels) || c.panels.length === 0) return null
    if (typeof c.activePanel !== 'string') return null

    const panels = c.panels.map(p => {
      const r = p as Panel & { customRange?: { startDate: unknown; endDate: unknown; interval: string } }
      if (!r.customRange) return { ...r, customRange: undefined }
      // `as unknown as string` because the field is declared a Date and is
      // in fact a string at this point -- that gap is the whole hazard.
      const startDate = new Date(r.customRange.startDate as unknown as string)
      const endDate = new Date(r.customRange.endDate as unknown as string)
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
        return { ...r, customRange: undefined, timeFrame: '1M' }
      }
      return { ...r, customRange: { ...r.customRange, startDate, endDate } }
    })
    return { panels, activePanel: c.activePanel, viewMode: c.viewMode ?? 'single' }
  },
}

const AAPL: Workspace = {
  panels: [{ id: '1', symbol: 'AAPL', timeFrame: '1Y', indicators: ['sma', 'rsi'] }],
  activePanel: '1',
  viewMode: 'single',
}

const KEY = chartingWorkspaceKey('user-1', 'org-1', 'charting')
const STORAGE_KEY = `tesseract.charting.workspace.v1:${KEY}`

/** What a page load does: the module map is new, storage is not. */
const reload = () => chartingWorkspaceStore.clear()

beforeEach(() => {
  localStorage.clear()
  clearChartingWorkspaces()
})

describe('reloading Charting', () => {
  it('restores the asset, timeframe and indicators instead of “No Symbol Selected”', () => {
    writeChartingWorkspace(KEY, AAPL, codec)

    reload()

    const restored = readChartingWorkspace<Workspace>(KEY, codec)
    expect(restored, 'the workspace did not survive the reload').not.toBeNull()
    expect(restored!.panels[0].symbol).toBe('AAPL')
    expect(restored!.panels[0].timeFrame).toBe('1Y')
    expect(restored!.panels[0].indicators).toEqual(['sma', 'rsi'])
  })

  it('restores drawings, which are what an analyst would least like to redo', () => {
    const drawn = {
      ...AAPL,
      panels: [{
        ...AAPL.panels[0],
        annotations: [{ id: 'a1', type: 'horizontal-line', price: 350, style: { color: '#2563eb', lineWidth: 1.5, lineStyle: 'solid' } }],
      }],
    } as unknown as Workspace
    writeChartingWorkspace(KEY, drawn, codec)

    reload()

    const restored = readChartingWorkspace<Workspace>(KEY, codec) as unknown as
      { panels: { annotations: { price: number }[] }[] }
    expect(restored.panels[0].annotations[0].price).toBe(350)
  })

  it('brings a custom range back as DATES, not as the strings JSON made of them', () => {
    /*
     * The hazard this whole codec exists for. Without reviving them,
     * `startDate` comes back a string, `ProChart` calls `.getTime()` on it
     * and the chart throws -- so the person who last used a custom
     * frequency would reload into a broken chart rather than a blank one.
     */
    const custom: Workspace = {
      ...AAPL,
      panels: [{
        ...AAPL.panels[0],
        timeFrame: 'CUSTOM',
        customRange: { startDate: new Date('2024-01-02T00:00:00Z'), endDate: new Date('2024-06-28T00:00:00Z'), interval: '1d' },
      }],
    }
    writeChartingWorkspace(KEY, custom, codec)

    reload()

    const range = readChartingWorkspace<Workspace>(KEY, codec)!.panels[0].customRange!
    expect(range.startDate).toBeInstanceOf(Date)
    expect(range.endDate).toBeInstanceOf(Date)
    expect(range.startDate.getTime()).toBe(Date.parse('2024-01-02T00:00:00Z'))
    // The property the chart actually needs: this must not throw.
    expect(() => range.endDate.getTime()).not.toThrow()
  })

  it('drops a custom range it cannot read, and the timeframe that depended on it', () => {
    // Keeping timeFrame 'CUSTOM' with no range leaves the page asking the
    // provider for a window it does not have.
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      panels: [{ id: '1', symbol: 'AAPL', timeFrame: 'CUSTOM', indicators: [], customRange: { startDate: 'rubbish', endDate: 'rubbish', interval: '1d' } }],
      activePanel: '1',
      viewMode: 'single',
    }))

    const restored = readChartingWorkspace<Workspace>(KEY, codec)!
    expect(restored.panels[0].customRange).toBeUndefined()
    expect(restored.panels[0].timeFrame).toBe('1M')
  })
})

describe('a stored entry is untrusted input', () => {
  it('starts fresh rather than rendering something it half understands', () => {
    for (const bad of ['not json at all', '{}', 'null', '[]', '{"panels":[]}', '{"panels":[{"id":"1"}]}']) {
      localStorage.setItem(STORAGE_KEY, bad)
      chartingWorkspaceStore.clear()
      expect(readChartingWorkspace<Workspace>(KEY, codec), `accepted ${bad}`).toBeNull()
    }
  })

  it('removes the entry it rejected, so it is not re-read on every mount', () => {
    localStorage.setItem(STORAGE_KEY, 'not json at all')
    readChartingWorkspace<Workspace>(KEY, codec)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('what is written to disk, and for whom', () => {
  it('writes nothing at all without a codec, which is the old behaviour exactly', () => {
    /*
     * Durability is opt-in. A caller that has not said how its state
     * survives JSON must not have it guessed at.
     */
    writeChartingWorkspace(KEY, AAPL)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()

    reload()
    expect(readChartingWorkspace<Workspace>(KEY)).toBeNull()
  })

  it('writes nothing for a null key, so an unresolved session cannot claim a slot', () => {
    writeChartingWorkspace(chartingWorkspaceKey(null, 'org-1', 'charting'), AAPL, codec)
    expect(localStorage.length).toBe(0)
  })

  it('keeps one account’s workspace unreadable by another', () => {
    const mine = chartingWorkspaceKey('user-1', 'org-1', 'charting')
    const theirs = chartingWorkspaceKey('user-2', 'org-1', 'charting')
    writeChartingWorkspace(mine, AAPL, codec)

    reload()
    expect(readChartingWorkspace<Workspace>(theirs, codec)).toBeNull()
    expect(readChartingWorkspace<Workspace>(mine, codec)!.panels[0].symbol).toBe('AAPL')
  })

  it('separates organizations as well as accounts', () => {
    const orgA = chartingWorkspaceKey('user-1', 'org-a', 'charting')
    const orgB = chartingWorkspaceKey('user-1', 'org-b', 'charting')
    writeChartingWorkspace(orgA, AAPL, codec)

    reload()
    expect(readChartingWorkspace<Workspace>(orgB, codec)).toBeNull()
  })
})

describe('signing out', () => {
  it('purges the entries from DISK, not only from memory', () => {
    /*
     * The one real cost of moving off memory. Partitioning by key stops one
     * account READING another's entry; it does nothing about a signed-out
     * account's symbols sitting in storage afterwards.
     */
    writeChartingWorkspace(KEY, AAPL, codec)
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull()

    clearChartingWorkspaces()

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    expect(readChartingWorkspace<Workspace>(KEY, codec)).toBeNull()
  })

  it('takes only its own keys, never the rest of the origin’s storage', () => {
    localStorage.setItem('sb-auth-token', 'someone else’s')
    localStorage.setItem('theme', 'dark')
    writeChartingWorkspace(KEY, AAPL, codec)

    clearChartingWorkspaces()

    expect(localStorage.getItem('sb-auth-token')).toBe('someone else’s')
    expect(localStorage.getItem('theme')).toBe('dark')
  })
})

describe('storage that will not cooperate', () => {
  it('still works in memory when a write throws, so the session is unaffected', () => {
    /*
     * Quota exceeded, or site data blocked mid-session. Failing to persist a
     * chart selection must never interrupt an analyst.
     */
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    try {
      expect(() => writeChartingWorkspace(KEY, AAPL, codec)).not.toThrow()
      // The in-memory write happened regardless, so a tab switch still works.
      expect(readChartingWorkspace<Workspace>(KEY, codec)!.panels[0].symbol).toBe('AAPL')
    } finally {
      setItem.mockRestore()
    }
  })

  it('starts fresh when a read throws, rather than failing the page', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    try {
      reload()
      expect(() => readChartingWorkspace<Workspace>(KEY, codec)).not.toThrow()
      expect(readChartingWorkspace<Workspace>(KEY, codec)).toBeNull()
    } finally {
      getItem.mockRestore()
    }
  })
})

describe('growth', () => {
  it('caps how many workspaces it keeps, so it cannot consume the origin’s quota', () => {
    /*
     * One entry per tab per principal, and tabs are cheap to open. Unbounded,
     * this eventually fills the origin's quota -- at which point every OTHER
     * feature's storage write starts failing too.
     */
    for (let i = 0; i < 40; i++) {
      writeChartingWorkspace(chartingWorkspaceKey('user-1', 'org-1', `tab-${i}`), AAPL, codec)
    }
    const ours = Object.keys(localStorage).filter(k => k.startsWith('tesseract.charting.workspace.v1:'))
    expect(ours.length).toBeLessThanOrEqual(24)
    expect(ours.length).toBeGreaterThan(0)
  })

  it('keeps the most recent workspace when it prunes', () => {
    for (let i = 0; i < 40; i++) {
      writeChartingWorkspace(chartingWorkspaceKey('user-1', 'org-1', `tab-${i}`), AAPL, codec)
    }
    reload()
    const newest = chartingWorkspaceKey('user-1', 'org-1', 'tab-39')
    expect(readChartingWorkspace<Workspace>(newest, codec)).not.toBeNull()
  })
})
