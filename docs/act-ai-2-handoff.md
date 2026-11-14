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

---

# ACT AI 2.3 — context reliability, Slash Commands, Markdown

Four changes so far, each pushed, none merged, none deployed.

## 1. The Large Cap Growth failure (`b8259b88`)

**What was wrong.** You attached the Large Cap Growth portfolio and asked
what active ideas were in it. The answer was built from no portfolio at all.
The chip said the portfolio was attached, so there was nothing on screen to
tell you the answer had nothing behind it.

**The cause, from the production log rather than from guessing:** the
holdings query asked for a column called `weight`, and
`portfolio_holdings` has no such column. It has `shares` and `price`. So the
query failed, the tag resolved to nothing, and the whole thing was dropped
silently.

**What the right answer is.** Against the live database: ONE live idea. Not
three. Two of the three rows are executed history, not open ideas.

**What could break.** Weights are now computed as `shares x price` over the
snapshot total, on the newest stored snapshot. Those are the stored marks on
that date, not live prices, and the answer says so. An unpriced holding is
kept with a null weight rather than dropped or counted as zero -- dropping
it would quietly change every other holding's percentage.

## 2. The composer (`98d22426`)

One container now holds the box, the attachments, the model picker,
Settings and Send. Two of the five things you flagged were real bugs rather
than taste: an empty box showed a scrollbar because the height calculation
was short by exactly the border width, and there were two focus rings
stacked because nothing turned the inner one off.

## 3. Conversations and projects (`1074b6fc`)

Five hover icons became one `···` menu. Projects are a real tree you can
expand, and "Move to project" is a named item instead of a folder glyph that
looked like the control that filtered.

**Three real bugs the tests found while building it**, all fixed: a thread
whose project was archived became invisible everywhere; search found matches
in collapsed projects and then drew nothing, telling you no conversations
matched; and Escape did not close the menu.

## 4. Markdown in research (`1c6a73e1`)

**What was wrong.** You saw `**iPhone weakness**` with its asterisks. The
Asset Workspace was not the culprit -- it renders correctly, which I proved
by rendering the real stored AAPL content and inspecting the output. Nine
OTHER surfaces printed the stored Markdown raw.

The reason only one surface was right: the function that strips markup lived
inside a component file, so nothing else could import it. It now lives in
`src/lib/text/rich-text-plain.ts`.

**What could break.** Clamped excerpts lose their bullet markers and bold
runs, by design -- they are pointers, not reading surfaces. The research-v2
detail page went the other way: it now RENDERS, so a long section there will
look different (properly formatted) rather than wrong.

Nothing stored changed. No migration.

## 5. A context chip is now the server's claim (`e910d4e1`)

**The thing worth understanding.** A chip used to prove only that the
browser had written a row. It said nothing about whether the server found
the object. That is exactly how change 1 above was invisible.

The server now reports one of five outcomes per attached object, the model
is TOLD which objects it could not read (and told that you believe it has
them), and the chip turns amber with its own sentence. A banner above the
composer says the same thing where you cannot miss it.

`unavailable` deliberately does not distinguish "deleted" from "not yours".
It cannot, without a privileged read, and that read would itself disclose
that someone else's portfolio exists.

**NOT YET REACHABLE.** The server half is in `supabase/functions/ai-chat`
and does nothing until that function is deployed. That is a production
deploy and your call. Until then every chip reads `unknown`, which is the
old behaviour minus the false confidence.

## 6. Slash Commands (this change)

**The product decision, applied.** The trigger is `/`. The dot is gone, not
kept as a second way in.

A leading dot is punctuation: it ends every sentence, it is the decimal
point in every figure, and it is the separator in `BRK.B` and in every
domain. A trigger that collides with the most common character in financial
prose fires when nobody asked.

**What did not change.** The command ids. `chart.price` is still
`chart.price`, and the dot inside an id is still a dot -- it is a namespace
separator, and `/chart/price` would read as a URL path, which is one of the
things the trigger must never fire on. So the syntax is `/chart.price.AAPL`:
slash to start, dots to qualify. Nothing stored changed, no persisted node
type changed, and no saved document was rewritten.

**Four parsers, one trigger.** The character was a literal in about twenty
places across four files, and the DISPLAY names were a separate list from
the PARSERS -- so the menu could have advertised one trigger while the
editor listened for another. All four now import `SLASH` from one module,
and a test reads their source to prove it.

**Two real bugs found while migrating**, both of which would have been
visible regressions:

- The highlighter had no word boundary at all, so with a slash every URL
  path in every note would have been decorated as a command.
- The smart-input parser had a fallback that took the LAST separator on the
  line regardless of what preceded it. With a dot that meant `BRK.B` opened
  the menu mid-word; with a slash it would mean every link did. Removed --
  the main scan already handled everything it was there for.

**What must never trigger**, each with its own test: a date (`2026/11/13`),
a date fragment (`/2026`), a quarter (`3/26`), division (`10/2`, `/ 50`), a
ratio (`P/E`, `debt/equity`), a URL, a protocol-relative URL, a path, an
either-or (`bull / bear`) and a fraction (`1/2`). The rule doing the work is
narrow: a LETTER must follow the slash, and the slash must start the line or
follow whitespace.

**The keyboard now works**, which it did not before. Arrow keys move, Enter
takes the row, Tab takes it too, Escape clears. The seam is worth knowing
about: the menu draws the list but the COMPOSER owns the keystrokes, because
your focus never leaves the box while the menu is open. Two components both
acting on Enter is how choosing a command also sends the message, and there
is a test for exactly that -- it failed when I deliberately broke it.

**Historical documents.** Old notes hold `.price.AAPL` as ordinary text. It
stays ordinary text: not highlighted, and not rewritten. Embedded objects
are ProseMirror nodes rather than text, so they are untouched and reopen
exactly as before.

## What to look at, in ten minutes

1. **Slash Commands.** Type `/` in ACT AI. Arrow down, press Enter. Then
   type `/price.LRCX` and Enter twice. Then type `2026/11/13` and `P/E of
   28x` and confirm nothing opens. Then the same `/` in a note editor.
2. **The research page.** Open a name with a bolded thesis in research-v2.
   No asterisks, and the bullets are bullets.
