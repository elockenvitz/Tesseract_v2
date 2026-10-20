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

### New open item arising from (5)

`can_view_contribution(team_id, visibility, user)` is a **pre-existing
visibility-aware predicate** that nothing in this lane had seen. Its signature
takes `team_id` — the broken denormalisation at the centre of V2 — so it may
encode the same `team_id IS NULL` defect, and it may be the ancestor of it.

This has to be read before `10-policy-fix.sql` is finalised, because it changes
a design decision: if `can_view_contribution` is correct, the release should
**reuse** it rather than add a parallel `can_read_asset_contribution`; if it is
defective, every policy that calls it inherits the defect and the blast radius
is larger than seven policies. Queued as **A3d**.

---

## Outstanding

| Block | Question | Status |
|---|---|---|
| A3d | `can_view_contribution` body and all its callers | **queued — blocks `10-` design** |
| A4 | grants to `anon` on the five tables | **next** |
| A5 | revision table columns, plus any CHECK on `visibility` | outstanding |
| A6 | history row shapes | outstanding |
| A7 | triggers on `asset_contributions` | outstanding |
| A8 | **RLS actually enabled** on the five tables | outstanding — hard stop |
| A2b | wider view sweep (all schemas, all five tables) | queued |
| B0–B9 | exposure footprint and the notification list | outstanding |
