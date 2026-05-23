# ADR-002 — Pilot progress keyed per organization

**Status**: Accepted — 2026-05
**Last reviewed**: 2026-05

## Context

When a new pilot org is onboarded, its admin walks through a
guided three-stage flow:

1. Capture a first idea
2. Build it through Idea Pipeline → Trade Lab → Trade Book
3. See the result in Outcomes

The frontend gates UI on three milestone timestamps that mark when
each stage was first reached:

- `trade_book_unlocked_at`
- `outcomes_unlocked_at`
- `graduated_at`

Originally these were stored on `users.pilot_progress` as
**user-level keys** — one timestamp per user, regardless of which
org they were currently in. That worked when every pilot user
belonged to exactly one org.

Two scenarios broke that assumption:

1. **Multi-org analysts.** Someone helping onboard several pilot
   clients ended up in N orgs. The first time they completed Trade
   Lab in Org A, their `trade_book_unlocked_at` got set globally.
   When they later opened Org B as a fresh pilot, the banner
   immediately showed Trade Book as "unlocked" — even though Org B
   had never done anything. The flow was broken because the
   timestamp was attached to the *user*, not the *engagement*.
2. **Resets.** When a pilot wanted to restart the flow (testing,
   demo prep), we needed to clear progress for *that org only*,
   not wipe the user's history across every other org they belong
   to.

## Decision

**Store pilot progress as per-org keys in the same JSONB column.**

Keys are now suffixed with the org ID:

```
trade_book_unlocked_at_<orgId>
outcomes_unlocked_at_<orgId>
graduated_at_<orgId>
```

The `usePilotProgress` hook reads and writes only the suffixed
keys; legacy unsuffixed keys are **deliberately not read** — old
state from before this change must be wiped via the Ops Pilot Panel
"Reset Progress" button.

Telemetry events (`pilot_telemetry_events`) carry the same
`organization_id` so all funnel analytics can be sliced per-org.

## Consequences

**Good:**

- Multi-org users see fresh onboarding flows in each new org they're
  added to.
- Resets are surgical — Ops can wipe a specific pilot's progress
  without affecting any other org the same user belongs to.
- Funnel analytics in OpsMetricsPage and OpsClientDetailPage are
  accurate per-org instead of being polluted by cross-org carry-over.

**Bad:**

- Keys are not type-safe — they're string-templated at the call
  site. Wrong org ID = silent wrong-key write. Mitigated by the
  centralized `tradeBookUnlockedKey(orgId)` helpers.
- Stale state from before the migration can sit in JSONB indefinitely
  if the user never hits "Reset Progress". Not a correctness issue
  because the legacy keys are never *read*, but it's clutter.
- `pilot_progress` JSONB keeps growing as a user is added to more
  orgs. Realistic cap is "a few dozen" — not a problem in practice.

## Alternatives considered

- **A separate `pilot_org_progress` table** keyed on
  `(user_id, organization_id)`. More normalized, type-safe per-row.
  Rejected for now because the JSONB approach was a one-line schema
  change with no downtime; a normalized table would have required
  a backfill migration plus refactoring every read site.
- **Move progress to the `organizations` table.** Wrong: progress is
  per *user* per *org* (e.g. an analyst could be onboarding several
  team members in parallel, each at different stages). Org-level
  storage loses the user dimension.
- **Compute progress on the fly from `pilot_telemetry_events`.**
  Tempting but slow on every render. The materialized timestamps
  are cheap to read and update.

## Related

- `src/hooks/usePilotProgress.ts`
- `src/lib/pilot/pilot-telemetry.ts`
- ADR-001 (multi-tenancy / org scoping)
