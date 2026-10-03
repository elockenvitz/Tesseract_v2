# The next memory layer — design, not implementation

Three capabilities, in the order they should be built. Nothing here is
implemented; this is a trace of where each belongs and what it must not do.

The constraint that shapes all three: **the product may record what happened
and what a person said, and may never infer what they meant.** Every slice so
far has been a variation on that, and each of these will test it harder than
the last.

---

## A. Structured decision reasons

### What exists today

| | |
|---|---|
| `decision_requests.decision_note` | Free text. A revert **nulls** it; a Trade Lab execute **overwrites** it with the literal string `'Accepted via Trade Lab Execute'`. |
| `accepted_trades.acceptance_note` | Frozen at commit, but seeded from `decisionNote ?? context_note ?? thesis_text ?? rationale` — so it is often a copy of the analyst's case, not the PM's reason. |
| `accepted_trades.revert_reason` | **The one durable reason in the product.** Required by `revertAcceptedTrade`, never overwritten. Slice 1 points at it with `source_field`. |
| `trade_event_rationales` | Append-only, versioned, nine structured fields. The best reasoning store that exists — and it is attached to EXECUTION events, not to decisions. |

So the product can say why a trade was *reversed* and why it was *executed*,
and cannot say why it was *approved*. That is the gap.

### Where capture belongs

**`decision_requests`, at the moment of resolution** — the same convergence
point Slice 1 already instruments. `updateDecisionRequest` is where defer,
accept and reject all pass through, and it is already the single writer for
`decision.recorded`.

Not a new table at first. A `decision_reasons` table would be correct
eventually, but the first version only needs the fields to exist somewhere
immutable, and `trade_proposal_versions` proved the pattern: an append-only
row the decision points at.

**Proposed shape** — `decision_rationales`, mirroring `trade_event_rationales`
so the two can eventually merge rather than compete:

```
decision_request_id   not null
organization_id       not null
authored_by           not null
version_number        int
reason_class          enum: conviction | sizing | timing | risk | mandate | other
what_changed          text    -- since the recommendation was written
why_now               text
sizing_logic          text    -- required when accepted_with_modification
risk_context          text
created_at
```

`reason_class` is the part that makes this *structured* rather than another
note field. It is also the part most likely to be got wrong: five classes that
a PM recognises are worth more than fifteen that are theoretically complete.

### The UI moment

**Not a modal before the decision.** A required form between a PM and a
decision they have already made will be filled with "ok" within a week, and
then the product has structured garbage, which is worse than honest free text
because it looks aggregable.

The honest moment is **immediately after**, as an optional, pre-populated
prompt on the card that just resolved — and a *required* one in exactly one
case: **accepted with modification**. There the product already knows a
question exists ("you were asked for +100bps and took +50") and the PM has
just demonstrated they have an answer. Slice 2 already detects and displays
that divergence; this is the follow-through.

Everything else stays optional and the absence stays visible: "No reason
recorded" is a true statement about the record and a mild, honest pressure.

### What must not happen

Backfilling `decision_note` into `reason_class`. The note is frequently the
analyst's thesis rather than the PM's reason, and classifying it would
manufacture a reasoning history that nobody authored.

---

## B. Thesis versioning

### How it should relate to recommendation versions

`trade_proposal_versions` (Slice 2) already freezes `thesis_text`,
`rationale`, `conviction`, `target_price` and the full `trade_idea_theses`
array at submission. So a thesis is **already versioned — but only at the
moments somebody happened to submit a recommendation.**

That is the key insight for this slice: thesis versioning is not a new
mechanism, it is **the same mechanism triggered by thesis edits rather than
by submissions.**

**Proposed**: `trade_idea_thesis_versions`, written when `thesis_text`,
`rationale`, `conviction` or a `trade_idea_theses` row changes materially.
`trade_proposal_versions` then stores a `thesis_version_id` pointer instead of
copying the four columns — the Spine rule applied to itself. The copies stay
for the rows that already have them; new rows point.

