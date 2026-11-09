#!/usr/bin/env node
/**
 * Frontend Tenant Boundary Lint
 *
 * Finds frontend reads of organization-owned tables that carry no
 * organization filter, and fails when one of them is not in the reviewed
 * allowlist.
 *
 *     node scripts/frontend-tenant-lint.mjs            full report
 *     node scripts/frontend-tenant-lint.mjs --ci       summary only
 *     node scripts/frontend-tenant-lint.mjs --rpcs     also list rpc names
 *
 * The scanning and classification live in `lib/tenant-scan.mjs` (parsed, not
 * pattern-matched -- that file records why) and the accepted exceptions in
 * `lib/tenant-allowlist.mjs` (one entry per site, each naming the database
 * policy that enforces the boundary). This file only walks the tree,
 * reconciles findings against the allowlist, and decides.
 *
 * ── What "pass" means ────────────────────────────────────────────────────
 *
 * Every finding is accounted for by an entry somebody wrote a reason into.
 * It does not mean there are no unfiltered queries -- there are 196 of them --
 * and it does not mean the frontend is the boundary. The database is the
 * boundary. This gate only ensures that no new unfiltered read arrives
 * without a human having looked at the policy behind it.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import {
  scanSource, severityOf, siteKey,
  ORG_SCOPED_TABLES, P0_TABLES, NOT_ORG_SCOPED_BY_DESIGN,
} from './lib/tenant-scan.mjs'
import { SITES, TABLE_POLICY, REVIEWED_RPCS, registryProblems } from './lib/tenant-allowlist.mjs'

/**
 * Paths not scanned, and why each one is defensible.
 *
 * `scripts/` and `src/test/` hold no product queries. The test and story
 * globs are fixtures. `AdminConsolePage.tsx` queries across organizations on
 * purpose and is gated by `is_platform_admin()` server-side.
 *
 * Note what is NOT here any more: the previous version skipped an entire FILE
 * if the text `useOrganizationData` or `useOrgQueryKey` appeared anywhere in
 * it, on the theory that the file used an org-scoped hook. One mention
 * excused every query in the file, including ones that never went near the
 * hook. That is removed.
 */
const EXCLUDED_PATHS = [
  'scripts/',
  'src/test/',
  '__fixtures__/',
  '.test.ts',
  '.test.tsx',
  '.stories.tsx',
  'AdminConsolePage.tsx',
]

const args = process.argv.slice(2)
const ciMode = args.includes('--ci')
const showRpcs = args.includes('--rpcs')
/**
 * `--emit` prints the registry as source, for pasting into the allowlist.
 *
 * Maintenance affordance, not a bypass: it emits the SITES counts and the rpc
 * names, never a policy or a reason. Those are the parts a person has to
 * write, and the registry check rejects an entry whose table has neither.
 */
const emitMode = args.includes('--emit')

function walkDir(dir, extensions) {
  const results = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return results
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue
      results.push(...walkDir(fullPath, extensions))
    } else if (extensions.includes(extname(entry.name))) {
      results.push(fullPath)
    }
  }
  return results
}

/**
 * Compare findings against the allowlist.
 *
 * Four ways to fail, and the third is the one a count baseline could never
 * express: an accepted site that has GROWN. Fixing one query and adding a
 * worse one in the same file used to net to zero.
 */
export function reconcile(findings, sites = SITES) {
  const counted = new Map()
  for (const f of findings) {
    const key = siteKey(f)
    if (!counted.has(key)) counted.set(key, [])
    counted.get(key).push(f)
  }

  const unreviewed = []
  const grown = []
  const shrunk = []
  const stale = []

  for (const [key, group] of counted) {
    const allowed = sites[key]
    if (allowed === undefined) {
      unreviewed.push({ key, group })
    } else if (group.length > allowed) {
      grown.push({ key, group, allowed })
    } else if (group.length < allowed) {
      shrunk.push({ key, group, allowed })
    }
  }

  for (const key of Object.keys(sites)) {
    if (!counted.has(key)) stale.push(key)
  }

  return { counted, unreviewed, grown, shrunk, stale }
}

