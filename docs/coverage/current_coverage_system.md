# Coverage Architecture & Behavior

> **Scope**: This document describes the Coverage system as it exists today in the Tesseract v2 codebase. It is based entirely on the repository source code, live database schema, and RLS policies. Nothing is invented.

---

## 1. Executive Summary

"Coverage" in Tesseract means **analyst-to-asset assignment**: which analyst is responsible for researching which securities. The `coverage` table is the source of truth. Each row maps one `user_id` (analyst) to one `asset_id` (security) with metadata: role (primary/secondary/tertiary/custom), visibility scope (team/division/firm), start/end dates, team assignment, portfolio affiliation, and an `is_active` flag.

Coverage data radiates outward across the platform:
- **Asset page** shows covering analysts and their thesis status.
- **Thesis/Outcomes** use coverage to determine which analysts have official contribution tabs.
- **Org chart health** flags teams with no coverage admin or uncovered assets.
- **Authority map** tracks coverage admin scopes for governance.
- **Asset table** has a "Covered By" column.
- **Notifications** fire when coverage requests are created.
- **Dashboard** routes to the Coverage tab.

The system has two admin tiers:
1. **Global coverage admin** (`users.coverage_admin = true`) — can manage all coverage assignments everywhere.
2. **Node-level coverage admin** (`org_chart_node_members.is_coverage_admin = true`) — can manage coverage for their team/node and its descendants, unless a `coverage_admin_override` fence exists.

Non-admins can view all coverage but can only *request* changes, which enter a pending → approved/denied/rescinded workflow.

---

## 2. Data Model & Source of Truth

### 2.1 `coverage` table (source of truth)

| Column | Type | Nullable | Default | Notes |
|--------|------|----------|---------|-------|
| `id` | uuid | NO | `gen_random_uuid()` | PK |
| `asset_id` | uuid | NO | — | FK → `assets(id)` |
| `user_id` | uuid | NO | — | FK → `users(id)` |
| `analyst_name` | text | NO | `''` | Denormalized display name |
| `created_at` | timestamptz | YES | `now()` | |
| `updated_at` | timestamptz | YES | `now()` | |
| `start_date` | date | YES | `CURRENT_DATE` | When coverage began |
| `end_date` | date | YES | NULL | NULL = ongoing |
| `is_active` | boolean | YES | `true` | Active coverage flag |
| `changed_by` | uuid | YES | NULL | Last editor |
| `created_by` | uuid | YES | NULL | Original creator |
| `role` | text | YES | NULL | `'primary'` / `'secondary'` / `'tertiary'` / custom |
| `portfolio_id` | uuid | YES | NULL | FK → `portfolios(id)` |
| `notes` | text | YES | NULL | Free-text |
| `team_id` | uuid | YES | NULL | FK → `org_chart_nodes(id)` via `coverage_team_id_fkey` |
| `visibility` | text | YES | `'team'` | `'team'` / `'division'` / `'firm'` |
| `is_lead` | boolean | YES | `false` | Lead analyst flag |

**Key indexes:**
- `idx_coverage_active` — partial index `(asset_id, is_active) WHERE is_active = true`
- `idx_coverage_user_active` — partial index `(user_id) WHERE is_active = true`
- `idx_coverage_asset_id`, `idx_coverage_user_id`, `idx_coverage_team_id`, `idx_coverage_portfolio`, `idx_coverage_role`, `idx_coverage_visibility`, `idx_coverage_dates`, `idx_coverage_analyst_name`, `idx_coverage_created_by`

**No unique constraint** on `(asset_id, user_id)` — the system explicitly allows multiple coverage records for the same analyst-asset pair (historical + active rows coexist). The `is_active` flag distinguishes current from historical.

### 2.2 `coverage_history` table (audit trail)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `coverage_id` | uuid | NOT FK — may outlive the source row |
| `asset_id` | uuid | FK → `assets(id)` |
| `change_type` | text | CHECK: `'created'`, `'analyst_changed'`, `'dates_changed'`, `'deleted'`, `'coverage_added'`, `'historical_added'` |
| `old_user_id`, `new_user_id` | uuid | Before/after analyst |
| `old_analyst_name`, `new_analyst_name` | text | Before/after name |
| `old_start_date`, `new_start_date` | date | Before/after |
| `old_end_date`, `new_end_date` | date | Before/after |
| `old_is_active`, `new_is_active` | boolean | Before/after |
| `changed_by` | uuid | Who made the change |
| `changed_at` | timestamptz | When |
| `change_reason` | text | Optional |
| `created_at` | timestamptz | Record timestamp |

Populated automatically by the `log_coverage_change()` trigger function (fires on INSERT, UPDATE, DELETE of `coverage`).

### 2.3 `coverage_requests` table (change workflow)

