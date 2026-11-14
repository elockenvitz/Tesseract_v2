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
  issueTitle, issueDetail, isAssetSectionTarget, ASSET_SECTION_TARGETS,
} from './navigate'
/* The reader of this descriptor, so the stale-context cases below are
   asserted as the workspace actually resolves them rather than as a set of
   null properties. */
import { resolveEntry } from '../asset-workspace/entry'

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
      issue: { title: 'Below bear case', reason: 'portfolio:below-bear' },
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
    /* The reason keys, for the same reason. These decide which workspace the
       Overview composes, so a stale one is not a cosmetic leak: a plain open
       of AAPL would lead with somebody else's buy request. */
    expect(d.data).toHaveProperty('decisionId', null)
    expect(d.data).toHaveProperty('workflowId', null)
    expect(d.data).toHaveProperty('stageId', null)
    expect(d.data).toHaveProperty('requirementId', null)
    expect(d.data).toHaveProperty('taskId', null)
  })

  it('clears the previous reason when the same name is opened plainly', () => {
    /*
     * The stale-context case end to end, through the resolver that reads it.
     * A PM opens AAPL from the inbox to rule on a request, then opens AAPL
     * again from search. The second page must be the general overview.
     */
    openAsset({
      assetId: 'a-1', symbol: 'AAPL', decisionId: 'dr-7',
      portfolioId: 'p1', origin: 'decision-inbox',
    })
    expect(resolveEntry(descriptors.at(-1)!.data).mode).toBe('decision')

    openAsset({ assetId: 'a-1', symbol: 'AAPL' })
    const after = resolveEntry(descriptors.at(-1)!.data)
    expect(after.mode).toBe('general')
    expect(after.decisionId).toBeNull()
    expect(after.portfolioId).toBeNull()
  })

  it('carries a work destination without the sender knowing the field names', () => {
    openAsset({
      assetId: 'a-1', symbol: 'AAPL',
      work: { workflowId: 'wf-1', stageId: 's-2', requirementId: 'ci-3' },
    })
    const entry = resolveEntry(descriptors.at(-1)!.data)
    expect(entry.mode).toBe('work')
    expect(entry.work).toEqual({ workflowId: 'wf-1', stageId: 's-2', requirementId: 'ci-3' })
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
    expect(issueTitle('Review due')).toBe('Review due')
    expect(issueDetail('Review due')).toBeNull()
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

/* ─── The section a control named ──────────────────────────────────────────
 *
 * `focus` picks the lens, `section` picks the paragraph. The defect this
 * closes: "Edit in research" inside The case sent `focus: 'research'` and
 * nothing else, so the reader arrived at Research and then at whatever
 * scroll position Research had last been left at.
 */
describe('the section a control named', () => {
  it('travels in the descriptor', () => {
    const d = assetTabFor({ assetId: 'a-1', symbol: 'AAPL', focus: 'research', section: 'case' })
    expect(d.data.section).toBe('case')
  })

  it('is written as null when absent, not omitted', () => {
    /*
     * THE case for this field. A descriptor MERGES into an already-open tab,
     * so a key left out keeps the previous arrival's value: a generic open of
     * AAPL after an "Edit in research" would inherit `section: 'case'` and
     * scroll to a paragraph nobody asked about. Every other context key in
     * this descriptor is written for the same reason.
     */
    const d = assetTabFor({ assetId: 'a-1', symbol: 'AAPL' })
    expect(d.data).toHaveProperty('section')
    expect(d.data.section).toBeNull()
  })

  it('pairs with a fresh request id, so it is acted on once per request', () => {
    /* The receiver consumes a section once per `focusRequestId`. Two sends of
       the same section must therefore carry different ids, or the second
       would be mistaken for the first replayed and would not scroll. */
    const a = assetTabFor({ assetId: 'a-1', section: 'case' })
    const b = assetTabFor({ assetId: 'a-1', section: 'case' })
    expect(a.data.focusRequestId).not.toBe(b.data.focusRequestId)
  })

  it('names only sections the Asset page can actually reach', () => {
    /*
     * The guard exists because `asset` is tab DATA, which outlives the build
     * that wrote it. An unrecognised value would set an anchor whose target
     * id is undefined, and the receiving effect would poll for three seconds
     * and give up silently -- a scroll that never happened and never said so.
     */
    for (const s of ASSET_SECTION_TARGETS) expect(isAssetSectionTarget(s)).toBe(true)
    expect(isAssetSectionTarget('outcomes')).toBe(false)
    expect(isAssetSectionTarget('')).toBe(false)
    expect(isAssetSectionTarget(null)).toBe(false)
    expect(isAssetSectionTarget(undefined)).toBe(false)
    expect(isAssetSectionTarget({ anchor: 'case' })).toBe(false)
  })
})
