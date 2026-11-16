import { describe, it, expect } from 'vitest'
import { readdirSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * `supabase/migrations/` must contain forward migrations ONLY.
 *
 * Five files were named `*.rollback.sql`. That spelling ends in `.sql`, so
 * every forward-discovery path in this repo and in the Supabase CLI treated
 * them as migrations to APPLY:
 *
 *   - `scripts/audit/policy-state.mjs` does
 *     `readdirSync(dir).filter(f => f.endsWith('.sql')).sort()`
 *     and replays the result, so it replayed the rollbacks.
 *   - The CLI keys applied migrations on the leading timestamp, and each of
 *     the five shared its timestamp with a real forward migration — two files
 *     claiming one version.
 *
 * A rollback applied forward undoes the migration it belongs to. They are now
 * in `supabase/rollback/`.
 *
 * Note the distinction that makes this subtle: 29 OTHER rollback files are
 * named `*.sql.rollback`, where the final extension is `.rollback`. Those do
 * NOT match an `endsWith('.sql')` filter and were never at risk. The hazard
 * was the five whose two suffixes were the other way round — which is exactly
 * the kind of difference that survives review by looking like a typo.
 *
 * So this test asserts the property, not the file list: nothing under
 * `migrations/` may end in `.sql` while naming itself a rollback or a down
 * migration, however the suffixes are arranged.
 */

const ROOT = resolve(__dirname, '../../../..')
const MIGRATIONS = resolve(ROOT, 'supabase/migrations')
const ROLLBACKS = resolve(ROOT, 'supabase/rollback')

/** Everything a forward runner would pick up. The real discovery filter. */
const forwardDiscovered = (dir: string) =>
  readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

/** Names that declare themselves a reversal, in any suffix arrangement. */
const REVERSAL = /(^|[._-])(rollback|down|revert|undo)([._-]|$)/i

describe('supabase/migrations contains only forward migrations', () => {
  it('no forward-discovered file declares itself a rollback or a down migration', () => {
    const offenders = forwardDiscovered(MIGRATIONS).filter(f =>
      REVERSAL.test(f.replace(/\.sql$/, '')),
    )
    expect(offenders).toEqual([])
  })

  it('no NEW migration version is claimed by two files', () => {
    // The CLI keys on the leading timestamp. Two files sharing one version is
    // the defect that let a rollback impersonate its own forward migration.
    //
    // Two pairs predate this gate. Both are genuinely distinct FORWARD
    // migrations that happen to share a timestamp, and both are already
    // applied in production — so renaming either would make the file disagree
    // with `supabase_migrations.schema_migrations`, which is a worse problem
    // than the one it fixes. They are ratcheted here, exactly, rather than
    // silently tolerated by a loosened rule: a third duplicate still fails.
    const KNOWN_DUPLICATE_VERSIONS = new Set(['20260424120000', '20260425110000'])

    const byVersion = new Map<string, string[]>()
    for (const f of forwardDiscovered(MIGRATIONS)) {
      const version = f.match(/^(\d{14})/)?.[1]
      if (!version) continue
      byVersion.set(version, [...(byVersion.get(version) ?? []), f])
    }
    const duplicated = [...byVersion.entries()]
      .filter(([version, files]) => files.length > 1 && !KNOWN_DUPLICATE_VERSIONS.has(version))
      .map(([version, files]) => `${version}: ${files.join(', ')}`)
    expect(duplicated).toEqual([])

    // The ratchet must govern its subject, not a count: if a known pair is
    // ever cleaned up, this fails and the allowlist shrinks deliberately.
    for (const version of KNOWN_DUPLICATE_VERSIONS) {
      expect(byVersion.get(version)?.length, `${version} is no longer duplicated — drop it from the allowlist`).toBe(2)
    }
  })

  it('the relocated rollbacks still exist, so nothing was deleted', () => {
    // Relocation must preserve recovery material. If this directory is empty
    // the "fix" destroyed the rollbacks rather than moving them.
    expect(existsSync(ROLLBACKS)).toBe(true)
    const kept = readdirSync(ROLLBACKS).filter(f => f.endsWith('.sql'))
    expect(kept.length).toBeGreaterThanOrEqual(6)
  })

  it('SELF-TEST: the reversal pattern really matches the shapes it must catch', () => {
    // Three read-only cases prove the detector is not vacuous. Without this,
    // all three tests above would pass against a pattern that matches nothing.
    for (const name of [
      '20261104140000_theme_contribution_audience.rollback.sql',
      '20261009120001_decision_reviews_tenant_isolation_DOWN.sql',
      '20261110010000_fix_trade_delete_paths.revert.sql',
    ]) {
      expect(REVERSAL.test(name.replace(/\.sql$/, ''))).toBe(true)
    }
    // And does not fire on ordinary forward migrations, including ones whose
    // subject matter is about undoing something.
    for (const name of [
      '20261104140000_theme_contribution_audience.sql',
      '20260408100000_harden_holdings_rls.sql',
      '20261109180001_drop_save_asset_content.sql',
    ]) {
      expect(REVERSAL.test(name.replace(/\.sql$/, ''))).toBe(false)
    }
  })

  it('the `*.sql.rollback` convention is not swept up by forward discovery', () => {
    // These 29 were never the problem, and the fix must not have moved them.
    const dotRollback = readdirSync(MIGRATIONS).filter(f => f.endsWith('.sql.rollback'))
    expect(dotRollback.length).toBeGreaterThan(0)
    for (const f of dotRollback) {
      expect(forwardDiscovered(MIGRATIONS)).not.toContain(f)
    }
  })
})