| Column | Type | Notes |
|--------|------|-------|
| `id` | uuid | PK |
| `asset_id` | uuid | FK → `assets(id)` |
| `current_user_id` | uuid | Current covering analyst (nullable) |
| `current_analyst_name` | text | |
| `requested_user_id` | uuid | Proposed new analyst |
| `requested_analyst_name` | text | |
| `request_type` | text | CHECK: `'add'`, `'change'`, `'remove'` |
| `reason` | text | Required justification |
| `status` | text | CHECK: `'pending'`, `'approved'`, `'denied'`, `'rescinded'` |
| `requested_by` | uuid | FK → `users(id)` |
| `reviewed_by` | uuid | FK → `users(id)` (nullable) |
| `reviewed_at` | timestamptz | Nullable |
| `created_at`, `updated_at` | timestamptz | |

**Unique constraint:** `unique_pending_coverage_request ON (asset_id, requested_by) WHERE status = 'pending'` — one pending request per user per asset.

### 2.4 `coverage_settings` table (org-level config)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `id` | uuid | PK | |
| `organization_id` | uuid | — | FK → organizations |
| `default_visibility` | text | `'team'` | Default for new coverage |
| `enable_hierarchy` | boolean | `false` | Enable role hierarchy |
| `hierarchy_levels` | jsonb | `["Lead Analyst", "Analyst"]` | Role hierarchy levels |
| `visibility_change_permission` | text | `'coverage_admin'` | `'anyone'` / `'team_lead'` / `'coverage_admin'` |
| `allow_multiple_coverage` | boolean | `true` | Multiple analysts per asset |
| `updated_by` | uuid | — | Last editor |
| `created_at`, `updated_at` | timestamptz | | |

### 2.5 Coverage admin flags (distributed across tables)

| Location | Column | Meaning |
|----------|--------|---------|
| `users` | `coverage_admin` (boolean) | **Global** coverage admin |
| `org_chart_node_members` | `is_coverage_admin` (boolean) | **Node-scoped** coverage admin |
| `org_chart_node_members` | `coverage_admin_blocked` (boolean) | Blocks inheritance from ancestor |
| `org_chart_nodes` | `coverage_admin_override` (boolean) | Prevents global admin from managing this node's coverage |

### 2.6 Triggers & functions

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `coverage_insert_trigger` | `coverage` | AFTER INSERT | `log_coverage_change()` |
| `coverage_update_trigger` | `coverage` | AFTER UPDATE | `log_coverage_change()` |
| `coverage_delete_trigger` | `coverage` | BEFORE DELETE | `log_coverage_change()` |
| `coverage_request_notification` | `coverage_requests` | AFTER INSERT WHERE status='pending' | `notify_coverage_request()` |

**`log_coverage_change()`** — Detects: new active coverage, analyst transitions (new active when another is already active → `analyst_changed`), future coverage activation, date changes, deletions. Preserves original `changed_by` when future coverage activates.

**`notify_coverage_request()`** — Inserts a notification for every `users.coverage_admin = true` user (except the requester) with `type = 'coverage_request'` and full context in `context_data` JSONB.

**`notify_asset_coverage_users(asset_id_param)`** — Returns all `(user_id, email, user_name)` from `coverage` for a given asset. Used by the general notification system to notify covering analysts of asset-level events.

---

## 3. Coverage Tab: UI/UX & Behavior

### 3.1 Entry Points

| Route | Component | Rendered via |
|-------|-----------|-------------|
| Dashboard tab "Coverage" | `CoveragePage` → `CoverageManager mode="page"` | `Layout.tsx` opens tab `{ type: 'coverage' }` |
| Modal (legacy) | `CoverageManager mode="modal"` | `onShowCoverageManager` callback |
| Header menu grid | Navigation to Coverage tab | `Layout.tsx` header section |
| Notification click | Opens Coverage with `initialView: 'requests'` | `Layout.tsx` notification handler |

**File:** `src/pages/CoveragePage.tsx` (13 lines — thin wrapper)
**File:** `src/components/coverage/CoverageManager.tsx` (9,106 lines — all logic)

### 3.2 Three main views (tabs)

**`activeView`** state: `'active'` | `'history'` | `'requests'`

#### Active View (`activeView === 'active'`)

Has four sub-modes via **`viewMode`** state:

