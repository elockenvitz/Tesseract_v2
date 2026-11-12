# ACT AI 2.0 and Contextual Asset Workspaces — handoff

Branch `discovery/asset-page-2`, pull request **#291**, head `f1579f7e`.
Written 2026-11-11, extended 2026-11-12.

---

## Read this first

**The initiative is code-complete. It has never been opened in a browser.**
Claude in Chrome failed to connect on nine attempts across three sessions
("Browser extension is not connected"), so the interactive scenarios and the
screenshots you asked for have not been done, and there are none in this
document. The screenshots you shared did not reach the session either, so
nothing here describes anything anyone has looked at.

Everything below that says "verified" names a test, a guard, a build artifact
or a live database query at the point of the claim.

**The manual visual-review checklist you asked for is at the end of this
document.** It is written so that each item can be confirmed or refuted by
looking, in a stated order, with the expected result spelled out.

**It is not deployed and not merged.** No migration exists in this work, so
production is unchanged. Per your instruction, #291 stays unmerged until your
final visual review.

**One check is not green, and it is not this work.** `guard:unit` failed on two
of four runs in the final session — a different test each time
(`outcomes-detail-mobile`, then `outcomes-mobile-home`), both at ~5.1s, both
timeouts, both passing in isolation, neither in a file this work touches.
Earlier runs the same session were fully green at 632 files / 10,980 tests. It
is a load-dependent flake, it is listed as a finding, and it matters because
"Unit tests" is a required check on `main`.

---

## What changed in the second pass

The first pass fixed the naming, the honest-absence model, the briefing and the
grounded suggestions. This pass is about what an answer looks like when it
arrives, and about the asset workspace actually behaving differently in
different situations.

### The pane no longer flashes anything on open

Three separate flashes, all the same defect wearing different clothes: a
surface rendering a **verdict** on a React Query **default**. React Query v5
defines `isLoading` as `isPending && isFetching`, so a query that is *disabled*
reports `isLoading: false` — and "I have not asked yet" becomes
indistinguishable from "the answer is no".

- The generic questions painted and were replaced by the grounded ones.
- The "AI Assistant Not Configured" screen painted on an org that is
  configured, because `isConfigured` falls through to `false` while three
  queries are in flight.
- My own first fix for that returned an empty element, which traded a wrong
  screen for a **blank pane** — correct and worse.

The settled shape: the pane's chrome does not depend on the configuration, so
the header, the context chips and the composer paint immediately and are right.
Only the thread area waits, and the questions arrive with a 10px rise over
300ms rather than appearing. One transition.

### Raw JSON stopped leaking into answers

The envelope parser was running correctly and still missing the block, because
it matched two exact fence tags and the model controls the tag it writes. One
mislabelled fence and the whole evidence/actions payload rendered as prose.

Now a fence is identified by its **shape**: a tagged envelope fence anywhere,
or a terminal fence whose JSON has only envelope keys and carries `evidence` or
`actions`. A mid-answer JSON sample is never the envelope, which my own test
caught when the first version took the *last* fence instead of the terminal
one. A legitimate code block the reader asked for is preserved, which is also
tested.

No regex strips arbitrary JSON, no source attribution is discarded, and no
proposed action executes on its own.

### One evidence section per answer, not two overlapping ones

A response could show three accounts of where it got its information: a
research trail of every lookup, a separate citations list of quoted documents,
and — until the fence fix — a JSON evidence array. The same AAPL decision
record appeared in two of them under two different headings.

Records are now the primary unit, deduplicated across every lookup and
citation. What is deliberately **not** flattened is quoted versus consulted: a
citation says "this sentence rests on these words", a trail entry says "I
looked here", and pooling them would let a list of files the model merely
opened read as support for a specific claim. The old code kept that distinction
by rendering two sections, which is what caused the duplication; it is now kept
per **record**, in one list.

The lookups survive as a quiet provenance line, because they carry the only
honest answer to "did you look and find nothing, or did the lookup fail?". A
failed lookup shows on the **collapsed** header, since collapsed is the default
in the chat pane and a failure is the one thing here that changes what a reader
should believe.

`AiBriefing` was also rendering its own trail beside an `AiMessage` that
already carried the same tool calls — a real double render, now one.

### A status word in a weight column is no longer a weight

The reported case: a weight column holding `3.2%`, `unknown`, `reduced`,
rendered identically.

