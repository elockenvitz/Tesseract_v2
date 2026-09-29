# Mobile Idea Workspace — Capability Inventory and Plan

Written 2026-09-28, against `c2ab513b`, after wiring `MobilePipeline` to the
shared `TradeIdeaDetailModal`.

The question this answers: **what can an analyst do to an investment idea from
a phone, what can they not do, and is a purpose-built mobile idea workspace
worth building?**

The short answer is that the gap is much smaller than the original report
suggested, and it is not where anyone expected it.

---

## 1. The headline finding

**`TradeIdeaDetailModal` has no meaningful mobile/desktop capability
divergence.** In 7,599 lines there is exactly one `!isMobile` guard, at
`src/components/trading/TradeIdeaDetailModal.tsx:2413`, and it suppresses the
asset's company name beside the ticker — which is re-rendered one line below
when `isMobile` is true (`:2437`). It is a layout relocation, not a loss.

Every other `isMobile` reference in the file (`:2378, 2382, 2389, 2391, 2400,
2403, 2410, 2431-2433, 2591, 2604`) is chrome: padding, font size, and
abbreviating "High Conviction" to "High".

Every tab, every mutation, and every permission check is identical on a phone.

The same holds for the panels it hosts and the drawer beside it:

| Component | `isMobile` refs | `hidden sm:` classes | Widest fixed element |
|---|---|---|---|
| `TradeIdeaDetailModal` | 11, all chrome | 0 | 280px |
| `ThesesDebatePanel` | 0 | 0 | 220px |
| `LinkedResearchSection` | 0 | 0 | 200px |
| `DecisionInbox` | 0 | 0 | 120px |
| `DecisionInboxPanel` | 0 | 1 (a label) | — |

At 390px with the shell's 12px gutters there are ~366px of content width, so
nothing overflows.

**This is why the fix was a wire, not a build.** The capable surface already
existed and already adapted itself; the phone Pipeline simply wasn't pointed at
it.

---

## 2. What a phone can now do to an idea

All of it reached by tapping a card on the Pipeline.

### Details tab
Read stage, rationale, thesis, sizing, conviction, time horizon, urgency,
visibility, assignee, collaborators, linked portfolios, tags.

Write:

| Action | Service | Line |
|---|---|---|
| Move stage | `useTradeIdeaService.moveTrade` / `.movePairTrade` | `:1536`, `:1544` |
| Edit rationale / thesis / sizing / risk / tags | `updateTrade` | `:2057-2154` |
| Edit urgency, visibility | `updatePriorityMutation`, `updateVisibilityMutation` | `:1646`, `:1665` |
| Assign, add collaborators | `updateAssigneeMutation`, `updateCollaboratorsMutation` | `:1750`, `:1775` |
| Link / unlink a portfolio (trade lab) | `linkIdeaToLab` / `unlinkIdeaFromLab` | `:1178`, `:1196` |
| Per-portfolio sizing target | `updateIdeaLinkSizing` | `:1136` |
| Defer / snooze | `deferTradeAsync` | `:7328` |
| Archive, delete, restore | `archiveTrade`, `deleteTrade`, `restoreTrade` | `:5755`, `:1551`, `:1564` |

### Debate tab
Add, edit and delete theses (`useCreateThesis` / `useUpdateThesis` /
`useDeleteThesis`), link notes and thoughts to an argument, and link, retype or
unlink research (`LinkedResearchSection`). This is the research workflow's
core, and it was entirely unavailable on a phone before.

### Discussion tab
Post messages, pin and unpin them (`messages.insert`,
`supabase.rpc('set_message_pinned')`).

### Recommend tab
**Submit and edit a recommendation** (`submitRecommendation`), and withdraw
your own. This is the capability the previous surface was named after and could
not perform.

### Activity tab
Read the full `trade_events` timeline.

