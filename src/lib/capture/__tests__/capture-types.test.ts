/**
 * Four things to capture, described once.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * A thought, a trade idea, a recommendation and a prompt were described in two
 * places that had drifted. `FeedCaptureSheet` had labels, icons and one-line
 * hints; `ThoughtsSection` had a different picker and its own hand-written
 * sentence above each form — and none at all above the trade idea, which is
 * the one with the most fields. The two hosts even used different names for
 * the same four things, so nothing asserted they were the same set and nothing
 * stopped a fifth being added to one and forgotten in the other.
 *
 * That is what made four forms read as four products rather than one system.
 *
 * These assertions are about the vocabulary, not the payloads. What each kind
 * saves is unchanged and still owned by the component that always owned it.
 */

import { describe, it, expect } from 'vitest'
import {
  CAPTURE_TYPES,
  WRITE_CAPTURE_TYPES,
  captureType,
  captureTypeForMode,
  type CaptureKind,
  type LegacyCaptureMode,
} from '../capture-types'

const WRITABLE: CaptureKind[] = ['thought', 'trade-idea', 'recommendation', 'prompt']
const MODES: LegacyCaptureMode[] = ['idea', 'trade_idea', 'prompt', 'proposal']

describe('the four things a user can write', () => {
  it('are exactly four, and the ones the product offers', () => {
    expect(WRITE_CAPTURE_TYPES.map(t => t.kind)).toEqual(WRITABLE)
  })

  it('each carry a label, a hint and guidance', () => {
    for (const t of CAPTURE_TYPES) {
      expect(t.label.length).toBeGreaterThan(0)
      expect(t.hint.length).toBeGreaterThan(0)
      // The trade idea had none of this last line, which is the form that most
      // needed it.
      expect(t.guidance.length).toBeGreaterThan(0)
    }
  })

  it('say something different in the hint and in the guidance', () => {
    // One helps you choose, the other tells you what to do now you have. A
    // duplicate means one of them was written to fill the slot.
    for (const t of CAPTURE_TYPES) {
      expect(t.guidance).not.toBe(t.hint)
    }
  })

  it('carry whole Tailwind classes, never interpolated fragments', () => {
    for (const t of CAPTURE_TYPES) {
      expect(t.tone).toMatch(/text-\w/)
      expect(t.tone).toMatch(/bg-\w/)
      expect(t.tone).not.toContain('${')
    }
  })
})

describe('writing and filing are kept apart', () => {
  it('marks the two filing options as filing', () => {
    expect(CAPTURE_TYPES.filter(t => t.group === 'file').map(t => t.kind))
      .toEqual(['add-to-list', 'add-to-theme'])
  })

  it('requires an asset only for the filing options', () => {
    // Filing needs something to file; writing does not.
    for (const t of CAPTURE_TYPES) {
      expect(!!t.needsAsset).toBe(t.group === 'file')
    }
  })
})

describe('the pane and the phone name the same four things', () => {
  it.each(MODES)('%s resolves to a capture type', mode => {
    expect(captureTypeForMode(mode)).toBeTruthy()
  })

  it('maps every legacy mode onto exactly one writable kind', () => {
    const kinds = MODES.map(m => captureTypeForMode(m)!.kind)

    expect(new Set(kinds).size).toBe(MODES.length)
    expect(kinds.every(k => WRITABLE.includes(k))).toBe(true)
  })

  it('gives every writable kind a pane mode, so neither surface has an orphan', () => {
    for (const t of WRITE_CAPTURE_TYPES) {
      expect(t.legacyMode).toBeTruthy()
    }
  })

  it('gives the filing options no pane mode, because the pane has no such form', () => {
    for (const t of CAPTURE_TYPES.filter(t => t.group === 'file')) {
      expect(t.legacyMode).toBeUndefined()
    }
  })

  it('reads the same guidance whichever name the surface uses', () => {
    expect(captureTypeForMode('idea')!.guidance).toBe(captureType('thought')!.guidance)
    expect(captureTypeForMode('proposal')!.guidance).toBe(captureType('recommendation')!.guidance)
  })
})

describe('lookups are total and safe', () => {
  it('returns nothing for an unknown kind rather than throwing', () => {
    expect(captureType('nope' as CaptureKind)).toBeUndefined()
    expect(captureType(null)).toBeUndefined()
    expect(captureTypeForMode(undefined)).toBeUndefined()
  })

  it('registers each kind exactly once', () => {
    const kinds = CAPTURE_TYPES.map(t => t.kind)
    expect(kinds).toHaveLength(new Set(kinds).size)
  })
})
