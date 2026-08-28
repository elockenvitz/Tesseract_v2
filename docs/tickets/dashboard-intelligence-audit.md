# Dashboard intelligence audit: is it a duplicate surface or a trapped source?

**Status:** audit only, nothing changed
**Date:** 2026-08-28, on `feat/desktop-ideas-redesign` @ 63e6c0b
**Question:** can Dashboard be simplified now, or does intelligence have to
migrate into canonical Ideas first?

**Answer: migrate first.** Dashboard owns two intelligence sources nothing else
consumes. Deleting the surface would delete the findings.

But the audit also answers a question that was not asked and matters more: the
tier-0 supply the Ideas cockpit is short of **is not in Dashboard**. It is in
mobile. Dashboard's exclusive intelligence is almost entirely process and
workflow — tier 2 and 3 — and the one surface holding price-versus-framework
findings is the phone.

## 1. The pipeline

```
DashboardPage
  └── useCockpitFeed(filters, navigate)
        └── useDashboardFeed
              ├── SOURCE 1  useDecisionEngine ──── 7 evaluators (below)
              ├── SOURCE 2  useAttention({windowHours:24}) ── 4 sections
              │                 project_assignments, project_deliverables,
              │                 trade_queue_items, asset_list_suggestions,
              │                 notifications, quick_thoughts, portfolio_holdings
              └── mapAllToDashboardItems → DashboardItem[]
                    → splitByBand (NOW / SOON / AWARE)
                    → snooze filter (localStorage, `attention-feed/snooze`)
        └── buildCockpitViewModel → CockpitStack[] in DECIDE/ADVANCE/AWARE/INVESTIGATE
              ├── DecisionSystem        (presentation)
              ├── ResearchWorkbench     (presentation + synthetic rows from the same view model)
              └── PortfolioWorkbench    (presentation + SOURCE 3)
                    └── portfolioIntelligence.classifyHolding
```

`DecisionSystem`, `ResearchWorkbench` and `PortfolioWorkbench` are three
**arrangements of one `CockpitViewModel`**. Only `PortfolioWorkbench` adds a
source of its own. So "three pipelines" was wrong: it is one pipeline, two real
detectors, and a third derived classifier.

## 2. Every output, classified

### Source 1 — the Global Decision Engine (7 evaluators)

| Evaluator | Trigger | Severity | Class | Canonical home | In Ideas? |
|---|---|---|---|---|---|
| `proposalAwaiting` | open proposal, 5d amber / 10d red, urgency bumps | red/orange/blue | **B** | `recommendation` (t2, base 0.90) | partly — Ideas has the proposal, not the *waiting* |
| `executionNotConfirmed` | accepted, unexecuted, ≥2d | **red** | **B** | none — needs a type | **no** |
| `thesisStale` | thesis `updated_at` 90/135/180d | red/orange/yellow | **B** | `research_stale` (t2) | overlapping, different trigger |
| `ideaNotSimulated` | idea in `idea`/`simulating` stage | orange | **B** | `awaiting_review` (t3) | **no** |
| `overdueDeliverable` | deliverable past due, ≥3d red | red/orange | **B** | `project_overdue` (t3, base 0.60) — **exact match already in TIER** | **no** |
| `ratingNoFollowup` | rating changed ≤14d, no idea since | orange/blue | **B** | none — needs a type | **no** |
| `highExpectedReturn` | EV ≥ 25%, no active idea | blue | **B** | none — needs a type | **no** |

All seven have a **stable identity** (`{prefix}-{entityId}`, keyed on trade
idea / asset / deliverable) and a real severity ladder. None invents a score
that would fight `priorityFor`: they carry `severity` and `sortScore`, and only
`severity` needs to survive normalization.

### Source 2 — the Attention system

| Section | Class | Notes |
|---|---|---|
| `decision_required` | **B** | somebody is blocked on this reader |
| `action_required` | **B** | assigned work |
| `informational` | **A/D** | largely duplicates feed posts |
| `alignment` | **C** | team priority view — state, not attention |

**Already on mobile.** `useAttention` is consumed by `MobileDashboard`,
`AttentionPage`, `AttentionDashboard`, `useMyPriorities` and `useDashboardFeed`
— everything except desktop Ideas.

