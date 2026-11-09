# Preflight — copy/paste steps for the Supabase SQL Editor

Read-only. Every statement below is a `SELECT`. If anything you paste starts
with another word, it did not come from here.

**Run one block at a time.** The editor returns only the last result set when
several statements are pasted together, and these are independent questions.

**Return the result grid for every block, including a header row — and
including an empty result, which is an answer, not a non-answer.**

**Stop and tell me if:** any block errors (do not edit it to make it run — the
error is the finding), the editor asks to confirm a write, or a block marked
**HARD STOP** below returns anything.

> Why every count is grouped by organization: the SQL Editor runs as an owner
> role that bypasses RLS, so an ungrouped count merges every tenant in the
> database, pilot and demo tenants included. Read the rows for the
> organizations that matter.

---

# Part A — `00-verify-readonly.sql`

## A1 — Policies on the five tables

```sql
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('asset_contributions', 'contribution_visibility_targets',
                    'asset_contribution_history', 'asset_revisions',
                    'asset_revision_events', 'asset_field_history')
ORDER BY tablename, cmd, policyname;
```

Return **all rows with the full `qual` text** — paste it, do not summarise; the
wording is the thing being compared.
**HARD STOP** if any `qual` differs from `scripts/sql/security-c1/06`, `07` or
`08`. Also note the two `contribution_visibility_targets` policies — the thaw
step has to restore exactly those.

## A2 — Views over these tables

```sql
SELECT c.relname AS object, c.relkind,
       COALESCE((SELECT option_value FROM pg_options_to_table(c.reloptions)
                  WHERE option_name = 'security_invoker'), 'false') AS security_invoker
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('v','m')
  AND pg_get_viewdef(c.oid) ~* '(asset_contributions|asset_contribution_history|asset_revision_events)'
ORDER BY 1;
```

**HARD STOP** on any row whose `security_invoker` is not `true` — it runs with
its owner's rights and bypasses RLS entirely.

## A3 — SECURITY DEFINER functions over these tables

```sql
SELECT p.proname, p.prosecdef AS security_definer,
       pg_get_function_identity_arguments(p.oid) AS args,
       array(SELECT a.rolname FROM pg_roles a
              WHERE has_function_privilege(a.rolname, p.oid, 'EXECUTE')
                AND a.rolname IN ('anon','authenticated')) AS can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND pg_get_functiondef(p.oid) ~* '(asset_contributions|asset_contribution_history|asset_revision_events)'
ORDER BY p.prosecdef DESC, p.proname;
```

**HARD STOP** on any row with `security_definer = true` **and** `anon` or
`authenticated` in `can_execute`.

## A4 — Grants

```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND grantee IN ('anon','authenticated','PUBLIC')
  AND table_name IN ('asset_contributions','contribution_visibility_targets',
                     'asset_contribution_history','asset_revisions','asset_revision_events')
ORDER BY table_name, grantee, privilege_type;
```

**HARD STOP** on any row where `grantee = 'anon'`.

## A5 — Columns on the revision tables

```sql
SELECT table_name, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('asset_revisions','asset_revision_events')
ORDER BY table_name, ordinal_position;
```

Neither table has a migration in this repo, so the policy is written against an
inferred shape. **HARD STOP** if `asset_revisions` lacks `asset_id`,
`actor_user_id` or `organization_id`, or `asset_revision_events` lacks
`revision_id`, `category` or `field_key`.

## A6 — History row shapes (context, not a stop)

```sql
SELECT CASE
         WHEN h.new_content ~* '^\s*\[\s*attachments\s*:'  THEN 'attachment-envelope'
         WHEN h.new_content IS NULL                        THEN 'null'
         WHEN btrim(h.new_content) = ''                    THEN 'empty'
         WHEN h.new_content ~ '^\s*[\[{]'                  THEN 'other-structured'
         ELSE 'prose'
       END AS new_content_shape,
       count(*) AS rows
FROM public.asset_contribution_history h
GROUP BY 1
ORDER BY rows DESC;
```

## A8 — Is RLS actually ENABLED? — HARD STOP

```sql
SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('asset_contributions','contribution_visibility_targets',
                    'asset_contribution_history','asset_revisions','asset_revision_events');
```

**HARD STOP** if `rls_enabled` is false for any row. A policy on a table
without RLS enforces nothing, and the whole assessment rests on policies that
would never run.