### Decision Inbox (the drawer below the board)
`MobilePipeline` already mounts `DecisionInboxPanel` as a full-height sheet, so
a PM on a phone can **accept, reject, defer, revert and nudge** — including
accepting all legs of a pair trade at once. The loop closes on a phone.

---

## 3. What a phone still cannot do

These are real gaps, ranked by how much they hurt.

### 3.1 No way to create an idea from the Pipeline
Desktop creates ideas with `AddTradeIdeaModal`, reached from `TradeQueuePage`,
`SimulationPage`, `ListTab` and `AddToQueueButton`. The phone has a *different*
creation form — `QuickTradeIdeaCapture`, via `FeedCaptureSheet:324` — reachable
only from the Ideas feed, not from the Pipeline. So a phone user standing on
the Pipeline has no "new idea" affordance at all, and the two platforms capture
ideas through two different components with two different field sets.

This is the one place a genuine second implementation already exists.

### 3.2 No execution, and no simulation
`SimulationPage`'s idea-facing actions — request a recommendation from a sized
variant, bulk execute, import an idea into a lab — are absent. `simulation` is
not in the mobile surface registry at all, so it falls through
`getMobileSupport` to `desktop-only` (`src/lib/mobile/mobile-surfaces.ts:296`)
and renders `DesktopOnlyCard`.

Committing capital from a phone is arguably a feature, not a bug. Worth an
explicit decision rather than an accident.

### 3.3 No board-level operations
Desktop's `TradeQueuePage` offers drag-and-drop stage moves, arrow-button
nudges, multi-select filters (portfolio / owner / action / urgency), sort with
direction, an archived/deleted view, and column fullscreen. The phone Pipeline
has one stage at a time, a search box, and no filters.

Drag-and-drop is correctly absent — five columns do not fit at 390px however
the gesture is captured. Filters and the archived view are not, and filtering a
long list matters *more* on a small screen, not less.

### 3.4 No "what's missing" preview before a stage move
The pane I removed computed `missingForStage` and told the reader what a
forward move required *before* they tapped. The modal does not; the service
refuses the move and the reader learns afterwards. This is a regression
introduced by the wiring, and the smallest real piece of work on this list.

---

## 4. Defects found while taking the inventory

Ordered by severity. **None of these are fixed** — they are separate changes.

### 4.1 The modal's per-portfolio Accept/Reject is dead code
`portfolioDecisionMutation` (`:1280`) is only ever invoked at `:7321`, gated on
`selectedDecisionPortfolioId`. That state is set in exactly three places —
`:1305`, `:5745`, `:7311` — and **all three set it to `null`**.
`showPortfolioDecisionPicker` (`:244`) is declared and never rendered;
`setShowPortfolioDecisionPicker` is never called.

So the branch is unreachable, and with it the Defer-for-one-portfolio label at
`:7280-7352` that changes its own wording based on a value that is always null.
The modal's own comment at `:6082` says decisions happen in the Decision Inbox,
which is correct — but the dead picker remains, along with a mutation, a
`useState` pair and ~70 lines of conditional copy that no user can reach.

### 4.2 Pair trades and single ideas use different permission rules
Single-idea stage moves are gated by `canMoveStages` (`:2039`), which is
`isCreatorOrCoAnalyst` — **creator or assignee or collaborator**.

Pair-trade stage moves are gated by `isPairTradeOwner` (`:2034`), which is
**creator only** (`:2678`).

So a collaborator can advance a single idea and cannot advance a pair trade,
with no explanation offered in either direction. One of these is wrong; my
reading is that the pair branch should use `canMoveStages` too.

### 4.3 The proposal-withdraw sequence is copy-pasted three times
Three near-identical inline sequences of `decision_requests.update` →
`trade_proposals.update` → `trade_events.insert`, at `:4344`, `:6656` and
`:7018`. No shared service, no transaction. A partial failure leaves a
withdrawn request with an active proposal, and a fix has to be made in three
places.

