import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * Every write to `portfolio_holdings` must name the rows it is writing.
 *
 * ── Why this table, and why only writes ───────────────────────────────────
 *
 * Verified against the production database rather than the migrations, which
 * do not describe it:
 *
 *   SELECT policy   portfolio_in_current_org(portfolio_id)   TO authenticated
 *   INSERT policy   WITH CHECK (auth.uid() = created_by)     TO authenticated
 *   UPDATE/DELETE   (auth.uid() = created_by)
 *                    OR (portfolio_in_current_org(...) AND org admin)
 *
 * READS are therefore scoped by the database to the caller's current
 * organization, whatever the client asks for. An unfiltered `select` returns
 * that organization's rows and no others, so the 24 client reads that carry no
 * organization predicate are a defence-in-depth gap and not a leak. They are
 * deliberately not the subject here.
 *
 * WRITES are where the table is exposed, in two different ways.
 *
 * ── 1. An unfiltered UPDATE or DELETE empties the book ────────────────────
 *
 * `.from('portfolio_holdings').delete()` with no filter is valid PostgREST. It
 * deletes every row the policy admits — which, for an org admin, is the whole
 * organization's book. No confirmation, no undo, one missing `.eq`. That is
 * what this file makes impossible to add by accident.
 *
 * ── 2. An INSERT that names no portfolio cannot be scoped at all ──────────
 *
 * `portfolio_holdings` has no `organization_id` column; the org lives on
 * `portfolios` and is reached through `portfolio_id`. A row inserted without
 * one has nothing to scope it by, and nothing downstream can decide whose book
 * it belongs to.
 *
 * ── What this does NOT claim to do ────────────────────────────────────────
 *
 * It does not verify that the `portfolio_id` being written belongs to the
 * caller's organization. It cannot: the value is a runtime variable. That
 * check belongs in the INSERT policy's WITH CHECK, which today is
 * `auth.uid() = created_by` — and `created_by` DEFAULTS to `auth.uid()`, so the
 * predicate is satisfied by construction for every authenticated caller and
 * constrains nothing. The drafted migration
 * `20260910130000_portfolio_holdings_write_org_scope.sql` closes that; this
 * test is the half that can be enforced statically.
 */

const ROOT = process.cwd()

/** Production code only. Tests are allowed to construct anything. */
const ROOTS = ['src', 'supabase/functions', 'netlify/functions']
const CODE = /\.(ts|tsx|mjs)$/
const IS_TEST = /(__tests__|\.test\.|\.spec\.)/

const TABLE = "from('portfolio_holdings')"

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[]
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    const full = path.join(dir, e)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (CODE.test(e) && !IS_TEST.test(full)) out.push(full)
  }
  return out
}

export interface WriteSite {
  file: string
  line: number
  op: 'INSERT' | 'UPSERT' | 'UPDATE' | 'DELETE'
  bound: boolean
}

/**
 * The statement around a `.from('portfolio_holdings')`.
 *
 * Supabase puts the verb on either side of `.from(...)` depending on the
 * builder style in use — `.from(t).delete().eq(...)` and
 * `.from(t).insert({...})` both occur here — so a window on both sides is what
 * makes the classification independent of which style a call site chose.
 */
function windowAround(src: string, at: number): { before: string; after: string } {
  const after = (() => {
    const rest = src.slice(at)
    const nextFrom = rest.indexOf(".from('", 1)
    const blank = rest.search(/\n[ \t]*\n/)
    const ends = [nextFrom, blank].filter(i => i > 0)
    return ends.length ? rest.slice(0, Math.min(...ends)) : rest.slice(0, 900)
  })()
  return { before: src.slice(Math.max(0, at - 240), at), after }
}