3. **A list rail.** The case excerpt should read as prose with no markers.
4. **The composer.** Empty box: no scrollbar, one focus ring.
5. **Projects.** Make one, move a conversation into it with `···`, reload.
6. **Add Context.** Type two letters. Grouped headings, arrow keys, Enter.

Context chips will all read `unknown` until `ai-chat` is deployed. That is
expected and is the one thing on this list you cannot check yet.

---

# ACT AI 2.3, part two: real figures, kept answers, readable prose

Three more changes landed on `discovery/asset-page-2`, at `ae3711a5`,
`8cdd1d7c` and `6c1c9b38`. Nothing is merged and nothing is deployed.

## 1. A data command returns a figure, not a question

**What it did before.** You typed `/price.AAPL` and the box filled with
"What is the current price of AAPL?" for you to send. A command that names a
stored number became a question to a language model: it cost a request, it
took a few seconds, and the answer could come back rounded, hedged, or about
a different day. Nothing told you which.

**What it does now.** It reads the stored price and shows you the number,
what it is called, where it came from and the date it was true:

> **$712.34**  LRCX last close
> yahoo (chart_v8), stored, as of 2026-11-12

Pressing it puts all of that into the box as one line. It cannot insert the
number on its own: a figure that travels without its source gets quoted into
a message, then into a note, and nobody can tell where it came from any more.

**Three of the six work this way, and three say why they cannot.** `/price`,
`/volume` and `/change` are answerable from the price cache. `/marketcap`,
`/pe` and `/dividend` are not, and each names the exact thing it is missing
-- market cap needs shares outstanding, which is not stored with a source or
an as-of date. The model lookup is still offered for those three, as a
labelled choice you make after being told the store cannot answer. That is a
different act from the command pretending to have worked.

**What could break.** If the cache holds nothing for a ticker you get
"Nothing is stored for X yet" instead of a figure. That is the honest answer,
and it is also how you can tell the nightly job has not run for that name. If
a ticker matches two instruments the command refuses and names them rather
than picking one: a price from the wrong listing with correct provenance
under it is worse than no price.

**`/help` stopped asking the model about itself.** It used to expand into
"Which Tesseract commands work in this chat?" and you sent it. The registry
knows the answer; it now just says it.

**The chart commands got a real reason.** "Works in the editor" was a
location, not an explanation. The notice now says what is actually missing: a
chart is inserted into a live document as an object, and a chat message is
stored text, so there is nothing to draw into. It points you at the asset
page chart, which reads the same stored closes. I did not build a half-chart
in the command menu: that is the "do not fake a chart" line in your brief,
and a sparkline in a dropdown is not the thing you asked for.

**One bug caught before it shipped.** My first version of `/change`
differenced the two OLDEST closes in the window instead of the two newest,
because the price reader returns bars oldest-first. It would have shown a
plausible percentage about the wrong two days, with correct provenance under
it. There is now a test whose only job is that case.

## 2. Keeping an answer, and why you cannot do it yet

**The gap.** An answer worth coming back to had one way out of a thread:
promote it into a research record. That is right when the answer becomes
research and wrong when it is just an answer. Filing a comparison table as a
"quick thought" says something about it that is not true, and the alternative
was leaving it buried in a long thread.

**What is built.** "Keep as an artifact" is the first option in the Keep
menu, with a confirmation that says what it is and is not: private to you,
not filed as research, not a decision and not an approved firm view. An
artifact stores a POINTER, being the conversation, the message and a title,
and no copy of the text. The answer stays where it was written, so deleting
the conversation removes the artifact rather than leaving a title pointing at
nothing.

**Why you will not see it.** The table it needs does not exist. Its migration
is written and NOT APPLIED, in any environment, and applying it is a
production schema change that is your call. So the menu row is absent rather
than present-and-broken: the code asks the database whether the table is
there, and applying the migration turns the feature on with no further change
and no flag to flip.

**What applying it would take**, when you want it:

1. Apply `supabase/migrations/20261113120000_ai_artifacts.sql`.
2. Run its authorization suite,
   `supabase/tests/ai-artifacts-authorization.sql`, which has never been
   executed: the connection available to me is read-only, so it cannot even
   create the table inside a transaction it rolls back.
3. The Keep row appears by itself.

**One decision you should know about.** Artifacts are private to you, not
shared with the firm, even though they carry an organization. The
conversation they point at is private, so an org-wide list would show a
colleague the TITLE of an answer they cannot open: that discloses what
someone is working on and delivers nothing. Sharing these means moving the
conversation's own boundary first, which is a product decision.

**There is no list of them yet.** With no table, a list surface could not be
built against anything or verified, and this repository already has features
that were unreachable code with green tests. That slice comes after the
migration, not before.

## 3. Answers read like answers

Measured rather than guessed. I counted every assistant message stored in
production on 11 and 13 November, which is ten answers, the whole live corpus:

| What                               | How many |
|---|---|
| used a real heading                | 0 of 10 |
| faked one with a bold line         | 3 of 10 |
| ran two sentences together         | 2 of 10 |
| showed you a database column name  | 1 of 10 |

**The sections are real sections now.** `**Bull case**` on its own line was
the model reaching for emphasis, because emphasis is what it reaches for.
Rendered as bold prose, every section had the same weight and a four-section
answer read as one wall. Those lines are headings now, but only where there
are two or more of them: a single bold line is usually the answer's own
judgment, and rendering "**Still a buy on a 12-month view**" as a small caps
label would bury the one sentence you opened the answer for.

**Sentences get their space back.** "...is the trough.The next leg" read as a
typo you had made. The rule is deliberately narrow and leaves `$BRK.B`,
`U.S.A`, `18.5x`, every URL and everything in backticks alone, because
`$BRK. B` is a dead link and a different instrument.

**Column names became words.** One answer showed you `queue_status` and
`outcome_note (from lifecycle_outcome: executed)` in a table header. Those now
read "decision status" and "outcome note (from execution outcome: executed)",
from the same vocabulary the evidence section uses. An identifier NOT in that
list is left exactly as written: a guessed product word is worse than a
visible `queue_status`, because you cannot tell it was guessed.

