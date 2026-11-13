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

**It is not deployed and not merged.** Per your instruction, #291 stays
unmerged until your final visual review.

**One migration HAS been applied to production**, with your approval:
`20261112120000_ai_project_folders.sql`, additive only -- one new table and
one nullable column. Nothing existing was altered or dropped. See the 2.1 RLS
posture below and the recapture commit for the policy inventory diff, which
moved by exactly that one table.

**The flake named in the earlier passes has a cause and a fix.**
`guard:unit` failed intermittently on `outcomes-detail-mobile` and
`outcomes-mobile-home`, always on a timeout, always passing alone. It was
memory: with `maxWorkers` unset, vitest opened about sixteen jsdom
environments on a machine with 3.9GB free and the heaviest page mounts were
the victims. `vitest.config.ts` now caps it at 8. No assertion and no timeout
was changed, and the full guard has since run green at 653 files / 11,284
tests.

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

## ACT AI 2.1 — conversation management, references and artifacts

Commits `2b0210b5`, `be75d866`, `4c47b628`. Everything below writes through an
existing audited path; the only schema change is one additive table.

### Project folders, and a way back from the archive

A reader with forty threads had one flat list. There are now lightweight
folders: `ai_project_folders`, private per reader and checked against live org
membership on every verb. They do not compete with Tesseract Projects -- a
folder holds conversations and nothing else, and a conversation has exactly
one home.

Archiving became a round trip. The sidebar's query filters archived threads
out, so archiving was a one-way door in practice; there is now an archived
disclosure that lists them and restores one. "Not asked yet" and "nothing
there" are kept apart, so an empty archive says so rather than looking
unloaded.

RLS: four per-verb policies, each `user_id = auth.uid() AND
is_member_of_org(organization_id)`, anon revoked, writes to `authenticated`
only. A child guard is a `SECURITY DEFINER` trigger raising 42501 rather than
a policy subquery, because a policy subquery runs under the caller's own RLS
and would have read as a pass. 12 assertions in
`supabase/tests/ai-project-folders-authorization.sql`, run against production
inside self-rolling-back transactions: cross-user, cross-org, removed-member
and filing-on-behalf-of-another-user all denied, legitimate same-org use
allowed. Two injections proved the suite non-vacuous; a post-check showed zero
residue.

### A conversation's sources became something you can change

ACT AI's sources are the conversation's tags -- the `ai-chat` function reads
`ai_conversation_tags` to decide which documents to load -- and a reader could
see them and not add one. `AiContextAttach` writes a **typed** reference: a
type and an id from a record the search could read, never the words in the
box. Candidates come from `useEntitySearch`, which reads under the caller's
own RLS, so a reader can only attach what they can already open. The
attachment is not a grant.

Three kinds of context stay apart on screen: **attached** (the reader chose
it, solid, removable), **inherited** (the page the pane was opened from,
dashed, and it says where it came from) and **mentioned** -- a name in the
prose, deliberately NOT a chip, because inferring a reference from text is how
a conversation about Apple's suppliers acquires AAPL as a source nobody gave
it. Only assets, portfolios, themes and notes are offered, because those four
are what the tag table's CHECK accepts.

### Keeping an answer, and the wire that was never connected

"Keep" on an answer opens the canonical quick-thought form with the text
already in it, as a thought, a research note or a thesis draft. It writes
nothing: the reader edits and saves with the same component, the same
validation and the same server-side org stamping as a note typed from
scratch. The confirmation says who wrote the text, that nothing is saved yet,
and that it is not a decision or an audit record -- and it discloses a
truncated answer as ending mid thought.

An artifact is deliberately **not** a new table. The answer is already durable
in the conversation's own `messages` column, and a second copy would be two
versions of one sentence with no rule about which is true.

Making that real meant connecting a wire that had never been connected.
`openThoughtsCapture` has carried a `prefillText` field since the action
catalogue was written and nothing ever read it: the shell's listener
destructured four fields and dropped the rest, so `create_prompt` had been
losing its text for as long as it existed. `lib/capture/prefill` is that wire,
as a parser rather than a cast, and it honours a prefill only for the one form
that has initial-value props -- a prefill aimed at the prompt, trade-idea or
recommendation form is dropped here rather than ignored at the far end. It
also refuses a draft with no provenance.

### 2.1 non-vacuity

| Injected | Caught by |
| --- | --- |
| Folder policy widened to the org | the cross-user read assertion |
| Child guard removed | cross-user filing denied |
| Search gate relaxed to one character | "asks for nothing until there is something to search for" |
| Tag built from the typed text | "attaches the typed object the search returned" |
| Form's prefill props dropped | 2 cases in the handoff suite |
| One-shot read at render time | the same 2 cases |
| Reset dropped from `handleOpenCapture` | the two-requests-in-a-session case, which was ADDED because the first version of that suite passed with the defect in place |