| Mode | Purpose |
|------|---------|
| **List** | Main table of active coverage records. Columns: Asset, Analyst, Visibility, Sector, Start Date, Tenure, Industry, Market Cap. Configurable column visibility + multi-level grouping (division/department/team/portfolio/sector/industry/analyst). |
| **Gaps** | Assets without active coverage. Two sub-analyses: (1) Global gaps — all assets with `is_active=false` or no coverage row; (2) Portfolio-specific gaps — assets in portfolio universe without coverage, grouped by portfolio. |
| **Workload** | Analyst bandwidth. Groups coverage by analyst, shows count of covered assets. Stat cards: total analysts, total covered assets, gap count, average assets/analyst. |
| **Matrix** | Cross-tabulation. Group by sector/analyst/portfolio/team/holdings. Rows = group items, columns = analysts. Cells show coverage presence. Overlap detection (multiple analysts on same asset highlighted). |

#### History View (`activeView === 'history'`)

- Queries `coverage_history` table, limited to 100 rows.
- Shows: change_type badge, asset symbol, old→new analyst, old→new dates, changed_by, timestamp.
- Period filter: `comparisonPeriod` = `'7d'` | `'30d'` | `'90d'` | `'ytd'` | `'all'` | `'custom'`.
- Asset-specific timeline: clicking an asset opens its full coverage history (all `coverage` rows for that asset, active + inactive).
- `visibleHistoryCount` state (default 50, load more pattern).
- `expandedChanges` Set tracks which history rows are expanded for detail.

#### Requests View (`activeView === 'requests'`)

- Non-admins see only their own requests (`requested_by = auth.uid()`).
- Admins see all requests.
- Status filter: pending / approved / denied / rescinded.
- Admin actions: approve (executes the coverage change) / deny.
- User actions: rescind (cancel own pending request), resubmit (reactivate rescinded request).

### 3.3 Queries & cache keys

| Query Key | Table | Purpose | Enabled when |
|-----------|-------|---------|-------------|
| `['all-coverage']` | `coverage` | All records with asset/portfolio/team joins | Always (when visible) |
| `['assets-for-coverage']` | `assets` | Asset master for search/dropdowns | Always |
| `['teams-for-coverage']` | teams view | Team data | Always |
| `['asset-coverage-history', assetId]` | `coverage` | All coverage for specific asset (timeline) | `viewHistoryAssetId` set |
| `['coverage-change-history', assetId]` | `coverage_history` | Change log for specific asset | `viewHistoryAssetId` set |
| `['all-coverage-events']` | `coverage_history` | Global history (limit 100) | `activeView === 'history'` |
| `['coverage-requests', userId]` | `coverage_requests` | Requests list | `activeView === 'requests'` |
| `['coverage-gaps']` | `coverage` + `assets` | Uncovered assets | `viewMode === 'gaps'` |
| `['portfolio-universe-gaps']` | Multiple tables | Portfolio-specific gaps | `viewMode === 'gaps'` + portfolio grouping |
| `['coverage-settings', orgId]` | `coverage_settings` | Org config | Always |
| `['user-coverage-admin-nodes', userId]` | `org_chart_node_members` | User's node-level admin | Always |
| `['coverage-admin-override-nodes']` | `org_org_chart_nodes_v` | Nodes with override flag | Always |
| `['users']` | `users` | User list for dropdowns | Always |
| `['user-profiles-extended']` | `users` | Extended profiles | Always |
| `['org-admin-status', userId, orgId]` | `organization_memberships` | Is user an org admin | Always |
| `['portfolios']` | `portfolios` | Portfolio list for assignment | Always |
| `['user-team-memberships', userId]` | `org_chart_node_members` | User's team context | Always |
| `['all-org-chart-node-members-for-grouping']` | `org_chart_node_members` | All members for grouping | Always |
| `['org-chart-nodes-for-filter']` | `org_chart_nodes` | Node hierarchy for filters | Always |
| `['portfolio-holdings-for-matrix']` | `simulation_trades` | Holdings for matrix view | Always |
| `['portfolio-universe-assets-for-matrix']` | `portfolio_universe_assets` | Universe for matrix | Always |
| `['portfolio-team-memberships-for-grouping']` | `portfolio_team` | Portfolio team links | Always |

### 3.4 Mutations

| Mutation | Action | Invalidates |
|----------|--------|-------------|
| `updateCoverageMutation` | Update analyst on existing coverage | `all-coverage`, `coverage` |
| `bulkUploadMutation` | Parse CSV → insert batch | `all-coverage`, `coverage` |
| `deleteCoverageMutation` | Delete coverage row | `all-coverage`, `coverage` |
| `updateVisibilityMutation` | Change visibility level | `all-coverage`, `coverage` |
| `createCoverageRequestMutation` | Insert pending request | `coverage-requests` |
| `approveCoverageRequestMutation` | Set approved + execute action | `coverage-requests`, `all-coverage`, `coverage` |
| `denyCoverageRequestMutation` | Set denied | `coverage-requests` |
| `rescindCoverageRequestMutation` | Set rescinded (own only) | `coverage-requests` |
| `resubmitCoverageRequestMutation` | Set back to pending | `coverage-requests` |
| `saveTimelineChangesMutation` | Batch: update dates/analyst, delete, insert new periods | `all-coverage`, `coverage` |

