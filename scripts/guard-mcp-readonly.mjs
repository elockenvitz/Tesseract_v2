#!/usr/bin/env node
/**
 * Fails if the local Supabase MCP server is configured as a read-write
 * connection to a live project.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * On 2026-11-15 an agent ran `CREATE TABLE` against the production database
 * through `mcp__supabase__execute_sql`. There was no prompt and no error.
 * The table really existed and had to be dropped.
 *
 * The cause was not a missing capability. `.mcp.json.example` — the template
 * committed to this repo — has always specified `--read-only`. The working
 * `.mcp.json` had silently dropped it. Nothing observed the divergence,
 * because `.mcp.json` is gitignored and therefore invisible to CI.
 *
 * This runs locally, where the file is. It is deliberately not a CI job:
 * a CI job would pass vacuously, having no file to inspect.
 *
 * ── What the flag actually does, read from the server's source ────────────
 *
 * `@supabase/mcp-server-supabase@0.17.0`, dist/chunk-IMPRDEX4.cjs:
 *
 *   1. Tool withdrawal. `tc()` builds the toolset with
 *        `t && yt.has(i) || (a[i] = bt[i])`
 *      where `t` is readOnly and `yt` is every tool whose
 *      `annotations.readOnlyHint === false` and whose `readOnlyBehavior` is
 *      not "adapt" — apply_migration, deploy_edge_function, create_branch,
 *      merge_branch, reset_branch, delete_branch, create_project,
 *      delete_notebook. In read-only mode they are never registered, so
 *      they cannot be called at all.
 *
 *   2. A different ROLE. execute_sql survives (readOnlyBehavior "adapt") but
 *      its executor is `e.executeSql(id, { query, read_only: o })` with `o`
 *      the same flag, and the Management API then connects as
 *      `supabase_read_only_user` instead of `postgres`. Measured 2026-11-16
 *      against a separately launched read-only server:
 *
 *        has_table_privilege(…, memory_events,     INSERT)  false
 *        has_table_privilege(…, accepted_trades,   UPDATE)  false
 *        has_table_privilege(…, decision_requests, DELETE)  false
 *        has_schema_privilege(…, public, CREATE)            false
 *        memberships                   pg_monitor, pg_read_all_data
 *
 *      On the read-write connection every one of those is true and the
 *      memberships include service_role and supabase_privileged_role.
 *
 *   3. Transaction mode. `default_transaction_read_only = on`, so writes also
 *      fail with SQLSTATE 25006 in the engine, below the tool layer.
 *
 * All three are real enforcement. None is a label.
 *
 * NOTE: an earlier version of this header said enforcement is not role-level.
 * That was measured on the read-WRITE connection and generalised without
 * measuring read-only mode. Corrected.
 *
 * What read-only does NOT give you: `rolbypassrls` is TRUE on
 * `supabase_read_only_user`, so it reads every row in every organization and
 * is NOT tenant-scoped. It is a privilege reduction for writes and none at
 * all for reads.
 *
 * ── What is NOT enforcement, and is the trap this incident fell into ─────
 *
 * The server has a destructive-SQL confirmation feature, and it is easy to
 * read the absence of a prompt as proof that a statement was harmless or
 * that the connection was read-only. It is neither:
 *
 *   - The confirmation only engages when the MCP CLIENT advertises an
 *     `elicitation` capability with form support. Function `Q()` returns
 *     false otherwise, and the call proceeds, recording
 *     `confirmation_decision route:"bypass"`.
 *   - Even with a confirming client, the gate classifies only DROP, DELETE,
 *     TRUNCATE and WHERE-less UPDATE as destructive. CREATE TABLE is
 *     `reason:"not_destructive"` and runs unprompted.
 *
 * So: a silent success means nothing. Only the flag means anything.
 */
/*
 * ── Resolution, and why it is not `process.cwd()` ───────────────────────────
 *
 * This guard previously did `resolve(process.cwd(), '.mcp.json')`. Two
 * failures, both observed:
 *
 *   1. Run from a different directory than the config, it inspected a
 *      DIFFERENT file and printed PASS. A failure injection aimed at one
 *      worktree's `.mcp.json` passed because the guard was reading another's.
 *      A guard that reports on a file nobody asked about is worse than no
 *      guard: it manufactures false assurance.
 *   2. Missing file -> `exit 0`, "nothing to check". `.mcp.json` is
 *      gitignored, so a freshly created worktree has none, so the pre-push
 *      hook passed VACUOUSLY in exactly the situation it exists for.
 *
 * Both are fixed by being explicit. Resolution order:
 *
 *   --config <path> / MCP_READONLY_GUARD_CONFIG   one named file, only that
 *   otherwise                                     EVERY git worktree's root
 *
 * Scanning every worktree matters because the dangerous config may not be in
 * the one being pushed. The credential is account-wide, so a read-write entry
 * in a sibling worktree is a live production write path regardless of where
 * the hook fires.
 *
 * Absent config FAILS CLOSED (exit 1). Strictly, no `.mcp.json` means no MCP
 * connection and so no risk — but "absent" and "I looked in the wrong place"
 * are indistinguishable from inside the script, and the second is what
 * actually happened. The escape hatch is explicit and logged:
 * MCP_READONLY_GUARD_ALLOW_MISSING=1. An env var someone sets on purpose is
 * reviewable; a silent `exit 0` is not.
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'

/** Project refs known to be live. A ref not listed here is still reported. */
const PRODUCTION_REFS = { wfcebeagznzgeuyysbnt: 'production' }

