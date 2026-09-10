/**
 * The deploy target must be named, and the function must be named.
 *
 * ── What this pins ────────────────────────────────────────────────────────
 *
 * `supabase functions deploy market-news` with no project flag is a valid
 * command that ships to whatever `supabase link` last wrote into
 * `supabase/.temp`. Here that is production, while this worktree's `.env.local`
 * points at staging — so the shortest command silently targets prod and the
 * call site shows nothing about where it went.
 *
 * `scripts/supabase-target.mjs` removes the no-ref form. These tests exist
 * because a refusal that stops refusing is indistinguishable from a repository
 * where nobody ever passes bad arguments: every assertion below is a case that
 * must FAIL to resolve, and the two refs are pinned so a silent edit to either
 * shows up as a test change in the diff.
 */
import { describe, expect, it } from 'vitest'

import {
  TARGETS,
  resolveDeploy,
  // @ts-expect-error — plain .mjs script, no type declarations by design
} from '../../../../scripts/supabase-target.mjs'

/** Pretend every function exists, so slug rules are tested independently. */
const anyExists = () => true
const run = (argv: string[], exists = anyExists) =>
  resolveDeploy(argv, { root: '/repo', exists })

describe('the two projects are pinned', () => {
  it('maps exactly prod and staging, and nothing else', () => {
    expect(Object.keys(TARGETS).sort()).toEqual(['prod', 'staging'])
  })

  it('carries the refs verified against the Management API', () => {
    // Production is the ACTIVE_HEALTHY project that serves the app; staging is
    // a separate, currently inactive project. Swapping these two is the whole
    // accident this file is here to make visible.
    expect(TARGETS.prod).toBe('wfcebeagznzgeuyysbnt')
    expect(TARGETS.staging).toBe('pdajkwtrrjcqnjsyvyqt')
  })
})

describe('a missing target is refused, never defaulted', () => {
  it('refuses no arguments at all', () => {
    const r = run([])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('No environment given')
  })

  it('names both valid environments in the refusal', () => {
    // The message has to be actionable, or the next person guesses.
    const r = run([])
    expect(r.error).toContain('prod')
    expect(r.error).toContain('staging')
  })

  it('does not fall back to the linked project', () => {
    // The failure mode in one assertion: nothing resolvable comes back, so
    // there is no ref to deploy to.
    const r = run([])
    expect(r.ref).toBeUndefined()
    expect(r.args).toBeUndefined()
  })
})

describe('an unknown target is refused', () => {
  for (const bad of ['production', 'stage', 'dev', 'PROD', 'Prod', 'wfcebeagznzgeuyysbnt', '']) {
    it(`refuses ${JSON.stringify(bad)}`, () => {
      const r = run([bad, 'market-news'])
      expect(r.ok).toBe(false)
      expect(r.ref).toBeUndefined()
    })
  }

  it('is case sensitive, so PROD is not prod', () => {
    // Accepting case variants means accepting near-misses, and a near-miss is
    // how somebody reaches the wrong project believing they typed the right one.
    expect(run(['PROD', 'market-news']).ok).toBe(false)
    expect(run(['prod', 'market-news']).ok).toBe(true)
  })

  it('cannot be tricked by an inherited object key', () => {
    // `hasOwnProperty` rather than `in`: without it, "constructor" and
    // "toString" resolve to a truthy value and produce a ref of undefined.
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      const r = run([key, 'market-news'])
      expect(r.ok, key).toBe(false)
    }
  })
})

describe('the function name is required and checked', () => {
  it('refuses a valid environment with no function', () => {
    const r = run(['prod'])
    expect(r.ok).toBe(false)
    expect(r.error).toContain('No function name given')
  })

  it('suggests the right invocation for the environment given', () => {
    expect(run(['staging']).error).toContain('deploy:fn:staging')
    expect(run(['prod']).error).toContain('deploy:fn:prod')
  })

  for (const bad of ['Market-News', 'market_news', '-market', 'market news', '../etc']) {
    it(`refuses the slug ${JSON.stringify(bad)}`, () => {
      expect(run(['prod', bad]).ok).toBe(false)
    })
  }

  it('refuses a function that does not exist on disk', () => {
    const r = resolveDeploy(['prod', 'no-such-fn'], { root: '/repo', exists: () => false })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('supabase/functions/no-such-fn/index.ts')
  })

  it('checks the entry point of the function actually named', () => {
    const seen: string[] = []
    resolveDeploy(['prod', 'market-news'], {
      root: '/repo',
      exists: (p: string) => { seen.push(p); return true },
    })
    expect(seen).toHaveLength(1)
    expect(seen[0].replace(/\\/g, '/')).toBe('/repo/supabase/functions/market-news/index.ts')
  })
})

describe('a complete invocation resolves to an explicit command', () => {
  it('always carries --project-ref, so the link is never consulted', () => {
    const r = run(['prod', 'market-news'])
    expect(r.ok).toBe(true)
    expect(r.args).toEqual([
      'functions', 'deploy', 'market-news', '--project-ref', 'wfcebeagznzgeuyysbnt',
    ])
  })

  it('sends staging to the staging ref', () => {
    expect(run(['staging', 'market-news']).args).toContain('pdajkwtrrjcqnjsyvyqt')
    expect(run(['staging', 'market-news']).args).not.toContain('wfcebeagznzgeuyysbnt')
  })

  it('passes extra CLI arguments through untouched', () => {
    // `--use-api` matters on a machine without Docker, so passthrough is not
    // decoration. This script does not vet what it forwards; see its header.
    const r = run(['prod', 'market-news', '--use-api', '--debug'])
    expect(r.args.slice(-2)).toEqual(['--use-api', '--debug'])
  })

  it('never resolves a ref that is not one of the two', () => {
    const refs = ['prod', 'staging'].map(e => run([e, 'market-news']).ref)
    expect(new Set(refs)).toEqual(new Set(Object.values(TARGETS)))
  })
})