### 2.1 RLS posture

- `ai_project_folders`: new, owner-scoped, four verbs, anon revoked, isolation
  test above. `ai_conversations.folder_id` is additive and nullable with
  `ON DELETE SET NULL`.
- Attachment: **unchanged.** No new table, policy or grant; writes go through
  the existing `addTag`/`removeTag` path on `ai_conversation_tags`.
- Promotion: **unchanged.** No migration. The record is written by
  `QuickThoughtCapture` into `quick_thoughts`, whose `organization_id` is set
  by its BEFORE INSERT trigger from `current_org_id()` and never by the
  client.

### The 2.1 walkthrough (about 8 minutes, in this order)

Desktop, `localhost:5190`. Use a name your org actually holds and has written
on; the demo corpus is junk and is not evidence either way.

1. **Folders.** Open ACT AI in research mode so the sidebar is beside the
   thread. Press `+` on the rail, name a folder, and watch the counts. Try to
   name a second one the same thing: it should refuse with a sentence, not a
   silent no-op. Move a conversation into it from the row's own menu, then
   "Remove from folder" and confirm it returns to Unfiled.
2. **Archive and back.** Archive a thread. It leaves the list. Open the
   archived disclosure, restore it, confirm it comes back where it was. Then
   delete one and read the confirmation before pressing it.
3. **Attach a source.** With a thread open, press "Add context" and type two
   characters of a portfolio you can open. Attach it. The chip should be solid
   (you chose it) while the chip that came from the page is dashed. Hover each
   one and read the title. Ask a question that needs that portfolio and check
   the answer's evidence names it.
4. **Keep an answer.** Hover an answer, press "Keep", choose "Keep as a
   research note". Read the dialog -- it should say a model wrote it and that
   it is not a decision record -- then press "Open the draft". The capture
   pane should open with the text in it. **Check the source line on the form**:
   it should name ACT AI and the thread. Save it, then find it in Recent
   thoughts and confirm the provenance survived.
5. **The negative case.** Press Cancel on that dialog instead, then open Quick
   thought by hand. It must be empty. A promoted paragraph turning up in an
   unrelated capture is the defect the handoff suite pins.

### ~~One hop not covered by a test~~ — closed

~~`Layout`'s listener handing the parsed capture request to the store. Five
lines between two tested ends; mounting `Layout` costs more than it proves, so
it is read rather than asserted.~~

Closed by `150fdeb7`. `capture-open-listener.test.tsx` mounts the real
`Layout` with the real `useSidebarStore` and the real parser and dispatches
the actual event; the judgement that mounting Layout "costs more than it
proves" was wrong, and `navigate-out-of-pane.test.tsx` had already shown how
cheap it is. The same commit closed the other read-not-asserted hop by moving
`AssetTab`'s arrival code into `useArrivalOrientation` and
`ArrivalOrientationBand`, and found a defect doing it: a second open of the
same name with no event behind it left the previous orientation on screen.

---

## ACT AI 2.1 — the last two gaps (`96c85d94`)

### All four typed references lead somewhere

`lib/ai/reference-targets` holds the destination for each kind, and none is
invented — every descriptor is the one an existing surface already dispatches:

| Reference | Destination | Taken from |
| --- | --- | --- |
| asset | `openAsset` | `lib/desktop-asset/navigate`, the one contract |
| portfolio | `{ type: 'portfolio', data: { id, name } }` | `PortfolioCommandCenter` |
| theme | `{ type: 'theme', data: <row> }` | what `ThemeTab` takes |
| note | `{ id: 'note-<entity>-<entityId>', data: { id, entityType, … } }` | `NotesListPage` |

The note is the awkward one. Its id does not say which of four tables holds
it, the editor is chosen by which entity owns the note, and the tab id is
built from that entity — so the note is looked up. `custom_notebook_notes` is
deliberately **not** resolved: the shell's note tab renders asset, portfolio
and theme notes, so a notebook reference has no destination and stays as text
rather than becoming a link to a tab reading "Note data not available".

**Permission and staleness are one mechanism, not two.**
`useReferenceTargets` reads the objects through the caller's own RLS. A row
that comes back is one they may open; a row that does not is deleted or no
longer theirs, which from here is the same answer. A chip is a link exactly
when its object resolved, and the three states are drawn honestly:

- `open` — a link
- `checking` — text, title says the object is being checked
- `gone` — struck through, title says it is no longer available **and that it
  was part of this conversation**. The chip is not hidden: the thread really
  was about that object, and dropping it would rewrite what the reader asked.

