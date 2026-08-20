#!/usr/bin/env node
/**
 * Build the gallery, then run targeted phone Playwright tests against it.
 *
 * ── Why this is a script and not two commands in a doc ────────────────────
 *
 * The phone project serves the BUILT `dist-gallery`, not the source tree. So a
 * targeted run after a source edit tests the previous bundle unless the gallery
 * is rebuilt first. That has already cost real debugging time: a probe reported
 * a card at 1155px when the source said 836, and the flex chain got investigated
 * for a while before the stale bundle turned out to be the whole story.
 *
 * Making the rebuild part of the command means it cannot be forgotten. The
 * safeguard is the point; `--no-build` exists for the case where you have just
 * built and are only changing the spec, and it says what it is doing.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   npm run test:phone -- e2e/explore.spec.ts
 *   npm run test:phone -- e2e/explore.spec.ts -g "320px"
 *   npm run test:phone -- e2e/signal-cards.spec.ts -g "no card clips"
 *   npm run test:phone -- --no-build e2e/explore.spec.ts
 *
 * Everything after `--` is passed through to Playwright, so any targeting it
 * supports works. Nothing is hardcoded to one spec.
 */
import { spawnSync } from 'node:child_process'

const argv = process.argv.slice(2)
const noBuild = argv.includes('--no-build')
const passthrough = argv.filter((a) => a !== '--no-build')

const sh = (cmd, args) => spawnSync(cmd, args, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (!noBuild) {
  console.log('› building gallery (skip with --no-build)')
  const built = sh('npx', ['vite', 'build', '--config', 'vite.gallery.config.ts'])
  if (built.status !== 0) process.exit(built.status ?? 1)
} else {
  console.log('› --no-build: testing the EXISTING dist-gallery, which may be stale')
}

// `--project=phone` always, because that is the only project and the viewport
// the assertions are written against. Passing another would silently measure a
// different geometry.
const run = sh('npx', ['playwright', 'test', '--project=phone', ...passthrough])
process.exit(run.status ?? 1)
