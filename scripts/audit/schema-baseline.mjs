#!/usr/bin/env node
/**
 * Emit a SANITIZED security inventory of a live database, for drift detection.
 *
 * The counterpart to the raw `pg_dump` snapshot, which stays outside the
 * repository (`%USERPROFILE%\.tesseract\schema-baselines\`). This is the part
 * that IS version controlled: enough structure to prove nothing moved, and no
 * logic that would leak the security model or a secret.
 *
 * ── What is included, and what is deliberately not ────────────────────────
 *
 *   included   table names, RLS enablement/forcing, per-table grants,
 *              policy names + command + roles + permissive flag,
 *              function names + signature + owner + security mode +
 *              search_path pinned? + execute grants, trigger names,
 *              storage buckets and their policy shapes, aggregate counts
 *
 *   HASHED     policy USING / WITH CHECK expressions, function bodies,
 *              trigger definitions — a change is visible, the content is not
 *
 *   excluded   every row of application data, every function body verbatim,
 *              every literal default
 *
 * A hash tells you a policy changed and which one. To see HOW it changed you
 * open the local raw snapshot. That is the intended split: the repo answers
 * "did anything move?", the local file answers "what exactly?".
 *
 * ── Reproducibility ───────────────────────────────────────────────────────
 *
 * Output is deterministic: every list is ordered by a stable key and JSON keys
 * are emitted in a fixed order, so `git diff` shows only real change. The one
 * volatile field is `captured_at`, which is the point of a baseline.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *
 *   node scripts/audit/schema-baseline.mjs                      # prod, from .mcp.json
 *   node scripts/audit/schema-baseline.mjs --project-ref=<ref>  # another project
 *   node scripts/audit/schema-baseline.mjs --out=docs/audit/baselines/x.json
 *   node scripts/audit/schema-baseline.mjs --summary            # markdown to stdout
 *
 * Credentials resolve the same way `scripts/apply-migrations-to-staging.mjs`
 * does: SUPABASE_ACCESS_TOKEN from the environment, falling back to .mcp.json
 * in the repository root. READ-ONLY: every statement below is a SELECT, and
 * the runner refuses anything else.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const argv = process.argv.slice(2)
const arg = name => argv.find(a => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const OUT = arg('out') ?? 'docs/audit/baselines/production-security-inventory.json'
const SUMMARY_ONLY = argv.includes('--summary')

async function credentials() {
  let token = process.env.SUPABASE_ACCESS_TOKEN
  let ref = arg('project-ref') ?? process.env.SUPABASE_PROJECT_REF
  if (!token || !ref) {
    try {
      const mcp = JSON.parse(await readFile(path.join(REPO, '.mcp.json'), 'utf8'))
      const s = mcp.mcpServers?.supabase ?? {}
      token ??= s.env?.SUPABASE_ACCESS_TOKEN
      ref ??= (s.args ?? []).find(a => a.startsWith('--project-ref='))?.split('=')[1]
    } catch { /* fall through to the error below */ }
  }
  if (!token || !ref) {
    console.error('Need SUPABASE_ACCESS_TOKEN and a project ref (--project-ref=… or .mcp.json).')
    process.exit(2)
  }
  return { token, ref }
}

/** Run one read-only statement. Refuses anything that is not a SELECT/WITH. */
async function query({ token, ref }, sql) {
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error('read-only statements only')
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  })
  const body = await res.json()
  if (!res.ok || body?.message) throw new Error(body?.message ?? `HTTP ${res.status}`)
  return body
}

/**
 * 16 hex chars of SHA-256. Built in since PG11, so no pgcrypto dependency.
 * Truncated because this detects change, it does not defend against a chosen
 * collision — and a readable file is worth more here than 48 extra characters.
 */
const H = expr => `left(encode(sha256(convert_to(coalesce(${expr},''),'UTF8')),'hex'),16)`

