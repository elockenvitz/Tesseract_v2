/**
 * The architectural invariants, asserted rather than documented.
 *
 * Each test here corresponds to a rule in the stage brief. They are the reason
 * the next person can add a seventh situation without re-reading five files —
 * if they break one of these, the suite says which rule and why.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { SITUATION_DEFINITIONS } from '../situations'
import { PRIMITIVE_COMPONENTS } from '../presentation'
import type { FindingKind } from '../finding'
import { ALL_CANONICAL } from './fixtures'

const REPO_ROOT = resolve(__dirname, '../../../..')

const ENGINE_FILES = [
  'facts.ts', 'finding.ts', 'situation.ts', 'situations.ts',
  'builders.ts', 'importance.ts', 'presentation.ts', 'resolver.ts', 'index.ts',
].map(f => ({
  name: f,
  source: readFileSync(resolve(__dirname, '..', f), 'utf8'),
}))

describe('the engine is pure', () => {
  it('imports no React, no Supabase and no component', () => {
    for (const { name, source } of ENGINE_FILES) {
      const imports = [...source.matchAll(/from '([^']+)'/g)].map(m => m[1])
      for (const spec of imports) {
        expect(
          spec.includes('react') || spec.includes('supabase') || spec.includes('components'),
          `${name} imports ${spec}`,
        ).toBe(false)
      }
    }
  })

  it('reads no clock of its own', () => {
    for (const { name, source } of ENGINE_FILES) {
      expect(source.includes('Date.now('), `${name} calls Date.now`).toBe(false)
    }
  })
})

/**
 * Executable lines only.
 *
 * Both boundary tests below are about what the CODE can see, and both files
 * discuss the boundary in prose directly above the code that holds it — the
 * builder header says in as many words that finding `'timeline'` in it means
 * the valve has broken. A scan that cannot tell an explanation from a branch
 * fails on its own documentation, which teaches the next person to delete the
 * documentation.
 */
const executable = (file: string): string =>
  readFileSync(resolve(__dirname, '..', file), 'utf8')
    .split('\n')
    .filter(l => {
      const t = l.trimStart()
      return t !== '' && !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')

describe('a finding kind is not a component', () => {
  /**
   * The load-bearing test of the whole stage.
   *
   * If the resolver can see a finding kind, it can special-case one, and the
   * next family to need "just a small tweak" gets a branch instead of a shape.
   * Six branches later the engine is the seven card components again.
   */
  it('the resolver never mentions a FindingKind', () => {
    const body = executable('resolver.ts')
    const kinds = Object.keys(SITUATION_DEFINITIONS) as FindingKind[]
    for (const kind of kinds) {
      expect(body.includes(`'${kind}'`), `resolver branches on ${kind}`).toBe(false)
    }
  })

  it('a builder never names a visual primitive', () => {
    const body = executable('builders.ts')
    for (const primitive of Object.keys(PRIMITIVE_COMPONENTS)) {
      if (primitive === 'none') continue
      expect(body.includes(`'${primitive}'`), `builders name ${primitive}`).toBe(false)
    }
  })
})

describe('the visual vocabulary is closed and already exists', () => {
  it('every primitive resolves to a component on disk', () => {
    for (const [primitive, path] of Object.entries(PRIMITIVE_COMPONENTS)) {
      if (path === null) continue
      expect(
        () => readFileSync(resolve(REPO_ROOT, path), 'utf8'),
        `${primitive} points at ${path}`,
      ).not.toThrow()
    }
  })
})

describe('the situation table is exhaustive', () => {
  it('every canonical kind declares a question, a predicate and a signal type', () => {
    for (const [kind, def] of Object.entries(SITUATION_DEFINITIONS)) {
      expect(def.question, `${kind} question`).toBeTruthy()
      expect(def.predicate, `${kind} predicate`).toBeTruthy()
      expect(def.signalType, `${kind} signalType`).toBeTruthy()
      expect(def.intents.length, `${kind} intents`).toBeGreaterThan(0)
      expect(def.intents, `${kind} restates inspect_subject`).not.toContain('inspect_subject_redundant')
    }
  })

  it('all six canonical situations build from facts', () => {
    const findings = ALL_CANONICAL()
    expect(findings).toHaveLength(6)
    expect(new Set(findings.map(f => f.kind)).size).toBe(6)
  })

  it('every predicate is exercised by the canonical set', () => {
    const predicates = new Set(ALL_CANONICAL().map(f => f.claim.predicate))
    expect([...predicates].sort()).toEqual(
      ['absent', 'awaiting', 'expired', 'outside_band', 'unowned', 'unreviewed'])
  })
})