### 3.5 Add Coverage flow

State: `addingCoverage` — captures asset ID, analyst ID, start date, end date, role, portfolio IDs, notes, team ID, visibility, is_lead.

The form includes:
- Asset search dropdown (filters `assets` query by symbol/name)
- Analyst search dropdown (filters `users` query)
- Role selector (primary/secondary/tertiary/custom)
- Portfolio multi-select
- Team selector (org chart nodes of type 'team')
- Visibility toggle (team/division/firm)
- Start/end date pickers
- Notes field
- Is-lead toggle

On submit, inserts directly into `coverage` table with `changed_by = user.id`. The `log_coverage_change()` trigger auto-creates the history record.

### 3.6 localStorage persistence

Key: `coverage-manager-settings`

Persisted: `activeView`, `viewMode`, `matrixGroupBy`, `collapsedGroups`, `hiddenGroups`, `hideEmptyGroups`, `collapsedGapsGroups`, `listVisibleColumns`, `listGroupByLevels`, `listSortColumn`, `listSortDirection`.

---

## 4. Coverage Logic & Rules

### 4.1 "Covered" vs "Uncovered"

An asset is **covered** if there exists at least one row in `coverage` with `is_active = true` for that `asset_id`. The Gaps view computes this by fetching all `coverage.asset_id WHERE is_active = true`, building a Set, then comparing against all assets.

An asset is **uncovered** (a "gap") if no such row exists.

### 4.2 Overlap detection

Multiple analysts CAN cover the same asset — this is controlled by `coverage_settings.allow_multiple_coverage` (default `true`). When `allow_multiple_coverage` is true, multiple active coverage rows per asset are allowed and expected.

The **Matrix view** detects overlap visually: if an asset row has 2+ analysts with active coverage, those cells are highlighted. The `matrixShowOverlapsOnly` toggle filters the matrix to only show assets with multiple covering analysts.

There is **no server-side constraint** preventing multiple active coverage rows for the same asset. The unique constraint on `coverage_requests` (`unique_pending_coverage_request`) only prevents duplicate pending requests, not duplicate coverage assignments.

### 4.3 Bandwidth / Workload

The Workload view calculates bandwidth as a simple count:
- **Per analyst**: count of `coverage` records where `is_active = true` and `user_id = analyst`.
- **Average**: total covered assets / total distinct analysts.
- There is **no weighting** system. Each coverage assignment counts as 1.

Stat cards in active view:
- **Analysts**: count of distinct `user_id` values in active coverage.
- **Covered**: count of distinct `asset_id` values in active coverage.
- **Gaps**: total assets minus covered assets.
- **Average**: covered / analysts.

### 4.4 Visibility

The `visibility` field on `coverage` is one of `'team'` | `'division'` | `'firm'`.

**Current behavior**: The `visibility` column exists and is displayed/editable in the Coverage Manager UI, but the `coverage` table's SELECT RLS policy is `USING (true)` — **all authenticated users can read all coverage records regardless of visibility setting**. The visibility field is not enforced at the database level for read access.

The visibility field's enforcement appears to be **UI-level only** in certain contexts (e.g., the `canChangeVisibility()` function gates who can *modify* the visibility, and the value is displayed as a badge), but no query filtering by visibility was found in the consumer components (AssetTab, ThesisContainer, OutcomesContainer all query coverage without visibility filtering).

**Who can change visibility** is governed by `coverage_settings.visibility_change_permission`:
- `'anyone'` — any authenticated user
- `'team_lead'` — coverage admin for the node OR team lead
- `'coverage_admin'` — only coverage admin (global or node-scoped)

### 4.5 Roles

Roles are free-text with three system-recognized values:
- `'primary'` — Star icon, yellow badge
- `'secondary'` — Shield icon, blue badge
- `'tertiary'` — UserCheck icon, gray badge
- Any other string → purple badge, User icon

Role sort order in displays: primary (0) → secondary (1) → tertiary (2) → custom (3) → no role (4).

The `is_lead` boolean is a separate flag from role — a secondary analyst can be the lead.

### 4.6 Future coverage

Coverage records can have `is_active = false` with a future `start_date`. These represent scheduled coverage that hasn't started yet. When activated (update `is_active` to `true`), the trigger detects this and logs appropriately (including detecting if it's a transition from an existing active analyst).

---

## 5. Requests & Approvals Workflow

### 5.1 Who can create requests

Any authenticated user can create a coverage request (`requested_by = auth.uid()`). The RLS `WITH CHECK` on INSERT ensures users can only create requests for themselves.

### 5.2 Who can approve/deny

