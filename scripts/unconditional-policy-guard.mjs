#!/usr/bin/env node
/**
 * Unconditional-policy guard.
 *
 * ── The defect class this exists to stop ──────────────────────────────────
 *
 * A PERMISSIVE RLS policy whose predicate is literally `true`:
 *
 *     CREATE POLICY x ON t FOR SELECT TO authenticated USING (true);
 *
 * RLS is *enabled*, the table has *policies*, and every existing check in this
 * repo passes — while every row is readable by every caller. The two linters we
 * already run cannot see it: `tenant-boundary-lint.mjs` asks whether a table has
 * `organization_id` and at least one policy, and `frontend-tenant-lint.mjs` asks
 * whether client queries filter by org. Neither reads what a policy *says*.
 *
 * Found 2026-08-28 on `object_links` (the readthrough relationship graph,
 * including its free-text `context`) and on `theme_assets`. Both were believed
 * safe: `theme_assets` is recorded in `tenant-boundary-lint.mjs` as
 * "themes.organization_id via theme_id", and `themes` genuinely IS scoped — but
 * the join table does not inherit that. **An FK chain is not a policy.** That
 * belief, written down and never verified, is the thing this guard checks.
 *
 * ── What the first version of this guard missed ───────────────────────────
 *
 * Looking only for a literal `true` is not enough, because a table's real
 * boundary is not one policy — it is every permissive policy on that command,
 * OR-ed together. `portfolio_team` in production:
 *
 *     Portfolio team: org-scoped read   USING portfolio_in_current_org(portfolio_id)
 *     pt_select_all_authed              USING (auth.uid() IS NOT NULL)
 *
 * Neither predicate is `true`, so the original guard reported nothing at all,
 * while every authenticated user could read every row. The scoped policy is not
 * a boundary; it is a comment with SQL syntax. Two additions follow:
 *
 *   1. SIBLING ANALYSIS. Policies are grouped by (table, command, role) — with
 *      `FOR ALL` expanded to four commands and `TO public` expanded to anon and
 *      authenticated — and judged together. A correctly scoped policy standing
 *      next to a broad one is reported, because the broad one wins.
 *
 *   2. PREDICATE CLASS, not a boolean. `scripts/lib/policy-predicate.mjs` sorts
 *      a predicate into UNCONDITIONAL / AUTH_ONLY / SCOPED / DENY / EMPTY /
 *      UNKNOWN. `auth.uid() IS NOT NULL` proves a session exists and nothing
 *      about which rows — for a logged-in caller it is `true` with extra steps.
 *      Anything unrecognised is UNKNOWN and is never counted as safe.
 *
 *   3. CALLER-FREE BRANCHES. Added 2026-11-09 after `layout_collaborations`,
 *      whose SELECT policy was three correctly scoped branches OR-ed with
 *
 *          ((user_id IS NULL) AND (team_id IS NULL) AND (org_node_id IS NULL))
 *
 *      which is how an org-wide share is recorded. Every one of those rows was
 *      readable by `anon`. That branch is not `true`, proves no session and
 *      names no tenancy helper, so it classified as UNKNOWN — and UNKNOWN
 *      produced no finding, so the guard printed "unread, not safe" next to it
 *      and exited 0. Additions 1 and 2 both missed it: `unconditional` is false,
 *      and there is no broad sibling to compare against, because the broad part
 *      is INSIDE the scoped policy.
 *
 *      So the branch-level question is asked directly: does this branch place
 *      ANY condition on the caller? A predicate that mixes branches that do with
 *      branches that do not is reported, because the ones that do cannot narrow
 *      what the ones that do not already admit. Measured against production the
 *      day it was written: 7 policies of 946, and the first of them was the same
 *      defect on `template_collaborations`.
 *
 *      Deliberately NOT reported: a wholly caller-free predicate. On a reference
 *      table `(is_system = true)` is correct, and the class system plus
 *      GLOBAL_READ_ALLOWLIST already own that decision. One branch cannot
 *      contradict itself; the finding here is the contradiction.
 *
 *   4. THE PREDICATE'S CLASS, not the `unconditional` boolean. `unconditional`
 *      is `qual = 'true'` exactly, so `(scoped OR true)` and `(scoped OR
 *      auth.uid() IS NOT NULL)` both left it false while being as open as
 *      `USING (true)`. The class already folds top-level OR by taking the most
 *      permissive branch; this is what acting on it looks like. Found 6 more
 *      policies on 4 tables that the boolean had been walking past.
 *
 * A note on a case that looks like a hole and is not: an UPDATE policy that
 * omits WITH CHECK reuses its USING expression for the new row, so a scoped
 * USING keeps scoping the post-image. What is dangerous is a WITH CHECK that is
 * present and broader — or a permissive sibling supplying a broad one, which is
 * what actually lets a `portfolio_team` row be moved to another tenant. Both are
 * detected; the harmless shape is deliberately not reported.
 *
 * ── Why an allowlist and not a baseline count ─────────────────────────────
 *
 * A numeric baseline ("64 known, fail at 65") permits the 65th to be swapped in
 * for a fixed one, and it never has to shrink. This guard instead names every
 * table that may be globally readable and requires a reason for it. A new
 * unconditional policy fails unless someone adds the table to an explicit list
 * and writes down why — which is a code review about a security boundary, which
 * is the point.
 *
 * `KNOWN_UNRESOLVED` is the migration path: the findings that already exist and
 * are being worked. It is a ratchet — entries may be removed, never added.
 *
 * ── Positive proof of work ────────────────────────────────────────────────
 *
 * Follows `lint-mobile-ratchet.mjs`: an empty result must not read as a pass.
 * If the inventory does not parse, or holds implausibly few tables or policies,
 * this fails loudly rather than reporting zero violations.
 *
 * ── Input ─────────────────────────────────────────────────────────────────
 *
 * A sanitized security inventory from `scripts/audit/schema-baseline.mjs`.
 * Reading a committed artifact rather than the live database is deliberate: it
 * needs no credentials, so it can run in CI on every pull request.
 *
 * The inventory carries no predicate text — a repository is the wrong place to
 * publish every tenant boundary in the product. Predicate classes survive that
 * anyway: inventories at `schema_version` 2 carry a class computed at capture
 * time, and older ones are still classified by matching their predicate hashes
 * against a corpus of known-broad shapes. At `schema_version` 3 each policy also
 * carries two integers per side — its top-level OR branch count and how many of
 * those branches bind no caller — which is what detector 3 reads.
 *
 * ── What this guard still cannot see ──────────────────────────────────────
 *
 * Written down because a gate whose blind spots are undocumented gets trusted
 * for things it never checked:
 *
 *   1. It reads a COMMITTED SNAPSHOT, so it is blind to anything shipped since
 *      the capture. The `policy-guard` job in ci.yml refreshes from production
 *      first, but only `if: env.SUPABASE_ACCESS_TOKEN != ''` — and measured
 *      2026-11-09 against the GitHub API, that secret is NOT set on this
 *      repository. The repo holds SUPABASE_SERVICE_ROLE_KEY and
 *      VITE_SUPABASE_URL and nothing else, so the refresh step has always
 *      skipped and this guard has only ever read the committed file.
 *
 *      That is why the snapshot sat at 2026-10-11 for four weeks while six
 *      unconditional write policies shipped past it. `captured_at` is printed
 *      on every run because a stale inventory is the single most likely way
 *      this guard goes quiet, and it goes quiet without failing.
 *
 *   2. Branch analysis is TEXTUAL and shallow. It splits on top-level OR and
 *      asks whether each branch mentions the caller. It does not resolve a
 *      subquery, follow a view, or evaluate a helper's body, so a branch like
 *      `(id IN (SELECT ... FROM a_view))` reads as caller-free whether or not
 *      the view is itself scoped. That direction is safe — it over-reports and
 *      the allowlist answers it — but a branch that LOOKS caller-bound and is
 *      not will pass: `user_has_layout_access(layout_id, p_user_id, 'view')`
 *      counted as caller-bound for months while returning true for a NULL
 *      caller. Whether a helper is sound is a runtime test's job, not this one's.
 *      `IDENTITY_HELPERS` in policy-predicate.mjs is the list that decides this,
 *      and a helper absent from it over-reports rather than passing.
 *
 *   3. It judges the predicate, never the DATA. `(portfolio_id IS NULL)`
 *      currently admits zero rows; that is luck, not a boundary, and this guard
 *      cannot tell the two apart. Row counts in the ratchet comments come from
 *      manual measurement.
 *
 *   4. RESTRICTIVE policies are treated as possibly-rescuing in the sibling
 *      detector and are not analysed branch by branch. A restrictive policy with
 *      a caller-free branch narrows nothing and is not reported.
 *
 *   5. It sees `public.*` and `storage.*` policies only, and table privileges
 *      only for `anon`/`authenticated`. Column privileges, `storage.objects`
 *      path conventions, SECURITY DEFINER function bodies and view ownership are
 *      all outside it — `sec:edge-authz` and the DB suites in `supabase/tests`
 *      cover parts of that, and `MAINTAIN` is missing from the captured grant
 *      strings because `information_schema.role_table_grants` does not list it.
 *
 * See `scripts/lib/policy-predicate.mjs`.
 *
 *   node scripts/unconditional-policy-guard.mjs <inventory.json>
 *   node scripts/unconditional-policy-guard.mjs --json
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CLASS, BROAD, resolveClass, resolveBindingProfile } from './lib/policy-predicate.mjs'

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/**
 * Tables that MAY carry an unconditional SELECT, each with the reason.
 *
 * The bar: the table holds reference data that is identical for every tenant
 * and reveals nothing about any tenant's activity. "Everyone needs to read it"
 * is not sufficient — coverage and holdings are needed by everyone too.
 *
 * Adding an entry is a security decision. Write the reason, not a placeholder.
 */
