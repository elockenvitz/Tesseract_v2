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