**Nothing stored was rewritten.** All of this happens as the answer is drawn.
The stored text stays the record of what the model actually said, which also
keeps every citation that points into it by position working.

**The prompt got the other half**, the rule that stops it being produced, on
both sides of the mirror that a test holds character for character. That half
reaches nothing until `ai-chat` is deployed; the rendering fixes work now.

## What I could not check, and what you should click

**I have no browser.** The Chrome extension is not connected to this session,
so I took no screenshots and did no click-through, and nothing above is
claimed from looking at the running app. What I have instead: 679 test files
and 11,846 tests, including rendered tests that mount the real ACT AI pane and
drive it with a real keyboard, plus thirteen deliberate breakages this session
to prove the new tests fail when the behaviour regresses.

The app is running at **http://localhost:5190**.

Fifteen to twenty minutes, in this order:

1. **A real figure.** In ACT AI, type `/price.LRCX`. You should get a number,
   a provider and a date. Press it; the box should hold all three. Then try a
   ticker with no stored price and read what it says.
2. **A refusal that explains itself.** `/pe.LRCX`. It should name earnings as
   the missing input and offer the model lookup as a separate row.
3. **`/chart.price.AAPL`.** Read the sentence. It should tell you there is
   nothing to draw into, not where charts live.
4. **`/help`.** It should answer, with nothing to send.
5. **An answer's shape.** Ask something that produces sections; "bull and bear
   case for LRCX" works. Headings should be small caps labels rather than bold
   lines, and no database column should appear anywhere in it.
6. **Keep.** Press Keep on an answer. You should see three research options
   and NO artifact row. That is correct until the migration is applied.
7. **The 2.3 part-one list** above, which is still worth ten minutes.

**Still blocked on a deploy, not on code:** context chips read `unknown` until
`supabase functions deploy ai-chat`, which also carries the Large Cap Growth
context fix and the honest-gap prompt. That is a production deploy and it is
your call.

## Adjacent problems found, not fixed

* **The frontend tenant lint could not see the artifacts table.** No `ai_`
  table was in its org-scoped list, so an unscoped read of one would have
  passed silently. I added `ai_artifacts` and proved the gate then catches it.
  `ai_project_folders`, which shipped earlier, is still invisible to it: same
  gap, separate change.
* **That lint appears to scan reads only.** The artifact update and delete
  paths were not flagged when I checked. The database policies cover all four
  verbs, so nothing is open, but the gate is narrower than it looks.
* **`IdeaWorkSurface` flattens prose that could be rendered.** Left from the
  Markdown change: it is a clamped pointer, so flattening is defensible, but
  rendering would be better.
* **`holdings-api` has no runtime authorization test.** The edge-authz guard
  warns about it. Pre-existing and unrelated to this work.

---

# ACT AI 2.4 — one active context, honest entry, and the case editor leaves

Written 2026-11-13, on `discovery/asset-page-2`, PR **#291**.

**Read the scope note first.** The 2.4 brief has fifteen parts. This pass did
four of them properly and part of a fifth. It did not attempt the rest. The
list of what was not touched is in §7, and it is not a list of things that
half work — they are unchanged from 2.3.

Nothing has been merged or deployed. `ai-chat` is still undeployed and the
`ai_artifacts` migration is still unapplied.

## 1. There was one context display that mattered, and two that lied

**This is the finding worth understanding, and it explains the symptom
exactly.** You said removing context near the composer does not remove the
context at the top, and that it is unclear what the model will actually
receive. Both halves were true, and for the same reason.

The pane drew context in three bands from three different sources:

| Band | Drawn from | Does the request read it? |
|---|---|---|
| `EngagementContextHeader`, at the very top | `engagementTarget` | **No** |
| `AiContextChips`, above the thread | `currentSubject` + `engagementTarget` | **No** |
| `AiContextAttach`, in the composer | `tags` | **Yes** |

`tags` is the only one of the three that decides anything. It is written to
`ai_conversation_tags`, which `ai-chat` reads to build its document blocks,
and it also travels in the request body as `tags: [...]` (`useAI.ts`, in
`sendMessage`). The other two bands were parallel descriptions built from
inputs the request never looks at.

So detaching an object by the composer genuinely changed what the model would
receive — and the two bands above went on naming it, because they had never
been reading the same thing. There was no bug in the removal. There were two
displays that were never connected to it.

`engagementTarget` is also never cleared, by design: it is the request that
opened the pane. Nothing can revoke it, because nothing stores it as context.

### What replaced it

`src/lib/ai/active-context.ts` is the single model now. `objects` has exactly
one input — `tags` — and there is no parameter on the function that could put
an object in that list from anywhere else. That is the enforcement; it is not
a convention.

It keeps four things apart that were being conflated:

* **Active context** — objects in `tags`. Sent, removable.
* **Event orientation** — why the pane opened. A sentence about your screen,
  not an attachment. Dismissible.
* **Conversation history** — previous messages, sent as bounded history.
  Clearing context does not rewrite it.
* **Evidence** — what an answer cited. A record of a past retrieval, not a
  standing permission to read it again.

The two lying bands are gone from the pane. `AiContextChips` is **deleted**,
not merely unexported: a tested component that still renders a competing
context list is how the competing list comes back.
`EngagementContextHeader` stays in the tree because the Discuss half of the
pane still uses it — the AI pane just does not.

### The controls, and that they are real

* Remove one object — the chip's X, `removeTag`. What it does to the row
  depends on whether the object ever reached a request; see §1a below.
* Dismiss inherited asset context — the same control. An inherited chip is a
  tag like any other; the dashed border says where it came from.
* Dismiss inherited event context — the orientation line's X. Keyed to the
  event, so dismissing AAPL's breach does not silence NVDA's next one.
  Dismissing detaches nothing.
* **Clear all** — new, offered from two chips up. `clearContext` in `useAI`
  detaches every active object at once, in one write rather than a per-chip
  loop of N requests that can half-fail.
* Add — unchanged. Adding an object back also reactivates one that was
  deactivated, so remove-then-add is a round trip with no surprises.

### 1a. The thing I got wrong first, and had to fix

Worth reading, because it is the kind of defect that does its damage silently
and is not recoverable.

