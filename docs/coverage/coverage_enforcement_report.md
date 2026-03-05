# Coverage Enforcement Report

> **Scope**: End-to-end enforcement audit of the Coverage system — RLS policies, API/query layer, UI gating — plus how Coverage and Org-structure visibility controls interact across the platform. Based entirely on live database policy inspection, codebase grep, and code review.
>
> **Date**: 2026-03-03

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Tables Reviewed & Org-Scoping Status](#2-tables-reviewed--org-scoping-status)
3. [RLS & Server Enforcement Audit](#3-rls--server-enforcement-audit)
4. [Coverage Tab Enforcement vs UI Gating](#4-coverage-tab-enforcement-vs-ui-gating)
5. [Cross-Platform Visibility & Org-Structure Association](#5-cross-platform-visibility--org-structure-association)
6. [Contribution Visibility System](#6-contribution-visibility-system)
7. [Write-Path Inventory](#7-write-path-inventory)
8. [Privilege Escalation Risks](#8-privilege-escalation-risks)
9. [Schema / UI Mismatches](#9-schema--ui-mismatches)
10. [Recommendations (Minimal, Enforcement-First)](#10-recommendations-minimal-enforcement-first)

---

## 1. Executive Summary

The Coverage system allows analyst-to-asset assignment management. This report audits whether access control is enforced at the database/RLS layer (server-enforced) vs only in the UI (client-enforced).

**Key findings:**

- The `coverage` table has **no `organization_id` column** — coverage data is not org-scoped at the database level. Any authenticated user can read all coverage records across all orgs.
- `coverage` INSERT and UPDATE policies are **fully permissive** (`WITH CHECK (true)` / `USING (true)`). Any authenticated user can create or modify any coverage record via direct API call.
- `coverage_requests` UPDATE for approvals only checks **global `coverage_admin`** — node-level coverage admins cannot approve requests at the RLS layer.
- The `coverage.visibility` field (team/division/firm) is **never enforced by any RLS policy**. It is purely decorative metadata.
- `asset_contributions` SELECT policy does **not use `contribution_visibility_targets`** — the junction table is written but never read by RLS.
- `coverage_settings` is the **only coverage table with proper org-scoping** via `current_org_id()`.
- All UI write operations are gated by `hasAnyCoverageAdminRights`, but this is bypassed by any direct Supabase client call.

**Risk severity scale**: 🔴 Critical (data leak / unauthorized write) · 🟠 High (enforcement gap) · 🟡 Medium (inconsistency) · 🟢 Low (cosmetic / future concern)

---

## 2. Tables Reviewed & Org-Scoping Status

| Table | Has `organization_id`? | Org-scoped in RLS? | Notes |
|-------|:---------------------:|:------------------:|-------|
| `coverage` | ❌ No | ❌ No | No org isolation at all |
| `coverage_history` | ❌ No | ❌ No | Inherits `coverage` gap |
| `coverage_requests` | ❌ No | ❌ No | No org isolation |
| `coverage_settings` | ✅ Yes | ✅ Yes | Uses `current_org_id()` |
| `asset_contributions` | ❌ No | ❌ No | Visibility field not org-scoped |
| `contribution_visibility_targets` | ❌ No | ❌ No | Junction table, SELECT is `true` |

**Summary**: 1 of 6 tables is org-scoped. The other 5 tables are accessible to any authenticated user regardless of organization membership.

---

## 3. RLS & Server Enforcement Audit

This is the most important section. For each table, every RLS policy is listed with its actual SQL predicate and an enforcement verdict.

### 3.1 `coverage` — 🔴 Critical: INSERT/UPDATE fully permissive

| Operation | Policy Name | Predicate | Verdict |
|-----------|------------|-----------|---------|
| **SELECT** | `Users can read all coverage records` | `USING (true)` | 🔴 Any authenticated user sees ALL coverage across ALL orgs |
| **INSERT** | `Authenticated users can insert coverage` | `WITH CHECK (true)` | 🔴 Any authenticated user can create coverage for any asset/user combo |
| **UPDATE** | `Authenticated users can update coverage` | `USING (true) WITH CHECK (true)` | 🔴 Any authenticated user can modify ANY coverage record |
| **UPDATE** | `Enable update for own records` | `USING (user_id = auth.uid())` | 🟢 Redundant — superseded by the permissive policy above |
| **DELETE** | `Coverage admins can delete any coverage` | `EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND coverage_admin = true)` | 🟢 Proper check: global coverage_admin only |
| **DELETE** | `Users can delete their own coverage` | `user_id = auth.uid()` | 🟢 Proper check: own records only |

**Impact**: Without UI gating, any authenticated user — even one in a different organization — can:
- Insert fake coverage records (assign themselves or anyone as analyst on any asset)
- Modify existing coverage records (change role, visibility, dates, team, etc.)
- Read all coverage records across the entire platform

**What saves it today**: The UI gates all write operations behind `hasAnyCoverageAdminRights`. But a user with Supabase credentials and knowledge of the API endpoint can bypass this entirely.

### 3.2 `coverage_history` — 🟠 High: INSERT permissive, but low direct risk

| Operation | Policy Name | Predicate | Verdict |
|-----------|------------|-----------|---------|
| **SELECT** | `All authenticated users can view coverage history` | `USING (true)` | 🟠 No org scoping |
| **INSERT** | `Allow insert to coverage_history` | `WITH CHECK (true)` | 🟡 Permissive, but primarily populated by `log_coverage_change()` trigger |
| **UPDATE** | `Coverage admins can update coverage_history` | `EXISTS (... coverage_admin = true)` | 🟢 Proper check |
| **DELETE** | `Coverage admins can delete coverage_history` | `EXISTS (... coverage_admin = true)` | 🟢 Proper check |

**Impact**: INSERT is permissive, but history rows are auto-created by the `log_coverage_change()` SECURITY DEFINER trigger. Direct INSERT would allow fabricating audit history, which is a medium risk. Cross-org read exposure exists.

### 3.3 `coverage_requests` — 🟠 High: Admin approval not node-aware

| Operation | Policy Name | Predicate | Verdict |
|-----------|------------|-----------|---------|
| **SELECT** | `Coverage admins can view all requests` | `EXISTS (... coverage_admin = true)` | 🟡 Only global admins — node-level admins cannot see requests for their teams |
| **SELECT** | `Users can view their own coverage requests` | `requested_by = auth.uid()` | 🟢 Proper |
| **INSERT** | `Users can create coverage requests` | `WITH CHECK (requested_by = auth.uid())` | 🟢 Proper: can only create as yourself |
| **UPDATE** | `Coverage admins can update requests` | `EXISTS (... coverage_admin = true)` | 🟠 Only global admins — node-level admins cannot approve/deny |
| **UPDATE** | `Users can update their own coverage requests` | `requested_by = auth.uid()` | 🟢 Proper: users can rescind their own requests |

**Impact**: Node-level coverage admins (`org_chart_node_members.is_coverage_admin = true`) are presented with approval UI in the Coverage tab but their approvals would fail at the RLS layer unless they also happen to be global coverage admins. This is a functional gap — the UI suggests authority the RLS does not grant.

### 3.4 `coverage_settings` — 🟢 Properly enforced

| Operation | Policy Name | Predicate | Verdict |
|-----------|------------|-----------|---------|
| **SELECT** | `Users can view coverage settings in current org` | `organization_id = current_org_id() AND is_active_member_of_current_org()` | 🟢 Org-scoped + membership check |
| **INSERT** | `Coverage admins can insert...` | `organization_id = current_org_id() AND EXISTS (... coverage_admin = true)` | 🟢 Org-scoped + admin check |
| **UPDATE** | `Coverage admins can update...` | `organization_id = current_org_id() AND EXISTS (... coverage_admin = true)` | 🟢 Org-scoped + admin check |

**Note**: This is the model for how the other coverage tables should be enforced.

### 3.5 `asset_contributions` — 🔴 Critical: Visibility not enforced

| Operation | Policy Name | Predicate | Verdict |
|-----------|------------|-----------|---------|
| **SELECT** | `Users can view contributions` | `visibility = 'firm' OR team_id IS NULL OR created_by = auth.uid()` | 🔴 See analysis below |
| **INSERT** | `Users can create contributions` | `WITH CHECK (created_by = auth.uid())` | 🟢 Proper |
| **UPDATE** | `Users can update their own contributions` | `created_by = auth.uid()` | 🟢 Proper |
| **DELETE** | `Users can delete their own contributions` | `created_by = auth.uid()` | 🟢 Proper |

**SELECT policy deep-dive**:

The SELECT predicate `(visibility = 'firm' OR team_id IS NULL OR created_by = auth.uid())` has three branches:
1. `visibility = 'firm'` → anyone can see firm-wide contributions ✅
2. `team_id IS NULL` → anyone can see contributions with no team → effectively all legacy data ⚠️
3. `created_by = auth.uid()` → you can see your own contributions ✅

**What's missing**: When `visibility` is `'team'`, `'department'`, or `'division'` AND `team_id IS NOT NULL` AND the viewer is NOT the author — the contribution is **invisible** to everyone, including members of the target team/department/division. The `contribution_visibility_targets` junction table is completely ignored by RLS. So:

- A contribution scoped to "team" visibility with a valid `team_id` is only visible to the author — team members cannot see it.
- The UI writes `contribution_visibility_targets` rows correctly, but these are never consulted by the SELECT policy.

### 3.6 `contribution_visibility_targets` — 🟡 SELECT too permissive

| Operation | Policy Name | Predicate | Verdict |
|-----------|------------|-----------|---------|
| **SELECT** | `Users can view contribution targets` | `USING (true)` | 🟡 Anyone can read all targets — leaks which nodes contributions are shared with |
| **INSERT** | `Users can insert own contribution targets` | `EXISTS (... created_by = auth.uid())` | 🟢 Proper: must own the contribution |
| **DELETE** | `Users can delete own contribution targets` | `EXISTS (... created_by = auth.uid())` | 🟢 Proper: must own the contribution |

**Impact**: While the target rows themselves are visible, the parent `asset_contributions` row may be invisible due to the broken SELECT policy, creating an inconsistency.

---

## 4. Coverage Tab Enforcement vs UI Gating

### 4.1 Permission model in CoverageManager.tsx

The Coverage tab uses four computed permission flags:

```
hasGlobalCoverageAdmin    = user.coverage_admin === true
hasNodeLevelCoverageAdmin = userCoverageAdminNodes.length > 0
hasAnyCoverageAdminRights = hasGlobalCoverageAdmin || hasNodeLevelCoverageAdmin
canManageCoverageForNode(nodeId) = tree traversal with override fences
```

All write surfaces in the Coverage tab are gated by `hasAnyCoverageAdminRights`:
- "Add Coverage" button → checks `hasAnyCoverageAdminRights`
- Edit coverage row → checks `canManageCoverageForNode(row.team_id)` or `hasGlobalCoverageAdmin`
- Delete coverage → same as edit
- Approve/deny requests → checks `hasAnyCoverageAdminRights`
- Visibility change → checks `canChangeVisibility()` (reads `coverage_settings.visibility_change_permission`)

### 4.2 UI-only vs Server-enforced

| Action | UI Gated? | Server Enforced? | Gap? |
|--------|:---------:|:----------------:|:----:|
| **Read all coverage** | ✅ (tab visible to members) | ❌ `USING (true)` — no org filter | 🔴 Yes |
| **Create coverage** | ✅ `hasAnyCoverageAdminRights` | ❌ `WITH CHECK (true)` | 🔴 Yes |
| **Update coverage** | ✅ `canManageCoverageForNode` | ❌ `USING (true)` | 🔴 Yes |
| **Delete coverage** | ✅ admin check | ✅ `coverage_admin` or own record | 🟢 No |
| **Create request** | ✅ shown to non-admins | ✅ `requested_by = auth.uid()` | 🟢 No |
| **Approve request** | ✅ `hasAnyCoverageAdminRights` | ⚠️ Only global `coverage_admin` | 🟠 Partial |
| **Rescind request** | ✅ own request | ✅ `requested_by = auth.uid()` | 🟢 No |
| **Read requests** | ✅ filtered in UI | ⚠️ Own + global admin only (no node-level) | 🟠 Partial |
| **Update settings** | ✅ `user.coverage_admin` | ✅ `coverage_admin` + org-scoped | 🟢 No |
| **Change visibility** | ✅ `canChangeVisibility()` | ❌ No RLS check on `visibility` field | 🟠 Yes |

### 4.3 Inline writes in CoverageManager.tsx

All inline Supabase writes within CoverageManager.tsx (as opposed to mutation hooks):

| Location (approx. line) | Operation | What it does | UI Gate |
|--------------------------|-----------|-------------|---------|
| ~8121 | `update('coverage')` | Toggle `is_active` (deactivate/reactivate) | `hasAnyCoverageAdminRights` |
| ~8764 | `update('coverage')` | Change analyst `role` | admin for node |
| ~8790 | `update('coverage')` | Change `visibility` | `canChangeVisibility()` |
| ~8866 | `update('coverage')` | Change `team_id` (reassign team) | admin for node |
| ~8894 | `update('coverage')` | Change `portfolio_id` | admin for node |
| ~8948 | `delete('coverage')` | Remove coverage record | admin for node |

All are within admin-gated code paths in the UI but **none are validated by RLS** on the server (except DELETE which checks `coverage_admin` or own record).

---

## 5. Cross-Platform Visibility & Org-Structure Association

### 5.1 How other features consume coverage data

Coverage data is queried from **18 files** outside CoverageManager:

| File | Query | What it reads | Org Filter? |
|------|-------|--------------|:-----------:|
| `ThesisContainer.tsx` | `from('coverage').select('user_id, analyst_name, role').eq('asset_id', id).eq('is_active', true)` | Covering analysts for asset | ❌ No |
| `CoverageDisplay.tsx` | Same pattern | Display covering analysts | ❌ No |
| `useAnalystPriceTargets.ts` | `from('coverage').select('user_id, role, is_active').eq('asset_id', id)` | Role for price target attribution | ❌ No |
| `AssetTableView.tsx` | Coverage data for "Covered By" column | Display | ❌ No |
| `OutcomesContainer.tsx` | Coverage for outcome attribution | Analyst roles | ❌ No |
| `useCommandCenter.ts` | Coverage lookup for command palette | Quick search | ❌ No |
| `UserTab.tsx` | Coverage for user profile | User's coverage list | ❌ No |
| `WorkflowsPage.tsx` | Coverage for universe building | Filter by covered assets | ❌ No |
| `UniverseView.tsx` | Coverage in universe display | Analyst annotations | ❌ No |
| `SimplifiedUniverseBuilder.tsx` | Coverage for universe building | Filter/display | ❌ No |
| `UniversePreviewModal.tsx` | Coverage preview | Display | ❌ No |
| `universeAssetMatcher.ts` | Coverage for universe matching rules | Filter logic | ❌ No |
| `AssetRunDetailPanel.tsx` | Coverage for workflow runs | Display | ❌ No |
| `ThesisHistoryView.tsx` | Coverage for history attribution | Display | ❌ No |
| `useUserAssetPriority.ts` | Coverage for priority scoring | Logic | ❌ No |
| `OrganizationPage.tsx` | Coverage settings mutation | Settings write | ✅ Yes (settings only) |
| `OrgAuthorityMap.tsx` | Coverage admin flags | Display admin scopes | Indirect |
| `OrgNodeDetailsModal.tsx` | Coverage admin toggle | Admin management | Indirect |

**None of the read queries apply organization filtering.** Every consumer trusts that the Supabase SELECT RLS will scope data appropriately — but it doesn't, because `coverage` SELECT is `USING (true)`.

### 5.2 Coverage visibility field usage

The `coverage.visibility` column (`team`/`division`/`firm`) is:
- **Written** by CoverageManager when creating/editing coverage
- **Displayed** in coverage list views (badge pill)
- **Queryable** via the coverage filter dropdowns
- **Never enforced** in any RLS policy or query filter

No consumer file filters by `visibility` — all queries fetch all active coverage for an asset regardless of the visibility setting. The field is purely informational metadata.

### 5.3 Org-structure integration points

Coverage connects to org structure through:

1. **`coverage.team_id`** → FK to `org_chart_nodes(id)` — links coverage to a team in the org chart
2. **`org_chart_node_members.is_coverage_admin`** → node-level admin flag
3. **`canManageCoverageForNode(nodeId)`** → UI traversal: walks up the org tree from the target node, checking if user is a coverage admin at each level, respecting `coverage_admin_override` fences
4. **Authority Map** (`OrgAuthorityMap.tsx`, `authority-map.ts`) → displays which nodes each coverage admin controls, including fence detection

The org structure provides **UI-level** permission scoping but **no server-level** enforcement.

---

## 6. Contribution Visibility System

### 6.1 How it's designed to work

The contribution visibility system (thesis notes, etc.) uses a two-part model:

1. **`asset_contributions.visibility`** — enum: `portfolio`, `team`, `department`, `division`, `firm`
2. **`contribution_visibility_targets`** — junction table: `(contribution_id, node_id)` for N-to-M node targeting

When a user creates a contribution:
- They select a visibility scope (e.g., "team") and target nodes
- The `visibility` field is set on the contribution
- `contribution_visibility_targets` rows are inserted for each target node
- If `visibility = 'firm'` or no specific targets, `team_id` on the contribution may be null

### 6.2 What actually happens at RLS

**The `contribution_visibility_targets` table is never consulted by the `asset_contributions` SELECT policy.**

The SELECT policy: `visibility = 'firm' OR team_id IS NULL OR created_by = auth.uid()`

This means:
- ✅ `visibility = 'firm'` → everyone sees it
- ⚠️ `team_id IS NULL` → everyone sees it (catches legacy data and multi-target contributions)
- ✅ `created_by = auth.uid()` → author sees their own
- 🔴 `visibility = 'team'` + `team_id = <some-node>` + `created_by ≠ auth.uid()` → **INVISIBLE to everyone, including target team members**

### 6.3 Impact

| Visibility | team_id | Who CAN see (RLS) | Who SHOULD see | Gap? |
|-----------|---------|-------------------|----------------|:----:|
| `firm` | any | Everyone | Everyone | 🟢 No |
| `team` | NULL | Everyone | Target team members | 🟠 Too open |
| `team` | set | Only author | Target team members | 🔴 Too closed |
| `division` | set | Only author | Division members | 🔴 Too closed |
| `department` | set | Only author | Department members | 🔴 Too closed |
| `portfolio` | set | Only author | Portfolio members | 🔴 Too closed |

The code in `useContributions.ts` writes the visibility and targets correctly (lines ~190-250), but the RLS policy never uses the targets to determine who should have read access.

### 6.4 Workaround in practice

In practice, most contributions are created with `visibility = 'firm'` (the default in `useContributions.ts` line ~163), so the bug is rarely triggered. But any user who explicitly scopes a contribution to a specific team/division will find that only they can see it — defeating the purpose.

---

## 7. Write-Path Inventory

### 7.1 Coverage writes (20+ paths)

| # | File | Operation | Table | UI Gate | RLS Gate |
|---|------|-----------|-------|---------|----------|
| 1 | CoverageManager.tsx | Insert new coverage | `coverage` | `hasAnyCoverageAdminRights` | ❌ `true` |
| 2 | CoverageManager.tsx | Update role | `coverage` | node admin check | ❌ `true` |
| 3 | CoverageManager.tsx | Update visibility | `coverage` | `canChangeVisibility()` | ❌ `true` |
| 4 | CoverageManager.tsx | Update team_id | `coverage` | node admin check | ❌ `true` |
| 5 | CoverageManager.tsx | Update portfolio_id | `coverage` | node admin check | ❌ `true` |
| 6 | CoverageManager.tsx | Toggle is_active | `coverage` | `hasAnyCoverageAdminRights` | ❌ `true` |
| 7 | CoverageManager.tsx | Delete coverage | `coverage` | node admin check | ✅ `coverage_admin` or own |
| 8 | CoverageManager.tsx | Bulk update | `coverage` | admin check | ❌ `true` |
| 9 | CoverageManager.tsx | Create request | `coverage_requests` | non-admin UI path | ✅ `requested_by = uid()` |
| 10 | CoverageManager.tsx | Approve request | `coverage_requests` | `hasAnyCoverageAdminRights` | ⚠️ Global admin only |
| 11 | CoverageManager.tsx | Deny request | `coverage_requests` | `hasAnyCoverageAdminRights` | ⚠️ Global admin only |
| 12 | CoverageManager.tsx | Rescind request | `coverage_requests` | own request check | ✅ own request |
| 13 | OrganizationPage.tsx | Upsert settings | `coverage_settings` | `user.coverage_admin` | ✅ org-scoped + admin |
| 14 | useContributions.ts | Create contribution | `asset_contributions` | Authenticated user | ✅ `created_by = uid()` |
| 15 | useContributions.ts | Update contribution | `asset_contributions` | Own contribution | ✅ `created_by = uid()` |
| 16 | useContributions.ts | Delete contribution | `asset_contributions` | Own contribution | ✅ `created_by = uid()` |
| 17 | useContributions.ts | Insert targets | `contribution_visibility_targets` | Own contribution | ✅ join check |
| 18 | useContributions.ts | Delete targets | `contribution_visibility_targets` | Own contribution | ✅ join check |

### 7.2 Cross-platform read consumers

**18 files** query `coverage` directly. **9 files** query `asset_contributions`. **1 file** queries `contribution_visibility_targets`.

None apply organization filtering. All rely on (currently permissive) RLS.

---

## 8. Privilege Escalation Risks

### Risk 1: 🔴 Any authenticated user can create coverage assignments

**Vector**: Direct Supabase call — `supabase.from('coverage').insert({ asset_id, user_id, role: 'primary', is_active: true })`
**Impact**: User in Org B can assign themselves as primary analyst on any asset in Org A. Downstream effects: they appear as covering analyst in ThesisContainer, OutcomesContainer, CoverageDisplay, etc.
**Root cause**: `coverage` INSERT policy is `WITH CHECK (true)`.

### Risk 2: 🔴 Any authenticated user can modify coverage records

**Vector**: `supabase.from('coverage').update({ role: 'primary', user_id: attackerId }).eq('id', targetCoverageId)`
**Impact**: Attacker can take over someone else's coverage assignment or change roles/teams arbitrarily.
**Root cause**: `coverage` UPDATE policy is `USING (true) WITH CHECK (true)`.

### Risk 3: 🔴 Cross-org data visibility

**Vector**: `supabase.from('coverage').select('*')` — no org filter in RLS
**Impact**: Complete coverage map of all organizations visible to any authenticated user.
**Root cause**: No `organization_id` column; SELECT policy is `USING (true)`.

### Risk 4: 🟠 Node-level admin approval fails silently

**Vector**: Node-level coverage admin approves a request through the UI → the UPDATE to `coverage_requests` is rejected by RLS (requires global `coverage_admin`).
**Impact**: Request approval silently fails. The UI may show success optimistically but the server rejects.
**Root cause**: `coverage_requests` UPDATE policy only checks `users.coverage_admin`, not `org_chart_node_members.is_coverage_admin`.

### Risk 5: 🟠 Audit trail fabrication

**Vector**: `supabase.from('coverage_history').insert({ coverage_id, change_type: 'created', ... })`
**Impact**: Fake audit records can be injected. History is meant to be trigger-populated only.
**Root cause**: `coverage_history` INSERT policy is `WITH CHECK (true)`.

### Risk 6: 🔴 Contribution visibility broken for non-firm scopes

**Vector**: User creates a contribution with `visibility = 'team'` targeting their team node.
**Impact**: The contribution becomes invisible to team members (only visible to author). Users believe they're sharing with their team but aren't.
**Root cause**: `asset_contributions` SELECT policy ignores `contribution_visibility_targets`.

---

## 9. Schema / UI Mismatches

### 9.1 `coverage.visibility` — written but never enforced

| Aspect | Status |
|--------|--------|
| Column exists? | ✅ `text`, default `'team'` |
| UI writes it? | ✅ CoverageManager sets team/division/firm |
| UI displays it? | ✅ Badge pill in coverage list |
| RLS enforces it? | ❌ No policy references `visibility` |
| Any query filters by it? | ❌ No consumer uses it as a filter |

### 9.2 Node-level coverage admin — UI grants more authority than RLS allows

| Aspect | UI | RLS |
|--------|-----|-----|
| View requests for their teams | ✅ Shown | ❌ Only global admin SELECT |
| Approve/deny requests | ✅ Buttons visible | ❌ Only global admin UPDATE |
| Create coverage for their teams | ✅ "Add Coverage" enabled | ❌ Anyone can INSERT (`true`) |
| Edit coverage for their teams | ✅ Edit controls shown | ❌ Anyone can UPDATE (`true`) |

### 9.3 `canManageCoverageForNode()` override fence — UI only

The org-chart override fence system (`coverage_admin_override` flag on `org_chart_nodes`) is implemented entirely in the UI via `canManageCoverageForNode()`. There is no server-side equivalent. The fence prevents node-level admins from managing coverage in subtrees where an override is set — but only if they use the UI.

### 9.4 `contribution_visibility_targets` — written but never read by RLS

The `useContributions.ts` hook correctly writes target rows when visibility is non-firm. The `contribution_visibility_targets` SELECT policy is `USING (true)` (anyone can read). But the parent `asset_contributions` SELECT policy never joins or subqueries against these targets.

### 9.5 `coverage_history.change_type` check constraint mismatch

The check constraint allows: `'created'`, `'analyst_changed'`, `'dates_changed'`, `'deleted'`, `'coverage_added'`, `'historical_added'`.

The trigger function `log_coverage_change()` writes: `'coverage_added'` (INSERT), `'analyst_changed'` (UPDATE with user_id change), `'dates_changed'` (UPDATE with date change), `'deleted'` (DELETE).

The UI also writes `'role_change'` via inline operations — but this value is **not in the check constraint**. These writes would fail silently or be cast to a default.

---

## 10. Recommendations (Minimal, Enforcement-First)

These recommendations focus strictly on closing enforcement gaps. No new features.

### P0 — Critical (do first)

#### R1. Add `organization_id` to `coverage` and enforce in RLS

```sql
ALTER TABLE coverage ADD COLUMN organization_id uuid REFERENCES organizations(id);
-- Backfill from user's org
UPDATE coverage SET organization_id = (SELECT current_organization_id FROM users WHERE users.id = coverage.created_by);
-- Add RLS
CREATE POLICY "coverage_org_scoped_select" ON coverage FOR SELECT
  USING (organization_id = current_org_id() AND is_active_member_of_current_org());
```

#### R2. Restrict `coverage` INSERT/UPDATE to coverage admins

Replace the permissive INSERT/UPDATE policies:

```sql
-- INSERT: only coverage admins or node-level admins
DROP POLICY "Authenticated users can insert coverage" ON coverage;
CREATE POLICY "Coverage admins can insert" ON coverage FOR INSERT
  WITH CHECK (
    organization_id = current_org_id()
    AND (
      EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND coverage_admin = true)
      OR EXISTS (SELECT 1 FROM org_chart_node_members WHERE user_id = auth.uid() AND is_coverage_admin = true)
    )
  );

-- UPDATE: same pattern
DROP POLICY "Authenticated users can update coverage" ON coverage;
DROP POLICY "Enable update for own records" ON coverage;
CREATE POLICY "Coverage admins can update" ON coverage FOR UPDATE
  USING (organization_id = current_org_id() AND ...)
  WITH CHECK (organization_id = current_org_id() AND ...);
```

#### R3. Fix `asset_contributions` SELECT to use `contribution_visibility_targets`

Replace the SELECT policy with one that properly checks node membership:

```sql
DROP POLICY "Users can view contributions" ON asset_contributions;
CREATE POLICY "Users can view contributions" ON asset_contributions FOR SELECT
  USING (
    visibility = 'firm'
    OR created_by = auth.uid()
    OR (
      visibility IN ('team', 'department', 'division')
      AND EXISTS (
        SELECT 1 FROM contribution_visibility_targets cvt
        JOIN org_chart_node_members ocnm ON ocnm.node_id = cvt.node_id
        WHERE cvt.contribution_id = asset_contributions.id
          AND ocnm.user_id = auth.uid()
      )
    )
  );
```

### P1 — High (do soon)

#### R4. Add node-level admin check to `coverage_requests` UPDATE

```sql
DROP POLICY "Coverage admins can update requests" ON coverage_requests;
CREATE POLICY "Coverage admins can update requests" ON coverage_requests FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND coverage_admin = true)
    OR EXISTS (SELECT 1 FROM org_chart_node_members WHERE user_id = auth.uid() AND is_coverage_admin = true)
  );
```

#### R5. Restrict `coverage_history` INSERT to trigger-only

```sql
DROP POLICY "Allow insert to coverage_history" ON coverage_history;
-- The log_coverage_change() trigger runs as SECURITY DEFINER and bypasses RLS.
-- No direct INSERT policy needed for application users.
```

#### R6. Add `organization_id` to `coverage_history` and `coverage_requests`

Same pattern as R1 — add column, backfill, enforce in RLS.

### P2 — Medium (track)

#### R7. Scope `contribution_visibility_targets` SELECT to contribution owners + targets

Replace `USING (true)` with a check that the user either owns the contribution or is a member of a target node.

#### R8. Fix `coverage_history.change_type` check constraint

Add `'role_change'` to the allowed values, or update the UI to use an existing allowed value.

#### R9. Add server-side coverage_admin_override fence

Currently UI-only via `canManageCoverageForNode()`. Consider encoding this in a Postgres function used by RLS policies to match the UI behavior.

---

## Appendix: Terminal Summary

### Tables reviewed: 6

| Table | Org-scoped | SELECT | INSERT | UPDATE | DELETE |
|-------|:----------:|:------:|:------:|:------:|:------:|
| `coverage` | ❌ | OPEN | OPEN | OPEN | Restricted |
| `coverage_history` | ❌ | OPEN | OPEN | Restricted | Restricted |
| `coverage_requests` | ❌ | Partial | Restricted | Partial | — |
| `coverage_settings` | ✅ | Restricted | Restricted | Restricted | — |
| `asset_contributions` | ❌ | Broken | Restricted | Restricted | Restricted |
| `contribution_visibility_targets` | ❌ | OPEN | Restricted | — | Restricted |

### Counts

- **Write paths audited**: 18 distinct mutation/inline-write locations
- **Cross-platform consumers**: 18 files query `coverage`; 9 files query `asset_contributions`
- **Organization-scoped tables**: 1 of 6

### Top 5 Risks

| # | Severity | Risk | Section |
|---|:--------:|------|---------|
| 1 | 🔴 | `coverage` INSERT/UPDATE fully permissive — any user can create or modify coverage | §3.1 |
| 2 | 🔴 | No `organization_id` on `coverage` — cross-org data exposure | §3.1 |
| 3 | 🔴 | `asset_contributions` SELECT ignores `contribution_visibility_targets` | §3.5, §6.2 |
| 4 | 🟠 | Node-level admins cannot approve `coverage_requests` at RLS layer | §3.3 |
| 5 | 🟠 | `coverage_history` INSERT is permissive — audit trail can be fabricated | §3.2 |
