# AI Chat 2.0 + Contextual Asset Workspaces V1 — design specification

**Status:** PR 1 merged and deployed (#290, main `1b37b2dc`). PR 2 in progress.
**Provenance:** recovered verbatim from the design pass produced in Claude Code
session `e2eae177-22d1-4f3a-9b40-4cd8fafeef55` (2026-11-10/11, final message
04:48 UTC) and persisted here unchanged in substance. Where this document and
memory disagree, this document is the record.

The specification was delivered in chat and never written to a file, so a
computer restart left the only copy inside a 529 MB session transcript. That is
the reason this file exists; its content is not new work.

---

## 0. The mandate

One coordinated initiative sharing a design system, response/evidence
components and an AI context layer. The objective, in the author's words: to
*"substantially improve the intelligence, usability, presentation, and
interactivity of Tesseract without rebuilding the existing application."*

The target is *"a cohesive, modern, context-aware investment intelligence
experience — not a new application or an AI-generated dashboard."*

### Workstream A — AI Chat 2.0

Premium restrained visual design; better typography, spacing, message
hierarchy and responsive layout; rich Markdown, tables, lists, financial
figures and comparisons; polished streaming / loading / retry / cancellation /
error states; a compact assistant panel and an expandable research mode;
improved conversation history, navigation and continuity; clear context
indicators for the active asset or task; useful contextual suggested prompts;
structured research trails, source references, timestamps and deep links; copy
and follow-up interactions; reusable presentation components that can also
support contextual workspaces.

Constraint: *"Do not introduce a new AI provider, framework, or retrieval
infrastructure."*

### Workstream B — Existing Asset Workspace enhancement

Work within the Dashboard-launched Asset Workspace architecture already built.
*"Do not create another asset page, duplicate the Dashboard, or replace the
existing Overview, Research, Work and History surfaces."*

Two contextual entry experiences:

1. **General asset overview** — present the firm's current research and
   investment context, highlight relevant market information, research
   freshness, open work and recent decisions; provide an evidence-backed AI
   briefing on demand; link directly to the existing editable research and
   working objects.
2. **Pending recommendation / decision preparation** — when opened from a
   pending recommendation, emphasise the PM decision, supporting thesis,
   risks, scenario targets, portfolio exposure, existing decision history and
   outstanding research requirements; generate an evidence-backed decision
   briefing; provide direct access to the existing Decision Inbox, Trade Lab
   and research actions. *"Preserve the distinction between recommendations,
   PM decisions, accepted trades and recorded execution evidence."*

### Workstream C — Shared contextual intelligence

Reuse the existing `ai-chat` Edge Function, retrieval tools, authenticated
context and source-navigation system. Establish a small reusable interface for
passing the active asset/portfolio/task context, the reason the user entered
the workspace, relevant authorised research and decision records, and source
references and freshness metadata.

*"AI generates explanations, synthesis and suggested questions. The
application renders actual interactive objects using existing components and
authorized handlers."* and *"Do not let AI invent application state, execute
trades or generate arbitrary application code."*

---

## 1. Current vs proposed UX

| | Today | Proposed |
|---|---|---|
| **AI panel** | One fixed-width pane. Markdown is prose-only. Trail is a collapsed footer. No history navigation beyond a conversations list. | Same pane plus an **expanded research mode**. Rich tables/figures (shipped). Trail is a first-class evidence rail. Context chip row naming the active asset. |
| **Asset entry** | Every entry lands identically: Overview, four mode tabs, whatever the hook loaded. The *reason* you opened the asset is discarded after the focus scroll. | Entry reason survives as a **briefing band** at the top of Overview: either a general "current context" briefing or a **decision-prep** briefing when launched from a pending recommendation. |
| **Pending rec → asset** | `DecisionInbox.tsx` has no asset navigation at all. You read the row, then find the asset yourself. | The row opens the asset with `origin: 'decision-inbox'`, landing on a decision-prep briefing with the four decision records kept distinct. |
| **Evidence** | Sources only in the AI panel. Overview counts executions from `portfolio_trade_events`; the AI counts committed trades from `accepted_trades` — the two can honestly disagree and nothing says so. | Same `AiSourceRef` components render in both surfaces. Where the two counts differ, the briefing names which record it is counting. |

---

## 2. Component-level changes

**Shipped (PR 1, #290):** `src/lib/ai/presentation.ts` (types, no client),
`figures.ts`, `markdown.ts`, `trail-text.ts`; `src/components/ai/{AiProse,
AiMessage, AiStates, ResearchTrail, Citations}.tsx`. `AISection.tsx`
1100 → 699 lines. `AIMessageContent.tsx` deleted.

**PR 2** — `AISection.tsx` gains a `mode: 'compact' | 'research'` prop; new
`src/components/ai/AiContextChips.tsx` (display-only, reads
`EngagementTarget`); new `src/lib/ai/suggested-prompts.ts` (prompts derived
from the active target's object type, not invented by the model).

**PR 3** — new `src/components/asset/AssetBriefing.tsx` +
`src/lib/asset-briefing/` (the request builder and the freshness rules).
Mounted inside `AssetTab.tsx`'s existing Overview mode, above
`InvestmentSnapshot`. `useAssetWorkspace.ts` gains nothing — it already
returns `sections` and `evidence`.

**PR 4** — `DecisionInbox.tsx` / `DecisionInboxPanel.tsx` gain an `openAsset`
call. `ResearchTrail`'s `SourceRef` gains an optional in-page handler so a
briefing source can scroll rather than navigate.

**Explicitly not touched:** `src/components/asset-v2/AssetWorkspace.tsx` stays
parked (a convergence test guards it). No new asset page, no Dashboard
duplicate, no replacement of Overview / Research / Work / History.

---

## 3. Navigation and context flow

```
Dashboard card / DecisionInbox row
      │  openAsset({ assetId, symbol, focus, origin, issue })
      ▼
AssetTab  ──reads origin+issue──▶  AssetBriefing (general | decision-prep)
      │                                   │
      │                                   │ ai-chat (existing edge fn, caller-scoped)
      │                                   ▼
      │                           AiProse + ResearchTrail  (PR 1 components)
      │                                   │ source click
      └───────────────────────────────────┴──▶ focusForSourceKind → existing mode/subpage
```

`EngagementTarget` (`src/lib/engagement/types.ts`, 166 lines) **already is**
Workstream C's interface — objectType, objectId, symbol, assetId, portfolioId,
`origin{itemId,surface}`, `issue{title,detail,reason,detectedAt}`, seedPrompt,
conversationId, contextChips. No new interface is needed; PR 3 adds a builder
that maps an `OpenAssetRequest` to one.

The context the model actually receives stays assembled **server-side** from
the conversation's tags. Chips are display-only. This is the existing seam and
it is why context cannot cross an org boundary: retrieval runs on the
caller-scoped client.

---

## 4. Shared primitives

| Primitive | Module | Owner |
|---|---|---|
| Renderable message shape | `lib/ai/presentation.ts` | PR 1 ✓ |
| Prose, tables, figures | `components/ai/AiProse.tsx` | PR 1 ✓ |
| Evidence rail + source links | `components/ai/ResearchTrail.tsx` | PR 1 ✓ |
| Loading / error / prompts | `components/ai/AiStates.tsx` | PR 1 ✓ |
| Source → asset routing table | `lib/ai/source-focus.ts` | shipped in #289 ✓ |
| Three-outcome contract | `supabase/functions/_shared/research-results.ts` | shipped ✓ |
| Context target | `lib/engagement/types.ts` | exists ✓ |
| Chat mode + context chips + prompts | `lib/ai/chat-modes.ts`, `lib/ai/suggested-prompts.ts`, `components/ai/AiContextChips.tsx` | PR 2 |
| Briefing request + freshness | `lib/asset-briefing/` | PR 3 |

A briefing is **one assistant message with a research trail**.
`AiRenderableMessage` is structural, not nominal, precisely so a briefing
renders through the same components as a chat reply with no adapter.

---

## 5. Loading, empty, stale, error

The three-outcome contract extends to the briefing band, because this is the
defect class the whole evidence layer exists to prevent:

- **loading** — skeleton band, Stop control (`AiThinking`), never a spinner
  that replaces existing content.
- **ok** — the briefing plus its trail.
- **empty** — "No research on this name yet" **with** the open-work and
  decision counts still shown. Absent is not unavailable.
- **error** — `AiErrorNotice` with Retry only when the caller can honour it.
  The band collapses; the asset's own data stays visible. A failed briefing
  must never make Overview look empty.
- **stale** — freshness is stated, never hidden. The asset header already
  computes `CASE FRESHNESS`; the briefing reuses that figure rather than
  deriving a second one.
- **restricted** — `accepted_trades` RLS additionally requires portfolio
  membership, so zero rows means "none visible to you", not "none exist"
  (6 exist on AAPL; the current caller reads 0). The briefing says "not
  visible to you", never "none".

---

## 6. Responsive behaviour

The AI pane is already a right rail on desktop and a sheet on mobile. The
briefing band is a single column that stacks; its trail collapses by default
below `lg`. Tables inside `AiProse` get their own `overflow-x` container, so a
wide weight table scrolls inside the band instead of widening the asset page.
Mobile goes through the existing registry in `lib/mobile/mobile-surfaces.ts` —
no second mobile surface.

Mode and width are not the same question. `compact` is the 384px right rail and
the phone sheet; `research` is the full-width desktop pane. The phone has no
room for an inline conversation sidebar, so it stays compact and gets the
research *reading* rules (one column, full width) for free.

---

## 7. Acceptance criteria (testable)

| # | Criterion | How it's proven |
|---|---|---|
| A1 | Existing chat, streaming and usage logging unchanged | `conversation-resume.test.ts`, `ticker-pill-navigation.test.ts` still pass untouched ✓ |
| A2 | Tables/figures render investment data correctly | `figures.test.ts`, `ai-prose.test.tsx` ✓ + live AAPL inspection ✓ |
| A3 | Every source kind is a live link, none dead | `source-focus.test.ts` asserts the honoured set equals `FOCUS_LANDING_SUBPAGE` keys ✓ |
| A4 | Context never crosses org or permission boundary | existing SQL tenant-isolation suite + a new case per briefing tool |
| A5 | Dashboard nav opens the *existing* workspace surface | assert `AssetTab` mounts, not `asset-v2` |
| A6 | General vs decision-prep contexts distinguishable | snapshot the two briefing requests; assert different record sets |
| A7 | The four decision records stay distinct | assert four labels, never one word "Decision" ✓ (`trail-text.ts`) |
| A8 | Actions keep their normal permissions | assert the briefing renders *handlers from existing components*, never new mutation paths |
| A9 | Empty ≠ unavailable in the briefing band | a forced tool error must not render the empty copy |

PR 2 adds:

| # | Criterion | How it's proven |
|---|---|---|
| B1 | Mode switching preserves the thread, the composer draft and scroll | DOM-identity test across a mode flip + interactive check |
| B2 | Suggested prompts name only context that exists | pure-function tests over tags/target; no prompt invents a record |
| B3 | Context chips describe the bound object, never a stale one | reuses the `subjectsAgree` suppression rule from the mismatch banner |
| B4 | Source navigation works in both modes | same `SourceRef` component in one tree; interactive click in each mode |

Every gate gets a deliberate-failure proof before it counts (Standing Rule 3).

---

## 8. Implementation sequence

1. **✅ Shared AI response and chat presentation** — merged, deployed (#290).
2. **Expanded assistant mode + contextual conversation behaviour** — `mode`
   prop, context chips, derived suggested prompts, conversation continuity.
3. **Contextual Asset Workspace briefings and entry behaviour** —
   `AssetBriefing` in Overview; general and decision-prep variants; renders
   research the hook already fetches and currently discards.
4. **Interactive source and workflow integration** — `DecisionInbox` → asset
   navigation; in-page source scroll; open checklist requirements as real
   objects.

Each PR stays independently functional, tested and deployable. No unrelated
backend refactoring.

---

## 9. Invariants this design depends on

- **The three-outcome contract**: every research tool returns exactly one of
  `ok`, `empty`, `error`. Conflating `empty` and `error` is the defect class
  the evidence layer exists to prevent.
- **The decision chain is four separate records**: `trade_queue_items`
  (analyst recommendation) → `decision_requests` (the formal ask + the PM's
  ruling) → `accepted_trades` (the Trade Book row, the ONLY committed trade,
  with its own `execution_status`/`reconciliation_status`) →
  `decision_reviews` + `price_target_outcomes` (retrospective). An accepted
  ruling is not an executed trade.
- **Caller-scoped client**: `executeResearchTool(supabase, …)` receives the
  client built from the forwarded Authorization header. The `service_role`
  client exists only for Vault key resolution and never reaches a tool.
- **Display-only chips**: the model's context is assembled server-side from
  conversation tags, so chips can never silently disagree with what was sent.

---

## 10. Adjacent problems found, unfixed (Standing Rule 4)

1. **Overview and the AI can honestly disagree about trades.** Overview counts
   executions from `portfolio_trade_events`; the AI counts committed trades
   from `accepted_trades`. Neither is wrong; nothing tells a reader they are
   different questions. PR 3 should state which record it counts, but
   reconciling the two is its own decision.
2. **`DecisionInbox.tsx` has no asset navigation at all.** A PM reads a pending
   recommendation and must then find the asset by hand. Scheduled for PR 4.
3. **`accepted_trades` reads 0 for the current caller while 6 exist on AAPL.**
   Correct RLS, but no surface distinguishes "none" from "none visible to you".
4. **`asset-v2/AssetWorkspace.tsx` is dead code** behind a convergence test.
   Deleting it is a separate decision.
5. **The parked Work-mode plan** (`streamed-wishing-koala.md`) overlaps PR 3's
   territory — Phase 3 of that plan would surface the same discarded
   `data.evidence[]`. Worth deciding whether PR 3 absorbs it or it stays
   separate.
