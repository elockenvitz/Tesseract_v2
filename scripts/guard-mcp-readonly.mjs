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
 *   2. Transaction mode. execute_sql survives (readOnlyBehavior "adapt") but
 *      its executor is `e.executeSql(id, { query, read_only: o })` with `o`
 *      the same flag. The Management API then runs the statement in a
 *      Postgres READ ONLY transaction, which rejects writes with SQLSTATE
 *      25006 at the database, not at the tool layer.
 *
 * Both layers are real enforcement. Neither is a label.
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
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const CONFIG = resolve(process.cwd(), '.mcp.json')

/** Project refs known to be live. A ref not listed here is still reported. */
const PRODUCTION_REFS = { wfcebeagznzgeuyysbnt: 'production' }

const fail = []
const note = []

if (!existsSync(CONFIG)) {
  console.log('guard:mcp-readonly — no .mcp.json in this worktree, nothing to check')
  process.exit(0)
}

let cfg
try {
  cfg = JSON.parse(readFileSync(CONFIG, 'utf8'))
} catch (err) {
  console.error(`guard:mcp-readonly — .mcp.json is not valid JSON: ${err.message}`)
  process.exit(1)
}

const servers = Object.entries(cfg?.mcpServers ?? {})
const supabase = servers.filter(([, s]) =>
  (s?.args ?? []).some(a => typeof a === 'string' && a.includes('mcp-server-supabase')),
)

if (supabase.length === 0) {
  console.log('guard:mcp-readonly — no Supabase MCP server configured, nothing to check')
  process.exit(0)
}

for (const [name, srv] of supabase) {
  const args = (srv?.args ?? []).filter(a => typeof a === 'string')
  const readOnly = args.includes('--read-only') || args.includes('--read-only=true')
  const refArg = args.find(a => a.startsWith('--project-ref'))
  const ref = refArg ? refArg.split('=')[1] : null
  const env = PRODUCTION_REFS[ref]

  // Never print the token, or any env value. Only the key names.
  const envKeys = Object.keys(srv?.env ?? {}).join(', ') || '(none)'

  if (!readOnly) {
    fail.push(
      `  server "${name}" → project ${ref ?? '(unspecified)'}` +
        `${env ? ` [${env.toUpperCase()}]` : ''}\n` +
        `    missing --read-only: execute_sql can write, and apply_migration,\n` +
        `    deploy_edge_function and the branch tools are all registered.\n` +
        `    Fix: add "--read-only" to this server's args in .mcp.json.`,
    )
  } else {
    note.push(`  server "${name}" → project ${ref ?? '(unspecified)'}${env ? ` [${env}]` : ''}: read-only`)
  }

  if (ref && !env) {
    note.push(`  server "${name}": project ref ${ref} is not in this guard's known list — confirm which environment it is`)
  }
  note.push(`  server "${name}": credential env keys present: ${envKeys}`)
}

if (fail.length > 0) {
  console.error('guard:mcp-readonly FAILED — a read-write MCP connection to a live project\n')
  console.error(fail.join('\n\n'))
  console.error('\nA silent success from execute_sql is not evidence of read-only access.')
  console.error('See the header of scripts/guard-mcp-readonly.mjs for why.')
  process.exit(1)
}

console.log('guard:mcp-readonly PASS')
console.log(note.join('\n'))
