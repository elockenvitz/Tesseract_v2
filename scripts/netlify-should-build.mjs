#!/usr/bin/env node
/**
 * Decide whether Netlify should build this commit at all.
 *
 * ── Netlify's convention, which is backwards from every other tool ────────
 *
 * Exit 0 means SKIP. Exit non-zero means BUILD. That is the opposite of a
 * test runner and the opposite of every guard in this repo, and getting it
 * inverted means either no deploys or no savings — so this file states it
 * once, loudly, and nothing else has to remember.
 *
 * ── Why skip at all ───────────────────────────────────────────────────────
 *
 * Every push to every branch was producing a deploy preview, and the build
 * command here runs the unit guard, the TDZ guard and a Vite build of an 8MB
 * bundle with a 7GB heap. That is minutes of build time to look at a card on a
 * phone — and looking at a card on a phone does not need a deploy: `npm run
 * dev:mobile` serves the real app, with real data, over the LAN, with hot
 * reload and no build at all.
 *
 * So previews become opt-in rather than automatic. `main` always builds,
 * because that is what the world sees.
 *
 * ── The escape hatch ──────────────────────────────────────────────────────
 *
 * Sometimes a preview URL is the point: sharing with somebody not on your
 * network, checking a real HTTPS origin, testing a device you cannot put on
 * the Wi-Fi. Putting `[preview]` anywhere in the commit message opts that
 * commit in.
 *
 * A marker in the commit message rather than a branch-name convention,
 * because the decision is per-commit — you want the preview for the one you
 * are about to share, not for every commit on a branch that happens to be
 * named a certain way.
 *
 * ── Where the message comes from, and the bug that taught us ──────────────
 *
 * This used to read `process.env.COMMIT_REF_MESSAGE`. **Netlify does not set
 * that variable.** It sets `COMMIT_REF` (the SHA), `BRANCH`, `HEAD`, `CONTEXT`
 * and `CACHED_COMMIT_REF` — but never the message. So the marker test ran
 * against the empty string on every build, `[preview]` could never match, and
 * the escape hatch had never once worked.
 *
 * It looked like it worked, because it was only ever exercised by setting that
 * same invented variable by hand. Three commits carrying `[preview]` were
 * pushed and cancelled before the Netlify log showed the script skipping a
 * commit whose message plainly contained the marker.
 *
 * The message is therefore read from git, which is the thing that actually
 * knows it. `COMMIT_REF` first — that is the commit Netlify says it is
 * building — then `HEAD`, which is what is checked out. Netlify's clone is
 * shallow, but the commit being built is always present in it, so one
 * `git log -1` on either ref resolves.
 *
 * If the message cannot be read at all, this FAILS CLOSED: skip. A gate that
 * defaults to building on error would quietly restore the every-branch-builds
 * behaviour this file exists to prevent, and would do it invisibly.
 */

import { execFileSync } from 'node:child_process'

const BUILD = 1
const SKIP = 0

const branch = process.env.BRANCH ?? process.env.HEAD ?? ''
const context = process.env.CONTEXT ?? ''

/**
 * Production always builds. `CONTEXT` is Netlify's own word for it and covers
 * the case where the production branch is renamed — keying only on the literal
 * string "main" would silently stop deploying if it ever were.
 *
 * Decided before the message is read, so production and main never depend on
 * git being readable.
 */
if (context === 'production' || branch === 'main') {
  console.log(`netlify: building — ${context || 'branch'} ${branch || context}`)
  process.exit(BUILD)
}

/**
 * The message of the commit being built, or null if it cannot be determined.
 *
 * `PREVIEW_GATE_MESSAGE` is a test seam, not a Netlify variable — it exists so
 * the suite can drive this without fabricating commits. It is deliberately NOT
 * named after anything Netlify sets, so nobody mistakes it for one again.
 */
function commitMessage() {
  const injected = process.env.PREVIEW_GATE_MESSAGE
  if (injected) return injected

  for (const ref of [process.env.COMMIT_REF, 'HEAD']) {
    if (!ref) continue
    try {
      // Trailing `--` so a ref that looks like a path cannot be read as one.
      const out = execFileSync('git', ['log', '-1', '--pretty=%B', ref, '--'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      if (out.trim()) return out
    } catch {
      // Shallow clone may not carry COMMIT_REF; fall through to HEAD.
    }
  }
  return null
}

const message = commitMessage()

if (message === null) {
  console.log(
    `netlify: skipping build for "${branch}" — could not read the commit message.\n` +
    '  Neither COMMIT_REF nor HEAD resolved through git. Failing closed: a gate\n' +
    '  that built on error would silently restore every-branch-builds.',
  )
  process.exit(SKIP)
}

if (/\[preview\]/i.test(message)) {
  console.log('netlify: building — commit message asked for a preview')
  process.exit(BUILD)
}

console.log(
  `netlify: skipping build for "${branch}".\n` +
  '  Use `npm run dev:mobile` to see this on a phone — real data, hot reload, no build.\n' +
  '  Add [preview] to a commit message when you genuinely need a deploy URL.',
)
process.exit(SKIP)
