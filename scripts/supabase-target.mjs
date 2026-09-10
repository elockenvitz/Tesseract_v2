#!/usr/bin/env node
/**
 * Deploy one Supabase edge function to one NAMED project.
 *
 * ── The failure this exists to stop ───────────────────────────────────────
 *
 * `supabase functions deploy market-news` — no project flag — is valid, and it
 * targets whatever `supabase link` last wrote into `supabase/.temp`. In this
 * repository that is PRODUCTION, while this worktree's `.env.local` points at
 * staging. So the shortest command is the one that silently ships to prod, the
 * target is invisible at the call site, and the two halves of the environment
 * disagree about which project you are working on.
 *
 * Nothing here makes the ref harder to mistype. It removes the version of the
 * command that has no ref at all.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *     npm run deploy:fn:prod    -- market-news
 *     npm run deploy:fn:staging -- market-news
 *
 * Anything after the function name is passed to the CLI untouched.
 *
 * ── What this deliberately is NOT ─────────────────────────────────────────
 *
 * Not a deployment framework. No config file, no environment discovery, no
 * migration or secret handling, no flag policing. Two refs and one required
 * argument. It refuses; it does not manage.
 *
 * In particular it does NOT vet the CLI flags it passes through. `--no-verify-jwt`
 * would flip a function from authenticated to public, and this will forward it
 * without comment — that is a different guard, and bundling it here would make
 * this one harder to reason about.
 *
 * ── Secrets ───────────────────────────────────────────────────────────────
 *
 * Reads none and prints none. The CLI needs SUPABASE_ACCESS_TOKEN (or a prior
 * `supabase login`); the child inherits the environment and this script never
 * reads that variable, so it cannot echo it.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * The only two projects that exist.
 *
 * Written here rather than read from `supabase/.temp/linked-project.json`,
 * which is generated, gitignored, and holds exactly one ref — so it can tell
 * you what you are linked to and can never tell you it is the wrong one.
 * A checked-in map is reviewable in a diff.
 */
export const TARGETS = Object.freeze({
  prod: 'wfcebeagznzgeuyysbnt',
  staging: 'pdajkwtrrjcqnjsyvyqt',
})

/** Slug rules the Supabase CLI itself accepts. Checked so a typo fails here. */
const FUNCTION_SLUG = /^[a-z0-9][a-z0-9-]*$/

/**
 * Resolve argv into a deploy, or into a refusal.
 *
 * Pure, and exported, so the refusals can be tested without spawning anything.
 * Every failure returns a reason rather than throwing: the caller prints it and
 * exits, and a test can assert on it.
 */
export function resolveDeploy(argv, { root = ROOT, exists = existsSync } = {}) {
  const [env, fn, ...rest] = argv

  // No default. An absent environment is the exact case this script exists for,
  // so it is a refusal and never a fallback to prod, staging, or the link.
  if (!env) {
    return { ok: false, error: `No environment given. Expected one of: ${Object.keys(TARGETS).join(', ')}.` }
  }
  if (!Object.prototype.hasOwnProperty.call(TARGETS, env)) {
    return { ok: false, error: `Unknown environment "${env}". Expected one of: ${Object.keys(TARGETS).join(', ')}.` }
  }

  if (!fn) {
    return { ok: false, error: `No function name given. Pass it explicitly, e.g. \`npm run deploy:fn:${env} -- market-news\`.` }
  }
  if (!FUNCTION_SLUG.test(fn)) {
    return { ok: false, error: `"${fn}" is not a function slug. Expected lowercase letters, digits and hyphens.` }
  }

  // On disk, so a renamed or misspelled function fails before the CLI is
  // reached and before anything is uploaded.
  const entry = path.join(root, 'supabase', 'functions', fn, 'index.ts')
  if (!exists(entry)) {
    return { ok: false, error: `No such function: supabase/functions/${fn}/index.ts does not exist.` }
  }

  return {
    ok: true,
    env,
    fn,
    ref: TARGETS[env],
    args: ['functions', 'deploy', fn, '--project-ref', TARGETS[env], ...rest],
  }
}

// Entry point. Skipped when imported by a test.
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const plan = resolveDeploy(process.argv.slice(2))

  if (!plan.ok) {
    console.error(`REFUSED: ${plan.error}`)
    console.error('')
    console.error('  npm run deploy:fn:prod    -- <function>')
    console.error('  npm run deploy:fn:staging -- <function>')
    process.exit(1)
  }

  console.log(`environment : ${plan.env}`)
  console.log(`project ref : ${plan.ref}`)
  console.log(`function    : ${plan.fn}`)
  console.log(`running     : supabase ${plan.args.join(' ')}`)
  console.log('')

  const child = spawnSync('supabase', plan.args, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })

  if (child.error) {
    console.error(`FAILED to start the Supabase CLI: ${child.error.message}`)
    process.exit(1)
  }
  process.exit(child.status ?? 1)
}
