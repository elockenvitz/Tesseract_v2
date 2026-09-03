/**
 * The Create menu offers only what the product can actually make.
 *
 * Every kind here maps to a capture form that exists and persists:
 * `PendingCaptureType` in `sidebarStore`, rendered by
 * `ThoughtsSection.handleOpenCapture`. If a mode is ever removed there, these
 * tests are what should fail.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createActionsFor, openCreate } from '../create-actions'

const kinds = (...a: Parameters<typeof createActionsFor>) =>
  createActionsFor(...a).map(x => x.kind)

describe('createActionsFor', () => {
  it('offers nothing that needs an asset when there is no asset', () => {
    // A trade idea hangs off the asset in the capture form, so a finding with
    // no asset cannot honestly offer one.
    expect(kinds({ assetId: null })).not.toContain('trade_idea')
    expect(kinds({ assetId: null })).not.toContain('proposal')
  })

  it('offers a recommendation only where a trade idea exists to recommend on', () => {
    // The proposal form opens by selecting an existing idea.
    expect(kinds({ assetId: 'a', hasLiveIdea: false })).not.toContain('proposal')
    expect(kinds({ assetId: 'a', hasLiveIdea: true })).toContain('proposal')
  })

  it('narrows to the argument when the reader reached for the claim', () => {
    // Someone inspecting the written case is thinking about the argument.
    // Offering a trade there is the menu guessing.
    const claim = kinds({ assetId: 'a', hasLiveIdea: true }, 'claim')
    expect(claim).toEqual(['idea', 'prompt'])
  })

  it('leads with the trade where the reader reached for price or book', () => {
    expect(kinds({ assetId: 'a' }, 'price')[0]).toBe('trade_idea')
    expect(kinds({ assetId: 'a' }, 'book')[0]).toBe('trade_idea')
  })

  it('never offers a research note or a task', () => {
    // Neither is a capture type. Research is written on the Asset page, which
    // the workbench already routes to; no task object exists at all.
    const all = kinds({ assetId: 'a', hasLiveIdea: true })
    expect(all.join(' ')).not.toMatch(/note|task|follow/i)
  })
})

describe('openCreate', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('binds the object by id, never by its name', () => {
    const spy = vi.spyOn(window, 'dispatchEvent')
    openCreate('trade_idea', { assetId: 'a-dash', symbol: 'DASH' })

    const e = spy.mock.calls[0][0] as CustomEvent
    expect(e.type).toBe('openThoughtsCapture')
    expect(e.detail.contextId).toBe('a-dash')
    expect(e.detail.contextType).toBe('asset')
    expect(e.detail.captureType).toBe('trade_idea')
  })

  it('refuses to create against nothing', () => {
    const spy = vi.spyOn(window, 'dispatchEvent')
    expect(openCreate('trade_idea', { assetId: null })).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })
})
