#!/usr/bin/env node
/**
 * Edge Function authorization guard (CLAUDE.md Standing Rule 6).
 *
 * Enforces a PROCESS, not a naming heuristic: every function under
 * supabase/functions/ must be declared in authz-registry.json, the registry's
 * service_role flag must match the source, and any service_role function must
 * have been explicitly reviewed (reviewed:true + an authClass). User-reachable
 * privileged classes (platform-admin, user-jwt) additionally require a runtime
 * authorization test that (a) exists, (b) contains executable it()/expect()
 * assertions — not an empty placeholder — and (c) lives in the vitest unit
 * scope so `npm test` actually runs it. The static check complements the runtime
 * test; it does not replace it, and it does not accept an imported auth helper
 * as proof.
 *
 * Practical, not a full analyzer: it flags unrecognized Supabase client
 * constructions for human review rather than trying to prove their safety.
 * Decision core (evaluateAuthz) is pure and unit-tested from vitest.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FUNCTIONS_DIR = join(ROOT, 'supabase', 'functions')
const REGISTRY = join(FUNCTIONS_DIR, 'authz-registry.json')

/** Classes whose exploitability makes a runtime authorization test mandatory. */
export const TEST_REQUIRED_CLASSES = new Set(['platform-admin', 'user-jwt'])
/** Service-role classes where a test is recommended but not blocking. */
export const TEST_RECOMMENDED_CLASSES = new Set(['api-key', 'cron-secret', 'webhook'])

/**
 * Pure decision core.
 * @param {{name:string, usesServiceRole:boolean, unrecognizedClient?:boolean}[]} functions
 * @param {Record<string, any>} registry  authz-registry.json `functions` map
 * @param {(p:string)=>{exists:boolean, executable:boolean, inCiScope:boolean}} testEvidence
 * @returns {{errors:string[], warnings:string[]}}
 */
export function evaluateAuthz(functions, registry, testEvidence) {
  const errors = []
  const warnings = []

  for (const fn of functions) {
    const entry = registry[fn.name]
    if (!entry) {
      errors.push(
        `${fn.name}: not in authz-registry.json. ` +
        (fn.usesServiceRole
          ? 'A new service_role function must be reviewed and registered (Rule 6) before merge.'
          : 'Register it (serviceRole:false + authClass) so authorization is reviewed.')
      )
      continue
    }
    if (entry.serviceRole !== fn.usesServiceRole) {
      errors.push(
        `${fn.name}: registry serviceRole=${entry.serviceRole} but source ${fn.usesServiceRole ? 'DOES' : 'does NOT'} construct a service_role client. Fix the registry (and re-review).`
      )
    }
    if (fn.unrecognizedClient && !fn.usesServiceRole) {
      warnings.push(`${fn.name}: constructs a Supabase client with an unrecognized key source — confirm how it authorizes (not the publishable key + forwarded JWT pattern).`)
    }
    if (fn.usesServiceRole) {
      if (!entry.reviewed || !entry.authClass) {
        errors.push(
          `${fn.name}: service_role function pending authorization review (reviewed:${!!entry.reviewed}, authClass:${entry.authClass ?? 'null'}). Review it, set an authClass, and add a regression test.`
        )
        continue
      }
      const ev = entry.test ? testEvidence(entry.test) : { exists: false, executable: false, inCiScope: false }
      const testOk = ev.exists && ev.executable && ev.inCiScope
      if (TEST_REQUIRED_CLASSES.has(entry.authClass)) {
        if (!entry.test) errors.push(`${fn.name}: authClass '${entry.authClass}' requires a runtime authorization test but none is referenced.`)
        else if (!ev.exists) errors.push(`${fn.name}: referenced test '${entry.test}' does not exist.`)
        else if (!ev.executable) errors.push(`${fn.name}: referenced test '${entry.test}' has no executable it()/test() + expect() — empty placeholder does not satisfy the gate.`)
        else if (!ev.inCiScope) errors.push(`${fn.name}: referenced test '${entry.test}' is not under src/**/*.test.ts, so 'npm test' will not run it.`)
      } else if (TEST_RECOMMENDED_CLASSES.has(entry.authClass) && !testOk) {
        warnings.push(`${fn.name}: authClass '${entry.authClass}' — a runtime regression test is recommended (follow-up).`)
      }
    }
  }

  for (const name of Object.keys(registry)) {
    if (name.startsWith('$')) continue
    if (!functions.some((f) => f.name === name)) {
      warnings.push(`${name}: in registry but no supabase/functions/${name}/ on disk (stale entry?).`)
    }
  }
  return { errors, warnings }
}

/** A real service-role client needs the service key; match its env var (and the minor alt spelling). */
export function sourceUsesServiceRole(src) {
  return /SUPABASE_SERVICE_ROLE_KEY/.test(src) || /\bSERVICE_ROLE_KEY\b/.test(src)
}

/** Flag a client built from neither the publishable/anon key nor the service-role env — review how it authorizes. */
export function sourceHasUnrecognizedClient(src) {
  if (!/createClient\s*\(/.test(src)) return false
  const recognized = /requirePublishableKey|resolvePublishableKey|PUBLISHABLE|ANON_KEY|supabaseAnonKey|SUPABASE_SERVICE_ROLE_KEY|SERVICE_ROLE_KEY/
  return !recognized.test(src)
}

/** Does a test file contain at least one executable test with an assertion? */
export function testIsExecutable(src) {
  return /(?:^|\W)(?:it|test)\s*\(/.test(src) && /\bexpect\s*\(/.test(src)
}

/** vitest 'unit' project include is src/ **.test.ts(x) — only those run under `npm test`. */
export function pathInCiScope(p) {
  return /^src\/.*\.test\.(ts|tsx)$/.test(p.replace(/\\/g, '/'))
}

function discoverFunctions(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => {
      const idx = join(dir, d.name, 'index.ts')
      const src = existsSync(idx) ? readFileSync(idx, 'utf8') : ''
      return {
        name: d.name,
        usesServiceRole: sourceUsesServiceRole(src),
        unrecognizedClient: sourceHasUnrecognizedClient(src),
        hasIndex: !!src,
      }
    })
    .filter((f) => f.hasIndex)
}

function main() {
  if (!existsSync(REGISTRY)) {
    console.error(`edge-authz-guard: missing ${REGISTRY}`)
    process.exit(1)
  }
  const registry = JSON.parse(readFileSync(REGISTRY, 'utf8')).functions ?? {}
  const functions = discoverFunctions(FUNCTIONS_DIR)
  const testEvidence = (p) => {
    const abs = join(ROOT, p)
    let exists = false
    let src = ''
    try { exists = statSync(abs).isFile(); if (exists) src = readFileSync(abs, 'utf8') } catch { exists = false }
    return { exists, executable: exists && testIsExecutable(src), inCiScope: pathInCiScope(p) }
  }
  const { errors, warnings } = evaluateAuthz(functions, registry, testEvidence)

  for (const w of warnings) console.error(`  WARN  ${w}`)
  for (const e of errors) console.error(`  ERROR ${e}`)
  console.error(`\nedge-authz-guard: ${functions.length} functions, ${errors.length} error(s), ${warnings.length} warning(s).`)
  process.exit(errors.length > 0 ? 1 : 0)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