The old rule made the whole column prose the moment one cell was not a figure,
which was the worst available outcome — the figures stopped lining up **and**
the word still sat exactly where a figure would. A column is now `figures`,
`mixed`, or not a value column; a mixed column still right-aligns so numbers
compare down it, and the words render as quieter labels in proportional
figures.

A column carrying a **sentence** is still prose, which was the original rule's
reason and still holds. A status word never gets a direction tone — "reduced"
is exactly the word that would read as a negative change, and colouring it
would assert a direction the model put no sign on. And the model's own word is
rendered as written: "unknown" is often the only true answer and the renderer
is not entitled to turn it into a dash.

### The answer is the page, not a dense bubble in it

A reply was a filled grey container inset to 85% of the pane. The fill made a
long answer read as a block rather than as something written to be read, and
the inset spent the pane's scarcest dimension on an empty gutter — in a 384px
rail, the most valuable space on screen.

The assistant's turn now sits on the pane's surface at full width in both
modes. The reader's turn keeps the filled bubble, which is what still makes the
alternation legible; removing the fill from both is how a thread becomes one
undifferentiated column, and a test pins that too.

### Headings were within a pixel of the text under them

The weak hierarchy, as a number: h1/h2/h3 ran 15px/14px/13px against a 14px
body. Three levels that are different *kinds* of thing now — 17px, 15px, and a
small uppercase label — and the opening paragraph, where the length contract
puts the judgment, steps up in size and contrast so the answer has a top. Only
a paragraph: an answer that opens with a heading is untouched.

### Answers stopped being written in schema

Replies talked about `decision_requests`, `asset_id` and rows returned. Worse
than unreadable: "0 rows in price_targets" leaves a reader unable to tell
whether nobody has set a target or the assistant could not see them.

Four vocabulary rules now sit in the presentation contract, and the record
vocabulary is **derived** from the same label map the evidence section renders
from. Restating it would let the assistant say "Decision" in its prose while
the source underneath said "PM ruling". The four decision kinds stay four
different words.

The exception is explicit and tested: a reader who asks which field or table
something lives in gets a precise answer, not a translation.

### An old record says how old it is

Four of Workstream C's five distinctions were already honest. The fifth — how
old the record is that an answer leans on — was technically present and
practically invisible: the date rendered in the lightest grey on the row, so a
thesis from March and one from last week scanned identically.

A record past 90 days now states its age in amber beside the exact date, never
instead of it. It does **not** call anything stale: whether age makes a record
wrong depends on the company, and a test asserts the wording never crosses into
a verdict. A recent record is unmarked, because a badge on every row is a badge
nobody reads.

### Generic market questions stopped padding a real list

A reader looking at AAPL with two real pieces of open work was offered those
two and then "What sectors are showing momentum?" to make up the number. The
module's own comment already called the generic tier "a floor, not a tier"; the
code filled to the layout limit with it. Generic questions now appear only when
there is nothing else **at all**.

### The asset workspace state now changes the page

The largest finding of this pass. `STATE_EMPHASIS` described, per situation,
what the Snapshot should lead with. **Nothing read it.** The page composed one
fixed layout and used `workspaceState` for a `data-` attribute and nothing
else, so six situations produced an identical page. Its vocabulary had drifted
too: `conclusion` named a deleted card, `work` named a panel the Snapshot does
not have.

A test iterated that array and asserted every state covered every panel, with a
comment about a panel being "silently dropped off the page" — a consequence
that could not occur, because no page read the value.

The state that was costing you something is **held with no case on record**: the
case panel at the top is empty or nearly so, and the exposure, the only
concrete fact about the name, sat below two other blocks. It now takes the top
row beside the case.

A correction I had to make mid-change, caught by four existing tests: I first
gated the waiting-work queue on `decision-pending`. An idea at
ready-to-recommend is work owed *without* being a pending ruling, so the state
is something else and the only actionable thing on the page vanished. Whether
the queue leads is a question about data; the emphasis decides only what leads
when nothing is owed.

Emphasis reorders and never hides. A panel that loses the lead is still on the
page, lower down.

### Two org-scoped reads were cached without the organization

`get_org_ai_config_summary` and `is_active_org_admin_of_current_org` take no
argument — they resolve the organization server-side — so nothing in the
request distinguished one org from another, and the cache keys did not either.
After switching organizations React Query answered from the previous org's
entry: a BYOK org could read as unconfigured, and the BYOK key editor could be
enabled for somebody who is not an admin of the org they are now in. That last
one is a wrong control rather than a hole; the write is RLS-gated.

