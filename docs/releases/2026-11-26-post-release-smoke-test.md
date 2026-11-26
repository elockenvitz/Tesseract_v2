# Post-release smoke test for `2f704873`

Narrow, and split by who can run what. Everything in Part A was run read-only
against production (`transaction_read_only = on`, `supabase_read_only_user`).
Part B needs a signed-in session, which an assistant cannot create: it would
mean entering a password.

Nothing here writes, and nothing here applies a migration.

---

## Part A — read-only checks already performed

### A1. The decision-integrity release has more to fix than the seed

This is the one result that changes a plan. `20261120010000_pilot_seed_freezes_reasoning.sql`
is written on the premise that the pilot seed is **the one path** that creates a
`decision_requests` row with no frozen reasoning, because every other route goes
through `submitRecommendation`, which captures a version first and fails the
submission if it cannot.

Measured against the writer's epoch — the version-freeze migration
`20260930170100`, because a ratio over all time only measures how long the
feature has existed:

| Era | Requests | No frozen version | Has one | No version AND pending |
| --- | --- | --- | --- | --- |
| before `2026-09-30 17:01Z` | 105 | 105 | 0 | 26 |
| on or after it | **13** | **9** | **4** | **5** |

105-of-105 before the migration is expected and uninteresting. **9 of 13 after
it is not.** Those nine span **7 distinct portfolios** across **8 distinct
dates** between 2026-10-01 and 2026-11-19, every one has a
`trade_queue_item_id`, and **7 of the 9 carry a `submission_snapshot`**. A
single seeding event does not look like that. Ordinary submissions do.

So the seed fix is necessary and is not sufficient: some other path is also
producing decision requests whose reasoning was never frozen. Not diagnosed
further here — that is development scope, deliberately not reopened — but it
should be, before the premise is trusted.

Totals for context: 118 decision requests (accepted 55, pending 32, withdrawn
29, deferred 1, rejected 1); 54 accepted trades (adhoc 35, simulation 10, inbox
9).

### A2. Every existing decision review has no completion timestamp

`decision_reviews`: **9 rows, 9 with `reviewed_at` NULL.** That is the defect
#343 fixed, and the fix is forward-only. Whether those nine should be
backfilled, or left as "completed, date unknown", is a product decision rather
than a bug — but a review with no date cannot answer "when did we conclude
this", which is the question the record exists for.

### A3. Pending migration objects are in the state the release assumed

Confirmed per object rather than from the ledger, which disagrees with the
repository for 308 of 370 files. Full detail in
`docs/releases/2026-11-26-pending-migrations.md`:

- `mark_pilot_progress(text, text)` — present, and matches its migration in
  return type, language, volatility, `SECURITY DEFINER`, `search_path`, and
  grants (`authenticated` yes; `anon` and `PUBLIC` no). The frontend merged in
  #353 has the RPC it calls.
- `ensure_pilot_decision_request_for_user(uuid)` — present, old body.
- `terms_acceptances`, `record_terms_acceptance`, `is_active_org_admin_of` —
  all absent, and unreachable from the app while every legal document is
  `draft`.

### A4. Unauthenticated surface, live

Measured on `https://tesseract2025.netlify.app` at `2f704873`:

- the landing page renders, 5 legal links, request box opens with
  `aria-modal`, close control 40x40
- `/signup` offers "Request access"; no dead end
- `/legal/*` shows the in-preparation notice, so the publication gate is closed
- `/dashboard` while signed out redirects to `/login`
- `/forms/access-request.html` serves all 7 declared fields plus
  `netlify-honeypot="bot-field"` and `noindex`
- no console errors on load
- **zero Supabase requests on a clean load** — see A5

### A5. The "unnecessary Supabase requests" finding does not reproduce

An earlier note in the release report said the signed-out landing page issued
`morph_sessions`, `organization_memberships` and `organization_governance`
reads. **On production it issues none.** Measured twice in a fresh tab with no
session: 0 requests to `*.supabase.co` after a 4-second settle, and still 0
after hopping to `/dashboard` and back.

The three queries are already gated in `src/contexts/OrganizationContext.tsx`
with `enabled: !!user?.id`, `enabled: !!effectiveUserId` and
`enabled: !!currentOrgId`. So there is **no minimum fix to make**: the original
observation came from a localhost preview and could not be reproduced, and the
gating it would have added is already there. Recorded as not-reproducible
rather than fixed, because a change made to satisfy an unreproducible
observation is a change nobody can review.

---

## Part B — needs a signed-in session, for a human to run

Each line is one check with an expected result. These cover only what #353
integrated; this is not a regression pass over the product.

**Charting (#338, #320–#337)**
1. Open Charting. A chart renders with a readable time axis and the drawing
   palette is present.
2. Type a ticker into the symbol box. Typing selects that instrument, and the
   command bar does not jump when the data lands.
3. Switch interval. Volume scales to the window you are looking at.
4. Sign out and back in. The recents list re-checks authorization and does not
   show another session's symbols.
5. Narrow the window to phone width. The toolbar fits.

**Decision integrity (#344, #340–#343)**
6. Open the Decision Inbox. A seeded pilot request still shows as an example
   and cannot be accepted, rejected or deferred.
7. Open a completed decision review. It shows a completion date for reviews
   completed from now on — the nine existing rows will not have one (A2).
8. Record an execution that reduces a position. It reads as a cut, not an add.
9. Open an outcome for a decision. The attribution window starts at the
   decision, not before it.

**Outcomes and recommendations (#345, #339)**
10. A deferred decision reads as deferred, not rejected, and rejected
    decisions are not double-listed.
11. In a newly provisioned pilot org, submit a recommendation on an asset the
    org owns. It submits.

**Asset workspace and news (#348, #346)**
12. Open an asset. The header states the instrument and says where its price
    came from.
13. Open market news. Articles load from the three remaining sources, ordered
    by recency, with no sentiment column.

**Getting Started (#247)**
14. Complete one onboarding step in two browser sessions at once. Both marks
    survive — this is the atomic-merge RPC, which is already in production.

**Lead capture (#352)**
15. Submit the live request form once. The submission appears in Netlify →
    Forms and a notification arrives. *Not done by the assistant: it would
    create a real record and email in your account.*

---

## What a failure here means

A Part B failure is a production defect in merged, deployed code and should be
raised as its own change, not folded into this closeout. A Part A number moving
is a data question, not a deploy question.