### Source 3 — portfolio intelligence

| Output | Trigger | Class |
|---|---|---|
| `at-risk` holding | >20% drawdown, or >10% loss + thesis >90d stale, or a HIGH-severity related item | **B** |
| `stale` holding | thesis >90d / >180d | **A** — duplicates `thesisStale` and `stale_coverage` |
| `opportunity` holding | — | **B**, weak |
| `PortfolioNarrative`, `getPortfolioTopPriorities` | derived summary | **C** |
| `ExecutionStats` / pipeline strip | counts | **C** |

## 3. Tier-0 candidates in Dashboard

Assessed against the four questions:

**`executionNotConfirmed` — the only strong one.** An accepted trade that has
not been confirmed executed for two days is capital exposed to a process
failure, which is the definition of tier 0: a position has left the framework
the desk wrote down. Stable identity (trade idea id). Normalizes without a new
score — it already emits `red`. Not in mobile. **Moving it would make Ideas
answer a question Dashboard is currently the only place to ask.**

**`at-risk` holdings — plausible, needs care.** A >20% drawdown against a stale
thesis is attention-worthy, but it is computed from holdings *plus* related
`DashboardItem`s, so its identity is derived rather than intrinsic. Normalizing
it means deciding what the finding IS independent of what else happened to be on
the dashboard. Worth doing, second.

