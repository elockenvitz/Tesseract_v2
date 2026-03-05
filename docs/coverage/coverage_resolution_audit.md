# Coverage Resolution & Scope Matching Audit

> **Scope**: How the platform resolves which coverage record(s) apply for a given viewer + asset, how scope is represented in the DB, and where resolution logic lives. Based entirely on schema inspection and codebase grep.
>
> **Date**: 2026-03-03

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [DB Model for Scope](#2-db-model-for-scope)
3. [Org Association Computation](#3-org-association-computation)
4. [Scope Matching Logic](#4-scope-matching-logic)
5. [Default Owner Selection (Determinism)](#5-default-owner-selection-determinism)
6. [Resolution Callsite Map](#6-resolution-callsite-map)
7. [Consolidation Plan](#7-consolidation-plan)

---

## 1. Executive Summary

### What exists today

There is **no `resolveCoverageOwner` helper** or any centralized coverage resolution function anywhere in the codebase. Every consumer queries `from('coverage')` independently with its own column selection, filters, and (usually missing) ordering.

Coverage scope is encoded implicitly through the combination of `coverage.team_id` (FK → `org_chart_nodes`), `coverage.visibility` (text: `'team'`/`'division'`/`'firm'`), and `coverage.portfolio_id` (FK → `portfolios`). There is no explicit `scope_type` + `scope_id` pair.

### Biggest gaps

1. **No resolution helper**: 24 callsites query `from('coverage')` independently. Zero use a shared function.
2. **No scope matching**: No callsite cross-references the viewer's org branch memberships against coverage `team_id`/`visibility` to filter "in-scope" records. Every query returns ALL active coverage for an asset — scope is ignored for reads.
3. **Nondeterministic default selection**: 19 of 24 callsites have no `ORDER BY`. When a single "default owner" is needed (e.g., `coverage[0]` in the asset table), the result depends on Postgres insertion order.
4. **Dual "primary" signals**: Both `coverage.role = 'primary'` and `coverage.is_lead = true` exist as competing signals for "default owner". Only 2 callsites check either flag.
5. **No uniqueness constraint**: Multiple active coverage rows per (asset_id, user_id) pair are allowed. No constraint enforces at most one primary per asset.

---

## 2. DB Model for Scope

### 2.1 Scope-encoding columns on `coverage`

| Column | Type | Nullable | Default | FK | Scope role |
|--------|------|:--------:|---------|-----|-----------|
| `team_id` | uuid | YES | NULL | → `org_chart_nodes(id)` | **Org branch**: which team/node this coverage is associated with |
| `visibility` | text | YES | `'team'` | — | **Scope breadth**: `'team'`, `'division'`, or `'firm'` |
| `portfolio_id` | uuid | YES | NULL | → `portfolios(id)` | **Portfolio context**: which portfolio the analyst covers the asset for |
| `role` | text | YES | NULL | — | **Analyst rank**: `'primary'`, `'secondary'`, `'tertiary'`, or custom text |
| `is_lead` | boolean | YES | `false` | — | **Lead flag**: alternative "primary" signal (used in asset table) |

### 2.2 How scope is (implied) structured

Scope is **NOT** a single column. It is a **composite of `team_id` + `visibility`**:

```
visibility = 'firm'     → coverage applies firm-wide regardless of team_id
visibility = 'division' → coverage scoped to team_id's division subtree
visibility = 'team'     → coverage scoped to team_id's node only
```

There is **no `scope_id`** column. The `team_id` serves double-duty: it is both the org-chart node the analyst belongs to AND the implicit scope anchor.

When `team_id` is NULL, the coverage record has no org-branch association. The `visibility` field becomes meaningless (team/division scope with no team reference is unscopeable).

### 2.3 Uniqueness constraints

**There are NO uniqueness constraints on the `coverage` table** that would prevent:
- Multiple active rows for the same `(asset_id, user_id)` pair
- Multiple rows with `role = 'primary'` for the same `asset_id`
- Multiple rows with `is_lead = true` for the same `asset_id`

The system explicitly allows historical + active rows to coexist (distinguished by `is_active` flag). But even among active rows, nothing prevents duplicates.

**Relevant indexes** (informational, not uniqueness-enforcing):

| Index | Columns | Condition |
|-------|---------|-----------|
| `idx_coverage_active` | `(asset_id, is_active)` | `WHERE is_active = true` |
| `idx_coverage_user_active` | `(user_id)` | `WHERE is_active = true` |
| `idx_coverage_team_id` | `(team_id)` | — |
| `idx_coverage_role` | `(role)` | — |
| `idx_coverage_visibility` | `(visibility)` | — |
| `idx_coverage_portfolio` | `(portfolio_id)` | — |

### 2.4 `coverage_settings` defaults

The `coverage_settings` table (per-org) contains:

| Column | Default | Relevance |
|--------|---------|-----------|
| `default_visibility` | `'team'` | Default scope for new coverage records |
| `allow_multiple_coverage` | `true` | Whether multiple analysts can cover the same asset |

These settings are read by CoverageManager when creating records but have no query-time enforcement.

---

## 3. Org Association Computation

### 3.1 Primary data fetchers

These queries load the viewer's org membership data:

| Helper | File | Lines | What it returns |
|--------|------|-------|-----------------|
| `useOrganizationData` | `src/hooks/useOrganizationData.ts` | 20–193 | `{ orgMembers, teamMemberships, portfolioMemberships, teams, portfolios }` — full org context for the current user |
| Org chart node members query | `src/pages/OrganizationPage.tsx` | 1005–1037 | `OrgChartNodeMember[]` — raw node memberships with `is_coverage_admin`, `role`, `focus` |
| Team memberships query | `src/pages/OrganizationPage.tsx` | 593–620 | `TeamMembership[]` — legacy team table memberships with user profiles |
| User coverage admin nodes query | `src/pages/OrganizationPage.tsx` | 1040–1049 | `node_id[]` — nodes where current user is a coverage admin |
| Portfolio team members query | `src/pages/OrganizationPage.tsx` | ~980–1003 | Portfolio team member records with full user/portfolio context |

### 3.2 Derived structures

| Helper | File | Lines | What it computes |
|--------|------|-------|-----------------|
| `unifiedNodeMembers` | `src/pages/OrganizationPage.tsx` | 1057–1129 | Merges `portfolio_team` + `org_chart_node_members` into a single deduped array. Composite key: `node_id:user_id:role`. For portfolio nodes, prefers `portfolio_team` entries. |
| `buildOrgGraph` | `src/lib/org-graph.ts` | 179–516 | Transforms raw data into adjacency-list `OrgGraph`. Computes: childIds, memberCount, path, depth, health scores, per-analyst stats. |
| `useOrgGraph` | `src/hooks/useOrgGraph.ts` | 33–40 | React hook memoizing `buildOrgGraph` output. |
| `buildAuthorityRows` | `src/lib/authority-map.ts` | 169–369 | For each org member, aggregates role chips, coverage scopes, team/portfolio assignments, risk flags. |

### 3.3 Graph traversal helpers (all in `src/lib/org-graph.ts`)

| Function | Lines | What it returns |
|----------|-------|-----------------|
| `getAncestors(graph, nodeId)` | 679–685 | Ancestor nodes root → node (exclusive) |
| `getDescendants(graph, nodeId)` | 688–690 | All descendant nodes (excluding self) |
| `getSubtree(graph, nodeId)` | 661–676 | Subtree rooted at nodeId (inclusive) |
| `getChildren(graph, nodeId)` | 692–699 | Direct children, sorted by sortOrder |
| `findNodes(graph, predicate)` | 701–711 | All nodes matching predicate |
| `getNodesByType(graph, type)` | 718–721 | All nodes of given type (division/department/team/etc.) |
| `flattenTree(graph)` | 723–730 | All nodes in DFS order |

### 3.4 Key finding: org association is never used for coverage reads

Despite the rich org-association infrastructure above, **no coverage query** uses these helpers to scope coverage results. The viewer's node memberships, team memberships, and division/department memberships are computed for the Organization tab's permission UI — but never applied to filter coverage reads on asset pages, dashboards, or other consumers.

---

## 4. Scope Matching Logic

### 4.1 Does scope matching exist today?

**No.** There is no code anywhere in the codebase that:
1. Looks at a coverage record's `team_id` + `visibility`
2. Looks up the viewer's org-branch memberships
3. Determines whether the coverage record is "in scope" for the viewer

Every coverage consumer fetches ALL active coverage for an asset and displays/uses all of them regardless of the viewer's org position.

### 4.2 Where scope matching SHOULD exist (but doesn't)

| Surface | Current behavior | Expected behavior |
|---------|-----------------|-------------------|
| Asset header / CoverageDisplay | Shows ALL covering analysts | Should prioritize analysts in viewer's branch |
| ThesisContainer | Shows ALL covering analysts' tabs | Should highlight in-scope analyst as default |
| OutcomesContainer | Uses `role === 'primary'` (no scope) | Should prefer in-scope primary |
| AssetTableView "Covered By" | Uses `is_lead` then `[0]` | Should prefer in-scope analyst |
| Command Center | Checks if user covers the asset | Correct (user-scoped) |
| Workflow universe builder | Filters by selected analyst | Correct (explicit selection) |

### 4.3 Precedence rules

No precedence rules exist. If they were to be defined, the natural hierarchy from the org model would be:

```
1. team   → coverage.team_id matches one of viewer's node memberships
2. division → coverage.team_id's ancestor division contains viewer's node
3. firm   → coverage.visibility = 'firm' (always matches)
```

This hierarchy is **not implemented** anywhere.

### 4.4 The `visibility` field is purely metadata

The `coverage.visibility` column is:
- ✅ Written when creating/editing coverage in CoverageManager
- ✅ Displayed as a badge pill in coverage list views
- ✅ Included in the filter dropdown on the Coverage tab
- ❌ Never used in any query WHERE clause outside CoverageManager filters
- ❌ Never used in RLS policies
- ❌ Never used to determine which records a viewer should see

---

## 5. Default Owner Selection (Determinism)

### 5.1 "Primary" signals: two competing mechanisms

| Signal | Column | Where used |
|--------|--------|-----------|
| **Role-based** | `role = 'primary'` | CoverageDisplay (sort), OutcomesContainer (`find(t => t.coverage?.role === 'primary')`), AssetTab (ORDER BY role) |
| **Lead flag** | `is_lead = true` | AssetTableView (`coverage.find(c => c.isLead) \|\| coverage[0]`) |

These two signals are **independent** — a record can be `role='primary'` but `is_lead=false`, or vice versa. No code reconciles them.

### 5.2 Determinism analysis by callsite

**Deterministic** (5 of 24):

| Callsite | How |
|----------|-----|
| AssetTab.tsx | `.order('role', { ascending: true })` — primary sorts first alphabetically |
| CreateWorkflowWizard.tsx | `.order('analyst_name')` — alphabetical |
| SimplifiedUniverseBuilder.tsx | `.order('analyst_name')` + `.limit(20)` |
| WorkflowsPage.tsx | `.order('analyst_name')` |
| AssetRunDetailPanel.tsx | `.eq('user_id', userId)` — user-scoped (no ordering needed) |

**Nondeterministic** (19 of 24):

All remaining callsites have **no ORDER BY** clause. Results depend on Postgres row storage order, which is:
- Typically insertion order for heap tables
- Can change after VACUUM, UPDATE, or concurrent INSERT
- Not guaranteed across identical queries

### 5.3 The `coverage[0]` problem

Two specific callsites take `coverage[0]` as the "default owner" when no lead/primary is found:

**`AssetTableView.tsx` lines 3524, 4385**:
```typescript
const lead = coverage.find(c => c.isLead) || coverage[0]
```

This is the **only default-owner selection** in the codebase. It uses `is_lead` as primary signal, falling back to the first element of an unordered array. The underlying coverage query (line 677) has **no ORDER BY**.

### 5.4 No uniqueness enforcement

Nothing prevents:
- Two analysts both having `role = 'primary'` on the same asset
- Two analysts both having `is_lead = true` on the same asset
- The same analyst having two active coverage rows for the same asset (e.g., different portfolios or teams)

Without uniqueness constraints, even `find(c => c.role === 'primary')` can return different results depending on which duplicate appears first.

---

## 6. Resolution Callsite Map

This is the comprehensive table of every location that queries coverage data and how it resolves/selects coverage owners.

| # | File | Component / Function | Purpose | Query columns | Filters | ORDER BY | How owner selected | Shared helper? | Deterministic? |
|---|------|---------------------|---------|---------------|---------|----------|-------------------|:--------------:|:--------------:|
| 1 | `src/components/tabs/AssetTab.tsx:499` | AssetTab | Display covering analysts | `*, portfolio:portfolios(name)` | `asset_id, is_active=true` | `role ASC` | All shown, primary first via sort | N | **Y** |
| 2 | `src/components/coverage/CoverageDisplay.tsx:67` | CoverageDisplay | Render analyst list | Receives array (no query) | — | JS: `roleOrder` map (primary=0, secondary=1, tertiary=2) | All shown, sorted by role | N | **Y** |
| 3 | `src/components/table/AssetTableView.tsx:677` | AssetTableView query | Fetch all coverage for table | `asset_id, user_id, analyst_name, role, is_lead, team_id, org_chart_nodes(id,name)` | `is_active=true` | **None** | — | N | **N** |
| 4 | `src/components/table/AssetTableView.tsx:3524` | AssetTableView cell | Pick default for cell display | — | — | — | `find(c => c.isLead) \|\| coverage[0]` | N | **N** |
| 5 | `src/components/contributions/ThesisContainer.tsx:94` | ThesisContainer | Covering analyst user IDs | `user_id, analyst_name, role` | `asset_id, is_active=true` | **None** | All → `Set<string>` (no single pick) | N | **N** |
| 6 | `src/components/outcomes/OutcomesContainer.tsx:88` | OutcomesContainer | Coverage roles for aggregation | `user_id, analyst_name, role` | `asset_id, is_active=true` | **None** | All returned; `role === 'primary'` checked downstream | N | **N** |
| 7 | `src/hooks/useOutcomeAggregation.ts:100` | useOutcomeAggregation | Primary analyst price target | — (uses price target with coverage join) | — | — | `.find(t => t.coverage?.role === 'primary')` — first primary wins | N | **N** |
| 8 | `src/hooks/useAnalystPriceTargets.ts:132` | useAnalystPriceTargets | Role per user for price targets | `user_id, role, is_active` | `asset_id, is_active=true` | **None** | Map by user_id (multiple roles per user possible) | N | **N** |
| 9 | `src/hooks/useUserAssetPriority.ts:127` | useUserAssetPriority (single) | Covering analyst IDs for asset | `user_id` | `asset_id, is_active=true` | **None** | All → `string[]` | N | **N** |
| 10 | `src/hooks/useUserAssetPriority.ts:362` | useUserAssetPriority (batch) | Coverage map for multiple assets | `asset_id, user_id` | `asset_id IN (...), is_active=true` | **None** | Map by asset_id → user_id[] | N | **N** |
| 11 | `src/hooks/useCommandCenter.ts:191` | useCommandCenter | User's covered assets | `asset_id` | `user_id=current, is_active=true` | **None** | All → `Set<asset_id>` (user-scoped, no owner pick) | N | **Y** |
| 12 | `src/components/tabs/UserTab.tsx` | UserTab | User's coverage list | `*` + assets join | `user_id=target` | **None** | All returned (user profile display) | N | **N** |
| 13 | `src/components/contributions/ThesisHistoryView.tsx:939` | ThesisHistoryView | Analyst user IDs for asset | `user_id` | `asset_id` | **None** | All returned | N | **N** |
| 14 | `src/pages/OrganizationPage.tsx:1173` | OrganizationPage stats | Coverage statistics by team | `asset_id, user_id` | `is_active=true` | **None** | All → user→asset map for counting | N | **N** |
| 15 | `src/pages/OrganizationPage.tsx:1269` | OrganizationPage raw | Raw coverage for OrgGraph | `asset_id, user_id` | `is_active=true` | **None** | All returned (graph aggregation) | N | **N** |
| 16 | `src/pages/OrganizationPage.tsx:5626` | OrganizationPage team | Coverage by team members | `id, asset_id, user_id, visibility, role, is_lead, created_at` | `user_id IN (members), is_active=true` | `created_at DESC` | Most recent first (display order) | N | **Y** |
| 17 | `src/components/workflow/CreateWorkflowWizard.tsx` | CreateWorkflowWizard (list) | Analyst dropdown | `user_id, analyst_name` | `is_active=true` | `analyst_name ASC` | Alphabetical for dropdown | N | **Y** |
| 18 | `src/components/workflow/CreateWorkflowWizard.tsx` | CreateWorkflowWizard (filter) | Asset filter by analyst | `asset_id` | `user_id IN (...), is_active=true` | **None** | Asset IDs returned (no owner pick) | N | N/A |
| 19 | `src/components/workflow/SimplifiedUniverseBuilder.tsx` | SimplifiedUniverseBuilder | Analyst search | `user_id, analyst_name` | `ilike(analyst_name), is_active=true` | `analyst_name ASC` | Alphabetical + limit 20 | N | **Y** |
| 20 | `src/components/workflow/views/UniverseView.tsx` | UniverseView | Filter by analyst | `asset_id` | `user_id IN (...), is_active=true` | **None** | Asset IDs returned | N | N/A |
| 21 | `src/pages/WorkflowsPage.tsx` | WorkflowsPage | Unique analysts dropdown | `user_id, analyst_name` | `is_active=true` | `analyst_name ASC` | Alphabetical | N | **Y** |
| 22 | `src/components/modals/UniversePreviewModal.tsx` | UniversePreviewModal | Analyst filter preview | `asset_id` | `user_id IN (...), is_active=true` | **None** | Asset IDs returned | N | N/A |
| 23 | `src/components/workflow/views/AssetRunDetailPanel.tsx` | AssetRunDetailPanel | User's covered assets | `asset_id` | `user_id=current, is_active=true` | **None** | User-scoped (no owner pick) | N | **Y** |
| 24 | `src/lib/universeAssetMatcher.ts` | universeAssetMatcher | Analyst filter matching | `asset_id` | `user_id IN (...), is_active=true` | **None** | Asset IDs returned | N | N/A |

### Summary counts

- **Total callsites**: 24 across 18 files
- **Shared helper used**: 0 (zero)
- **Deterministic**: 8 (but 4 of those are N/A — asset filtering, not owner selection)
- **Nondeterministic owner selection**: At least **4 callsites** pick a "default" from unordered results
- **Scope matching applied**: 0 (zero)

---

## 7. Consolidation Plan

### 7.1 Proposed helper

Create `src/lib/coverage/resolveCoverage.ts`:

```typescript
import { supabase } from '../supabase'

export interface ResolvedCoverage {
  /** Coverage records where analyst's team_id matches viewer's org branch */
  inScope: CoverageRow[]
  /** Coverage records with visibility='firm' (always relevant) */
  firmWide: CoverageRow[]
  /** Coverage records NOT in viewer's scope */
  outOfScope: CoverageRow[]
  /** Single deterministic default: in-scope primary > firm primary > in-scope lead >
      firm lead > in-scope newest > firm newest > any newest */
  chosenDefault: CoverageRow | null
}

export interface CoverageRow {
  id: string
  asset_id: string
  user_id: string
  analyst_name: string
  role: string | null
  is_lead: boolean
  team_id: string | null
  visibility: string
  portfolio_id: string | null
  created_at: string
}

/**
 * Resolve coverage for an asset from the viewer's perspective.
 *
 * Scope matching:
 *   1. Get viewer's node memberships (from cache or query)
 *   2. For each coverage row:
 *      - visibility='firm' → always in scope (firmWide bucket)
 *      - team_id IN viewer's nodes OR viewer's ancestor chain → inScope
 *      - else → outOfScope
 *   3. Default pick (tie-break): primary role > is_lead > newest created_at
 */
export async function resolveCoverageForViewer({
  viewerUserId,
  assetId,
  viewerNodeIds,   // pre-fetched viewer's org chart node IDs (direct + ancestors)
}: {
  viewerUserId: string
  assetId: string
  viewerNodeIds?: string[]
}): Promise<ResolvedCoverage> {
  // 1. Fetch all active coverage for asset, ordered deterministically
  const { data: rows, error } = await supabase
    .from('coverage')
    .select('id, asset_id, user_id, analyst_name, role, is_lead, team_id, visibility, portfolio_id, created_at')
    .eq('asset_id', assetId)
    .eq('is_active', true)
    .order('created_at', { ascending: false })

  if (error) throw error
  const all = (rows || []) as CoverageRow[]

  // 2. If no viewerNodeIds provided, fetch from DB
  const nodeIds = viewerNodeIds ?? await fetchViewerNodeIds(viewerUserId)
  const nodeIdSet = new Set(nodeIds)

  // 3. Bucket
  const inScope: CoverageRow[] = []
  const firmWide: CoverageRow[] = []
  const outOfScope: CoverageRow[] = []

  for (const row of all) {
    if (row.visibility === 'firm') {
      firmWide.push(row)
    } else if (row.team_id && nodeIdSet.has(row.team_id)) {
      inScope.push(row)
    } else if (!row.team_id) {
      // No team_id = legacy/unscoped → treat as firm
      firmWide.push(row)
    } else {
      outOfScope.push(row)
    }
  }

  // 4. Pick default via tie-break
  const chosenDefault = pickDefault([...inScope, ...firmWide]) ?? pickDefault(outOfScope) ?? null

  return { inScope, firmWide, outOfScope, chosenDefault }
}

/** Deterministic tie-break: primary role > is_lead > newest */
function pickDefault(rows: CoverageRow[]): CoverageRow | null {
  if (rows.length === 0) return null
  const primary = rows.find(r => r.role === 'primary')
  if (primary) return primary
  const lead = rows.find(r => r.is_lead)
  if (lead) return lead
  // rows are already ordered by created_at DESC (newest first)
  return rows[0]
}

async function fetchViewerNodeIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('org_chart_node_members')
    .select('node_id')
    .eq('user_id', userId)
  return (data || []).map(d => d.node_id)
}
```

**Synchronous variant** for components that already have coverage data loaded:

```typescript
/** Pure function for components with pre-fetched coverage and viewer nodes */
export function resolveCoverageSync(
  allCoverage: CoverageRow[],
  viewerNodeIds: string[],
): ResolvedCoverage {
  // Same bucketing + tie-break as above, no DB call
}
```

### 7.2 Tie-break rule recommendation

Since `role = 'primary'` is more widely used than `is_lead` (3 callsites vs 1), and `role` is part of the `CoverageDisplay` sort order, the recommended tie-break order is:

```
1. role = 'primary'   → highest priority
2. is_lead = true     → second priority
3. role = 'secondary' → third
4. role = 'tertiary'  → fourth
5. newest created_at  → final fallback (deterministic, newest wins)
```

This matches the existing `CoverageDisplay` sort logic (line 67–72) and the `OutcomesContainer` primary check.

### 7.3 Callsites to refactor

Only callsites that **pick a default owner** or **would benefit from scope matching** need to switch. Callsites that aggregate all coverage (org stats, universe filtering) can remain unchanged.

| Priority | Callsite | Current | Change to |
|:--------:|----------|---------|-----------|
| **P0** | `AssetTableView.tsx:3524` | `find(c => c.isLead) \|\| coverage[0]` | `resolveCoverageSync(coverage, viewerNodeIds).chosenDefault` |
| **P0** | `AssetTableView.tsx:4385` | Same as above (duplicate) | Same fix |
| **P1** | `useOutcomeAggregation.ts:100` | `find(t => t.coverage?.role === 'primary')` | Use `chosenDefault` from resolved coverage |
| **P1** | `OutcomesContainer.tsx:88` | No ORDER BY, role checked downstream | Add `.order('created_at', { ascending: false })`, or use helper |
| **P1** | `ThesisContainer.tsx:94` | No ORDER BY, returns Set | Add `.order('role')` for stable ordering |
| **P2** | `AssetTab.tsx:499` | Has ORDER BY role — OK for display | Pass viewer context to highlight in-scope analysts |
| **P2** | `useAnalystPriceTargets.ts:132` | No ORDER BY, maps by user_id | OK for map usage, but add ORDER BY for stability |
| **P2** | `useUserAssetPriority.ts:127` | No ORDER BY | Add `.order('created_at', { ascending: false })` |

### 7.4 Callsites that do NOT need refactoring

These aggregate all coverage or are user-scoped and don't need scope matching:

- `useCommandCenter.ts` — user-scoped (own coverage)
- `AssetRunDetailPanel.tsx` — user-scoped
- `OrganizationPage.tsx` (3 queries) — org aggregation stats
- `CreateWorkflowWizard.tsx` — analyst dropdown
- `SimplifiedUniverseBuilder.tsx` — analyst search
- `WorkflowsPage.tsx` — analyst dropdown
- `UniverseView.tsx`, `UniversePreviewModal.tsx`, `universeAssetMatcher.ts` — asset filtering
- `UserTab.tsx` — user profile display
- `ThesisHistoryView.tsx` — history (all records needed)
- `CoverageManager.tsx` — admin management (sees everything)

### 7.5 File creation summary

| Action | File | What |
|--------|------|------|
| **Create** | `src/lib/coverage/resolveCoverage.ts` | Async `resolveCoverageForViewer` + sync `resolveCoverageSync` + `pickDefault` |
| **Modify** | `src/components/table/AssetTableView.tsx` | Import `resolveCoverageSync`, replace `find(c => c.isLead) \|\| coverage[0]` (2 locations) |
| **Modify** | `src/hooks/useOutcomeAggregation.ts` | Use `pickDefault` or `resolveCoverageSync` instead of bare `.find(role=primary)` |
| **Modify** | `src/components/outcomes/OutcomesContainer.tsx` | Add `.order('created_at', { ascending: false })` to coverage query |
| **Modify** | `src/components/contributions/ThesisContainer.tsx` | Add `.order('role')` to coverage query |
| **Modify** | `src/hooks/useAnalystPriceTargets.ts` | Add `.order('created_at', { ascending: false })` |
| **Modify** | `src/hooks/useUserAssetPriority.ts` | Add `.order('created_at', { ascending: false })` to both queries |

### 7.6 Schema changes (optional, not required for consolidation)

These are **NOT required** for the consolidation but would improve correctness:

1. **Partial unique index**: `CREATE UNIQUE INDEX idx_coverage_one_primary_per_asset ON coverage (asset_id) WHERE role = 'primary' AND is_active = true` — prevents multiple primaries per asset.
2. **Reconcile `is_lead` and `role='primary'`**: Migrate all `is_lead=true` rows to `role='primary'` and drop `is_lead`. Or, in `pickDefault`, treat them as equivalent (the helper already does this).
3. **Add `organization_id` to `coverage`**: Prerequisite for proper org-scoped queries (covered in the Enforcement Report).

---

## Appendix: Quick Reference

### Coverage scope columns found

| Column | Actually used in queries? |
|--------|:------------------------:|
| `visibility` | Only in CoverageManager filter dropdown. Never in asset/display queries. |
| `team_id` | In AssetTableView (joins org_chart_nodes for team name). Never used for scope matching. |
| `portfolio_id` | In AssetTab (joins portfolios for name). Never used for scope matching. |
| `role` | In AssetTab (ORDER BY), OutcomesContainer (find primary), CoverageDisplay (sort). |
| `is_lead` | In AssetTableView (find lead for default). |

### Org association helpers identified

| Helper | File |
|--------|------|
| `useOrganizationData` | `src/hooks/useOrganizationData.ts` |
| `buildOrgGraph` | `src/lib/org-graph.ts:179–516` |
| `useOrgGraph` | `src/hooks/useOrgGraph.ts:33–40` |
| `buildAuthorityRows` | `src/lib/authority-map.ts:169–369` |
| `resolveOrgPermissions` | `src/lib/permissions/orgGovernance.ts:131–142` |
| `getAncestors` / `getDescendants` / `getSubtree` | `src/lib/org-graph.ts:661–730` |

### Resolution callsite count: 24

### Top 5 nondeterministic / duplicated resolution locations

| # | File | Issue |
|---|------|-------|
| 1 | `AssetTableView.tsx:3524` | `find(c => c.isLead) \|\| coverage[0]` on unordered array — **nondeterministic fallback** |
| 2 | `AssetTableView.tsx:4385` | Exact duplicate of #1 (copy-pasted for different density mode) |
| 3 | `useOutcomeAggregation.ts:100` | `.find(t => t.coverage?.role === 'primary')` — first match from unordered source |
| 4 | `OutcomesContainer.tsx:88` | Coverage query with no ORDER BY — downstream consumers get unstable order |
| 5 | `ThesisContainer.tsx:94` | Coverage query with no ORDER BY — `Set<user_id>` iteration order depends on insertion |