This also settles one specific gap: `contribution_visibility_targets` has
SELECT/INSERT/DELETE policies and **no UPDATE policy**, so RLS is what denies
re-pointing an existing target row to a different node — a direct audience
change. With RLS off, the grants alone permit it.

## A7 — Triggers on `asset_contributions` (context, not a stop)

```sql
SELECT t.tgname, p.proname AS function_name, t.tgenabled
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE c.relname = 'asset_contributions' AND NOT t.tgisinternal
ORDER BY t.tgname;
```

Confirms what maintains these rows. Not in version control.

---

# Part B — `01-preflight-checklist.sql`

## B0 — Organization names. Run first; every later block refers to these.

```sql
SELECT id AS organization_id, name, slug
FROM public.organizations
ORDER BY name;
```

## B1 — Exposed right now (sizing)

```sql
SELECT o.name AS organization, count(*) AS n_1_exposed_now
FROM public.asset_contributions ac
JOIN public.organizations o ON o.id = ac.organization_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
GROUP BY o.name
ORDER BY n_1_exposed_now DESC;
```

Not a stop condition. A large number argues for shipping sooner.

## B2 — Split: audience destroyed vs intact

```sql
SELECT o.name AS organization,
       CASE WHEN t.n > 0 THEN '3_targets_intact_restriction_restored'
            ELSE            '2_no_targets_becomes_owner_only' END AS bucket,
       count(*)                      AS contributions,
       count(DISTINCT ac.created_by) AS distinct_authors
FROM public.asset_contributions ac
JOIN public.organizations o ON o.id = ac.organization_id
CROSS JOIN LATERAL (
  SELECT count(*) AS n FROM public.contribution_visibility_targets v
   WHERE v.contribution_id = ac.id
) t
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND ac.team_id IS NULL
GROUP BY o.name, 2
ORDER BY o.name, 2;
```

## B3 — Exposure through history

```sql
SELECT o.name AS organization,
       count(DISTINCT ac.id) AS n_4_restricted_with_exposed_history,
       count(*)              AS history_rows_carrying_prose
FROM public.asset_contribution_history h
JOIN public.asset_contributions ac ON ac.id = h.contribution_id
JOIN public.organizations o ON o.id = ac.organization_id
WHERE ac.visibility <> 'firm'
  AND btrim(coalesce(h.new_content, '')) <> ''
GROUP BY o.name
ORDER BY n_4_restricted_with_exposed_history DESC;
```

## B4 — Exposure through revision events

```sql
SELECT o.name AS organization,
       count(DISTINCT ac.id) AS n_5_restricted_with_exposed_revisions,
       count(*)              AS revision_events_carrying_prose
FROM public.asset_revision_events e
JOIN public.asset_revisions r      ON r.id = e.revision_id
JOIN public.asset_contributions ac ON ac.asset_id    = r.asset_id
                                  AND ac.section     = e.field_key
                                  AND ac.created_by  = r.actor_user_id
JOIN public.organizations o ON o.id = ac.organization_id
WHERE e.category <> 'valuation_targets'
  AND ac.visibility <> 'firm'
  AND btrim(coalesce(e.after_value, '')) <> ''
GROUP BY o.name
ORDER BY n_5_restricted_with_exposed_revisions DESC;
```

## B5 — Who loses a reader (operational impact, not a stop)

```sql
WITH losing AS (
  SELECT ac.id, ac.organization_id, ac.created_by,
         CASE WHEN NOT EXISTS (SELECT 1 FROM public.contribution_visibility_targets v
                                WHERE v.contribution_id = ac.id)
              THEN 'a_audience_destroyed'
              ELSE 'b_targets_intact_but_node_has_no_direct_members' END AS reason
  FROM public.asset_contributions ac
  WHERE coalesce(ac.is_archived, false) = false
    AND ac.visibility <> 'firm'
    AND NOT EXISTS (
          SELECT 1
          FROM public.contribution_visibility_targets v
          JOIN public.org_chart_node_members m ON m.node_id = v.node_id
         WHERE v.contribution_id = ac.id)
)
SELECT o.name AS organization, l.reason,
       count(*)                     AS n_6_contributions_losing_a_reader,
       count(DISTINCT l.created_by) AS n_8_authors_to_notify
FROM losing l
JOIN public.organizations o ON o.id = l.organization_id
GROUP BY o.name, l.reason
ORDER BY o.name, l.reason;
```