const Q = {
  meta: `select current_setting('server_version') as server_version`,

  tables: `
    select c.relname as name,
           c.relrowsecurity as rls,
           c.relforcerowsecurity as rls_forced,
           (select count(*)::int from pg_policies p
              where p.schemaname='public' and p.tablename=c.relname) as policies,
           (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type),'')
              from information_schema.role_table_grants g
             where g.table_schema='public' and g.table_name=c.relname and g.grantee='anon') as anon,
           (select coalesce(string_agg(distinct privilege_type, ',' order by privilege_type),'')
              from information_schema.role_table_grants g
             where g.table_schema='public' and g.table_name=c.relname and g.grantee='authenticated') as auth
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p')
    order by c.relname`,

  policies: `
    select tablename as "table", policyname as name, cmd,
           array_to_string(roles,',') as roles,
           permissive,
           -- coalesce, because qual is NULL on an INSERT policy, and NULL OR
           -- false is NULL rather than false — which would emit null here and
           -- read as a change on every regeneration.
           coalesce(qual='true' or (qual is null and with_check='true'), false) as unconditional,
           ${H('qual')} as qual_hash,
           ${H('with_check')} as check_hash
    from pg_policies where schemaname in ('public','storage')
    order by schemaname, tablename, cmd, policyname`,

  functions: `
    select p.proname as name,
           pg_get_function_identity_arguments(p.oid) as args,
           pg_get_userbyid(p.proowner) as owner,
           p.prosecdef as definer,
           (p.proconfig is not null and exists (
              select 1 from unnest(p.proconfig) c where c like 'search\\_path=%')) as search_path_pinned,
           case p.provolatile when 'i' then 'i' when 's' then 's' else 'v' end as vol,
           has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth,
           ${H('pg_get_functiondef(p.oid)')} as body_hash
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f'
    order by p.proname, pg_get_function_identity_arguments(p.oid)`,

  triggers: `
    select n.nspname as schema, c.relname as "table", t.tgname as name,
           pr.proname as fn, t.tgenabled as enabled,
           ${H('pg_get_triggerdef(t.oid)')} as def_hash
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    join pg_proc pr on pr.oid=t.tgfoid
    where not t.tgisinternal and n.nspname in ('public','auth','storage')
    order by n.nspname, c.relname, t.tgname`,

  buckets: `select id, public, file_size_limit from storage.buckets order by id`,
}

function summarize(b) {
  const rlsOff = b.tables.filter(t => !t.rls).length
  const noPolicy = b.tables.filter(t => t.rls && t.policies === 0).length
  const perm = b.policies.filter(p => p.unconditional)
  const definerNoPath = b.functions.filter(f => f.definer && !f.search_path_pinned).length
  const anonExec = b.functions.filter(f => f.anon).length
  return {
    tables: b.tables.length,
    tables_rls_disabled: rlsOff,
    tables_rls_on_no_policy: noPolicy,
    policies: b.policies.length,
    policies_unconditional: perm.length,
    policies_unconditional_tables: new Set(perm.map(p => p.table)).size,
    policies_public_role: b.policies.filter(p => p.roles.split(',').includes('public')).length,
    functions: b.functions.length,
    functions_security_definer: b.functions.filter(f => f.definer).length,
    functions_definer_without_search_path: definerNoPath,
    functions_anon_executable: anonExec,
    triggers: b.triggers.length,
    storage_buckets: b.buckets.length,
    storage_buckets_public: b.buckets.filter(x => x.public).length,
  }
}

const creds = await credentials()
const [meta, tables, policies, functions, triggers, buckets] = await Promise.all(
  ['meta', 'tables', 'policies', 'functions', 'triggers', 'buckets'].map(k => query(creds, Q[k]))
)

const baseline = {
  schema_version: 1,
  captured_at: new Date().toISOString(),
  source_project_ref_prefix: `${creds.ref.slice(0, 6)}…`,
  server_version: meta[0].server_version,
  counts: {},
  tables, policies, functions, triggers, buckets,
}
baseline.counts = summarize(baseline)

if (SUMMARY_ONLY) {
  const c = baseline.counts
  console.log(`# Security inventory — ${baseline.server_version}, captured ${baseline.captured_at.slice(0, 10)}\n`)
  for (const [k, v] of Object.entries(c)) console.log(`- ${k.replace(/_/g, ' ')}: **${v}**`)
  process.exit(0)
}

const outPath = path.resolve(REPO, OUT)
await mkdir(path.dirname(outPath), { recursive: true })
await writeFile(outPath, JSON.stringify(baseline, null, 2) + '\n', 'utf8')

console.log(`Wrote ${OUT}`)
for (const [k, v] of Object.entries(baseline.counts)) console.log(`  ${k.padEnd(38)} ${v}`)
console.log('\nRaw dumps stay outside the repo. This file contains no bodies and no data.')
