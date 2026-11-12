# The contextual Asset Workspace

Branch `discovery/asset-page-2`, PR #291, unmerged.
Companion to `docs/act-ai-2-handoff.md`, which covers the ACT AI pass before
this one.

**Nothing in this document has been seen in a browser.** Chrome automation has
not been available in any session of this initiative, and the screenshots
shared earlier did not reach it. Every claim below is from source, from tests,
or from the live database read-only. The manual walkthrough in §6 is the
acceptance step, and it is yours.

---

## 1. The worst thing that was still true

The previous pass left `STATE_EMPHASIS` reading the workspace state and
choosing what leads the Overview. That closed a real defect — a constant
nothing read — and it answered the wrong question.

`workspaceState` is a fact about the **asset**: a decision is waiting, the
case is stale, nobody holds it. It cannot tell you why **this reader** opened
the name. And the field that could, `WorkspaceFacts.arrivalIntent`, was
passed `null` by the only surface that composes the page — since the day the
resolver was written, with its own comment describing what it was for.

So every lens already carried the reason across the hop (`openAsset` writes
focus, origin, issue and the book; the process route writes the workflow, the
stage and the requirement), and the page threw all of it away. A PM arriving
to rule on a buy request and an analyst arriving to finish an assigned
requirement got the same page, led by the same thesis excerpt.

That is what this pass fixes.

---

## 2. What a user will actually see

### Three leads instead of one

| Entry | What now leads the Overview | Beside it |
|---|---|---|
| General open | The firm's view (unchanged) | The state's companion: the queue, or the exposure on a held-but-unexplained name |
| A pending recommendation | **The decision in front of you** | The exposure it would move |
| An assigned requirement or a process run | **Work in progress** | What is owed, else the exposure |

In the two contextual modes the case does not disappear. It moves below the
action row, which is where a reader who came to rule or to work reads it:
after they know what they are ruling on.

### A new block: the decision in front of you

The old "Needs a decision" row was a verb, a book, and a `decision_note` that
is usually blank. The new block states, per request:

- the action as proposed, and the book it is for;
- **who proposed it** and **how long it has been waiting**;
- whether it is **yours to answer** (same `portfolio_team` rows the decide
  buttons use — a label, never a permission);
- the recorded rationale, standing the **idea's own words** in when the
  request carries none, and saying plainly when neither exists;
- the request the reader clicked at the top, highlighted, with the other
  waiting requests kept beneath it as context.

### A new block: work in progress

- the run's name, and `N of M requirements complete, K still owed`
  (a count of records, never a percentage — a three-requirement process does
  not have a meaningful 33%);
- the open requirements with their **owners and due dates**, the one the
  reader followed first;
- an untitled requirement is called untitled rather than drawn as a blank row;
- a requirement that was finished before the link was followed says
  "Already complete" rather than vanishing.

It reproduces nothing from the Work surface: no requirement is completed, no
takeaway written, no stage advanced. All of that is one button away.

This block also appears on a **general** review, in the supporting column,
without the arrival framing. "Active work and research requirements" is a
question this surface is supposed to answer, and it previously answered only
the half of it that is an idea or a decision request.

### A contextual action row

One restrained row under the lead. Every control resolves to a surface that
exists **and holds something**:

- general: Review the case (or **Start** the case when none is written) ·
  Where we are exposed (only when held) · Open the requirements (only with a
  run) · Ask ACT AI
- decision: **Open the recommendation** · Review the case · Open the
  requirements · Ask what evidence is missing
- work: **Continue the process** · Review the case · Ask what we already hold

The assistant is last and never the primary action: it interrogates what the
firm holds, and the firm's own records are on the page.

### The context strip stops contradicting the page

The sticky strip's "Active work" cell counted live **ideas** only. A name with
a buy request sitting unanswered read **"None open · nothing waiting"** —
directly above an Overview leading with that request. It now says
"Awaiting a decision" with the action and the book, in amber, and the
idea/request pair is deduplicated exactly as the Overview's queue
deduplicates it, so the two cannot report different totals.

### A path that did not exist