Checked and deliberately **not** changed: `ai_conversations` has no
`organization_id` column in the live database, so the conversation list is per
user by construction and its key is right. That a user in two organizations
therefore has one shared conversation list is a product question, listed below.

---

## The thing most worth understanding

The honest-absence problem runs through all of it.

ACT AI can only read what your permissions allow. When a lookup comes back with
nothing, that can mean two completely different things: the firm has no such
records, or you cannot see the ones it has. Saying the first when the second is
true is the worst thing this product can do, because it sounds authoritative
and it is wrong.

Every retrieval tool declares its reach as one of three things: the whole
organization, everything you can see, or only yours. Only an organization-wide
lookup may phrase an absence as a fact about the firm. The others say "nothing
that you have access to" or "none of yours". Both the model's prose and the
panel's own sentences come from the same declaration, so they cannot drift.

A lookup that **failed** says it failed. A failed lookup reported as "no
records found" is a false negative dressed as a finding.

None of this is achieved by widening anyone's access. No `SECURITY DEFINER`
function was added to count hidden rows.

---

## What could break, and what stops it

**A surface rendering a verdict on a query default.** The recurring defect of
this whole initiative, found three times in one pane. Any new gate on an AI
surface must distinguish "not known yet" from "the answer is no", and a
disabled React Query reports `isLoading: false`.

**Two surfaces describing one asset.** The briefing reads the same hook and
cache as the attention band above it, so it adds no database read and cannot
contradict the band. Asserted by object identity, not a matching count.

**A model call you did not ask for.** The press is stored as *which asset* you
pressed on, not as a yes/no. An injected failure exposed why: a React effect
runs *after* the render that changed the asset, and one render is enough for a
lookup to start against the new company.

**An answer retyped as your own.** "Continue in ACT AI" hands over the
*question*, never the briefing's prose. Pasting the answer in would strip its
evidence trail and turn a sourced figure into an unsourced claim.

**A panel promoted rather than moved.** Giving the exposure the top row and
leaving it in its old position would render it twice. Tested.

**One firm's numbers on another firm's screen.** You are a member of two orgs
with materially different numbers. The suggestion facts, the org AI config and
the org-admin flag are now all keyed on the organization.

**Note text quietly stored twice.** Excerpts are shown but never written into
the saved transcript, which is one JSON column under the conversation owner's
policy.

---

## Verification

| What | Result |
|------|--------|
| Types | repo-wide errors **8,577**, at the ceiling; card surfaces **0** |
| Copy guards | em dashes 339 (at ceiling); legacy assistant name **0** |
| AI + communication suites | 34 files, **691 tests**, all passing |
| Asset component suites | 10 files, **155 tests**, all passing |
| Hook suites | 23 files, **228 tests**, all passing |
| Full unit guard | **intermittent** — 632 files / 10,980 passing on two runs; one timeout on each of two other runs, different test each time, both passing alone |
| Browser inspection | **not done** — extension would not connect, nine attempts |

`db (live role-context verification)` fails, pre-existing and expected: it is
fail-closed and the staging credentials do not exist on the free plan, so it
reports UNVERIFIED (exit 3). It is not a required check and this work did not
change it.

### Gates proven non-vacuous

Thirty-one deliberate failures were injected across the initiative, each caught
and reverted. The ones worth singling out are the ones where the gate did
**not** catch it at first, or where it caught something real with nothing
injected:

- A test of the per-asset reset **passed** against a component that reset
  nothing, because it never pressed the button first. Strengthened, it failed —
  and then exposed the real effect-ordering defect.
- The `ai-chat` contract test **passed** three times against a deliberately
  renamed field: once because it searched a 3,500-line file for a field name,
  once because it selected the error payload by position, once because a lazy
  regex swallowed three payloads as one.
- An existing test asserting that generic questions "sort below everything that
  arrived" would have passed for the wrong reason after the padding fix —
  `every` over an empty tail is true. Replaced with the stronger claim.
- **Caught with nothing injected:** the org-scope guard named two unscoped
  reads in `useGroundedPrompts.ts`; the unit guard noticed `src/hooks/ai/__tests__`
  was outside its scope and would have run as zero tests; the type ratchet
  caught two of my own test-fixture mistakes, including one using a field
  `PendingDecisionFacts` does not have; and four existing Snapshot tests caught
  the regression where I gated the waiting-work queue on the workspace state.
- Collapsing `decision_request` into `Recommendation` fails both the prompt
  drift test and the four-kinds test, which is how the derived vocabulary is
  proven to be read from the map rather than copied.

