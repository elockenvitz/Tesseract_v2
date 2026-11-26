/**
 * Regression tests for how scripts/unconditional-policy-guard.mjs chooses and
 * trusts a security inventory.
 *
 * ── The two defects these exist for ───────────────────────────────────────
 *
 * 1. PRECEDENCE. The guard read `production-security-inventory.json` before
 *    the committed `ci-policy-inventory.json`. That file is gitignored, so it
 *    exists only on a developer machine. Measured 2026-11-26, same commit:
 *    FAIL with 103 findings in the primary checkout, PASS with 14 known and 0
 *    new in CI. The verdict depended on untracked local state and the
 *    alarming answer was the wrong one.
 *
 * 2. ORDERING. `if (fresh.length) return EXIT.FAIL` came BEFORE the
 *    `schemaOk` check, so a schema_version 2 capture produced findings from
 *    detectors that cannot run on that schema and reported them as a real
 *    failure — plus a RATCHET instruction to delete six exception entries on
 *    the strength of them.
 *
 * ── Why the cases are built from the real capture ─────────────────────────
 *
 * A synthetic inventory would have to satisfy MIN_TABLES / MIN_POLICIES and
 * then classify to a known verdict, which means reimplementing the classifier
 * in the fixture. So each case starts from the committed capture — whose
 * verdict is known to be "0 new findings" — and mutates exactly the one field
 * under test. The mutation is the variable; everything else is held.
 *
 * Exit codes, not source text. A test that greps the guard for a constant
 * passes while the guard reads the wrong file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chooseInventory, verdictFor, EXIT, MIN_SCHEMA_VERSION } from '../unconditional-policy-guard.mjs'

const REPO = resolve(import.meta.dirname, '..', '..')
const GUARD = resolve(REPO, 'scripts', 'unconditional-policy-guard.mjs')
const COMMITTED = resolve(REPO, 'docs', 'audit', 'baselines', 'ci-policy-inventory.json')

const DAY_MS = 86_400_000

let dir
let base

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'policy-inventory-'))
  base = JSON.parse(readFileSync(COMMITTED, 'utf8'))
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

/** Write a variant of the committed capture and return its path. */
function fixture(name, mutate) {
  const copy = JSON.parse(JSON.stringify(base))
  mutate(copy)
  const p = join(dir, `${name}.json`)
  writeFileSync(p, JSON.stringify(copy), 'utf8')
  return p
}

