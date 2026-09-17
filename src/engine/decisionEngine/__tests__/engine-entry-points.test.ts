/**
 * Every engine entry point must hand the evaluators the same facts.
 *
 * ── The defect this exists to prevent ────────────────────────────────────
 *
 * There are two hooks that run `runGlobalDecisionEngine`. When
 * `thesis.reviewed` was wired, only ONE of them was given the reviews map.
 * The other feeds Today, the dashboard feed, the attention feed and the
 * asset/portfolio views -- so on every surface a person actually looks at,
 * `evaluateThesisStale` fell back to the written date alone, a recorded
 * review cleared nothing, and the stale finding returned every morning.
 *
 * That is precisely the defect the review verb was built to end, reappearing
 * one layer up. It was found in live acceptance, not by any test, because
 * every unit suite was correct in isolation: the evaluator honours the map it
 * is given, and the wired hook passes one. Nothing asserted that EVERY caller
 * does.
 *
 * ── Why this is a structural test ────────────────────────────────────────
 *
 * Another evaluator unit test would have missed it again. The bug is not in
 * any evaluator; it is in a caller forgetting a field. So this reads the
 * engine entry points as source and asserts the shape of what they pass --
 * which is the only thing that fails when a NEW entry point, or a new field
 * on an existing one, is added and left unwired.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { describe, it, expect } from 'vitest'

const read = (p: string) => readFileSync(path.join(process.cwd(), 'src', p), 'utf8')

/**
 * Every module that calls `runGlobalDecisionEngine` in production.
 *
 * Deliberately a hard-coded list AND cross-checked against a repo scan below:
 * the list documents what is known, the scan catches what is added.
 */
const ENTRY_POINTS = [
  'engine/decisionEngine/useDecisionEngine.ts',
  'hooks/useGlobalDecisionEngine.ts',
] as const

/**
 * Memory facts an entry point must supply, with the canonical hook that
 * provides each. A fact listed here is one where ABSENCE IS SILENT: the
 * evaluator degrades to a plausible-looking answer computed from the wrong
 * input rather than failing, which is what let this ship.
 */
const REQUIRED_MEMORY_FACTS = [
  { field: 'thesisReviews', hook: 'useThesisReviews' },
] as const

describe('every engine entry point supplies the memory facts', () => {
  it.each(ENTRY_POINTS)('%s calls the engine', (file) => {
    expect(read(file)).toContain('runGlobalDecisionEngine({')
  })

  describe.each(ENTRY_POINTS)('%s', (file) => {
    /*
     * Scoped to the `data:` OBJECT, not to the whole call.
     *
     * The first version of this test sliced from `runGlobalDecisionEngine({`
     * to the end of the file, so the memo's dependency array satisfied it --
     * and removing the field from `data` left the test green. A guard that
     * cannot see its own failure mode is decoration; this one is anchored.
     */
    it.each(REQUIRED_MEMORY_FACTS)('passes $field inside the engine data object', ({ field }) => {
      const src = read(file)
      const dataAt = src.indexOf('data: {', src.indexOf('runGlobalDecisionEngine({'))
      expect(dataAt).toBeGreaterThan(-1)
      // The data object ends at the line that closes it at the call's indent.
      const dataBlock = src.slice(dataAt, src.indexOf('\n      },', dataAt))
      // Either shorthand (`thesisReviews,`) or explicit (`thesisReviews:`).
      expect(dataBlock).toMatch(new RegExp(`\\b${field}\\s*[,:]`))
    })

    it.each(REQUIRED_MEMORY_FACTS)('reads $field from the canonical $hook', ({ hook }) => {
      const src = read(file)
      // The shared hook, not a private re-query: one cache entry, one rule
      // about what counts as a review.
      expect(src).toContain(`${hook}()`)
      expect(src).toContain(`from './useThesisReview'`.replace('./', file.startsWith('hooks/') ? './' : '../../hooks/'))
    })

    /* A memo that does not depend on the map keeps serving the pre-review
       answer until something else invalidates it. */
    it.each(REQUIRED_MEMORY_FACTS)('lists $field in the memo dependencies', ({ field }) => {
      const src = read(file)
      const afterCall = src.slice(src.indexOf('runGlobalDecisionEngine({'))
      const deps = afterCall.slice(afterCall.indexOf('}, ['), afterCall.indexOf('])') + 2)
      expect(deps).toContain(field)
    })
  })
})

describe('the entry-point list is not allowed to go stale', () => {
  /* The list above is only as good as its completeness. This fails when a
     third caller appears, which is the moment the wiring question has to be
     asked again. */
  it('knows about every production caller of the engine', () => {
    const out = execSync(
      'git grep -l "runGlobalDecisionEngine({" -- "src/**/*.ts" "src/**/*.tsx"',
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    const found = out.split('\n')
      .map(l => l.trim().replace(/^src\//, ''))
      .filter(Boolean)
      .filter(f => !f.includes('__tests__') && !f.includes('.test.'))
      .filter(f => !f.endsWith('globalDecisionEngine.ts')) // the definition
      .sort()

    expect(found).toEqual([...ENTRY_POINTS].sort())
  })
})
