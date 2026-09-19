# Backlog closure — 2026-09-10

Every lane below is in exactly one end state. Nothing is "in progress".

Baseline: `qa/mobile-integration`, `519adde` → see git log for the end SHA.

The point of this document is that **"half-finished" is not one of the
categories**. If a lane is not here, it was not part of this pass.

---

## A. Complete and integrated

| Lane | What landed |
|---|---|
| **AI System V2** | `src/lib/ai` merged: action vocabulary, response policy, envelope, context selection, history budget, stream protocol, with the edge function mirroring the prompt half and a drift test holding the two copies together. |
| **AI conversation persistence (read half)** | The sidebar no longer downloads up to 200 full transcripts to render titles. No migration. |
| **Ideas feed cross-tenant holdings** | Both unscoped `portfolio_holdings` reads scoped through `portfolios!inner(organization_id)`, cache key carries the org, ratchet added. |
| **Exposed provider key** | Alpha Vantage key removed from browser code; verified absent from a fresh bundle. Guard added. See §E — the key still needs rotating. |
| **TypeScript debt** | Repo-wide ceiling at 8,769, enforced. |
| **Post-226 reconcile** | Audits, activation milestones, policy tool, and CLAUDE.md — which had existed only as one untracked file in one worktree. |
| **Data Platform v1** | Already on the baseline before this pass (`ab235bb`). Provider-neutral read seam, identity, freshness, contracts, paging. |

---

## B. Complete, awaiting migration or deployment

Code is done. A database or a deploy is the only thing left.

- **Notification semantic grouping.** Migration `20260907120000` is
  production-ready and the application degrades safely without it: every
  notification query is `select('*')`, and `grouping.ts:321` reads
  `row.group_key ?? notificationGroupKey(row)`, so the client folds rows
  itself when the column is absent. Post-migration the producer holds the
  unique index and the client fold becomes a no-op. **Deployment order does
  not matter** — the app is compatible in both directions.
- **Coverage Stage 3.6 — `analyst_name` attribution.** Migration
  `20260910120000` drafted, not applied. Three live checks listed in its
  header must pass first.
- **Holdings working book.** Eleven migrations, code complete, atomic with its
  schema. See `holdings-working-book-deployment.md`.

---

## C. Formally deferred

Deliberately out of the product, with a stated resumption trigger.

- **Ranking engine convergence.** Consolidated into one named architecture
  lane: `ranking-engine-convergence.md`. Individual ranking defects route
  there rather than being patched in both shells. Triggers for starting it are
  in §5 of that document.
- **AI transcript storage.** The write half of the persistence problem needs a
  per-turn table. Reduced to one question in §E.
  `ai-conversation-transcript-storage.md`.
- **Mobile write parity.** 32 surfaces are `read-only`, 10 are `full`, 0 are
  `desktop-only`. Making them editable is a roadmap project, not backlog
  closure. `lib/mobile/mobile-surfaces.ts` is already the single place that
  decision lives, and the two action gaps that would have been dead ends
  (`review_position`, `update_status`) are recorded in `feed-actions.ts` as
  deliberately unrouted rather than routed somewhere approximate.
- **Activation instrumentation, unwired.** `src/lib/onboarding/activation.ts`
  is correct, tested and has no caller. Gated so it cannot rot unnoticed.
- **Pilot gated-surface disclosure.** `PilotNotYetCard.tsx` is complete and
  unreferenced. Wiring it means removing the DashboardPage route guard, which
  feeds `activeTabHiddenForPilot` → `awaitingPilotDecision` → `stillBlocking`
  — the boot-loader sequence. That is a redesign of the pilot cold-boot path
  with a flash regression to re-prove, not a wiring change.
- **Structural action routability.** `CardAction.id` is `string`, so a builder
  can still declare an id outside `FeedActionKey`. The one instance that did
  (`Open idea`) is closed with a test. Making it structural is
  `feed-primary-action-dead-ends.md` §4.2–4.3.

---

## D. Superseded

