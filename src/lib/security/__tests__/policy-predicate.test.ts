/**
 * Tests for the predicate classifier.
 *
 * These pin the judgement that the first guard did not have: what a predicate
 * PROVES, rather than whether it is literally `true`. The cases that matter are
 * the ones where a predicate is non-trivial and still worthless as a boundary.
 *
 * Pure functions, no database, no credentials.
 */
import { describe, it, expect } from 'vitest'
// @ts-expect-error — plain .mjs script, no type declarations by design
import { CLASS, classifyPredicateText, splitTopLevelOr, hashPredicate, HASH_CLASS, resolveClass, effectiveCheckClass } from '../../../../scripts/lib/policy-predicate.mjs'

describe('classifyPredicateText', () => {
  it('reads a literal true as unconditional', () => {
    expect(classifyPredicateText('true')).toBe(CLASS.UNCONDITIONAL)
  })

  it('treats an absent predicate as EMPTY, not as permission', () => {
    expect(classifyPredicateText(null)).toBe(CLASS.EMPTY)
    expect(classifyPredicateText('')).toBe(CLASS.EMPTY)
  })

  /**
   * The `portfolio_team` bypass in one line. This predicate is not `true`, and
   * for every logged-in caller it grants exactly what `true` grants.
   */
  it('classifies auth.uid() IS NOT NULL as AUTH_ONLY, not scoped', () => {
    expect(classifyPredicateText('(auth.uid() IS NOT NULL)')).toBe(CLASS.AUTH_ONLY)
    expect(classifyPredicateText('auth.uid() IS NOT NULL')).toBe(CLASS.AUTH_ONLY)
    expect(classifyPredicateText('(( SELECT auth.uid() AS uid) IS NOT NULL)')).toBe(CLASS.AUTH_ONLY)
    expect(classifyPredicateText("(auth.role() = 'authenticated'::text)")).toBe(CLASS.AUTH_ONLY)
  })

  it('recognises ownership and tenancy predicates as scoped', () => {
    expect(classifyPredicateText('(auth.uid() = user_id)')).toBe(CLASS.SCOPED)
    expect(classifyPredicateText('(user_id = auth.uid())')).toBe(CLASS.SCOPED)
    expect(classifyPredicateText('portfolio_in_current_org(portfolio_id)')).toBe(CLASS.SCOPED)
    expect(classifyPredicateText('(organization_id = current_org_id())')).toBe(CLASS.SCOPED)
  })

  /** A tenant-scoped child reached through a subquery is a legitimate boundary. */
  it('accepts a tenant-scoped child through EXISTS', () => {
    const p = '(EXISTS ( SELECT 1 FROM themes t WHERE ((t.id = theme_assets.theme_id) ' +
              'AND (t.organization_id = current_org_id()))))'
    expect(classifyPredicateText(p)).toBe(CLASS.SCOPED)
  })

  /** An EXISTS that scopes nothing must not be mistaken for one that does. */
  it('does not accept an EXISTS with no scoping condition inside', () => {
    expect(classifyPredicateText('(EXISTS ( SELECT 1 FROM themes t WHERE (t.id = theme_assets.theme_id)))'))
      .toBe(CLASS.UNKNOWN)
  })

  /**
   * A top-level OR is the two-policy bypass written inside one policy. The
   * whole expression is only as strong as its weakest branch.
   */
  it('is only as strong as its weakest top-level OR branch', () => {
    expect(classifyPredicateText('(portfolio_in_current_org(portfolio_id) OR (auth.uid() IS NOT NULL))'))
      .toBe(CLASS.AUTH_ONLY)
    expect(classifyPredicateText('((auth.uid() = user_id) OR true)')).toBe(CLASS.UNCONDITIONAL)
  })

  /** AND can only narrow, so a nested OR inside one branch must not leak out. */
  it('does not confuse a nested OR under an AND with a top-level one', () => {
    const p = '(portfolio_in_current_org(portfolio_id) AND ((role = \'pm\') OR (role = \'analyst\')))'
    expect(classifyPredicateText(p)).toBe(CLASS.SCOPED)
  })

  it('refuses to guess on an expression it does not recognise', () => {
    expect(classifyPredicateText('(status = \'active\'::text)')).toBe(CLASS.UNKNOWN)
  })

  it('splits OR only at the top level', () => {
    expect(splitTopLevelOr('a OR b')).toEqual(['a', 'b'])
    expect(splitTopLevelOr('(a OR b) AND c')).toEqual(['(a OR b) AND c'])
    expect(splitTopLevelOr("(x = 'a OR b') OR c")).toEqual(["(x = 'a OR b')", 'c'])
  })
})

