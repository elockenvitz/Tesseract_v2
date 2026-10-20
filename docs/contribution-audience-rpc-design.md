# `set_contribution_audience` — authorization and privilege boundary

**Design only. Nothing implemented, nothing applied.** This incorporates the
three requirements into the architecture approved in `1df21144`. Final shapes
marked ⟨B⟩ depend on what the preflight shows and must not be settled before it.

---

## Requirement 1 — the function authorizes independently

`SECURITY DEFINER` bypasses RLS, so **every rule the policies enforce has to be
re-enforced here**. A contribution id is an opaque uuid that anyone can guess
or read from a shared URL; possessing one grants nothing.

Six checks, in order, each failing loudly:

```sql
CREATE FUNCTION public.set_contribution_audience(
  p_contribution_id uuid,
  p_visibility      text,
  p_node_ids        uuid[] DEFAULT '{}'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();        -- the CALLER, not the definer
  v_org uuid := public.current_org_id();
  v_row public.asset_contributions%ROWTYPE;
  v_bad int;
BEGIN
  -- 1. authenticated at all
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '28000';
  END IF;

  -- 2. an active member of a resolved organization
  IF v_org IS NULL OR NOT public.is_active_member_of_current_org() THEN
    RAISE EXCEPTION 'no active organization membership' USING ERRCODE = '42501';
  END IF;

  -- 3. the contribution exists, is IN THAT ORG, and the caller AUTHORED it.
  --    Combined deliberately: a row that fails any part reports the same
  --    "not found or not yours", so this cannot be used to probe for the
  --    existence of another organization's contributions.
  SELECT * INTO v_row FROM public.asset_contributions
   WHERE id = p_contribution_id
     AND organization_id = v_org
     AND created_by = v_uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'contribution not found or not yours' USING ERRCODE = '42501';
  END IF;

  -- 4. a permitted scope, from the application's own vocabulary
  IF p_visibility NOT IN ('firm','division','department','team','portfolio') THEN
    RAISE EXCEPTION 'invalid visibility %', p_visibility USING ERRCODE = '22023';
  END IF;

  -- 5. a restricted scope must name an audience — the rule that used to live
  --    only in the client, where an old bundle simply does not have it
  IF p_visibility <> 'firm' AND coalesce(array_length(p_node_ids,1),0) = 0 THEN
    RAISE EXCEPTION 'a % audience must name at least one group', p_visibility
      USING ERRCODE = '23514';
  END IF;

  -- 6. every node must exist, belong to THIS organization, and be of a type
  --    matching the requested scope. Without the type check, "department"
  --    visibility could be stored against a team node and the stored scope
  --    would describe something the targets do not.
  SELECT count(*) INTO v_bad
    FROM unnest(p_node_ids) AS want(id)
   WHERE NOT EXISTS (
     SELECT 1 FROM public.org_chart_nodes n
      WHERE n.id = want.id
        AND n.organization_id = v_org
        AND (p_visibility = 'firm' OR n.node_type = p_visibility));
  IF v_bad > 0 THEN
    RAISE EXCEPTION '% target(s) are not % groups in your organization',
      v_bad, p_visibility USING ERRCODE = '42501';
  END IF;

  -- …replace, atomically, in this one transaction…
END $$;

REVOKE ALL ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_contribution_audience(uuid, text, uuid[]) TO authenticated;
```

**Deliberately not enforced: reachability.** The function does not refuse a node
with no direct members. That is a product warning (the picker shows it), not an
authorization rule — refusing it would block an author from targeting a group
that is about to be staffed. Fail-closed already covers the outcome: such a
contribution reaches its author only.

---

## Requirement 2 — the privilege boundary, with no client-controllable flag

**The `current_setting('app.audience_change')` flag from the earlier sketch is
withdrawn.** A GUC is the wrong boundary: it is a value, and the trigger would
be trusting a value rather than an identity.

