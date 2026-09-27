#!/usr/bin/env node
/**
 * Prove the Files V1 migrations behave correctly in every environment shape.
 *
 * ── What this exists to catch ──────────────────────────────────────────────
 *
 * M1 and M2 are the dangerous pair: both run against production, both once
 * claimed to be no-ops, and one of them was wrong. M1's earlier version swept
 * the catalog by LIKE match and dropped whatever it did not recognise; M2's
 * revoked a live privilege. Neither fact was visible without executing them
 * against a database shaped like production.
 *
 * So each shape is built on a disposable PG 17 cluster and the migrations are
 * run for real. A no-op is proven by snapshotting the catalog — policies,
 * predicates, function definitions AND ACLs — before and after, and diffing.
 *
 * Scenarios:
 *   production   already hardened → M1/M2 change nothing, M3/M4 create
 *   fresh        legacy policies, no helpers → M1 hardens, M2 creates
 *   neg-extra    one unexpected assets policy → M1 aborts
 *   neg-pred     right name, wrong predicate → M1 aborts
 *   neg-helper   helper body drifted → M2 aborts
 *
 * Usage: node scripts/test-files-migrations.mjs [scenario ...]
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PGBIN = process.env.PGBIN ?? 'C:/pgsql/bin'
const PORT = process.env.PGPORT_TEST ?? '55439'

const bin = (n) => path.join(PGBIN, process.platform === 'win32' ? `${n}.exe` : n)

const M = {
  m1: 'supabase/migrations/20260925090000_assets_bucket_org_rls_reconcile.sql',
  m2: 'supabase/migrations/20260925090100_files_tenancy_helper_drift.sql',
  m3: 'supabase/migrations/20260925090200_files_repository.sql',
  m4: 'supabase/migrations/20260925090300_file_links.sql',
}
const BASELINE = 'supabase/tests/files/00_baseline.sql'
const FIX = (n) => `supabase/tests/files/fixtures/${n}.sql`

let DATA, SOCK, server
const results = []

/**
 * spawnSync, not execFileSync: psql writes RAISE NOTICE to stderr, and the
 * State A / State B / "already matches" lines this suite asserts on are all
 * notices. execFileSync hands back stdout only on success, so every one of
 * those assertions would read an empty string and fail for the wrong reason.
 */
function psql(db, args, { expectFail = false } = {}) {
  const r = spawnSync(
    bin('psql'),
    ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db,
     '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'postgres' } },
  )
  const combined = (r.stdout ?? '') + (r.stderr ?? '')
  if (r.status !== 0) {
    if (expectFail) return combined
    throw new Error(`psql failed (status ${r.status}):\n${combined}`)
  }
  if (expectFail) throw new Error(`expected failure but it succeeded:\n${combined}`)
  return combined
}

const runFile = (db, rel, opts) => psql(db, ['-f', path.join(ROOT, rel)], opts)

/** Value queries read stdout ONLY — a stray notice must not join the value. */
function query(db, sql) {
  const r = spawnSync(
    bin('psql'),
    ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db,
     '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-t', '-A', '-c', sql],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'postgres' } },
  )
  if (r.status !== 0) {
    throw new Error(`query failed:\n${(r.stdout ?? '') + (r.stderr ?? '')}`)
  }
  return (r.stdout ?? '').trim()
}

/**
 * Everything about the assets policies and the three tenancy functions that
 * a migration could change — including ACLs, which is where M2 was wrong.
 */
const SNAPSHOT_SQL = `
select string_agg(line, E'\\n' order by line) from (
  select 'POLICY ' || policyname || ' | ' || cmd || ' | ' || roles::text
         || ' | using=' || coalesce(qual,'-') || ' | check=' || coalesce(with_check,'-') as line
  from pg_policies
  where schemaname='storage' and tablename='objects'
    and (coalesce(qual,'')||' '||coalesce(with_check,'')) like '%assets%'
  union all
  select 'FUNC ' || p.proname || ' | ' || pg_get_functiondef(p.oid)
         || ' | acl=' || coalesce(array_to_string(p.proacl,','),'(default)')
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in
    ('current_org_id','is_active_member_of_current_org','is_active_org_admin_of_current_org')
  union all
  select 'BUCKET assets public=' || public::text from storage.buckets where id='assets'
) s`