export const GLOBAL_READ_ALLOWLIST = {
  // The unconditional SELECT policy on `assets` remains correct, but only
  // because C1 moved the columns that made it wrong. The row is global; nine
  // columns on it were not, and `useExploreSearch` searched three of them
  // across every tenant. Those columns are no longer readable by
  // `authenticated` — the table grant was replaced by a column-level grant in
  // scripts/sql/security-c1/09-assets-proprietary-columns.sql — so what this
  // policy now exposes really is identical for all tenants.
  //
  // The predicate alone does not say that, which is why the reason has to.
  assets: 'Security master: identity, listing and market reference only. '
        + 'Proprietary research lives in asset_contributions, workflow state in '
        + 'asset_workflow_progress / _priorities; those columns are revoked from '
        + 'authenticated at the column level (C1/09), not merely unused.',
  asset_classes: 'Asset-class taxonomy. Static reference.',
  asset_earnings_dates: 'Earnings calendar. Public market data.',
  estimate_metrics: 'Estimate metric definitions. Static reference vocabulary.',
  price_history_cache:
    'Vendor price history, one global cache keyed by symbol and date. No tenant '
    + 'column by design. Its WRITE path is separately closed: the proxy edge '
    + 'function is the only writer, and authenticated/anon INSERT raises 42501 '
    + '(see project_price_cache_write_authority, closed 2026-11-08).',
  // `analyst_price_target_history` and `price_target_history` were here. Both
  // removed 2026-11-09: neither carries a broad SELECT policy any more, so the
  // entries were dead weight, and a dead allowlist entry is a standing licence
  // for the next broad policy on that table to pass unreported.
}

/**
 * Tables where world-readable (anon, no login) is the INTENDED state.
 *
 * Deliberately separate from `GLOBAL_READ_ALLOWLIST`, and deliberately harder
 * to get onto. "Every tenant may read it" and "the open internet may read it"
 * are two different decisions, and collapsing them is how a table that is
 * global-to-customers quietly becomes public-to-everyone. A table must be on
 * BOTH lists to pass as anon-readable.
 *
 * Note: being here justifies only the anon SELECT. The blanket
 * INSERT/UPDATE/DELETE/TRUNCATE grants that `anon` holds on these tables are
 * still wrong and should be revoked as defence in depth — they are currently
 * inert only because no unconditional write policy backs them.
 */
export const ANON_READ_ALLOWLIST = {
  asset_earnings_dates: 'Public market data — earnings dates are published by the issuer.',
  estimate_metrics: 'Static metric-name vocabulary. Contains no tenant or market data.',
}

/**
 * Findings that predate this guard and are being worked.
 *
 * A RATCHET: entries may only be REMOVED. Adding one requires deleting this
 * comment and admitting the guard has been turned into a baseline.
 *
 * Seeded 2026-08-28 from the production inventory. Every entry is a table whose
 * rows belong to a tenant or a user and are currently readable by all.
 */
export const KNOWN_UNRESOLVED = new Set([
  // --- research / contributions ---
  'asset_tags', 'asset_tag_assignments',
  // --- TDF ---
  'tdf_underlying_funds',
  // --- trading / ideas ---
  'idea_reactions',
  // 47 entries were removed on 2026-11-09, against a capture taken that day.
  // They were seeded 2026-08-28 and the committed inventory had not been
  // refreshed since 2026-10-11, so the ratchet had been carrying four weeks of
  // completed remediation — the research-isolation lane (allocation_*, tdf_*,
  // checklist/workflow, asset_team_*, coverage_portfolios, trade_queue_*,
  // user_asset_*, *_activity, pair_trades, simulation_trades, asset_classes,
  // analyst_price_target_history) replaced every one of those unconditional
  // policies with an org-scoped one. `activity_events` left this list too, but
  // is NOT clean: its unconditional policy is gone and a caller-free branch
  // took its place, so it moved to KNOWN_UNRESOLVED_OPEN_BRANCH.
  //
  // The removals are backed by the capture, not by intent: each of those tables
  // now records SCOPED predicate classes in
  // docs/audit/baselines/ci-policy-inventory.json.
  //
  // `decision_reviews` was here. Removed by
  // 20261009120000_decision_reviews_tenant_isolation.sql, which replaced its
  // unconditional SELECT with an org-scoped one and derives ownership
  // server-side. The ratchet only permits removal, so this line going is the
  // record that the finding was CLOSED rather than reclassified.
  //
  // SEQUENCING: this guard reads an inventory captured FROM PRODUCTION. Remove
  // the entry before the migration is deployed and the next capture still
  // shows `qual = true`, so the guard fails — correctly. Land this file with
  // the migration, and refresh the inventory after deployment, not before.
  //
  // Done in that order: the migration went to production 2026-10-10, and the
  // committed inventory was captured after it. `decision_reviews` now records
  // three policies with qual_class SCOPED, so this removal is backed by a
  // capture rather than by intent.
  // --- messaging / social ---
  'author_follows',
  // --- platform ---
  'platform_ai_config',
])

