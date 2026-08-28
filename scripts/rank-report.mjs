#!/usr/bin/env node
/**
 * Capture an Ideas candidate snapshot and replay every ranker against it.
 *
 * ── Commands ──────────────────────────────────────────────────────────────
 *
 *   node scripts/rank-report.mjs --fixture --out artifacts/ranking/before.json
 *       Deterministic. No network, no credentials, byte-identical between runs.
 *
 *   node scripts/rank-report.mjs --staging --out <path>
 *       Real workspace. Reads the workspace URL and anon key from the ROOT
 *       environment IN PLACE — nothing is copied into this worktree — and signs
 *       in with credentials taken from your shell at run time:
 *
 *         export TESSERACT_STAGING_EMAIL=...
 *         export TESSERACT_STAGING_PASSWORD=...
 *         node scripts/rank-report.mjs --staging --out artifacts/ranking/staging-before.json
 *
 *       The credentials are used once for a sign-in and never stored, printed,
 *       or written to the snapshot. Author ids are replaced with `author-N`, so
 *       the artifact carries no personal identifier and is safe to commit.
 *
 *   node scripts/rank-report.mjs --replay <snapshot.json>
 *       Re-run the rankers over a snapshot captured earlier. This is what makes
 *       a before/after honest: both engines see the SAME candidate set.
 *
 * Flags: --engines legacy|canonical|all (default all) · --top N (default 20)
 *
 * TypeScript is bundled with esbuild, which is already a dependency, so the
 * harness shares the application's own modules instead of restating them.
 */

import { build } from 'esbuild'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadEnv } from 'vite'

const ROOT = process.cwd()
const args = process.argv.slice(2)
const has = (f) => args.includes(f)
const valueOf = (f, d) => {
  const i = args.indexOf(f)
  return i >= 0 && args[i + 1] ? args[i + 1] : d
}

const mode = has('--staging') ? 'staging' : has('--replay') ? 'replay' : 'fixture'
const engines = valueOf('--engines', 'all')
const top = Number(valueOf('--top', '20'))
const out = valueOf('--out', null)

/**
 * The root environment, read where it lives.
 *
 * `envDir` points at the main checkout so the worktree needs no `.env.local` of
 * its own. Only the two client values are lifted into this process, and only
 * for the Supabase client to consume — neither is printed anywhere.
 */
if (mode === 'staging') {
  const envDir = valueOf('--env-dir', 'C:/dev/Tesseract_v2')
  const env = loadEnv('development', envDir, 'VITE_')
  if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY) {
    console.error(`No VITE_SUPABASE_* values found in ${envDir}. Pass --env-dir <path>.`)
    process.exit(1)
  }
  process.env.VITE_SUPABASE_URL = env.VITE_SUPABASE_URL
  process.env.VITE_SUPABASE_ANON_KEY = env.VITE_SUPABASE_ANON_KEY
}

const entry = resolve(ROOT, 'src/lib/ideas/rank-snapshot/run.ts')
/**
 * Bundled inside the project, not into a temp directory.
 *
 * The bundle keeps `@supabase/supabase-js` and friends external so they come
 * from the project's own install rather than being inlined — which means node
 * has to resolve them relative to a path inside the project. A tmpdir bundle
 * fails with ERR_MODULE_NOT_FOUND for exactly that reason.
 */
const bundleDir = resolve(ROOT, 'node_modules/.cache/tesseract')
mkdirSync(bundleDir, { recursive: true })
const bundle = resolve(bundleDir, `rank-report-${process.pid}.mjs`)

await build({
  entryPoints: [entry],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  // Resolved by node from the project's own install rather than inlined.
  external: ['@supabase/supabase-js', 'vite', 'date-fns'],
  logLevel: 'warning',
})

const { run } = await import(pathToFileURL(bundle).href)
rmSync(bundle, { force: true })

const result = await run({
  mode,
  engines,
  top,
  replayPath: mode === 'replay' ? resolve(ROOT, valueOf('--replay', '')) : null,
  label: valueOf('--label', mode === 'staging' ? 'staging capture' : 'deterministic fixture'),
})

console.log(result.text)

if (out) {
  const path = resolve(ROOT, out)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(result.artifact, null, 2) + '\n', 'utf8')
  console.log(`\nwrote ${out}`)
}
