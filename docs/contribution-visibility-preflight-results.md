# Preflight results — production, read-only

Run by the user in the Supabase SQL Editor, one block at a time. No writes.
Procedure: `docs/contribution-visibility-preflight-steps.md`.

Status: **PART A COMPLETE — A1 to A8, all passed. Part B outstanding.**

| Block | Subject | Result |
|---|---|---|
| A1 | policies on the five tables | **PASS** — all 14 verbatim; three defects confirmed |
| A2 | views | **PASS** — 0 rows |
| A3 | SECURITY DEFINER functions | **QUALIFIED PASS** — `contribution_in_current_org`, override reasoned |
| A3b | its callers | 7 policies; **preserve**, do not revoke |
| A3c | reply/reaction policies | **2 new authorization gaps**; both tables empty |
| A3d | `can_view_contribution` | **defective**; 2 INSERT callers; do not reuse |
| A4 | grants | **PASS** — no `anon`, no `PUBLIC`; excess `authenticated` grants noted |
| A5 | schema shape | **CONDITIONAL PASS** — correction applied to `10-` |
| A6 | history row shapes | **PASS** — 24 rows total |
| A7 | triggers | **PASS** — history writer identified |
| A8 | RLS enabled | **PASS** — true on all seven, owner `postgres` |

**No hard stop fired.** The three defects are confirmed in production, two more
were found, and two design errors of mine were caught and corrected.

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

---

## A7 — Triggers · **PASS. The unreadable trigger is identified.**

Two active triggers on `asset_contributions`:

| Trigger | Timing | Function | Rights |
|---|---|---|---|
| `asset_contributions_set_organization_id` | BEFORE INSERT OR UPDATE | — | SECURITY DEFINER, owner `postgres` |
| `contribution_history_trigger` | BEFORE UPDATE | `track_contribution_history()` | SECURITY DEFINER, owner `postgres` |

The first matches C1/08:122-144, legacy NULL preservation included.

### `track_contribution_history()` — what it does

- Inserts an `asset_contribution_history` row when **content** changes.
- Inserts a **separate** envelope row when **attachments** change, formatted
  `[Attachments: N items] Added/Removed X reference(s)` or `Updated references`.
- **Sets `NEW.updated_at = now()` on either a content or an attachment change.**
- **Does not record the initial INSERT / first publication.**

### Three things this closes

**1. The LLY incident is explained, not inferred.** `saveSectionReferences`
deliberately omits `updated_at` (`asset-research.ts:241-248`), and the
timestamp moved anyway because this trigger stamps it when *attachments*
change. That was a hypothesis for several turns; it is now read from the
object. The two A6 envelope rows match the format this trigger composes.

**2. First publication is structurally unrecoverable.** Not merely "no row
exists for LLY" — the trigger has no INSERT branch, so **no first publication
is recorded for any contribution, ever**. The freshness backfill's
`history_proven` bucket can never cover a first publication by construction.
That lane stays parked; the question it could not answer is now answered.

**3. C1/07:38's claim is correct.** It asserts the history writer is SECURITY
DEFINER running as the table owner, which is why `asset_contribution_history`
needs no INSERT policy. Verified. That matters more after A4, which showed
`authenticated` holds INSERT/UPDATE/DELETE there with no policies — those
grants are inert under RLS, and the legitimate writer does not need them.

### Design consequences for `10-` and the RPC

**Trigger ordering is safe.** BEFORE row triggers fire in name order:
`a_pin_audience` → `asset_contributions_set_organization_id` →
`contribution_history_trigger`. The pin rewrites only `visibility`/`team_id`;
the history trigger reads only `content`/`attachments`. No interaction.

**The RPC must NOT stamp `updated_at`.** A visibility-only UPDATE changes
neither content nor attachments, so `track_contribution_history()` leaves the
timestamp alone — meaning an audience change does not contaminate the "last
written" clock, provided the RPC does not write it by hand. The current
`updateVisibility` **does** (`useContributions.ts:529`), which is one of the
contamination sources the freshness audit identified. The RPC must not inherit
that.

### New finding — an orphaned writer

`public.track_contribution_changes()` also writes
`asset_contribution_history`, is **not** SECURITY DEFINER, and is attached to
neither inspected table. Likely a predecessor left behind.

Not a live risk: detached, it never runs, and were it attached it would run
with invoker rights against a table with no INSERT policy, so RLS would make it
fail rather than leak. But it is an unowned function that writes the audit
record, and **A7 only established that it is not attached to the two tables it
inspected** — not that it is unattached everywhere. Queued as **A7b**, low
priority, hygiene rather than security.

---

---

## A8 — RLS enabled · **PASS. Part A complete.**

All seven tables: `rls_enabled = true`, `rls_forced = false`, `owner = postgres`.

`rls_forced = false` is expected and not a problem — `FORCE` affects only the
table owner, and C1/08 documents why it is not set: `postgres` and
`service_role` carry `BYPASSRLS`, which wins over `FORCE` regardless.