This replaced the per-TYPE `openable` predicate with a per-OBJECT status. One
existing test case asserted the opposite claim — that a portfolio chip must be
text — and was rewritten with a note saying why it was right before.

### Archived conversations can be found

Archiving was reversible only in principle. The search box, the folder rail
and the reference chips filtered the live list; the archive honoured none of
them and was fetched only on manual disclosure. A reader who archived "NVDA
supply chain" and later typed NVDA saw an empty list and a collapsed row that
could not even show a count, because nothing had been loaded to count.

`lib/ai/conversation-filter` is now the one filter both lists use. Four
behaviours follow from that:

1. Typing **loads** the archive, and **opens** it when the live list has
   nothing and the archive has something — otherwise the reader has to
   already suspect the thread is archived in order to look for it there.
2. Archived rows are decorated with their references, and the chip row is
   built across both lists: a reference carried only by archived threads
   previously had no chip to press.
3. The empty line names the criterion ("No archived conversation matches
   Tesla.") rather than claiming the archive is empty.
4. The count reads "(2 of 3)" when something is filtering.

No message-body search and no new backend. Titles only, which is what the
list has loaded and what the reader sees.

### Non-vacuity, 2.1's last pass

| Injection | Result |
| --- | --- |
| archive ignores the filters again | 9 of 19 fail |
| a missing `folder_id` counts as a match | 1 of 27 fails, **after** adding the absent-key case |
| report every reference as followable | 4 of 8 fail |
| open the tag instead of the resolved object | 4 of 8 fail |

The second is worth naming. The injection initially caught **nothing**,
because every fixture row carried `folder_id` explicitly. An absent key is
what a partial select or a cached older row gives you, and a thread of unknown
filing must not appear on a shelf. The case was added, and then the injection
failed.

### RLS posture, 2.1's last pass

Reads only. No new table, column, policy, grant or RPC. The reads
`useReferenceTargets` makes all go through existing paths: `assets` (global
reference data by design), `portfolios` (its own permission predicate),
`org_themes_v` (the org-scoped view the entity search already uses), and
`asset_notes` / `portfolio_notes` / `theme_notes`, each filtered to
`is_deleted <> true` so a trashed note reads as gone rather than as
unreadable.

Folder persistence was verified against **production**, not inferred:
`ai_project_folders` exists with RLS enabled and four policies, zero anon
policies, `has_table_privilege('anon', …, 'SELECT')` false, the
`ai_conversations_folder_own` trigger present, and the folder FK is
`ON DELETE SET NULL` — so "delete the shelf, keep the threads" is what the
database actually does.

---

## Final product review — 15 minutes

Branch `discovery/asset-page-2`, PR **#291**. Nothing in this initiative has
been opened in a browser; this is the whole acceptance path.

### Final state

| Gate | Result |
| --- | --- |
| `guard:unit` | **PASS** — 661 files, 11,414 tests |
| `guard:types` | **PASS** — 8,579 / 8,579, card surfaces 0 |
| `guard:copy` | **PASS** — 2,383 files scanned |
| `guard:tdz` | **PASS** |
| `npm run build` | succeeds, ~50s |
| PR #291 required checks | Unit tests, Card layout, Type check (cards), Invite entry, static |
| `db (live role-context verification)` | red, **not required** — the known staging blocker (free plan, account-wide PAT) |

### 1. The AAPL contextual workspace (4 minutes)

From the Dashboard, find a target-reached item for AAPL and press it. The
work pane opens on that **event**, not on the name.

Expect, in this order:

1. A band with a **blue left edge**, not a filled panel. Eyebrow, then one
   sentence: AAPL has reached the target you set for it.
2. Immediately under it, the comparison — the **target you stated**, the
   **mark the book carries**, and the overshoot between them. These are two
   different measurements and the band says which is which.
3. A line giving the **age of the case**, so a target set in March reads
   differently from one set last week.
4. Everything else behind one disclosure labelled with what is inside
   ("Scenarios, the case, exposure and the waiting request"), **closed on
   arrival**. Open it: the ladder, the exposure line, any waiting request,
   and three follow-up questions for ACT AI.
5. The working surface below it must be **visible without scrolling**. If the
   band pushes the work below the fold, that is the defect it was rewritten
   to fix.

Now press **"Review the case"** in the band. You land on the canonical Asset
page, and the **same band is at the top of the page content**, scrolling away
rather than pinned. It should say the same thing it said in the pane.

Then open AAPL again from the **header search box**. The band must be
**gone** — you arrived by typing a name, and there is no event to report.
That is the defect found and fixed in `150fdeb7`, and it is the single most
important thing to confirm by eye.

Finally, press the band's **"Ask ACT AI"** question. The pane opens with the
question seeded and the headline you pressed carried as the issue.

### 2. Project folders (3 minutes)

1. Expand ACT AI to research mode. Press **New folder**, name it "Earnings
   season". Make a second, "IC prep".
2. Try to make a third called **"earnings  season"** (different case, double
   space). It must be refused with a sentence, not a database error.
3. Open the row menu on three conversations and **move** them into folders.
   Select a folder in the rail: the list scopes to it and the count beside
   the folder matches what you see.
4. **Reload the page.** The folders and their contents must come back. This
   is the one thing code cannot prove.
5. **Delete** a folder holding conversations. Read the confirmation before
   pressing it: it must say the conversations are kept and become unfiled,
   and name how many. Press it, then check the threads are still there.
6. **Archive** a folder, open "Archived folders", **restore** it.

### 3. Typed object references (4 minutes)

With a thread open, press **Add context** and type two characters of each of:
an asset, a portfolio, a theme, and a note.

1. Attach all four. The ones you chose are **solid**; one that came from the
   page you opened ACT AI from is **dashed**. Hover each and read the title.
2. **Press each chip in turn.** All four must open the real object: the Asset
   page, the Portfolio tab, the Theme tab, and the note in the tab its entity
   shares. This is the gap closed in `96c85d94` — before it, only the asset
   chip went anywhere.
3. **Come back to ACT AI after each one.** The conversation must still be
   open with everything you typed still in the composer. Navigating to an
   object must not cost you the thread.
4. If you have a reference to something since deleted, its chip should be
   **struck through** and its title should say it is no longer available and
   that it was part of this conversation. It must not be a link.
5. Ask a question that needs the portfolio you attached, and check the
   answer's evidence names it. Attaching changes what ACT AI actually reads.

### 4. Keep to research, and the archive (4 minutes)

1. Hover an answer, press **Keep**, choose **Keep as a research note**. Read
   the dialog: it must say a model wrote it and that it is a draft, not a
   decision or an audit record.
2. Press **Open the draft**. The capture pane opens with the text in it, and
   the **source line names ACT AI and the thread**. Save it, then find it in
   Recent thoughts and confirm the provenance survived.
3. The negative case: press **Cancel** instead, then open Quick thought by
   hand. It must be **empty**. A promoted paragraph turning up in an
   unrelated capture is the defect the handoff suite pins.
4. **Archive** a conversation with a distinctive title. Then type that title
   into the search box. The archive should **load and open itself**, and the
   thread should be there — with the toggle reading "(1 of N)".
5. Select a folder, then look at the archive: it shows only the archived
   threads on that shelf, and the empty line names the folder rather than
   claiming the archive is empty.
6. **Restore** it from the archive and confirm the same search term now finds
   it in the live list.

### Remaining unverified behaviour

Everything above. In the code, two things are reasoned rather than asserted:

1. **The final write in the Keep path.** The record is created by
   `QuickThoughtCapture`'s own audited mutation, which has its own tests;
   what is tested here is the chain up to the form's props, not a database
   round trip. Step 4.2 is the test.
2. **Netlify production deploy.** No production status is posted; confirm by
   fetching the site and grepping the bundle.

---

## What is left

1. **Work the checklist above.** This is the only outstanding acceptance work.
2. ~~**Decide on the flaky suites**~~ — settled. `vitest.config.ts` caps
   `maxWorkers` at 8 (the cause was memory, not the assertions) and the full
   `guard:unit` has since run green three times, most recently at 661 files /
   11,414 tests.
3. **Merge #291** once you have looked.
4. **Confirm the deploy.** Netlify posts no production status, so check by
   fetching the site and grepping the bundle for a new string.

Nothing here is blocked on a decision from you.

### Known incomplete, by choice

1. **No message-body search.** Conversation search is titles only, over the
   most recent 200 threads per list. Searching transcripts needs a text index
   or a column that does not exist; doing it client-side would be a search
   that quietly stops at an arbitrary line.
2. **A notebook note reference is not followable.** The shell has no
   destination for one. See above.
3. **No standalone AI artifacts.** The answer is already durable in
   `ai_conversations.messages`; a second copy would be two versions of one
   sentence. Keeping promotes into the audited capture form instead.
4. **`openScenarios` has no distinct destination on the canonical page**, so
   the band draws one case control there and two in the Dashboard pane.

---

## Adjacent problems found, left unfixed

In rough order of how likely they are to bite:

1. **Two legacy tests assert against source text**, not behaviour:
   `quick-ideas-chrome.test.tsx` and `capture-draft.test.tsx` read
   `Layout.tsx` and `ThoughtsSection.tsx` with `readFileSync` and match
   strings. They cover different features (mobile pane chrome, the capture
   tracker), but they cannot fail when the real wiring changes — which is the
   exact failure mode that let the capture prefill go unread for months.
2. ~~**Two unit test files time out under load**~~ — settled; see "What is
   left" above.
3. **`price_targets` vs `analyst_price_targets`** remains an orphan trap for
   anything new that reads price targets.
4. **Two disagreeing portfolio-membership tables** — a collaborator added in the
   UI is invisible to half the app. Previously deferred on purpose.
5. **One conversation list across two organizations.** `ai_conversations` has no
   `organization_id` in the live database. A user in two orgs sees one list, and
   a conversation bound to an asset in one org appears while working in the
   other. Not changed here because it is a product decision and a schema change,
   and Standing Rule 5 would require ownership, policies and an isolation test
   in the same change.
6. **Overview and ACT AI can report different trade counts** for the same asset.
   They count different records in the decision chain. Neither is wrong;
   nothing reconciles them.
7. **`coveringUserIds` is rebuilt inline at three call sites**, so the attention
   memo recomputes every render. Pre-existing pattern, copied rather than
   introduced.
8. **Two shapes of the same `is-org-admin` question.** `useAIConfig` keys it
   `['is-org-admin', orgId]`; `PortfoliosListPage` keys it
   `['is-org-admin', orgId, userId]` and may call a different RPC. Two cache
   entries for one fact. Harmless today.
9. **Dead imports in `gallery/lists.tsx`** still break vite's dependency
   pre-scan.
10. **The `DOM_HINT` heuristic in `vitest.config.ts`** routes a test file to
   jsdom based on words in its *prose comments*. It mis-routed files in this
   work and the fix each time was to reword a comment.
11. **Pre-existing unused-variable warnings** in `InvestmentSnapshot.tsx` and
    `AISection.tsx`, inside the 8,579 ceiling.
12. **The parked Work-mode redesign** still needs a decision. Deliberately not
    absorbed.

---
---

# ACT AI 2.2 — composer, organization, artifacts, intelligence, dot commands

Nine of the ten mandated steps are done and pushed. One step is blocked on a
decision only you can make, and it is named below with what it is blocked on.

**Nothing has been merged or deployed.** PR #291 is still open and unmerged,
and this branch is not deployed. The visual review is yours.

**I have not opened any of this in a browser.** The Chrome extension was not
connected; I tried once and stopped, per the standing instruction. Every claim
below is either a test artifact or a reading of the code, and where that is
not enough to know something, it says so. The checklist at the end is the part
only you can do.

---

## 1. The written case is rendered, not printed (`e7747dd6`)

**What you saw.** In the AAPL workspace, a risk read as
`**iPhone weakness**` — asterisks and all. Same for `**Regulation**`,
`**Innovation risk**`, `**Per-user monetization**`. The text was stored with
Markdown emphasis and the pane was printing the characters.

**What changed.** The pane now renders through `SmartInputRenderer`, the same
safe renderer every other research surface already used. It emits React
elements with string children only, so there is no path for stored HTML to
execute: markup in the content is shown as characters, deliberately.

The reading width was also wrong. The case was set to `max-w-[74ch]`, which
in a work pane reads as a narrow strip down the left of a wide panel. It is
now 90ch, roughly 700px, and defined once as `CASE_MEASURE` so the read and
supporting-detail blocks cannot drift apart.

A density option was added to the shared renderer — `reading` for the case
body, `compact` everywhere else. The defaults keep every existing caller's
classes byte-identical, so nothing else on the renderer moved.

**What could break.** This is the renderer the rest of the app uses, so the
risk is not in the rendering — it is that a case written with an accidental
asterisk now shows emphasis instead of the asterisk. That is the correct
behaviour and the same behaviour notes already have.

**One thing I had wrong and corrected.** This file's own header said
"PARKED / EXPERIMENTAL — not reachable… Nothing renders this today." That was
stale. `DashboardNext.tsx:624` → `IdeasWorkPane` mounts it: it is parked as a
*page* and live as a *pane*. Believing the header cost me a wrong conclusion
about which file to fix. The header now says both things.

---

## 2. A control is called what it says (`38e6125b`)

**What you saw.** Literal `svg3 sources svg`, `svgKeep`, `svgCopy` in the UI.

**What changed.** Every icon inside a labelled control is now
`aria-hidden="true"`, and the evidence toggle's failed-lookup warning moved
out of the button and became a labelled image, so pressing the toggle no
longer reads the warning as part of its own name.

**Being straight about this one.** `aria-hidden` on a decorative glyph is
correct markup and it is now correct in all three places. But it is **not** a
verified account of what produced your capture, and I will not claim it is:
jsdom's name computation already ignored a bare `<svg>`, so the tests I wrote
pass both before and after the fix. Something else — most likely an icon
library rendering a text fallback — may be the real cause. **This is the
first thing to look at in the browser**, and if the literals are still there,
that is the lead.

---

## 3. One composer, and a Stop that exists while it matters (`e0a8a849`)

**What changed.** The composer is one component. It grows with the text to a
220px ceiling and then scrolls; Enter sends, Shift+Enter makes a newline; Send
is disabled on empty or whitespace-only input.

**The real defect it fixed.** There was no Stop control mid-stream at all.
The thread's Stop disappeared as soon as prose started arriving, which is
exactly when you want it. The composer's button now becomes Stop while a
response is streaming, and it is wired to the existing `cancelGeneration` —
not a decorative button.

---

## 4. A conversation can be opened without a mouse (`54baa3cf`)

**What changed.** The conversation title was a `div` with a click handler on
an ancestor: the primary action in the list was mouse-only while all five
secondary actions (rename, pin, archive, delete, move) were keyboard
reachable. It is now a real button with `aria-current` on the active thread.
The tag count became a labelled image naming which objects are attached, and
the action group reveals on focus as well as hover, so tabbing to a control
does not leave it invisible.

---

## 5. Add Context and object chips — verified, not rebuilt

Delivered in 2.1 (`be75d866`, `96c85d94`) and left alone. The attach control
writes the conversation's tags, which is the canonical input the server reads;
all four typed reference kinds lead somewhere; an unreachable reference says
so rather than vanishing. I re-read the path and its suites rather than
rebuilding it, which is what "do not restart features that are already
implemented" asks for.

---

## 6. Independent artifacts — AUTHORED, NOT APPLIED. **Needs your decision.**

`supabase/migrations/20261113120000_ai_artifacts.sql`, its rollback, and
`supabase/tests/ai-artifacts-authorization.sql` are committed (`da7b63ca`).
**The migration has not been applied and the test has not been run.** There is
no UI shipped against it, deliberately: UI against an unapplied migration is a
feature that works in a test and 500s for you.

**What it is.** A pointer table — `user_id`, `organization_id`,
`conversation_id`, `message_id`, `title`. **No content column.** The answer
text stays in `ai_conversations.messages`, because this codebase has already
decided twice that a second copy of an answer is two versions of one sentence
(see "Known incomplete, by choice" above, and `src/lib/ai/artifacts.ts`).

**The decision you have to make, and why I could not make it.**
`ai_conversations` has **no `organization_id`** in the live database — that is
deliberate and recorded. But Standing Rule 5 requires every new
org-owned entity to carry a stable `organization_id` with tenant-scoped
policies and an isolation test. So an artifacts table pointing at a
conversation is either:

- **org-scoped** (what I authored): correct by Rule 5, but it can point at a
  conversation that is not org-scoped, so an artifact and its conversation can
  disagree about which org they belong to; or
- **user-scoped like its parent**: consistent, but a new entity outside the
  tenant model, which Rule 5 forbids shipping.

I authored the first and added a `SECURITY DEFINER` trigger that refuses an
artifact whose conversation is not the caller's own (raises 42501, EXECUTE
revoked from `PUBLIC`, `anon` and `authenticated`), which closes the
cross-user hole but not the org-disagreement one. Four named policies, each
`USING (user_id = auth.uid() AND is_member_of_org(organization_id))`, `anon`
revoked. The 12-assertion test names its two required injections in its own
header.