/**
 * Tables the PREDICATE-CLASS upgrade reports and the `unconditional` boolean
 * could not see: `(scoped OR auth.uid() IS NOT NULL)` and friends.
 *
 * Seeded 2026-11-09, the day the guard stopped reading `qual = 'true'` and
 * started reading the class. Same standing and the same rule as the other two
 * seeded sets: these are older defects that became visible, and entries may
 * only be removed.
 */
export const KNOWN_UNRESOLVED_BROAD_CLASS = new Set([
  // EMPTY as of 2026-11-09. All three seeded entries were remediated and
  // deployed to production the same day, in PR #278 (main 32de2099):
  //
  //   asset_earnings_dates         20261109190003 — the ALL policy dropped, so
  //                                 writes are denied by the absence of any
  //                                 INSERT/UPDATE/DELETE policy; SELECT kept.
  //   portfolio_universe_assets    20261109190000 — four per-verb policies TO
  //   portfolio_universe_filters                    authenticated, each
  //                                                 portfolio_in_current_org().
  //
  // Verified against production after deployment, not inferred: the
  // portfolio-universe suite reports 12/12 and the earnings suite 5/5, both
  // having failed 7/12 and 2/5 against the pre-fix policies.
  //
  // Removal only. Nothing may be added back to this set.
])

/**
 * Tables that the SIBLING detector reports and the original guard could not see.
 *
 * These are NOT new defects — they are older ones that became visible when the
 * guard learned to read predicates instead of counting `true`. They are listed
 * separately from `KNOWN_UNRESOLVED` so that the ratchet's "entries may only be
 * removed" rule stays literally true, and so the cost of the upgrade is legible
 * rather than folded into a number.
 *
 * Same rule: removal only.
 */
export const KNOWN_UNRESOLVED_SIBLING = new Set([
  // `pt_*_all_authed` — USING (auth.uid() IS NOT NULL) — defeats the four
  // "Portfolio team: org-scoped *" policies sitting beside them. This is the
  // escalation that motivated the sibling detector. Remediated in Release C.

  // Found by this detector on the day it was written, in prod AND staging, by
  // no previous check:
  //   "Users can manage their own snapshots"    ALL    USING (user_id = auth.uid())
  //   "Users can view all performance snapshots" SELECT USING (auth.uid() IS NOT NULL)
  // The per-user policy is exactly right and completely inert for reads: every
  // authenticated user can read every analyst's performance history in every
  // org. Not anon-reachable — `auth.uid() IS NOT NULL` is false without a
  // session — so this is SEV2, and it is queued behind messages/audit_events.
])

/**
 * Tables where a caller-free OR branch is the INTENDED design.
 *
 * Narrow by construction: a branch that asks nothing about the caller is only
 * correct when the rows it admits belong to nobody. Each entry states the
 * measurement that establishes that, not an opinion about it. A table that is
 * ALSO anon-reachable must appear in `ANON_READ_ALLOWLIST` too — global to
 * every tenant and visible to the open internet are different decisions.
 */
export const OPEN_BRANCH_ALLOWLIST = {
  scenarios:
    'Global scenario library. Measured 2026-11-09: all 139 rows have '
    + 'organization_id NULL and `is_default` marks the 138 product-provided ones, '
    + 'so the branch admits rows that belong to no tenant. No anon grant.',
}

/**
 * Tables the CALLER-FREE BRANCH detector reports, seeded the day it was written.
 *
 * Same standing as `KNOWN_UNRESOLVED_SIBLING`: these are not new defects, they
 * are older ones that became visible when the guard learned to read a predicate
 * branch by branch instead of taking its most permissive class. Listing them
 * separately keeps the two older ratchets' "removal only" rule literally true
 * and keeps the cost of this upgrade legible.
 *
 * Same rule: removal only. Each entry names what the branch admits.
 */
export const KNOWN_UNRESOLVED_OPEN_BRANCH = new Set([
  // REMOVED 2026-11-09: `template_collaborations` / `collab_view_own`. The
  // `(user_id IS NULL AND team_id IS NULL)` branch now ANDs
  // text_template_in_current_org(template_id), a SECURITY DEFINER helper, and
  // the policy is TO authenticated. Migration 20261109190001, PR #278, main
  // 32de2099. Verified against production after deployment: the collaboration
  // suite reports 11/11, having failed 5/11 against the pre-fix policies.
  //
  // The definer helper is load-bearing, not stylistic. An inline EXISTS against
  // text_templates was written first and FAILED the preserve-sharing
  // assertions: a policy subquery is filtered by the CALLER's RLS on the table
  // it reads, and text_templates only exposes a parent to a non-owner when
  // is_shared = true, which shareWithOrganization() does not set. See the
  // migration header.

  // "Users can view workflow stakeholders" SELECT TO public — the first branch
  // is `EXISTS (select 1 from workflows where id = ... and is_public = true)`,
  // a deliberate public-workflow feature.
  //
  // CORRECTION, measured 2026-11-09 against production: anon reads ZERO
  // stakeholder rows, and so does a foreign-org member. An earlier note here
  // claimed 7 rows in 1 org were anon-readable; that was a reading of the
  // predicate, not a measurement, and it was wrong.
  //
  // The branch is textually caller-free but it EXISTS-joins `workflows`, which
  // has its own RLS, and a policy subquery is evaluated under the CALLER's RLS.
  // So the branch inherits workflows' boundary and admits nothing anon can
  // reach. This is the static-analysis limit the guard cannot see textually:
  // a caller-free branch referencing ONLY its own table is a real hole, while
  // one that joins another RLS-protected table is not. Kept in the ratchet
  // because the predicate shape is still a latent hole the moment workflows'
  // own policy widens, but it is NOT live exposure today.
  'workflow_stakeholders',

  // `(is_system = true)` / `(organization_id IS NULL)`, both TO public with an
  // anon SELECT grant: 4 rows each, none org-owned. The branches are correct
  // reference-data branches; the anon GRANT is the defect, and these are the
  // only two of 189 anon-granted tables from which anon can actually read a
  // row. Queued for the anon-grant stage, not a policy change.
  'ai_column_library', 'rating_scales',

  // `(portfolio_id IS NULL)` SELECT — every activity event not tied to a
  // portfolio, to every authenticated caller in every org. Measured
  // 2026-11-09: 0 rows match, so it is latent. Anon holds no grant.
  'activity_events',

  // `(field_name = ANY (ARRAY['process_stage','priority']))` SELECT TO
  // authenticated — measured 2026-11-09: 1096 rows spanning 2 organizations.
  // `assets` is a global universe, but WHO moved a name to which stage, and
  // when, is tenant workflow data. Anon holds no grant.
  'asset_field_history',
])