This sets the notification plan. It is **not** go/no-go — every row is a
contribution currently readable by people it was never shared with.

## B6 — The descent gap (context for B5)

```sql
SELECT o.name AS organization, n.node_type,
       count(DISTINCT t.contribution_id) AS contributions_targeting,
       count(DISTINCT t.node_id)         AS nodes_targeted,
       count(DISTINCT t.node_id) FILTER (
         WHERE NOT EXISTS (SELECT 1 FROM public.org_chart_node_members m
                            WHERE m.node_id = t.node_id)) AS n_7_nodes_reaching_nobody
FROM public.contribution_visibility_targets t
JOIN public.org_chart_nodes n ON n.id = t.node_id
JOIN public.organizations o   ON o.id = n.organization_id
GROUP BY o.name, n.node_type
ORDER BY o.name, contributions_targeting DESC;
```

Expected to be large. Not a stop.

## B7 — Orphaned revision events (retained, never deleted)

```sql
SELECT o.name AS organization, count(*) AS n_9_orphaned_revision_events
FROM public.asset_revision_events e
JOIN public.asset_revisions r ON r.id = e.revision_id
JOIN public.organizations o   ON o.id = r.organization_id
WHERE e.category <> 'valuation_targets'
  AND btrim(coalesce(e.after_value, '')) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.asset_contributions c
                   WHERE c.asset_id   = r.asset_id
                     AND c.section    = e.field_key
                     AND c.created_by = r.actor_user_id)
GROUP BY o.name
ORDER BY n_9_orphaned_revision_events DESC;
```

## B8 — ★ THE INVARIANT ★ — HARD STOP

```sql
SELECT coalesce(o.name, '(no organization)') AS organization,
       count(*) AS invariant_violations_actor_is_not_author
FROM public.asset_revision_events e
JOIN public.asset_revisions r ON r.id = e.revision_id
LEFT JOIN public.organizations o ON o.id = r.organization_id
WHERE e.category <> 'valuation_targets'
  AND EXISTS (SELECT 1 FROM public.asset_contributions c
               WHERE c.asset_id = r.asset_id AND c.section = e.field_key)
  AND NOT EXISTS (SELECT 1 FROM public.asset_contributions c
                   WHERE c.asset_id   = r.asset_id
                     AND c.section    = e.field_key
                     AND c.created_by = r.actor_user_id)
GROUP BY 1
ORDER BY 2 DESC;
```

**An empty result is the pass condition — please say so explicitly rather than
leaving it out.** Any non-zero count in any organization means the
revision-event derivation in `10-` §4 is unsound and gets redesigned before
anything is applied.

## B9 — Itemised notification list (run last, only for the organizations that matter)

Add `AND o.slug = '<slug>'` before `ORDER BY`:

```sql
SELECT o.name AS organization, a.symbol, ac.section, ac.visibility,
       ac.created_by AS author, ac.updated_at,
       CASE WHEN NOT EXISTS (SELECT 1 FROM public.contribution_visibility_targets v
                              WHERE v.contribution_id = ac.id)
            THEN 'audience destroyed — not recorded anywhere'
            ELSE 'targeted node has no direct members' END AS reason
FROM public.asset_contributions ac
JOIN public.assets a        ON a.id = ac.asset_id
JOIN public.organizations o ON o.id = ac.organization_id
WHERE coalesce(ac.is_archived, false) = false
  AND ac.visibility <> 'firm'
  AND NOT EXISTS (
        SELECT 1
        FROM public.contribution_visibility_targets v
        JOIN public.org_chart_node_members m ON m.node_id = v.node_id
       WHERE v.contribution_id = ac.id)
ORDER BY o.name, a.symbol, ac.section;
```

---

## Summary of hard stops

| Block | Stops on |
|---|---|
| A1 | any policy differing from C1/06, 07, 08 |
| A2 | a view without `security_invoker = true` |
| A3 | a SECURITY DEFINER function executable by `anon`/`authenticated` |
| A4 | any grant to `anon` |
| A5 | a missing column on either revision table |
| A8 | RLS not enabled on any of the five tables |
| **B8** | **any non-zero count — forces a redesign, not a delay** |

Everything else is sizing or operational impact. None of it blocks a
fail-closed release.