**It needs your approval to apply, and the org question answered first.** The
honest third option is to give `ai_conversations` an `organization_id` and fix
the root, which is a bigger change than this initiative should absorb.

---

## 7. A three-part question does not get a one-paragraph answer (`92a3b012`)

**What you saw.** The real LRCX conversation: "Let's analyze LRCX, come up
with what the market is thinking about it and where we are with it in our
process", then "What about in general, come up with a bear and bull case for
it." Both got one short paragraph.

**Why.** `resolveResponsePolicy` routed both to `brief` (700 output tokens).
Neither matched a depth pattern, so both fell to the default.

**What changed.** Two shape rules, after the vocabulary rules and before the
default: a **paired** request (bear/bull, pros and cons, both sides, for and
against, upside and downside, risks and opportunities, best and worst case)
and a **multi-part** request (three or more asks in one message) now resolve
to `standard` (1200). No new verbosity was added, so the edge function's
directive text is unchanged, the `prompt-drift` guard still passes, and **no
function deploy is needed**.

**What it does not do.** It does not make the model invent figures. The
retrieval path and the provenance rule are untouched.

---

## 8. Tesseract's dot commands, in chat (`25588b42`)

The editor defines the commands once, in `DotCommandSuggestionExtension`,
which cannot be imported into the chat bundle — it pulls in TipTap,
ProseMirror, tippy and a React DOM root. So chat **classifies** them by id
rather than redefining them, and a drift test reads the extension's source and
fails if an id exists there with no classification. Same arrangement as
`prompt-drift` and the edge function, for the same reason.