Trigger choice matters: a database trigger catches every edit including ones
the app does not know it made, which is both the argument for and against it.
Start in the service layer where the edit intent is known, and keep the
fingerprint-dedupe approach from Slice 2 so a save that changed nothing does
not mint a version.

### The hard question this answers

"Was the thesis different when the PM decided?" — currently unanswerable for
any decision whose recommendation predates Slice 2, and answerable only at
submission granularity after it. With thesis versions it becomes exact.

### What must not happen

Reconstructing versions from `audit_events`. Idea-edit audit rows had
`from_state` hardcoded, so a reconstructed history would be confidently wrong
about every "changed from". Thesis versioning starts empty and builds forward,
exactly as recommendation versioning did.

---

## C. Human-confirmed assumptions

The hardest of the three, and the one where an AI is most useful and most
dangerous.

### Minimal schema

```
investment_assumptions
  id, organization_id, asset_id, trade_queue_item_id (nullable)
  statement          text        -- "Gross margin holds above 72% through FY27"
  status             enum: proposed | confirmed | rejected | broken | expired
  confidence         enum: low | medium | high      (null while proposed)
  proposed_by        'ai' | user_id                 -- WHO SAID IT
  confirmed_by       uuid, confirmed_at             -- null until a human agrees
  source_type/source_id/source_field                -- what it was drawn from
  review_by          date                           -- when to re-ask
  created_at, updated_at
```

The load-bearing columns are `proposed_by` and `confirmed_by`. An assumption
with `proposed_by = 'ai'` and `confirmed_by = null` is **a question the
product is asking**, not a fact it holds. Every reader must be able to tell
those apart without reading a flag buried in a payload, which is why status
and confirmation are separate columns rather than one enum.

### How AI may participate

**It may propose. It may never confirm, and it may never mark one broken.**

- *Propose*: read a thesis and extract candidate assumptions as `proposed`,
  each with `source_field` pointing at the sentence it came from. The analyst
  sees "Tesseract thinks you are assuming X — are you?" and accepts, edits or
  rejects. Only the human write creates `confirmed`.
- *Flag for review*: when a deterministic fact contradicts a confirmed
  assumption — the margin series the assumption names falls below the number
  it states — move it to a **review queue**, not to `broken`. The transition
  to `broken` is a judgement and belongs to a person.
- *Never*: infer an assumption from a decision, backfill assumptions from
  historical theses, or set `confidence`.

The precedent is already set: Slice 1 refuses to record WHY a decision was
made because nothing durable captured it. This is the same rule applied to a
case where a model could produce a plausible answer — which is exactly when
the rule matters.

### Why this is the WOW layer

"You assumed gross margin holds above 72%. It printed 69.4% this quarter."
That sentence needs all three capabilities: the assumption (C), confirmed by a
human, attached to a thesis version (B), measured against a deterministic
fact. It is not something a terminal can say, because the terminal does not
know what this analyst assumed.

---

## Order and why

1. **Decision reasons** — smallest, and it closes the loop Slice 1 opened by
   deliberately leaving reasons absent. One required case
   (accepted-with-modification) where the product already knows a question
   exists.
2. **Thesis versioning** — mostly a re-trigger of machinery that exists, and
   it makes "what changed since you parked it" exact rather than "the idea was
   edited".
3. **Assumptions** — needs both of the above to be worth anything, and needs
   the most design time on the propose/confirm boundary.

## Open questions to settle before any of it

- Does `reason_class` have five values or fifteen? Settle with PMs, not in
  code review.
- Should `trade_event_rationales` and `decision_rationales` be one table from
  the start? They differ in subject (event vs request) and in whether a
  version chain is needed.
- Thesis versioning by trigger or by service? Trigger is complete, service
  knows intent. Probably service first, trigger later as a backstop.
- Who owns an assumption — the analyst, the asset, or the idea? The schema
  above hedges with a nullable `trade_queue_item_id`, which is a decision
  deferred rather than made.
