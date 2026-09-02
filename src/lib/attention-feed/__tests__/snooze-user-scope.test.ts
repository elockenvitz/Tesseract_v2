/**
 * The dashboard's local snooze store is per READER, not per browser.
 *
 * The store used one constant key, so two people signing into the same browser
 * shared one deferral list: one reader's "later" hid a live decision from the
 * next, with no record of who did it and no way to get it back.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { getSnoozedIds, snoozeItem, unsnoozeItem } from '../snooze'

const ALICE = 'user-alice'
const BOB = 'user-bob'

beforeEach(() => localStorage.clear())

describe('a deferral belongs to the reader who made it', () => {
  it('hides the item from that reader', () => {
    snoozeItem(ALICE, 'trade-1', 24)
    expect(getSnoozedIds(ALICE).has('trade-1')).toBe(true)
  })

  /** The leak this exists to prevent. */
  it('does not hide it from anybody else', () => {
    snoozeItem(ALICE, 'trade-1', 24)
    expect(getSnoozedIds(BOB).has('trade-1')).toBe(false)
    expect([...getSnoozedIds(BOB)]).toEqual([])
  })

  it('keeps two readers deferring the same item independent', () => {
    snoozeItem(ALICE, 'trade-1', 24)
    snoozeItem(BOB, 'trade-1', 24)
    unsnoozeItem(ALICE, 'trade-1')
    expect(getSnoozedIds(ALICE).has('trade-1')).toBe(false)
    expect(getSnoozedIds(BOB).has('trade-1')).toBe(true)
  })

  it('writes under a key that names the reader', () => {
    snoozeItem(ALICE, 'trade-1', 24)
    const keys = Object.keys(localStorage)
    expect(keys).toHaveLength(1)
    expect(keys[0]).toContain(ALICE)
  })
})

describe('an unknown reader writes nothing', () => {
  /**
   * Writing to a shared key when the user is unknown is what created the leak.
   * Refusing is the honest failure.
   */
  it('no-ops rather than falling back to a shared key', () => {
    snoozeItem(null, 'trade-1', 24)
    snoozeItem(undefined, 'trade-2', 24)
    expect(Object.keys(localStorage)).toEqual([])
    expect([...getSnoozedIds(null)]).toEqual([])
  })
})

describe('expiry', () => {
  it('prunes a deferral that has run out', () => {
    snoozeItem(ALICE, 'trade-1', 24)
    // Rewrite the stored deadline into the past, as an elapsed day would.
    const key = Object.keys(localStorage)[0]
    const rows = JSON.parse(localStorage.getItem(key)!)
    rows[0].until = Date.now() - 1
    localStorage.setItem(key, JSON.stringify(rows))

    expect(getSnoozedIds(ALICE).has('trade-1')).toBe(false)
    // and the expired row is gone from the store, not merely filtered on read
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual([])
  })

  it('survives a corrupt store without hiding anything', () => {
    localStorage.setItem(`tesseract.attentionFeedSnooze:${ALICE}`, '{ not json')
    expect([...getSnoozedIds(ALICE)]).toEqual([])
  })
})