**Seven work.** The six data commands become the question they mean —
`.price.LRCX` becomes "What is the current price of LRCX?" — which the model
answers with its own lookup, so the figure arrives with a source attached
rather than being composed by the client. Templates expand to their stored
body. `.help` lists this set, not the editor's.

**Twenty-four are declined by name, with the reason shown to you.** A chart
needs a ProseMirror node and chat has no renderer for one, so
`.chart.price.AAPL` says charts work in a note or research editor. It does not
draw a degraded chart, show an empty box, or do nothing.

**Nothing is sent.** Every command resolves to text in the composer, under
your hands, and you press Send.

**One regression this found and fixed.** `useTemplates` resolves its org
through `useOrganization`, which *throws* outside its provider rather than
returning null, so the pane gained its first hard dependency on
`OrganizationProvider`. Production always has one (`App.tsx:124` wraps the
routes), so there is no user-facing breakage — but three existing suites
mounted the pane bare and went red. They now stub `useTemplates` alongside the
four hooks they already stub.

---

## 9. What 2.2 costs per request (`07e42f18`)

One thing in this initiative spends tokens: step 7's tier change. Everything
else is presentation and sends what it always sent.

Over a corpus of seventeen real-shaped questions, weighted toward short ones
because that is what a chat pane receives:

| count | ceiling | tier | why |
|---|---|---|---|
| 12 | 700 | brief | default |
| 3 | 1200 | standard | paired-case-request |
| 1 | 1200 | standard | multi-part-request |
| 1 | 4096 | deep | explicit-depth-request |

**Mean ceiling 1017, against 900 before 2.2. +117, about 13%.** That is the
whole token delta, and it buys a three-part question an answer with three
parts in it.

These are **provider ceilings, not consumption**. A ceiling is what pure
functions can be held to deterministically; most answers come in well under
it. Real spend needs the provider's usage figures, which no test here can see
and none of them claim to.

The suite also pins the properties worth more than the mean: nothing reaches
the 4096 tier without you asking for depth in words you typed; the evidence
count rises only where the answer length does; the history budget (12
messages / 24,000 chars) and the context budget (12,000 tokens / 4 objects)
still bind and still hold the numbers 2.2 found them at; and a dot command
costs the request side nothing, because its expansion resolves to the same
policy as the question you could have typed by hand.

**One performance fix.** `parseDotCommand` sorted its 31-id list on every
call, which is every keystroke in the composer. Hoisted to module scope.

---

## 10. The required check now runs both unit projects (`853f26c7`)

Found while finishing step 7, and worth knowing on its own.

Vitest has two unit projects: `unit` (jsdom) and `unit-node` (node). A pure
`.ts` test is auto-excluded from `unit` and runs in `unit-node`. **CI's
required `Unit tests` check only ran `unit`.** So 403 files and about 7,400
assertions — including every suite in `src/lib/ai`, among them the one I had
just written for step 7 — were outside the gate that protects `main`.

