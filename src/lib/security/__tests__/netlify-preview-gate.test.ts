import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * The deploy gate's exit semantics, pinned against a repository this test owns.
 *
 * ── Two bugs, and the second one was in here ──────────────────────────────
 *
 * `netlify-should-build.mjs` read `process.env.COMMIT_REF_MESSAGE` to find the
 * `[preview]` marker. Netlify does not set that variable — it sets
 * `COMMIT_REF`, `BRANCH`, `HEAD` and `CONTEXT`, never the message — so the
 * marker test ran against the empty string on every build and the escape hatch
 * had never once worked. That is fixed: the message now comes from git.
 *
 * The first version of THESE tests then made the mirror-image mistake. They
 * passed `COMMIT_REF: 'HEAD'` and relied on the Tesseract repository's own HEAD
 * happening to carry `[preview]`, which it did on the release branch. On a pull
 * request GitHub checks out a synthetic merge commit — "Merge <head> into
 * <base>" — which carries no marker, and `actions/checkout@v4` defaults to
 * `fetch-depth: 1`, so that merge commit is the only one present. Two
 * assertions expecting BUILD got SKIP and the required check went red.
 *
 * A test whose result depends on the message of whatever commit happens to be
 * checked out is not testing the gate; it is testing the branch it runs on. So
 * the git integration is exercised against a throwaway repository built here,
 * with commit messages this file decides. Nothing below reads the outer
 * repository.
 *
 * ── Exit semantics, which are inverted from everything else ───────────────
 *
 *   exit 0        = SKIP the build
 *   exit non-zero = CONTINUE the build
 */

const SCRIPT = join(process.cwd(), 'scripts', 'netlify-should-build.mjs')
const SKIP = 0

/** A repository with two known commits, built once for the whole suite. */
let repo: string
let markerSha: string
let plainSha: string