The pending-recommendations inbox (the comm pane's Quick Ideas view) had no
way to the asset workspace at all — only to the Idea Pipeline. The ticker is
now a link that carries the request id, so the workspace leads with **that**
request.

---

## 3. The three experiences, and the records behind them

### Context 1 — general asset review

Answers *what is our current view, where are we exposed, what has changed,
what deserves attention*. Composition unchanged except for the action row and
the process block: the firm's view (every contributor's words, attributed),
the state's chosen companion, the ACT AI briefing, research that arrived since
the case was written, exposure and valuation per book, decision history.

### Context 2 — pending recommendation

Answers *what is being proposed, on what evidence, and what do I do next*.
Leads with `DecisionAtHand` beside the exposure it would move; action row
leads with **Open the recommendation** (the existing decision surface, which
owns the controls); the written case sits below; the briefing is decision
preparation.

Records: `decision_requests` (through the page's own
`useAssetWorkspace.decisions`, enriched by `useAssetWorkAttention` **by id**),
`trade_queue_items` for the idea's rationale, `portfolio_holdings` for the
exposure.

The enrichment direction matters: `splitAttention` deliberately drops requests
that are neither the reader's to decide nor theirs to watch, so leading with
its output would silently hide a waiting request on a book the reader merely
covers. The page's rows are the spine; the enrichment is joined onto them.

### Context 3 — active research / workflow

Answers *what work is outstanding, what do we already have, what is next*.
Leads with `WorkAtHand`; action row leads with **Continue the process**; the
briefing is research support.

Records: `asset_checklist_items` for this asset and run, through
`useAssetOpenRequirements`.

---

## 4. ACT AI

`BriefingContext` was `decision | review`, with a documented argument that no
third situation has a different answer. That argument was right about the two
situations the **state** can tell apart and reasoned from the wrong input.

There is now a third, `work`, and it earns its place by the module's own test:
what it asks for is not the same briefing in different words. It asks what the
firm already holds that bears on the open requirements and what the records
show is outstanding, and it is explicitly forbidden from assessing whether the
work is going well — a model asked that invents a judgement about work it
cannot see.

- `briefingContextFor(state)` is unchanged, still used by every surface with
  no entry reason, and can never return `work`. A test pins that: work owed on
  an asset does not mean the reader followed a requirement to get here.
- `briefingContextForEntry(mode, state)` lets the entry reason outrank the
  state, for the same reason `resolveLanding` lets an explicit arrival outrank
  what the records infer. A general open still gets decision preparation when
  a decision is waiting.
- `workspaceAskDraft` is the action row's cold-start question, distinct from
  `briefingHandoffDraft` (which follows a briefing the reader has read). Both
  land in the composer and are never sent.

Retrieval, evidence, citations and the envelope protocol are untouched.

---

## 5. Engineering

Ten commits, oldest first:

| SHA | What it closes |
|---|---|
| `fc96253c` | `resolveEntry`: the entry reason, read from the descriptor the shell already delivers. `OpenAssetRequest` gains `decisionId` and `work`; both written even when absent, with `taskId: null`, so a plain open cannot inherit the previous reason. |
| `7bf671a9` | The third briefing context, and `workspaceAskDraft`. |
| `758fc672` | The pending-recommendations inbox can open the asset workspace, carrying the request id. |
| `f0ef323f` | The three compositions: `DecisionAtHand`, `WorkAtHand`, `WorkspaceActions`, `useAssetOpenRequirements`, `arrivalIntent` stops being null, `WorkAttentionItem.createdAt` typed. |
| `57bed9e4` | The strip's "nothing waiting" on a name with a ruling owed. |
| `64a493c1` | The running process on a general review; the supporting section composed from two lists instead of three branches. |
| `ed66111b` | An origin is provenance, not a reason (my own rule, applied to my own code). |
| `64bba90f` | The requirement cache cannot outlive an organisation switch. |
| `34380688` | The type ceiling set to the figure the repo measures, with the reason stated. Not a budget for this work: see Gates below. |
| `5c60578d` | A ruling reaches the surfaces that said it was waiting. The lead block and the strip read `asset-workspace`, fresh for 60 seconds, and no inbox mutation invalidated it. |

New files: `src/lib/asset-workspace/entry.ts`,
`src/components/asset/{DecisionAtHand,WorkAtHand,WorkspaceActions}.tsx`,
`src/hooks/useAssetOpenRequirements.ts`, and four test files.