/** Every production write to the table, with whether it names its rows. */
export function holdingsWriteSites(files: readonly string[]): WriteSite[] {
  const sites: WriteSite[] = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    let at = src.indexOf(TABLE)
    while (at !== -1) {
      const { before, after } = windowAround(src, at)
      const both = before + after

      const op: WriteSite['op'] | null =
        /\.upsert\(/.test(both) ? 'UPSERT'
        : /\.insert\(/.test(both) ? 'INSERT'
        : /\.update\(/.test(both) ? 'UPDATE'
        : /\.delete\(/.test(both) ? 'DELETE'
        : null

      if (op) {
        // INSERT/UPSERT take no filters — the scope has to be in the payload.
        // UPDATE/DELETE take no payload — the scope has to be in a filter.
        const bound =
          op === 'INSERT' || op === 'UPSERT'
            ? /portfolio_id/.test(both)
            : /\.(eq|in)\(\s*'(portfolio_id|id)'/.test(after)

        sites.push({
          file: path.relative(ROOT, file).replace(/\\/g, '/'),
          line: src.slice(0, at).split('\n').length,
          op,
          bound,
        })
      }
      at = src.indexOf(TABLE, at + TABLE.length)
    }
  }
  return sites
}

const FILES = ROOTS.flatMap(r => walk(path.join(ROOT, r)))

/**
 * Each scan below reads every production file in the repository. Alone that
 * takes about 4s; under the full parallel `guard:unit` run it went past
 * vitest's 5s default and failed on time rather than on a finding. The limit
 * is raised for the scans only — the fixture tests keep the default.
 */
const SCAN_TIMEOUT_MS = 30_000

describe('no write to portfolio_holdings is unbounded', () => {
  it('finds the write sites at all', () => {
    // A walker that returned nothing would pass the real assertion forever.
    expect(FILES.length).toBeGreaterThan(400)
    const sites = holdingsWriteSites(FILES)
    expect(sites.length).toBeGreaterThan(0)
  }, SCAN_TIMEOUT_MS)

  it('every INSERT and UPSERT carries a portfolio_id', () => {
    const bad = holdingsWriteSites(FILES)
      .filter(s => (s.op === 'INSERT' || s.op === 'UPSERT') && !s.bound)
    expect(
      bad,
      bad.length
        ? `A row written to portfolio_holdings with no portfolio_id cannot be ` +
          `scoped to an organization — the table has no organization_id and the ` +
          `org lives on portfolios.\n` +
          bad.map(s => `  ${s.file}:${s.line}  ${s.op}`).join('\n')
        : '',
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)

  it('every UPDATE and DELETE names the rows it touches', () => {
    const bad = holdingsWriteSites(FILES)
      .filter(s => (s.op === 'UPDATE' || s.op === 'DELETE') && !s.bound)
    expect(
      bad,
      bad.length
        ? `An unfiltered UPDATE or DELETE on portfolio_holdings hits every row ` +
          `the policy admits — for an org admin that is the whole organization's ` +
          `book, with no confirmation and no undo. Add .eq('id', …), ` +
          `.eq('portfolio_id', …) or .in('portfolio_id', …).\n` +
          bad.map(s => `  ${s.file}:${s.line}  ${s.op}`).join('\n')
        : '',
    ).toEqual([])
  }, SCAN_TIMEOUT_MS)
})

describe('the check can see its own failure', () => {
  /*
    Required by the repository's rule that a gate prove it fails when it
    should. Each fixture is written to a temp file and run through the same
    detector the real scan uses, so the reader is covered as well as the regex.
  */
  const probe = (body: string, name: string): WriteSite[] => {
    const dir = path.join(ROOT, 'src', 'lib', 'security', '__tests__')
    const file = path.join(dir, `__ph-probe-${name}.tmp`)
    const fs = require('node:fs') as typeof import('node:fs')
    fs.writeFileSync(file, body, 'utf8')
    try { return holdingsWriteSites([file]) } finally { fs.rmSync(file, { force: true }) }
  }

  it('flags a delete with no filter', () => {
    const s = probe(`await supabase.from('portfolio_holdings').delete()\n`, 'del')
    expect(s).toHaveLength(1)
    expect(s[0].op).toBe('DELETE')
    expect(s[0].bound).toBe(false)
  })

  it('accepts a delete filtered by portfolio', () => {
    const s = probe(`await supabase.from('portfolio_holdings').delete().eq('portfolio_id', id)\n`, 'del-ok')
    expect(s[0].bound).toBe(true)
  })

  it('accepts a delete filtered by row id', () => {
    const s = probe(`await supabase.from('portfolio_holdings').delete().eq('id', row.id)\n`, 'del-row')
    expect(s[0].bound).toBe(true)
  })

  it('flags an update with no filter', () => {
    const s = probe(`await supabase.from('portfolio_holdings').update({ shares: 0 })\n`, 'upd')
    expect(s[0].op).toBe('UPDATE')
    expect(s[0].bound).toBe(false)
  })

  it('flags an insert with no portfolio_id', () => {
    const s = probe(`await supabase.from('portfolio_holdings').insert({ asset_id: a, shares: 1 })\n`, 'ins')
    expect(s[0].op).toBe('INSERT')
    expect(s[0].bound).toBe(false)
  })

  it('accepts an insert that names the portfolio', () => {
    const s = probe(`await supabase.from('portfolio_holdings').insert({ portfolio_id: p, asset_id: a })\n`, 'ins-ok')
    expect(s[0].bound).toBe(true)
  })

  it('classifies the verb whichever side of .from() it sits on', () => {
    // `.from(t).delete()` and `.delete()` after an await chain both occur in
    // this repository; a detector that only looked forward would miss half.
    const a = probe(`await supabase.from('portfolio_holdings').delete().eq('id', x)\n`, 'side-a')
    const b = probe(`const q = supabase.delete()\n  .from('portfolio_holdings')\n  .eq('id', x)\n`, 'side-b')
    expect(a[0].op).toBe('DELETE')
    expect(b[0].op).toBe('DELETE')
  })

  it('ignores a plain read', () => {
    const s = probe(`const { data } = await supabase.from('portfolio_holdings').select('asset_id')\n`, 'sel')
    expect(s).toHaveLength(0)
  })
})
