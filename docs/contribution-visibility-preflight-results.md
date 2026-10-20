# Preflight results — production, read-only

Run by the user in the Supabase SQL Editor, one block at a time. No writes.
Procedure: `docs/contribution-visibility-preflight-steps.md`.

Status: **A1–A3c complete. A4 onward outstanding.**

---

## A1 — Policies on the five tables · **PASS**

14 policies, all `roles = {authenticated}`, no query errors. Full JSON compared
line by line against `scripts/sql/security-c1/06`, `07`, `08` and `10`.

**Every policy matches its repository definition verbatim.** No extra branch, no
drift. That clears the hard stop and means `10-policy-fix.sql` can replace
these policies by name without dropping a condition that is currently
load-bearing.

Count reconciles exactly: 4 (`asset_contributions`) + 3
(`contribution_visibility_targets`) + 1 (`asset_contribution_history`) + 3
(`asset_revisions`) + 2 (`asset_revision_events`) + 1 (`asset_field_history`).

### The three defects, now confirmed in production rather than inferred

- **V2** — `asset_contributions_select` contains `OR (team_id IS NULL)` as its
  third branch, exactly as C1/08:70-81 defines it.
- **V1** — `asset_contribution_history_select` is a single `EXISTS` on the
  parent's `organization_id`, with **no reference to visibility**.
- **V3** — `asset_revision_events_select` is
  `organization_id = current_org_id()` plus a legacy
  `organization_id IS NULL AND actor` branch. Org-wide, visibility-blind.

### Claims the text settled

- `asset_contributions_update` carries `created_by = auth.uid()` in **both**
  `USING` and `WITH CHECK`. Ownership can be neither taken nor given away —
  this was load-bearing in the RPC field-coverage table and was unverified.
- The three `contribution_visibility_targets` policies are captured exactly, so
  both the revoke and the restore are grounded in real text.
- `contribution_visibility_targets` has **no UPDATE policy** — RLS is the only
  thing preventing a client re-pointing a target row at another node. Makes A8
  decisive.
- `visibility` is `text`, not an enum (`visibility = 'firm'::text`), so there is
  likely no CHECK constraining it to the five scopes. Not a widening — an
  unknown value is not `'firm'` — but it means the RPC's scope check plus the
  pin trigger would be the only enforcement of the vocabulary.
- `asset_field_history_select` has no organization check, and that is
  **deliberate and documented** (C1/10): the table has no organization column,
  `process_stage`/`priority` are workflow state over global asset records, and
  the research rows are creator-only. Production matches that decision. Checked
  before reporting; not a finding.

### Noted, not pursued

`asset_revisions_update`'s `WITH CHECK` permits `organization_id IS NULL`, so an
actor can null their own revision's org. It does not widen anything — revision
*events* key on the event's own `organization_id`, and `asset_revisions_select`
narrows a null-org revision to its actor only.

---

## A2 — Views over these tables · **PASS**

0 rows. No view or materialized view in `public` over `asset_contributions`,
`asset_contribution_history` or `asset_revision_events`.

**What this does not cover,** stated so "0 rows" is not read for more than it
is: a view over `contribution_visibility_targets` alone (metadata, no prose), a
view in a non-`public` schema, or a view reading another view. A wider sweep is
queued as A2b.

---

## A3 — SECURITY DEFINER functions · **QUALIFIED PASS**

One directly callable definer function over these tables:

```sql
public.contribution_in_current_org(p_contribution uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
  -- owner: postgres; EXECUTE: authenticated
  SELECT EXISTS (SELECT 1 FROM asset_contributions c
                  WHERE c.id = p_contribution
                    AND c.organization_id = current_org_id());
```

It meets the mechanical hard stop — definer, non-trigger, executable by
`authenticated` — and the stop was **overridden on review**, deliberately:

- It returns a **boolean**. No content, author, section, visibility or
  timestamp. It discloses only *"a contribution with this uuid exists in your
  current organization."*
