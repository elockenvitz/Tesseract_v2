# "What changed while you were away?" — evidence inventory

Read-only survey of production on 2026-09-30, for the slice after this one.
Nothing here is implemented yet. The purpose is to decide, before any tile is
built, which sentences Tesseract is entitled to say.

Four classes:

| Class | Meaning |
|---|---|
| **SAFE FACT** | A deterministic comparison of two stored values. Say it plainly. |
| **SAFE WITH ATTRIBUTION** | True, but only meaningful with its source and as-of date attached. |
| **AI SUMMARISATION ALLOWED** | Human-written text already exists; a model may condense it, never conclude from it. |
| **NOT YET RELIABLE** | The data is absent, too sparse, or too stale to carry a claim. |

---

## SAFE FACT

**Price move since parking** — `price_history_cache` (38,740 rows, 137
symbols, current to the prior session). Two dated closes subtracted. Coverage
is the limit, not correctness: say nothing for the 775 assets outside those
137 rather than falling back to `assets.current_price`, which has no as-of
date and is populated for only 68 of 912 assets.

**Thesis edited** — `trade_queue_items.updated_at` vs the obligation's
`raised_at`, scoped to the fields the recommendation freeze already captures.
That a thesis changed is a fact. *How* it changed is the next row down.

**Stage moved** — `trade_queue_items.stage`, `stage_changed_at`, and the 316
`audit_events` stage transitions. Fully durable and already attributed.

**A decision was taken on it** — `decision_requests` resolved statuses, plus
the `decision.recorded` / `decision.reverted` / `execution.recorded` events
from slice 1. Who, what, when, all canonical.

**Target price changed** — `trade_queue_items.target_price` against the value
frozen in `trade_proposal_versions` at submission. The freeze is what makes
this a comparison rather than a guess, and it only exists for recommendations
submitted after slice 2.

**Research was linked** — `object_links` where `target_type = 'trade_idea'`.
A count and a timestamp; both exact.

**Portfolio position changed** — `accepted_trades` and
`portfolio_trade_events` for the asset since the park date. These are
committed facts with actors attached.

## SAFE WITH ATTRIBUTION

**Analyst price targets moved** — `analyst_price_targets` /
`analyst_price_target_history`. Real and dated, but it is a third party's
opinion; it must be rendered as "Morgan Stanley raised its target", never as
"the target rose".

**Benchmark weight moved** — SSGA/SPY-derived, and CLAUDE.md already requires
every surfaced figure to be traceable to its source. Carry the provenance
path or do not show the number.

**Price move itself, when shown as a percentage** — the as-of date belongs on
screen. "+8% since you parked it" with a stale cache behind it is a false
statement delivered confidently; "+8% (close 29 Sep)" is a true one.

## AI SUMMARISATION ALLOWED

**Bull/bear/catalyst/risk cases added or edited** — `trade_idea_theses` rows
written since `raised_at`. The prose is human-authored, so a model may
compress "three new bear cases were added" or paraphrase one. It may not
decide whether the thesis is now weaker — that is a conclusion, and the
product has no basis for it.

**Quick thoughts and notes on the asset** — same rule: condense what a person
wrote, attribute it to them, draw nothing.

**Execution rationales** — `trade_event_rationales` is append-only and
versioned, the only properly versioned reasoning store in the product.
Summarisable with attribution to its author.

## NOT YET RELIABLE

**Earnings** — `asset_earnings_dates` holds **zero rows**. There is no
earnings calendar. Nothing about earnings may be claimed, including "earnings
have passed since you parked this".

**`assets.current_price`** — 68 of 912 assets, no as-of timestamp. Unusable
for any "since" comparison; use `price_history_cache`.

**News / feed events** — no news table exists in this schema. A "what changed"
tile that implies news monitoring would be inventing a capability.

**Generic staleness** — `updated_at` is row mtime and is bumped by edits that
are not investment work. Until a `last_worked_on_at` exists (see below), "no
one has touched this in N days" is approximately true at best, and this slice
has just finished removing one way it was actively wrong.

**Asset field history** — no general field-history table. Only the specific
columns listed under SAFE FACT have a comparable prior value, and only
because something froze it.

---

## Backlog items this survey raises

**1. `last_worked_on_at`, distinct from `updated_at`.** Snooze no longer
bumps `updated_at`, which fixes the acute case, but the column still conflates
"a row changed" with "someone did investment work". Every staleness heuristic
in the product reads it. A dedicated column written only by substantive
actions would make those heuristics mean what they claim. Out of scope here
deliberately — redefining `updated_at` application-wide is a far larger change
than the one this slice needed.

**2. READ-ONLY privilege audit across org-scoped tables.** The previous slice
found `trade_proposal_versions` granting `anon` full DML and granting
`TRUNCATE` to both `anon` and `authenticated` — and `TRUNCATE` bypasses RLS
entirely, so no policy would have stopped it. That was one table, found by
accident while doing something else. Before any broader release, sweep every
org-scoped table for:

- any privilege granted to `anon`;
- `TRUNCATE` granted to `anon` or `authenticated` (RLS-exempt);
- `UPDATE`/`DELETE` granted where append-only is intended and only the
  absence of a *policy* is holding the line;
- `SECURITY DEFINER` functions that do not check `is_member_of_org`;
- tables with RLS enabled but no policy for an operation that is nonetheless
  granted.

Read-only and separate. Explicitly **not** done in this slice.

**3. The trade-review evaluator is dead at the read end.** `evaluateTradeReviewOwed`
always returns `[]` because neither caller of `runGlobalDecisionEngine` passes
`data.tradeReviewObligations` — the field is optional and simply absent from
both `data:` literals. Obligations are written and read by nothing. One line
in each caller would connect it; it belongs with the feed work rather than
here.