### Gates

All four ran to completion on the final tree. None was weakened.

- `guard:types` **PASS**, 8,579 repo-wide / **0** card-surface. The ceiling
  was 8576, the last figure measured during the Layout change, and the tree
  measures 8579. The three are not this work's: HEAD with the final change
  removed also measures 8579, with a diagnostic list identical line for line,
  none of the three names an identifier this work introduced, and every new
  module carries zero diagnostics. They are three more implicitly-typed
  expressions in `AssetTab.tsx`-class files that already hold hundreds,
  surfaced by a commit between the two measurements. I did not bisect which;
  the ceiling is set to the measured figure and the reason is in the comment,
  so the next error still fails.
- `guard:copy` **PASS**. 339 em dashes at the ceiling, 0 legacy assistant
  names, 2,345 files scanned against a floor of 1,800.
- `guard:tdz` **PASS**. 0 use-before-define, 0 conditional hooks, 178 files
  linted, 0 unparseable.
- `guard:unit` **PASS**, exit 0: **637 files, 11,074 tests, 0 failures**, 279s.
  The two mobile outcomes suites that have been intermittently red all week
  passed in this run; see §7 for what that does and does not prove.
- `npm run build` **PASS**, built in 50s. The bundle-size warnings are
  pre-existing and unchanged in character.

Every gate needs `NODE_OPTIONS=--max-old-space-size=8192`. Without it
`guard:types` aborts with exit 134 and the guard correctly refuses to call
that a pass.

### Non-vacuity (Standing Rule 3)

Four injections, each reverted:

1. Forcing `entryMode` to `'general'` — the exact shape of the first attempt's
   defect, a page that composes one layout whatever the situation — fails
   **18 of 26** tests in `contextual-workspace.test.tsx`, across all three
   compositions, the handlers and the assistant framing.
2. Reverting the strip change fails **4 of 16** in
   `asset-context-strip.test.tsx`, including the one that pins "None open" on
   a name with a request waiting.
3. Dropping `currentOrgId` from the requirement query key fails
   "does not serve the previous organisation after a switch" with one
   organisation's requirement id where the other's belongs.
4. Cutting the ruling invalidation back to `['decision-requests']` alone —
   what every inbox mutation did before `5c60578d` — fails **6 of 6** in
   `decision-ruling-refreshes-asset.test.tsx` on "the Overview lead block and
   the strip: expected false to be true". That test reads the cache state the
   mutation leaves behind, so invalidating the table while the surfaces stay
   fresh does not satisfy it.

### RLS posture

One new read: `asset_checklist_items`, through `useAssetOpenRequirements`.
Verified against the live database rather than the migrations — RLS enabled,
policies `TO authenticated` only, SELECT scoped to
`organization_id = current_org_id() AND is_active_member_of_current_org()`.
The caller's own client, no RPC, no `SECURITY DEFINER`, no service role,
nothing widened, and nothing in this change writes. `currentOrgId` leads the
query key because the rows are org-scoped server-side.

`decision_requests` and `portfolio_team` are read through
`useAssetWorkAttention`, which the Work surface already uses, with the same
keys. "Yours to answer" is a label derived from the same `portfolio_team`
rows the decide buttons use; the server still refuses a decision the label
gets wrong, and no control in the new blocks resolves a request.

---

## 6. Manual product review (10–15 minutes)

Desktop, `localhost:5190`. Pick a name your org actually holds and has written
on; the demo corpus is largely junk and is not evidence either way.

**A. General review (3 min)**
1. Open any asset from search or the Dashboard.
2. The Overview leads with the firm's view. Under it: one row of actions,
   starting with **Review the case** (or **Start the case** on an unwritten
   name).
3. On a name nobody holds, there is **no** "Where we are exposed" action.
4. If the asset has a process selected, a **Work in progress** block appears
   in the left-hand supporting column, below "What changed", with the open
   requirements and their owners. If it has none, nothing about a process
   appears anywhere.
5. Press **Ask ACT AI**. The pane opens with a drafted question about the
   current view and what has changed — in the composer, unsent.

