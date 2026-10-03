/**
 * Edge Functions read the publishable key, not the legacy anon key.
 *
 * ── Why this matters ─────────────────────────────────────────────────────
 *
 * The production legacy `anon` key is being retired. Three deployed functions
 * blocked that, each for the same reason: they read `SUPABASE_ANON_KEY` to
 * build a request-scoped client that forwards the caller's own
 * `Authorization` header to `auth.getUser()`. None used it for anon-level
 * data access, so a publishable key fills the role exactly.
 *
 * The replacement variable is a JSON dictionary, not a plain string, and the
 * obvious one-liner —
 *
 *     JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')!)['default']
 *
 * — has three distinct failure modes and handles none of them. The worst is
 * the quiet one: a dictionary with no `default` yields `undefined`, which
 * builds a client that fails later with an error pointing at the request
 * instead of the configuration. So the resolver returns a typed result and
 * these pin each case.
 *
 * The last block is the regression guard: it reads the function sources and
 * fails if any of the three reverts to the legacy variable.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import {
  resolvePublishableKey,
  requirePublishableKey,
  DEFAULT_KEY_NAME,
  PUBLISHABLE_KEYS_VAR,
} from '../../../../supabase/functions/_shared/publishable-key'

/** A fake Deno.env.get over a fixed map. */
const envOf = (vars: Record<string, string>) => (name: string) => vars[name]

const KEY = 'sb_publishable_test_value_not_a_real_key'

describe('a well-formed publishable key dictionary', () => {
  it('returns the default key', () => {
    const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: JSON.stringify({ default: KEY }) }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.key).toBe(KEY)
  })

  it('selects by name when several keys exist', () => {
    const env = envOf({
      [PUBLISHABLE_KEYS_VAR]: JSON.stringify({ default: KEY, web: 'sb_publishable_web' }),
    })
    const a = resolvePublishableKey(env)
    const b = resolvePublishableKey(env, 'web')
    expect(a.ok && a.key).toBe(KEY)
    expect(b.ok && b.key).toBe('sb_publishable_web')
  })

  it('defaults to the name Supabase creates', () => {
    expect(DEFAULT_KEY_NAME).toBe('default')
  })

  it('requirePublishableKey returns the key rather than throwing', () => {
    const env = envOf({ [PUBLISHABLE_KEYS_VAR]: JSON.stringify({ default: KEY }) })
    expect(requirePublishableKey(env)).toBe(KEY)
  })
})

describe('a missing variable', () => {
  it('fails as env_missing rather than throwing a TypeError', () => {
    const r = resolvePublishableKey(envOf({}))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toBe('env_missing')
  })

  it('treats an empty or whitespace value as missing', () => {
    for (const v of ['', '   ']) {
      const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: v }))
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.failure).toBe('env_missing')
    }
  })

  it('names the variable in the message, so the fix is obvious', () => {
    const r = resolvePublishableKey(envOf({}))
    if (!r.ok) expect(r.message).toContain(PUBLISHABLE_KEYS_VAR)
  })
})

describe('a malformed variable', () => {
  it('fails as env_malformed rather than throwing a SyntaxError', () => {
    const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: '{not json' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toBe('env_malformed')
  })

  it('rejects valid JSON that is not a dictionary', () => {
    // A bare string is what the LEGACY variable held. Accepting it would let
    // a half-finished migration appear to work.
    for (const v of ['"sb_publishable_bare_string"', '["a"]', 'null', '42']) {
      const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: v }))
      expect(r.ok, `should reject ${v}`).toBe(false)
      if (!r.ok) expect(['env_malformed', 'env_not_an_object']).toContain(r.failure)
    }
  })
})

