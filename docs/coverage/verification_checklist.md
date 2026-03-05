# Coverage Enforcement Verification Checklist

Status: **All phases complete** | Date: 2026-03-03

---

## Phase 0: Coverage Contract + Guardrail

- [x] `docs/coverage/coverage_contract.md` — canonical rules for scope, determinism, visibility, RLS
- [x] `scripts/check_coverage_antipatterns.mjs` — CI lint detects `coverage[0]` and `.find()` without deterministic sort
- [x] Anti-pattern script passes clean

## Phase 1: Deterministic Coverage Resolver

- [x] `src/lib/coverage/resolveCoverage.ts` created
  - `coverageRoleRank()` — role → numeric priority
  - `sortCoverageDeterministically()` — is_lead DESC → role priority → updated_at DESC → user_id ASC
  - `resolveCoverageDefault()` — returns first after sort
  - `resolveCoverageForViewer()` — buckets into inScope / firmWide / outOfScope, picks default
- [x] `src/lib/coverage/__tests__/resolveCoverage.test.ts` — 18 unit tests, all passing
- [x] All 24 callsites across 18 files refactored to use deterministic ordering:
  - `AssetTableView.tsx` — sorted coverage map, replaced `find(isLead)||[0]` with `[0]`
  - `OutcomesContainer.tsx` — ORDER BY is_lead, role, updated_at
  - `useOutcomeAggregation.ts` — coverageRoleRank-based sort
  - `ThesisContainer.tsx` — ORDER BY is_lead, role, updated_at
  - `useAnalystPriceTargets.ts` — ORDER BY added
  - `useUserAssetPriority.ts` — ORDER BY user_id on both queries
  - `ThesisHistoryView.tsx` — ORDER BY user_id
  - `useCommandCenter.ts` — ORDER BY asset_id
  - `UniverseView.tsx` — is_active filter + ORDER BY
  - `AssetRunDetailPanel.tsx` — ORDER BY asset_id
  - `SimplifiedUniverseBuilder.tsx` — ORDER BY analyst_name
  - `UniversePreviewModal.tsx` — is_active filter + ORDER BY
  - `universeAssetMatcher.ts` — is_active filter + ORDER BY
  - `CreateWorkflowWizard.tsx` — ORDER BY on 2 queries
  - `OrganizationPage.tsx` — ORDER BY on 2 queries
  - `AssetTab.tsx` — enhanced ORDER BY: is_lead DESC, role ASC, updated_at DESC

## Phase 2: DB Enforcement + Org Scoping

- [x] Migration: `add_organization_id_to_coverage_tables`
  - Added `organization_id` column to: coverage, coverage_requests, coverage_history, asset_contributions, contribution_visibility_targets
  - Backfilled via user_id → users.current_organization_id (primary) and team_id → org_chart_nodes (fallback)
  - Indexes created on all new columns
- [x] Migration: `restrict_coverage_rls_policies`
  - Created `is_coverage_admin()` SECURITY DEFINER helper
  - Dropped old permissive policies on coverage, coverage_history, coverage_requests
  - Created strict org-scoped policies with NULL fallback for transition
- [x] Migration: `update_coverage_trigger_security_definer`
  - `log_coverage_change()` updated to SECURITY DEFINER
  - Propagates organization_id to coverage_history
  - Added 'role_change' change_type detection
  - Updated CHECK constraint to include role_change, coverage_added, historical_added
- [x] `CoverageManager.tsx` — all 7 coverage insert locations pass `organization_id: currentOrgId`
  - coverage_requests insert (approval flow)
  - coverage insert on request approval
  - bulk insert loop
  - 4 baseRecord inserts (add, replace primary, replace existing, add additional)

## Phase 3: Contribution Visibility Enforcement

- [x] Migration: `fix_contribution_visibility_rls`
  - Fixed `asset_contributions` SELECT — now checks `contribution_visibility_targets` via `org_chart_node_members` join
  - Org-scoped INSERT/UPDATE/DELETE on asset_contributions
  - Fixed `contribution_visibility_targets` SELECT — was `true`, now org-scoped
  - Org-scoped INSERT/DELETE on contribution_visibility_targets
- [x] `useContributions.ts` — all inserts pass `organization_id: currentOrgId`
  - 2 asset_contributions inserts (create, draft-create)
  - 4 contribution_visibility_targets inserts (update, create, publish, visibility-change)

## Phase 4: Coverage Requests + History Correctness

- [x] Coverage requests RLS — already org-scoped from Phase 2 migration
- [x] `CoverageManager.tsx` — allCoverageEvents query fixed:
  - Added `role_change` to `.in('change_type', [...])` filter
  - Added `.order('changed_at', { ascending: false })` before `.limit(100)` for deterministic pagination

## Phase 5: Verification

- [x] `npx tsc --noEmit` — clean (0 errors)
- [x] `node scripts/check_coverage_antipatterns.mjs` — clean (0 violations)
- [x] `npx vitest run src/lib/coverage/__tests__/resolveCoverage.test.ts` — 18/18 tests pass
- [x] This checklist created

---

## Remaining Manual Verification

1. Open Coverage Manager → add coverage → verify insert succeeds (RLS allows org-scoped insert)
2. Open Coverage Manager → History tab → verify role_change events appear
3. Open contributions → set visibility to 'team' → verify another team member in scope can see it
4. Open contributions → set visibility to 'team' → verify out-of-scope user cannot see it
5. Verify CSV export from Coverage Manager still works (untouched by changes)
6. Verify coverage default selection is deterministic (same user selected on refresh)
