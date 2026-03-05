# Coverage System Contract

> Canonical rules for coverage behavior. All code must conform.

## Definitions

- **Coverage** = analyst-to-asset assignment. Stored in the `coverage` table.
- **Scope of responsibility** = `coverage.visibility` field: `'firm'` (firm-wide), `'division'`, or `'team'`.
  - This is NOT about read visibility — it describes the breadth of the analyst's coverage mandate.
- **Multiple coverage** is allowed. The same asset can have multiple covering analysts.
- **`team_id`** anchors scope to an org-chart node. Combined with `visibility`, it defines the coverage's org-branch scope.

## Deterministic Default Selection

When a single "default owner" must be chosen from multiple coverage records for an asset, the tie-break rule is:

```
1. is_lead = true (descending — leads first)
2. role priority: primary (0) → secondary (1) → tertiary (2) → custom (3) → null (4)
3. updated_at descending (most recently updated wins)
4. user_id ascending (stable tiebreak)
```

All code must use `sortCoverageDeterministically()` or `resolveCoverageDefault()` from `src/lib/coverage/resolveCoverage.ts`. Direct array indexing like `coverage[0]` or `.find(...)` on unsorted arrays is prohibited.

## Contribution Visibility

- **Default**: contributions are visible to authenticated members of the same organization.
- **`visibility = 'firm'`**: visible to all org members.
- **`visibility` in `('team', 'division', 'department', 'portfolio')`**: restricted to the author, the users who are members of the nodes listed in `contribution_visibility_targets`, and org/coverage admins.
- The `contribution_visibility_targets` junction table is the override mechanism. If targets exist, only targeted node members (plus author/admins) can read.

## RLS Enforcement

- `coverage` INSERT/UPDATE: restricted to global `coverage_admin` users (server-enforced).
- `coverage` SELECT: restricted to members of the same organization.
- `coverage_history` INSERT: trigger-only (no direct client inserts).
- `coverage_requests` approval: restricted to global `coverage_admin`.
- `coverage_settings`: org-scoped + admin-only for writes (already enforced).