/**
 * Tables whose policy is caller-free in EVERY branch, but whose branches consult
 * another relation — so the boundary is that table's RLS, not this policy.
 *
 * Reported by detector 4 as SEV3_TRANSITIVE_ONLY, seeded the day that detector
 * was written. These are NOT holes and they are NOT passes, which is the whole
 * reason they have their own set rather than being exempted or fixed.
 *
 * A policy subquery is evaluated under the CALLER's RLS on the relation it
 * reads, so each of these inherits its parent's org boundary. Static analysis
 * cannot establish that: it cannot tell whether the parent has RLS enabled at
 * all, let alone whether the parent's own predicate is sound. So each entry here
 * is backed by a ROLE-CONTEXT MEASUREMENT, not by reading the parent's
 * predicate, and the measurement is reproducible as a suite rather than a note:
 *
 *   supabase/tests/transitive-policy-boundaries.sql
 *   measured 2026-11-10 against production, 5 passed / 0 failed:
 *     a foreign-org member reads 0 rows from all three children
 *     anon reads 0, though it holds a SELECT grant on two of them
 *     the owning org still reads all three of its own children
 *
 * Each parent was confirmed to have RLS enabled with an org-scoped predicate:
 *
 *   analyst_price_target_history -> analyst_price_targets
 *       (is_active_member_of_current_org() AND organization_id = current_org_id())
 *   calendar_event_reminders     -> calendar_events
 *       (organization_id = current_org_id())
 *   model_versions               -> asset_models
 *       (organization_id = current_org_id() AND (is_shared OR created_by = auth.uid()))
 *
 * They stay in the ratchet because the shape is one migration away from being a
 * hole: drop RLS on a parent, widen a parent's policy, or read the child through
 * a SECURITY DEFINER path, and the child's own policy defends nothing. Removing
 * an entry means giving the child a predicate of its own, not re-measuring the
 * parent.
 *
 * Same rule as the other sets: removal only.
 */
export const KNOWN_UNRESOLVED_TRANSITIVE = new Set([
  'analyst_price_target_history',
  'calendar_event_reminders',
  'model_versions',
])

/**
 * Every ratcheted table, in one set — what `classify` treats as already known.
 *
 * The five seeded sets stay separate above because each records a different
 * reason for existing and each must shrink on its own, which is the ratchet's
 * whole discipline. Only the lookup is merged.
 */
export const RATCHETED = new Set([
  ...KNOWN_UNRESOLVED, ...KNOWN_UNRESOLVED_SIBLING,
  ...KNOWN_UNRESOLVED_OPEN_BRANCH, ...KNOWN_UNRESOLVED_BROAD_CLASS,
  ...KNOWN_UNRESOLVED_TRANSITIVE,
])

/** Roles that already bypass RLS; a policy naming them changes no access path. */
const OWNER_ROLES = new Set(['postgres', 'service_role'])

/**
 * Roles no API caller can become, read from the inventory's `roles` map.
 *
 * `tesseract_audience_writer` holds six unconditional write policies and is
 * NOLOGIN with no members except `postgres`, so not one of them is reachable
 * through PostgREST. Suppressing them is correct and suppressing them by NAME
 * would not be: a single `GRANT tesseract_audience_writer TO authenticated`
 * makes all six live, and a hardcoded name would keep the guard quiet through
 * it. So reachability comes from the capture — and an inventory that carries no
 * `roles` map suppresses nothing, because an unproven suppression is worse than
 * a noisy finding.
 */
function unreachableRoles(inventory) {
  const rows = inventory.roles
  if (!Array.isArray(rows) || !rows.length) return new Set()
  return new Set(rows.filter(r => !r.api_reachable && !r.can_login).map(r => r.name))
}

/** Below these, the inventory did not really load. Prod has ~287 / ~928. */
const MIN_TABLES = 200
const MIN_POLICIES = 600

// ---------------------------------------------------------------------------
// Classification (pure — unit tested)
// ---------------------------------------------------------------------------

/** `FOR ALL` is four policies wearing one name. */
const expandCmds = cmd =>
  cmd === 'ALL' ? ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] : [cmd]

/**
 * `TO public` is not "the public role is harmless" — in PostgREST terms it
 * covers `anon` as well as `authenticated`. Expanding it is what lets a policy
 * written for logged-in users be judged as the anonymous grant it also is.
 */
const expandRoles = roles =>
  String(roles ?? '').split(',').map(r => r.trim()).filter(Boolean)
    .flatMap(r => (r === 'public' ? ['anon', 'authenticated'] : [r]))
    .filter(r => !OWNER_ROLES.has(r))

const hasGrant = (table, priv) =>
  new RegExp(`\\b${priv}\\b`).test(String(table?.anon ?? ''))

/** The predicate that decides whether a caller may reach a row, for one command. */
const accessClass = (p, cmd) =>
  cmd === 'INSERT' ? resolveClass(p, 'check') : resolveClass(p, 'qual')

/**
 * The same predicate, judged for one specific role.
 *
 * AUTH_ONLY is broad for `authenticated` and CLOSED for `anon`: `auth.uid() IS
 * NOT NULL` is false when there is no session. Expanding `TO public` into both
 * roles without this distinction reports an anonymous bypass that cannot happen
 * — which is how a guard earns the habit of being ignored.
 *
 * Only a literally unconditional predicate is broad for `anon`.
 */
const accessClassFor = (p, cmd, role) => {
  const c = accessClass(p, cmd)
  if (role === 'anon' && c === CLASS.AUTH_ONLY) return CLASS.DENY
  return c
}

/**
 * `public` is not "the public role is harmless".
 *
 * In PostgREST terms a policy `TO public` applies to `anon` as well as
 * `authenticated`. Combined with a SELECT grant to `anon`, an unconditional
 * policy is reachable by anyone holding the publishable key — the open
 * internet, not a tenant bug. Severity is raised for those regardless of any
 * allowlist, because a table may be legitimately global to *customers* and
 * still have no business being world-readable.
 */
/**
 * `knownTables` is injectable so the unit tests can exercise the known/new
 * distinction against synthetic fixture names. Pinning those tests to whichever
 * real tables happen to sit in KNOWN_UNRESOLVED makes them fail the moment the
 * ratchet does its job and shrinks — which is exactly backwards, since a
 * shrinking ratchet is the desired outcome. Production callers omit it.
 */