### What this settles

**Every excess grant A4 found is inert.** `authenticated` holding
INSERT/UPDATE/DELETE on `asset_contribution_history`, UPDATE on
`contribution_visibility_targets`, DELETE on the revision tables — all denied,
because a grant with no matching policy cannot act while RLS is on. The
hardening finding stands; the urgency does not. No integrity incident.

### And it resolves the ⟨B⟩ privilege question from the RPC design

`owner = postgres` on every table, with `rls_forced = false`, means a table
owner bypasses RLS. So both candidate shapes work, and the choice is now
informed rather than deferred:

| | Mechanism | Verdict |
|---|---|---|
| **B-i** | dedicated `tesseract_audience_writer` role, not a table owner, with three narrow policies naming it | **Chosen.** The pin trigger's `current_user` check names exactly one role that nothing else can be |
| **B-ii** | own the function as `postgres`, relying on the owner's RLS exemption | Rejected — every `postgres`-owned definer function and the SQL Editor would pass the pin, and it silently breaks the day anyone sets `FORCE ROW LEVEL SECURITY` |

B-i costs three extra policies and does not depend on `rls_forced` staying
`false`.

---

## Design corrections carried out of Part A

Seven, all local, none applied:

1. **A4** — the revoke on `contribution_visibility_targets` must be
   `INSERT, UPDATE, DELETE`. UPDATE is granted and was going to be missed.
2. **A5** — revision-event attribution pinned with
   `c.organization_id = r.organization_id`, matching the real four-column
   unique tuple. *(applied to `10-`)*
3. **A5** — both the event's and the revision's `organization_id` must match
   `current_org_id()`, removing a widening I had introduced for legacy
   null-org events. *(applied to `10-`)*
4. **A3c** — the two reply/reaction SELECT policies join the release, using
   `can_read_asset_contribution`.
5. **A7** — the RPC must not stamp `updated_at`; a visibility-only update
   leaves the clock alone unless written by hand.
6. **A8** — privilege boundary is B-i, a dedicated non-owner role.
7. **A5** — the RPC's scope validation is defence in depth, not sole
   enforcement: a CHECK already restricts `visibility` to the five scopes. It
   stays, because the CHECK cannot see a scope/target mismatch.

---

# Part B — exposure footprint

## B0 — Organizations · **28, all test/development**

Classified by the user: **all 28 production organizations are test or
development accounts. There are no live customer organizations in this
database.**

Consistent with the standing project status — the database looks like live
multi-tenant SaaS and is not.

### What this changes

- **Customer notification planning is not required.** The operational-impact
  analysis that shaped the gate — `n_6` thresholds, who to tell and when, the
  staged announcement for a large blast radius — is **moot**. `01-` #6 and #6b
  remain useful as a measure of the fix's reach, not as a contact list.
- **The release is pre-release hardening, not incident response.** That changes
  urgency and sequencing, not whether to ship.
- **The stale-client transition loses most of its force.** With no live users,
  the window between applying the policy and deploying the application is not
  an operational risk, and brief unavailability of audience changes costs
  nobody. The freeze-versus-permanent-safeguard argument becomes a question of
  design quality rather than an operational constraint.

### What it does NOT change

- **The permanent safeguard is still right.** It closes the non-atomic replace
  — a dropped connection between the delete and the insert destroys an audience
  — which is a defect in the write path regardless of who is using the system.
- **Do not infer that the research content is synthetic or non-sensitive.**
  A test tenant can hold real material someone pasted in. Confidentiality still
  applies to whatever is genuinely real; the test-account designation describes
  the *accounts*, not the *content*.
- **Every authorization defect found in Part A is still a defect.** Fixing them
  before there are live customers is the cheapest this will ever be.

### Reframed priority

Complete the preflight, test the fixes in isolation, deploy. Notification
planning is deferred unless later evidence identifies genuine third-party
confidential data or external exposure.

## B1 — V2 blast radius · **ZERO**

`n_1_exposed_now = 0` across all 28 organizations. No non-archived, non-firm
contribution currently has `team_id IS NULL`.

**V2 is latent, not active.** The policy defect is confirmed live in A1 and
still gets fixed — but no contribution is being read beyond its stated audience
through that branch today. Combined with B0, the release is hardening a defect
before it bites, which is the cheapest moment to do it.

### B2 skipped — subsumed

B2 splits B1's population into "audience destroyed" and "targets intact". With
B1 at zero that population is empty and B2 can only return zero rows. Skipping
it is the proportionate call, not a gap.

### What B1 does NOT cover, and why Part B continues

B1 tests one predicate: `team_id IS NULL`. The other two confirmed defects are
**unconditional** — they expose restricted prose regardless of `team_id`:

- **V1** — `asset_contribution_history_select` is org-scoped and
  visibility-blind. B3.
- **V3** — `asset_revision_events_select`, likewise. B4.

A zero here says nothing about either. They are measured next.

## B3 — V1 history exposure · **ZERO**

