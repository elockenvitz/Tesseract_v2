# Asset Page 2.0 — what the Snapshot is made of

Governing contract: the locked product direction — an organization-wide
canonical workspace for one security, with an Investment Snapshot landing on
four domains (Belief, Position, Active Work, Decision Memory), an authorized
portfolio selector, the existing Research / Process / Decisions / Lists
workspaces retained, canonical data and workflows reused, context-preserving
navigation, and desktop/mobile functional parity.

**There is no specification file in this repository.** This document is the
written form of that direction plus the mapping it asked for, and it is what
implementation is checked against. If a separate spec exists elsewhere and
disagrees with anything below, the spec wins and this file is wrong.

The point of this document is to answer one question per row before any code
moves: *does the thing the Snapshot promises already exist, and where?* A
section with no canonical source is not a section to build; it is a decision
to take back to the product owner.

---

## 1. The authorized portfolio selector

**It exists and must not be rebuilt.**

| Need | Canonical source |
|---|---|
| Which portfolios may this user see? | `getVisiblePortfoliosForUser(userId)` — `src/lib/permissions/trade-idea-permissions.ts:183` |
| Which may they decide in? | `getUserPMPortfolios(userId)` — `:264`; per-portfolio `canMakeDecision(userId, portfolioId)` — `:243` |
| Role for one portfolio | `getUserPortfolioRole` — `:97`, reading `portfolio_team.role === 'Portfolio Manager'` (`:121`) |
| Org boundary | `portfolio_in_current_org(portfolio_id)`, SECURITY DEFINER, pinned — noted at `src/hooks/useDesktopIdeas.ts:57` |
| This asset's exposure per portfolio | `portfolio_holdings_positions` via `useAssetPortfolioWeights.ts:45` |

### The constraint that shapes the selector

**There are two portfolio-membership tables and they disagree.**
`portfolio_team` and `portfolio_memberships` are both written — see
`ClientOnboardingWizard.tsx:171-172` and `:342-343`, which insert into both on
every portfolio it creates. Permissions read **only** `portfolio_team`
(`trade-idea-permissions.ts:121`). A collaborator added to
`portfolio_memberships` by any other path is therefore invisible to every
permission check.

This is a known, deliberately deferred defect. The selector must read
`portfolio_team` through the helpers above — the same source the decision
rules use — so that **the portfolios the selector offers are exactly the
portfolios the actions will accept**. Offering a portfolio the user cannot act
in is the failure this mapping exists to prevent.

### What the selector must not do

`analyst_price_targets` UPDATE is `auth.uid() = user_id`, so an edit to another
analyst's case **matches zero rows and returns success** — stated at
`src/components/signals/CaseEditor.tsx:16-19`. Any Snapshot control that writes
must be gated on authorship, not merely rendered and hoped for.

---

## 2. Snapshot domains → existing components, hooks, tables

Legend for **Status**: `reuse` = component exists and is mounted today ·
`wire` = data exists, nothing renders it · `build` = presentation work over an
existing canonical source · `blocked` = no canonical source.

### Belief — what we think and why

| Element | Component | Hook | Table | Status |
|---|---|---|---|---|
| Rating + conviction | `AnalystRatingsSection` (`AssetTab.tsx:3204`) | `useAnalystRatings` | `analyst_ratings`, `analyst_rating_history` | reuse |
| Price target / scenario ladder | `OutcomesContainer`, `ScenarioManager` (`:3185`) | `useAnalystPriceTargets`, `useScenarios` | `analyst_price_targets`, `scenarios` | reuse |
| Ladder vs spot | `PriceTargetsSummary` (`:3098`) | — | derived | reuse, after the quote fix in Increment 1 |
| Firm consensus | `FirmConsensusPanel` (`:3104`) | `useAnalystRatings`, `useAnalystEstimates` | `analyst_ratings`, `analyst_estimates` | reuse — but see §4 on n=1 |
| Case summary | `ThesisUnifiedSummary` (`:3040`) | `useContributions` | `asset_contributions` | reuse |
| Coverage | `CoverageDisplay` (`:2472`) | — | `coverage` | reuse, read-only; authoring stays on CoveragePage |
| **Assumptions** | — | — | **none** | **blocked** — §4 |

### Position — what we own

| Element | Component | Hook | Table | Status |
|---|---|---|---|---|
| Weight per portfolio | — | `useAssetPortfolioWeights.ts:45` | `portfolio_holdings_positions.weight_pct` | build — desktop currently computes its own; Increment 1 converges it |
| Market value / shares | Current Exposure (`:3838`) | `AssetTab:1010`,`:1031` | `portfolio_holdings` | reuse |
| Live-repriced weight | — | `useAssetLiveWeights.ts:133` | + quote per holding | reuse on mobile; desktop opt-in only (N+1, ~40 req/portfolio) |
| Active weight vs benchmark | hardcoded `—` (`:3878`) | — | `portfolio_benchmark_weights` | **wire**, with the four-state rule at `lib/desktop-portfolio/benchmark.ts:18-26` |
| Cost basis / unrealised | Current Exposure | as above | `portfolio_holdings` | reuse |

### Active Work — what is owed

| Element | Component | Hook | Table | Status |
|---|---|---|---|---|
| Open trade ideas | Open Items (`:3957`) | `useAssetTradeIdeas` | `trade_queue_items` | reuse |
| Decisions in flight | — | `useDecisionRequests` | `decision_requests` | wire |
| Who owes the decision | — | `canMakeDecision` (`:243`) | `portfolio_team` | wire — display only; authoring stays in DecisionInbox |
| Notes since review | — | derived (`useAssetWorkspace.ts:230`) | `asset_notes` + case date | build (desktop has none) |
| Process state | `InvestmentTimeline` (`:3740`) | workflow hooks | `asset_workflow_progress` | reuse — keep on the Process tab |