The boundary is **role identity**, which a client cannot assume:

```sql
CREATE ROLE tesseract_audience_writer NOLOGIN NOBYPASSRLS;
ALTER FUNCTION public.set_contribution_audience(uuid, text, uuid[])
  OWNER TO tesseract_audience_writer;
```

Inside a `SECURITY DEFINER` function, `current_user` becomes the function's
owner while `session_user` stays the caller. So the pin trigger asks *who is
executing*, not *what was passed*:

```sql
CREATE OR REPLACE FUNCTION public.asset_contributions_pin_audience()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $$
BEGIN
  IF current_user = 'tesseract_audience_writer' THEN
    RETURN NEW;                       -- the authorized path; let it through
  END IF;
  -- every other caller: the audience is inert, the rest of the write proceeds
  NEW.visibility := OLD.visibility;
  NEW.team_id    := OLD.team_id;
  RETURN NEW;
END $$;
```

Why this is not a bypass:

- The role is `NOLOGIN` and granted to **no one**. A client cannot `SET ROLE`
  into it, because `authenticated` is not a member.
- It is `NOBYPASSRLS`, so it is not a general superuser-by-another-name.
- Its only privileges are the ones the replace needs (below), and it owns
  exactly one function.
- The function authorizes the *caller* via `auth.uid()`, which is unaffected by
  the definer switch. The role grants reach, never identity.

⟨B⟩ **The role needs to write past RLS, and how depends on production.** Tables
are owned by `postgres`; a non-owner definer role is still subject to RLS, and
the existing policies are `TO authenticated`, so the function's own writes
would be denied. Two candidate resolutions, to be chosen after `00-` Q1 and Q4
show the actual ownership and grants:

| | Shape | Trade-off |
|---|---|---|
| **B-i** | Narrow policies `TO tesseract_audience_writer` on the two tables | Explicit and greppable, but they read as permissive and must be clearly labelled as reachable only through one function |
| **B-ii** | Own the function as `postgres` and pin on `current_user = 'postgres'` | No new role, but a far weaker boundary: every other definer function owned by `postgres`, and the SQL Editor, would also pass the pin |

**B-i is preferred** for the reason B-ii fails: a boundary that admits every
`postgres`-owned function is not a boundary. The decision is deferred, not
dodged.

### Trigger ordering

Postgres fires `BEFORE` row triggers in name order. `a_pin_audience` sorts
before `asset_contributions_set_organization_id` (C1/08:141). They write
different columns and neither returns `NULL`, so neither can discard the
other's work. If the freshness lane ever lands, `a_track_content_updated_at`
sorts between them and touches only its own columns.

---

## Requirement 3 — confirmed success or failure

Silent preservation is **backward compatibility for old content-save paths
only**. It is not the audience-editing experience.

- Every failure above `RAISE`s with a distinct `ERRCODE`, so PostgREST returns
  a non-2xx and `supabase-js` populates `error`.
- The function returns the audience it actually stored:
  ```json
  { "contribution_id": "…", "visibility": "team",
    "node_ids": ["…"], "node_count": 2 }
  ```
  so the client can confirm what landed rather than assume.
- The client **must check the error and the returned payload**, and surface
  both. The current `updateVisibility` logs `console.error` and continues
  (`useContributions.ts:536,547,562`); that is not acceptable once this is the
  authorized path and has to change with the wiring.
- A content save that happens to carry stale `visibility`/`team_id` is still
  silently preserved — that is the whole point, and it is why ordinary
  research editing keeps working for a bundle from last month.

Net effect: **changing an audience either succeeds visibly or fails visibly.
Saving prose never fails because of an audience field it should not have sent.**

---

## Field coverage — everything that decides who can read a contribution

