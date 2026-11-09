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
 *
 * ── Why the class alone was not enough either ─────────────────────────────
 *
 * `layout_collaborations.layout_collab_view_own`, found 2026-11-09, was three
 * correctly scoped branches OR-ed with a fourth that read, in full:
 *
 *     ((user_id IS NULL) AND (team_id IS NULL) AND (org_node_id IS NULL))
 *
 * Every row where those three columns are NULL — which is how an org-wide share
 * is recorded — was returned to anyone, including `anon`. The branch is not
 * `true`, does not prove a session, and names no tenancy helper, so it classifies
 * as UNKNOWN; and UNKNOWN produced no finding. The predicate was *reported as
 * unread* and the run still exited 0.
 *
 * What distinguishes that branch is sharper than "unparseable": it places NO
 * condition on the caller at all, so it is satisfied by row content alone. Any
 * caller who can reach the table gets those rows. `callerBindingProfile` below
 * counts those branches, and a predicate that mixes caller-bound branches with
 * caller-free ones is the signature of a boundary with an escape hatch welded on.
 *
 * This is deliberately not the same question as "is the predicate scoped?".
 * `(is_system = true)` on a reference table is caller-free and entirely correct.
 * The finding is a question to answer, which is why the guard carries an
 * allowlist for the legitimate cases rather than this file guessing.
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
// Caller-binding analysis — per top-level OR branch
// ---------------------------------------------------------------------------

/**
 * Expressions that reference WHO IS ASKING, derived from the session.
 *
 * Narrower than SCOPE_SIGNALS on purpose. `organization_id` is a scope signal
 * because `organization_id = current_org_id()` is a tenancy test — but the bare
 * column is not a caller reference, and `(organization_id IS NULL)` is exactly
 * the kind of branch this analysis exists to find.
 */
const IDENTITY_SIGNALS = [
  /\bauth\.(uid|jwt|role|email)\s*\(/i,
  /\bcurrent_org_id\s*\(/i,
  /\bcurrent_user_id\s*\(/i,
  /\bcurrent_user_effective_node_ids\s*\(/i,
  /\bcurrent_user\b/i,                       // the SQL keyword, not a function
  /\brequest\.jwt\b/i,
  /\b\w*_in_current_org\s*\(/i,              // portfolio_in_current_org(...) & friends
]

/**
 * Helpers that take their answer from the caller's session or from the caller's
 * own membership, enumerated from every function named in a production policy.
 *
 * Being on this list means only "this branch asks a question about the caller".
 * It is NOT a statement that the helper is correctly implemented — CLAUDE.md
 * Standing Rule 6 is explicit that a familiar auth helper is not proof of
 * security, and `user_has_layout_access` was on this list while returning true
 * for a NULL caller. Whether a helper is sound is a runtime test's job. This
 * analysis answers the strictly weaker question of whether the branch asks at
 * all, because a branch that never asks cannot be rescued by any helper.
 *
 * A name absent from this list makes its branch read as caller-free, which
 * produces a finding rather than a pass. Adding a new helper here is therefore
 * a deliberate review step, which is the same bargain SCOPE_SIGNALS makes.
 */
export const IDENTITY_HELPERS = new Set([
  'can_read_asset_contribution', 'can_review_decision', 'can_view_contribution',
  'estimate_visible_to_caller', 'get_user_created_project_ids', 'has_note_permission',
  'is_active_member_of_current_org', 'is_active_org_admin_of_current_org',
  'is_coverage_admin', 'is_member_of_org', 'is_org_member', 'is_platform_admin',
  'is_portfolio_pm', 'is_simulation_admin', 'is_team_admin_for_field',
  'rating_visible_to_caller', 'theme_layout_access', 'trade_lab_writable_by_caller',
  'user_has_collaborate_share', 'user_has_layout_access', 'user_has_list_collaboration',
  'user_has_live_portfolio_share', 'user_has_viewer_access', 'user_has_workflow_access',
  'user_has_workflow_edit_access', 'user_is_active_member', 'user_is_portfolio_member',
])

/** Does this branch place any condition on the caller? */
export function branchBindsCaller(branch) {
  const b = String(branch ?? '')
  if (IDENTITY_SIGNALS.some(re => re.test(b))) return true
  for (const m of b.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    if (IDENTITY_HELPERS.has(m[1].toLowerCase())) return true
  }
  return false
}

/**
 * Count a predicate's top-level OR branches, and how many of them bind no
 * caller.
 *
 * `{ branches: 4, open: 1 }` is the layout defect: three branches test the
 * caller and a fourth does not, so the three are decoration. `{ branches: 1,
 * open: 1 }` is an ordinary caller-free predicate — a reference table, a public
 * feed — and is left to the class system and its allowlist, because a single
 * branch carries no contradiction to report.
 *
 * `false` branches are excluded: a disjunct that grants nothing is not a hatch.
 */
export function callerBindingProfile(expr) {
  if (expr === null || expr === undefined) return { branches: 0, open: 0 }
  const e = String(expr).replace(/\s+/g, ' ').trim()
  if (e === '') return { branches: 0, open: 0 }

  const branches = splitTopLevelOr(unwrap(e))
  let open = 0
  for (const b of branches) {
    if (/^false$/i.test(unwrap(b))) continue
    if (!branchBindsCaller(b)) open++
  }
  return { branches: branches.length, open }
}

/**
 * Read the profile back out of an inventory, from whatever it carries.
 *
 * Recorded at capture time as two integers per side, so the committed inventory
 * gains this analysis without gaining a single predicate. An inventory captured
 * before `schema_version` 3 carries neither the counts nor the text, and is
 * reported as unanalysed rather than clean — see `coverage` in the guard.
 */
export function resolveBindingProfile(policy, which) {
  const branches = policy[`${which}_branches`]
  const open = policy[`${which}_open`]
  if (Number.isInteger(branches) && Number.isInteger(open)) return { branches, open }

  const text = which === 'qual' ? policy.qual : policy.with_check
  if (text !== undefined) return callerBindingProfile(text)

  return null
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