/** Run the guard against one inventory. Always from the repo root. */
function runGuard(inventoryPath, extra = []) {
  const r = spawnSync(process.execPath, [GUARD, inventoryPath, ...extra], {
    cwd: REPO,
    encoding: 'utf8',
    shell: false,
  })
  return { status: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

const capturedAt = daysAgo => new Date(Date.now() - daysAgo * DAY_MS).toISOString()

// ---------------------------------------------------------------------------
// Defect 1: precedence
// ---------------------------------------------------------------------------

describe('which inventory a run reads', () => {
  it('reads the COMMITTED capture even when an untracked one is present', () => {
    // The whole defect in one assertion. `exists` says the gitignored local
    // inventory is there; the guard must still choose the committed file.
    const chosen = chooseInventory(undefined, { exists: () => true })
    expect(chosen.path).toBe('docs/audit/baselines/ci-policy-inventory.json')
  })

  it('names the untracked inventory it ignored, rather than ignoring it silently', () => {
    // Silently skipping a file a developer just captured is its own trap: they
    // would read the verdict as being about their capture.
    const chosen = chooseInventory(undefined, { exists: () => true })
    expect(chosen.shadowed).toContain('docs/audit/baselines/production-security-inventory.json')
  })

  it('reports nothing shadowed when no untracked inventory exists', () => {
    const chosen = chooseInventory(undefined, { exists: () => false })
    expect(chosen.shadowed).toEqual([])
  })

  it('uses an explicitly named inventory, and then claims nothing is shadowed', () => {
    const chosen = chooseInventory('/tmp/somewhere/else.json', { exists: () => true })
    expect(chosen).toMatchObject({ path: '/tmp/somewhere/else.json', explicit: true, shadowed: [] })
  })

  it('does not fall back to another inventory when the chosen one is unreadable', () => {
    // The old loop tried the next candidate on a parse error, so a malformed
    // authoritative capture was papered over by whatever else was on disk.
    const { status, out } = runGuard(join(dir, 'does-not-exist.json'))
    expect(status).toBe(EXIT.BROKEN)
    expect(out).not.toMatch(/ci-policy-inventory\.json/)
  })
})

// ---------------------------------------------------------------------------
// Defect 2: trust before findings
// ---------------------------------------------------------------------------

describe('a capture whose schema the detectors cannot read', () => {
  it('is BROKEN, not FAILED', () => {
    const p = fixture('schema-too-old', inv => { inv.schema_version = MIN_SCHEMA_VERSION - 1 })
    expect(runGuard(p).status).toBe(EXIT.BROKEN)
  })

  it('reports no findings at all, because the detectors did not run', () => {
    const p = fixture('schema-too-old-json', inv => { inv.schema_version = MIN_SCHEMA_VERSION - 1 })
    const { out } = runGuard(p, ['--json'])
    const payload = JSON.parse(out.slice(out.indexOf('{')))
    expect(payload.verdict).toBe('broken-schema')
    expect(payload.findings).toEqual([])
    expect(payload.fresh).toEqual([])
    expect(payload.trustworthy).toBe(false)
  })

  it('is BROKEN even when it would otherwise have had findings to report', () => {
    // This is the case that actually discriminates. A schema-too-old capture
    // with NO unrecognised findings exits BROKEN under either ordering, so the
    // cases above cannot tell the fix from the defect. With an unrecognised
    // finding present, the old ordering returns FAIL (exit 1) and the fixed
    // ordering returns BROKEN (exit 2) — which is the whole defect: 103
    // findings reported as real from detectors that could not run.
    const p = fixture('schema-too-old-with-finding', inv => {
      inv.schema_version = MIN_SCHEMA_VERSION - 1
      renameToUnknownTable(inv)
    })
    const { status, out } = runGuard(p)
    expect(status).toBe(EXIT.BROKEN)
    expect(status).not.toBe(EXIT.FAIL)
    expect(out).toMatch(/are NOT reported/)
  })

  it('withholds findings in --json too, so a consumer cannot act on them', () => {
    const p = fixture('schema-too-old-with-finding-json', inv => {
      inv.schema_version = MIN_SCHEMA_VERSION - 1
      renameToUnknownTable(inv)
    })
    const { status, out } = runGuard(p, ['--json'])
    const payload = JSON.parse(out.slice(out.indexOf('{')))
    expect(status).toBe(EXIT.BROKEN)
    expect(payload.fresh).toEqual([])
  })

  it('does not print the RATCHET instruction to delete exception entries', () => {
    // This is the actively harmful part: acting on that advice removes real
    // KNOWN_UNRESOLVED entries because an old snapshot predates them.
    const p = fixture('schema-too-old-text', inv => { inv.schema_version = MIN_SCHEMA_VERSION - 1 })
    expect(runGuard(p).out).not.toMatch(/RATCHET/)
  })
})

describe('a capture that is merely old', () => {
  it('is UNVERIFIED when nothing new is found', () => {
    const p = fixture('stale', inv => { inv.captured_at = capturedAt(40) })
    const { status, out } = runGuard(p)
    expect(status).toBe(EXIT.UNVERIFIED)
    expect(out).toMatch(/not a pass/)
  })

  it('still FAILS on a new finding, and says the finding is as of the capture', () => {
    // Fail closed: a finding that was true at capture time is still a finding.
    // What must not happen is reporting it as the state of production today.
    const p = fixture('stale-with-finding', inv => {
      inv.captured_at = capturedAt(40)
      renameToUnknownTable(inv)
    })
    const { status, out } = runGuard(p)
    expect(status).toBe(EXIT.FAIL)
    expect(out).toMatch(/AS OF THE CAPTURE, NOT AS OF NOW/)
  })
})

describe('a fresh, well-formed capture', () => {
  it('PASSES', () => {
    const p = fixture('fresh', inv => { inv.captured_at = capturedAt(0) })
    expect(runGuard(p).status).toBe(EXIT.PASS)
  })

  it('says in the same breath that it proved nothing about effective authorization', () => {
    const p = fixture('fresh-static-only', inv => { inv.captured_at = capturedAt(0) })
    expect(runGuard(p).out).toMatch(/STATIC ONLY/)
  })

  it('FAILS on a finding that is not in KNOWN_UNRESOLVED', () => {
    const p = fixture('fresh-with-finding', inv => {
      inv.captured_at = capturedAt(0)
      renameToUnknownTable(inv)
    })
    expect(runGuard(p).status).toBe(EXIT.FAIL)
  })
})

// ---------------------------------------------------------------------------
// Malformed and missing
// ---------------------------------------------------------------------------

describe('an inventory that is not usable as one', () => {
  it('is BROKEN when the file does not exist', () => {
    expect(runGuard(join(dir, 'absent.json')).status).toBe(EXIT.BROKEN)
  })

  it('is BROKEN when the file is not valid JSON', () => {
    const p = join(dir, 'malformed.json')
    writeFileSync(p, '{ "schema_version": 4, "tables": [', 'utf8')
    expect(runGuard(p).status).toBe(EXIT.BROKEN)
  })

  it('is BROKEN when the file is valid JSON but not an object', () => {
    // `[]`, `null` and `"text"` all parse. None is an inventory, and an
    // array in particular reads as having zero tables rather than as garbage.
    for (const [name, body] of [['array', '[]'], ['null', 'null'], ['string', '"nope"']]) {
      const p = join(dir, `not-an-object-${name}.json`)
      writeFileSync(p, body, 'utf8')
      expect(runGuard(p).status, name).toBe(EXIT.BROKEN)
    }
  })

  it('is BROKEN when the inventory is truncated', () => {
    const p = fixture('truncated', inv => {
      inv.tables = inv.tables.slice(0, 3)
      inv.policies = inv.policies.slice(0, 3)
    })
    expect(runGuard(p).status).toBe(EXIT.BROKEN)
    // And specifically not a pass: an almost-empty inventory finds nothing.
    expect(runGuard(p).out).toMatch(/truncated/i)
  })

  it('is BROKEN when captured_at is missing entirely', () => {
    // No timestamp means the age is unknown, which cannot be treated as new.
    const p = fixture('no-timestamp', inv => { delete inv.captured_at })
    expect(runGuard(p).status).toBe(EXIT.UNVERIFIED)
  })
})

// ---------------------------------------------------------------------------
// The verdict function itself, so the two callers cannot drift
// ---------------------------------------------------------------------------

describe('verdictFor', () => {
  const fr = (over = {}) => ({ ok: true, schemaOk: true, reason: null, ageDays: 1, maxAgeDays: 7, version: 4, ...over })

  it('puts an unreadable schema ahead of any finding count', () => {
    expect(verdictFor({ freshness: fr({ schemaOk: false }), freshCount: 99 }))
      .toEqual({ exit: EXIT.BROKEN, state: 'broken-schema' })
  })

  it('fails on a new finding against a trustworthy capture', () => {
    expect(verdictFor({ freshness: fr(), freshCount: 1 }))
      .toEqual({ exit: EXIT.FAIL, state: 'fail' })
  })

  it('distinguishes a finding against a stale capture', () => {
    expect(verdictFor({ freshness: fr({ ok: false, reason: 'old' }), freshCount: 1 }))
      .toEqual({ exit: EXIT.FAIL, state: 'fail-stale' })
  })

  it('is unverified, never passed, when the capture is stale and clean', () => {
    expect(verdictFor({ freshness: fr({ ok: false, reason: 'old' }), freshCount: 0 }))
      .toEqual({ exit: EXIT.UNVERIFIED, state: 'unverified-stale' })
  })

  it('passes only when the capture is both readable and current', () => {
    expect(verdictFor({ freshness: fr(), freshCount: 0 }))
      .toEqual({ exit: EXIT.PASS, state: 'pass' })
  })

  it('never returns PASS for any combination carrying a defect', () => {
    for (const schemaOk of [true, false]) {
      for (const ok of [true, false]) {
        for (const freshCount of [0, 1]) {
          const v = verdictFor({ freshness: fr({ schemaOk, ok, reason: ok ? null : 'old' }), freshCount })
          if (!(schemaOk && ok && freshCount === 0)) expect(v.exit).not.toBe(EXIT.PASS)
        }
      }
    }
  })
})

/**
 * Turn one existing finding into an unrecognised one.
 *
 * `KNOWN_UNRESOLVED` is keyed by table name, so renaming the table a finding
 * sits on makes that finding "fresh" without inventing a policy shape the
 * classifier has never seen. The name is deliberately one no real table could
 * collide with.
 */
function renameToUnknownTable(inv) {
  const SYNTHETIC = 'zz_synthetic_table_for_test'
  const target = 'workflow_stakeholders'
  for (const t of inv.tables) if (t.name === target) t.name = SYNTHETIC
  for (const p of inv.policies) if (p.table === target) p.table = SYNTHETIC
}
