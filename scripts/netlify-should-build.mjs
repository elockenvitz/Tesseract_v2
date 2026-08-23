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
 */

const BUILD = 1
const SKIP = 0

const branch = process.env.BRANCH ?? process.env.HEAD ?? ''
const message = process.env.COMMIT_REF_MESSAGE ?? ''
const context = process.env.CONTEXT ?? ''

/**
 * Production always builds. `CONTEXT` is Netlify's own word for it and covers
 * the case where the production branch is renamed — keying only on the literal
 * string "main" would silently stop deploying if it ever were.
 */
if (context === 'production' || branch === 'main') {
  console.log(`netlify: building — ${context || 'branch'} ${branch || context}`)
  process.exit(BUILD)
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
