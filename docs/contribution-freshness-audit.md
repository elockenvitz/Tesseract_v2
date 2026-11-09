# Contribution freshness audit — `asset_contributions.updated_at`

Read-only audit. No database change has been applied. Prepared SQL lives in
`scripts/sql/contribution-freshness/` and is deliberately **not** in
`supabase/migrations/` so a deploy cannot pick it up.

---

## Findings, worst first

### F1 — `updated_at` is not a content date, and four surfaces read it as one

Three write paths stamp `updated_at` without changing a single word of the
published prose:

| Path | File | Stamps `updated_at` | Changes `content` |
|---|---|---|---|
| `updateVisibility` | `src/hooks/useContributions.ts:529` | **yes, explicitly** | no |
| `saveSectionReferences` | `src/lib/research/asset-research.ts:249` | no (deliberately omitted) | no — **but a production trigger stamps it anyway** |
| `saveDraft` / `discardDraft` | `useContributions.ts:322`, `:493` | no (writes `draft_updated_at`) | no |
| `saveContribution` | `useContributions.ts:194` | yes | yes |
| `publishDraft` | `useContributions.ts:394` | yes | yes |

So "I made my thesis team-only" and "I attached a 10-K" both currently read as
"the thesis was rewritten today". The readers that believe it:

- `src/lib/research/case-state.ts:199` — the case review anchor.
- `src/components/contributions/ThesisHistoryView.tsx:1023` — the synthetic
  "current contribution" timeline event, dated `c.updated_at`.
- `src/lib/research/asset-research.ts:84` — `collapse()` picks the winning
  contribution per section by newest `updated_at`, so a visibility flip can
  change **which author's prose** the legacy read path returns.
- `src/lib/memory/what-changed.ts`, `thesis-review.ts` — staleness and
  "what changed since the case was written".

`case-state.ts:32-38` carries a comment asserting this column is trustworthy
("every distinct value appears once, which is a real save"). That claim is
false — not because of a bulk update, which is what it checked for, but because
metadata writes advance it one row at a time. **That comment should be
corrected when the column is wired.**

### F2 — the Evolution Timeline counts metadata writes as thesis changes

`ThesisHistoryView.tsx:1006` types every `asset_contribution_history` row by
its **section**: `h.contribution?.section || 'thesis'`. Nothing inspects
whether the prose changed. Consequences:

- `thesisChanges` / `whereDifferentChanges` / `totalRevisions`
  (`:1222-1229`) count attachment and visibility writes.
- `significantOnly` (`:483`) filters by section, not by substance, so a
  **metadata write on `risks_to_thesis` survives the "Significant only"
  filter** — it is in the tier-1 section list.
- `useEvolutionAnalysis` is fed the same `events` array, so the AI
  change-analysis input inherits the miscount.
- `getSignificanceTier` (`src/lib/revision-service.ts:156`) takes
  `_oldContent`/`_newContent` and **ignores both** — it is a section lookup
  table wearing a diff signature.

### F3 — the objects that produce this behaviour are not in version control

`asset_contributions` has no trigger definition anywhere in the repo; only the
RLS policy for its history table exists
(`scripts/sql/security-c1/07-asset-contribution-history.sql`). Two strings the
product renders — `[Attachments: 2 items]` and `Added 1 reference(s)` — appear
**nowhere in the application source**, so a production trigger composes them.

I have no database tool in this session, so I could not read it.
`00-verify-readonly.sql` Q1/Q2 dump the trigger and function definitions; the
classifier's envelope handling and the backfill's exclusion rule are both
written conservatively **pending that output**.

### F4 — the reference-event lane in the timeline has no writer

`ThesisHistoryView.tsx:932` reads `asset_field_history` where
`field_name = 'thesis_references'`. That column was on the global `assets` row
and has been retired (`src/lib/assets/asset-columns.ts:22`). No code writes
that field_name any more, so `type: 'reference'` events exist only for legacy
rows — which is why new attachment activity surfaces as a **thesis** event
instead of a supporting-doc one.

