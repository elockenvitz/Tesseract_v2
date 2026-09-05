import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

/**
 * The deploy gate's exit semantics, pinned.
 *
 * ── The bug this exists for ───────────────────────────────────────────────
 *
 * `netlify-should-build.mjs` read `process.env.COMMIT_REF_MESSAGE` to find the
 * `[preview]` marker. **Netlify does not set that variable.** It sets
 * `COMMIT_REF`, `BRANCH`, `HEAD` and `CONTEXT` — never the message. So the
 * marker test ran against the empty string on every single build and the
 * escape hatch had never once worked.
 *
 * It read as working because it was only ever exercised by setting that same
 * invented variable by hand. An assertion that supplies the input it is
 * testing for proves the regex, not the integration. Three commits carrying
 * `[preview]` were pushed and cancelled before a Netlify log showed the script
 * skipping a commit whose message plainly contained the marker.
 *
 * So these tests drive the real script as a process, with an environment
 * shaped like Netlify's, and `COMMIT_REF_MESSAGE` deliberately unset — a test
 * that sets it would reproduce the original mistake exactly.
 *
 * ── Exit semantics, which are inverted from everything else ───────────────
 *
 *   exit 0        = SKIP the build
 *   exit non-zero = CONTINUE the build
 *
 * Getting this backwards means either no deploys at all or no savings, so it
 * is asserted explicitly rather than through a helper that could itself invert.
 */

const SCRIPT = join(process.cwd(), 'scripts', 'netlify-should-build.mjs')

const SKIP = 0
const BUILD_IS_NONZERO = true

/** Run the real script with a Netlify-shaped environment. */
function gate(env: Record<string, string | undefined>, cwd = process.cwd()) {
  const clean = { ...process.env }
  // The variable that never existed. Unset always: a test that supplies it is
  // testing its own fixture.
  delete clean.COMMIT_REF_MESSAGE
  delete clean.PREVIEW_GATE_MESSAGE
  delete clean.BRANCH
  delete clean.HEAD
  delete clean.CONTEXT
  delete clean.COMMIT_REF

  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete clean[k]
    else clean[k] = v
  }

  const r = spawnSync(process.execPath, [SCRIPT], { env: clean, cwd, encoding: 'utf8' })
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
}

describe('the preview gate reads the message from git, not from a variable', () => {
  it('builds a branch whose HEAD commit carries the marker', () => {
    /*
     * The exact case that was cancelled three times. No message is injected:
     * the script must find `[preview]` by asking git about the checked-out
     * commit, which is what Netlify's runner has.
     */
    const { code, out } = gate({
      BRANCH: 'release/dashboard-convergence',
      CONTEXT: 'branch-deploy',
      COMMIT_REF: 'HEAD',
    })
    expect(out).toMatch(/asked for a preview/)
    expect(code, 'non-zero means CONTINUE BUILD').not.toBe(SKIP)
    expect(BUILD_IS_NONZERO).toBe(true)
  })

  it('skips an ordinary commit on the same branch', () => {
    // A commit that predates the markers, addressed by SHA.
    const { code } = gate({
      BRANCH: 'release/dashboard-convergence',
      CONTEXT: 'branch-deploy',
      COMMIT_REF: 'fc896a3466fba854e8dec0f5f2edae7b1992766f',
    })
    expect(code, 'zero means SKIP').toBe(SKIP)
  })

  it('accepts the marker in any case', () => {
    const { code } = gate({
      BRANCH: 'release/x',
      CONTEXT: 'branch-deploy',
      PREVIEW_GATE_MESSAGE: 'Ship it [PREVIEW] please',
    })
    expect(code).not.toBe(SKIP)
  })

  it('falls back to HEAD when COMMIT_REF is not in a shallow clone', () => {
    const { code } = gate({
      BRANCH: 'release/dashboard-convergence',
      CONTEXT: 'branch-deploy',
      COMMIT_REF: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
    })
    expect(code).not.toBe(SKIP)
  })
})

describe('production and main never depend on git', () => {
  it('builds main without a marker', () => {
    const { code } = gate({ BRANCH: 'main', CONTEXT: 'branch-deploy' })
    expect(code).not.toBe(SKIP)
  })

  it('builds the production context without a marker', () => {
    const { code } = gate({ BRANCH: 'anything', CONTEXT: 'production' })
    expect(code).not.toBe(SKIP)
  })

  it('builds main even where git cannot be read at all', () => {
    // Decided before the message is read, so a broken checkout cannot stop
    // production from deploying.
    const { code } = gate({ BRANCH: 'main', CONTEXT: 'branch-deploy' }, tmpdir())
    expect(code).not.toBe(SKIP)
  })
})

describe('an unreadable message fails closed', () => {
  it('skips rather than builds when git answers nothing', () => {
    /*
     * The direction matters. A gate that built on error would restore the
     * every-branch-builds behaviour it exists to prevent, and would do it
     * invisibly — the deploys would simply come back.
     */
    const { code, out } = gate({
      BRANCH: 'release/dashboard-convergence',
      CONTEXT: 'branch-deploy',
      COMMIT_REF: 'HEAD',
    }, tmpdir())
    expect(out).toMatch(/could not read the commit message/)
    expect(code, 'must SKIP, never build blind').toBe(SKIP)
  })
})

/** A directory that is not a git repository. */
function tmpdir(): string {
  const os = require('node:os')
  const fs = require('node:fs')
  const p = join(os.tmpdir(), 'preview-gate-nogit')
  fs.mkdirSync(p, { recursive: true })
  return p
}