function ok(scenario, name) { results.push({ scenario, name, pass: true }) }
function bad(scenario, name, detail) { results.push({ scenario, name, pass: false, detail }) }

function check(scenario, name, cond, detail) {
  cond ? ok(scenario, name) : bad(scenario, name, detail)
}

/**
 * The pre-existing tenancy and storage assertion suites, run against the
 * REVISED migrations in each shape.
 *
 * They were written against the first M1/M2. Re-running them here is what
 * proves the rewrite did not quietly change what the policies mean — the
 * migrations moved from "always sweep" to "classify then act", and the
 * resulting boundary has to be identical either way.
 *
 * Each suite emits `pass <label>` notices; a suite that ran but asserted
 * nothing would print none, so the count is checked rather than just the
 * exit status.
 */
function runAssertionSuites(s, db) {
  for (const suite of ['10_tenancy', '20_storage']) {
    const out = runFile(db, `supabase/tests/files/${suite}.sql`)
    // The suites report each assertion as `WARNING: PASS  <label>`.
    const passes = (out.match(/\bPASS\b/g) ?? []).length
    const fails = (out.match(/\bFAIL\b/g) ?? []).length
    check(s, `${suite}: asserted ${passes}, failed ${fails}`,
      passes > 0 && fails === 0, out.slice(-900))
  }
}

function freshDb(name, shape) {
  execFileSync(bin('createdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', name],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'ignore' })
  runFile(name, BASELINE)
  if (shape) runFile(name, FIX(shape))
  return name
}

// ── Scenarios ──────────────────────────────────────────────────────────────