- **`feat/mobile-feed-filter-continuity`.** The baseline already contains this
  work in a strictly later form, including `displayFamilyOf`, which the branch
  does not have. Merging it would **regress** the held-variant semantics: the
  branch asserts "does not drag in the held variant, which is a different
  card"; the baseline asserts "brings the held variant with it, because both
  chips say the same words" — a deliberate refinement, filtering by what is
  printed. Verified by comparing both test suites and both
  `feed-categories.ts` export lists. Do not merge.

---

## E. Blocked on Eric — the smallest possible questions

1. **Rotate the exposed Alpha Vantage key?** Not really a question — it was
   readable in the deployed bundle and must be treated as compromised. The
   only decision is whether Alpha Vantage is still wanted at all, given
   quotes already fall through to Yahoo and the server-side seam in
   `market-news` is where a key belongs.
2. **AI transcripts: backfill or cut over?** When per-turn storage arrives, do
   existing threads migrate into it (one data migration over live rows, no
   ledger to verify against), or do new turns go to the new table with the old
   column kept read-only and unioned forever? Recommendation: backfill.
3. **Bulk EOD provider: yes or no?** ~$30/month versus 10,000 nightly scrapes
   of an endpoint we are not licensed to use.
4. **Russell 3000 as a universe, or as an index?** Free versus licensed, and
   they solve different problems.
5. **How much price history?** Ten years assumed; two years costs a fifth and
   covers every chart the app currently draws.

Questions 3–5 are verbatim from `docs/asset-universe.md` §8 and were already
in this shape. They are repeated here so the whole set is in one place.

---

## F. Blocked externally

- Applying `20260907120000` (notification grouping).
- Applying `20260910120000` (coverage attribution), after three live checks.
- Applying the eleven holdings migrations, then one full reconciliation cycle
  observed **per organization**.
- Verifying `cron.job` contains `close-portfolio-books` after the first
  holdings deploy — see the finding in
  `holdings-working-book-deployment.md` §3.1.

---

## G. Unresolved security backlog, severity-ranked

Deliberately short. This is what is known and open, not everything a scanner
would print.

1. **The rotated key is not yet rotated.** Removing the read stops the next
   build shipping it; it does nothing about builds already served.
2. **`portfolio_holdings` org-scoping, repo-wide.** ~70 call sites. The two in
   the Ideas feed are closed with a ratchet; the class is not, and
   `portfolio_holdings` is absent from `ORG_SCOPED_TABLES`, so
   `tenant:lint:frontend` cannot see any of them. Owner: the tenant-scoping
   audit. `ideas-feed-unscoped-holdings.md` §8.
3. **`frontend-tenant-lint` fails and nothing runs it.** 30 P0 against a
   baseline of 17, and it is not part of `npm run guard`. A lint that is red
   and unwired is not a control.
4. **`coverage` tenant immutability is RLS-only.** `service_role` bypasses RLS
   and can move `organization_id` between orgs; lane immutability is
   trigger-level and therefore stronger. The weaker guarantee is on the more
   important column. `coverage-stage-3-follow-ups.md` §C.
5. **`coverage.role` is free text.** Cosmetic until a surface renders
   "Primary analyst" from it, at which point a self-declaration presents as a
   governed assignment. Constrains `CoverageQuickStart` today. §B of the same
   ticket.
6. **`ai_conversations` is user-scoped, not org-scoped.** Correct as designed,
   but its *contents* are assembled from org-scoped data by `selectContext`.
   Whether a thread should survive its author leaving an organization is
   genuinely open and is nobody's ticket yet.

Not audited in this pass, and therefore not claimed either way:
service-role edge function authorization, the assets storage bucket, anonymous
grants, and dependency scanning. The 106 unconditional-policy-guard findings
were not triaged.

---

## H. What is verified, and how

| Gate | Result |
|---|---|
| `guard:unit` | 226 files / 3,758 tests pass, up from 217 / 3,582 |
| `guard:types` | 0 card-surface errors; 8,769 repo-wide, at the ceiling |
| `guard:tdz` | clean |
| `guard:selftest` | 14 self-tests, every guard proved able to fail |
| `vite build` | succeeds |

Three gates added or extended in this pass were each proved non-vacuous by
injecting the failure they exist to catch and observing it, then reverting:
the repo-wide type ceiling, the Ideas-feed holdings ratchet, and the
browser-key guard — which caught its own author naming the variables in a
comment.