My first version of **Clear all** did exactly what the bullet above used to
say: it deleted the conversation's tag rows in one statement. That changes
the next request correctly. It also destroys something else, because
`ai_conversation_tags` was answering two unrelated questions with one row
set:

| The question | Who asks it |
|---|---|
| What does the next request carry? | the request body's `tags: [...]` |
| What is this conversation **about**? | `useAssetConversations`, which inner-joins that table to build "my conversations about AAPL" |

So a twenty-message investigation of AAPL, followed by one press of Clear all
to ask about something else, removed the thread from AAPL's conversation list
**permanently**, with nothing on screen saying it had happened. The same was
true one chip at a time before Clear all existed — Clear all turned a
per-chip footgun into a single press.

The split, in `src/lib/ai/context-activation.ts`:

* The **association** stays in the table and is no longer deleted by a
  context change. The thread stays discoverable from every object it
  discussed.
* **Activation** is held separately, and the request is built from the active
  set. So clearing still changes the next payload — it just stops destroying
  history to do it.
* Detaching is **not** always a deactivation. An object you attached and then
  removed without ever asking anything established no association: nothing
  was sent with it and no answer rests on it, so keeping the row would file
  the thread under an object it never discussed. That row is deleted. One
  that has travelled in a request is deactivated.

**The limitation, stated plainly.** Activation lives in your browser, per
viewer, because there is nowhere durable to put it without a migration:
`ai_conversation_tags` is `(conversation_id, tag_type, tag_id, created_at)`
with no `is_active`, and `ai_conversations` has no metadata column. Both were
checked against the live database, not against the migration files, which do
not describe production. So if you clear context and then open the same
thread on another machine, the objects are active again. The association is
intact and the thread is still discoverable either way — the half that was
being lost is fixed; the half that does not travel is the preference.

The durable fix is one additive column,
`ai_conversation_tags.is_active boolean not null default true`, plus reading
and writing it in `useAI`. It is not applied here because applying a
production migration needs your approval. It is additive and defaults to the
current behaviour, so it carries no risk to existing rows.

Not built: **"replace the active asset"** as one action (it is remove then
add), and **"start a new conversation using selected context"** as a named
control — `New chat` resets to the entry point's context, which is not the
same thing.

## 2. Opening ACT AI is not asking it something

Opening ACT AI from a CEG tile rendered:

```
CEG  CEG
CEG is trading below every case you modelled
CONTEXT ALREADY SUPPLIED TO THE MODEL
✓ Asset CEG   ✓ Spot $…   ✓ Raised by valuationBreach
```

Four faults in one band, all fixed by that band going away:

1. **The ticker twice.** `symbol` is "CEG" and `label` is also "CEG" for an
   asset with no company name, and the header printed both, adjacent.
   Measured: with the old header back in place, "CEG" renders **four times**
   on that screen. The test asserts exactly once.
2. **A heading claiming to list what the model was given**, over chips built
   from the engagement request — which is not what the model is given. This
   was the half that could not be removed.
3. **`Raised by valuationBreach`** — an evaluator key rendered to a reader as
   a value. The trace still exists on the target for debugging; it is no
   longer UI.
4. **Undismissable.** Read it once and keep it forever.

What is there now is one line — issue title, one sentence of detail, a close
button: `AiEntryOrientation`.

### Context is not a question

`WorkspaceActions`' **"Ask ACT AI"** button sent a `seedPrompt`, so pressing a
button that promised to open ACT AI typed a three-clause question about what
had changed since the case was written into the box — which you then had to
clear before you could ask your own.

The rule now: **a question is seeded only when the entry named an event.**
`context.event` exists only when the target carries an `issue`, so:

* **Ask ACT AI** from an asset with nothing wrong → compact context chip,
  **empty composer**, no orientation banner, no model call.
* **A valuation breach, a pending recommendation, research past its date** →
  the orientation line, and the surface's question offered in the composer,
  editable, never sent.

The discriminator is data the surfaces already send, so nothing new had to be
threaded through them. Two of the three asks in that row do name a question —
"Ask what evidence is missing", "Ask what we already hold" — so those now send
the reason they are naming it (a decision waiting; requirements open), which
keeps the button's label and the composer's contents agreeing. That reason is
not invented: it is the state that put the workspace in that mode.

### The `svg` text: I do not think it is in the application

The paste read `svgSpot…`. The same paste also contains `**CEG**` and
`**CEG is trading below every case you modelled**` — markdown asterisks that
are not on the screen. The paste therefore went through an HTML-to-Markdown
converter, and those converters emit `svg` as literal text for an `<svg>`
element. The icon immediately before "Spot" in that chip row is exactly where
`svgSpot` comes from.

A grep of all of `components/ai`, `components/communication` and
`components/asset-v2` for a literal `svg` string found none. The 2.2 pass
reached the same conclusion from the other end.

**Not fixed, because I do not believe there is anything there to fix.** Seeing
`svg` on screen — not in a paste — would be new information.

## 3. Following a reference gets out of your way

A reference press in **research** mode now steps the pane back to the rail. It
is a mode change, not a close, so the conversation, the scroll position and an
unsent draft all survive — `mode-continuity.test.tsx` already pinned that a
mode change costs none of them, which is what made this safe to do
automatically.

In **compact** mode nothing happens. The rail is 384px beside the page, the
destination is already visible, and collapsing a pane you can see past would
be the same mistake in the other direction.

The way back is named: after an auto-collapse the mode toggle reads **"Back to
ACT AI"** rather than "Expand", until you use it. "Expand" was true and
useless — what you want is the conversation you were just in, and nothing on
screen said it was still open.

All three exits go through one wrapper: context chips, cited sources and
ticker pills. Getting the cited-source path there meant lifting `SourceRef`'s
own navigation into `lib/ai/source-focus` as `openSourceRef`, because the only
hook the component offered **replaced** the default rather than wrapping it,
and a second copy of a routing table is how one of them starts sending a
`workflow` source to the wrong sub-page.

Following a reference does not attach the destination. Navigation and active
context stay separate operations, and there is a test for it.

### Reference labels

