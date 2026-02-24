# Frontend Tenant Lint Baselines

## Overview

The frontend tenant boundary linter (`scripts/frontend-tenant-lint.mjs`) scans `src/**/*.ts(x)` for `supabase.from('<org_scoped_table>')` calls that lack an `.eq('organization_id', ...)` filter, mutation chain, or safe FK/PK filter.

Pre-existing violations that rely on server-side RLS are tracked via **baselines**. The linter fails only when violations **exceed** these baselines.

## Current Baselines

| Metric | Value | Description |
|--------|-------|-------------|
| `BASELINE_TOTAL` | 38 | All violations (P0 + P1) |
| `BASELINE_P0` | 17 | P0 table violations only |

## P0 vs P1 Tables

**P0** (highest risk — user-facing hub tables):
`workflows`, `projects`, `themes`, `conversations`, `calendar_events`, `topics`, `captures`

**P1** (lower risk — admin/config tables):
Everything else in `ORG_SCOPED_TABLES` (e.g., `org_chart_nodes`, `teams`, `research_fields`, etc.)

## When to Update Baselines

Update baselines **only when violations decrease** due to legitimate fixes:

1. Run the linter: `node scripts/frontend-tenant-lint.mjs`
2. If the output says "Violations decreased! Update baselines:", adjust the constants in the script
3. Commit with a message explaining which callsites were fixed

## How to Fix a Violation

From most to least preferred:

1. **Use an org-scoped view** — `supabase.from('org_workflows_v')` instead of `supabase.from('workflows')`. Views pre-filter by `organization_id = current_org_id()`.

2. **Add explicit org filter** — `.eq('organization_id', currentOrgId)` on the query chain.

3. **Use an approved wrapper hook** — Files importing `useOrganizationData` or `useOrgQueryKey` are skipped entirely.

## Available Org-Scoped Views

| View | Base Table |
|------|-----------|
| `org_workflows_v` | `workflows` |
| `org_projects_v` | `projects` |
| `org_themes_v` | `themes` |
| `org_calendar_events_v` | `calendar_events` |
| `org_topics_v` | `topics` |
| `org_captures_v` | `captures` |
| `org_org_chart_nodes_v` | `org_chart_nodes` |
| `organization_members_v` | (composite) |

All views use `SECURITY INVOKER` — RLS policies on the base tables still apply.

**Limitation**: Views do not support PostgREST embedded joins (e.g., `creator:created_by(email)`). Use views only for simple queries. For queries with joins, add `.eq('organization_id', currentOrgId)` instead.

## CI Integration

```bash
# Standard run (shows report + enforces baselines)
node scripts/frontend-tenant-lint.mjs

# CI mode (summary only)
node scripts/frontend-tenant-lint.mjs --ci

# Detailed report
node scripts/frontend-tenant-lint.mjs --report
```

Exit code 0 = pass, 1 = violations exceed baseline.
