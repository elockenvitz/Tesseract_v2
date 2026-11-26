# The recommendation integrity gap

One function could commit a trade whose decision never recorded what was
recommended. This is the trace, the fix, and what it does not touch.

Everything labelled "production" was read read-only
(`transaction_read_only = on`). Nothing here applies a migration or writes to
production.

---

## 1. Root cause

`createSelfProposedAcceptedDR`, in
`src/lib/services/execute-sim-variants-service.ts`.

It inserts an already-accepted `decision_requests` row — `status: 'accepted'`,
`reviewed_by`, `reviewed_at`, all in one statement — with **no
`proposal_id`, no `proposal_version_id` and no `submission_snapshot`**. It
never called `upsertProposal` and never called
`captureRecommendationVersion`.

That row is both halves of the chain at once: `requested_by` is the
recommendation, `reviewed_by` is the ruling on it. The recommendation half
preserved nothing.

**Entry point:** Trade Lab Execute. `executeSimVariants` → per variant →
`findExistingPendingDR` returns nothing → this function. Cases B and C in the
code's own terms: a logged idea or an ad-hoc variant. A variant that names an
existing pending request takes `markDRAccepted` instead and is unaffected.

**Reachable by a normal external user?** No. Trade Lab Execute is PM-only.
The actor must additionally satisfy the `decision_requests` and
`trade_proposals` insert policies, which require `auth.uid()` authorship and
org scope.

---

## 2. Every writer, as traced

Three writers insert `decision_requests` in the client, plus one database
function.

| Writer | Entry point | Proposal | Frozen version | Request names it | Atomic | Reachable |
| --- | --- | --- | --- | --- | --- | --- |
| `submitRecommendation` → `ensureDecisionRequestForProposal` | Inline rec form, Recommendation editor, Trade Idea modal, Simulation, Trade Queue | `upsertProposal` | **yes**, Step 2b, before the request exists | yes, `proposalVersionId: version.id` | version-then-request; the freeze throws, so a failed freeze means no request | yes, analysts and PMs |
| `createSelfProposedAcceptedDR` | Trade Lab Execute, no pending request | **none** | **NO** | n/a | single insert | yes, PM only |
| `createDecisionRequest` | `useCreateDecisionRequest` — **no component calls it** | none | **NO** | n/a | single insert | **no, dormant** |
| `ensure_pilot_decision_request_for_user` (SQL) | Pilot org provisioning | seeds one | **NO** (fixed by an unapplied migration) | n/a | one plpgsql block | not user-initiated |

`createDecisionRequest` is exported and wired to an exported hook whose only
consumers are tests. It would violate the invariant if anything called it.
Left alone deliberately — see §7.

---

## 3. Production impact, measured

Attributed by signature, the nine unversioned requests created since the
version-freeze writer reached production (migration `20260930170100`) are
**exactly two writers and no others**:

| Count | Writer | Signature |
| --- | --- | --- |
| 7 | pilot seed | `submission_snapshot` carries a `pilot_seed` key |
| 2 | this path | `decision_note = 'Self-proposed via Trade Lab Execute'`, no proposal, no snapshot |
| 0 | analyst submission | — |

**A correction to the earlier closeout report.** It read the nine as spanning
"7 portfolios across 8 dates, 7 of 9 carrying a submission_snapshot" and
inferred ordinary submissions. That pattern is the **seed's** signature: one
seeded request per pilot org, each org provisioned on a different day, each
carrying the seed's own snapshot. The conclusion that the seed is not the only
unfrozen path was right. The reasoning given for it was not.

Across all time, this path has produced:

| Metric | Value |
| --- | --- |
| self-proposed decisions | **44** |
| with a frozen version | **0** |
| with a proposal | **0** |
| with a submission snapshot | **0** |
| first / last | 2026-04-13 / 2026-10-21 |
| portfolios / actors | 6 / 6 |
| created since the freeze writer existed | 2 |

