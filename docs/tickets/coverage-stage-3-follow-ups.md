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

## A. A coverage admin can reassign the owner of a personal row

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
