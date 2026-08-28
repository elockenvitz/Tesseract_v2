# Coverage Stage 3 — follow-ups

Raised by the independent production review of Stage 3
(`feat/coverage-self-service-foundation`) on 2026-08-28.

**None of these block Stage 3 production deployment.** They are recorded here so
they are not lost, and deliberately *not* fixed in Stage 3 — each would widen a
change whose security properties have already been reviewed and validated on
staging.

Stage 3 deployment is blocked on something else entirely: the Stage 2/2B writer
fixes (`fix/coverage-gaps-org-id`, PR #216) must be live first, because
`organization_id NOT NULL` assumes no client path can still produce a NULL-org
row.

---

## A. A coverage admin can reassign the owner of a personal row — **CLOSED**

**Closed by Stage 3.5**, `20260828120000_coverage_personal_owner_immutable.sql`.
`enforce_personal_coverage_owner_immutable()` refuses any UPDATE that changes
`user_id` on a row whose `coverage_scope` is already `'personal'`, raising
P0033. A trigger rather than a policy, because the gap was reachable through the
admin lane and also through `service_role`, neither of which RLS constrains.
Org-assigned coverage keeps normal admin reassignment untouched.

Verified on staging: the gap reproduced (admin and privileged paths both
reassigned the row), then 10/10 after. Original write-up retained below.

### Original write-up

`coverage_update_admin` is deliberately not lane-restricted, so an admin can
edit a `personal` row — including its `user_id`. The scope-immutability trigger
stops them converting the lane, but not changing whose declaration it is.

A row that says "Ada follows AAPL" can become "Grace follows AAPL" with no
record that the subject changed, and Grace can then edit and retire it as her
own.

Not a tenant-boundary issue: it is confined to one organization and requires the
`coverage_admin` flag. It is an integrity issue about self-declared data.

**Why it was not fixed in Stage 3:** the obvious fix — pinning `user_id` in the
admin `WITH CHECK`, or a trigger forbidding `user_id` changes on personal rows —
also removes the admin's ability to clean up a departed colleague's rows by
reassignment, which is the reason the admin lane is lane-unrestricted in the
first place. That trade-off deserves its own decision rather than being made
inside a migration.

**Likely shape:** a trigger rejecting `user_id` changes where
`OLD.coverage_scope = 'personal'`, plus an explicit admin path for retiring a
departed user's declarations.

**What shipped:** the trigger. The "explicit admin path" was NOT built and is
not needed — an admin retains DELETE on personal rows in their organization, so
cleaning up after a departed colleague works today. What they cannot do is
transfer the declaration to someone else, which is the point.

---

## B. `role` is free text on personal rows

`coverage.role` is unconstrained text. Stage 3 forbids `is_lead` and `team_id`
on personal rows via `coverage_personal_carries_no_authority`, but says nothing
about `role`, so a self-declared row can carry `role = 'primary'` — the same
string an admin-assigned lead row uses.

Nothing currently reads `role` as an authority signal, so this is cosmetic
today. It becomes real the moment a surface renders "Primary analyst" from it,
because a personal declaration would then present as a governed assignment.

**Why it was not fixed in Stage 3:** constraining `role` means deciding what the
allowed vocabulary is for each lane, and `coverage_settings.hierarchy_levels`
already stores a per-org role list that nothing enforces. That is a coverage-
governance question, not a self-service one.

**Likely shape:** extend `coverage_personal_carries_no_authority` to require
`role IS NULL` on personal rows, or introduce a separate personal-role
vocabulary.

---

## C. `service_role` can move `organization_id` across tenants

Tenant immutability for `coverage` is enforced at the RLS layer:
`organization_id = current_org_id()` appears in both `USING` and `WITH CHECK` on
every write policy. `service_role` bypasses RLS entirely, so nothing stops a
service-role `UPDATE` from moving a row between organizations.

By contrast, lane immutability *is* trigger-level
(`enforce_coverage_scope_immutable`) and therefore holds for `service_role` too.
The asymmetry is the finding: the weaker of the two guarantees is on the more
important column.

No client path can reach this — it requires the service key. It matters because
Edge Functions, backfills and admin scripts run with it, and a mistake there is
currently unguarded.

**Why it was not fixed in Stage 3:** a trigger forbidding `organization_id`
changes would also block legitimate service-role data repair, including the kind
of backfill Stage 3's own guard contemplates. It needs an explicit escape hatch
(a session GUC, or a dedicated repair function) designed alongside it.

**Likely shape:** `enforce_coverage_org_immutable()` mirroring the scope trigger,
with a documented bypass for deliberate migration work.

---

## D. Same-day remove/re-add can trip `coverage_dates_valid`

With `allow_multiple_coverage = false`, `end_previous_coverage()` retires the
previous row by setting `end_date = NEW.start_date - 1 day`. If a user removes
their personal coverage of an asset and re-adds it the same day, the retired row
gets `end_date = today - 1` while `removePersonalCoverage` has already set
`end_date = today`, and the re-add path can produce
`end_date < start_date` on a row whose `start_date` is today — which
`coverage_dates_valid` rejects.

The user sees an insert fail with a constraint error and no explanation.

Reachable only when an organization has explicitly set
`allow_multiple_coverage = false`; the single production `coverage_settings` row
says `true`, and orgs without a row default to `true`, so no tenant can hit this
today.

This is the same date arithmetic that produced the hard evidence for Stage 1
finding (2) — there, an org A insert wrote an invalid `end_date` into an org B
row and the constraint was the only thing that stopped it.

**Why it was not fixed in Stage 3:** correcting the arithmetic changes
supersession semantics for the org lane too, which is behaviour Stage 1 and
Stage 3 both deliberately left untouched.

**Likely shape:** clamp to `end_date = GREATEST(start_date, NEW.start_date - 1)`,
or skip the retirement entirely when the previous row already carries an
`end_date`.

---

## Stage 4 planning constraints

Recorded here rather than in a design doc because they are consequences of the
follow-ups above, and Stage 4 is the first thing that will create real personal
rows.

### CoverageQuickStart must not expose a governed role

Follow-up B is still open: `coverage.role` is free text, and nothing stops a
personal row carrying `role = 'primary'` — the same string an admin-assigned
lead row uses.

**The first version of CoverageQuickStart must not let a user choose a role at
all**, and specifically must never offer a governed value such as "Lead
Analyst". Leave `role` absent, null or defaulted. A self-declaration that
presents as a governed assignment is exactly the provenance problem Stage 3.5
just closed on `user_id`, arriving through a different column.

Adding role selection is a later decision that needs follow-up B resolved first
— which means deciding the per-lane vocabulary, probably against
`coverage_settings.hierarchy_levels`.

### `analyst_name` — candidate Stage 3.6, to decide BEFORE Stage 4

Noticed while implementing Stage 3.5 and deliberately not fixed: `user_id` is
now immutable on personal rows, but `analyst_name` — the denormalised display
string every coverage surface actually renders — is not. A coverage admin can
leave the owner intact and change the label, so the row still *presents* as
somebody else's declaration.

Lower severity than the `user_id` gap: the identity of record is correct, joins
and permissions all key off `user_id`, and the discrepancy is visible to anyone
who looks at the underlying row. But if Stage 4 renders `analyst_name` as
attribution, it is worth closing the same way.

Not added to Stage 3.5 because the brief was explicit that the invariant should
protect `user_id`, and widening a security migration past its reviewed scope is
how reviewed scope stops meaning anything.

**Raised to a named decision point.** Stage 3.5 was deployed to production on
2026-08-28 with `user_id` immutable on personal rows. `analyst_name` is now the
remaining way to make a personal row present as somebody else's, and it should
be decided **before Stage 4**, because Stage 4 is what starts rendering these
rows to users.

Three options, in increasing order of cost:

1. **Do nothing.** Defensible only if Stage 4's surfaces render attribution from
   `user_id` (joined or resolved) rather than from `analyst_name`. Worth
   checking rather than assuming — every existing coverage surface reads the
   denormalised column, because `coverage.user_id` carries no FK and PostgREST
   cannot embed through it.

2. **Extend the Stage 3.5 trigger** to also refuse `analyst_name` changes when
   `OLD.coverage_scope = 'personal'`. One predicate, same shape, same error
   family. Cheapest real fix. Downside: a genuine display-name correction (a
   user changes their surname) would need the row retired and recreated, or a
   maintenance path.

3. **Stop storing it for personal rows** — resolve the display name at read time
   from `users`, leaving `analyst_name` empty in the personal lane. Correct, and
   the largest change: it touches every surface that reads the column.

Recommendation: check (1) first while designing Stage 4's surface. If any of
them renders `analyst_name`, do (2) as Stage 3.6 — it is a near-copy of the
migration deployed on 2026-08-28 and carries the same near-zero risk while
production holds 0 personal rows.
