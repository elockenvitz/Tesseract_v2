import { describe, it, expect } from 'vitest'
import baseline from '../known-unscoped-queries.json'

/**
 * The allowlist may only shrink.
 *
 * known-unscoped-queries.json is a register of files that query org-scoped
 * tables without an org filter and rely on RLS to hold the tenant boundary.
 * The guard next door fails when a file *not* on the list introduces one —
 * which makes adding a line the cheapest possible way to turn the build
 * green, and is how the register reached 109 entries.
 *
 * So the count is ratcheted. Fixing a file lowers MAX and the ratchet holds
 * at the new level; adding one fails the build with no way to make it pass
 * except doing the work.
 *
 * There is no temporary exception, because a temporary exception is exactly
 * how this got to 109.
 *
 * To lower it: fix the file, remove its entry, drop MAX to match. That is a
 * deliberate three-step edit, and it should be — every step down is a real
 * improvement to the tenant boundary and worth noticing in review.
 */
const MAX_KNOWN_UNSCOPED = 109

describe('unscoped-query allowlist ratchet', () => {
  it('never grows', () => {
    const entries = baseline as string[]
    expect(
      entries.length,
      entries.length > MAX_KNOWN_UNSCOPED
        ? `\n  The allowlist grew from ${MAX_KNOWN_UNSCOPED} to ${entries.length}.\n` +
          `  Adding an entry is not an available fix — add the org filter to the\n` +
          `  query instead. See the note at the top of this file.\n`
        : undefined,
    ).toBeLessThanOrEqual(MAX_KNOWN_UNSCOPED)
  })

  it('tells you to lower the ratchet when the list shrinks', () => {
    const entries = baseline as string[]
    // Not a failure — a nudge. A list that shrank without MAX following it
    // leaves headroom for a future regression to slip in unnoticed.
    if (entries.length < MAX_KNOWN_UNSCOPED) {
      console.warn(
        `\n  Allowlist is down to ${entries.length}. Lower MAX_KNOWN_UNSCOPED in\n` +
        `  baseline-ratchet.test.ts to ${entries.length} so the gain is locked in.\n`,
      )
    }
    expect(entries.length).toBeGreaterThanOrEqual(0)
  })

  it('holds no duplicates — a duplicate is a silent slot for a regression', () => {
    const entries = baseline as string[]
    expect(new Set(entries).size).toBe(entries.length)
  })
})