A cited row led with an uppercase kind chip and then the record's whole title.
For a thesis contribution or a requirement that title is a sentence, so six
sources read as six record headings competing with the answer above them — and
the two things you scan for, which company and what kind of document, were the
smallest marks on the row.

Rows now lead with `AAPL · Thesis`, `CEG · PM ruling`. The record's own title
is **kept**, clamped to a line with the full text in its tooltip: it is what
says *which* thesis, and provenance is the point of that section.
`referenceLabel` in `lib/ai/trail-text` holds the wording.

## 4. Edit the Case no longer opens a cramped copy of the asset page

Pressing Edit flipped a local flag and mounted `ThesisContainer` — the
canonical contribution editor — **inside** the workspace section, in a column
sized for reading a paragraph rather than authoring one. It was the right data
model in the wrong room. There was never a second thesis path; what was wrong
was which room it opened in. Saving worked. Using it did not.

It navigates now. `openCanonicalCase` opens the asset page at its **research**
focus, which is where the case and the evidence under it both live — not a
generic asset overview. The arrival context travels with the hop, so following
a target breach into the pane and then pressing Edit lands you on the research
page still knowing why you came.

Three labels, one door: the header's verb, the orientation band's "review the
case", and the case section's own control all call the same function. The
button says **"Edit in research"** with an arrow, because "Edit" on a control
that navigates would be a lie to anyone with unsaved work elsewhere on the
pane.

The declaration had to move to the top of the component. Three handlers now
close over the entry context, and a handler closing over a `const` declared
below it is the temporal dead zone CLAUDE.md lists as a defect class that has
already broken the feed once.

### The supporting sections were about to be lost

They rendered in full, labelled, with their Markdown intact — but **only while
the embedded editor was open**. So the one way to read "Key catalysts" was to
open an editor you did not want, and when that editor left, the content would
have gone with it, leaving a bare count.

They are disclosed instead: `Show 1 supporting section also on record`, closed
by default, the same renderer when opened. That is the progressive disclosure
the brief asks this pane for; the alternative was a lossy summary that makes
you open the full page to find out whether anything is there.

### What this does NOT do

* **It does not scroll the research page to one named section.** It lands on
  the research focus. A section-level deep link needs a destination the focus
  table cannot express yet.
* **It does not offer a Return to the dashboard.** The asset opens as a tab
  beside the one you came from, so going back is a tab press rather than a
  dead end — but it is navigation you have to find, not an affordance.
* **It does not check read-only permission** at this control. The editor it
  opens does, which is where it belongs, but the button is drawn for everyone.

## 4a. A project became somewhere you can be

Pressing a project did exactly one thing: it expanded to show its threads.
Both the row and its chevron called the same handler, so there was no second
act to discover and no way to tell which one you had performed. A project was
something you peered into.

Three changes, and they are independent on purpose:

**The name goes to the project; the chevron looks inside it.** Pressing the
name opens the project; pressing the chevron reveals its threads in the rail
and navigates nowhere. That matters more than it sounds: a reader can now
check what is in one project while reading a thread from another. Both are
real buttons, so both work from the keyboard — the name was previously a span
inside a clickable div, which meant a project could be expanded without a
mouse but never opened.

**A project you have opened says so.** A band above the list carries its
name, how many threads it holds, a New conversation that belongs to it, and
the way back to all conversations. Before this, opening a project changed
which threads were listed and nothing else: no name, no count, and the only
clue as to which project was a highlighted row above a shorter list. The
rail's old "Show all conversations" link is kept only for the unfiled shelf,
which the band cannot speak for — two controls doing one thing is how a
reader stops trusting either.

**"New conversation in <project>" files the thread for real.** This is the
part worth being careful about, and the reason it has its own test file. A
conversation row is not written until the first answer comes back, so at the
moment the button is pressed there is nothing to set `folder_id` on. The
project is held as an intention in the client for as long as the reader takes
to type their question, and spent in the `INSERT`. If it were dropped
anywhere in that window the sidebar would say one thing and the saved row
another, with no reason for the reader to check — which is worse than not
offering the control. So the tests pin the insert itself, plus the three ways
the intention must not leak: onto a plain New conversation, onto the next
thread after it has been spent, and onto a saved thread opened instead
(which has its own filing already, and whose next message must not move it).

The composer says "Will be saved in <project>." while the thread is unsaved,
because that window is the only time the assignment exists in one place.

**Not done in Part IV:** a project still has no description, no members and
no artifacts of its own, and there is no drag-and-drop filing. Moving a
thread is still the row menu.

## 4b. The object chip row is gone, and objects became searchable

The sidebar carried a permanent row of object chips: every asset, portfolio
and theme any of your conversations had ever been tagged with, frequency
sorted, cut to twelve, and on screen whether or not you were looking for an
object. It was presented as a filter and worked as one, and it had two
problems that get worse with use rather than better. Twelve chips out of two
hundred objects is a sample, not an index, and which twelve you get is
decided by a sort you cannot see. And most of the time you are looking for a
conversation, not an object, so the band was in the way.

**What it is now.** The search box reaches objects as well as conversation
titles. Type two characters and matching assets, portfolios, themes and notes
appear above the conversations; press one and you are on it.

**The capability did not change, only the way in.** Opening an object still
narrows the live list AND the archive to its conversations, through the same
`filter.tag` axis the chips wrote. Four tests that drove that filter by
pressing a chip now drive it by searching and pressing a result — the same
claims, the path a reader actually takes.

**An object you have opened looks like a project you have opened.** Same
band, deliberately: a name, how many conversations are about it, a New
conversation about it, and the way out. Being in a project and being on an
object are the same kind of thing from your side, and giving them two shapes
would make them look like two mechanisms.

**Canonical ids, never labels.** A conversation is matched to an object by
`type:id`. `AAPL` is a symbol that can be reassigned, two themes can share a
name, and a note's title is whatever someone typed — so the theme called
"Power demand" and an asset whose company name contains "power demand" are
different objects, and a label match would put one in the other's list.
There is a test for exactly that, because it is the kind of wrong that looks
right.

**Permission scoping is the query's, not the client's.** The search runs
through the existing `useEntitySearch`, under your own RLS, so an object you
cannot read never comes back. `object-discovery` only ever sorts and filters
results it was handed, and says so in its own header — a client-side
permission filter would be the wrong place for one and would imply the query
needed it.

