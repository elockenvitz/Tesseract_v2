import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * The application half of the P0 tenant-boundary fix.
 *
 * ── What this protects ────────────────────────────────────────────────────
 *
 * `public.users.current_organization_id` is the root of the tenant boundary:
 * `current_org_id()` reads it, and 186 RLS policies across 69 tables trust
 * that. Migration 20260826100100 removes the client's ability to write it by
 * replacing the table-wide UPDATE grant with a column allowlist.
 *
 * A column allowlist has one failure mode: somebody later adds a client write
 * to a column that is not on it, and the feature simply breaks in production
 * with `permission denied for column`. And it has one security failure mode:
 * somebody widens the allowlist to make their feature work, and quietly
 * reopens the bypass.
 *
 * So this asserts both directions. It is a ratchet, not a heuristic: every
 * write to `public.users` in the app is enumerated below, and a write site
 * that is not on the list fails the test whether or not it looks dangerous.
 * The DB-level proof lives in `supabase/tests/tenant-boundary-p0.sql`, which
 * needs a database; this needs nothing and runs on every commit.
 */

const SRC = path.resolve(__dirname, '../../..')

/**
 * Columns `authenticated` may write, per migration 20260826100100.
 *
 * `coverage_admin` is on the list because the org-admin UI writes it directly
 * through an existing row policy; the trigger in 20260826100200 is what stops
 * a user setting it on their own row. Everything absent here is withheld at
 * the grant.
 */
const WRITABLE = new Set([
  'id', 'email', 'first_name', 'last_name', 'timezone',
  'user_type', 'pilot_progress', 'coverage_admin',
])

/** Columns that must never appear in a client-side write to `users`. */
const FORBIDDEN = ['current_organization_id', 'is_active', 'is_pilot_user']

/**
 * Every known write to `public.users`, as `file:column,column`.
 *
 * Adding a row here is a deliberate act that should be reviewed against the
 * grant in the migration. Removing a write site is free — the test only fails
 * on sites it did not expect.
 */
const KNOWN_WRITE_SITES: Record<string, string[]> = {
  'contexts/AuthContext.tsx': ['id', 'email', 'first_name', 'last_name'],
  'hooks/useAuth.ts': ['id', 'email', 'first_name', 'last_name'],
  'hooks/usePilotProgress.ts': ['pilot_progress'],
  'pages/ops/OpsPilotPanel.tsx': ['pilot_progress'],
  'pages/OrganizationPage.tsx': ['coverage_admin'],
  'pages/SettingsPage.tsx': ['timezone'],
  'components/onboarding/SetupWizard.tsx': ['user_type'],
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '__tests__') continue
      walk(full, out)
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(full)
    }
  }
  return out
}

/**
 * Write sites against `public.users`, as {file, columns}.
 *
 * Deliberately crude: it takes the text following `.from('users')` up to the
 * first `.eq(`/`.select(`/`.match(` and looks for a write call with an object
 * literal. A Supabase query builder is a fluent chain on one expression, so
 * this is reliable in practice, and the ratchet catches anything it misreads
 * by surfacing an unexpected site rather than by silently passing.
 */
function findUserWrites(): { file: string; columns: string[] }[] {
  const found: { file: string; columns: string[] }[] = []
  for (const file of walk(SRC)) {
    const text = fs.readFileSync(file, 'utf8')
    let idx = text.indexOf(".from('users')")
    while (idx !== -1) {
      const tail = text.slice(idx, idx + 600)
      const write = /\.(update|upsert|insert)\(\s*\[?\s*\{([\s\S]*?)\}/.exec(tail)
      // A write only counts when nothing terminates the chain before it.
      const terminator = /\.(select|eq|in|match|order|single|maybeSingle)\(/.exec(tail)
      if (write && (!terminator || write.index < terminator.index)) {
        const columns = [...write[2].matchAll(/(?:^|[\s,{])([A-Za-z_][A-Za-z0-9_]*)\s*:/g)]
          .map(m => m[1])
        found.push({ file: path.relative(SRC, file).replace(/\\/g, '/'), columns })
      }
      idx = text.indexOf(".from('users')", idx + 1)
    }
  }
  return found
}

describe('client writes to public.users', () => {
  const writes = findUserWrites()

  it('finds the write sites at all, so a silent regex failure cannot pass', () => {
    // Without this, a change to the query-builder style would make every
    // assertion below vacuously true.
    expect(writes.length).toBeGreaterThanOrEqual(Object.keys(KNOWN_WRITE_SITES).length)
  })

  it('never writes an authority-bearing column', () => {
    // The P0 itself. `current_organization_id` must only ever move through
    // set_current_org() / morph_switch_org(), which validate membership.
    const offenders = writes
      .filter(w => w.columns.some(c => FORBIDDEN.includes(c)))
      .map(w => `${w.file}: ${w.columns.filter(c => FORBIDDEN.includes(c)).join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('writes only columns the migration grants', () => {
    const offenders = writes
      .flatMap(w => w.columns.filter(c => !WRITABLE.has(c)).map(c => `${w.file}: ${c}`))
    expect(offenders).toEqual([])
  })

  it('introduces no write site that has not been reviewed', () => {
    const unexpected = writes
      .map(w => w.file)
      .filter(f => !(f in KNOWN_WRITE_SITES))
    expect([...new Set(unexpected)]).toEqual([])
  })
})

describe('the tenant-boundary migrations are present and intact', () => {
  const dir = path.resolve(SRC, '../supabase/migrations')
  const read = (name: string) => fs.readFileSync(path.join(dir, name), 'utf8')

  it('current_org_id() validates active membership', () => {
    const sql = read('20260826100000_p0_current_org_id_validates_membership.sql')
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.current_org_id\(\)/)
    expect(sql).toMatch(/organization_memberships/)
    expect(sql).toMatch(/status\s*=\s*'active'/)
    // SECURITY DEFINER is not optional: the users SELECT policy calls this
    // function, so an INVOKER version would recurse.
    expect(sql).toMatch(/SECURITY DEFINER/)
    expect(sql).toMatch(/SET search_path = public/)
  })

  it('the broad users UPDATE grant is revoked and replaced by an allowlist', () => {
    const sql = read('20260826100100_p0_users_authority_column_grants.sql')
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.users FROM authenticated/)
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.users FROM anon/)
    const grant = /GRANT UPDATE \(([\s\S]*?)\)\s*\n?\s*ON public\.users TO authenticated/.exec(sql)
    expect(grant).toBeTruthy()
    const granted = grant![1].split(',').map(s => s.trim())
    for (const col of FORBIDDEN) expect(granted).not.toContain(col)
    for (const col of granted) expect(WRITABLE.has(col)).toBe(true)
  })

  it('the authority guard stands aside only for named privileged roles', () => {
    const sql = read('20260826100200_p0_users_authority_column_guard.sql')
    expect(sql).toMatch(/CREATE TRIGGER trg_enforce_user_authority_columns/)
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE ON public\.users/)
    // SECURITY INVOKER is load-bearing — as DEFINER, current_user would always
    // read 'postgres' and the guard would never fire for a client write.
    expect(sql).toMatch(/SECURITY INVOKER/)
    expect(sql).toMatch(/current_user NOT IN \('authenticated', 'anon'\)/)
  })
})
