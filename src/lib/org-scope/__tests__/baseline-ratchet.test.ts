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
 *
 * Lowered 109 -> 99 by the quick_thoughts tenant-isolation work: ten files
 * came off the register, either because they now carry an explicit
 * organization filter or because they were dead code and were deleted.
 *
 * ── Lowered 99 -> 97 by Security C1 ──────────────────────────────────────
 *
 * Two files came off. `useScreenResults` read `coverage` unscoped, which fed
 * three screen criteria (has_coverage, analyst_name, coverage_count) — an
 * analyst-name screen matching another firm's analysts is the same defect as
 * the research one C1 was already fixing there, so it was scoped rather than
 * left for later. The second is bookkeeping: the register held one more entry
 * than the scanner now finds.
 *
 * This number is measured, not chosen. It is whatever
 * `node src/lib/org-scope/org-scope-scan.mjs` reports after the work — a
 * ratchet, not a target.
 */
const MAX_KNOWN_UNSCOPED = 97

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
 *
 * ── Raised 1 -> 5 by the quick_thoughts tenant-isolation work ─────────────
 *
 * All four additions are INSERTs, and they are exempt for the same reason:
 * the client is not permitted to send organization_id at all.
 *
 *   thoughts/QuickThoughtCapture.tsx   quick_thoughts
 *   thoughts/PromptModal.tsx           quick_thoughts
 *   ui/checklist/DecisionItemCard.tsx  quick_thoughts
 *   hooks/useHoldingsUpload.ts         portfolio_holdings_positions
 *
 * A BEFORE INSERT trigger derives the column from `current_org_id()` (or,
 * for holdings positions, from the parent portfolio) and *raises* on a
 * supplied value that disagrees. So the filter the scanner is asking for
 * cannot be written: adding `organization_id` to the payload is the exact
 * thing the write boundary exists to refuse.
 *
 * That makes these different in kind from the `useObjectSearch` case above.
 * That one is a read where RLS is trusted to be equivalent to a client
 * filter. These are writes where a client filter is prohibited, and the
 * boundary is a trigger that fails loudly rather than a policy that quietly
 * returns less.
 *
 * The holdings one is not new behaviour — it was invisible until the scanner
 * stopped reading the following query's filter as this one's, and it is
 * annotated rather than "fixed" because there is nothing there to fix.
 */
const MAX_EXEMPTIONS = 5

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
  /**
   * 20s, not the 5s default.
   *
   * This walks every file under src/ and it passed in isolation at 840ms while
   * timing out at 5068ms inside the full suite — CPU contention, not a real
   * failure. A required gate that fails by luck is worse than no gate: it
   * teaches everyone to re-run CI until it goes green, which is how a genuine
   * failure gets clicked past.
   */
  it('never grows', { timeout: 20_000 }, () => {
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
  /**
   * 20s, not the 5s default.
   *
   * This walks every file under src/ and it passed in isolation at 840ms while
   * timing out at 5068ms inside the full suite — CPU contention, not a real
   * failure. A required gate that fails by luck is worse than no gate: it
   * teaches everyone to re-run CI until it goes green, which is how a genuine
   * failure gets clicked past.
   */
  it('never grows', { timeout: 20_000 }, () => {
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