Only those last 2 were avoidable with the writer that existed at the time. All
44 are decisions whose investment case cannot be reconstructed.

**What was never wrong.** Nothing was displayed falsely.
`resolveHistoricalRecommendation` resolves such a row to tier `'none'` with
`reasoningUnavailable: true`, and it refuses by design to fall back to current
idea state. The loss is narrower and permanent: the variant is deleted on
execute and the idea's thesis, conviction and target keep moving, so there is
no surviving record of what the case was when the PM committed.

---

## 4. The invariant, and where it is enforced

> Every newly created actionable investment recommendation retains its
> original submitted reasoning through a versioned record that the decision
> request itself names.

Enforced in the **shared submission boundary**, by having the one bypassing
writer call the two canonical writers that already exist. No versioning logic
is duplicated: `upsertProposal` and `captureRecommendationVersion` are the
same functions `submitRecommendation` uses, with the same dedupe, the same
per-proposal version numbering and the same throw-on-failure.

### Why not a database constraint

A `CHECK (proposal_version_id IS NOT NULL)` is the obvious durable gate and it
would be **actively harmful today**. `NOT VALID` only skips the initial
table scan; every later INSERT *and UPDATE* is still checked. Production holds
**31 pending decision requests with no version** (26 predating the freeze
writer, 5 from the seed). A PM accepting any of those performs an UPDATE, and
the constraint would reject it. The gate would break a legitimate workflow on
real rows to prevent a defect in new ones.

### Why not a trigger, yet

An INSERT-only trigger avoids that, because it never sees those UPDATEs. It is
a reasonable durable gate — and it cannot be added until **both** remaining
unversioned writers are fixed, or it will reject the pilot seed and this path
on their next run. Correct order: this fix, then the seed migration, then the
trigger as its own change with its own injected-failure proof. Not prepared
here, because no SQL change is necessary for the fix itself.

### Database-level guarantees that already hold

Read from production, not from migration files:

| Property | Status |
| --- | --- |
| `trade_proposal_versions.proposal_id` | NOT NULL, FK to `trade_proposals` — there is no version without a proposal |
| unique `(proposal_id, version_number)` | present |
| RLS on `trade_proposal_versions` | enabled |
| policies | `_insert` (INSERT) and `_select` (SELECT) only — **no UPDATE or DELETE policy** |
| `authenticated` privileges | SELECT, INSERT. **No UPDATE, no DELETE** |
| `anon` privileges | none at all |
| INSERT predicate | `created_by = auth.uid()` AND `portfolio_in_current_org(portfolio_id)` AND `portfolio_team` membership |

So "historical versions remain unchanged" is guaranteed by the absence of any
update or delete path for the client role, not by convention.

---

## 5. What could break, and why it does not

The version INSERT policy requires `portfolio_team` membership. A PM who is
not in `portfolio_team` for the portfolio would now fail to execute at all,
where previously the execute succeeded without a version. This repository has
**two** portfolio-membership tables, so that was the real risk.

Measured:

| Cohort | Pairs | In `portfolio_team` |
| --- | --- | --- |
| every self-proposed (actor, portfolio) pair | 44 | **44** |
| every sim/adhoc executor (actor, portfolio) pair | 7 | **7** |

Nobody who has ever used this path loses the ability to use it.

Second behaviour change: an ad-hoc or logged-idea variant now creates a
`trade_proposals` row where none existed. It is written with
`proposal_type: 'pm_initiated'`, and `resolveOrphanedIdeaArtifacts` sets
`is_active = false` moments later in the same execute, which is the correct
end state for a proposal that was executed on creation.

Third: the partial failure moves. Previously no write could fail between the
request and the trade. Now a proposal or version failure throws, the variant
is reported as a failure, and **no accepted_trade is written**. The stranded
row is a proposal or version that nothing renders, and the next Execute adopts
it — `upsertProposal` finds the proposal by (idea, actor, portfolio) and
`captureRecommendationVersion` finds the version by fingerprint.

---

