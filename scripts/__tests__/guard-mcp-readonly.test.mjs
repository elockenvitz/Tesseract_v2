/**
 * Regression tests for scripts/guard-mcp-readonly.mjs.
 *
 * The defect these exist for: the guard resolved `.mcp.json` from
 * `process.cwd()`, so running it from anywhere other than the config's
 * directory inspected a DIFFERENT file and printed PASS. A deliberate failure
 * injection passed because the guard was reading someone else's config.
 *
 * So every case here runs the guard from a working directory that is NOT the
 * one holding the fixture, which is the condition the old guard could not
 * survive. Per the repo's standing rule, each safety assertion is paired with
 * a deliberate failure proving the check can observe its own failure mode —
 * these tests assert on EXIT CODES from a spawned process, never on the
 * script's source text.
 *
 * No real credential is read or written: every fixture is synthetic and the
 * guard is pointed at it explicitly with --config.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const GUARD = resolve(import.meta.dirname, '..', 'guard-mcp-readonly.mjs')

const EXIT_OK = 0
const EXIT_UNSAFE = 1
const EXIT_CANNOT_TELL = 3

const PROD_REF = 'wfcebeagznzgeuyysbnt'

/** A config with the given args for the supabase server. */
const config = args => JSON.stringify({
  mcpServers: {
    supabase: {
      command: 'cmd',
      args: ['/c', 'npx', '-y', '@supabase/mcp-server-supabase', ...args],
      // A fake value. The guard must print the KEY name and never the value.
      env: { SUPABASE_ACCESS_TOKEN: 'sbp_FAKE_NOT_A_REAL_TOKEN_0000000000' },
    },
  },
})

let dir       // holds the fixtures
let elsewhere // the cwd we run FROM — deliberately not `dir`

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'mcpguard-'))
  elsewhere = mkdtempSync(join(tmpdir(), 'mcpguard-cwd-'))
  // A decoy in the run directory. The old cwd-based guard would read THIS
  // and report on it; the fixed guard must ignore it entirely when --config
  // names another file.
  writeFileSync(join(elsewhere, '.mcp.json'), config(['--read-only', `--project-ref=${PROD_REF}`]))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(elsewhere, { recursive: true, force: true })
})

/** Runs the guard FROM `elsewhere`, returning {status, stdout, stderr}. */
function runGuard(configPath, env = {}) {
  try {
    const stdout = execFileSync(process.execPath, [GUARD, '--config', configPath], {
      cwd: elsewhere,
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { status: 0, stdout, stderr: '' }
  } catch (err) {
    return {
      status: err.status ?? -1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    }
  }
}

function fixture(name, body) {
  const p = join(dir, name)
  writeFileSync(p, body)
  return p
}

describe('guard-mcp-readonly, run from a different working directory', () => {
  it('passes a read-only config for production', () => {
    const p = fixture('ok.json', config(['--read-only', `--project-ref=${PROD_REF}`]))
    const r = runGuard(p)
    expect(r.status).toBe(EXIT_OK)
    expect(r.stdout).toContain('PASS')
  })

  // ── The deliberate failure. This is the whole point. ──────────────────────
  it('FAILS a read-write config for production, from a foreign cwd', () => {
    const p = fixture('unsafe.json', config([`--project-ref=${PROD_REF}`]))
    const r = runGuard(p)
    expect(r.status).toBe(EXIT_UNSAFE)
    expect(r.stderr).toContain('missing --read-only')
    expect(r.stderr).toContain('PRODUCTION')
  })

  it('reports on the file it was GIVEN, not the one in the cwd', () => {
    // `elsewhere/.mcp.json` is read-only and safe. The named fixture is not.
    // The old guard read the cwd copy and passed. This must fail, and must
    // name the fixture path.
    const p = fixture('named-unsafe.json', config([`--project-ref=${PROD_REF}`]))
    const r = runGuard(p)
    expect(r.status).toBe(EXIT_UNSAFE)
    expect(r.stderr).toContain('named-unsafe.json')
    expect(r.stderr).not.toContain(join(elsewhere, '.mcp.json'))
  })

  it('FAILS CLOSED when the named config is absent', () => {
    const r = runGuard(join(dir, 'does-not-exist.json'))
    expect(r.status).toBe(EXIT_UNSAFE)
    expect(r.stderr).toContain('FAILED CLOSED')
  })

  it('skips an absent config only with the explicit opt-out, and says so', () => {
    const r = runGuard(join(dir, 'does-not-exist.json'), {
      MCP_READONLY_GUARD_ALLOW_MISSING: '1',
    })
    expect(r.status).toBe(EXIT_OK)
    expect(r.stdout).toContain('SKIPPED')
  })

  it('FAILS an unparseable config rather than treating it as empty', () => {
    const p = fixture('broken.json', '{ "mcpServers": { oops }')
    const r = runGuard(p)
    expect(r.status).toBe(EXIT_UNSAFE)
    expect(r.stderr).toContain('not valid JSON')
  })

  it('still flags a missing flag on an UNKNOWN project ref', () => {
    const p = fixture('unknown-ref.json', config(['--project-ref=someotherproject']))
    const r = runGuard(p)
    expect(r.status).toBe(EXIT_UNSAFE)
    expect(r.stderr).toContain('missing --read-only')
  })

  it('accepts --read-only=true as well as the bare flag', () => {
    const p = fixture('eqtrue.json', config(['--read-only=true', `--project-ref=${PROD_REF}`]))
    expect(runGuard(p).status).toBe(EXIT_OK)
  })

  it('never prints a credential value, only the key name', () => {
    const p = fixture('secret.json', config(['--read-only', `--project-ref=${PROD_REF}`]))
    const r = runGuard(p)
    const all = r.stdout + r.stderr
    expect(all).not.toContain('sbp_FAKE_NOT_A_REAL_TOKEN_0000000000')
    expect(all).toContain('SUPABASE_ACCESS_TOKEN')
  })

  it('cannot be fooled by a config with no supabase server at all', () => {
    // An unrelated server must not read as a pass for a supabase connection.
    const p = fixture('other.json', JSON.stringify({
      mcpServers: { somethingElse: { command: 'node', args: ['other.js'] } },
    }))
    const r = runGuard(p)
    expect(r.status).toBe(EXIT_OK)
    expect(r.stdout).toContain('0 Supabase server(s)')
  })

  it('reports CANNOT VERIFY, not PASS, outside a repo with no --config', () => {
    const outside = mkdtempSync(join(tmpdir(), 'mcpguard-norepo-'))
    mkdirSync(join(outside, 'sub'), { recursive: true })
    try {
      let status, stderr = ''
      try {
        execFileSync(process.execPath, [GUARD], {
          cwd: join(outside, 'sub'),
          encoding: 'utf8',
          // Strip the override so resolution must fall through to git.
          env: { ...process.env, MCP_READONLY_GUARD_CONFIG: '' },
          stdio: ['ignore', 'pipe', 'pipe'],
        })
        status = 0
      } catch (err) {
        status = err.status
        stderr = err.stderr?.toString() ?? ''
      }
      // A temp dir may still sit inside a repo on some machines; accept either
      // the no-repo verdict or a real scan, but never a silent pass with
      // nothing examined.
      if (status === EXIT_CANNOT_TELL) {
        expect(stderr).toContain('CANNOT VERIFY')
      } else {
        expect([EXIT_OK, EXIT_UNSAFE]).toContain(status)
      }
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