const EXIT_OK = 0
const EXIT_UNSAFE = 1
const EXIT_CANNOT_TELL = 3

const argv = process.argv.slice(2)
const flagIdx = argv.indexOf('--config')
const override =
  (flagIdx >= 0 ? argv[flagIdx + 1] : null) ||
  process.env.MCP_READONLY_GUARD_CONFIG ||
  null

/** Every worktree root for this repo, cwd-independent. [] if not in a repo. */
function worktreeRoots() {
  try {
    const out = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return out
      .split('\n')
      .filter(l => l.startsWith('worktree '))
      .map(l => l.slice('worktree '.length).trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

let targets
if (override) {
  targets = [resolve(override)]
} else {
  const roots = worktreeRoots()
  if (roots.length === 0) {
    console.error('guard:mcp-readonly CANNOT VERIFY — not inside a git repository, and')
    console.error('no --config/MCP_READONLY_GUARD_CONFIG was given. Refusing to guess.')
    process.exit(EXIT_CANNOT_TELL)
  }
  targets = roots.map(r => join(r, '.mcp.json'))
}

const present = targets.filter(t => existsSync(t))

if (present.length === 0) {
  if (process.env.MCP_READONLY_GUARD_ALLOW_MISSING === '1') {
    console.log('guard:mcp-readonly SKIPPED — no .mcp.json found, and')
    console.log('MCP_READONLY_GUARD_ALLOW_MISSING=1 was set deliberately.')
    console.log('Searched:')
    for (const t of targets) console.log(`  ${t}`)
    process.exit(EXIT_OK)
  }
  console.error('guard:mcp-readonly FAILED CLOSED — no .mcp.json found in any location checked.\n')
  for (const t of targets) console.error(`  looked at: ${t}`)
  console.error('\nThis is NOT a pass. "Absent" and "the guard looked in the wrong')
  console.error('place" are indistinguishable from here, and the second has happened.')
  console.error('If this machine genuinely has no MCP config, set')
  console.error('MCP_READONLY_GUARD_ALLOW_MISSING=1 so the decision is visible.')
  process.exit(EXIT_UNSAFE)
}

const fail = []
const note = []
let supabaseServersSeen = 0

for (const CONFIG of present) {
  let cfg
  try {
    cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))
  } catch (err) {
    fail.push(`  ${CONFIG}\n    is not valid JSON: ${err.message}\n` +
              `    An unparseable config is not a safe config.`)
    continue
  }

  const supabase = Object.entries(cfg?.mcpServers ?? {}).filter(([, s]) =>
    (s?.args ?? []).some(a => typeof a === 'string' && a.includes('mcp-server-supabase')),
  )

  if (supabase.length === 0) {
    note.push(`  ${CONFIG}: no Supabase MCP server configured`)
    continue
  }

  for (const [name, srv] of supabase) {
    supabaseServersSeen++
    const args = (srv?.args ?? []).filter(a => typeof a === 'string')
    const readOnly = args.includes('--read-only') || args.includes('--read-only=true')
    const refArg = args.find(a => a.startsWith('--project-ref'))
    const ref = refArg ? refArg.split('=')[1] : null
    const env = PRODUCTION_REFS[ref]

    // Never print the token, or any env value. Only the key names.
    const envKeys = Object.keys(srv?.env ?? {}).join(', ') || '(none)'

    if (!readOnly) {
      fail.push(
        `  ${CONFIG}\n` +
          `  server "${name}" → project ${ref ?? '(unspecified)'}` +
          `${env ? ` [${env.toUpperCase()}]` : ''}\n` +
          `    missing --read-only: execute_sql can write, and apply_migration,\n` +
          `    deploy_edge_function and the branch tools are all registered.\n` +
          `    Fix: add "--read-only" to this server's args.`,
      )
    } else {
      note.push(`  ${CONFIG}\n    server "${name}" → project ${ref ?? '(unspecified)'}${env ? ` [${env}]` : ''}: read-only`)
    }

    if (ref && !env) {
      note.push(`    server "${name}": project ref ${ref} is not in this guard's known list — confirm which environment it is`)
    }
    note.push(`    server "${name}": credential env keys present: ${envKeys}`)
  }
}

if (fail.length > 0) {
  console.error('guard:mcp-readonly FAILED — a read-write MCP connection to a live project\n')
  console.error(fail.join('\n\n'))
  console.error('\nA silent success from execute_sql is not evidence of read-only access.')
  console.error('See the header of scripts/guard-mcp-readonly.mjs for why.')
  process.exit(EXIT_UNSAFE)
}

console.log(`guard:mcp-readonly PASS — ${present.length} config(s), ${supabaseServersSeen} Supabase server(s)`)
console.log(note.join('\n'))
process.exit(EXIT_OK)