export function classify(inventory, knownTables = RATCHETED) {
  const tables = new Map((inventory.tables ?? []).map(t => [t.name, t]))
  const unreachable = unreachableRoles(inventory)
  const findings = []

  /**
   * A RESTRICTIVE policy ANDs over its whole group, so it may legitimately be
   * the real boundary and we cannot prove a bypass past it. `siblingFindings`
   * has always declined to; the two checks below must decline for the same
   * reason, or a table whose tenancy fence is a restrictive policy reports as
   * open on every run.
   */
  const fenced = new Set()
  for (const p of inventory.policies ?? []) {
    if (String(p.permissive ?? 'PERMISSIVE').toUpperCase() !== 'RESTRICTIVE') continue
    for (const cmd of expandCmds(p.cmd)) {
      for (const role of expandRoles(p.roles)) fenced.add(`${p.table}\u001f${cmd}\u001f${role}`)
    }
  }
  const isFenced = (p) => expandCmds(p.cmd).some(cmd =>
    expandRoles(p.roles).some(role => fenced.has(`${p.table}\u001f${cmd}\u001f${role}`)))

  /**
   * Policies the SIBLING detector already names as the broad member of a group.
   *
   * That finding is strictly more informative than "this predicate is broad" —
   * it also names the scoped policy being defeated — so reporting both would
   * print the same defect twice under two severities.
   */
  const siblings = siblingFindings(inventory)
  const namedBySibling = new Set(
    siblings.flatMap(f => (f.broadPolicies ?? []).map(n => `${f.table}\u001f${n}`)))

  for (const p of inventory.policies ?? []) {
    // `postgres` and `service_role` carry BYPASSRLS, so a policy naming them
    // grants nothing they did not already have. Not a finding — and counting it
    // as one trains readers to skim the report.
    if (OWNER_ROLES.has(p.roles)) continue

    // Every role named is one nothing can become. See `unreachableRoles`.
    const named = expandRoles(p.roles)
    if (named.length && named.every(r => unreachable.has(r))) continue

    const table = tables.get(p.table)
    const known = knownTables.has(p.table)

    // ── 3. A caller-free branch OR-ed onto a caller-bound predicate ─────────
    // The layout defect. Three branches tested `auth.uid()`, a fourth tested
    // only that three columns were NULL, and a reader needs just one branch —
    // so the three were decoration and every org-wide share was world-readable.
    // Not `true`, not AUTH_ONLY, no tenancy helper: the class was UNKNOWN and
    // UNKNOWN produced no finding at all.
    //
    // Unlike AUTH_ONLY, a caller-free branch is NOT closed for `anon`: it asks
    // nothing of the session, so having no session satisfies it.
    for (const which of ['qual', 'check']) {
      if (isFenced(p)) break
      // A predicate that is ALREADY broad by class is reported below, more
      // precisely. `(scoped OR true)` would otherwise be two findings about one
      // defect: a `true` branch is both the broadest possible class and a
      // caller-free branch.
      if (BROAD.has(accessClass(p, p.cmd))) break
      const prof = resolveBindingProfile(p, which)
      if (!prof || prof.branches < 2 || prof.open === 0) continue
      if (prof.open === prof.branches) continue   // wholly caller-free: detector 4
      const cmd = which === 'check' ? (p.cmd === 'SELECT' ? null : p.cmd) : p.cmd
      if (!cmd) continue
      const priv = which === 'check' ? (cmd === 'ALL' ? 'INSERT' : cmd) : 'SELECT'
      const anonOpen = named.includes('anon') && hasGrant(table, priv)
      // Same bargain as GLOBAL_READ_ALLOWLIST: intentional-for-customers is a
      // different claim from intentional-for-the-open-internet, so an
      // anon-reachable branch needs both lists.
      if (Object.hasOwn(OPEN_BRANCH_ALLOWLIST, p.table) &&
          (!anonOpen || Object.hasOwn(ANON_READ_ALLOWLIST, p.table))) continue
      findings.push({
        table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
        severity: anonOpen ? 'SEV1_ANON_OPEN_BRANCH' : 'SEV2_OPEN_BRANCH',
        known,
        detail: `${which === 'check' ? 'WITH CHECK' : 'USING'} has ${prof.open} of ` +
                `${prof.branches} top-level OR branches that place no condition on the ` +
                `caller — the caller-bound branches cannot narrow what those admit` +
                (anonOpen ? ` (and anon holds ${priv})` : ''),
      })
    }

    // ── 4. A WHOLLY caller-free predicate ───────────────────────────────────
    // Detector 3 reports a predicate that MIXES caller-bound and caller-free
    // branches, and used to fall silent when every branch was caller-free. The
    // reasoning was that a single branch carries no internal contradiction to
    // report, and that `(is_system = true)` on a reference table is correct.
    // `model_template_collaborations` then shipped
    //
    //   USING (user_id IS NULL AND team_id IS NULL AND org_node_id IS NULL)
    //
    // as its whole predicate, TO public, with an anon SELECT grant — the same
    // defect PR #276 fixed on layouts and PR #278 fixed on text templates, as
    // one branch instead of four. It was found by hand. No detector saw it.
    //
    // The exemption was not wrong about reference data; it was wrong to treat
    // "one branch" as the thing that makes a predicate safe. What matters is
    // what the branch READS, and the three cases are genuinely different:
    //
    //   openSelf === branches   row content alone admits the row. Nothing else
    //                           is consulted, so every caller with a grant
    //                           gets every matching row. A real hole, unless
    //                           the rows belong to nobody — which is what
    //                           OPEN_BRANCH_ALLOWLIST asserts, with a
    //                           measurement, per table.
    //   openSelf <  branches    at least one branch consults another relation,
    //                           so its boundary is THAT table's RLS. Reported
    //                           as TRANSITIVE_ONLY, not as a pass and not as
    //                           an anon hole: a policy subquery runs under the
    //                           caller's RLS, which measured zero rows for
    //                           `workflow_stakeholders`. But static analysis
    //                           cannot tell whether the other table is
    //                           protected AT ALL, so this is a demand for a
    //                           role-context test, not a clean bill.
    //   openSelf === null       a pre-version-4 capture. Unanalysed, not clean.
    //
    // Deliberately NOT folded into detector 3: same remedy, different evidence,
    // and a reader needs to know which one they are looking at.
    for (const which of ['qual', 'check']) {
      if (isFenced(p)) break
      if (BROAD.has(accessClass(p, p.cmd))) break
      // Per-ARM, not only per-policy. `accessClass(p, p.cmd)` above folds the
      // governing class for the COMMAND, which for an UPDATE with a scoped
      // USING is SCOPED even when its WITH CHECK is literally `true`. Without
      // this line, `USING (scoped) WITH CHECK (true)` produced TWO findings
      // about one defect: SEV2_UPDATE_CHECK_WEAKER, which names the actual
      // problem, and a wholly-open report on the check arm, which only
      // restates it. A predicate whose CLASS is already broad belongs to the
      // class detectors; detector 4 is for the ones class analysis calls clean.
      if (BROAD.has(resolveClass(p, which))) continue
      const prof = resolveBindingProfile(p, which)
      if (!prof || prof.branches === 0) continue
      if (prof.open !== prof.branches) continue          // mixed: detector 3's case
      if (prof.openSelf === null || prof.openSelf === undefined) continue  // reported by `coverage`
      const cmd = which === 'check' ? (p.cmd === 'SELECT' ? null : p.cmd) : p.cmd
      if (!cmd) continue
      const priv = which === 'check' ? (cmd === 'ALL' ? 'INSERT' : cmd) : 'SELECT'
      const anonOpen = named.includes('anon') && hasGrant(table, priv)
      if (Object.hasOwn(OPEN_BRANCH_ALLOWLIST, p.table) &&
          (!anonOpen || Object.hasOwn(ANON_READ_ALLOWLIST, p.table))) continue
      // Intentionally public reference data, on the SAME terms the class
      // detector grants it: rows that belong to nobody, documented per table
      // with a measurement, and global-to-customers is still not
      // public-to-everyone, so anon needs the second list too. Without this,
      // rewriting an allowlisted table's `USING (true)` as `(is_system = true)`
      // would move it from exempt to reported while making it strictly
      // narrower — a guard that punishes a tightening teaches people to ignore
      // it. The allowlists are the place that decision belongs; "one branch"
      // was not, which is the whole lesson of detector 4.
      if (which === 'qual' && p.cmd === 'SELECT' &&
          Object.hasOwn(GLOBAL_READ_ALLOWLIST, p.table) &&
          (!anonOpen || Object.hasOwn(ANON_READ_ALLOWLIST, p.table))) continue

      const selfOnly = prof.openSelf === prof.branches
      findings.push({
        table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
        severity: selfOnly
          ? (anonOpen ? 'SEV1_ANON_WHOLLY_OPEN' : 'SEV2_WHOLLY_OPEN')
          : 'SEV3_TRANSITIVE_ONLY',
        known,
        detail: selfOnly
          ? `${which === 'check' ? 'WITH CHECK' : 'USING'} is caller-free in all ` +
            `${prof.branches} branch(es) and reads only this table — row content ` +
            `alone admits the row` +
            (anonOpen ? ` (and anon holds ${priv})` : '')
          : `${which === 'check' ? 'WITH CHECK' : 'USING'} is caller-free in all ` +
            `${prof.branches} branch(es); ${prof.branches - prof.openSelf} consult ` +
            `another relation, so the boundary is that table's RLS — static analysis ` +
            `cannot confirm it, needs a role-context test`,
      })
    }

    // ── 2. An UPDATE whose post-image check is broader than its row filter ──
    // Only when WITH CHECK is PRESENT and broad: an omitted one falls back to
    // USING, which is not a hole. See policy-predicate.mjs.
    if (p.cmd === 'UPDATE' || p.cmd === 'ALL') {
      const u = resolveClass(p, 'qual')
      const c = resolveClass(p, 'check')
      if (u === CLASS.SCOPED && BROAD.has(c)) {
        findings.push({
          table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
          severity: 'SEV2_UPDATE_CHECK_WEAKER', known,
          detail: `USING is ${u} but WITH CHECK is ${c} — an authorised row can be rewritten out of scope`,
        })
      }
    }

    // ── The predicate's own class, not the `unconditional` boolean ──────────
    // `unconditional` is `qual = 'true'` exactly, so it misses a broad branch
    // inside a compound predicate: `(portfolio_in_current_org(x) OR true)` and
    // `(scoped OR auth.uid() IS NOT NULL)` are both as open as `USING (true)`,
    // and both leave the boolean false. The CLASS already folds top-level OR by
    // taking the most permissive branch — this is what acting on it looks like.
    const govClass = accessClass(p, p.cmd)
    if (!BROAD.has(govClass)) continue
    if (isFenced(p)) continue
    if (namedBySibling.has(`${p.table}\u001f${p.name}`)) continue

    // AUTH_ONLY is false without a session, so only a literally unconditional
    // predicate is broad for `anon` — the distinction `accessClassFor` makes.
    const anonReachable = named.includes('anon') &&
      govClass === CLASS.UNCONDITIONAL && hasGrant(table, 'SELECT')
    const allowlisted = Object.hasOwn(GLOBAL_READ_ALLOWLIST, p.table)
    const how = govClass === CLASS.UNCONDITIONAL ? 'unconditional' : 'effectively unconditional (AUTH_ONLY)'

    // A write that anyone can perform, unconditionally.
    if (p.cmd !== 'SELECT') {
      findings.push({
        table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
        severity: named.includes('anon') && govClass === CLASS.UNCONDITIONAL
          ? 'SEV1_ANON_WRITE' : 'SEV2_UNCONDITIONAL_WRITE',
        known,
        detail: `${how} ${p.cmd} TO ${p.roles}`,
      })
      continue
    }

    if (anonReachable) {
      // Both lists required: global-to-customers is not public-to-everyone.
      if (allowlisted && Object.hasOwn(ANON_READ_ALLOWLIST, p.table)) continue
      findings.push({
        table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
        severity: 'SEV1_ANON_READ', known,
        detail: 'unconditional SELECT TO public AND anon holds SELECT — world-readable',
      })
      continue
    }

    if (allowlisted) continue

    findings.push({
      table: p.table, policy: p.name, cmd: p.cmd, roles: p.roles,
      severity: 'SEV2_CROSS_TENANT_READ', known,
      detail: `${how} SELECT on a table not in GLOBAL_READ_ALLOWLIST`,
    })
  }

  return [...findings, ...siblings].sort((a, b) =>
    a.severity.localeCompare(b.severity) || a.table.localeCompare(b.table) ||
    String(a.policy).localeCompare(String(b.policy)))
}

