/**
 * An arrival focus is acted on once per request, and never replayed.
 *
 * ── The journey these pin ─────────────────────────────────────────────────
 *
 *   1. "Edit on the asset" opens AMZN in Research.      -> applied
 *   2. The reader goes to History.
 *   3. They open another tab; the Asset page UNMOUNTS.
 *   4. They come back; it remounts and reads the same tab data.  -> NOT applied
 *
 * Step 4 is where this failed. `focus` lives in tab data, tab data is
 * durable, and only the active tab renders — so the page was remounted with
 * the original arrival still in its props and put the reader back in Research
 * every single time.
 */
import { describe, it, expect } from 'vitest'
import { focusIntentKey, shouldApplyFocus } from '../arrival-focus'
import { assetTabFor, nextFocusRequestId } from '../../desktop-asset/navigate'

describe('every request is distinguishable from the last', () => {
  it('stamps an id on the descriptor', () => {
    const tab = assetTabFor({ assetId: 'a-1', symbol: 'AMZN', focus: 'research' })
    expect(tab.data.focusRequestId).toBeTruthy()
  })

  it('gives two identical requests different ids', () => {
    /* Without this, "open AMZN in Research" twice would be indistinguishable
       from a replay and the second would be swallowed. */
    const first = assetTabFor({ assetId: 'a-1', symbol: 'AMZN', focus: 'research' })
    const second = assetTabFor({ assetId: 'a-1', symbol: 'AMZN', focus: 'research' })
    expect(first.data.focusRequestId).not.toBe(second.data.focusRequestId)
  })

  it('does not collide inside a single millisecond', () => {
    const ids = Array.from({ length: 500 }, () => nextFocusRequestId())
    expect(new Set(ids).size).toBe(500)
  })
})

describe('the intent key', () => {
  it('is null when nothing was asked for, so nothing is applied', () => {
    expect(focusIntentKey(null, 'r-1')).toBeNull()
    expect(focusIntentKey(undefined, undefined)).toBeNull()
    expect(shouldApplyFocus(null, null)).toBe(false)
  })

  it('is the request id when there is one', () => {
    expect(focusIntentKey('research', 'r-1')).toBe('req:r-1')
  })

  it('falls back to the focus value for a descriptor built without one', () => {
    expect(focusIntentKey('research', null)).toBe('focus:research')
  })

  it('separates two focuses of a hand-built descriptor', () => {
    expect(focusIntentKey('research', null)).not.toBe(focusIntentKey('decisions', null))
  })
})

describe('consumption', () => {
  it('applies an intent never seen before', () => {
    expect(shouldApplyFocus('req:r-1', null)).toBe(true)
  })

  it('does NOT reapply the same intent — the remount replay', () => {
    /* The whole defect, in one line: same tab data, second mount. */
    expect(shouldApplyFocus('req:r-1', 'req:r-1')).toBe(false)
  })

  it('applies a genuinely new request to the same asset and the same focus', () => {
    const a = focusIntentKey('research', 'r-1')
    const b = focusIntentKey('research', 'r-2')
    expect(shouldApplyFocus(b, a)).toBe(true)
  })

  it('consumes a hand-built descriptor once rather than forever', () => {
    const intent = focusIntentKey('research', null)
    expect(shouldApplyFocus(intent, null)).toBe(true)
    expect(shouldApplyFocus(intent, intent)).toBe(false)
  })

  it('does not treat a different focus as already consumed', () => {
    expect(shouldApplyFocus('focus:decisions', 'focus:research')).toBe(true)
  })
})

describe('full journey, as the reader experiences it', () => {
  /* The consumed record is per asset, which is what stops one asset's arrival
     suppressing another's. The store is keyed by asset id in AssetTab; here it
     is a plain map standing in for it. */
  const consumed = new Map<string, string>()
  const arrive = (assetId: string, focus: string, requestId: string | null) => {
    const intent = focusIntentKey(focus, requestId)
    const apply = shouldApplyFocus(intent, consumed.get(assetId) ?? null)
    if (apply && intent) consumed.set(assetId, intent)
    return apply
  }

  it('applies on arrival, survives remounts, and lets a new request through', () => {
    const first = assetTabFor({ assetId: 'amzn', focus: 'research' }).data

    // 1. arrive from "Edit on the asset"
    expect(arrive('amzn', first.focus, first.focusRequestId)).toBe(true)
    // 2-4. the reader moves to History; the page unmounts and remounts twice
    expect(arrive('amzn', first.focus, first.focusRequestId)).toBe(false)
    expect(arrive('amzn', first.focus, first.focusRequestId)).toBe(false)

    // 5. a genuinely new request, same asset, same focus
    const again = assetTabFor({ assetId: 'amzn', focus: 'research' }).data
    expect(arrive('amzn', again.focus, again.focusRequestId)).toBe(true)
  })

  it('does not leak one asset\'s consumed focus to another', () => {
    const aapl = assetTabFor({ assetId: 'aapl', focus: 'research' }).data
    /* 'amzn' has consumed a research arrival above; 'aapl' has not. */
    expect(arrive('aapl', aapl.focus, aapl.focusRequestId)).toBe(true)
  })
})
