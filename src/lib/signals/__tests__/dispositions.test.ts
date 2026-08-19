import { beforeEach, describe, expect, it } from 'vitest'

import {
  DISPOSITION_DAYS,
  DISPOSITION_SCHEMA,
  dispositionKey,
  isDisposedOf,
  judgmentOf,
  loadDispositions,
  recordDisposition,
  type Disposition,
} from '../dispositions'

/**
 * The persistence half of the judgment system.
 *
 * The requirement Phase 3 had to meet without a migration: a stored answer must
 * remain semantically distinguishable after a round trip, even when two answers
 * share the generic feed state the surface uses for suppression.
 */

const USER = 'u1'

beforeEach(() => localStorage.clear())

describe('dispositions', () => {
  it('round-trips the semantic key alongside the generic state', () => {
    const ok = recordDisposition(USER, 'target_expired', 'aapl', {
      kind: 'flagged',
      key: 'cases_outdated',
      label: 'Cases outdated',
      question: 'Has the investment view changed?',
      cardType: 'target_expired',
      until: Date.now() + 86_400_000,
    })
    expect(ok).toBe(true)

    const stored = loadDispositions(USER)[dispositionKey('target_expired', 'aapl')]
    expect(stored.kind).toBe('flagged')
    expect(judgmentOf(stored)).toMatchObject({
      key: 'cases_outdated',
      label: 'Cases outdated',
      question: 'Has the investment view changed?',
    })
    expect(stored.v).toBe(DISPOSITION_SCHEMA)
  })

  it('keeps two judgments apart that map to the same legacy disposition', () => {
    // The single most important property. If these collapse, the record cannot
    // tell "the numbers are stale" from "the thesis is weaker", which is the
    // distinction a research process cares about and the feed does not.
    recordDisposition(USER, 'target_expired', 'a', {
      kind: 'flagged', key: 'cases_outdated', until: Date.now() + 1e6,
    })
    recordDisposition(USER, 'target_expired', 'b', {
      kind: 'flagged', key: 'thesis_weaker', until: Date.now() + 1e6,
    })
    const map = loadDispositions(USER)
    const a = map[dispositionKey('target_expired', 'a')]
    const b = map[dispositionKey('target_expired', 'b')]

    expect(a.kind).toBe(b.kind)
    expect(judgmentOf(a)!.key).not.toBe(judgmentOf(b)!.key)
  })

  it('still writes the legacy verdict field so an old reader sees something', () => {
    recordDisposition(USER, 'no_target', 'x', {
      kind: 'settled', key: 'not_price_driven', until: Date.now() + 1e6,
    })
    const stored = loadDispositions(USER)[dispositionKey('no_target', 'x')]
    expect(stored.verdict).toBe('not_price_driven')
  })

  it('reads pre-Phase-3 records without inventing a judgment', () => {
    // A record written before semantic keys existed has a `verdict` and no
    // `key`. Suppression must still work; the judgment must come back as the
    // verdict rather than being guessed from `kind`, because `settled` alone
    // does not say WHICH settled answer was given.
    const legacy: Record<string, Disposition> = {
      [dispositionKey('research_stale', 'old')]: {
        kind: 'settled', verdict: 'covered', until: Date.now() + 1e6, at: Date.now(),
      } as Disposition,
    }
    localStorage.setItem(`tesseract:signal-disposition:${USER}`, JSON.stringify(legacy))

    const map = loadDispositions(USER)
    expect(isDisposedOf(map, 'research_stale', 'old')).toBe(true)
    expect(judgmentOf(map[dispositionKey('research_stale', 'old')])!.key).toBe('covered')
  })

  it('returns null rather than a fabricated judgment when there is no key at all', () => {
    expect(judgmentOf(undefined)).toBeNull()
    expect(judgmentOf({ kind: 'settled', until: 1, at: 1 } as unknown as Disposition)).toBeNull()
  })

  it('retains a flagged judgment even though it suppresses nothing', () => {
    // `flagged` was written with `until = now`, and `loadDispositions` drops
    // anything whose `until` has passed — so the most common answers on the
    // surface (thesis_weaker, cases_outdated, needs_review, revise_target,
    // needs_update) were recorded and forgotten before the next read.
    // Suppression and retention are separate concerns.
    recordDisposition(USER, 'target_expired', 'keep', {
      kind: 'flagged',
      key: 'cases_outdated',
      until: Date.now() + DISPOSITION_DAYS.flagged * 86_400_000,
    })
    const map = loadDispositions(USER)
    expect(judgmentOf(map[dispositionKey('target_expired', 'keep')])!.key).toBe('cases_outdated')
    expect(isDisposedOf(map, 'target_expired', 'keep')).toBe(false)
  })

  it('does not suppress a flagged finding', () => {
    // The reader said it is real and needs work. Hiding it then would be the
    // surface raising something and immediately removing the reminder.
    recordDisposition(USER, 'no_research', 'z', {
      kind: 'flagged', key: 'needs_review', until: Date.now() + 1e6,
    })
    expect(isDisposedOf(loadDispositions(USER), 'no_research', 'z')).toBe(false)
  })

  it('suppresses settled and rejected until they expire', () => {
    const map = loadDispositions(USER)
    recordDisposition(USER, 'no_target', 's', { kind: 'settled', key: 'not_price_driven', until: Date.now() + 1e6 })
    recordDisposition(USER, 'news', 'r', { kind: 'rejected', key: 'not_relevant', until: Date.now() + 1e6 })
    const after = loadDispositions(USER)
    expect(isDisposedOf(after, 'no_target', 's')).toBe(true)
    expect(isDisposedOf(after, 'news', 'r')).toBe(true)
    expect(isDisposedOf(map, 'no_target', 's')).toBe(false) // the pre-write snapshot
  })

  it('reports failure instead of silently losing the judgment', () => {
    // Storage can be unavailable — private browsing, a full quota. The caller
    // has to know, because the control shows a selected state on the strength
    // of this return value.
    const setItem = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError') }
    try {
      const ok = recordDisposition(USER, 'target_hit', 'q', {
        kind: 'settled', key: 'hold_as_is', until: Date.now() + 1e6,
      })
      expect(ok).toBe(false)
    } finally {
      Storage.prototype.setItem = setItem
    }
  })
})