---

## Design: `content_updated_at`

`updated_at` keeps its current meaning ("the row was touched") and every
existing reader keeps working. A second column answers the narrower question.

Maintenance is a **BEFORE INSERT OR UPDATE trigger**, not application code,
because six client paths write this row today and a seventh will be added by
someone who has not read this file. The load-bearing line is the `ELSE`
branch (`10-migration.sql`):

```sql
ELSE
  NEW.content_updated_at        := OLD.content_updated_at;
  NEW.content_updated_at_source := OLD.content_updated_at_source;
```

A client that sets `content_updated_at` explicitly without changing the prose
has its value **discarded**. That is what makes the column unbypassable rather
than merely conventional.

`content_updated_at_source` records provenance (`trigger` | `history` |
`revision` | `never_updated` | `manual_date_only`), CHECK-constrained, with a
paired-nullability constraint so a timestamp can never claim no source. This
is what lets a reader distinguish "written 12 Dec 2025" from "written at
00:00 on 12 Dec 2025", which matters for F6.

---

## Backfill plan — and what it refuses to do

**`updated_at` is not copied as a content date.** Doing so would write a false
"last written" into every contaminated row and make the contamination
permanent and unauditable.

Each row is dated only from evidence that witnesses a prose write:

| Pass | Evidence | Source value |
|---|---|---|
| 1 | newest `asset_contribution_history` row where normalised prose actually differs, attachment-envelope rows excluded | `history` |
| 2 | `asset_revision_events.after_value` equals the row's current content → that revision produced today's prose | `revision` |
| 3 | `updated_at IS NOT DISTINCT FROM created_at` → no UPDATE has ever run, so `updated_at` **is** the original insert | `never_updated` |
| 4 | none of the above | **left `NULL`** |

Pass 3 is the only place `updated_at` is read, and it is read as an INSERT
timestamp, not as a last-write clock — by construction it cannot be
contaminated there.

**Unknowns stay unknown.** Pass 4 rows keep `content_updated_at = NULL`. The UI
must render "last written date unknown" and must **not** fall back to
`updated_at`, or the contamination reappears one layer up. How many rows land
in each bucket is unknown to me — `00-verify-readonly.sql` Q5 returns the
counts, and the plan should be re-reviewed against them before 20- is applied.

Every pre-backfill value is written to
`contribution_freshness_backfill_log` first, which is what makes `90-rollback.sql`
possible.

---

## LLY incident record

**What happened.** During browser testing of the Phase 4 section-evidence
picker on 2026-10-20, attaching and then detaching a research note on the LLY
**Investment Thesis** contribution caused its `updated_at` to change from
**2025-12-12** to **2026-10-20**.

**Why.** `saveSectionReferences` deliberately does not write `updated_at`
(`asset-research.ts:241-248`). A production trigger on `asset_contributions`
stamps it on *any* UPDATE. The `attachments` value was restored to its original
state; **the timestamp was not restored and is unrecoverable** — there is no
`asset_contribution_history` row, no `asset_revisions` event and no audit row
for the original 2025-12-12 write, so nothing records the original time.

**Current user-visible effect.** The Snapshot reads the LLY thesis as written
this month and therefore states that no research has arrived since the case was
last written. Both statements are false. They remain false until this is
corrected.

**What is and is not known.** The **date** — 12 December 2025 — is known from
the product's own prior display of that row. The **time of day is not known**
and is not invented.

**Proposed correction (requires separate approval; block 30 of
`20-backfill.sql`, currently commented out and ending in `ROLLBACK`).** Set
`content_updated_at = 2025-12-12T00:00:00Z` with
`content_updated_at_source = 'manual_date_only'`. The midnight value is a
storage artifact, not a claim: `manual_date_only` obliges every reader to
render the date **without a clock**. The alternative — leaving the row in the
unknown bucket — discards a date that is actually known, which is a worse
answer than a flagged one.

`updated_at` and all audit events are **left exactly as they are**, as
instructed.