### 4.4 Imported permission helpers are unused
`isPMForPortfolio`, `canMakeDecision`, `canSubmitProposal`,
`canInitiateDecision` and `canRevertDecision` are imported from
`trade-idea-permissions.ts` and never called. PM-ness is instead inferred by
string-matching `proposal.users.portfolio_role` against "manager"/"pm"
(`:3926-3928`) — for a display label only, not for gating, so it is not a
security hole today. It is a trap for whoever adds gating next.

### 4.5 Two unguarded writes
Neither `updatePriorityMutation` nor `sendDiscussionMessageMutation` /
`toggleDiscussionPinMutation` is gated by any permission variable in the UI.
Anyone who can open the modal can change an idea's urgency or post to its
discussion. **RLS posture unverified** — the server may well constrain this,
and per the schema-drift rule that has to be checked against the live database
rather than the migrations. Until someone does, treat it as unknown.

### 4.6 A stale registry note
`src/lib/mobile/mobile-surfaces.ts:131` still describes the Pipeline as *"One
stage at a time — tap a card to move it."* Tapping a card now opens the full
idea detail; moving is one thing you can do inside it. One-line copy fix.

---

## 5. Should we build a native mobile idea workspace?

**No. Not now, and probably not ever in the form originally imagined.**

The case for building one rested on the phone being incapable. It isn't — it
was unwired. The shared modal carries every capability, adapts its own chrome,
and is exercised by three desktop surfaces, which means it gets maintained
whether or not mobile exists. A second implementation would need to track all
of it: 19 mutations, five tabs, two parallel render trees for pair and single
ideas, and a permission model that is already inconsistent with itself (§4.2).

Two implementations of "advance a stage" is exactly how the removed pane ended
up able to do nothing else.

What is worth building is narrower and cheaper:

### Tier 1 — do these next (small, contained)
1. **Restore the `missingForStage` preview** inside the modal's stage ladder,
   for both platforms. Fixes §3.4, and desktop gains it too.
2. **Fix the registry note** (§4.6).
3. **Delete the dead decision picker** (§4.1) — it is ~70 lines and a state
   pair, and removing it makes the Recommend tab's actual contract legible.

### Tier 2 — decide, then do
4. **Resolve the pair/single permission split** (§4.2). This needs a product
   answer, not a code answer: may a collaborator advance a pair trade?
5. **Give the phone Pipeline a "new idea" entry point**, pointing at whichever
   of `AddTradeIdeaModal` / `QuickTradeIdeaCapture` survives. Converging the two
   creation forms is the larger half of this and should be scoped on its own.
6. **State the mobile filter posture.** Either bring the portfolio/owner/action
   filters to the phone board as a sheet, or say in the registry that filtering
   stays on desktop. Silence is the wrong answer for a surface where lists get
   long.

### Tier 3 — explicit product decisions, no code yet
7. **Should a phone be able to execute?** `simulation` is desktop-only by
   omission rather than by decision. Decide, then either register it with an
   honest support level or leave it desktop-only *on purpose*, with a note.
8. **Extract the withdraw sequence into a service** (§4.3) — not urgent, but it
   is the kind of triplicated write that eventually diverges.

### What not to do
Do not build a mobile-specific idea detail, a mobile-specific stage service, or
a mobile-specific recommendation form. The registry in
`src/lib/mobile/mobile-surfaces.ts` is the right shape for this product: one
app, two shells, a shared data layer, and an honest per-surface statement of
what a phone can do. Every gap above is either a missing entry point or a
missing decision — not a missing implementation.

---

## Verification status

The capability lists are read from source at `c2ab513b` and each claim carries
a file:line. The `isMobile`, `hidden sm:` and fixed-width counts in §1 were
measured by grep.

**Not measured:** the modal rendered at 390px from the Pipeline entry point.
Chrome refused a window resize in the session where this was attempted
(`innerWidth` stayed 1920 after three attempts) and the Playwright config
serves the card gallery, not the authenticated app. §1's width argument is
sound but it is an argument, not a screenshot.