CI now runs both. Proven by injecting a failure into a `unit-node` suite and
confirming the step exits 1.

---

## 2.2 non-vacuity

Standing Rule 3, every gate, by injection:

| Step | Injection | Caught |
|---|---|---|
| 1 | renderer bypassed; measure reverted to 74ch; density ignored | 8 / 1 / 1 failures |
| 2 | `aria-hidden` removed | 1 failure (and see the honest note in step 2) |
| 3 | Send enabled on empty; Enter not handled; Stop unwired | 2 / 2 / 3 failures |
| 4 | title reverted to a `div` | 4 of 7 failures |
| 7 | shape rules removed | 10 of 19 failures |
| 8 | pane stops mounting the menu | 4 integration failures |
| 8 | editor-only notice returns null | 2 failures |
| 8 | `.price` expands to a figure, not a question | 3 rendered + 2 pure failures |
| 8 | `toc` removed from the classification | drift guard fails by name |
| 9 | one short question routed to `deep` | 4 failures; mean 1017 → 1217 |
| 10 | failure injected into a `unit-node` suite | CI step exits 1 |

**One of my own gates was vacuous when written, and three cases caught it.**
`resolveResponsePolicy` takes an input *object*; the budget suite called it
with a bare string, which resolves `message: undefined`, which every
heuristic reads as the empty string and routes to `brief`. The mean read 700
and the ratchet held comfortably while measuring nothing. There is a note in
the file so the next reader does not reintroduce it.

---

## 2.2 RLS posture

**No data path changed, and no policy was widened.**

- Steps 1–5, 7, 8: presentation and pure functions. No new table, view, RPC
  or query path. `asset_contributions` and `ai_conversations` are read exactly
  as before.
