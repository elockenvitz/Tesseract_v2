/**
 * The one decision every guard depends on: did the checker actually run?
 *
 * Both false passes traced in this lane came from the same three lines, copied
 * between two guards:
 *
 *     try { out = execFileSync(...) } catch (e) { out = e.stdout ?? '' }
 *
 * `catch` cannot tell "exited non-zero because it found things" apart from
 * "was killed", "crashed", "overflowed its buffer" or "was never on PATH". All
 * five land in the same branch and hand back a fragment, and a guard that
 * parses a fragment finds nothing wrong with it.
 *
 * These pin the classifier that replaced it. They construct `spawnSync`-shaped
 * results rather than spawning anything, so every failure mode is deterministic
 * — including the ones that are awkward to provoke for real, like ENOBUFS.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { classifyChildOutcome, meaningfulStderr } from '../../../../scripts/lib/guard-process.mjs'

const err = (code: string, message = code) => Object.assign(new Error(message), { code })

/** A completed run, as spawnSync reports it. */
const completed = (over: Record<string, unknown> = {}) => ({
  status: 0,
  signal: null,
  error: undefined,
  stderr: '',
  allowedExitCodes: [0],
  label: 'checker',
  ...over,
})

describe('classifyChildOutcome', () => {
  it('accepts a clean completion', () => {
    expect(classifyChildOutcome(completed()).ok).toBe(true)
  })

  it('accepts a completion code the checker is allowed to use', () => {
    // tsc exits 2 on this repo's accepted baseline of ~8,800 errors. Refusing
    // that would replace one broken policy with another.
    const out = classifyChildOutcome(completed({ status: 2, allowedExitCodes: [0, 1, 2] }))
    expect(out.ok).toBe(true)
  })

  it('fails on an exit code outside the completion set', () => {
    // tsc 3 is InvalidProject_OutputsSkipped — it did not build the program.
    const out = classifyChildOutcome(completed({ status: 3, allowedExitCodes: [0, 1, 2] }))
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/exited 3/)
  })

  it('fails when the checker was never found', () => {
    const out = classifyChildOutcome(completed({ error: err('ENOENT', 'spawn npx ENOENT') }))
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/ENOENT/)
  })

  it('fails when the checker timed out', () => {
    const out = classifyChildOutcome(completed({ status: null, error: err('ETIMEDOUT') }))
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/ETIMEDOUT/)
  })

  it('fails when output was truncated at maxBuffer', () => {
    // The old catch handed the truncated stdout straight to the parser, which
    // then reported however few violations happened to fit.
    const out = classifyChildOutcome(completed({ status: null, error: err('ENOBUFS') }))
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/ENOBUFS/)
  })

  it('fails when the checker was killed by a signal', () => {
    const out = classifyChildOutcome(completed({ status: null, signal: 'SIGKILL' }))
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/SIGKILL/)
  })

  it('fails when there is no exit status at all', () => {
    const out = classifyChildOutcome(completed({ status: null }))
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/no exit status/)
  })

  it('fails on a crash written to stderr even when the exit code looks fine', () => {
    const out = classifyChildOutcome(
      completed({ stderr: 'RangeError: Maximum call stack size exceeded\n    at checkExpression' }),
    )
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/stderr/)
  })

  it('does not treat npm/npx notices on stderr as a crash', () => {
    // Otherwise the gate breaks for everybody the next time npm adds a notice.
    const out = classifyChildOutcome(completed({ stderr: 'npm warn exec ignoring workspace\n' }))
    expect(out.ok).toBe(true)
  })
})

describe('meaningfulStderr', () => {
  it('drops npm noise and keeps everything else', () => {
    expect(meaningfulStderr('npm warn a\nnpm notice b\n')).toBe('')
    expect(meaningfulStderr('npm warn a\nTypeError: boom')).toBe('TypeError: boom')
    expect(meaningfulStderr('')).toBe('')
    expect(meaningfulStderr(undefined)).toBe('')
  })
})