- That is a **strict subset** of what `contribution_visibility_targets_select`
  already hands out: that policy returns `contribution_id` and `node_id` for
  every contribution in the org, restricted ones included.
- It cannot cross a tenant boundary.
- `current_org_id()` **does** validate active membership — verified against
  migration `20260826100000`, which requires an `organization_memberships` row
  with `status = 'active'` and an unexpired `expires_at`, and fails closed to
  `NULL`. A lapsed member gets `false` for everything. (The policies pairing it
  with a separate `is_active_member_of_current_org()` call reads as though it
  does not check membership. It does; the pairing is belt-and-braces.)

**Open question, unanswered:** A3's pattern also matches trigger functions, and
the function that writes `asset_contribution_history` — SECURITY DEFINER,
`returns trigger`, **not in version control** — was expected and not reported.
That object has been invisible to this entire lane. Its name is still unknown.
(`asset_contributions_set_organization_id` legitimately would not match: its
body assigns `NEW.organization_id` and never names a table.)

---

## A3b — Is that function used? · **IT IS**

Seven policy dependencies, no function or view dependencies:

| Table | Policies |
|---|---|
| `contribution_reactions` | `_select`, `_insert`, `_delete` |
| `contribution_replies` | `_select`, `_insert`, `_update`, `_delete` |

**Preserve the function. Do not revoke EXECUTE.** The earlier recommendation to
revoke was predicated on it being unused, and it is not.

Neither table appears anywhere in this repository — no migration, no
application code. `ContributionCard.tsx:104` imports `useContributionReplies`,
but the typecheck reports that import as unresolved, so the replies feature is
not wired.

---

## A3c — What those policies permit · **TWO NEW AUTHORIZATION GAPS**

| Fact | Value |
|---|---|
| `contribution_replies` | RLS enabled, not forced, **0 rows**, has a `content text` column |
| `contribution_reactions` | RLS enabled, not forced, **0 rows** |
| Both SELECT policies | `contribution_in_current_org(contribution_id) AND is_active_member_of_current_org()` — **no visibility check** |
| Both INSERT policies | additionally reference `can_view_contribution(ac.team_id, ac.visibility, auth.uid())` |
| All seven | `TO authenticated` |

**The function is not the defect.** `contribution_in_current_org` does exactly
what its name says. The defect is that two policies use an **org-level**
predicate where a **visibility-level** predicate is required — the same root
cause as V1 and V3: asking *"is this in my org?"* when the question is *"may I
read this?"*

- `contribution_replies` carries **prose** — commentary on a thesis, which can
  quote or paraphrase it. Had the table held rows, this would be a fourth
  prose exposure path of the same class as V1 and V3.
- `contribution_reactions` is **metadata** — that a restricted contribution
  exists and who engaged with it. Real but lesser, the same class as the
  `contribution_visibility_targets` metadata leak already on the adjacent list.

**Both tables are empty, so nothing is exposed today.** This is forward-looking
hardening, not an incident, and it carries no notification implications.

### Decisions taken

1. Preserve `contribution_in_current_org`.
2. Both SELECT policies are additional authorization gaps.
3. Both SELECT corrections go into **this** release, using
   `can_read_asset_contribution(contribution_id)`, subject to isolated testing.
4. INSERT/UPDATE/DELETE policies stay out unless testing finds a direct
   security dependency. (Whether you may *reply to* a contribution you cannot
   read is an authorization-to-write question, separate from confidentiality.)
5. `can_view_contribution`'s legacy semantics to be reviewed for
   inconsistency — **not** expanded into a general redesign.

### New open item arising from (5) — answered in A3d below

---

---

## A3d — `can_view_contribution` · **DEFECTIVE, contained, not modified**

`public.can_view_contribution(p_contribution_team_id uuid, p_visibility text, p_user_id uuid)`,
SECURITY DEFINER. Three defects, and a fourth property that is worse than any
of them:

1. **`IF p_contribution_team_id IS NULL THEN RETURN TRUE`** — this is **V2 in
   function form**. The policy's `OR team_id IS NULL` and this function share
   one wrong premise: that an absent `team_id` means "unrestricted" rather than
   "the denormalisation does not apply". The function is very likely the
   ancestor of the policy branch.
2. **Membership is not filtered for active status** — it selects
   `organization_memberships … LIMIT 1` with no `status = 'active'` and no
   `expires_at` check. A revoked or expired member passes. `current_org_id()`
   was fixed for exactly this in migration `20260826100000`; this function was
   not.
3. **It does not understand `contribution_visibility_targets`** — it reasons
   only about the single `team_id`, so it predates multi-target audiences and
   cannot express one.
4. **It takes the user id as a parameter.** `p_user_id` is supplied by the
   caller rather than derived from `auth.uid()`, in a SECURITY DEFINER function
   that bypasses RLS. Called directly it is a **membership oracle**: "is user X
   a member of team T", for any X and T whose uuids the caller holds, with no
   organization check on the caller's side. The two policies pass
   `auth.uid()`, so the policy path is not affected — but the direct path is
   open to anyone with `EXECUTE`. Severity is bounded by needing uuids and by
   returning a boolean, but it is a genuine cross-tenant metadata oracle.

**Blast radius is small: exactly two callers**, both INSERT policies —
`contribution_reactions_insert` and `contribution_replies_insert`. No function
callers, no SELECT policy uses it. The defect does not reach the three
confirmed exposure paths.

### Decisions taken

1. **Do not reuse it** for the security correction.
2. Retain `can_read_asset_contribution(contribution_id)`, subject to its
   isolated tests. A3d justifies the parallel helper rather than contradicting
   it: the existing function cannot express a multi-target audience, so reuse
   was never actually available.
3. Record as defective; **do not modify or revoke yet**.
4. Assess whether the INSERT policies' `EXISTS` subqueries and parent-table RLS
   independently prevent unauthorized writes — **do not assume exploitability**.
5. Verify direct EXECUTE grants and account for the arbitrary `p_user_id`.
6. Keep the two SELECT-policy corrections in the release.

### On (4), a hypothesis to test rather than assert

The INSERT policies wrap the call in `EXISTS (SELECT … FROM asset_contributions
ac WHERE …)`. A policy expression that queries another table is an ordinary
query in the caller's context, so **that subquery is itself subject to
`asset_contributions_select`**. If that holds, the INSERT gate is effectively
"a contribution I can already read", and **fixing V2 tightens these INSERT
policies automatically** — no separate change needed, which supports decision 4
with a reason rather than a deferral.

`can_view_contribution` being SECURITY DEFINER does not undo this: it receives
`ac.team_id` and `ac.visibility` as values already extracted by the
RLS-subject outer query.

This is a hypothesis about policy-expression RLS semantics, which are subtle. It
must be **proven in the isolated environment**, as an assertion in the suite:
*after* the fix, a same-org member who cannot read a restricted contribution
cannot insert a reply or a reaction against it. If that assertion fails, the
INSERT policies come into the release after all.

### Still open

Item 5 is unanswered: who holds `EXECUTE` on `can_view_contribution`. Queued as
**A3e** — a function-grant question, kept separate from A4's table grants.

---

## Outstanding

| Block | Question | Status |
|---|---|---|
| A3e | `EXECUTE` grants on `can_view_contribution`; full body | queued |
| A4 | grants to `anon` on the five tables | **next** |
| A5 | revision table columns, plus any CHECK on `visibility` | outstanding |
| A6 | history row shapes | outstanding |
| A7 | triggers on `asset_contributions` | outstanding |
| A8 | **RLS actually enabled** on the five tables | outstanding — hard stop |
| A2b | wider view sweep (all schemas, all five tables) | queued |
| B0–B9 | exposure footprint and the notification list | outstanding |