/** Deterministic git: fixed identity, no signing. */
function git(cwd: string, ...args: string[]): string {
  const r = spawnSync('git', [
    '-c', 'user.email=gate@test.invalid',
    '-c', 'user.name=Gate Test',
    '-c', 'commit.gpgsign=false',
    ...args,
  ], { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`)
  return r.stdout.trim()
}

/** A fresh repository whose single commit carries `message`. */
function repoWithMessage(prefix: string, message: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix))
  git(dir, 'init', '--quiet')
  writeFileSync(join(dir, 'file.txt'), 'content')
  git(dir, 'add', 'file.txt')
  git(dir, 'commit', '--quiet', '-m', message)
  return dir
}

/** A directory that is deliberately not a git repository. */
function nonRepo(): string {
  return mkdtempSync(join(tmpdir(), 'preview-gate-nogit-'))
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'preview-gate-'))
  git(repo, 'init', '--quiet')

  writeFileSync(join(repo, 'a.txt'), 'one')
  git(repo, 'add', 'a.txt')
  git(repo, 'commit', '--quiet', '-m', 'An ordinary commit with no marker')
  plainSha = git(repo, 'rev-parse', 'HEAD')

  writeFileSync(join(repo, 'b.txt'), 'two')
  git(repo, 'add', 'b.txt')
  git(repo, 'commit', '--quiet', '-m', 'Ship the release candidate [preview]')
  markerSha = git(repo, 'rev-parse', 'HEAD')
})

afterAll(() => {
  if (repo) rmSync(repo, { recursive: true, force: true })
})

/**
 * Run the real script with a Netlify-shaped environment, in a chosen cwd.
 *
 * `COMMIT_REF_MESSAGE` is deleted always: a test that supplied the variable
 * whose absence caused the original bug would be testing its own fixture.
 */
function gate(env: Record<string, string | undefined>, cwd: string) {
  const clean: Record<string, string | undefined> = { ...process.env }
  for (const k of ['COMMIT_REF_MESSAGE', 'PREVIEW_GATE_MESSAGE', 'BRANCH', 'HEAD', 'CONTEXT', 'COMMIT_REF']) {
    delete clean[k]
  }
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete clean[k]
    else clean[k] = v
  }
  const r = spawnSync(process.execPath, [SCRIPT], {
    env: clean as NodeJS.ProcessEnv,
    cwd,
    encoding: 'utf8',
  })
  return { code: r.status ?? -1, out: `${r.stdout}${r.stderr}` }
}

describe('the marker is read from git, in a repository this test controls', () => {
  it('builds when COMMIT_REF names a commit carrying the marker', () => {
    // The real integration: no injected message, a real SHA, a real git read.
    const { code, out } = gate(
      { BRANCH: 'release/fixture', CONTEXT: 'branch-deploy', COMMIT_REF: markerSha },
      repo,
    )
    expect(out).toMatch(/asked for a preview/)
    expect(code, 'non-zero means CONTINUE BUILD').not.toBe(SKIP)
  })

  it('skips when COMMIT_REF names an ordinary commit', () => {
    const { code } = gate(
      { BRANCH: 'release/fixture', CONTEXT: 'branch-deploy', COMMIT_REF: plainSha },
      repo,
    )
    expect(code, 'zero means SKIP').toBe(SKIP)
  })

  it('falls back to HEAD when COMMIT_REF is absent from a shallow clone', () => {
    /*
     * Netlify clones shallow. If the SHA it names is not in the pack, the gate
     * must still find the checked-out commit — here HEAD is the marker commit.
     */
    const { code } = gate(
      {
        BRANCH: 'release/fixture',
        CONTEXT: 'branch-deploy',
        COMMIT_REF: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      },
      repo,
    )
    expect(code).not.toBe(SKIP)
  })

  it('reads HEAD when Netlify names no commit at all', () => {
    const { code } = gate({ BRANCH: 'release/fixture', CONTEXT: 'branch-deploy' }, repo)
    expect(code).not.toBe(SKIP)
  })

  it('does not depend on the repository running the suite', () => {
    /*
     * The regression this file exists for. The outer repository's HEAD is
     * whatever CI checked out — on a pull request, a synthetic merge commit
     * with no marker. Every assertion here must be unaffected by it.
     */
    expect(markerSha).not.toEqual(plainSha)
    const { code } = gate(
      { BRANCH: 'release/fixture', CONTEXT: 'branch-deploy', COMMIT_REF: plainSha },
      repo,
    )
    expect(code).toBe(SKIP)
  })
})

describe('the marker is case-insensitive', () => {
  it('accepts [PREVIEW] through the explicit test seam', () => {
    const { code } = gate(
      { BRANCH: 'release/x', CONTEXT: 'branch-deploy', PREVIEW_GATE_MESSAGE: 'Ship it [PREVIEW] please' },
      repo,
    )
    expect(code).not.toBe(SKIP)
  })

  it('accepts a mixed-case marker committed for real', () => {
    // Through git, not the seam, so the case rule is proven on the real path.
    const dir = repoWithMessage('preview-gate-case-', 'Mixed [PrEvIeW] marker')
    try {
      const { code } = gate({ BRANCH: 'release/case', CONTEXT: 'branch-deploy' }, dir)
      expect(code).not.toBe(SKIP)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('production and main never depend on git', () => {
  it('builds main without a marker', () => {
    const { code } = gate({ BRANCH: 'main', CONTEXT: 'branch-deploy' }, repo)
    expect(code).not.toBe(SKIP)
  })

  it('builds the production context without a marker', () => {
    const { code } = gate({ BRANCH: 'anything', CONTEXT: 'production' }, repo)
    expect(code).not.toBe(SKIP)
  })

  it('builds main even where git cannot be read at all', () => {
    const dir = nonRepo()
    try {
      const { code } = gate({ BRANCH: 'main', CONTEXT: 'branch-deploy' }, dir)
      expect(code).not.toBe(SKIP)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('an unreadable message fails closed', () => {
  it('skips rather than builds when git answers nothing', () => {
    /*
     * Direction matters. A gate that built on error would restore the
     * every-branch-builds behaviour it exists to prevent, invisibly: the
     * deploys would simply come back.
     */
    const dir = nonRepo()
    try {
      const { code, out } = gate(
        { BRANCH: 'release/fixture', CONTEXT: 'branch-deploy', COMMIT_REF: 'HEAD' },
        dir,
      )
      expect(out).toMatch(/could not read the commit message/)
      expect(code, 'must SKIP, never build blind').toBe(SKIP)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