describe('a dictionary without the requested key', () => {
  it('fails as key_missing instead of returning undefined', () => {
    // The quiet failure: `['default']` on this object is undefined, and a
    // client built from undefined fails later at the request.
    const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: JSON.stringify({ web: KEY }) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toBe('key_missing')
  })

  it('lists the names that ARE present, without any value', () => {
    const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: JSON.stringify({ web: KEY, billing: 'x' }) }))
    if (!r.ok) {
      expect(r.message).toContain('web')
      expect(r.message).toContain('billing')
      expect(r.message).not.toContain(KEY)
    }
  })

  it('rejects an empty-string key', () => {
    const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: JSON.stringify({ default: '' }) }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.failure).toBe('key_missing')
  })

  it('requirePublishableKey throws, naming the variable', () => {
    expect(() => requirePublishableKey(envOf({}))).toThrow(PUBLISHABLE_KEYS_VAR)
  })

  it('never puts a key value in a failure message', () => {
    const cases = [
      JSON.stringify({ web: KEY }),
      JSON.stringify({ default: '' }),
      '{not json',
      '"' + KEY + '"',
    ]
    for (const v of cases) {
      const r = resolvePublishableKey(envOf({ [PUBLISHABLE_KEYS_VAR]: v }))
      if (!r.ok) expect(r.message).not.toContain(KEY)
    }
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The functions themselves
// ───────────────────────────────────────────────────────────────────────────

const FN = (slug: string) =>
  path.join(process.cwd(), 'supabase', 'functions', slug, 'index.ts')

/** Source with comments stripped, so prose about the migration cannot satisfy
 *  or break an assertion about code. */
const codeOf = (p: string) =>
  readFileSync(p, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')

describe('ai-chat builds its user client from the publishable key', () => {
  const src = () => codeOf(FN('ai-chat'))

  it('does not read the legacy anon variable', () => {
    expect(src()).not.toContain('SUPABASE_ANON_KEY')
  })

  it('resolves the key through the shared helper', () => {
    const s = src()
    expect(s).toContain('requirePublishableKey')
    expect(s).toContain('_shared/publishable-key.ts')
  })

  it('still forwards the caller Authorization header', () => {
    // The whole point of this client. Losing it would silently promote every
    // request to an unauthenticated one.
    const s = src()
    expect(s).toContain('global: { headers: { Authorization: authHeader } }')
    expect(s).toContain('req.headers.get("Authorization")')
  })

  it('still rejects a request with no Authorization header', () => {
    expect(src()).toContain('if (!authHeader) throw new Error("Missing authorization header")')
  })

  it('still identifies the caller with auth.getUser()', () => {
    expect(src()).toContain('auth.getUser()')
  })

  it('does not fall back to an empty key', () => {
    // The old line was `Deno.env.get("SUPABASE_ANON_KEY") ?? ""`, which built
    // a client from "" and failed at the first request instead of at config.
    expect(src()).not.toMatch(/createClient\(\s*supabaseUrl\s*,\s*""/)
  })

  it('introduces no service-role client', () => {
    // ai-chat never had one, and this migration must not add privilege:
    // its only client is the caller-scoped one. An earlier version of this
    // assertion compared a count against itself and was vacuous.
    expect(src()).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
    expect(src().match(/createClient\(/g) ?? []).toHaveLength(1)
  })
})

describe('the calendar functions keep their imported behaviour', () => {
  /*
   * These two were deployed but had never been version-controlled. Their
   * source was downloaded from the live project with the Supabase CLI and
   * committed unmodified apart from the key swap, so these assertions pin
   * the parts the migration had to leave alone.
   */
  it('calendar-oauth-start still forwards the caller Authorization header', () => {
    const s = codeOf(FN('calendar-oauth-start'))
    expect(s).toContain("req.headers.get('Authorization')")
    expect(s).toContain('global: { headers: { Authorization: authHeader } }')
    expect(s).toContain('auth.getUser()')
  })

  it('calendar-oauth-start introduces no service-role client', () => {
    // It never had one; the migration must not add privilege.
    expect(codeOf(FN('calendar-oauth-start'))).not.toContain('SUPABASE_SERVICE_ROLE_KEY')
  })

  it('calendar-sync keeps its service-role client EXACTLY as it was', () => {
    // It has two clients. Only the user-scoped one was migrated; the
    // service-role one must still read the legacy service-role variable,
    // because that key is out of scope for this change.
    const s = codeOf(FN('calendar-sync'))
    expect(s).toContain("Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''")
    expect(s.match(/createClient\(/g) ?? []).toHaveLength(2)
  })

  it('calendar-sync still forwards the caller Authorization header', () => {
    const s = codeOf(FN('calendar-sync'))
    expect(s).toContain("req.headers.get('Authorization')")
    expect(s).toContain('global: { headers: { Authorization: authHeader } }')
    expect(s).toContain('auth.getUser()')
  })

  it.each(['calendar-oauth-start', 'calendar-sync'])('%s resolves via the shared helper', slug => {
    const s = codeOf(FN(slug))
    expect(s).toContain('requirePublishableKey((n) => Deno.env.get(n))')
    expect(s).toContain('_shared/publishable-key.ts')
  })
})

describe('no migrated function reverts to the legacy anon key', () => {
  /** The three that blocked retiring the production legacy anon key. */
  const MIGRATED = ['ai-chat', 'calendar-oauth-start', 'calendar-sync']

  it.each(MIGRATED)('%s is present in the repo', slug => {
    // They are all version-controlled now, so an absent file is a real
    // failure rather than a case to skip.
    expect(existsSync(FN(slug)), `${slug} source missing`).toBe(true)
  })

  it.each(MIGRATED)('%s does not read SUPABASE_ANON_KEY', slug => {
    expect(codeOf(FN(slug))).not.toContain('SUPABASE_ANON_KEY')
  })

  it('only `attention` still reads the legacy variable, and it is not deployed', () => {
    // A whole-tree sweep, so a fourth consumer appearing is caught here.
    const dir = path.join(process.cwd(), 'supabase', 'functions')
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs')
    const offenders: string[] = []
    for (const slug of readdirSync(dir)) {
      const f = path.join(dir, slug, 'index.ts')
      if (!statSync(path.join(dir, slug)).isDirectory() || !existsSync(f)) continue
      if (codeOf(f).includes('SUPABASE_ANON_KEY')) offenders.push(slug)
    }
    expect(offenders).toEqual(['attention'])
  })
})
