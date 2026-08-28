/**
 * Classification of an RLS policy predicate by what it actually PROVES.
 *
 * Shared by `scripts/audit/schema-baseline.mjs` (which has the predicate text)
 * and `scripts/unconditional-policy-guard.mjs` (which usually does not).
 *
 * ── Why a class and not a boolean ─────────────────────────────────────────
 *
 * The first guard asked one question: is the predicate literally `true`? That
 * caught `object_links`, and it would have sailed straight past `portfolio_team`:
 *
 *     Portfolio team: org-scoped read   USING portfolio_in_current_org(portfolio_id)
 *     pt_select_all_authed              USING (auth.uid() IS NOT NULL)
 *
 * Neither predicate is `true`, so `unconditional` is false on both, so the old
 * guard reported nothing. Permissive policies OR together, so the effective read
 * boundary is the second one: every authenticated user, every row. A predicate
 * can be non-trivial and still prove nothing about *who is asking for which row*.
 *
 * So the question is not "is it true?" but "does it constrain the caller to rows
 * they have a relationship with?" — which needs three answers, not two:
 *
 *   UNCONDITIONAL  `true`. Grants everything.
 *   AUTH_ONLY      proves a session exists, nothing about which rows. Equivalent
 *                  to UNCONDITIONAL for every logged-in caller.
 *   SCOPED         names an ownership or tenancy condition.
 *   DENY           `false`. Grants nothing.
 *   EMPTY          absent (a NULL qual on INSERT, or an omitted WITH CHECK).
 *   UNKNOWN        we cannot prove either way. Reported, never trusted.
 *
 * UNKNOWN is the honest default and it is load-bearing: a guard that guessed
 * "looks fine" on an expression it could not parse would be the same act of
 * faith — a boundary believed rather than checked — that produced these
 * findings in the first place.
 *
 * ── Top-level OR is the same defect inside one policy ─────────────────────
 *
 * `(portfolio_in_current_org(portfolio_id) OR auth.uid() IS NOT NULL)` is a
 * single policy that is exactly as open as the two-policy version above. So a
 * predicate is only SCOPED when EVERY top-level OR branch is scoped. One broad
 * branch decides the whole expression, because a reader only needs one.
 */

import { createHash } from 'node:crypto'

export const CLASS = {
  EMPTY: 'EMPTY',
  DENY: 'DENY',
  UNCONDITIONAL: 'UNCONDITIONAL',
  AUTH_ONLY: 'AUTH_ONLY',
  SCOPED: 'SCOPED',
  UNKNOWN: 'UNKNOWN',
}

/** Classes that let a caller reach rows they have no relationship with. */
export const BROAD = new Set([CLASS.UNCONDITIONAL, CLASS.AUTH_ONLY])

// ---------------------------------------------------------------------------
// Text classification
// ---------------------------------------------------------------------------

/**
 * Signals that a predicate ties the row to the caller or to their tenant.
 *
 * Deliberately a list of *named* things. Anything not on it is UNKNOWN rather
 * than assumed safe — adding a new tenancy helper should require adding it here,
 * which is a review of a security boundary.
 */