Two details worth knowing:

* **It waits for two characters.** One character matches most of the database
  and costs the same four round trips. Two is the shortest query that can
  mean something, since there are two-letter tickers.
* **Ranking is not arrival order.** `useEntitySearch` resolves its per-type
  queries in parallel and appends them as they land, so for `AAPL` an asset
  note whose title contains AAPL could arrive above the asset itself — a
  worse answer in a higher position, decided by network timing. Exact match
  first, then starts-with, then the rest, ties broken by type, and stable
  within a band so the list does not move under the pointer.

**Not done in Part V:** artifacts are not in the results (the table is
unapplied — see Part VI), and an object's band shows its conversations but
not its artifacts for the same reason. There is no recent-objects list for an
empty query, and no keyboard navigation of the results beyond Tab.

## 4c. Keeping an answer is a form now, and the feature is still off

**In plain language:** keeping an answer used to be a yes/no box. It showed a
name a model had written, which you could not change, and nothing else — not
the answer, not what it was about, not where it went. So the only way to find
a kept answer again was to recognise a machine's sentence in a list.

It is a form now, with the four things the brief asked for: the name (editable,
and selected when the form opens so replacing it is one gesture), a preview of
the answer being kept, what it is about, and optionally which project it goes
in.

Three choices inside it are worth knowing about:

- **The subject arrives pre-filled and is removable.** You are usually keeping
  an answer *about* something and the pane knows what. But an answer read on
  the AAPL page is often about the sector, so the chip has an × — pre-filled,
  not forced.
- **It only offers assets, portfolios and themes.** The sidebar's object search
  also finds notes. An artifact cannot be about a note: the column's CHECK
  accepts three types, so offering a fourth would produce a row the database
  refuses — a save that silently did nothing. The picker drops a result of any
  other type rather than passing it on.
- **It says what an artifact is not.** "It is not filed as research and it is
  not a decision. The answer itself is not copied, so deleting this
  conversation removes it." Nothing downstream says this, so this is the only
  place it gets said.

**What could break:** nothing live, because nothing is live. See below.

### What remains before artifacts can be turned on

This is the list the brief asked for, and every item on it is outside what I
am authorised to do in this pass.

1. **`supabase/migrations/20261113120000_ai_artifacts.sql` is UNAPPLIED, in
   every environment.** Verified by querying the live database, not by reading
   the migrations directory — which in this project does not describe
   production. The table does not exist. Applying it is a production schema
   change and belongs to its own approval.
2. **`supabase/tests/ai-artifacts-authorization.sql` has never been
   executed.** It is authored: 17 assertions, including five added in this
   pass for the new association columns (a foreign project denied, a foreign
   org's portfolio denied, a nonexistent theme denied, a legitimate
   association allowed, a half-written subject pair rejected). It cannot run
   from here — the Management API connection is read-only and refuses DDL with
   `25006`, so the fixtures cannot be created. **The suite's own non-vacuity is
   therefore asserted, not demonstrated.** Its header names the two injections
   that must be performed when it is first run: dropping the trigger must fail
   assertions 9, 13, 14 and 15 while 16 stays green, and dropping the
   `ai_artifacts_subject_paired` constraint must fail 17. If either injection
   does not produce those failures, the suite is decoration and the table
   should not be trusted.
3. **The run order is fixed:** apply the migration, then run the suite with
   both injections, then revert the injections and confirm all 17 green. Not
   the other way round, and not the first without the second.
4. **No code change is needed to switch it on.** `useAiArtifacts` probes the
   table — one list query whose missing-table error turns the feature off — so
   the Keep menu's artifact row is *absent*, not disabled, until the table
   exists, and becomes present the moment it does. There is no flag to
   remember. This is also why the finished form is not a reason to apply the
   migration: the form being complete and the feature being off are
   independent.

What the migration now carries that it did not before: `subject_type`,
`subject_id` and `folder_id`, their two CHECK constraints (the type is one of
three; the pair is both-or-neither), two partial indexes, and a widened
`ai_artifact_conversation_must_be_own()` trigger. The trigger is the part worth
reading — it refuses a project belonging to another user or another
organization, refuses a portfolio or theme in another organization, and has an
`ELSE` branch that raises, so adding a fourth type to the CHECK without adding
a containment branch for it fails closed rather than open. Assets are checked
for existence only: `assets` has no `organization_id` and is global reference
data by design.

## 5. Non-vacuity

Every gate below was proven to fail by injecting the behaviour it exists to
catch; the injections were then reverted.

**`active-context.test.ts`** — the old fallback re-added, so `objects` could
be populated from the target when `tags` was empty:

```
× is empty when the tags are, however much the entry point supplied
  AssertionError: expected [ { …(3) } ] to deeply equal []
× is absent for a plain open, so the composer stays empty
  AssertionError: expected { title: 'Asked from a surface', …(2) } to be null
```

**`active-context-pane.test.tsx`** — `EngagementContextHeader` re-rendered in
the pane and the seed read from the target again. Six failed, including the
one that counts the ticker:

```
× names the asset exactly once
  AssertionError: expected [ <span/>, …(3) ] to have a length of 1 but got 4
× never claims to list what was already supplied to the model
× does not render the producer key the chip row showed as a value
× leaves the composer empty when nothing raised this
  AssertionError: expected 'What is our current view of CEG, and …' to be ''
```

**The reference auto-collapse** — `followReference` reduced to just running
the navigation:

```
× steps out of research mode when a reference is followed
  AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times
× renames the toggle so the way back is findable
  AssertionError: expected 'Expand' to contain 'Back to ACT AI'
```

**The embedded editor** — `ThesisContainer` mounted back in the case section:

```
× sends the reader to the canonical research editor, and mounts none here
× takes the same door from the case section as from the header
× sends the review-case control to the asset page at its research focus
```

One of my own tests was vacuous when first written and was rewritten: three of
the reference cases asserted by pressing the mode toggle, which proves nothing
about following a reference. They now resolve the tagged object so the chip
renders as a real link, and press that.

