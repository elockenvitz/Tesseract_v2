# ADR 0001 — The decision record is append-only

**Status:** accepted, 2026-08-15
**Applies to:** everyone, including automated migrations and cleanup scripts

## Rule

**Nothing in the decision record is ever deleted.** Not by a migration, not by a
cleanup script, not because a table was superseded, not because the rows look
like test data.

Superseded tables are **renamed**, never dropped:

```
price_targets  ->  price_targets_archived_2026_08
```

The suffix carries the date the table stopped being authoritative, so the
archive is self-describing without a lookup.

## What counts as the decision record

Anything that captures what someone concluded, when, and on what basis:

- price targets, ratings, conviction
- theses, research notes, contributions
- trade ideas, recommendations, accepted trades
- resolved signals — a dismissed card is a decision that something did not
  warrant action, which is as much a record as acting on it
- the provenance attached to any of the above

## Why

The decision record *is* the product. Tesseract's argument is that an
investment firm should be able to reconstruct why it held what it held and
whether the reasoning was any good. A dataset with holes cannot answer that,
and the holes are always in the oldest and most interesting part — the
superseded table, the abandoned schema, the rows that looked like junk.

Fourteen legacy price targets are not clutter. They are fourteen moments where
somebody committed to a number, and they are the only evidence of what the
firm believed in 2025.

Storage is cheaper than the question you cannot answer later.

## Consequences

- Migrations that consolidate tables must migrate rows *and* archive the
  source. "Merge and drop" is not an available shape.
- Suppression is a display decision, never a delete. A card hidden by a
  quality gate stays in the data; see the suppression log.
- Erasure under a privacy request is the single exception, and it is scoped
  to *personal* data. `erase_user_personal_data()` deliberately retains
  authored content and re-attributes it — see that function's header.
- Test-looking data is quarantined or excluded from display, not removed,
  unless a human has confirmed it is genuinely test data.

## See also

- `supabase/migrations/20260814140000_erase_user_personal_data.sql` — the
  personal-data exception and why authored records survive it
- `docs/legal/DATA-INVENTORY.md` §4 — what deletion currently does