---

## RLS posture

No new table, view, RPC, policy, storage path or migration in either pass. No
policy widened.

Retrieval runs inside the existing `ai-chat` function on a Supabase client
built from your forwarded access token, so your own row-level security applies
to every lookup — asserted by a test, because a service-role client there would
brief one reader on another firm's records.

The one data-path change is a narrowing: `trade_queue_items` and `coverage` in
the suggestion-facts hook filter on `organization_id` explicitly instead of
relying on RLS alone. Consequence worth knowing: 8 of 241 ideas in production
have no organization at all and now drop out of those counts.

This pass added two cache-key changes and one live read of
`information_schema.columns`. No schema was modified; the Management API query
was read-only.

---

## Manual visual-review checklist

Chrome automation was unavailable, so this is the acceptance pass. Work top to
bottom; each item states what to do and what you should see. An item that does
not match is a defect, not a judgment call.

### A. The pane on open (the three flashes)

1. Hard-reload the app, then open the ACT AI pane on an asset. **Expect:** the
   header, the asset chip and the composer appear together and stay. No grey
   box, no empty pane, no "Not Configured" screen at any point.
2. Watch the thread area only. **Expect:** it is empty, then the suggested
   questions rise into place once. They must not appear, change and settle.
3. Reload and open the pane four more times. **Expect:** identical every time.
   A flash that appears on one in five is still the defect.
4. Open the pane on an org with **no** BYOK key configured. **Expect:** the
   "Not Configured" screen, and only after a beat — never during the first
   paint of a configured org.

### B. The suggested questions

5. Read the questions. **Expect:** each one names something real, with a reason
   under it ("4 in your decision inbox, the longest for 9 days"). No "What
   sectors are showing momentum?" sitting beside a grounded question.
6. Find an asset where you have no open work at all. **Expect:** exactly three
   generic questions, or three subject questions — not one, and not a full
   grid padded out.
7. Move the cursor over the list and wait ten seconds. **Expect:** nothing
   reorders.

### C. An answer's shape

8. Ask something that produces a long answer with headings. **Expect:** the
   first paragraph is visibly larger and darker than the body. Headings are
   clearly larger than the text under them, and the smallest level is a small
   uppercase grey label.
9. **Expect:** the answer is not in a grey box and runs the full width of the
   pane. Your own question above it **is** in a filled blue bubble, inset from
   the right.
10. Expand to research mode. **Expect:** the same, centred in a reading column.
    Your draft, scroll position and open evidence section survive the flip.

### D. Raw JSON and code

