#!/usr/bin/env node
/**
 * pilot-seed-test — run `supabase/tests/pilot-seed-freezes-reasoning.sql`
 * against a throwaway PostgreSQL cluster.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `sec:suite` runs a SQL suite against a real Supabase PROJECT. That needs a
 * connection to staging, and staging CI is blocked on the free plan, so those
 * suites cannot gate a pull request today.
 *
 * The pilot-seed test was written to need no project: it declares the five
 * tables the function touches, so it runs on any PostgreSQL 17. This runner
 * gives it a cluster, runs it, and deletes the cluster. That makes it a gate
 * rather than a file somebody could run.
 *
 * The cluster listens on loopback only, holds no real data, uses a port of its
 * own, and is removed on exit -- including on failure.
 *
 * Point PG_BIN at the directory holding initdb/pg_ctl/psql if they are not on
 * PATH. Exits non-zero if the suite fails OR if the non-vacuity block stops
 * reporting the old function as broken.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PG_BIN = process.env.PG_BIN || 'C:/pgsql/bin'
const PORT = process.env.PG_TEST_PORT || '55434'
const SUITE = 'supabase/tests/pilot-seed-freezes-reasoning.sql'

const bin = (name) => {
  const withDir = join(PG_BIN, name)
  // Fall back to PATH when PG_BIN does not hold the binaries.
  return existsSync(withDir) || existsSync(`${withDir}.exe`) ? withDir : name
}

let dataDir = null
let started = false

const stop = () => {
  if (started) {
    try {
      execFileSync(bin('pg_ctl'), ['-D', dataDir, '-m', 'immediate', 'stop'], {
        stdio: 'ignore',
      })
    } catch {
      // Already down, or never came up. Nothing to salvage.
    }
    started = false
  }
  if (dataDir) {
    try {
      rmSync(dataDir, { recursive: true, force: true })
    } catch {
      // A locked file on Windows is not worth failing the run over.
    }
  }
}

process.on('exit', stop)
process.on('SIGINT', () => {
  stop()
  process.exit(130)
})

try {
  dataDir = mkdtempSync(join(tmpdir(), 'tesseract-pilot-seed-'))

  // -A trust is safe: loopback only, no real data, deleted below.
  execFileSync(
    bin('initdb'),
    ['-D', dataDir, '-U', 'postgres', '-A', 'trust', '-E', 'UTF8', '--locale=C'],
    { stdio: 'ignore' },
  )
  execFileSync(
    bin('pg_ctl'),
    ['-D', dataDir, '-o', `-p ${PORT} -c listen_addresses=127.0.0.1`, '-w', 'start'],
    { stdio: 'ignore' },
  )
  started = true

  // psql writes RAISE NOTICE to STDERR, so both streams have to be read or the
  // assertion lines -- and the non-vacuity proof -- are invisible to this gate.
  const run = spawnSync(
    bin('psql'),
    [
      `postgresql://postgres@127.0.0.1:${PORT}/postgres`,
      '-v',
      'ON_ERROR_STOP=1',
      '-f',
      SUITE,
    ],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const out = `${run.stdout || ''}\n${run.stderr || ''}`
  if (run.status !== 0) {
    console.error('\npilot-seed-test FAILED\n')
    console.error(out)
    process.exit(1)
  }

  const lines = (out || '').split('\n')
  for (const line of lines) {
    if (/PASS|FAIL|NON-VACUITY|---/.test(line)) {
      console.log(line.replace(/^psql:[^ ]+ /, '').replace(/^NOTICE:\s*/, ''))
    }
  }

  // psql exits 0 on success; the suite raises an exception on any failure,
  // which ON_ERROR_STOP turns into a non-zero exit handled by the catch.
  // This is the belt-and-braces check that the proof block actually ran.
  if (!/non-vacuity proven/.test(out)) {
    console.error(
      '\npilot-seed-test FAILED: the non-vacuity block did not report. ' +
        'The suite ran without proving it can still catch the defect.',
    )
    process.exit(1)
  }

  console.log('\npilot-seed-test OK')
} catch (err) {
  const detail = err.stderr?.toString() || err.stdout?.toString() || err.message
  console.error('\npilot-seed-test FAILED\n')
  console.error(detail)
  process.exit(1)
}