/**
 * ── 1. Broad permissive siblings ──────────────────────────────────────────
 *
 * Permissive policies OR together, so a command's real boundary is its widest
 * policy. Group by (table, command, role) and report any group where a broad
 * policy stands beside a scoped one: the scoped policy is doing nothing, and —
 * worse — it is the reason everyone believes the table is safe.
 *
 * Reported separately from a bare `USING (true)` because the failure is
 * different in kind. There the boundary is missing and looks missing. Here the
 * boundary is present, correct, and inert.
 */
export function siblingFindings(inventory) {
  const tables = new Map((inventory.tables ?? []).map(t => [t.name, t]))
  const groups = new Map()

  for (const p of inventory.policies ?? []) {
    // Only PERMISSIVE policies OR together. A RESTRICTIVE policy ANDs, and can
    // only ever narrow — it cannot be the cause of an over-broad boundary, and
    // one present in a group could legitimately rescue it.
    const permissive = String(p.permissive ?? 'PERMISSIVE').toUpperCase()
    for (const cmd of expandCmds(p.cmd)) {
      for (const role of expandRoles(p.roles)) {
        const key = [p.table, cmd, role].join(String.fromCharCode(31))
        if (!groups.has(key)) groups.set(key, { table: p.table, cmd, role, permissive: [], restrictive: [] })
        groups.get(key)[permissive === 'RESTRICTIVE' ? 'restrictive' : 'permissive'].push(p)
      }
    }
  }

  const findings = []
  for (const g of groups.values()) {
    // A restrictive policy ANDs over the whole group and may legitimately be the
    // real boundary. Do not claim a bypass we cannot prove.
    if (g.restrictive.length) continue

    const broad = g.permissive.filter(p => BROAD.has(accessClassFor(p, g.cmd, g.role)))
    const scoped = g.permissive.filter(p => accessClassFor(p, g.cmd, g.role) === CLASS.SCOPED)
    if (!broad.length || !scoped.length) continue

    const anonReachable = g.role === 'anon' &&
      hasGrant(tables.get(g.table), g.cmd === 'SELECT' ? 'SELECT' : g.cmd)

    findings.push({
      table: g.table,
      policy: broad.map(p => p.name).join(' + '),
      // The individual names, so `classify` can avoid reporting the same broad
      // policy a second time under a weaker severity.
      broadPolicies: broad.map(p => p.name),
      cmd: g.cmd,
      roles: g.role,
      severity: anonReachable ? 'SEV1_ANON_SIBLING_BYPASS' : 'SEV2_SIBLING_BYPASS',
      known: KNOWN_UNRESOLVED.has(g.table) || KNOWN_UNRESOLVED_SIBLING.has(g.table),
      detail: `${g.cmd} TO ${g.role}: broad sibling ${broad.map(p => `"${p.name}"`).join(', ')} ` +
              `(${[...new Set(broad.map(p => accessClassFor(p, g.cmd, g.role)))].join('/')}) defeats scoped ` +
              `${scoped.map(p => `"${p.name}"`).join(', ')}`,
    })
  }
  return findings
}