function scenarioProduction() {
  const s = 'production'
  const db = freshDb('t_production', 'shape_production')

  const before = query(db, SNAPSHOT_SQL)

  const m1 = runFile(db, M.m1)
  check(s, 'M1 reports State A', /State A .* already hardened/s.test(m1), m1)

  const m2 = runFile(db, M.m2)
  check(s, 'M2 reports both helpers already match',
    (m2.match(/already matches/g) ?? []).length === 2, m2)
  check(s, 'M2 created nothing', /2 matched, 0 created/.test(m2), m2)

  const after = query(db, SNAPSHOT_SQL)
  check(s, 'M1+M2 are a byte-identical catalog no-op', before === after,
    diff(before, after))

  // The specific thing M2 got wrong before.
  const acl = query(db,
    `select coalesce(array_to_string(proacl,','),'(default)') from pg_proc p
     join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname='is_active_member_of_current_org'`)
  check(s, 'PUBLIC EXECUTE grant survives M2', /(^|,)=X\//.test(acl), `acl=${acl}`)

  runFile(db, M.m3)
  runFile(db, M.m4)
  check(s, 'M3 created public.files',
    query(db, `select to_regclass('public.files') is not null`) === 't')
  check(s, 'M4 created public.file_links',
    query(db, `select to_regclass('public.file_links') is not null`) === 't')
  check(s, 'files RLS enabled',
    query(db, `select relrowsecurity from pg_class where oid='public.files'::regclass`) === 't')

  runAssertionSuites(s, db)

  // Rerunnable.
  const again = runFile(db, M.m1)
  check(s, 'M1 rerun is still State A', /State A/.test(again), again)
}

function scenarioFresh() {
  const s = 'fresh'
  const db = freshDb('t_fresh', null) // baseline = legacy policies, no helpers

  check(s, 'starts with the legacy four', query(db,
    `select count(*)::int from pg_policies where schemaname='storage'
     and tablename='objects' and policyname in
     ('Authenticated users can upload files','Authenticated users can read files',
      'Users can update their own files','Users can delete their own files')`) === '4')
  check(s, 'starts with no tenancy helpers', query(db,
    `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
     ('is_active_member_of_current_org','is_active_org_admin_of_current_org')`) === '0')

  const m1 = runFile(db, M.m1)
  check(s, 'M1 reports State B', /State B .* exact legacy policy set/s.test(m1), m1)
  check(s, 'legacy policies are gone', query(db,
    `select count(*)::int from pg_policies where schemaname='storage'
     and tablename='objects' and policyname='Authenticated users can read files'`) === '0')
  check(s, 'the hardened four exist', query(db,
    `select count(*)::int from pg_policies where schemaname='storage'
     and tablename='objects' and policyname like 'assets: %'`) === '4')
  check(s, 'every assets policy is tenant-scoped', query(db,
    `select count(*)::int from pg_policies where schemaname='storage'
     and tablename='objects'
     and (coalesce(qual,'')||' '||coalesce(with_check,'')) like '%assets%'
     and (coalesce(qual,'')||' '||coalesce(with_check,'')) not like '%current_org_id%'`) === '0')
  check(s, 'bucket is private',
    query(db, `select public from storage.buckets where id='assets'`) === 'f')

  const m2 = runFile(db, M.m2)
  check(s, 'M2 created both helpers', /0 matched, 2 created/.test(m2), m2)
  check(s, 'helpers are SECURITY DEFINER with pinned search_path', query(db,
    `select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname='public' and p.proname in
     ('is_active_member_of_current_org','is_active_org_admin_of_current_org')
     and p.prosecdef and 'search_path=public' = any(p.proconfig)`) === '2')

  runFile(db, M.m3)
  runFile(db, M.m4)
  check(s, 'M3/M4 created both tables', query(db,
    `select (to_regclass('public.files') is not null
         and to_regclass('public.file_links') is not null)`) === 't')

  runAssertionSuites(s, db)

  // Rerunnable: the repair leaves State A behind.
  const again = runFile(db, M.m1)
  check(s, 'M1 rerun after repair is State A', /State A/.test(again), again)
  const m2again = runFile(db, M.m2)
  check(s, 'M2 rerun after create is a no-op', /2 matched, 0 created/.test(m2again), m2again)
}

function negative(scenario, fixture, migration, expectRe, guardSql) {
  const db = freshDb(`t_${scenario.replace(/-/g, '_')}`, 'shape_production')
  runFile(db, FIX(fixture))

  // Everything before the failing migration must still run.
  if (migration === 'm2') runFile(db, M.m1)

  const before = query(db, SNAPSHOT_SQL)
  const out = runFile(db, M[migration], { expectFail: true })

  check(scenario, `${migration.toUpperCase()} aborts`, expectRe.test(out),
    out.slice(0, 900))
  const after = query(db, SNAPSHOT_SQL)
  check(scenario, 'nothing was changed by the aborted run', before === after,
    diff(before, after))
  if (guardSql) {
    check(scenario, guardSql.name, query(db, guardSql.sql) === guardSql.expect,
      `got ${query(db, guardSql.sql)}`)
  }
}

function diff(a, b) {
  const A = a.split('\n'), B = b.split('\n')
  const out = []
  for (const l of A) if (!B.includes(l)) out.push(`- ${l}`)
  for (const l of B) if (!A.includes(l)) out.push(`+ ${l}`)
  return out.join('\n').slice(0, 900) || '(no line diff)'
}

// ── Cluster lifecycle ──────────────────────────────────────────────────────

function startCluster() {
  // -D must be empty or absent: initdb refuses a directory that already has
  // anything in it, and the password file has to live somewhere else.
  const work = mkdtempSync(path.join(tmpdir(), 'files-pg-'))
  DATA = path.join(work, 'data')
  SOCK = work
  const pw = path.join(work, 'pw.txt')
  writeFileSync(pw, 'postgres')
  execFileSync(bin('initdb'), ['-D', DATA, '-U', 'postgres', '--pwfile', pw,
    '-E', 'UTF8', '--no-sync'], { stdio: 'ignore' })

  server = spawn(bin('postgres'), ['-D', DATA, '-p', PORT, '-h', '127.0.0.1',
    '-c', 'fsync=off', '-c', 'full_page_writes=off'],
    { stdio: 'ignore', detached: false })

  const deadline = Date.now() + 30000
  for (;;) {
    try {
      execFileSync(bin('pg_isready'), ['-h', '127.0.0.1', '-p', PORT],
        { stdio: 'ignore' })
      return
    } catch {
      if (Date.now() > deadline) throw new Error('postgres did not become ready')
      execFileSync(process.platform === 'win32' ? 'cmd' : 'sh',
        process.platform === 'win32' ? ['/c', 'ping -n 2 127.0.0.1 >NUL'] : ['-c', 'sleep 1'],
        { stdio: 'ignore' })
    }
  }
}

function stopCluster() {
  try { server?.kill() } catch {}
  try { execFileSync(bin('pg_ctl'), ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch {}
  try { rmSync(SOCK, { recursive: true, force: true, maxRetries: 5 }) } catch {}
}

// ── Main ───────────────────────────────────────────────────────────────────

const ALL = {
  production: scenarioProduction,
  fresh: scenarioFresh,
  'neg-extra': () => negative('neg-extra', 'neg_extra_policy', 'm1',
    /State C .* unrecognised policy configuration/s,
    { name: 'the unexpected policy still exists (not swept)',
      sql: `select count(*)::int from pg_policies where policyname='legacy_wide_open_assets_read'`,
      expect: '1' }),
  // The discrimination a count-of-names check cannot make: four policies with
  // the four expected NAMES, but only three matching predicates. Asserted
  // against the catalog, not against a literal.
  'neg-pred': () => negative('neg-pred', 'neg_altered_predicate', 'm1',
    /State C[\s\S]*unrecognised policy configuration[\s\S]*Found 4 assets-touching polic\(ies\); 3 match the hardened set exactly/,
    { name: 'all four expected names present, so a name check would pass',
      sql: `select count(*)::int::text from pg_policies
            where schemaname='storage' and tablename='objects'
              and policyname like 'assets: %'`,
      expect: '4' }),
  'neg-helper': () => negative('neg-helper', 'neg_altered_helper', 'm2',
    /body differs from the verified definition/s,
    { name: 'the drifted body was not overwritten',
      sql: `select (prosrc not like '%expires_at%')::text from pg_proc p
            join pg_namespace n on n.oid=p.pronamespace
            where n.nspname='public' and p.proname='is_active_member_of_current_org'`,
      expect: 'true' }),
}

const want = process.argv.slice(2).filter((a) => ALL[a])
const chosen = want.length ? want : Object.keys(ALL)

if (!existsSync(bin('initdb'))) {
  console.error(`\n  Postgres binaries not found at ${PGBIN}. Set PGBIN.\n`)
  process.exit(1)
}

console.log(`\n  Disposable PG cluster on port ${PORT}\n`)
try {
  startCluster()
  for (const name of chosen) {
    console.log(`  ── ${name} ──`)
    try {
      ALL[name]()
    } catch (e) {
      bad(name, 'scenario threw', String(e.message).slice(0, 900))
    }
  }
} finally {
  stopCluster()
}

let failed = 0
for (const r of results) {
  if (r.pass) {
    console.log(`  ok    [${r.scenario}] ${r.name}`)
  } else {
    failed++
    console.log(`  FAIL  [${r.scenario}] ${r.name}`)
    if (r.detail) console.log(String(r.detail).split('\n').map((l) => `          ${l}`).join('\n'))
  }
}

console.log(`\n  ${results.length - failed}/${results.length} assertions passed\n`)
process.exit(failed ? 1 : 0)
