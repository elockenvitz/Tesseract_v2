#!/usr/bin/env node
/**
 * Prove the ops client-detail RPCs on a disposable PG cluster.
 *
 * These functions are SECURITY DEFINER and read every tenant's rows, so the
 * interesting assertions are not "does it compute" but "who may call it" and
 * "does it attribute a row to the right org". Both need a real database:
 * the bug being fixed returned HTTP 200 with a wrong number, which no
 * type-level or mocked test would have caught.
 *
 * Usage: node scripts/test-ops-rpcs.mjs
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PGBIN = process.env.PGBIN ?? 'C:/pgsql/bin'
const PORT = process.env.PGPORT_TEST ?? '55441'
const bin = (n) => path.join(PGBIN, process.platform === 'win32' ? `${n}.exe` : n)

const FILES = [
  'supabase/tests/ops/00_baseline.sql',
  'supabase/migrations/20260928090000_ops_client_engagement_rpc.sql',
  'supabase/tests/ops/10_client_engagement.sql',
]

let WORK, DATA, server

function psql(db, args) {
  const r = spawnSync(
    bin('psql'),
    ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', '-d', db,
     '-v', 'ON_ERROR_STOP=1', '-X', '-q', ...args],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD: 'postgres' } },
  )
  // Notices land on stderr; the PASS lines this suite asserts on are notices.
  return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

function start() {
  WORK = mkdtempSync(path.join(tmpdir(), 'ops-pg-'))
  DATA = path.join(WORK, 'data')
  const pw = path.join(WORK, 'pw.txt')
  writeFileSync(pw, 'postgres')
  execFileSync(bin('initdb'), ['-D', DATA, '-U', 'postgres', '--pwfile', pw,
    '-E', 'UTF8', '--no-sync'], { stdio: 'ignore' })
  server = spawn(bin('postgres'), ['-D', DATA, '-p', PORT, '-h', '127.0.0.1',
    '-c', 'fsync=off', '-c', 'full_page_writes=off'], { stdio: 'ignore' })

  const deadline = Date.now() + 30000
  for (;;) {
    try {
      execFileSync(bin('pg_isready'), ['-h', '127.0.0.1', '-p', PORT], { stdio: 'ignore' })
      return
    } catch {
      if (Date.now() > deadline) throw new Error('postgres did not become ready')
      execFileSync(process.platform === 'win32' ? 'cmd' : 'sh',
        process.platform === 'win32' ? ['/c', 'ping -n 2 127.0.0.1 >NUL'] : ['-c', 'sleep 1'],
        { stdio: 'ignore' })
    }
  }
}

function stop() {
  try { server?.kill() } catch {}
  try { execFileSync(bin('pg_ctl'), ['-D', DATA, '-m', 'immediate', 'stop'], { stdio: 'ignore' }) } catch {}
  try { rmSync(WORK, { recursive: true, force: true, maxRetries: 5 }) } catch {}
}

if (!existsSync(bin('initdb'))) {
  console.error(`\n  Postgres binaries not found at ${PGBIN}. Set PGBIN.\n`)
  process.exit(1)
}

for (const f of FILES) {
  if (!existsSync(path.join(ROOT, f))) {
    console.error(`\n  Missing ${f}\n`)
    process.exit(1)
  }
}

console.log(`\n  Disposable PG cluster on port ${PORT}\n`)
let failed = false
try {
  start()
  execFileSync(bin('createdb'), ['-h', '127.0.0.1', '-p', PORT, '-U', 'postgres', 'ops_test'],
    { env: { ...process.env, PGPASSWORD: 'postgres' }, stdio: 'ignore' })

  for (const f of FILES) {
    const { ok, out } = psql('ops_test', ['-f', path.join(ROOT, f)])
    if (!ok) {
      failed = true
      console.log(`  FAIL  ${f}`)
      console.log(out.split('\n').map((l) => `        ${l}`).join('\n'))
      break
    }
    const passes = (out.match(/\bPASS\b/g) ?? []).length
    if (passes > 0) {
      out.split('\n').filter((l) => /\bPASS\b/.test(l))
        .forEach((l) => console.log('  ok    ' + l.replace(/^.*?PASS\s+/, '')))
    }
  }
} catch (e) {
  failed = true
  console.log('  FAIL  harness threw: ' + String(e.message).slice(0, 600))
} finally {
  stop()
}

console.log(failed ? '\n  FAILED\n' : '\n  all ops RPC assertions passed\n')
process.exit(failed ? 1 : 0)