function run() {
  const problems = emitMode ? [] : registryProblems({
    orgScoped: ORG_SCOPED_TABLES,
    notOrgScoped: NOT_ORG_SCOPED_BY_DESIGN,
    p0Tables: P0_TABLES,
  })
  if (problems.length) {
    console.error('\nFAIL: the tenant registry contradicts itself:')
    problems.forEach((p) => console.error('  ' + p))
    process.exit(1)
  }

  const srcDir = join(process.cwd(), 'src')
  const files = walkDir(srcDir, ['.ts', '.tsx'])
  const findings = []
  const rpcs = []
  let filesScanned = 0
  let filesSkipped = 0

  for (const filePath of files) {
    const rel = relative(process.cwd(), filePath).replace(/\\/g, '/')
    if (EXCLUDED_PATHS.some((p) => rel.includes(p))) {
      filesSkipped++
      continue
    }
    filesScanned++
    const result = scanSource(rel, readFileSync(filePath, 'utf-8'))
    findings.push(...result.findings)
    rpcs.push(...result.rpcs)
  }

  const parseErrors = findings.filter((f) => f.kind === 'parse-error')
  const real = findings.filter((f) => f.kind !== 'parse-error')
  const { counted, unreviewed, grown, shrunk, stale } = reconcile(real)

  const p0 = real.filter((f) => severityOf(f) === 'P0').length
  const byKind = new Map()
  for (const f of real) byKind.set(f.kind, (byKind.get(f.kind) || 0) + 1)

  if (emitMode) {
    /* Grouped by table, because the policy is per table and that is the order
       a reader checks them in. */
    const keys = [...counted.keys()].sort((a, b) => {
      const ta = a.split('::')[1]
      const tb = b.split('::')[1]
      return ta === tb ? a.localeCompare(b) : ta.localeCompare(tb)
    })
    console.log('export const SITES = {')
    let table = null
    for (const key of keys) {
      const [, t] = key.split('::')
      if (t !== table) { console.log(`  // ── ${t}`); table = t }
      console.log(`  '${key}': ${counted.get(key).length},`)
    }
    console.log('}')
    console.log('\nexport const REVIEWED_RPCS = new Set([')
    for (const name of [...new Set(rpcs.map((r) => r.name))].sort()) {
      console.log(`  '${name}',`)
    }
    console.log('])')
    process.exit(0)
  }

  console.log('\n=== Frontend Tenant Boundary Lint ===\n')

  if (!ciMode) {
    const groups = [...counted.entries()].sort((a, b) => {
      const sev = (g) => (severityOf(g[1][0]) === 'P0' ? 0 : 1)
      if (sev(a) !== sev(b)) return sev(a) - sev(b)
      return a[0].localeCompare(b[0])
    })
    for (const [key, group] of groups) {
      const policy = TABLE_POLICY[group[0].table]
      const mark = SITES[key] === undefined
        ? 'UNREVIEWED'
        : policy ? policy.evidence : 'no policy recorded'
      console.log(`[${severityOf(group[0])}] ${key}  x${group.length}  (${mark})`)
      for (const f of group) {
        console.log(`    ${f.file}:${f.line}${f.via ? `  embedded via ${f.via}` : ''}`)
      }
    }
  }

  const newRpcs = [...new Set(rpcs.map((r) => r.name))]
    .filter((name) => !REVIEWED_RPCS.has(name))
    .sort()

  if (showRpcs) {
    console.log(`\n--- RPC names called from the frontend (${new Set(rpcs.map(r => r.name)).size}) ---`)
    for (const name of [...new Set(rpcs.map((r) => r.name))].sort()) {
      console.log(`  ${REVIEWED_RPCS.has(name) ? ' ' : '*'} ${name}`)
    }
    console.log('  * = not in the reviewed inventory')
  }

  console.log('\n--- Summary ---')
  console.log(`Files scanned:   ${filesScanned}`)
  console.log(`Files skipped:   ${filesSkipped}`)
  console.log(`Findings:        ${real.length} across ${counted.size} site(s)`)
  console.log(`  P0:            ${p0}`)
  for (const [kind, n] of [...byKind.entries()].sort()) {
    console.log(`  ${kind.padEnd(14)} ${n}`)
  }
  const probed = [...counted.keys()].filter(
    (k) => TABLE_POLICY[k.split('::')[1]]?.evidence === 'probed',
  ).length
  console.log(`Registered sites: ${Object.keys(SITES).length} (${probed} on tables probed under RLS)`)
  console.log(`RPC names:       ${new Set(rpcs.map((r) => r.name)).size} (${newRpcs.length} outside the reviewed inventory)`)

  let failed = false

  if (parseErrors.length) {
    /* A file this gate cannot parse is a file it cannot check, and silently
       counting it as clean is the failure mode that makes a gate decoration. */
    console.log(`\nFAILED: ${parseErrors.length} file(s) could not be parsed:`)
    parseErrors.forEach((f) => console.log(`  ${f.file}: ${f.detail}`))
    failed = true
  }

  if (unreviewed.length) {
    console.log(`\nFAILED: ${unreviewed.length} site(s) are not in the reviewed allowlist:`)
    for (const { key, group } of unreviewed) {
      console.log(`  ${key}  x${group.length}`)
      group.forEach((f) => console.log(`      ${f.file}:${f.line}`))
    }
    console.log(
      '\n  Either scope the query (.eq or .in on organization_id, or an\n' +
      '  org-scoped view), or add an entry to scripts/lib/tenant-allowlist.mjs\n' +
      '  quoting the policy on that table that enforces the boundary.\n' +
      '  An entry without a policy is rejected.',
    )
    failed = true
  }

  if (grown.length) {
    console.log(`\nFAILED: ${grown.length} reviewed site(s) hold more findings than were accepted:`)
    for (const { key, group, allowed } of grown) {
      console.log(`  ${key}: ${group.length} now, ${allowed} reviewed`)
      group.forEach((f) => console.log(`      ${f.file}:${f.line}`))
    }
    failed = true
  }

  if (stale.length) {
    console.log(`\nFAILED: ${stale.length} reviewed site(s) no longer exist — remove them:`)
    stale.forEach((key) => console.log(`  ${key}`))
    failed = true
  }

  if (shrunk.length) {
    /* Ground gained is held, the same way the type-error ceiling is. */
    console.log(`\nFAILED: ${shrunk.length} reviewed site(s) hold fewer findings than recorded.`)
    console.log('  Lower the count so the gain cannot be spent silently:')
    for (const { key, group, allowed } of shrunk) {
      console.log(`  ${key}: sites ${allowed} -> ${group.length}`)
    }
    failed = true
  }

  if (newRpcs.length) {
    console.log(`\nFAILED: ${newRpcs.length} rpc name(s) are not in the reviewed inventory:`)
    newRpcs.forEach((name) => console.log(`  ${name}`))
    console.log(
      '\n  An rpc runs server-side and this gate cannot see what it checks.\n' +
      '  Read the function (SECURITY DEFINER? does it verify membership?) and\n' +
      '  add the name to REVIEWED_RPCS in scripts/lib/tenant-allowlist.mjs.',
    )
    failed = true
  }

  if (failed) {
    console.log('')
    process.exit(1)
  }

  /* Deliberately not "no violations": there are 196 unfiltered reads. What
     passes is that each one is registered against a policy somebody recorded,
     at a stated evidence level. The database is the boundary, not this gate. */
  console.log('\nPASS: every finding is registered against a recorded policy.\n')
  process.exit(0)
}

run()