`n_4_restricted_with_exposed_history = 0`. No non-empty history row hangs off a
restricted contribution, in any organization.

**V1 is latent too.** The policy is defective — A1 confirmed it verbatim — but
nothing is currently exposed through it.

### Two zeros start to suggest a common cause

B1 and B3 test different predicates. B1 required `team_id IS NULL`; B3 required
`visibility <> 'firm'` **with** history, and would have caught a restricted
contribution with `team_id` set that B1 missed.

Both zero is consistent with one simpler explanation: **there may be no
restricted contributions in this database at all.** The alternative is that
restricted contributions exist but have never been edited — possible, since
`track_contribution_history()` has no INSERT branch (A7), so a
written-once-never-edited contribution has no history row.

Either way, a count of non-firm contributions by organization would explain
B1, B3 and B4 together, and is needed to interpret any zero B4 returns: without
it, "no revision-event exposure" is indistinguishable between *the policy is
not reached* and *there is nothing for it to reach*. Queued as **B3b**.

## B3b — the denominator · **ZERO restricted contributions**

Zero non-archived `asset_contributions` with `visibility <> 'firm'`, across all
28 organizations.

**This explains B1, B3 and B4 in one fact.** The three authorization defects
are not merely unexposed — among active contributions they are **unreachable**,
because the feature they govern has no live rows. The release is purely
preventative.

B4 was not run; B3b supersedes it. A zero there would have been uninterpretable
on its own, which is why the denominator came first.

### Scope limit, stated rather than glossed

**B3b excludes archived records, so it does not establish that restricted
visibility was never used historically.** Two related facts bound that gap:

- B3 did **not** filter `is_archived`, and returned zero — so no restricted
  contribution, archived or not, has a non-empty history row.
- Whether archived restricted contributions exist at all is **unmeasured**.
  `asset_contributions_select` does not filter `is_archived` either, so an
  archived restricted contribution would be exposed by the same defects; only
  the application filters archived rows out.

Not pursued: it would not change the fix, and with no live customers it would
only refine a description. Recorded as a known residual.

## B8 — the invariant · **VACUOUS PASS, not a measured one**

| organization | non_valuation_events | with_matching_contribution | violations |
|---|---|---|---|
| (no organization) | 3 | 0 | 0 |

**No hard stop.** But zero violations out of zero in-scope events proves
nothing about the actor-author invariant — it was never exercised. All three
non-valuation events belong to revisions with `organization_id IS NULL` and
have no matching contribution under the organization-aware join.

Recorded as **qualified/vacuous**. The invariant remains an assumption about
`publishDraft` plus the author-only UPDATE policy, now carried into the
isolated suite as an assertion rather than claimed as verified in production.

### These three legacy events fail closed under the corrected policy

Traced rather than assumed. The corrected §4 requires **both**
`asset_revision_events.organization_id` and `r.organization_id` to equal
`current_org_id()`. For these rows `r.organization_id IS NULL`, so
`NULL = uuid` yields `NULL`, the org branch is unreachable, and the only
remaining grant is `r.actor_user_id = auth.uid()` — **actor-only**.

That holds whichever way the event's own `organization_id` falls:

| event org | C1/06 today | corrected §4 |
|---|---|---|
| NULL | legacy branch → actor only | actor only |
| set | **first branch → org-wide** | actor only — **tightened** |

So the second case is a narrowing the correction delivers and the current
policy does not. Owner-only access here is securely validated: the branch keys
on `auth.uid()`, never on a client-supplied value.

These events are also "orphaned" in §4's terms — no matching contribution — so
the `ELSE` branch would deny them anyway. They never reach it, because the org
gate fails first. Both routes agree: actor-only.

---

# Preflight closed

**Part A: A1–A8, all passed.** **Part B: B0, B1, B3, B3b, B8.** B2 subsumed,
B4 superseded by B3b, and B5/B6b/B7/B9 skipped — they size a notification
exercise that B0 established is not required.

**No hard stop fired in sixteen blocks.** Net position:

- Three authorization defects confirmed **verbatim** in production.
- Two more found that nobody was looking for (reply/reaction SELECT policies).
- One legacy predicate found defective (`can_view_contribution`).
- Two design errors of mine caught and corrected.
- **Zero currently-populated exposure.** The release is preventative.

---

## Still queued, none blocking

| Block | Question |
|---|---|
| A3e | `EXECUTE` grants on `can_view_contribution` — item 5 of the A3d decisions |
| A7b | is `track_contribution_changes()` attached to any table anywhere? |
| A2b | wider view sweep: all schemas, all five tables |
| A5 | revision table columns, plus any CHECK on `visibility` | outstanding |
| A6 | history row shapes | outstanding |
| A7 | triggers on `asset_contributions` | outstanding |
| A8 | **RLS actually enabled** on the five tables | outstanding — hard stop |
| A2b | wider view sweep (all schemas, all five tables) | queued |
| B0–B9 | exposure footprint and the notification list | outstanding |
