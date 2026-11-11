#!/usr/bin/env node
/**
 * Keep the committed policy inventory fresh, automatically, at the one moment it
 * matters: just before a push reaches CI.
 *
 * THE PROBLEM THIS SOLVES
 *
 *   `security:check --static` is a required check, and the policy guard refuses
 *   to speak for production from a capture older than MAX_INVENTORY_AGE_DAYS (7).
 *   So roughly a week after every recapture, `static` turns red at exit 3
 *   (UNVERIFIED) on every open PR, for no reason connected to the PR. The fix is
 *   to recapture, and the failure mode is forgetting to.
 *
 *   The obvious automation -- a scheduled GitHub workflow -- would need a
 *   Supabase Management API token in GitHub Actions. Those tokens are
 *   account-wide, not project-scoped, and `read_only: true` is a per-request
 *   flag rather than a token scope, so that secret would be a full production
 *   write credential living in CI. Not worth it for a 30-second local command.
 *
 * WHEN THIS RUNS
 *
 *   Only when it would change something:
 *     1. the push contains a commit touching supabase/migrations/, or
 *     2. the committed capture is older than RECAPTURE_AT_DAYS.
 *   Otherwise it exits 0 immediately and the push is not slowed down.
 *
 * WHAT IT DOES NOT DO
 *
 *   It does not commit for you, and it is not the enforcement. The enforcement is
 *   the guard's own freshness gate in CI, which is why this hook is allowed to
 *   bail out quietly when the Supabase token is not available (a push must still
 *   be possible offline). The hook is the convenience that stops the gate from
 *   surprising you; it is not a substitute for it.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Recapture with two days of head-room before the guard's 7-day limit, so a push
// never ships a capture that expires mid-review.
const RECAPTURE_AT_DAYS = 5
const INVENTORY = 'docs/audit/baselines/ci-policy-inventory.json'
const CAPTURE = ['scripts/audit/schema-baseline.mjs', '--ci-minimal']

const EXIT = { OK: 0, BLOCKED: 1 }

const repoRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const git = (...args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })

/** Age of the committed capture in days, or null if it cannot be read. */
function captureAgeDays() {
  try {
    const raw = JSON.parse(readFileSync(resolve(repoRoot, INVENTORY), 'utf8')).captured_at
    const t = Date.parse(raw)
    return Number.isFinite(t) ? (Date.now() - t) / 86_400_000 : null
  } catch {
    return null
  }
}

/**
 * Does this push carry a migration?
 *
 * git hands a pre-push hook one line per ref on stdin:
 *   <local ref> <local sha> <remote ref> <remote sha>
 * A remote sha of all zeros means the branch is new, so there is no remote side
 * to diff against; fall back to the merge-base with origin/main.
 */
function pushTouchesMigrations(stdin) {
  const ZERO = /^0+$/
  for (const line of stdin.split('\n').filter(Boolean)) {
    const [, localSha, , remoteSha] = line.split(/\s+/)
    if (!localSha || ZERO.test(localSha)) continue // a deletion; nothing to inspect
    let base = remoteSha
    if (!base || ZERO.test(base)) {
      try {
        base = git('merge-base', localSha, 'origin/main').trim()
      } catch {
        continue // no common base to compare against; let CI speak
      }
    }
    try {
      const changed = git('diff', '--name-only', `${base}..${localSha}`)
      if (/^supabase\/migrations\//m.test(changed)) return true
    } catch {
      // A missing object on either side is not a reason to block a push.
    }
  }
  return false
}

const stdin = (() => {
  try {
    return readFileSync(0, 'utf8')
  } catch {
    return ''
  }
})()

const ageDays = captureAgeDays()
const stale = ageDays === null || ageDays > RECAPTURE_AT_DAYS
const migrations = pushTouchesMigrations(stdin)

if (!stale && !migrations) process.exit(EXIT.OK)

const because = migrations
  ? 'this push contains a migration'
  : `the committed capture is ${ageDays === null ? 'unreadable' : `${ageDays.toFixed(1)} days old`} (recapture at ${RECAPTURE_AT_DAYS})`

console.error(`\n[inventory] recapturing the policy inventory: ${because}.`)

const run = spawnSync('node', CAPTURE, { cwd: repoRoot, encoding: 'utf8' })
if (run.status !== 0) {
  // No token, no network, paused project: all of these are reasons to let the
  // push through and let the CI gate be the one that says no.
  console.error('[inventory] could not recapture, so this push is NOT blocked.')
  console.error('[inventory] CI will report UNVERIFIED if the capture is too stale to stand for production.')
  if (run.stderr) console.error(run.stderr.trim().split('\n').slice(-3).join('\n'))
  process.exit(EXIT.OK)
}

const dirty = git('status', '--porcelain', '--', INVENTORY).trim()
if (!dirty) {
  console.error('[inventory] capture is unchanged and now current. Pushing.\n')
  process.exit(EXIT.OK)
}

/**
 * Did anything but the clock change?
 *
 * A recapture always rewrites `captured_at`, so a bare "the file changed" test
 * reports every single run as a policy change. The timestamp still has to be
 * committed -- it is what the guard's freshness gate reads -- but the reason to
 * commit it is completely different, and saying "production policies have moved"
 * when they have not is how a useful warning becomes noise to click through.
 */
function contentChangedBeyondTimestamp() {
  const strip = (text) => {
    const j = JSON.parse(text)
    delete j.captured_at
    return JSON.stringify(j)
  }
  try {
    return strip(git('show', `HEAD:${INVENTORY}`)) !== strip(readFileSync(resolve(repoRoot, INVENTORY), 'utf8'))
  } catch {
    return true // cannot tell: report the louder of the two
  }
}

const commit = `
      git add ${INVENTORY}
      git commit -m "chore(sec): recapture the policy inventory"
`

if (!contentChangedBeyondTimestamp()) {
  /*
   * A migration triggered the recapture, the capture turned out to be accurate,
   * and it is not close to expiring. There is nothing to commit.
   *
   * Blocking here was a deadlock. A push carrying a migration recaptures every
   * attempt; a recapture always rewrites `captured_at`; so the tree was dirty
   * again the instant the previous timestamp was committed, and the next push
   * blocked on the next timestamp. Observed live on 2026-11-11: two commits of
   * nothing but `captured_at`, 33 seconds apart, and the push still refused.
   *
   * The migration trigger exists to CHECK whether production moved, not to
   * force a timestamp bump. The check just passed, so restore the committed
   * file and let the push through. The staleness trigger below still blocks,
   * because there the new timestamp is the whole point.
   */
  if (migrations && !stale) {
    git('checkout', '--', INVENTORY)
    console.error('[inventory] migration pushed; production policies are unchanged and the capture is current. Pushing.\n')
    process.exit(EXIT.OK)
  }

  console.error(`
[inventory] PUSH BLOCKED -- the capture was still accurate, but about to expire.

  Nothing in production moved: only \`captured_at\` changed. The guard reads that
  timestamp and refuses a capture older than 7 days, so the refreshed one has to
  be committed or the required \`static\` check turns red mid-review.
${commit}`)
  process.exit(EXIT.BLOCKED)
}

console.error(`
[inventory] PUSH BLOCKED -- production policies have moved since the last capture.

  ${INVENTORY} was just rewritten, and the change is more than the timestamp. The
  static security gate reads this file, so pushing without it means the gate
  speaks for a database that no longer exists.

  Read the diff before committing -- a policy or grant changed in production, and
  if that is a surprise, THAT is the finding:

      git diff -- ${INVENTORY}
${commit}`)
process.exit(EXIT.BLOCKED)
