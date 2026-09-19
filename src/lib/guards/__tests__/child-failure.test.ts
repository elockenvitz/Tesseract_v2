/**
 * The classifier, against real child processes rather than hand-built objects.
 *
 * guard-process.test.ts pins the decision. This pins the SHAPE it is fed: that
 * `spawnSync` really does report a timeout, a buffer overflow and a missing
 * binary the way the classifier expects. A classifier that is right about a
 * shape Node never produces would be a guard that still cannot fail.
 *
 * Every case here spawns `process.execPath` with an inline script, so they run
 * in milliseconds and need nothing installed.
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { classifyChildOutcome } from '../../../../scripts/lib/guard-process.mjs'

const classify = (child: ReturnType<typeof spawnSync>, allowedExitCodes = [0]) =>
  classifyChildOutcome({
    status: child.status,
    signal: child.signal,
    error: child.error,
    stderr: String(child.stderr ?? ''),
    allowedExitCodes,
    label: 'checker',
  })

const node = (script: string, opts = {}) =>
  spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', ...opts })

describe('a child that completes', () => {
  it('passes when it exits 0 with nothing on stderr', () => {
    expect(classify(node('process.stdout.write("done")')).ok).toBe(true)
  })

  it('passes on an exit code the checker is allowed to use', () => {
    expect(classify(node('process.exit(2)'), [0, 1, 2]).ok).toBe(true)
  })
})

describe('a child that does not complete', () => {
  it('fails on an unexpected non-zero exit', () => {
    const out = classify(node('process.exit(3)'), [0, 1, 2])
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/exited 3/)
  })

  it('fails when it crashes, even though it printed usable output first', () => {
    // This is the shape the old `catch (e) { return e.stdout }` swallowed: real
    // output, and a process that then died. The output parsed fine and showed
    // no violations, because it stopped before reaching any.
    const out = classify(node('process.stdout.write("partial output\\n"); throw new Error("boom")'))
    expect(out.ok).toBe(false)
  })

  it('fails when it is killed by a timeout', () => {
    const child = node('setTimeout(() => {}, 10000)', { timeout: 250 })
    const out = classify(child)
    expect(out.ok).toBe(false)
    // Node reports this as ETIMEDOUT, as a signal, or both, depending on
    // platform. The classifier has to catch it whichever way it arrives.
    expect(out.reason).toMatch(/ETIMEDOUT|killed by|no exit status/)
  })

  it('fails when its output overflows maxBuffer and is truncated', () => {
    const child = node('process.stdout.write("x".repeat(200000))', { maxBuffer: 1024 })
    const out = classify(child)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/ENOBUFS|did not run to completion/)
  })

  it('fails when the checker is not installed', () => {
    const child = spawnSync('tesseract-no-such-binary-exists', ['--version'], { encoding: 'utf8' })
    const out = classify(child)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/ENOENT|did not run to completion/)
  })
})
