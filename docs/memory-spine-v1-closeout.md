# Memory Spine V1 — closeout

**V1 is complete.** Four slices, all local, nothing deployed.

The thing it now does, end to end, with every link a row and no link a
guess:

> A person parks an idea and says what they are waiting for → the product
> suppresses it until the date they chose → it comes back → the feed says
> *"You parked NVDA waiting for Q3 earnings and updated margin guidance"*,
> lists what deterministically changed while they were away, and shows where
> they left it → Resume work opens that exact idea → the obligation stays
> open until they actually resume.

---

## Supported

**Lifecycle events** — `recommendation.submitted`, `decision.recorded`,
`decision.reverted`, `execution.recorded`, written at the single point each
path converges on. Idempotent through dedupe keys derived from canonical
rows rather than from a clock, so a retry cannot double-record. Memory
failure never fails a portfolio action.

**Immutable submitted recommendations** — `trade_proposal_versions` freezes
what a recommendation said *and the investment thinking that accompanied
it*: thesis, rationale, conviction, target, stop/take, horizon, idea stage,
and the bull/bear/catalyst/risk cases. Each field tagged in `captured_from`
with the table, row and column it came from. Editing an idea no longer
rewrites the basis of decisions already taken on it.

**Durable revisit obligations** — `memory_obligations` rows raised by
explicit user action only. Due means *eligible for attention again*, never
*satisfied*; only a real action clears one.

**Explicit user reason for parking** — `memory_obligations.waiting_for`,
optional, human-supplied, immutable from any client. A changed reason
supersedes rather than edits, so "waiting for the print" and "waiting for
the CFO search" both survive as the two intentions they were.

**Deterministic due resurfacing** — one shared suppression predicate across
pipeline, feed, desktop ideas and attention; one shared due-obligation
query; one resolver back to the canonical work.

**"What changed since"** — six fact types, each a comparison of stored
values or a count of timestamped rows: price (with both as-of dates), new
research, idea edited, target changed, trade committed, decision recorded.
No model decides whether a fact occurred.

**A memory-aware feed candidate** — `READY_TO_REVISIT`, on the existing
`FeedCandidate` contract, ranked by small bounded terms that cannot promote
a quiet reminder above a real finding.

**Direct return to work** — `openIdeaDetail` on the mechanism
`TradeQueuePage` already listens for.

**Desktop and mobile** — the same candidate, eligibility, facts, builder and
CTA semantics on both; only the entry shape differs.

## Not yet supported

- **Structured decision reasons.** `decision_note` is free text a revert
  nulls and a Trade Lab execute overwrites. The Spine records that a
  decision was made and refuses to say why.
- **Thesis version history.** Theses are frozen only at submission, so
  "what changed" can say *the idea was edited* and never *the bear case was
  rewritten*.
- **Assumptions.** No propose/confirm model, so nothing can say "you assumed
  margin holds above 72%; it printed 69.4%".
- **Automatic interpretation of `waiting_for`.** It is a note, not a
  trigger. There is no earnings calendar (`asset_earnings_dates` is empty)
  and no price watcher. The card asks *"Has Q3 earnings happened?"*; it never
  answers.
- **Reason-changed candidate** and **thesis/reality divergence** — both need
  thesis versioning first.
- **A generalised organisational graph.** `related` on an event is pointers,
  not a graph, deliberately.

## The rule that held throughout

> The Spine CONNECTS existing truth; it does not duplicate and compete with
> it.

And its corollary, which cost more: **memory must never imply we know WHY
when we only know WHAT.** That is why decision events carry a status and no
rationale, why `target_price_changed` is omitted without a frozen
before-value, why `idea_edited` says only *that*, and why the one reason
that does exist was obtained by asking the user rather than by inference.

## What V1 deliberately did not do

No backfill. The dry-run reports are in
`docs/memory-spine-backfill-dry-run.md` and
`docs/recommendation-freeze-dry-run.md`: of 203 reconstructable lifecycle
events only 57 would be true, and of 113 historical recommendations **zero**
contain any reasoning. Fabricating that history into append-only tables
would have been permanent.

## Honest assessment

`docs/ready-to-revisit-evaluation.md` has the long version. Short: the
memory claim is completely grounded and the "why am I seeing this" answer is
the best in the feed. The weakness is that *what changed* is often
bookkeeping — an edit count, a price a terminal shows better — because the
interesting comparisons need thesis versions the product does not keep.

`waiting_for` was identified in that evaluation as the highest ratio of
perceived intelligence to invented truth available, and it is now built. It
is also the last such item: everything remaining needs new structure, not
new plumbing.

## Memory Spine V1 is considered complete.

Future memory work should be driven by **the next product capability**, not
by expanding this infrastructure. The three candidates — decision reasons,
thesis versioning, assumptions — are traced in
`docs/next-memory-layer-design.md`, and each should be justified by the
product question it answers rather than by the Spine's shape.

---

### Known gaps recorded, not fixed

- The card's `prompt` ("Has X happened?") and `body` do not render in the
  current `SignalCardView` layout for a card with a detail region and no
  panes. The honesty protection still holds — the headline reports and never
  asserts — but the question that puts judgement back with the reader is
  not on screen. Worth one layout pass.
- `Resume work` on desktop routes through `IdeasApp.onSelect`; the Explore
  surface has its own open path that this family does not take.
- Everything in `docs/security/privilege-audit.md` remains unfixed by
  design.
