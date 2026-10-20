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

---

## A4 — Table grants · **PASS on the hard stop**

**Zero `anon` grants. Zero `PUBLIC` grants.** The hard stop is clear: none of
these tables is reachable with the publishable key alone.

All five tables grant **SELECT, INSERT, UPDATE, DELETE to `authenticated`**,
which is broader than the policies use:

| Table | Granted | Policies exist for | Gap |
|---|---|---|---|
| `contribution_visibility_targets` | S I U D | S I D | **UPDATE** — no policy |
| `asset_contribution_history` | S I U D | S | **INSERT, UPDATE, DELETE** — no policies |
| `asset_revisions` | S I U D | S I U | **DELETE** — no policy |
| `asset_revision_events` | S I U D | S I | **UPDATE, DELETE** — no policies |

### This is the documented posture, not drift

C1/11 revoked `ALL` from `anon` and `TRUNCATE, REFERENCES, TRIGGER` from
`authenticated`, and **deliberately left the CRUD grants in place**, relying on
RLS policies as the gate. A4's result is exactly what that file produces.

### Which makes A8 the single control behind all of it

A grant with no matching policy is inert **only while RLS is enabled**. With
RLS on, every gap above is denied. With RLS off — or if a permissive policy is
added later — they become live, and the worst of them is not the target
re-point:

**`asset_contribution_history` grants INSERT, UPDATE and DELETE to
`authenticated` with only a SELECT policy.** That table is the audit record of
what the desk wrote. If RLS were ever off, any authenticated user could forge
or erase it. A8 is therefore decisive for audit integrity across three tables,
not merely for one re-point scenario.

### Design correction this produces

The RPC design proposed `REVOKE INSERT, DELETE ON
contribution_visibility_targets FROM authenticated`. A4 shows **UPDATE is also
granted**, so the revoke must be `INSERT, UPDATE, DELETE`. Without that, a
latent UPDATE path survives the release and would re-point a target row the
moment an UPDATE policy appeared.

### Decision

A4 passes. Excess `authenticated` grants recorded as a **separate hardening
finding**, subject to A8. **No grants changed during the preflight.**

---

---

## A5 — Schema shape · **CONDITIONAL PASS, correction applied**

All required columns exist on both revision tables: `asset_revisions` has
`id`, `asset_id`, `actor_user_id`, `organization_id`; `asset_revision_events`
has `revision_id`, `category`, `field_key`, `before_value`, `after_value`,
`organization_id`. The inferred shape the policy was written against is
correct. Hard stop clear.

Three constraint findings, two of which close open questions and one of which
forced a correction.

### 1. The uniqueness is FOUR columns, not three

```
unique_user_asset_section_org
  UNIQUE NULLS NOT DISTINCT (created_by, asset_id, section, organization_id)
```

The revision-event attribution in `10-` §4 matched on three of them. An author
who belongs to two organizations can hold the same section on the same asset in
each, so `(asset_id, section, created_by)` resolves to a **set**, not a row.

**It did not widen anything.** `can_read_asset_contribution` itself requires
`c.organization_id = current_org_id()`, so a foreign-org row returns false and
cannot grant access. But that is the authorization happening to be tight while
the attribution is loose — compensation, not design. Relax the helper's org
clause one day and the join silently becomes a cross-org path.

**Corrected:** added `AND c.organization_id = r.organization_id`, making the
match exactly the unique tuple.

### 2. A second defect found while correcting the first

C1/06 keys its org check on the **event's** `organization_id`. The replacement
keyed on the **revision's**. Both columns are nullable (A5 item 4).

For a legacy row with event org `NULL` under a revision org A, C1/06 grants the
**actor only**; the replacement would have granted **every org-A member who
could read the contribution**. Bounded by the contribution check, but a
widening that was neither intended nor stated — and the preflight is the only
reason it was caught.