- Step 6: a new table with RLS enabled, four named tenant-scoped policies,
  `anon` revoked, and a definer trigger whose EXECUTE is revoked from
  `PUBLIC`, `anon` and `authenticated`. **Not applied**, so it has no live
  posture yet, and its regression test is unexecuted.
- Step 9: tests only.

**What I could not run.** `tenant:lint:all` needs `SUPABASE_URL` and
`SUPABASE_SERVICE_KEY`; this worktree has no `.env.local`, so the live tenant
lints did not run. I did not work around it.

---

## Gates, run clean at `07e42f18`

- `guard:types` — 8579 repo-wide errors against a ceiling of 8579; 0 on card
  surfaces. One new error appeared during step 1 (`sec.content` is
  `string | null`) and was **fixed, not ratcheted**.
- `guard:copy` — 338 em dashes against a ceiling of 339; 2394 files scanned
  against a floor of 1800.
- `unit` — 325 files, 5,645 passed.
- `unit-node` — 405 files, 7,431 passed.
- `eslint` — clean on every new file.

---

## The 2.2 visual review — about 12 minutes

This is the part I cannot do. Work it in order; the first item is the one
most likely to find something.

### A. The three `svg` literals (3 minutes) — **start here**

1. Open ACT AI, ask anything, and wait for an answer with sources.
2. Look at the evidence toggle, the Keep control and the Copy control.
3. **If you still see `svg3 sources svg`, `svgKeep` or `svgCopy`, the cause is
   not what I fixed** — the markup is now correct, so the text is coming from
   somewhere else, most likely an icon rendering a text fallback. Tell me and
   I will chase it with that as the lead.
4. Tab to the evidence toggle. Its name should be the source count, with no
   warning text attached. The warning, if there is one, is a separate item.

### B. The AAPL case (2 minutes)

1. Open AAPL and go to the workspace pane from the Dashboard.
2. Risks should read **iPhone weakness**, **Regulation**, **Innovation risk**
   as bold text. No asterisks anywhere.
3. The case should read as a paragraph of about 700px, not a narrow column
   down the left of the panel.

### C. The composer (3 minutes)

1. Type a long multi-line question. The box should grow and then scroll, not
   push the thread off screen.
2. Shift+Enter makes a newline; Enter sends.
3. Send should be dead on an empty box and on spaces alone.
4. **Send a long question and press Stop mid-answer.** The answer should stop
   arriving. This is the one in this section most worth doing: it is the
   control that did not exist before.

### D. The conversation list (2 minutes)

1. Tab into the list. You should be able to reach and open a conversation
   with Enter or Space, without a mouse.
2. The active conversation should be marked as current to a screen reader.
3. Tab to a row's actions — they should become visible on focus, not only on
   hover.

### E. Dot commands (2 minutes)

1. Type `.` in the composer. Seven commands, no charts among them.
2. Type `.price.LRCX`. It should offer the question, not a number. Press it,
   then Send, and the figure in the answer should carry a source.
3. Type `.chart.price.AAPL`. It should tell you charts work in a note or
   research editor. **No chart, no empty box.**
4. If you have a template with a shortcut, type `.template.<shortcut>` and
   check the body lands in the box.

### F. Answer length (2 minutes)

1. Ask "come up with a bear and bull case for LRCX". You should get both
   cases, not one paragraph.
2. Ask a short factual question. It should stay short — the point was not to
   make everything longer.

---

## What is left for 2.2

1. **Work the checklist above.** It is the only outstanding acceptance work,
   and section A may change what I do next.
2. **Answer the artifacts org question** in step 6, then decide whether to
   apply that migration. Nothing else is blocked on it.
3. **Merge, when you have looked.** Not before.

## Adjacent problems found in 2.2, left unfixed

Per Standing Rule 4, found and not bundled:

1. **The pane now requires `OrganizationProvider` to mount.** Production
   always provides it, so this is latent rather than live — but
   `useOrganization` throwing instead of returning null means any hook that
   reaches it makes its host unmountable in isolation, which is how three
   suites went red at once. A tolerant read for consumers that only want the
   id would remove a whole class of this.
2. **`AISection` is 1,000+ lines and holds the pane's entire state.** Every
   step in this initiative that touched the pane touched this file. It is the
   reason step 8's regression hit three unrelated suites.
3. **`parseDotCommand` has no shared syntax with the editor's parser.** Two
   parsers for one syntax, joined only by the drift test on the id list. If
   the editor changes its symbol separator, the test will not notice.
4. **`.template.*` ids are invisible to the drift guard**, because the editor
   generates them at runtime from your templates. The guard covers the static
   registry only, which is stated in its own comment.
5. **The `chart` family is five ids with one reason between them.** If charts
   ever come to chat, five entries move rather than one.