Only users with `coverage_admin = true` (global flag). The RLS UPDATE policy on `coverage_requests` checks this. Node-level coverage admins do NOT have RLS permission to update requests — **this is a gap** (see Section 9).

### 5.3 State machine

```
pending ──→ approved ──→ (coverage change executed)
    │──→ denied
    │──→ rescinded ──→ (resubmit) ──→ pending
```

- **pending**: Initial state. Unique per (asset_id, requested_by) while pending.
- **approved**: Admin approved. The approve mutation also executes the actual coverage change (insert/update/delete on `coverage` table).
- **denied**: Admin denied. No coverage change.
- **rescinded**: User cancelled their own request. Can be resubmitted to return to pending.

### 5.4 Approval execution

When an admin approves a request, the `approveCoverageRequestMutation` performs:

| Request type | Action on `coverage` table |
|-------------|---------------------------|
| `add` | INSERT new row with `is_active = true`, `start_date = today` |
| `change` | UPDATE existing active coverage for asset: set `user_id` and `analyst_name` to requested values |
| `remove` | DELETE the coverage row matching `asset_id` + `current_user_id` |

### 5.5 Notifications

On INSERT into `coverage_requests` (when status = 'pending'), the `notify_coverage_request()` trigger creates a notification for every global coverage admin with type `'coverage_request'` and context data including request details, asset info, and requester name.

---

## 6. History / Audit Trail

### 6.1 Events tracked

The `coverage_history` table captures:

| `change_type` | Trigger condition |
|---------------|-------------------|
| `created` | New coverage inserted (no existing active for this asset, or `is_active=false`) |
| `analyst_changed` | New active coverage added when another active record exists for same asset, OR update changes `user_id`/`analyst_name` |
| `dates_changed` | Update changes `start_date` or `end_date` |
| `deleted` | Coverage row deleted |
| `coverage_added` | Application-level (not trigger) — used for bulk import backfill |
| `historical_added` | Application-level — adding historical coverage periods retroactively |

### 6.2 Period filtering

The History view uses `comparisonPeriod` to filter events:
- `'7d'` → last 7 days
- `'30d'` → last 30 days (default)
- `'90d'` → last 90 days
- `'ytd'` → since January 1 of current year
- `'all'` → no date filter
- `'custom'` → `customDateRange.start` / `customDateRange.end`

Filtering is applied client-side against `changed_at` from the `coverage_history` query (which fetches up to 100 records server-side with no date filter).

### 6.3 Asset-level timeline

When a specific asset is selected in the History view (`viewHistoryAssetId`), two queries fire:
1. All `coverage` rows for that asset (active + inactive) — shows the timeline of coverage periods.
2. All `coverage_history` rows for that asset — shows the change log.

The timeline visualization shows overlapping/sequential coverage periods with start/end dates. Admins can edit dates, change analysts, add transitions, add historical periods, and end coverage directly from the timeline.

---

## 7. Cross-Platform Integration

### 7.1 Asset Page (`src/components/tabs/AssetTab.tsx`)

- Fetches `coverage` where `asset_id = <selected asset>` and `is_active = true`, with portfolio joins.
- Renders `CoverageDisplay` component showing analyst list sorted by role.
- Computes `thesisStatuses`: for each covering analyst, checks if they have a thesis contribution and whether it's stale (>90 days).
- Builds `researchAnalysts` list combining covering analysts AND thesis contributors.
- "Go to Coverage" button opens Coverage tab with asset context.

### 7.2 Thesis System (`src/components/contributions/ThesisContainer.tsx`)

- Fetches coverage (`user_id, analyst_name, role`) for asset where `is_active = true`.
- Covering analysts get dedicated tabs in the thesis container.
- Thesis status badges (Current / Stale / No Thesis) are tied to coverage role.

### 7.3 Outcomes & Price Targets (`src/components/outcomes/OutcomesContainer.tsx`)

- Fetches coverage for asset to build `coveringAnalystIds` Set.
- Each price target contributor is marked with `isCovering` boolean.
- Covering analysts get visual priority in the aggregated view.
- Comment in `AggregatedView.tsx`: *"Use current coverage status, not stale is_official flag"*.

### 7.4 Asset Table (`src/components/table/AssetTableView.tsx`)

- Column definition: `'coverage'` → "Covered By" column (default visible, 140px).
- Queries all `coverage` with `is_active = true`, builds per-asset analyst lists.
- Renders comma-separated analyst names with roles.

### 7.5 User Profile (`src/components/tabs/UserTab.tsx`, `src/pages/ProfilePage.tsx`)

- **UserTab**: Queries coverage for a specific `user_id` with asset joins. Shows "Covered Assets" section: asset count, list with symbol/name/sector/role.
- **ProfilePage**: Shows `coverage_admin` badge on user profile if flag is true.