/**
 * Allowlist entries that no longer have a broad SELECT policy — dead weight.
 *
 * Reads the CLASS, not the `unconditional` boolean, for the same reason
 * `classify` does: an entry justifying `(scoped OR auth.uid() IS NOT NULL)`
 * would otherwise read as stale and be removed, silently turning its table into
 * a fresh finding on the next run.
 */
export function staleAllowlistEntries(inventory) {
  const live = new Set((inventory.policies ?? [])
    .filter(p => p.cmd === 'SELECT' && BROAD.has(resolveClass(p, 'qual')))
    .map(p => p.table))
  return Object.keys(GLOBAL_READ_ALLOWLIST).filter(t => !live.has(t))
}

/** Open-branch allowlist entries whose branch is gone — same dead weight. */
export function staleOpenBranchEntries(inventory) {
  const live = new Set()
  for (const p of inventory.policies ?? []) {
    for (const which of ['qual', 'check']) {
      const prof = resolveBindingProfile(p, which)
      if (prof && prof.branches > 1 && prof.open > 0 && prof.open < prof.branches) live.add(p.table)
    }
  }
  return Object.keys(OPEN_BRANCH_ALLOWLIST).filter(t => !live.has(t))
}

/** Ratchet entries that are now clean — the list must shrink. */
export function resolvedEntries(findings, seeded = RATCHETED) {
  const stillFound = new Set(findings.map(f => f.table))
  return [...seeded].filter(t => !stillFound.has(t)).sort()
}

/**
 * How old a committed capture may be before this gate refuses to speak for
 * production.
 *
 * This guard reads a FILE. It never connects to a database, which is what lets
 * it run on every PR with no credentials — and it is also the reason a passing
 * run has never meant "production is clean". It meant "the last capture
 * somebody took was clean". Those diverge the moment a policy is applied
 * without a recapture, and on 2026-11-09 the committed capture was four weeks
 * old while three migrations had landed.
 *
 * So freshness is now a requirement rather than a printed number. Over the
 * limit, the gate returns EXIT_UNVERIFIED instead of a pass: not an assertion
 * that something is wrong, an explicit refusal to claim anything is right.
 *
 * 7 days is chosen to be shorter than any plausible release cadence here and
 * long enough that an ordinary branch does not have to recapture. Override
 * downward for a stricter gate; the env var cannot push it past the hard
 * ceiling, because a gate whose own staleness tolerance is unbounded is not a
 * gate.
 */
export const MAX_INVENTORY_AGE_DAYS = 7
const MAX_INVENTORY_AGE_CEILING_DAYS = 30

/** Required so a wholly-caller-free predicate can be told from an unanalysed one. */
export const MIN_SCHEMA_VERSION = 4

/**
 * Exit codes, because "did not pass" is three different facts.
 *
 *   0  PASS         findings are all ratcheted, against a capture young enough
 *                   to speak for production
 *   1  FAIL         a new finding. Something is wrong.
 *   2  BROKEN       no inventory, a truncated one, or one too old a schema to
 *                   analyse. The gate could not run.
 *   3  UNVERIFIED   the gate ran and found nothing new, but its input is too
 *                   stale to stand for production. NOT a pass, and distinct
 *                   from FAIL so a reader can tell "we checked and it is bad"
 *                   from "we did not really check".
 *
 * CI must treat 1, 2 and 3 as red. The distinction is for the human reading the
 * log, and for the step summary.
 */
export const EXIT = { PASS: 0, FAIL: 1, BROKEN: 2, UNVERIFIED: 3 }

/** Age of a capture in days, or null when it carries no usable timestamp. */
export function inventoryAgeDays(inventory, now = Date.now()) {
  const raw = inventory?.captured_at
  if (typeof raw !== 'string') return null
  const t = Date.parse(raw)
  if (!Number.isFinite(t)) return null
  return (now - t) / 86_400_000
}

/**
 * The freshness verdict, separated from printing so it is directly testable.
 *
 * `maxAgeDays` comes from POLICY_INVENTORY_MAX_AGE_DAYS when set, clamped to
 * the ceiling. A capture with no parseable `captured_at` is unverifiable, not
 * fresh: an inventory that will not say when it was taken cannot be trusted to
 * describe now.
 */
export function freshness(inventory, { now = Date.now(), env = process.env } = {}) {
  const requested = Number(env.POLICY_INVENTORY_MAX_AGE_DAYS)
  const maxAgeDays = Number.isFinite(requested) && requested > 0
    ? Math.min(requested, MAX_INVENTORY_AGE_CEILING_DAYS)
    : MAX_INVENTORY_AGE_DAYS

  const version = Number(inventory?.schema_version)
  const schemaOk = Number.isFinite(version) && version >= MIN_SCHEMA_VERSION

  const ageDays = inventoryAgeDays(inventory, now)
  if (ageDays === null) {
    return { ok: false, reason: 'no parseable captured_at', ageDays: null, maxAgeDays, schemaOk, version }
  }
  if (ageDays > maxAgeDays) {
    return {
      ok: false,
      reason: `capture is ${ageDays.toFixed(1)} days old, limit is ${maxAgeDays}`,
      ageDays, maxAgeDays, schemaOk, version,
    }
  }
  return { ok: true, reason: null, ageDays, maxAgeDays, schemaOk, version }
}

/**
 * How much of the inventory this run could actually reason about.
 *
 * A sanitized inventory carries hashes, and only predicates matching the known
 * corpus classify. Everything else is UNKNOWN — not safe, just unread. Printing
 * that fraction stops a mostly-blind run from reading like a clean one.
 */