**Everything else is tier 2–3.** `proposalAwaiting` maps to `recommendation`
(tier 2, and the TIER table already argues it is not tier 0 because "somebody is
simply asking"). `overdueDeliverable` maps to `project_overdue` (tier 3).
`ratingNoFollowup`, `ideaNotSimulated`, `highExpectedReturn` are tier 2 at best.

**Conclusion: Dashboard is a poor source of Attention supply.** One candidate.

## 4. Where the tier-0 supply actually is

| Source | Produces | Tier |
|---|---|---|
| `useScenarioCards` → `buildScenarioGapCard` | `scenario_gap` | **0** (base 1.00 — the highest in the table) |
| `usePortfolioLenses` | breach / stale target / untargeted / conviction / crowding | **0–2** |
| `useDerivedInsights` | `no_thesis`, `stale_research`, `large_unreviewed` | 1–2 |

All three are **mobile-only**. `scenario_gap` is the single highest-base entry
in the whole TIER table and desktop has never rendered it.

## 5. Source matrix

| Source | Dashboard | Desktop Ideas | Mobile |
|---|---|---|---|
| Feed posts (thoughts, notes, contributions, proposals) | trade ideas only, via engine | ✅ canonical | ✅ |
| `useSignalCards` (cluster / conflict / stale) | ❌ | ✅ canonical | ✅ |
| `useAttention` (4 sections) | ✅ | ❌ | ✅ |
| Global Decision Engine (7 evaluators) | ✅ **exclusive** | ❌ | ❌ |
| `portfolioIntelligence.classifyHolding` | ✅ **exclusive** | ❌ | ❌ |
| `useScenarioCards` (`scenario_gap`) | ❌ | ❌ | ✅ **exclusive** |
| `usePortfolioLenses` | ❌ | ❌ | ✅ **exclusive** |
| `useDerivedInsights` | ❌ | ❌ | ✅ **exclusive** |

**Correction to the previous phase's report:** it stated that desktop had
`useSignalCards` output "mobile has never consumed". That is wrong —
`MobileDashboard:206` consumes it and pools it as `realSignals`. The divergence
is narrower than reported and runs the other way: mobile has three exclusive
sources, Dashboard two, desktop Ideas none.

**No surface has the full set.** Desktop Ideas is the only one with a canonical
ranker, and it has the fewest sources.

## 6. The recommended contract

Unchanged in shape from the previous recommendation, and now evidenced:

**Ideas — "what deserves my attention or action now?"**
Canonical Attention, ranked Next stream, scope relevance, all detector output,
actions/judgments, readthrough later.

**Dashboard — "what is the state of my world?"**
Portfolio snapshot, `ExecutionStats` pipeline counts, outcome and decision
history, workflow/project status, `PortfolioNarrative`, and a compact count that
links into Ideas Attention. No detector output of its own.

One challenge to the brief's framing: **`ResearchWorkbench` does not fit either
box.** It is a project/deliverable workbench that happens to read the decision
view model. Its natural home is Projects, not Dashboard and not Ideas — worth
deciding before Dashboard is reduced, or it will be reduced into the wrong tab.

## 7. Recommendation: **OPTION B**, with a reordering

Migrate first — but not Dashboard first. The cockpit's Attention band is the
thing that has to become real, and Dashboard supplies one candidate for it while
mobile supplies the highest-value one in the product.

**Sequence:**

1. **`useScenarioCards` → canonical candidate.** `scenario_gap`, tier 0, base
   1.00. Already a contract `SignalCard` with a builder and an entity — the
   normalization is close to the `signal-candidates.ts` adapter that already
   exists. Biggest Attention gain for the least new code. *Not a Dashboard
   change at all.*
2. **`usePortfolioLenses` → canonical candidates.** Breach / untargeted /
   conviction map onto `target_hit`, `no_target`, `conviction_oversized` /
   `conviction_undersized` — all already in the TIER table at tiers 0–1.
3. **`executionNotConfirmed` → canonical candidate.** The one genuine tier-0
   finding trapped in Dashboard. Needs a new `SignalType`, so it costs a
   contract change; do it once the pattern is established by 1 and 2.
4. **`useAttention` → canonical candidates.** `decision_required` and
   `action_required` only. Large surface, already shared with mobile, mostly
   tier 2–3.
5. **The remaining six evaluators → canonical candidates.** Process and workflow;
   `overdueDeliverable` is free (`project_overdue` already exists).
6. **`at-risk` holdings.** Needs its identity defined first.
7. **Then, and only then, reduce Dashboard** to state/summary.

Steps 1 and 2 are the ones that make the cockpit answer its own question. Steps
3–6 are what make Dashboard safe to delete.

## 8. Housekeeping (noted, not fixed)

- **18 of 38 `src/components/dashboard/*.tsx` are unreferenced.** `AwareBand`,
  `DecideBand`, `InvestigateBand`, `HeroDecisionCard`, `CommandBriefing`,
  `RankedDecisionList`, `PortfolioCommandCenter`, `IntelligenceRadarCard`,
  `MyActionQueueCard`, `ActionCenterDrawer`, `AdvanceProgressGrid`,
  `DailyFocusSummary`, `DashboardPipelineStrip`, `DashboardScopeBar`,
  `DecisionLoadStrip`, `DecisionReviewSection`, `PipelineStrip`,
  `TradePipelineLoop`. Roughly half the directory is dead.
- **`dashboardIntelligence.ts` (825 lines) is consumed almost entirely by those
  dead components** — `getHeroDecision`, `buildHeroConsequence`,
  `computeDecisionPressure`, `detectDecisionConcentration`,
  `buildBriefingInsights`. Likely dead with them.
- **`INVESTIGATE` band** is built by `dashboardStacks` and rendered only as a
  count in the dead `DecisionLoadStrip`.
- **Three attention surfaces:** `AttentionPage`, `AttentionDashboard`,
  `PrioritizerPage`, plus `useMyPriorities` — all over the same
  `useAttention` data, all separate from Ideas.
- **Two snooze stores.** `lib/attention-feed/snooze` (dashboard, localStorage,
  hours-based) is entirely separate from the canonical
  `dispositions`/`judgment-policy` store. A dashboard snooze and an Ideas snooze
  do not know about each other. This is the same class of defect as the one
  Phase 2 removed between mobile and desktop, and it must be resolved as part of
  step 4, not after it.
- `DashboardPage` renders `FirstSessionCoveragePrompt` + `PilotWelcomeBanner` +
  `DashboardFilters` before any content.

---

# Process failures migrated, 2026-08-28

`executionNotConfirmed` and `overdueDeliverable` now rank canonically. Ideas
answers "what has gone wrong with my process?" for the first time.

| | executionNotConfirmed | overdueDeliverable |
|---|---|---|
| Source | `trade_queue_items` via `useDecisionEngine` | `projects` → nested `deliverables` |
| Trigger | `decision_outcome='accepted'` AND `outcome IS NULL` AND age ≥ **2d** from `decided_at ?? updated_at` | not completed AND `due_date` in the past |
| Severity | always `red` | `red` ≥3d overdue, else `orange` |
| Identity | `a2-execution-{ideaId}`; entity = **tradeIdeaId** | `a4-deliverable-{id}`; entity = **deliverable id** |
| Asset | yes (the trade names one) | **none** — `context` carries only project |
| Self-resolving | yes — stops when `outcome` is set | yes — stops when completed |
| State | shared (the desk's trade) | assigned work, per-user |
| Dashboard action | "Confirm" → trade queue | "Open" → project |
| `dismissible` | already `false` | already `false` |
| Canonical type | **`execution_unconfirmed`** (new), tier 0 / base 0.90 | `project_overdue` (existing), tier 3 / base 0.60 |

**Tier 0 verified, not assumed.** Tier 0 is "the price has left the framework
the desk wrote down — a decision is already overdue whether or not anyone has
noticed". An approved trade unexecuted for two days is exactly that: the
decision exists, the book disagrees with it, and nobody has noticed. Base 0.90
sits below `scenario_gap` (1.00, which compares against the whole ladder) and
above `target_hit` (0.85, information the desk can act on at its own pace). **No
existing TIER value moved.**

`project_overdue` reuses the entry that already existed, and passing
`overdueDays` makes `priorityFor`'s own promotion rule reachable: a tier-3
workflow item lifts to tier 2 once severely overdue (14 days).

## Identity and actions

Process findings key on the **workflow object** — `tradeIdeaId`, deliverable id
— never the ticker. Two unexecuted trades on one name are two failures with two
fixes; an asset-keyed identity would answer both with one tap.

**Neither is triageable, deliberately.** Both are already `dismissible: false`
in the engine and both resolve themselves when the underlying object changes, so
snooze would hide a fact still true. And a process failure is *shared* state in a
way a personal thought is not — writing a personal disposition against one would
prejudge the durable-attention contract being settled elsewhere. The row renders
the controls as unavailable rather than absent, since an empty action column
beside fifteen full ones reads as broken.

## Mobile compatibility

Mobile has **no equivalent card and no access to the source** — it never
consumed `useDecisionEngine`. Adding it later is:

- **presentation-only** for `project_overdue`: `buildAttentionCard` already
  renders a project-entity card with a day-count metric.
- **presentation + a workflow mutation** for `execution_unconfirmed`: the fix is
  logging an execution, which mobile has no surface for. It could render
  read-only, or route to the trade queue.

The candidate representation is already shared, so neither needs a second
normalization.

---

# Staleness taxonomy: three detectors, three different questions

Audited, not retuned.

| | `thesisStale` | `stale_coverage` | `stale_research` |
|---|---|---|---|
| Where | Decision Engine (Dashboard) | `useSignalCards` (desktop + mobile) | `useDerivedInsights` (mobile) |
| Source | `asset_contributions` filtered to sections `thesis`, `where_different`, `risks_to_thesis` | 4 tables: `quick_thoughts`, `asset_contributions`, `asset_notes`, `analyst_price_targets` | 3 tables: `asset_notes`, `quick_thoughts`, `asset_contributions` |
| Population | assets in the reader's **coverage** | assets **held** in a portfolio | assets held, with **price and weight** |
| Timer | `updated_at` of the thesis sections | any activity in **30d** | last touch ≥ **30d** |
| Threshold | 90 / 135 / 180d | binary at 30d | 30d **plus a reason** |
| Extra condition | none | none | **a 15% price move since the last touch, or a ≥5% position** |
| What it means | **the written view is old** | **nobody has touched this name** | **something changed and the view did not follow** |
| Who acts | the thesis author | whoever covers it | the position owner |

**They are three genuinely different conditions, badly named.** Only one pair
truly overlaps.

- `thesisStale` measures the **document**. A name can be discussed daily and
  still have a thesis nobody has edited since March.
- `stale_coverage` measures **silence**. It is binary, has no materiality test,
  and fires on a 0.3% holding as readily as a 12% one.
- `stale_research` measures **silence that matters**. It is `stale_coverage`
  plus a reason to care, and its own comment says so: *"the old rule was `days
  >= 30` and nothing else, which is a fact about the product rather than about
  the investment."*

So `stale_research` is a **strict refinement of `stale_coverage`** — same
timer, same tables (minus targets), plus a materiality gate. Those two should
not both exist. `thesisStale` is genuinely separate and should stay.

## Recommended taxonomy

| Canonical | Means | Replaces | Population |
|---|---|---|---|
| **THESIS NEEDS REVIEW** | the written investment view has not been revisited | `thesisStale` | covered assets, 90/135/180d on thesis sections |
| **UNREVIEWED CHANGE** | something moved and the recorded view did not follow | `stale_research` **and** `stale_coverage` | held assets, ≥30d silent **and** a 15% move or ≥5% weight |

Two concepts, not three. `stale_coverage`'s unqualified form is retired rather
than renamed: a card that fires on any 30-day silence with no materiality test
is the "fact about the product rather than about the investment" its successor
was written to replace. `research_stale` — already labelled **"Unreviewed
change"** in `KIND_LABEL` — is the canonical type for the second row; the first
needs a new one.

**Not done in this pass.** It changes which cards fire for every reader and
belongs with the real staging measurement, not beside a process migration.

---

# Dashboard-exclusive sources after this pass

| Finding | Status |
|---|---|
| ~~`executionNotConfirmed`~~ | **migrated** — Dashboard presentation is now a duplicate, future reduction |
| ~~`overdueDeliverable`~~ | **migrated** — same |
| `proposalAwaiting` | exclusive → `recommendation` (tier 2, exists) |
| `ratingNoFollowup` | exclusive → needs a type |
| `ideaNotSimulated` | exclusive → `awaiting_review` (tier 3, exists) |
| `highExpectedReturn` | exclusive → needs a type |
| `thesisStale` | exclusive → blocked on the staleness decision above |
| `classifyHolding` at-risk | exclusive → needs an identity definition |
| `useAttention` decision/action | exclusive → **blocked on Decision Memory** |

---

# Staleness retirement: measurement plan

The taxonomy is accepted; the retirement is not measured. `stale_coverage`
stays until it is.

## The question

`stale_research` is `stale_coverage` plus a materiality gate — same 30-day
timer, same activity tables minus `analyst_price_targets`, plus a requirement
that something happened worth revisiting: a **15% price move** since the last
touch, or a **≥5% position**. Retiring the unqualified form is only safe if the
gate is discarding noise rather than findings.

## What to measure, on real staging

Run per workspace, for a reader with holdings:

| Metric | How |
|---|---|
| A. current `stale_coverage` count | `generateStaleCoverageSignals` output, unchanged |
| B. survivors under the gate | of A, those where `staleContextFor` returns non-null |
| C. **loss set** = A − B | the names that would stop being flagged |
| D. additions | names `stale_research` flags that `stale_coverage` does not — the two use different activity tables, so this is not necessarily empty |
| E. per lost name | weight %, days silent, price move since last touch |

## The decision rule, set before the numbers

Stated in advance so the result cannot be rationalised afterwards:

- **Retire** if every name in C is below both thresholds — under 5% weight and
  under a 15% move. That is the gate doing its job: silence with nothing behind
  it.
- **Do not retire** if C contains a name a PM would want flagged — a large
  position that has been quiet with no price move is still a coverage gap, and
  would argue the gate is too narrow rather than the unqualified form redundant.
- **Investigate D before either.** A non-empty D means the two detectors
  disagree about what counts as activity, which is a third defect and has to be
  resolved first: `stale_coverage` counts a price-target edit as activity and
  `stale_research` does not.

## How to run it

The rank-snapshot harness already authenticates and captures per-reader state.
Extending it with a `--staleness` mode is the cheapest honest route: it reuses
the sign-in, the org scoping and the redaction, and produces a committable
artifact with no personal identifiers.

**No production or staging mutation.** Read-only measurement, then a decision,
then the retirement in its own pass.