### Decision Memory — what we decided and how it turned out

| Element | Component | Hook | Table | Status |
|---|---|---|---|---|
| Timeline | `DecisionTimeline` (`:4101`) | `useAssetDecisionTimeline` | derived over 5 tables | reuse |
| Executed trades | — | `useAcceptedTrades` | `accepted_trades` | **wire** — zero references in `AssetTab` today |
| Outcomes / reviews | — | `useDecisionReview` | `decision_reviews` | **wire** — zero references today; see RLS note §5 |
| Price-target outcomes | — | — | `price_target_outcomes` | wire |
| Last action | hardcoded `—` (`:3815`) | — | `portfolio_trade_events` | wire |

---

## 3. Actions the Snapshot may offer

Every one already has a canonical writer. The Snapshot links to or reuses it;
it must not acquire its own.

| Action | Canonical writer | Gate |
|---|---|---|
| Edit case field | `useContributions.saveContribution` | author |
| Set rating / conviction | `useAnalystRatings.saveRating` | author |
| Set target / scenario | `useAnalystPriceTargets`, `useScenarios` | `auth.uid() = user_id` |
| Create trade idea | `AddTradeIdeaModal` → `trade_queue_items` | portfolio member |
| Record a decision | `updatePortfolioTrackDecision` (`lib/services/trade-lab-service.ts`) | **PM only**, `canMakeDecision` |
| Execute | `accepted-trade-service.ts:173` | TradeBook |
| Review an outcome | `useDecisionReview` | DecisionAccountability |
| Assign coverage | `CoverageManager` | coverage admin |
| Add to list / theme / project | `AddToListButton` etc. | org member |

---

## 4. Requirements the current data cannot support

These are the answers the mapping was asked for. Each is a decision to take
back, not something to build around.

1. **Assumptions have no typed entity.** Only a `rich_text` catalog field
   (`research_fields` slug `model_assumptions`), stored as prose in
   `asset_contributions`. A Snapshot cannot show "assumption → value → who
   changed it" without new ontology, which the contract forbids. **Recommend:
   Snapshot shows the assumptions field as prose, labelled as prose.**

2. **Active weight is unavailable for the pilot.** `portfolio_benchmark_weights`
   exists, but `lib/desktop-portfolio/benchmark.ts:11-13` records that on
   2026-09-15, 29 active portfolios had no benchmark file — *every pilot book
   among them*. The four-state rule exists because the previous code printed a
   confident active share for a book with no benchmark. **Wire it, and let it
   say "not configured".**

3. **"Reviewed, no change" is a memory event, not a review row.** No
   `reviewed_at`, no review entity for the research scan
   (`lib/desktop-research/model.ts:31`). Notes-since-review is derived from
   `created_at > caseWrittenAt`. **Honest, but it cannot be filtered or
   audited.**

4. **Execution truth is partial.** No `'failed'` status — states "pending" and
   "failed" are distinguished only by free text on `execution_note`
   (`docs/decision-execution-truth.md:78-83`). `live_feed` fills emit no event
   at all (`:236-241`). **Decision Memory must not claim an execution failed.**

5. **Firm consensus from one analyst.** Verified in the running app: AAPL shows
   *"Underweight · 1/1 analysts (100%)"*. A percentage over n=1 is not a
   consensus. **Presentation fix, not a data gap.**

6. **No index price series, no beta, no ADV, no corporate actions, no weight
   caps.** Unchanged. 52-week range *is* now derivable
   (`lib/signals/range-52w.ts`) and is simply unused on this page.

7. **`price_history_cache` is keyed on symbol, not asset_id**, so a ticker
   change splits a company's series (`docs/asset-universe.md:166-171`). The
   alias rule (`pricingSymbolOf`) is the workaround already used by Lists.

---

## 5. Org scoping and RLS posture

The contract says *organization-wide*. Three facts bound that:

- `asset_contributions` RLS **is not organization-aware**; the client must
  filter. `useAssetWorkspace.ts:153-158` documents the resulting bug — one
  org's work shown on another's page. `AssetTab.tsx:578` currently has **no org
  filter**. Mobile does it correctly (`MobileCaseView.tsx:71`).
- `decision_reviews` is on the unresolved cross-tenant-readable list
  (`scripts/unconditional-policy-guard.mjs:177`). Surfacing it on the Snapshot
  widens who sees it in practice. **Flag before wiring.**
- `assets` is one shared row per ticker with no organization
  (`lib/assets/asset-columns.ts:5-7`). Nothing org-specific may be written
  there. Two callerless writers still exist in `AssetTab`
  (`:1635`, `:2310`) and should be removed rather than left one JSX line from
  live.

**No new tables, no new policies, and no policy widened** by anything in this
mapping. Where a table's posture is a gap, the gap is named here and the
decision to surface it is the product owner's.

---

## 6. Desktop / mobile parity

Mobile has three sub-pages (Case / Decisions / Lists) against desktop's four,
and `MobileAssetPage.tsx:46-47` states Process is deliberately desktop-only.
Parity for the Snapshot means **the four domains answerable on both**, not the
same layout. The mobile page is the better-behaved implementation (449 lines,
no inline SQL, lazily mounted panels) and is the better template for the
Snapshot's data discipline.

Mobile cannot express the desktop arrival payload: `MobileAssetPage.tsx:22`
accepts only `{id, symbol, company_name?, focus?}` — no `issue`, `origin` or
portfolio, and there is no mobile equivalent of `AssetArrivalBar`. Context-
preserving navigation therefore has a mobile half that does not exist yet.