### 7.6 Organization & Governance

- **OrgGraph** (`src/lib/org-graph.ts`): Consumes `CoverageRecord[]` to compute per-team `coverageAssetCount`, `coverageAnalystCount`, and risk flags: `missing_coverage_admin`, `single_point_failure`, `uncovered_assets`.
- **AuthorityMap** (`src/lib/authority-map.ts`): Tracks `isGlobalCoverageAdmin` and `coverageScopes[]` (type: 'global'|'node') for each user.
- **OrgAccessTab**: Displays "Coverage Admin (Global)" and "Coverage Admin (Scoped)" badges.
- **OrgPeopleTab**: Shows coverage admin status in member directory.
- **ManageNodeDrawer**: Has "Coverage" tab with toggles for `is_coverage_admin` and `coverage_admin_blocked` per node member. Shows `canManageCoverageAdmins` prop for permission gating.
- **OrgNodeDetailsModal**: Coverage admin config at node level.
- **OrganizationPage Settings tab**: `saveCoverageSettingsMutation` saves `coverage_settings` (default_visibility, enable_hierarchy, hierarchy_levels, visibility_change_permission, allow_multiple_coverage).

### 7.7 Dashboard & Navigation

- **DashboardPage**: Tab routing `case 'coverage'` → `CoveragePage`.
- **Layout.tsx**: `handleShowCoverageManager` opens `{ type: 'coverage' }` tab. Header menu includes Coverage in the 4-section navigation grid. `FULL_WIDTH_TAB_TYPES` includes `'coverage'`.
- **Notification handler**: `'coverage_manager_requests'` notification opens coverage tab with `initialView: 'requests'`.

### 7.8 Notification System

- **NotificationCenter**: Handles `'coverage_request'` notification type.
- **DB trigger**: `notify_coverage_request()` creates notifications for all global coverage admins.
- **`notify_asset_coverage_users()`**: SQL function that returns all users covering an asset — used by the general notification system to notify analysts of asset-level events (price changes, notes, etc.).

### 7.9 Activity Logging

- `'user.coverage_admin_changed'` action logged in org activity when coverage admin status is granted/revoked.
- `'settings.coverage_changed'` action logged when org coverage settings are saved.
- Activity formatters display "coverage admin granted"/"revoked" in narrative sentences.

---

## 8. Permissions & RLS

### 8.1 `coverage` table RLS

| Policy | Command | Rule |
|--------|---------|------|
| Users can read all coverage records | SELECT | `USING (true)` |
| Authenticated users can insert coverage | INSERT | `WITH CHECK (true)` |
| Authenticated users can update coverage | UPDATE | `USING (true)` / `WITH CHECK (true)` |
| Enable update for own records | UPDATE | `USING (auth.uid() = user_id)` / `WITH CHECK (auth.uid() = user_id)` |
| Users can delete their own coverage | DELETE | `USING (auth.uid() = user_id)` |
| Coverage admins can delete any coverage | DELETE | `USING (users.coverage_admin = true)` |

**Notable**: INSERT and UPDATE are permissive (`true`). Any authenticated user can insert or update any coverage record at the DB level. Admin-only enforcement for writes is **UI-level only** in CoverageManager (checking `canManageCoverageForNode()` before showing edit controls).

### 8.2 `coverage_history` table RLS

| Policy | Command | Rule |
|--------|---------|------|
| All authenticated users can view | SELECT | `USING (true)` |
| Allow insert to coverage_history | INSERT | `WITH CHECK (true)` |
| Coverage admins can update | UPDATE | `USING (users.coverage_admin = true)` |
| Coverage admins can delete | DELETE | `USING (users.coverage_admin = true)` |

### 8.3 `coverage_requests` table RLS

| Policy | Command | Rule |
|--------|---------|------|
| Users can view their own requests | SELECT | `USING (requested_by = auth.uid())` |
| Coverage admins can view all requests | SELECT | `USING (users.coverage_admin = true)` |
| Users can create coverage requests | INSERT | `WITH CHECK (requested_by = auth.uid())` |
| Users can update their own requests | UPDATE | `USING (requested_by = auth.uid())` |
| Coverage admins can update requests | UPDATE | `USING (users.coverage_admin = true)` |

### 8.4 `coverage_settings` table RLS

| Policy | Command | Rule |
|--------|---------|------|
| Users can view in current org | SELECT | `USING (organization_id = current_org_id() AND is_active_member_of_current_org())` |
| Coverage admins can insert in current org | INSERT | `WITH CHECK (organization_id = current_org_id() AND users.coverage_admin = true)` |
| Coverage admins can update in current org | UPDATE | `USING (organization_id = current_org_id() AND users.coverage_admin = true)` |

