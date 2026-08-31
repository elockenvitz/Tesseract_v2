/**
 * The one Asset open contract.
 *
 * Every lens now routes through this, so the descriptor it produces is the
 * thing that decides whether a reader lands on the object they asked for, in
 * the context they asked for it, in one tab rather than five.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  openAsset, assetTabFor, subscribeToOpenAsset, OPEN_ASSET_EVENT,
  issueTitle, issueDetail,
} from './navigate'

const descriptors: any[] = []
const typed: any[] = []

beforeEach(() => {
  descriptors.length = 0
  typed.length = 0
  window.addEventListener('decision-engine-action', capture)
  window.addEventListener(OPEN_ASSET_EVENT, captureTyped)
})
afterEach(() => {
  window.removeEventListener('decision-engine-action', capture)
  window.removeEventListener(OPEN_ASSET_EVENT, captureTyped)
})

function capture(e: Event) { descriptors.push((e as CustomEvent).detail) }
function captureTyped(e: Event) { typed.push((e as CustomEvent).detail) }

describe('the descriptor names one asset', () => {
  it('keys the tab on the asset id, so one asset is one tab', () => {
    const d = assetTabFor({ assetId: 'a-1', symbol: 'AAPL' })
    expect(d.id).toBe('a-1')
    expect(d.type).toBe('asset')
    expect(d.data.id).toBe('a-1')
  })

  it('refuses to open without an id', () => {
    expect(openAsset({ assetId: '' } as any)).toBe(false)
    expect(openAsset(null as any)).toBe(false)
    expect(descriptors).toHaveLength(0)
  })

  it('never resolves an asset by symbol alone', () => {
    // A symbol is a label, not an identity: two senders can disagree about
    // which row "AAPL" means, and opening the wrong one is silent.
    expect(openAsset({ symbol: 'AAPL' } as any)).toBe(false)
  })
})

describe('context travels, and never lingers', () => {
  it('carries focus, book, reason and provenance', () => {
    openAsset({
      assetId: 'a-1', symbol: 'AAPL', focus: 'position',
      portfolioId: 'p1', portfolioName: 'Large Cap Core',
      issue: { title: 'Spot below bear case', reason: 'portfolio:below-bear' },
      origin: 'portfolio',
    })
    const d = descriptors.at(-1)!
    expect(d.data.focus).toBe('position')
    expect(d.data.portfolioId).toBe('p1')
    expect(d.data.portfolioName).toBe('Large Cap Core')
    expect(d.data.issue.reason).toBe('portfolio:below-bear')
    expect(d.data.origin).toBe('portfolio')
  })

  it('writes every context key even when absent', () => {
    // The shell MERGES data into an existing tab. An omitted key persists, so
    // a plain open of AAPL would silently inherit "Large Cap Core, framework
    // broken" from whatever sent the reader there twenty minutes earlier.
    const d = assetTabFor({ assetId: 'a-1', symbol: 'AAPL' })
    expect(d.data).toHaveProperty('portfolioId', null)
    expect(d.data).toHaveProperty('portfolioName', null)
    expect(d.data).toHaveProperty('issue', null)
    expect(d.data).toHaveProperty('origin', null)
    expect(d.data.focus).toBe('overview')
  })

  it('targets the existing Asset page, not a parallel workspace', () => {
    // The destination is the page that already holds workflow, lists,
    // estimates and activity. Convergence was about stopping the lenses
    // duplicating its work, never about replacing it.
    const d = assetTabFor({ assetId: 'a-1', symbol: 'AAPL' })
    expect(d.type).toBe('asset')
    expect(d.data).not.toHaveProperty('legacy')
  })

  it('reuses one tab across two different questions about one asset', () => {
    openAsset({ assetId: 'a-1', symbol: 'AAPL', focus: 'research', origin: 'research' })
    openAsset({
      assetId: 'a-1', symbol: 'AAPL', focus: 'position',
      portfolioId: 'p1', origin: 'portfolio',
    })
    expect(descriptors.map(d => d.id)).toEqual(['a-1', 'a-1'])
    expect(descriptors.at(-1)!.data.focus).toBe('position')
  })

  it('gives two assets two tabs', () => {
    openAsset({ assetId: 'a-1', symbol: 'AAPL' })
    openAsset({ assetId: 'a-2', symbol: 'MSFT' })
    expect(new Set(descriptors.map(d => d.id)).size).toBe(2)
  })
})

describe('two dispatches, no timer', () => {
  it('fires the shell descriptor and the typed event together', () => {
    openAsset({ assetId: 'a-1', symbol: 'AAPL', focus: 'research' })
    expect(descriptors).toHaveLength(1)
    expect(typed).toHaveLength(1)
    expect(typed[0].assetId).toBe('a-1')
  })

  it('lets an already-mounted surface subscribe', () => {
    const seen: string[] = []
    const off = subscribeToOpenAsset(r => seen.push(r.assetId))
    openAsset({ assetId: 'a-9' })
    off()
    openAsset({ assetId: 'a-10' })
    expect(seen).toEqual(['a-9'])
  })

  it('ignores a malformed typed event rather than opening something', () => {
    const seen: string[] = []
    const off = subscribeToOpenAsset(r => seen.push(r.assetId))
    window.dispatchEvent(new CustomEvent(OPEN_ASSET_EVENT, { detail: { symbol: 'AAPL' } }))
    off()
    expect(seen).toHaveLength(0)
  })
})

describe('an issue reads the same whichever shape the sender used', () => {
  it('accepts a bare sentence', () => {
    expect(issueTitle('Thesis not reviewed')).toBe('Thesis not reviewed')
    expect(issueDetail('Thesis not reviewed')).toBeNull()
  })

  it('accepts the structured engagement issue', () => {
    const issue = { title: 'New evidence', detail: 'Two notes arrived.', reason: 'research:x' }
    expect(issueTitle(issue)).toBe('New evidence')
    expect(issueDetail(issue)).toBe('Two notes arrived.')
  })

  it('has nothing to say when nothing was sent', () => {
    expect(issueTitle(null)).toBeNull()
    expect(issueDetail(undefined)).toBeNull()
  })
})

describe('no window, no crash', () => {
  it('returns false rather than throwing off the main thread', () => {
    const w = globalThis.window
    // @ts-expect-error deliberately removing the global
    delete globalThis.window
    try {
      expect(openAsset({ assetId: 'a-1' })).toBe(false)
      expect(subscribeToOpenAsset(vi.fn())).toBeTypeOf('function')
    } finally {
      globalThis.window = w
    }
  })
})