---

## Classification design

`src/lib/research/change-classification.ts` — pure, no database dependency,
13 tests passing, gate proven non-vacuous (injecting `return 'content'` fails
the two metadata assertions).

```
content    the normalised published prose differs — a real edit
metadata   the row was written, the prose is identical after normalisation
ambiguous  the record cannot establish which
```

- Markup and whitespace are flattened (`normalizeProse`), so re-serialising
  identical prose through a different code path is **not** an edit. Wording,
  casing and punctuation are preserved — a change to any of them is content.
- First publication (`'' → prose`) and retraction (`prose → ''`) are both
  `content`.
- It does **not** judge importance. A one-word edit and a rewrite are both
  `content`; ranking them is `getSignificanceTier`'s separate (and currently
  content-blind) job.
- **`ambiguous` is not a synonym for metadata.** A value carrying the observed
  `[Attachments: N items]` envelope cannot be compared as prose, because the
  trigger's exact format is unread (F3). Such events stay **visible** in the
  timeline — no historical event is suppressed — and are labelled
  `Change type not recorded`, but they are excluded from substantive counts.
  Nothing is classified by guess.

**Wiring still to do** (not done here — it is the Phase 4 completion step, and
Q4 of the read-only verification should land first):

1. `ThesisHistoryView` — route `thesisChanges`, `whereDifferentChanges`,
   `totalRevisions` and the `useEvolutionAnalysis` input through
   `isSubstantiveChange`.
2. `significantOnly` — add `isSubstantiveChange` to the predicate so a metadata
   write on `risks_to_thesis` stops surviving it (F2).
3. The synthetic current-contribution event (`:1023`) — read
   `content_updated_at`, with `NULL` rendering as unknown rather than falling
   back to `updated_at`.
4. `case-state.ts` — switch the review anchor and correct the comment at
   `:32-38`.

---

## Test coverage

**Runnable now, without the migration**
`src/lib/research/__tests__/change-classification.test.ts` — 13 tests:
prose edit, first publication, retraction, one-word edit, unchanged prose,
re-serialisation, touched-but-empty, attachment envelope in either position,
prose that merely mentions attachments, and the normaliser's refusal to
flatten wording/casing/punctuation.

**Blocked on the migration — cannot be written honestly yet**

- Trigger behaviour (metadata write does not advance; forged client value is
  discarded; prose change does advance). Drafted as the roll-back-ed
  non-vacuity probe at the foot of `10-migration.sql`.
- Backfill bucket assignment and the `manual_date_only` path.
- Same-org read / cross-org denial on the new column and on
  `contribution_freshness_backfill_log`, per CLAUDE.md standing rule 5.
  **The column inherits `asset_contributions`' existing author-only write and
  org-scoped read policies — it adds no new data path.** The one new *table*
  is operations-only: no grants, RLS to be enabled explicitly
  (`90-rollback.sql`, final section).
- Snapshot/Research freshness agreement, and private/restricted evidence
  visibility, which both need a row whose `content_updated_at` differs from
  `updated_at` — impossible to construct before the column exists.

---

## Adjacent problems found, unfixed

1. **F4** — the dead `thesis_references` reference-event lane in
   `ThesisHistoryView`. New attachment activity has nowhere correct to land.
2. **`getSignificanceTier` ignores its content arguments** entirely
   (`revision-service.ts:156`). Its signature promises a diff-aware tier and it
   returns a section constant.
3. **`collapse()` in `asset-research.ts:84`** picks the winning contribution per
   section by `updated_at`, so a metadata write changes whose prose the legacy
   read path returns — a correctness bug independent of display freshness.
4. **`publishDraft` records a revision event fire-and-forget** (`:423-438`,
   `.catch(console.warn)`). A failed history write is invisible, which is one
   way rows end up in the unknown backfill bucket.
5. **No production database tool in this session.** Every verification step
   above is SQL for someone else to run. That is a standing limitation on any
   claim about production schema or data in this lane.