| Field | Protected by | Status |
|---|---|---|
| `asset_contributions.visibility` | pin trigger | **new** |
| `asset_contributions.team_id` | pin trigger | **new** |
| `contribution_visibility_targets` rows (`contribution_id`, `node_id`) | `REVOKE INSERT, DELETE`; RPC is the only writer | **new** |
| `asset_contributions.organization_id` | `asset_contributions_set_organization_id` (C1/08:141) re-stamps it on every write | existing |
| `asset_contributions.created_by` | UPDATE policy requires `created_by = auth.uid()` in **both** `USING` and `WITH CHECK`, so it can be neither taken nor given away | existing |
| `contribution_visibility_targets.organization_id` | set on insert by the RPC; the table has no UPDATE policy ⟨B⟩ | **verify** |
| `org_chart_node_members` | org-chart administration | **out of scope, and worth stating:** adding someone to a targeted node grants them every contribution aimed at it. That is the intended meaning of membership, not a hole |
| `asset_contributions.is_archived` | — | affects whether a row is listed, not who may read it |

---

## Circumvention analysis — every direct client write

| Attempt (via PostgREST, as `authenticated`) | Result |
|---|---|
| `UPDATE asset_contributions SET visibility='firm'` | pinned — silently preserved, content save still succeeds |
| `UPDATE asset_contributions SET team_id=NULL` | pinned |
| `UPDATE asset_contributions SET organization_id=…` | re-stamped by C1/08 trigger |
| `UPDATE asset_contributions SET created_by=…` | denied by UPDATE policy |
| `DELETE FROM contribution_visibility_targets` | no privilege; 0 rows |
| `INSERT INTO contribution_visibility_targets` | no privilege |
| `UPDATE contribution_visibility_targets SET node_id=…` | ⟨B⟩ **must verify.** C1/08 creates SELECT/INSERT/DELETE policies and no UPDATE policy, so RLS denies it — **but only if RLS is enabled on the table.** If it is not, the grants alone permit it, and re-pointing a target row would be a direct audience change. **Added to the preflight below.** |
| `INSERT INTO asset_contributions` with `visibility='team'` | allowed (own row), but no targets can be inserted → owner-only. Fail closed |
| Call the RPC with another author's contribution id | check 3 — "not found or not yours" |
| Call the RPC with another org's node ids | check 6 |
| Call the RPC after switching current organization | checks 2, 3 and 6 all re-resolve against the new org; the contribution will not match |
| `SET ROLE tesseract_audience_writer` | not a member; denied |
| Call the RPC as `anon` | `EXECUTE` revoked; also check 1 |

---

## One query to add to the preflight

The gap found above. Append to Part A of
`docs/contribution-visibility-preflight-steps.md`:

```sql
-- A8 — is RLS actually ENABLED on the tables whose policies we rely on?
SELECT c.relname, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('asset_contributions','contribution_visibility_targets',
                    'asset_contribution_history','asset_revisions','asset_revision_events');
```

**HARD STOP** if `rls_enabled` is false for any of them: a policy on a table
without RLS enforces nothing, and the entire assessment would rest on policies
that never run.

---

## Status of the sequence

- **A. Read-only production preflight — NOT RUN.** No database tool is
  available to me, and `.mcp.json` does not exist in this worktree. I have no
  results to report and will not characterise production without them.
  `docs/contribution-visibility-preflight-steps.md` is the copyable procedure;
  add A8 above.
- **B. Review against actual schema, policies, triggers, grants — BLOCKED on A.**
  Three decisions wait on it: the ⟨B⟩ privilege shape, whether RLS is enabled
  on `contribution_visibility_targets`, and whether the two target-table
  policies match C1/08 so they can be restored exactly.
- **C. Final implementation and real-database test plan — this document is its
  authorization half.** The remainder (the replace body, the client wiring, and
  assertions 15–22 from `1df21144` §6 extended to cover the checks above) is
  drafted only once B has answers, so the tests match what is built.
- **D. Implement and test in isolation — after approval.**

Nothing applied. No production writes. The freshness and Phase 4 lanes remain
parked.