const SCOPE_SIGNALS = [
  /auth\.uid\(\)\s*=/,                      // ownership: auth.uid() = user_id
  /=\s*auth\.uid\(\)/,                      // ownership: created_by = auth.uid()
  /\bcurrent_org_id\s*\(/,                  // tenancy helper
  /\b\w*_in_current_org\s*\(/,              // portfolio_in_current_org(...) & friends
  /\b(is_org_member|is_member_of_org|has_org_access|can_access_org)\s*\(/,
  /\b(organization_id|org_id)\b/,           // direct tenant column comparison
]

/** Proves a session exists and nothing else. */
const AUTH_ONLY_SIGNALS = [
  /^\(*\s*(?:\(\s*select\s+)?auth\.uid\s*\(\)(?:\s+as\s+uid\s*\))?\s*is\s+not\s+null\s*\)*$/i,
  /^\(*\s*auth\.role\s*\(\)\s*=\s*'authenticated'(?:::text)?\s*\)*$/i,
  /^\(*\s*auth\.jwt\s*\(\)\s*is\s+not\s+null\s*\)*$/i,
]

/** Strip one layer of wrapping parentheses, repeatedly, when balanced. */
function unwrap(s) {
  let t = s.trim()
  while (t.startsWith('(') && t.endsWith(')')) {
    let depth = 0, balanced = true
    for (let i = 0; i < t.length; i++) {
      if (t[i] === '(') depth++
      else if (t[i] === ')') { depth--; if (depth === 0 && i < t.length - 1) { balanced = false; break } }
    }
    if (!balanced) break
    t = t.slice(1, -1).trim()
  }
  return t
}

/**
 * Split on OR at parenthesis depth 0, ignoring OR inside string literals.
 * `a OR (b AND c)` -> ['a', '(b AND c)']; `(a OR b) AND c` -> the whole thing,
 * because that OR is nested and AND can only narrow.
 */
export function splitTopLevelOr(expr) {
  const out = []
  let depth = 0, inStr = false, start = 0
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (c === "'") {
      // '' inside a literal is an escaped quote, not the end of one.
      if (inStr && expr[i + 1] === "'") { i++; continue }
      inStr = !inStr
      continue
    }
    if (inStr) continue
    if (c === '(') depth++
    else if (c === ')') depth--
    else if (depth === 0 && (c === 'o' || c === 'O')) {
      const before = i === 0 || /[\s)]/.test(expr[i - 1])
      const after = /[\s(]/.test(expr[i + 2] ?? ' ')
      if (before && after && /^or$/i.test(expr.slice(i, i + 2))) {
        out.push(expr.slice(start, i)); start = i + 2; i += 1
      }
    }
  }
  out.push(expr.slice(start))
  return out.map(s => s.trim()).filter(Boolean)
}

function classifyBranch(branch) {
  const b = unwrap(branch)
  if (/^true$/i.test(b)) return CLASS.UNCONDITIONAL
  if (/^false$/i.test(b)) return CLASS.DENY
  if (AUTH_ONLY_SIGNALS.some(re => re.test(b))) return CLASS.AUTH_ONLY
  if (SCOPE_SIGNALS.some(re => re.test(b))) return CLASS.SCOPED
  return CLASS.UNKNOWN
}

/**
 * Classify a predicate from its text.
 *
 * A whole expression is only as strong as its weakest OR branch, so the branch
 * classes are combined by taking the most permissive: UNCONDITIONAL beats
 * AUTH_ONLY beats UNKNOWN beats SCOPED beats DENY.
 */
export function classifyPredicateText(expr) {
  if (expr === null || expr === undefined) return CLASS.EMPTY
  const e = String(expr).replace(/\s+/g, ' ').trim()
  if (e === '') return CLASS.EMPTY

  const branches = splitTopLevelOr(unwrap(e)).map(classifyBranch)
  for (const c of [CLASS.UNCONDITIONAL, CLASS.AUTH_ONLY, CLASS.UNKNOWN, CLASS.SCOPED]) {
    if (branches.includes(c)) return c
  }
  return CLASS.DENY
}

// ---------------------------------------------------------------------------
// Hash classification — for the sanitized inventory
// ---------------------------------------------------------------------------

/**
 * The committed inventory carries no predicate text, by design: a repository is
 * the wrong place to publish every tenant boundary in the product. That would
 * normally end predicate analysis — but it does not have to, because we only
 * need to recognise the *dangerous* shapes, and those are few and canonical.
 *
 * `schema-baseline.mjs` records `left(sha256(coalesce(expr,'')), 16)`. That is
 * deterministic, so hashing a corpus of known-broad predicates here identifies
 * them in any inventory ever captured, including ones taken before this file
 * existed — without the inventory carrying a single predicate.
 *
 * The corpus is written as exact `pg_policies.qual` output. Anything not in it
 * stays UNKNOWN, so this can only ever find more, never excuse.
 */
const CORPUS = [
  ['', CLASS.EMPTY],
  ['true', CLASS.UNCONDITIONAL],
  ['false', CLASS.DENY],
  ['(auth.uid() IS NOT NULL)', CLASS.AUTH_ONLY],
  ['auth.uid() IS NOT NULL', CLASS.AUTH_ONLY],
  ['(( SELECT auth.uid() AS uid) IS NOT NULL)', CLASS.AUTH_ONLY],
  ["(auth.role() = 'authenticated'::text)", CLASS.AUTH_ONLY],
  ["(auth.role() = 'authenticated')", CLASS.AUTH_ONLY],
  ['(auth.jwt() IS NOT NULL)', CLASS.AUTH_ONLY],
  // Scoped shapes, recorded so the guard can tell "provably fine" from "unread".
  ['(auth.uid() = user_id)', CLASS.SCOPED],
  ['(user_id = auth.uid())', CLASS.SCOPED],
  ['(auth.uid() = created_by)', CLASS.SCOPED],
  ['(created_by = auth.uid())', CLASS.SCOPED],
  ['portfolio_in_current_org(portfolio_id)', CLASS.SCOPED],
  ['(organization_id = current_org_id())', CLASS.SCOPED],
]

/** `left(encode(sha256(...),'hex'),16)` — must match schema-baseline.mjs. */
export const hashPredicate = expr =>
  createHash('sha256').update(String(expr ?? ''), 'utf8').digest('hex').slice(0, 16)

export const HASH_CLASS = new Map(CORPUS.map(([text, cls]) => [hashPredicate(text), cls]))

/**
 * Resolve a predicate's class from whatever the inventory actually carries,
 * best evidence first.
 *
 *   1. `*_class`  — a current inventory classified it at capture time
 *   2. text       — a live/unsanitized capture
 *   3. hash       — a sanitized inventory, matched against the corpus above
 *   4. the legacy `unconditional` boolean
 *
 * `which` is 'qual' or 'check'.
 */
export function resolveClass(policy, which) {
  const cls = policy[`${which}_class`]
  if (cls && Object.hasOwn(CLASS, cls)) return cls

  const text = which === 'qual' ? policy.qual : policy.with_check
  if (text !== undefined) return classifyPredicateText(text)

  const known = HASH_CLASS.get(policy[`${which}_hash`])
  if (known) return known

  // Legacy inventories: `unconditional` conflated the two sides. It is only
  // trustworthy as a positive signal on the side that actually carries the
  // predicate for this command.
  if (policy.unconditional) {
    const carries = policy.cmd === 'INSERT' ? 'check' : 'qual'
    if (which === carries) return CLASS.UNCONDITIONAL
  }
  return CLASS.UNKNOWN
}

/**
 * The predicate that decides whether a NEW OR MODIFIED row is allowed.
 *
 * PostgreSQL detail that matters here: when an UPDATE policy omits WITH CHECK,
 * the USING expression is used for the new row as well. So an omitted WITH CHECK
 * is NOT by itself a hole — a scoped USING keeps scoping the post-image. The
 * hole is a WITH CHECK that is present and broader, or a permissive *sibling*
 * that contributes a broad one. `portfolio_team` is the second kind.
 */
export function effectiveCheckClass(policy) {
  const check = resolveClass(policy, 'check')
  if (check !== CLASS.EMPTY) return check
  return policy.cmd === 'INSERT' ? CLASS.UNKNOWN : resolveClass(policy, 'qual')
}