### 8.5 UI-level permission gating

The `canManageCoverageForNode(nodeId)` function in CoverageManager controls whether edit/delete/add UI is shown:

1. **Global coverage admin** + node does NOT have `coverage_admin_override` → allowed.
2. **Explicit node-level coverage admin** for the specific node → allowed.
3. **Ancestor node-level coverage admin** (walking up the tree) — stops if an `coverage_admin_override` node is encountered → allowed if found before override.
4. No admin rights → not allowed (only "Request Change" button shown).

---

## 9. Known Issues / Ambiguities

### 9.1 Visibility not enforced at DB level
**Files**: `coverage` RLS policies, `CoverageManager.tsx:1654`
The `visibility` column (`'team'`/`'division'`/`'firm'`) exists but the `coverage` SELECT policy is `USING (true)`. All authenticated users see all coverage regardless of visibility setting. The field is displayed in the UI and can be edited per the `visibility_change_permission` setting, but has no access-control effect.

**Status**: Ambiguous — either this is by design (visibility is informational) or enforcement was never implemented.

### 9.2 INSERT/UPDATE RLS is fully permissive
**File**: `coverage` RLS policies
Any authenticated user can INSERT or UPDATE any coverage record at the DB level. The admin-only restriction is enforced exclusively in the CoverageManager UI (`canManageCoverageForNode` hides edit buttons). A user with API access or a different client could bypass this.

### 9.3 Node-level coverage admins cannot approve requests via RLS
**File**: `coverage_requests` RLS UPDATE policy
The UPDATE policy checks `users.coverage_admin = true` (global flag only). Node-level coverage admins (`org_chart_node_members.is_coverage_admin`) are NOT included in the RLS check. In the UI, `hasAnyCoverageAdminRights` includes node-level admins for showing approve/deny buttons, but the actual Supabase UPDATE would fail for node-only admins if RLS is enforced strictly.

**Possible mitigation**: The `coverage_requests` UPDATE policy may be overly permissive for the `requested_by = auth.uid()` path, and the admin path may succeed because the user's own `requested_by` matches. But for requests by *other* users, a node-only admin would be blocked. **Needs confirmation.**

### 9.4 History query limited to 100 rows with client-side filtering
**File**: `CoverageManager.tsx:1205-1210`
The `all-coverage-events` query fetches `LIMIT 100` from `coverage_history` with no date filter. Period filtering (7d/30d/90d/etc.) is then applied client-side. This means:
- If the 100 most recent events span only 2 days, the "30d" filter shows only those 2 days of events.
- Older events beyond the 100-row window are invisible even with "all" selected.

### 9.5 No organization_id scoping on coverage table
**File**: `coverage` table schema
The `coverage` table has no `organization_id` column. In a multi-org environment, all coverage records are global. The CoverageManager does not filter by organization — it fetches ALL coverage records. This could leak data across organizations if multiple orgs use the same Supabase project.

**Possible mitigation**: The `team_id` FK to `org_chart_nodes` provides indirect org scoping, but `team_id` is nullable and many coverage records may not have it set.

### 9.6 `coverage` table has no FK constraints visible in schema
The `coverage` table references `assets(id)` and `users(id)` but these FK constraints are not in the migration files reviewed (the table was created before the migration history). The `coverage_team_id_fkey` to `org_chart_nodes` is referenced in CoverageManager's Supabase join but the constraint definition was not found in migrations.

### 9.7 Bulk upload creates records without role, visibility, team, or portfolio
**File**: `CoverageManager.tsx:1579-1583`
The bulk upload mutation only inserts `{ asset_id, user_id, analyst_name }`. It does not set `role`, `visibility`, `team_id`, `portfolio_id`, `start_date`, or any other field. These default to their column defaults (visibility = 'team', is_active = true, start_date = CURRENT_DATE).

### 9.8 `analyst_name` is denormalized and can drift
**File**: `coverage` table schema
The `analyst_name` column stores a denormalized copy of the user's name at the time of coverage creation. If the user's name changes in the `users` table, the `coverage.analyst_name` becomes stale. The UI uses `analyst_name` for display, not a join to `users.first_name/last_name`.

### 9.9 Request type 'role_change' in UI but not in DB CHECK constraint
**File**: `CoverageManager.tsx:299`
The `requestingChange` state includes `requestType: 'role_change'` as an option, but the `coverage_requests.request_type` CHECK constraint only allows `'add'`, `'change'`, `'remove'`. Submitting a `'role_change'` request would fail at the DB level.

### 9.10 `coverage_settings` not scoped per-coverage in the coverage table
The `coverage_settings` table stores org-level defaults, but the `coverage` table itself has per-row `visibility`. There is no mechanism to retroactively update existing coverage rows when settings change (e.g., changing `default_visibility` from 'team' to 'firm' does not update existing rows).

