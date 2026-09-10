import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')

/**
 * The surfaces outside `src/` where a build variable can actually be declared.
 *
 * ── Why scanning src/ alone was not enough ────────────────────────────────
 *
 * When the Alpha Vantage read was removed from browser-client.ts, this guard
 * passed — and `.env.example` was still telling every new developer to set
 * `VITE_ALPHA_VANTAGE_API_KEY`, with a comment claiming the data layer used
 * it. The code was clean and the instructions still described the defect.
 *
 * A `VITE_*` variable does not need a line in `src/` to reach the bundle. It
 * needs somewhere that SETS it, and those places are all outside `src/`: the
 * env template developers copy, the Netlify build config, the vite configs,
 * and CI workflow env blocks. That is the surface this list covers.
 *
 * Listed explicitly rather than walked, because a recursive scan of the
 * repository root would have to exclude node_modules, dist, .git and every
 * build artifact, and an exclusion list that grows is one that eventually
 * excludes the thing being checked.
 */
const CONFIG_SURFACES = [
  '.env.example',
  'netlify.toml',
  'vite.config.ts',
  'vite.mobile.config.ts',
  'vite.gallery.config.ts',
  'vite.desktop-harness.config.ts',
  'vite.invite-e2e.config.ts',
  '.github/workflows/ci.yml',
  '.github/workflows/ingest.yml',
]

/**
 * How many config surfaces must actually exist for the scan to mean anything.
 *
 * The failure mode this defends against is the whole list quietly evaluating
 * to nothing — a rename, a restructure, or a wrong `process.cwd()` — leaving a
 * check that reads zero files and reports zero findings. Set below the current
 * count so an ordinary file rename does not fail the build, and far enough
 * above zero that a silently empty scan does.
 */
const MIN_CONFIG_SURFACES = 5

/**
 * `docs/` is deliberately NOT scanned, and this is not a convenience carve-out.
 *
 * `docs/audit/platform-readiness-2026-08.md` and
 * `docs/audit/production-verification-pack.md` both name
 * the removed variables, because naming them is what those documents are for:
 * they are the record of the incident, written before it was fixed. A guard
 * that forced the audit trail to redact the thing it audited would be
 * destroying evidence to keep itself green.
 *
 * The distinction is causal rather than editorial. A markdown file cannot set
 * a build variable. Every surface in CONFIG_SURFACES can.
 */
const NOT_SCANNED_AND_WHY = 'docs/ — records the incident and cannot set a variable'

/**
 * Names that were removed on 2026-09-10 and may not come back.
 *
 * Detection-wise this set is redundant: both names contain KEY, so
 * SECRET_WORDS already catches them anywhere the scan reaches. It earns its
 * place by changing the MESSAGE — someone reintroducing one of these is
 * usually restoring an old config from memory or from a stale document, and
 * the useful thing to tell them is not "this looks like a credential" but
 * "this specific variable shipped a key in the bundle, and the server-side
 * secret you want is ALPHAVANTAGE_API_KEY".
 */
const RETIRED_BROWSER_KEYS = new Set([
  ['VITE', 'ALPHA', 'VANTAGE', 'API', 'KEY'].join('_'),
  ['VITE', 'FINNHUB', 'API', 'KEY'].join('_'),
])

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

/** Config surfaces that exist on disk, as absolute paths. */
export function existingConfigSurfaces(root: string = ROOT): string[] {
  return CONFIG_SURFACES.map(p => join(root, ...p.split('/'))).filter(p => existsSync(p))
}

/** Every credential-shaped VITE variable named in the given files. */
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

  it('declares no secret-shaped VITE variable in any config surface', () => {
    /*
      The gap that made this necessary: browser-client.ts was clean and
      `.env.example` was still instructing everyone to set the variable. Code
      does not have to name a build variable for the build variable to reach
      the bundle — something has to SET it, and those places are all here.
    */
    const surfaces = existingConfigSurfaces()
    const findings = browserKeyReads(surfaces)

    const report = findings
      .map(f => `  ${f.file}:${f.line}  ${f.variable}`)
      .join('\n')

    const retired = findings.filter(f => RETIRED_BROWSER_KEYS.has(f.variable))

    expect(
      findings,
      findings.length
        ? `A config surface declares a VITE_* variable that looks like a ` +
          `credential. Anything set under a VITE_ name is inlined into the ` +
          `bundle as a literal string.\n\n${report}\n\n` +
          (retired.length
            ? `At least one of these was REMOVED on 2026-09-10 because it ` +
              `shipped a working key in dist/assets/index-*.js. Nothing reads ` +
              `it. If you want Alpha Vantage back, the secret is ` +
              `ALPHAVANTAGE_API_KEY in Supabase function secrets, read by ` +
              `supabase/functions/market-news — never a VITE_ name.\n\n`
            : '') +
          `Not scanned, deliberately: ${NOT_SCANNED_AND_WHY}.`
        : '',
    ).toEqual([])
  })

  it('actually reads the config surfaces rather than an empty list', () => {
    /*
      Without this, a rename or a wrong working directory would leave the
      assertion above scanning zero files and passing forever. This is the
      difference between "no findings" and "no look".
    */
    const surfaces = existingConfigSurfaces()
    expect(
      surfaces.length,
      `Only ${surfaces.length} of ${CONFIG_SURFACES.length} config surfaces ` +
        `were found. If one was renamed, update CONFIG_SURFACES; a list that ` +
        `resolves to nothing is a check that reads nothing.`,
    ).toBeGreaterThanOrEqual(MIN_CONFIG_SURFACES)

    // The env template is the one that actually caused this, so its presence
    // is asserted by name rather than left to the count.
    expect(surfaces.some(p => p.endsWith('.env.example'))).toBe(true)
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

  it('flags a retired name in a config surface, not just in code', () => {
    /*
      The exact regression this extension exists to catch: the line that was
      in .env.example while browser-client.ts was already clean. Detected here
      through the same code path the real scan uses, over a file written for
      the purpose, so the assertion covers the reader as well as the regex.
    */
    const retired = [...RETIRED_BROWSER_KEYS][0]
    const probe = join(SRC, 'lib', 'security', '__tests__', '__config-probe.tmp')
    writeFileSync(probe, `# comment\n${retired}=\nVITE_SENTRY_DSN=\n`, 'utf8')
    try {
      const findings = browserKeyReads([probe])
      expect(findings).toHaveLength(1)
      expect(findings[0].variable).toBe(retired)
      expect(findings[0].line).toBe(2)
      expect(RETIRED_BROWSER_KEYS.has(findings[0].variable)).toBe(true)
    } finally {
      rmSync(probe, { force: true })
    }
  })

  it('leaves the audit trail alone', () => {
    /*
      docs/ names the retired variables because recording the incident is what
      those documents are for. If docs/ were ever added to CONFIG_SURFACES,
      this fails — which is the point: the exclusion should cost a deliberate
      edit here, not go unnoticed.
    */
    expect(CONFIG_SURFACES.some(p => p.startsWith('docs/'))).toBe(false)
    expect(NOT_SCANNED_AND_WHY).toContain('docs/')
  })
})