describe('hash classification of a sanitized inventory', () => {
  /**
   * The committed inventory carries no predicate text. It does not need to:
   * recognising the dangerous shapes only requires hashing them, and this is
   * what lets the sibling detector work on captures taken before it existed.
   */
  it('identifies known-broad predicates by hash alone', () => {
    expect(HASH_CLASS.get(hashPredicate('true'))).toBe(CLASS.UNCONDITIONAL)
    expect(HASH_CLASS.get(hashPredicate('(auth.uid() IS NOT NULL)'))).toBe(CLASS.AUTH_ONLY)
    expect(HASH_CLASS.get(hashPredicate(''))).toBe(CLASS.EMPTY)
  })

  it('matches the exact hash production recorded for the portfolio_team bypass', () => {
    // From prod-pre-deploy-20260826-234204.json, policy `pt_select_all_authed`.
    expect(hashPredicate('(auth.uid() IS NOT NULL)')).toBe('9e9d875f1a56f557')
    expect(hashPredicate('portfolio_in_current_org(portfolio_id)')).toBe('909565c31941770f')
    expect(hashPredicate('true')).toBe('b5bea41b6c623f7c')
  })

  it('leaves an unrecognised hash UNKNOWN rather than assuming it is safe', () => {
    expect(resolveClass({ cmd: 'SELECT', qual_hash: 'ffffffffffffffff' }, 'qual')).toBe(CLASS.UNKNOWN)
  })

  it('prefers a class recorded at capture time over the hash', () => {
    expect(resolveClass({ cmd: 'SELECT', qual_class: 'SCOPED', qual_hash: 'b5bea41b6c623f7c' }, 'qual'))
      .toBe(CLASS.SCOPED)
  })

  it('falls back to the legacy unconditional flag on the side that carries the predicate', () => {
    expect(resolveClass({ cmd: 'SELECT', unconditional: true }, 'qual')).toBe(CLASS.UNCONDITIONAL)
    expect(resolveClass({ cmd: 'INSERT', unconditional: true }, 'check')).toBe(CLASS.UNCONDITIONAL)
    // ...and never invents one for the other side.
    expect(resolveClass({ cmd: 'SELECT', unconditional: true }, 'check')).toBe(CLASS.UNKNOWN)
  })
})

describe('effectiveCheckClass', () => {
  /**
   * PostgreSQL uses the USING expression as the check for the new row when an
   * UPDATE policy omits WITH CHECK. So an omitted WITH CHECK is not a hole, and
   * reporting it as one would be a false alarm on `Portfolio team: org-scoped
   * update` — whose real problem is the sibling, not the omission.
   */
  it('falls back to USING for an UPDATE with no WITH CHECK', () => {
    const p = { cmd: 'UPDATE', qual: 'portfolio_in_current_org(portfolio_id)', with_check: null }
    expect(effectiveCheckClass(p)).toBe(CLASS.SCOPED)
  })

  it('uses WITH CHECK when it is present, even when broader than USING', () => {
    const p = { cmd: 'UPDATE', qual: '(auth.uid() = user_id)', with_check: 'true' }
    expect(effectiveCheckClass(p)).toBe(CLASS.UNCONDITIONAL)
  })
})