## 6. Test evidence

`src/lib/services/__tests__/self-proposed-freezes-reasoning.test.ts`, 14
cases, driving the real `executeSimVariants` over a recording double.

Covered here: the version is written and the request names it; the reasoning
is frozen and not merely the sizing; the proposal is labelled `pm_initiated`;
tenancy is carried; a failed version write commits no request and no trade; a
failed proposal write likewise; one variant failing does not stop the others
freezing; an inbox-promoted variant reuses its existing proposal instead of
starting a parallel lineage; resolving an existing pending request freezes
nothing new; and a five-shape census asserting every variant form that reaches
this function produces a request naming a version.

Covered already in
`src/lib/recommendations/__tests__/recommendation-version.test.ts` and not
re-proven against a double of itself: a retry deduping to one row, a revision
versioning up, and version 1 still saying Thesis A after version 2 says Thesis
B.

Cross-org and unauthorised access: proven at the database by the policies and
privileges in §4 — no UPDATE or DELETE path exists for `authenticated`, and
the INSERT predicate requires authorship, org scope and portfolio membership
together. `src/lib/recommendations/__tests__/recommendation-version-rls.test.ts`
asserts that policy SQL. No new table is introduced, so no new tenant suite is
added.

### Injected failures

| Injection | Result |
| --- | --- |
| drop `proposal_version_id` from the request row | **8 tests failed** |
| remove the proposal and version writes entirely (production's current behaviour) | **14 tests failed** |

Both reverted; the suite is green and the file is byte-identical to the fixed
version.

---

## 7. Adjacent findings, left unfixed

1. **`createDecisionRequest` is a dormant second bypass.** Exported, wired to
   the exported `useCreateDecisionRequest` hook, and called by nothing but
   tests. It would insert an actionable request with no version. Either route
   it through the boundary or delete it — but not in this change, because it
   is not the proven bypass.
2. **`anon` holds INSERT on `trade_proposals` and `decision_requests`.** RLS
   denies it in practice (the policies need `auth.uid()`), but the grant is
   the documented "every public table is born anon-executable" default and
   should be revoked.
3. **The 44 historical self-proposed decisions stay unexplained.** No
   backfill is possible: the reasoning was never recorded anywhere, so there
   is nothing to recover. Inventing one would be worse than the gap.
4. **The nine `decision_reviews` rows with no `reviewed_at`** — see §8.

---

## 8. The nine decision reviews

They are **not completed reviews, and must not be backfilled.**

All nine have `decision_quality` NULL, `sizing_quality` NULL and
`process_note` NULL. The only substantive field set is `thesis_played_out`:
three `yes`, one `no`, five `unknown`. The column has **no default**, so
`unknown` was written deliberately — a reviewer who did not know, which is not
a verdict.

Six are April 2026 rows with `subject_type = 'unknown'` and
`organization_id` NULL, predating both columns. Eight of the nine were last
touched on 2026-11-16, a bulk backfill that could not determine their subject.

`decision_reviews` has no `status`, `is_draft` or `completed_at` column.
**`reviewed_at` is the only completion marker the schema has**, so by its own
logic these rows are incomplete — which is exactly what they look like:
reviews opened, one field touched, abandoned.

**Recommended policy:** leave `reviewed_at` NULL and treat NULL as "not
completed" in every read path. Stamping a timestamp would assert a completion
that never happened, on rows whose only answer is `unknown`. If drafts need to
be distinguishable from legacy rows, that wants an explicit column, not a
guessed date.

---

## 9. Release order

1. **This PR.** Code only. No migration, no production change.
2. **`20261120010000_pilot_seed_freezes_reasoning.sql`** — the seed's 7 rows.
   Independent of this PR; they touch disjoint writers and can go in either
   order. Apply before graduating any pilot org.
3. *Then, optionally,* an INSERT-only trigger as the durable gate, once both
   writers above are fixed. Its own change, its own injected-failure proof.

Nothing in this document is an approval to apply anything.