**B. A pending recommendation (5 min)** — the important one
6. Open the comm pane (the Quick Ideas / Thoughts view) and find the pending
   recommendations list. If it is empty, submit a recommendation on a name
   from the Idea Pipeline first.
7. Click the **ticker** on one of those cards (not the row — the ticker).
8. The asset opens with **The decision in front of you** at the top left, the
   request you clicked highlighted in amber, and the exposure beside it.
9. Check the facts on the row: the action and the book, "Proposed by …",
   "waiting N days", and **Yours to answer** if you are the PM for that book.
10. The written case is **below** the action row, not above the decision.
11. The exposure appears **once** on the page.
12. **Open the recommendation** lands on the decision surface with the real
    controls.
13. Rule on the request, then follow the same link again: the page should be
    the **general** overview, with no decision block — the request is no
    longer waiting.

**C. An assigned requirement (3 min)**
14. Open your own user page and find an open assigned task, or open a process
    run and follow a requirement to its asset.
15. The asset opens with **Work in progress** leading, the requirement you
    followed highlighted, and **Continue the process** as the first action.
16. The counts match the Work surface when you press through to it.

**D. The strip (1 min)**
17. On a name with a request waiting, the sticky header's **Active work** cell
    reads "Awaiting a decision" with the action and book, in amber — not
    "None open". This is the item I would check first; it is the one place
    where the page used to contradict itself.

**E. Context does not leak (2 min)**
18. From step 7's decision workspace, search for the same ticker in the header
    and open it again. The page must be the general overview: no decision
    block, no "You were sent here".
19. Switch organisation with the asset page open. Nothing from the previous
    org's process should appear.

---

## 7. Not verified, and not done

- **No browser.** Nothing above has been seen rendered. Every layout claim is
  from source and from jsdom tests, which assert structure and content, not
  appearance.
- **Mobile is unchanged.** The phone shell renders
  `MobileInvestmentSnapshot`, a different component, which receives no entry
  reason and gained none of these blocks. The desktop blocks stack at narrow
  widths (`grid-cols-1` by default), but the phone asset page composes
  identically for all three entries. Treat the contextual workspace as
  desktop-only for now.
- **`guard:unit` is intermittently red.** `outcomes-detail-mobile` and
  `outcomes-mobile-home` have each failed once this week at ~5.1s timeouts,
  both passing in isolation, neither in a file this work touches. It gates a
  required check. **This pass it was green**: 637 files, 11,074 tests, exit 0,
  both of those suites included. One green run does not fix a flake, and I did
  not change a timeout or an assertion to get it — so the cause is still
  unknown and the next run can still be red on those two files. The honest fix
  is to find out why those two suites take ~5s to reach their first
  assertion, which is its own change.
- **Not every sender carries a reason.** The Dashboard's asset cards, the
  Research and Portfolio lenses and the Ideas lens still open assets with
  `focus` and `origin` only, which resolves to a general entry. That is
  correct for all of them today — a reader sent to read a case is reviewing
  the name — but it means the decision and work compositions are reachable
  from exactly two places each: the recommendations inbox and an explicit
  decision destination; an assigned task and a process run.
- **`DecisionInbox` (the Idea Pipeline's own panel) was left alone.** It is
  2,649 lines of grouped and paired rows, and the brief rules out rebuilding
  it. The comm pane's inbox is the path that was added instead.

## 8. Adjacent problems found, unfixed

1. **`useAssetProcessSummary` keys `['workflow-identity', workflowId]`
   without the organisation.** Same defect class as the one fixed in §5; the
   workflow name is low-harm, but the key is wrong by the same rule.
2. **Two membership tables.** `portfolio_team` and `portfolio_memberships`
   disagree about who may decide. `splitAttention` follows the decision path
   deliberately, so the new block shares its blind spot rather than inventing
   a second answer. Known and deferred.
3. **`capture-draft.test` reproduces Layout's wiring inside the test file**
   rather than rendering it, so it cannot fail when the real wiring changes.
   One claim in it was corrected this session; the file's method is still
   weaker than it reads.
4. **`ai_conversations` has no `organization_id`.** One conversation list
   across every org a user belongs to. Product decision plus a schema change
   under Standing Rule 5; unchanged from the previous handoff.
