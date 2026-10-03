# Historical recommendations — what we actually have

**No backfill was run. Nothing was written. Every figure is from read-only
queries against production on 2026-09-30.**

The slice freezes recommendations from now on. This answers the separate
question: for the 113 decision requests already in the database, how much of
what was recommended can still be recovered?

---

## The defect, measured

| | |
|---|---:|
| Resolved decision requests whose idea has been edited **since the decision** | **73** of 83 |
| Thesis rows (`trade_idea_theses`) created **after** the decision they render under | **33** |
| Decision requests with any reasoning in `submission_snapshot` | **0** |

73 of 83 resolved decisions are currently displayed alongside reasoning that
has changed since they were taken, and 33 bull/bear/catalyst/risk cases are
shown as part of decisions that were made before those cases were written.
This is not a hypothetical drift; it is the present state of the record.

The Outcomes pane makes the third number worse on purpose: it offers an
"Add thesis" form that writes `trade_idea_theses` and immediately refreshes
the decision story, so a case authored today appears under a decision from
months ago with nothing marking it as later.

---

## Classification of the 113 existing requests

| Tier | Count | What survives | What does not |
|---|---:|---|---|
| **A** — frozen version exists | **0** | — | Versioning starts with this slice |
| **B** — snapshot with action + sizing | **47** | action, weight/shares, sizing mode, submitted_at, requester | all reasoning |
| **B** — partial snapshot | **23** | varies; 20 are pilot seed rows | all reasoning |
| **C** — request columns only | **43** | sizing_weight/shares, requested_action, created_at | all reasoning, and the submission's own identity fields |

Of the snapshots, **10 were themselves backfilled** (they carry a `backfilled`
key) and **20 are pilot seed data**. Neither is evidence of what a person
recommended.

**Not one row in any tier contains a thesis, conviction, target price, or
bull/bear case.** There is no partial reasoning to recover. The reasoning tier
is empty across all 113.

---

## The fallback, and why it is not a reconstruction

`resolveHistoricalRecommendation` returns three tiers and labels which one it
used, so a surface can show what is real and say what is missing:

- **A (`version`)** — everything, with per-field provenance.
- **B (`snapshot`)** — sizing and action, shown as recorded. Every reasoning
  field returns `captured: false`, which is *not* the same as `value: null`.
  The surface prints: *"Submitted before investment reasoning was captured…
  the thesis at that time was not recorded."*
- **C (`none`)** — only the request's own sizing columns. The surface prints:
  *"No submission record was captured for this decision."*

There is deliberately no fourth tier reading current idea state. That
substitution is the defect, not a graceful degradation: it is what lets a
decision appear to rest on reasoning written after it.

The wording matters and is centralised for that reason. "Submitted before
reasoning was captured" is a fact about our record keeping. "No thesis was
given" would be a claim about the analyst, and we are not entitled to it.

---

## What must not be done

**Do not create version rows from today's `trade_queue_items`.** It is
mechanically easy — every one of the 113 requests has a live idea with a
thesis attached — and it would be a fabrication at scale: 73 of those ideas
are known to have changed since their decision, so the majority of
backfilled rows would be demonstrably wrong, and all of them would be
indistinguishable from real ones afterwards.

The table has no UPDATE and no DELETE policy. A wrong row written there is
permanent.

**Sizing-only backfill is possible but unnecessary.** The 47 tier-B snapshots
could be rewritten as version rows carrying action and sizing with every
reasoning column null. That adds no information — tier B already resolves
correctly through the fallback — while creating 47 rows that *look* like
frozen submissions and would need `trigger_event = 'backfill'` forever after
to stay honest. Not worth it.

## Recommendation

1. **Backfill nothing.** The fallback covers every existing row truthfully.
2. **Let the record build forward.** Every submission from this slice onward
   is frozen at submission with full provenance.
3. **Revisit only if the "Add thesis" affordance is kept.** A case written
   after a decision is legitimate — people do learn — but it needs its own
   timestamp and label rather than inheriting the decision's. That is thesis
   versioning, explicitly out of scope here, and it is the one remaining way
   this defect can still be introduced by hand.