export function coverage(inventory) {
  let classified = 0, unknown = 0, analysed = 0, unanalysed = 0, selfBlind = 0
  for (const p of inventory.policies ?? []) {
    if (OWNER_ROLES.has(p.roles)) continue
    for (const cmd of expandCmds(p.cmd)) {
      if (accessClass(p, cmd) === CLASS.UNKNOWN) unknown++
      else classified++
    }
    // Branch analysis is separate: it needs the per-side counts a
    // `schema_version` 3 capture records, or the predicate text. An older
    // inventory is reported as unanalysed, never as clean.
    const prof = resolveBindingProfile(p, p.cmd === 'INSERT' ? 'check' : 'qual')
    if (prof) analysed++
    else unanalysed++
    // Separate from `unanalysed`: a version-3 capture HAS branch counts, so it
    // is analysed for detector 3 and blind to detector 4. Counting those as
    // analysed and leaving it there is how the wholly-caller-free class stayed
    // invisible, so the blindness gets its own number.
    if (prof && (prof.openSelf === null || prof.openSelf === undefined)) selfBlind++
  }
  return {
    classified, unknown, total: classified + unknown,
    branches_analysed: analysed, branches_unanalysed: unanalysed,
    self_branch_unanalysed: selfBlind,
    roles_captured: Array.isArray(inventory.roles) && inventory.roles.length > 0,
  }
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * In preference order.
 *
 * The full inventory is gitignored and is what a local capture produces, so it
 * wins when present — it is the richer artifact and a developer who just
 * captured one should be measuring it. The minimal one is the committed
 * fallback that lets this run in CI with no credentials; it carries only the
 * tables and policies this guard reads. See docs/audit/baselines/README.md.
 *
 * Not finding EITHER is still exit 2. A missing input is never a pass.
 */
const DEFAULT_INVENTORIES = [
  'docs/audit/baselines/production-security-inventory.json',
  'docs/audit/baselines/ci-policy-inventory.json',
]

function main(argv) {
  const asJson = argv.includes('--json')
  const explicit = argv.find(a => a.endsWith('.json') && a !== '--json')
  const candidates = explicit ? [explicit] : DEFAULT_INVENTORIES

  let inventory, path, errors = []
  for (const c of candidates) {
    try {
      inventory = JSON.parse(readFileSync(c, 'utf8'))
      path = c
      break
    } catch (e) {
      errors.push(`${c}: ${e.message}`)
    }
  }
  if (!inventory) {
    console.error('FAIL: could not read a security inventory.')
    for (const e of errors) console.error(`      ${e}`)
    console.error('      Generate one with: node scripts/audit/schema-baseline.mjs')
    console.error('      ...or the committed CI subset:  --ci-minimal')
    return EXIT.BROKEN
  }

  // Positive proof of work — an empty inventory must not read as a pass.
  const nTables = (inventory.tables ?? []).length
  const nPolicies = (inventory.policies ?? []).length
  if (nTables < MIN_TABLES || nPolicies < MIN_POLICIES) {
    console.error(`FAIL: inventory looks truncated — ${nTables} tables, ${nPolicies} policies.`)
    console.error(`      Expected at least ${MIN_TABLES} / ${MIN_POLICIES}. Refusing to report a pass.`)
    return EXIT.BROKEN
  }

  const findings = classify(inventory)
  const fresh = findings.filter(f => !f.known)
  const stale = [...staleAllowlistEntries(inventory), ...staleOpenBranchEntries(inventory)]
  const resolved = resolvedEntries(findings)
  const cov = coverage(inventory)
  const fr = freshness(inventory)

  if (asJson) {
    console.log(JSON.stringify({ findings, fresh, stale, resolved, coverage: cov, freshness: fr }, null, 2))
    if (fresh.length > 0) return EXIT.FAIL
    if (!fr.schemaOk) return EXIT.BROKEN
    if (!fr.ok) return EXIT.UNVERIFIED
    return EXIT.PASS
  }

  console.log(`Unconditional-policy guard — ${path}`)
  console.log(`  captured ${inventory.captured_at ?? 'unknown'} · ${nTables} tables · ${nPolicies} policies`)
  console.log(`  capture age:        ${fr.ageDays === null ? 'UNKNOWN' : fr.ageDays.toFixed(1) + ' days'}` +
              ` (limit ${fr.maxAgeDays}) · schema_version ${Number.isFinite(fr.version) ? fr.version : 'absent'}` +
              ` (need >= ${MIN_SCHEMA_VERSION})`)
  console.log(`  predicate coverage: ${cov.classified}/${cov.total} classified, ${cov.unknown} UNKNOWN (unread, not safe)`)
  console.log(`  branch analysis:    ${cov.branches_analysed} policies analysed, ` +
              `${cov.branches_unanalysed} without branch counts (needs a schema_version 3 capture)`)
  if (cov.self_branch_unanalysed > 0) {
    console.log(`  wholly-open check:  ${cov.self_branch_unanalysed} policies BLIND — ` +
                `no *_open_self counts (needs a schema_version ${MIN_SCHEMA_VERSION} capture)`)
  }
  if (!cov.roles_captured) {
    console.log('  roles:              NOT CAPTURED — no policy is suppressed as unreachable')
  }
  console.log('')

  const bySeverity = {}
  for (const f of findings) (bySeverity[f.severity] ??= []).push(f)
  for (const sev of Object.keys(bySeverity).sort()) {
    console.log(`  ${sev} — ${bySeverity[sev].length}`)
    for (const f of bySeverity[sev]) {
      console.log(`    ${f.known ? ' ' : '!'} ${f.table}.${f.policy}: ${f.detail}`)
    }
    console.log('')
  }

  if (resolved.length) {
    console.log(`  RATCHET: ${resolved.length} entries are now clean — remove them from`)
    console.log(`  KNOWN_UNRESOLVED / KNOWN_UNRESOLVED_SIBLING: ${resolved.join(', ')}\n`)
  }
  if (stale.length) {
    console.log(`  Allowlist entries no longer needed: ${stale.join(', ')}\n`)
  }

  if (fresh.length) {
    console.log(`FAIL: ${fresh.length} finding(s) not in KNOWN_UNRESOLVED.`)
    console.log('      Either fix the policy, or — if the table is genuinely global')
    console.log('      reference data — add it to GLOBAL_READ_ALLOWLIST with a reason.')
    return EXIT.FAIL
  }

  // A capture too old a schema to analyse is a broken gate, not a stale one:
  // detector 4 cannot run at all, so the run has not asked the question.
  if (!fr.schemaOk) {
    console.log(`BROKEN: inventory is schema_version ${Number.isFinite(fr.version) ? fr.version : 'absent'},`)
    console.log(`        and this guard needs >= ${MIN_SCHEMA_VERSION} to tell a wholly caller-free`)
    console.log('        predicate from an unanalysed one. Recapture:')
    console.log('        node scripts/audit/schema-baseline.mjs --ci-minimal')
    return EXIT.BROKEN
  }

  if (!fr.ok) {
    console.log(`UNVERIFIED: ${findings.length} known finding(s), 0 new — but ${fr.reason}.`)
    console.log('            This gate reads a committed FILE; it never connects to the')
    console.log('            database. A clean result against an old capture says the last')
    console.log('            capture was clean, NOT that production is. Recapture:')
    console.log('            node scripts/audit/schema-baseline.mjs --ci-minimal')
    console.log('            This is not a pass. It is a refusal to claim one.')
    return EXIT.UNVERIFIED
  }

  console.log(`PASS: ${findings.length} known finding(s), 0 new.`)
  console.log(`      Against a capture ${fr.ageDays.toFixed(1)} days old (limit ${fr.maxAgeDays}).`)
  console.log('      STATIC ONLY: this is a predicate-shape and grant analysis of a')
  console.log('      committed capture. It does not establish effective authorization —')
  console.log('      a caller-free branch joining another table, a SECURITY DEFINER read')
  console.log('      path, and an unsound auth helper all pass this gate. Cross-org and')
  console.log('      anon denial are proven only by the role-context suites in')
  console.log('      supabase/tests/.')
  console.log('      KNOWN_UNRESOLVED is a ratchet, not a baseline. It must shrink.')
  return EXIT.PASS
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv.slice(2)))
}