**`ai-context-activation.test.tsx`** — the association split, which is the one
claim where a mistake loses data that cannot be recovered. There was no
`useAI` test before this: every suite that needed the hook mocked it, which is
precisely why a defect in its write path had nowhere to be caught. This one
mounts the real hook against a Supabase stub that records every statement
built, so "no DELETE was issued" is an assertion about what would have reached
the database rather than a reading of the source.

Injection 1 — `removeTag` reverted to the unconditional row delete (the
original behaviour). 4 of 10 red:

```
× leaves the association row in place when it is detached
  AssertionError: expected [ { table: 'ai_conversation_tags', … } ] to deeply equal []
× does not come back when the conversation is reopened
× comes back when the reader attaches it again
× becomes established once it has travelled, and then survives detaching
```

Injection 2 — `clearContext` reverted to the bare
`.delete().eq('conversation_id', id)`. 2 of 10 red:

```
× empties the request without emptying the conversation
× never issues an unscoped delete on the conversation
  an unscoped delete reached the tag table: [["eq","conversation_id","c1"]]
```

Both reverted; `git diff` on `useAI.ts` afterwards shows only the intended
change. Note that "leaves it out of the next request body" passes under
injection 1 — correctly, because deleting the row also drops it from the
active set. That test guards the payload; the four above guard the
association. They are separate claims and needed separate cases.

**`ai-project-assignment.test.tsx`** — the project a new thread is filed in.

Injection 1 — `folder_id` dropped from the conversation `INSERT`, which is
what the code did before this change:

```
× writes the project onto the row it creates
  AssertionError: expected undefined to be 'f-earnings'
```

Injection 2 — the intention left set after it was spent:

```
× spends the intention once, and not on the next thread
  AssertionError: expected 'f-earnings' to be undefined
```

**`ai-folder-rail.test.tsx`** — the chevron rejoined to the name, so both
did the same thing again:

```
× goes to the project when the name is pressed, and does not expand it
  AssertionError: expected "onSelectFolder" to be called with [ 'f-earnings' ]
```

Four of these cases asserted the OPPOSITE before this pass and were
rewritten rather than deleted, with the reversal recorded in the file. The
sharpest was `expect(onSelectFolder).not.toHaveBeenCalled()` after pressing
a project's name — exactly wrong now, and the clearest statement of what
"a project is only a disclosure" used to mean.

**`guard:types` proved itself without an injection.** The ratchet's ceiling
is 8579 repo-wide errors. Four of the errors this pass introduced were real
and were found by running the typecheck rather than the gate — including one
live bug (below) — and the count stood at 8583 against that ceiling, so the
gate would have failed. After the fixes: `repo-wide errors: 8579 (ceiling
8579), card-surface errors: 0, PASS`.

**One live bug the typecheck caught.** Giving `onNewConversation` a folder
parameter turned the header's `onClick={onNewConversation}` into a handler
receiving the MouseEvent as its folder id. The reader would have pressed New
conversation and had the thread filed into a project whose id was a React
synthetic event. It is now `onClick={() => onNewConversation()}`.

**`ai-archive-discovery.test.tsx`** — object discovery, after the chip row.

Injection 1 — the two-character floor dropped, so one keystroke fans out
four table searches:

```
× still shows nothing at one character
  TestingLibraryElementError: expected not.toBeInTheDocument
```

Injection 2 — the archive load removed from opening an object:

```
× loads the archive when an object is opened, without being asked
  AssertionError: expected "onLoadArchived" to be called at least once
```

**One of my own tests was vacuous and I caught it with injection 2.** It
first asserted after the whole gesture — type the name, press the result —
and passed with the object-open call deleted, because TYPING already loads
the archive through a different effect (searching reaches archived threads).
It was proving the search, not the thing it was written for. It now clears
the mock between typing and pressing, and fails as it should.

**One TDZ avoided.** The dependency array that `selectConversation` needed
named `setDraftFolder`, declared below it. A dependency array is evaluated on
every render, so that is a `ReferenceError` before anything runs — the
defect class this codebase has shipped before. The declaration was moved
above the callbacks that depend on it.

### The save form (Part VI)

Injection A — `artifactAssociation` changed from `draft.folderId || null` to
`?? null`, so the "No project" option's empty string would reach the column:

```
× sends no folder for an empty choice, rather than an empty string   (store)
× sends no folder for an empty choice, rather than an empty string   (hook)
Tests  2 failed | 46 passed (48)
```

Caught in both suites, which is the point of having the rule in one place and
asserting it at both the rule and the call site.

Injection B — the `isArtifactSubjectType` guard removed from the picker, so a
note could become an artifact's subject:

```
× ignores a result of a type an artifact cannot be about
Tests  1 failed | 18 passed (19)
```

Injection C — the subject chip's × made a no-op, which is the whole reason the
subject is pre-filled rather than fixed:

```
× can be removed, because an answer read on AAPL can be about the sector
Tests  1 failed | 18 passed (19)
```

Injection D — the blank-name check removed from the rename path:

```
× refuses a rename to a blank name, and says which refusal it was
Tests  1 failed | 10 passed (11)
```

**The ratchet caught two real errors in this part, which is a non-vacuity
demonstration I did not have to stage.** `guard:types` read 8581 against its
ceiling of 8579. One was a dead `ConfirmDialog` import left behind when the
form replaced it. The other was a live bug: I had dropped `artifactTitleError`
from `useAiArtifacts`'s imports while swapping in `artifactDraftError`, and the
*rename* path still called it. Renaming an artifact to a blank name would have
thrown a `ReferenceError` instead of showing a reason — and every suite was
green, because the rename path had no test at all. It has two now, and
injection D above is the proof that the first of them would have caught this.
Assertion on the message, not merely on rejection: a `ReferenceError` also
rejects, and also leaves the update spy untouched.

## 6. RLS posture

**No data path changed, and no policy was touched.**

* `clearContext` issues at most
  `DELETE FROM ai_conversation_tags WHERE conversation_id = $1 AND tag_id IN (...)`
  as the reader, through PostgREST, under their own RLS — and only for
  objects that never reached a request. There is deliberately no unscoped
  delete on `conversation_id`; a test asserts that any delete reaching the
  tag table names its ids, because the unscoped version is the defect in §1a.
  It cannot reach a conversation the reader does not own —
  `ai_conversations` is `user_id = auth.uid()`, and the tag table's policies
  are scoped through it.
