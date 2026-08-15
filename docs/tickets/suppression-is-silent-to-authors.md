# Ticket — suppression hides the defect from the person who caused it

**Status:** scoped, not started. Explicitly out of Phase 1.
**Raised:** 2026-08-15

## The problem

The content-quality gate stops `Rationale: Test` and `NDDFKJSDNFKJ` reaching
the feed. Good — but the person who wrote them is never told, so from their
side the recommendation published normally. The gate converts a visible defect
into an invisible one.

Worse, it is silently one-directional: their idea is now less likely to be
seen, and nothing has asked them to fix the reason.

## What it should do

Tell the author, at the point where it costs them least, in this order of
preference:

**1. At write time, not publish time.** A rationale field that says "a
one-word rationale won't reach anyone's feed" while they are typing is worth
more than any notification afterwards. Cheapest and least annoying — no new
surface, no interruption.

**2. On their own object.** The idea, note or recommendation shows a quiet
marker: *not surfaced — rationale too short*. Visible where they would
already look, costs nothing when there is nothing to say.

**3. Never a notification.** "Your card was suppressed" arriving an hour later
is a scolding for something they cannot remember writing. If it warrants
interrupting someone it warrants blocking the save, and it does not warrant
blocking the save.

## What it must not do

- **Not a hard block.** Someone genuinely wants to save a stub and finish it
  after a call. Suppression from the *feed* is right; suppression from the
  *record* is not, per docs/adr/0001 — the stub is still a decision artefact.
- **Not a quality score shown to peers.** The moment this is visible to
  anyone but the author it becomes a performance metric and people write to
  the gate rather than to their colleagues.

## Open questions

- Does an org admin get an aggregate view — "6 ideas not surfacing" — or is
  that the same performance-metric trap one level up?
- The gate will have false positives. "Beat" is a legitimate three-character
  rationale in context. Author-visible feedback needs an override, and an
  override needs a reason field, and at that point it is a workflow rather
  than a validation.

## Dependencies

The suppression log (`src/lib/signals/suppression.ts`) records reason and
entity but not the authoring user. Adding that is the first step, and it
should be added when the log moves server-side rather than to localStorage —
author feedback needs to survive a device change.