**Corrected:** both the event's and the revision's `organization_id` must now
match `current_org_id()`, so a `NULL` on either falls through to the actor-only
branch, exactly as conservative as production is today.

### 3. Two open questions closed

- **A CHECK on `visibility` exists**, restricting it to
  `portfolio, team, department, division, firm`. This **corrects the A1 note**:
  arbitrary strings are already rejected at the database level, so the RPC's
  scope validation is defence in depth rather than the only enforcement. The
  RPC keeps it — it must still reject a scope/target mismatch, which the CHECK
  cannot see.
- **`contribution_visibility_targets` has `UNIQUE (contribution_id, node_id)`.**
  No duplicate-prevention constraint is needed in the RPC, and a partial replace
  cannot leave a node listed twice.

### 4. Legacy null-org events fail closed

Confirmed by construction after correction 2: `NULL = current_org_id()` is
`NULL`, not true, so the org branch cannot be entered and only
`r.actor_user_id = auth.uid()` grants access.

### To prove in isolation

Both corrections need assertions, and both must be shown failing against the
uncorrected policy:

- A multi-org author holding the same `(asset, section)` in two organizations:
  a member of org A reading an org-A event must not be authorized by the org-B
  contribution, and must still be authorized by the org-A one.
- A legacy event with `organization_id NULL` under a revision with an
  organization: readable by its actor, by nobody else.

---

---

## A6 — History row shapes · **PASS**

| shape | `old_missing` | rows |
|---|---|---|
| prose | false | 22 |
| attachment-envelope | false | **2** |
| **total** | | **24** |

No `null`, `empty` or `other-structured` values.

### 1. The envelope is real — and I appear to have created it

The `[Attachments: N items]` form is confirmed as a **stored** shape, not a UI
artifact, so `change-classification.ts` returning `ambiguous` for it and the
freshness backfill excluding it are both justified.

But there are exactly **two** such rows, and the LLY incident was one attach
followed by one detach during Phase 4 browser testing on 2026-10-20 — which
produced the two timeline entries reading `[Attachments: 2 items] Added 1
reference(s)`. The arithmetic matches exactly.

So the envelope most likely exists in production **because of that testing, not
because of ordinary product use**. The classifier branch describes a shape I
produced. It stays — the trigger will compose it again for any future
attachment write — but its population today is two rows of my own making, and
calling it a general production shape would overstate it.

### 2. Every row has an `old_content` — the trigger fires only on UPDATE

`old_missing = false` on all 24. No history row exists for a first publication.

This **independently corroborates the freshness-lane finding** that the
original LLY thesis write of 2025-12-12 has no history row, and it is not an
LLY peculiarity: *no* first publication is recorded anywhere. The freshness
backfill's `history_proven` bucket will therefore be small by construction, and
unknowns will dominate — predicted from one asset, now confirmed across the
table.

### 3. Scale

**24 rows in the entire production database.** Whatever V1 exposes, it exposes
from a population of 24. B3 will give the restricted subset.

### 4. Conclusions adopted

The 22 prose rows are a **population for exposure analysis, not proof of
exposure** — V1 exposes a restricted row's history to the org, and how many of
those 24 hang off restricted contributions is B3's question, not A6's.
Attachment-only exclusion is preserved in both the classifier and the backfill.
**No security-release change.**

---

## Outstanding

| Block | Question | Status |
|---|---|---|
| A3e | `EXECUTE` grants on `can_view_contribution`; full body | queued |
| A7 | triggers on `asset_contributions`; **identity of the history-writing trigger** | **next** |
| A5 | revision table columns, plus any CHECK on `visibility` | outstanding |
| A6 | history row shapes | outstanding |
| A7 | triggers on `asset_contributions` | outstanding |
| A8 | **RLS actually enabled** on the five tables | outstanding — hard stop |
| A2b | wider view sweep (all schemas, all five tables) | queued |
| B0–B9 | exposure footprint and the notification list | outstanding |
