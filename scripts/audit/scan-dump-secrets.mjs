#!/usr/bin/env node
/**
 * Scan a raw schema dump for anything that must never leave the machine.
 *
 * Run this BEFORE opening, sharing, or deriving anything from a production
 * dump. A `pg_dump --schema-only` should contain no credentials — but "should"
 * is not "does": function bodies, column DEFAULTs, COMMENTs and seeded config
 * rows are all places a key has historically been parked, and a schema dump
 * copies them verbatim.
 *
 * NEVER prints a matched secret. Reports the file, line number, category and a
 * masked fragment, so the output of this script is itself safe to paste.
 *
 * Usage:
 *   node scripts/audit/scan-dump-secrets.mjs <path-to-dump.sql> [--json]
 *
 * Exit codes:
 *   0  clean
 *   1  findings — do not use the dump until each is reviewed
 *   2  usage / unreadable file
 */

import { readFileSync, statSync } from 'node:fs'

/**
 * Categories, ordered most-specific first so a Supabase token is reported as a
 * Supabase token rather than as a generic long string.
 *
 * `allow` marks patterns that are expected in a legitimate Supabase dump and
 * would otherwise bury the real findings in noise.
 */
const RULES = [
  { id: 'supabase-pat',    re: /\bsbp_[A-Za-z0-9]{20,}/g,                       what: 'Supabase personal access token' },
  { id: 'supabase-secret', re: /\bsb_secret_[A-Za-z0-9_-]{20,}/g,               what: 'Supabase secret key' },
  { id: 'jwt',             re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, what: 'JWT (anon/service_role key?)' },
  { id: 'openai',          re: /\bsk-[A-Za-z0-9]{20,}/g,                        what: 'OpenAI-style API key' },
  { id: 'anthropic',       re: /\bsk-ant-[A-Za-z0-9_-]{20,}/g,                  what: 'Anthropic API key' },
  { id: 'aws-akid',        re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,                what: 'AWS access key id' },
  { id: 'github-pat',      re: /\b(?:ghp_|gho_|ghs_|github_pat_)[A-Za-z0-9_]{20,}/g, what: 'GitHub token' },
  { id: 'google-api',      re: /\bAIza[A-Za-z0-9_-]{30,}/g,                     what: 'Google API key' },
  { id: 'slack',           re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g,              what: 'Slack token' },
  { id: 'private-key',     re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/g, what: 'private key block' },

  // Connection strings carrying credentials: scheme://user:pass@host
  { id: 'conn-string-creds', re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s:/@'"]+:[^\s:/@'"]+@[^\s'"]+/gi, what: 'URL containing credentials' },

  // Assignments of a secret-ish name to a non-trivial literal. Deliberately
  // narrow: requires a quoted value of >= 8 chars, so `password text` (a column
  // definition) and `api_key IS NULL` do not fire.
  { id: 'assigned-secret', re: /\b(pass(?:word|wd)?|secret|api[_-]?key|access[_-]?token|auth[_-]?token|private[_-]?key|client[_-]?secret|bearer)\b\s*(?::=|=|=>)\s*'([^']{8,})'/gi, what: 'secret-named identifier assigned a literal' },

  // A long opaque blob inside a string literal. Last, and noisiest — often a
  // legitimate encoded default. Reported so a human decides.
  { id: 'opaque-blob', re: /'(?=[A-Za-z0-9+/=_-]{48,}')[A-Za-z0-9+/=_-]{48,}'/g, what: 'long opaque literal (review by eye)' },
]

/** Substrings that make a match uninteresting in a Supabase schema dump. */
const BENIGN = [
  'postgres://postgres:postgres@',      // local dev placeholder
  'YOUR-PASSWORD', 'YOUR_PASSWORD', '[YOUR-PASSWORD]',
  'supabase_admin', 'pg_catalog', 'information_schema',
  'password_hash',                       // a column name, not a value
]

/** Show that something matched, and where, without reproducing it. */
function mask(s) {
  if (s.length <= 10) return '*'.repeat(s.length)
  return `${s.slice(0, 4)}${'*'.repeat(Math.min(24, s.length - 8))}${s.slice(-4)} (len ${s.length})`
}

const args = process.argv.slice(2)
const asJson = args.includes('--json')
const file = args.find(a => !a.startsWith('--'))

if (!file) {
  console.error('usage: node scripts/audit/scan-dump-secrets.mjs <dump.sql> [--json]')
  process.exit(2)
}

let text
try {
  const size = statSync(file).size
  text = readFileSync(file, 'utf8')
  if (!asJson) console.log(`Scanning ${file} (${(size / 1_048_576).toFixed(1)} MB)\n`)
} catch (e) {
  console.error(`cannot read ${file}: ${e.message}`)
  process.exit(2)
}

const lines = text.split('\n')
const findings = []

lines.forEach((line, i) => {
  if (BENIGN.some(b => line.includes(b))) return
  for (const rule of RULES) {
    rule.re.lastIndex = 0
    let m
    while ((m = rule.re.exec(line)) !== null) {
      const hit = m[2] ?? m[0]
      if (BENIGN.some(b => hit.includes(b))) continue
      findings.push({ line: i + 1, rule: rule.id, what: rule.what, masked: mask(hit) })
      if (findings.length > 500) return          // a runaway pattern is itself a finding
    }
  }
})

if (asJson) {
  console.log(JSON.stringify({ file, findings, clean: findings.length === 0 }, null, 2))
  process.exit(findings.length ? 1 : 0)
}

if (findings.length === 0) {
  console.log('CLEAN — no credential patterns matched.')
  console.log('\nThis is a pattern scan, not a proof. A dump is still production')
  console.log('material: keep it outside the repository regardless of this result.')
  process.exit(0)
}

const byRule = new Map()
for (const f of findings) {
  if (!byRule.has(f.rule)) byRule.set(f.rule, [])
  byRule.get(f.rule).push(f)
}

console.log(`FINDINGS: ${findings.length} across ${byRule.size} categor${byRule.size === 1 ? 'y' : 'ies'}\n`)
for (const [rule, list] of [...byRule.entries()].sort()) {
  console.log(`── ${rule} — ${list[0].what} (${list.length})`)
  for (const f of list.slice(0, 20)) console.log(`   line ${String(f.line).padStart(7)}  ${f.masked}`)
  if (list.length > 20) console.log(`   … ${list.length - 20} more`)
  console.log()
}
console.log('Review each before using the dump. `opaque-blob` and `assigned-secret`')
console.log('produce false positives by design — they are wide on purpose.')
process.exit(1)