* Deactivation writes no row at all. It is `localStorage`, per viewer, so it
  has no RLS posture and leaks nothing: the keys are `type:id` pairs for
  objects the reader could already open.
* The project assignment adds `folder_id` to the `ai_conversations` INSERT.
  Same table, same policy, same reader: `ai_conversations` carries
  `user_id = auth.uid()` on every verb, and the row is inserted by its own
  owner. `ai_project_folders` is unchanged and is read under its own
  per-reader, per-organization policy
  (`user_id = auth.uid() AND is_member_of_org(organization_id)`, all four
  verbs), so the folder list the UI offers contains only the reader's own.
* No new table, view, RPC, Edge Function or migration in Part IV either.
* **Part VI changes no live data path, because its table does not exist.** The
  save form reaches no database. `useAiArtifacts` is unchanged in posture: one
  list query that is refused with "no such table" today. The migration's own
  posture is documented at §4c — it stamps `organization_id` at write time,
  keeps the table strictly `user_id = auth.uid()` (because
  `ai_conversations` carries no organization at all, so an org-wide read here
  would disclose a colleague's title with nothing behind it), and guards the
  three new columns with a `SECURITY DEFINER` trigger rather than a policy,
  since a policy subquery would run under the caller's own RLS and a
  cross-organization portfolio would simply be invisible to the check rather
  than refused by it. **None of that is proven, because the suite has never
  run.** It is asserted by reading, and §4c says what must happen before it is
  believed.
* Object discovery adds no query of its own. It calls the existing
  `useEntitySearch` with four of its nine types, so every branch is a query
  that already ran elsewhere in the product under the reader's own RLS, and
  an object they cannot read never comes back. `rankObjects` sorts results it
  was handed and can only ever return a subset of them.

**One thing I checked and did not like, stated plainly.** I was going to
write that the foreign key stops a reader filing a thread into another
firm's project. It does not, and I checked the live database rather than
assume. The constraint is
`folder_id REFERENCES ai_project_folders(id) ON DELETE SET NULL` — it
requires the folder to EXIST, not to be yours. And the two policies on
`ai_conversations` constrain `user_id` only; neither mentions `folder_id`.
So a crafted client could set `folder_id` to any folder id in the database.

What that is and is not worth:

* **Nothing is disclosed and nothing is corrupted.** The conversation stays
  `user_id = auth.uid()`, so only its own author can read it, and the folder's
  owner cannot see it either — their sidebar counts from conversations THEY
  can see. There is no path by which one firm's thread appears in another's.
* **What it does leak is an existence oracle.** The insert succeeds for a
  real folder id and fails the foreign key for a fake one, so a client could
  confirm whether a given UUID is a folder in some organization. Against
  unguessable v4 UUIDs that is weak, and it reveals existence only, never a
  name or an owner.
* **It pre-dates this change.** `moveConversationToFolder` has always written
  this column with no ownership check; Part IV adds a second write path to the
  same unguarded column rather than opening a new hole.

It is listed as an unfixed finding at the end rather than fixed here, per
scope discipline. The fix is a `WITH CHECK` on `ai_conversations` requiring
`folder_id IS NULL OR EXISTS (SELECT 1 FROM ai_project_folders f WHERE
f.id = folder_id AND f.user_id = auth.uid())` — through a definer helper, not
an inline `EXISTS`, because a policy subquery runs under the caller's own RLS
and an inline one would be satisfied by the reader's own visibility rather
than checking it. That is a migration, and migrations need your approval.
* No new table, view, RPC or Edge Function. No migration.
* `openSourceRef` moved an `openAsset` call between modules. It dispatches a
  tab descriptor; it reads nothing.
* The attach picker still searches through `useEntitySearch`, under the
  reader's own RLS, so an object you cannot open is an object you cannot
  attach. Unchanged.

Carried forward from 2.3: the artifacts feature's confidentiality comes almost
entirely from `user_id = auth.uid()`. The `organization_id` half is a filing
boundary, not a confidentiality one, because no row is ever readable by anyone
but its owner.

## 7. What this pass did NOT touch

Unchanged from 2.3. None of these is half-built.

* **Part VI — Save as artifact.** The Keep menu is unchanged and its artifact
  row is still absent, because `ai_artifacts` is still unapplied. There is no
  naming step, no preview, no object-association picker, no project
  assignment. The feature is correctly OFF rather than broken — the hook
  probes for the table instead of reading a flag — but "ready for activation"
  would overstate it: what exists is the pointer write from 2.3, not the flow
  the brief describes.
* **Part VIII — the full workspace content audit.** Two specific things were
  done (the case fills its column; supporting sections are disclosed). The
  section-by-section visible / disclosed / open-the-feature decision was not
  made.
* **Part IX's scenario and risk editing.** Only the case moved. Bull/base/bear
  and risks are untouched, so whatever they do today, they still do.
* **Part X — cross-surface consistency audit.** Not attempted.
* **Part XII — the end-to-end journeys.** Not run.

## 8. Verification

Automated only. **No browser interaction occurred in this session**, so
nothing above is a visual claim — every statement names a test, a measurement
or a grep.

Backend-dependent and therefore still unverified end to end: the request
payload assertion is made against the code path, not against a live
`ai-chat`, because `ai-chat` is undeployed. The `tags` array in the body and
the row delete are both assertable locally; what the deployed function then
does with a shorter `tags` array is 2.3's change, not this one.

Part VI is verified one step less than that, and the distinction matters: the
form, the draft rules and the write payload are asserted by 67 tests with four
injections, but **no artifact has ever been written**, by me or by anyone,
because the table does not exist. The migration and its 17-assertion suite are
read, not run. §4c is the list of what that requires.

Counts at the end of this pass, for the AI area as a set:

```
Test Files  69 passed (69)
     Tests  1437 passed (1437)
guard:types  repo-wide errors: 8579  (ceiling 8579)   card-surface errors: 0
             PASS
```

The five `no-unused-vars` lint errors in `AISection.tsx` are pre-existing:
proven by linting `HEAD`'s copy of the file in place, which reports the same
five.
