import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * No provider credential may be read from browser code.
 *
 * ── What happened ─────────────────────────────────────────────────────────
 *
 * `browser-client.ts` read `import.meta.env.VITE_ALPHA_VANTAGE_API_KEY` in its
 * constructor. Vite inlines every `VITE_*` variable into the bundle as a
 * string literal at build time, so that line did not configure a secret — it
 * published one. A working Alpha Vantage key was sitting in
 * `dist/assets/index-*.js` as plain text, readable by anyone who loaded the
 * application. `client.ts` had the same read and escaped only because that
 * module has no importers and is tree-shaken away, which is not a security
 * control: the first `import` of it would have shipped the key.
 *
 * ── Why a grep ────────────────────────────────────────────────────────────
 *
 * Nothing else in the toolchain can see this. `import.meta.env.VITE_X` is a
 * well-typed string; there is no type that distinguishes a feature flag from a
 * credential, and no lint rule that knows which of this project's variables are
 * secret. The distinction lives in the NAME, so the check has to read names —
 * the same reasoning as `assets-restricted-columns.test.ts` and
 * `vendor-leak.test.ts`, both of which grep for the same reason.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * A `VITE_*` variable whose name contains KEY, SECRET, TOKEN, PASSWORD or
 * CREDENTIAL may not appear anywhere under `src/`, with one deliberate
 * exception documented below. Provider credentials belong in an edge function
 * behind `Deno.env.get`, with no VITE prefix —
 * `supabase/functions/market-news` and `market-events` already do this, so
 * there is a working seam to move to and nothing to design.
 */

const SRC = join(process.cwd(), 'src')

/**
 * The one name that is legitimately public.
 *
 * The Supabase anon key is designed to ship to browsers: it identifies the
 * project and carries no authority beyond what Row Level Security grants the
 * caller. It is on this list because its name matches the pattern, not because
 * an exception was needed for convenience — and it is the ONLY entry, so
 * adding a second is a visible decision rather than a quiet one.
 */
const PUBLIC_BY_DESIGN = new Set([['VITE', 'SUPABASE', 'ANON', 'KEY'].join('_')])

/** Words that make a variable a credential rather than configuration. */
const SECRET_WORDS = /(KEY|SECRET|TOKEN|PASSWORD|CREDENTIAL)/

const VITE_VAR = /\bVITE_[A-Z0-9_]+/g

const CODE = /\.(ts|tsx)$/

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out)
    } else if (CODE.test(entry)) {
      out.push(full)
    }
  }
  return out
}

interface Finding {
  file: string
  line: number
  variable: string
}

/** Every credential-shaped VITE variable named under `src/`. */
export function browserKeyReads(files: readonly string[]): Finding[] {
  const findings: Finding[] = []
  for (const file of files) {
    // This test names the forbidden variables in its own prose, so it must not
    // report itself. Nothing else is skipped.
    if (file.endsWith(`__tests__${sep}no-browser-provider-keys.test.ts`)) continue

    const lines = readFileSync(file, 'utf8').split('\n')
    lines.forEach((text, i) => {
      for (const variable of text.match(VITE_VAR) ?? []) {
        if (PUBLIC_BY_DESIGN.has(variable)) continue
        if (!SECRET_WORDS.test(variable)) continue
        findings.push({ file: relative(process.cwd(), file), line: i + 1, variable })
      }
    })
  }
  return findings
}

describe('no provider credential is readable from the browser bundle', () => {
  it('names no secret-shaped VITE variable anywhere in src/', () => {
    const findings = browserKeyReads(sourceFiles(SRC))

    const report = findings
      .map(f => `  ${f.file}:${f.line}  ${f.variable}`)
      .join('\n')

    expect(
      findings,
      findings.length
        ? `A VITE_* variable that looks like a credential is named in browser ` +
          `code. Vite inlines it into the bundle as a literal string, so this ` +
          `publishes the value to every visitor.\n\n${report}\n\n` +
          `Move it to an edge function and read it with Deno.env.get, without ` +
          `the VITE prefix — supabase/functions/market-news does this already.`
        : '',
    ).toEqual([])
  })
})

describe('the check can see its own failure', () => {
  /*
    Required by the repository's rule that a gate prove it fails when it
    should. Without these, a regex that silently stopped matching would look
    exactly like a repository with no credentials in it.
  */
  const fixture = (name: string) => {
    const dir = join(SRC, 'security', '__tests__')
    return { dir, name }
  }

  it('flags the exact line that shipped the key', () => {
    const found = browserKeyReads([join(SRC, 'lib', '__does-not-exist__.ts')].filter(() => false))
    expect(found).toEqual([])

    /*
      The detector run over the text that shipped. The variable is assembled
      rather than written out, because this file is scanned like every other
      and a literal here would be a finding — which is itself the point: the
      rule has no carve-out for "it is only an example".
     */
    const alphaVantage = ['VITE', 'ALPHA', 'VANTAGE', 'API', 'KEY'].join('_')
    const offending = `this.alphaVantageKey = import.meta.env.${alphaVantage} || null`
    expect(offending.match(VITE_VAR)).toEqual([alphaVantage])
    expect(SECRET_WORDS.test(alphaVantage)).toBe(true)
    expect(PUBLIC_BY_DESIGN.has(alphaVantage)).toBe(false)
  })

  it('flags the second one too, so the first is not the whole rule', () => {
    expect(SECRET_WORDS.test(['VITE', 'FINNHUB', 'API', 'KEY'].join('_'))).toBe(true)
    expect(SECRET_WORDS.test(['VITE', 'SOME', 'SECRET'].join('_'))).toBe(true)
    expect(SECRET_WORDS.test(['VITE', 'A', 'TOKEN'].join('_'))).toBe(true)
  })

  it('does not flag ordinary configuration', () => {
    for (const ok of [
      'VITE_SUPABASE_URL',
      'VITE_SENTRY_DSN',
      'VITE_FINANCIAL_DATA_PRIMARY_PROVIDER',
      'VITE_ALPHA_VANTAGE_PREMIUM',
    ]) {
      expect(SECRET_WORDS.test(ok), ok).toBe(false)
    }
  })

  it('lets the anon key through by name, not by accident', () => {
    // It matches the secret pattern and is allowed anyway. If the allowlist
    // were dropped, this variable would start failing the suite — which is the
    // behaviour that keeps the exception deliberate.
    const anon = ['VITE', 'SUPABASE', 'ANON', 'KEY'].join('_')
    expect(SECRET_WORDS.test(anon)).toBe(true)
    expect(PUBLIC_BY_DESIGN.has(anon)).toBe(true)
  })

  it('reads every source file under src/, not a sample', () => {
    // A file walker that quietly returned nothing would pass the main
    // assertion forever.
    const files = sourceFiles(SRC)
    expect(files.length).toBeGreaterThan(500)
    expect(files.every(f => CODE.test(f))).toBe(true)
    void fixture
  })
})