---

## 10. Appendix

### 10.1 File Map

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/coverage/CoverageManager.tsx` | 9,106 | All-in-one coverage management: views, mutations, filters, timeline, requests, matrix, gaps, workload |
| `src/components/coverage/CoverageDisplay.tsx` | 166 | Read-only display of analysts covering an asset (used in AssetTab) |
| `src/pages/CoveragePage.tsx` | 13 | Thin page wrapper rendering CoverageManager in page mode |
| `src/components/tabs/AssetTab.tsx` | ~1,500+ | Asset detail page — queries coverage, renders CoverageDisplay, computes thesis statuses |
| `src/components/tabs/UserTab.tsx` | — | User profile — shows "Covered Assets" section |
| `src/components/contributions/ThesisContainer.tsx` | — | Thesis view — uses coverage for analyst tabs |
| `src/components/outcomes/OutcomesContainer.tsx` | — | Price targets — marks covering analysts |
| `src/components/table/AssetTableView.tsx` | — | "Covered By" column in asset table |
| `src/lib/org-graph.ts` | ~450 | Org chart health: coverage count, risk flags |
| `src/lib/authority-map.ts` | — | Access matrix: coverage admin scopes |
| `src/components/organization/ManageNodeDrawer.tsx` | — | Node-level coverage admin toggles |
| `src/pages/OrganizationPage.tsx` | — | Coverage settings save mutation (Settings tab) |
| `src/components/layout/Layout.tsx` | — | Coverage tab routing, header menu, notification handling |
| `src/lib/org-activity-labels.ts` | 315 | Activity labels for coverage admin changes |
| `supabase/migrations/20251030000000_add_coverage_requests.sql` | — | coverage_requests table, RLS, notification trigger |
| `supabase/migrations/20251031000000_add_coverage_history.sql` | — | coverage_history table, RLS, audit triggers |
| `supabase/migrations/20251102000000_set_coverage_admins.sql` | — | Initial admin setup |
| `supabase/migrations/20251102000001_fix_transition_detection.sql` | — | Fix trigger for analyst transitions |
| `supabase/migrations/20251102000002_backfill_coverage_history.sql` | — | Backfill history for existing rows |
| `supabase/migrations/20251102000003_allow_all_users_view_coverage_history.sql` | — | Open history SELECT to all authenticated |
| `supabase/migrations/20251102000004_fix_backfilled_history_changed_by.sql` | — | Fix NULL changed_by in backfill |
| `supabase/migrations/20251102000005_fix_future_coverage_logging.sql` | — | Handle future coverage activation |
| `supabase/migrations/20251102000006_add_rescinded_status.sql` | — | Add 'rescinded' status to requests |
| `supabase/migrations/20251103000000_preserve_changed_by_on_activation.sql` | — | Preserve changed_by on future→active |

### 10.2 Key Functions & Signatures

```typescript
// CoverageManager.tsx — permission check
canManageCoverageForNode(nodeId: string | null | undefined): boolean

// CoverageManager.tsx — visibility permission
canChangeVisibility(coverage: CoverageRecord): boolean

// CoverageManager.tsx — team name resolution
getAnalystTeamName(userId: string): string | null

// CoverageManager.tsx — tenure display
calculateTenure(startDate: string | null): { days: number; label: string }

// org-graph.ts — coverage risk flags
// Input: CoverageRecord[] (simplified: { asset_id, user_id })
// Output: risk flags on each org node (missing_coverage_admin, single_point_failure, uncovered_assets)

// authority-map.ts — coverage admin scope tracking
// Per user: { isGlobalCoverageAdmin: boolean, coverageScopes: CoverageScope[] }
```

### 10.3 SQL Snippets

```sql
-- Coverage table RLS (SELECT)
CREATE POLICY "Users can read all coverage records" ON coverage
  FOR SELECT TO authenticated USING (true);

-- Coverage admin delete policy
CREATE POLICY "Coverage admins can delete any coverage" ON coverage
  FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND coverage_admin = true));

-- Notify covering analysts (function)
CREATE FUNCTION notify_asset_coverage_users(asset_id_param UUID)
RETURNS TABLE(user_id UUID, email TEXT, user_name TEXT) AS $$
  SELECT DISTINCT c.user_id, u.email,
    COALESCE(u.first_name || ' ' || u.last_name, u.email)
  FROM coverage c JOIN users u ON u.id = c.user_id
  WHERE c.asset_id = asset_id_param;
$$ LANGUAGE plpgsql;

-- Unique pending request constraint
CREATE UNIQUE INDEX unique_pending_coverage_request
  ON coverage_requests (asset_id, requested_by) WHERE status = 'pending';
```
