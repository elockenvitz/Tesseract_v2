import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
 */
const MAX_KNOWN_UNSCOPED = 109

/**
 * `org-scope-exempt` is the scanner's escape hatch: a comment within three
 * lines of a query suppresses it entirely.
 *
 * It is sometimes the right tool — `useObjectSearch` reads `portfolios`,
 * whose RLS is genuinely org-aware, and a client filter there would be
 * *narrower* than the policy and would hide legacy rows carrying team_id with
 * a null organization_id. But an uncounted escape hatch is the allowlist
 * problem in miniature: the cheapest way to silence the scanner, with nothing
 * stopping the next one.
 *
 * So exemptions ratchet too. Adding one fails the build until somebody raises
 * this number in a commit that says why.
 */
const MAX_EXEMPTIONS = 1

/** Every .ts/.tsx under src, excluding the org-scope module itself. */
function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) sourceFiles(full, acc)
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) acc.push(full)
  }
  return acc
}

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

describe('scanner exemption ratchet', () => {
  it('never grows', () => {
    const root = resolve(__dirname, '../../..')
    const orgScopeDir = join('lib', 'org-scope')
    const hits: string[] = []

    for (const file of sourceFiles(root)) {
      // The scanner and the guard test both *describe* the marker. Only real
      // uses count, so the module that defines it is excluded.
      if (file.includes(orgScopeDir)) continue
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        // Marker plus a colon: an exemption must carry a reason to count as
        // one, and a bare mention in prose is not an exemption.
        if (/org-scope-exempt\s*:/.test(line)) {
          hits.push(`${file.replace(root, '')}: ${line.trim().slice(0, 70)}`)
        }
      }
    }

    expect(
      hits.length,
      hits.length > MAX_EXEMPTIONS
        ? `\n  Exemptions grew from ${MAX_EXEMPTIONS} to ${hits.length}:\n` +
          hits.map(h => `    ${h}`).join('\n') +
          `\n\n  An exemption means RLS alone holds the tenant boundary there.\n` +
          `  Raise MAX_EXEMPTIONS deliberately, in a commit that says why.\n`
        : undefined,
    ).toBeLessThanOrEqual(MAX_EXEMPTIONS)
  })
})
