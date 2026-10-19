#!/usr/bin/env node
/**
 * Edge Function authorization guard (CLAUDE.md Standing Rule 6).
 *
 * Enforces a PROCESS, not a naming heuristic: every function under
 * supabase/functions/ must be declared in authz-registry.json, the registry's
 * service_role flag must match the source, and any service_role function must
 * have been explicitly reviewed (reviewed:true + an authClass). User-reachable
 * privileged classes (platform-admin, user-jwt) additionally require a runtime
 * authorization test that actually exists on disk — the static check complements
 * the runtime test, it does not replace it.
 *
 * It deliberately does NOT accept "an auth helper is imported" as proof. A new
 * service_role function is a hard FAIL until a human adds a reviewed registry
 * entry + test in the PR. Output: findings to stderr, exit 1 on any ERROR.
 *
 * The decision core (evaluateAuthz) is pure and unit-tested from vitest.
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
 * Pure decision core. Inputs are already-gathered facts so this is testable
 * without a filesystem.
 * @param {{name:string, usesServiceRole:boolean}[]} functions  discovered on disk
 * @param {Record<string, any>} registry  authz-registry.json `functions` map
 * @param {(p:string)=>boolean} testExists  does a referenced test path exist?
 * @returns {{errors:string[], warnings:string[]}}
 */
export function evaluateAuthz(functions, registry, testExists) {
  const errors = []
  const warnings = []
  const known = new Set(Object.keys(registry))

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
    if (fn.usesServiceRole) {
      if (!entry.reviewed || !entry.authClass) {
        errors.push(
          `${fn.name}: service_role function pending authorization review (reviewed:${!!entry.reviewed}, authClass:${entry.authClass ?? 'null'}). ` +
          'Review it, set an authClass, and add a regression test.'
        )
        continue
      }
      const needsTest = TEST_REQUIRED_CLASSES.has(entry.authClass)
      const hasTest = entry.test && testExists(entry.test)
      if (needsTest && !hasTest) {
        errors.push(
          `${fn.name}: authClass '${entry.authClass}' requires a runtime authorization test` +
          (entry.test ? ` but '${entry.test}' does not exist.` : ' but none is referenced.')
        )
      } else if (TEST_RECOMMENDED_CLASSES.has(entry.authClass) && !hasTest) {
        warnings.push(`${fn.name}: authClass '${entry.authClass}' — a regression test is recommended (follow-up).`)
      }
    }
  }

  // registry entries with no corresponding function dir = stale
  for (const name of known) {
    if (name.startsWith('$')) continue
    if (!functions.some((f) => f.name === name)) {
      warnings.push(`${name}: in registry but no supabase/functions/${name}/ on disk (stale entry?).`)
    }
  }
  return { errors, warnings }
}

/** Scan a function's index.ts for a real service_role client construction. */
export function sourceUsesServiceRole(src) {
  // The env var is the only way to get the key; its presence = a privileged client.
  return /SUPABASE_SERVICE_ROLE_KEY/.test(src)
}

function discoverFunctions(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
    .map((d) => {
      const idx = join(dir, d.name, 'index.ts')
      const src = existsSync(idx) ? readFileSync(idx, 'utf8') : ''
      return { name: d.name, usesServiceRole: sourceUsesServiceRole(src), hasIndex: !!src }
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
  const testExists = (p) => {
    try { return statSync(join(ROOT, p)).isFile() } catch { return false }
  }
  const { errors, warnings } = evaluateAuthz(functions, registry, testExists)

  for (const w of warnings) console.error(`  WARN  ${w}`)
  for (const e of errors) console.error(`  ERROR ${e}`)
  console.error(
    `\nedge-authz-guard: ${functions.length} functions, ${errors.length} error(s), ${warnings.length} warning(s).`
  )
  process.exit(errors.length > 0 ? 1 : 0)
}

// Run only when invoked directly, not when imported by the test.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