11. Ask a question likely to produce a suggested action ("what should I do
    about the AAPL recommendation?"). **Expect:** no `{`, no `"evidence":`, no
    `tesseract-actions`, no JSON of any kind in the prose.
12. Ask explicitly for code ("write me a SQL query that lists my open
    recommendations"). **Expect:** a real code block with a Copy button,
    preserved in full.

### E. Tables

13. Ask for a comparison across three or more holdings ("compare the weights of
    my three largest positions"). **Expect:** figure columns right-aligned, in
    tabular figures so the decimal points line up down the column.
14. Find or provoke a table where one cell is a word in a column of numbers
    ("what is our weight in each of these five names", where some are not
    held). **Expect:** the numbers right-aligned and dark; the words
    right-aligned but smaller and grey. The word is **not** coloured red or
    green, whatever it says.
15. **Expect:** a `+4.2%` is green and a `-1.2%` is red, but a plain `25.3%`
    weight is neither.

### F. Evidence

16. On any answer that consulted records, open the evidence section. **Expect:**
    one section, headed "N sources". Not two sections, and not "Research (N)".
17. **Expect:** each row appears **once**, with a label saying whether it was
    quoted or consulted. A record both quoted and looked up appears once, as
    quoted.
18. Find an answer that leans on something old. **Expect:** "8 months old" in
    amber beside the date, and the exact date still visible. A recent record has
    no age badge.
19. Provoke a failed lookup if you can (ask about a portfolio you cannot see).
    **Expect:** with the section **collapsed**, a visible warning that a lookup
    failed. Expanded, it names which one.
20. Click a source. **Expect:** it opens that specific record on the right asset
    page, at the right section.

### G. Vocabulary

21. Read any answer about decisions. **Expect:** "PM ruling", "recommendation",
    "committed trade", "requirement" — never `decision_requests`, `asset_id`,
    "rows", "null" or "0 results".
22. Ask "which table are price targets stored in?". **Expect:** a precise
    technical answer. The rule is not a gag.
23. Ask about something with nothing on record. **Expect:** "no price target has
    been set", not "the field is null".

### H. The asset workspace

24. Open an asset that is **held with no written case**. **Expect:** the
    exposure and valuation block sits at the top of the Overview, beside the
    (near-empty) "Our view", and appears **once** on the page.
25. Open an asset that is **held with a written case**. **Expect:** "Our view"
    takes the top row alone, and the exposure is lower down where it always was.
26. Open an asset with a **waiting decision**. **Expect:** the "Needs a
    decision" queue at the top beside the view, as before.
27. Open an asset with an idea at **ready-to-recommend** but no formal
    recommendation. **Expect:** the queue still appears. This is the regression
    I introduced and reverted; it is the one item on this list most worth
    checking by hand.
28. Open an asset **not held and not covered**. **Expect:** no block promoted to
    the top row; no empty exposure panel given the page's most prominent slot.

### I. The briefing

29. On an asset with a waiting decision. **Expect:** heading "Decision
    preparation", and a line saying what it will do, before anything runs.
30. Press it. **Expect:** one run, the working row with no grey box, then an
    answer that names the specific signals the attention band above is already
    showing.
31. **Expect:** the briefing's evidence section is open, and appears once —
    there is no second trail under it.
32. Navigate to another asset and back. **Expect:** the button is offered again
    rather than a model call running on arrival.
33. Press "Continue in ACT AI". **Expect:** the pane opens on that asset with a
    *question* in the composer, unsent and editable. Not the briefing's prose,
    and nothing sent on your behalf.

### J. Org switching

34. Note whether the AI pane shows as configured. Switch to your other
    organization. **Expect:** the pane re-resolves. A BYOK org and a non-BYOK
    org must not show each other's state.
35. In the org where you are **not** an admin, open the AI settings. **Expect:**
    the BYOK key editor is not enabled.
36. **Expect:** the suggested questions quote the new org's counts, not the
    previous org's.

---

## What is left

1. **Work the checklist above.** This is the only outstanding acceptance work.
2. **Decide on the flaky suites** before merging, because "Unit tests" is a
   required check. Two mobile outcomes test files time out under load and pass
   alone.
3. **Merge #291** once you have looked.
4. **Confirm the deploy.** Netlify posts no production status, so check by
   fetching the site and grepping the bundle for a new string.

Nothing here is blocked on a decision from you.

---

## Adjacent problems found, left unfixed

In rough order of how likely they are to bite:

1. **Two unit test files time out under load** — `outcomes-detail-mobile` and
   `outcomes-mobile-home`, ~5.1s each, passing in isolation. Same class as
   `automation-rpc-authority.test.ts` earlier in the initiative. This gates a
   required check and is the most urgent item on this list.
2. **`price_targets` vs `analyst_price_targets`** remains an orphan trap for
   anything new that reads price targets.
3. **Two disagreeing portfolio-membership tables** — a collaborator added in the
   UI is invisible to half the app. Previously deferred on purpose.
4. **One conversation list across two organizations.** `ai_conversations` has no
   `organization_id` in the live database. A user in two orgs sees one list, and
   a conversation bound to an asset in one org appears while working in the
   other. Not changed here because it is a product decision and a schema change,
   and Standing Rule 5 would require ownership, policies and an isolation test
   in the same change.
5. **Overview and ACT AI can report different trade counts** for the same asset.
   They count different records in the decision chain. Neither is wrong;
   nothing reconciles them.
6. **`coveringUserIds` is rebuilt inline at three call sites**, so the attention
   memo recomputes every render. Pre-existing pattern, copied rather than
   introduced.
7. **Two shapes of the same `is-org-admin` question.** `useAIConfig` keys it
   `['is-org-admin', orgId]`; `PortfoliosListPage` keys it
   `['is-org-admin', orgId, userId]` and may call a different RPC. Two cache
   entries for one fact. Harmless today.
8. **Dead imports in `gallery/lists.tsx`** still break vite's dependency
   pre-scan.
9. **The `DOM_HINT` heuristic in `vitest.config.ts`** routes a test file to
   jsdom based on words in its *prose comments*. It mis-routed files in this
   work and the fix each time was to reword a comment.
10. **Pre-existing unused-variable warnings** in `InvestmentSnapshot.tsx` and
    `AISection.tsx`, inside the 8,577 ceiling.
11. **The parked Work-mode redesign** still needs a decision. Deliberately not
    absorbed.
