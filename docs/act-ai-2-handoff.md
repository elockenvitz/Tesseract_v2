# ACT AI 2.0 and Contextual Asset Workspaces — handoff

Branch `discovery/asset-page-2`, pull request **#291**, head `0c92c318`.
Written 2026-11-11.

---

## Read this first

**The initiative is code-complete and every required check is green. It has
never been opened in a browser.** Claude in Chrome failed to connect on four
separate attempts across two sessions ("Browser extension is not connected"),
so the ten interactive scenarios and the screenshots you asked for have not
been done, and there are none in this document.

Everything below that says "verified" means a test, a guard, a build artifact
or a live database query named at the point of the claim. Nothing below
describes anything anyone has looked at.

**It is also not deployed.** Nothing has been merged and no migration exists in
this work, so production is unchanged.

## What you will see when you do open it

In the AI pane: the assistant is called **ACT AI** everywhere a person reads it
— the sidebar, the placeholder, the expanded header. The old name is gone from
every user-visible string, and a guard holds it at zero. One occurrence remains
in the bundle: the "Co-Analyst (optional)" field in the add-trade-idea modal,
which is a human second analyst and has nothing to do with the assistant. That
file is on the guard's documented allowlist on purpose.

The suggested questions under the composer are now derived from your own
records rather than written in advance, and each one says why it is there —
"4 in your decision inbox, the longest for 9 days". They are ranked by a
deterministic layer, not by the model, so they do not reshuffle under your
cursor, and the model never invents urgency.

Answers now lead with a summary, use figures and tickers consistently, and keep
source facts, the model's reading and acknowledged gaps visually distinct, with
gaps in a blockquote at the end.

The research trail under an answer shows record titles, types, dates, status
and a short excerpt in the record's own words, and each entry navigates to that
specific object. No raw JSON.

On the asset Snapshot there is a new **ACT AI Briefing**. It names the
situation — "Decision preparation" when a recommendation is waiting on a
ruling, "Asset review" otherwise — and says what a briefing covers before you
pay for one. Nothing runs until you press. "Continue in ACT AI" opens the pane
on that asset with the briefing's framing in the composer.

## The thing most worth understanding

The honest-absence problem runs through all of it, and it is the reason the work
took the shape it did.

ACT AI can only read what your permissions allow. So when a lookup comes back
with nothing, that can mean two completely different things: the firm has no
such records, or you cannot see the ones it has. Saying the first when the
second is true is the worst thing this product can do, because it sounds
authoritative and it is wrong.

Every retrieval tool now declares its reach as one of three things: the whole
organization, everything you can see, or only yours. Only an organization-wide
lookup is allowed to phrase an absence as a fact about the firm. The others say
"nothing that you have access to" or "none of yours". Both the model's prose
and the panel's own sentences come from the same declaration, so they cannot
drift apart.

There is a third case the trail used to collapse into the first: a lookup that
**failed**. It now says it failed. A failed lookup reported as "no records
found" is a false negative dressed as a finding.

Per your instruction, none of this is achieved by widening anyone's access. No
`SECURITY DEFINER` function was added to count hidden rows.

## What could break, and what stops it

**Two surfaces describing one asset.** The briefing reads the same hook and the
same cache as the attention band above it, so it adds no database read and
cannot contradict the band. Asserted by object identity, not a matching count.

**A model call you did not ask for.** The press is stored as *which asset* you
pressed on, not as a yes/no. The obvious version of this is wrong and an
injected failure is what exposed it: a React effect runs *after* the render that
changed the asset, so that one render still says "asked" — and one render is
enough for a lookup to start against the new company.

**An answer retyped as your own.** "Continue in ACT AI" hands over the
*question*, never the briefing's prose. Pasting the answer in would strip its
evidence trail and turn a sourced figure into an unsourced claim the model then
builds on.

**A stale briefing read as current.** The cache key includes the signals, so a
recommendation arriving while the page is open produces a new briefing rather
than serving the one from before it.

**Note text quietly stored twice.** Excerpts are shown but never written into
the saved transcript. The transcript is one JSON column under the conversation
owner's policy, so storing note bodies there would create a second, unpoliced
copy of research text.

**One firm's numbers on another firm's screen.** You are a member of two orgs
with materially different numbers — Tesseract has 70 active ideas and 10
coverage rows of yours, Tails Cap has 6 and 50. The suggestion facts were
cached under your user id alone, so switching orgs would have quoted the wrong
firm's counts until the cache expired. Now the org is in both the cache key and
the queries.

## Verification

| What | Result |
|------|--------|
| Unit suites | 628 files, **10,867 tests**, all passing (`npm run guard:unit`) |
| Types | repo-wide errors **8,577**, at the ceiling; card surfaces **0** |
| Copy guards | em dashes 339 (at ceiling); legacy assistant name **0** |
| TDZ / hook-order ratchet | 178 files, 0 violations |
| Production build | `vite build` succeeded in 43.8s |
| Bundle contains the feature | every new user-visible string found in `dist/assets/index-*.js` |
| Required GitHub checks | Unit tests, Card layout, Type check (cards), Invite entry, static — **all pass** on `ed45e865`; re-running on `0c92c318` |
| Browser inspection | **not done** — extension would not connect, four attempts |

`db (live role-context verification)` fails, and that is pre-existing and
expected: it is fail-closed and the staging credentials do not exist on the
free plan, so it reports UNVERIFIED (exit 3) rather than passing. It is not a
required check and this work did not change it.

### Gates proven non-vacuous

Twenty-two deliberate failures were injected across the initiative and each was
caught and reverted. Three are worth singling out because the gate did *not*
catch them at first:

- A test of the per-asset reset **passed** against a component that reset
  nothing, because it never actually pressed the button first. Strengthened,
  it then failed — and then exposed the real effect-ordering defect above.
- The `ai-chat` contract test **passed** three times against a deliberately
  renamed field: once because it searched a 3,500-line file for a field name,
  once because it selected the error payload by position, once because a lazy
  regex swallowed three payloads as one. The fourth version brace-matches and
  asserts its own selection is unique.
- A scoping property test caught three unscoped suggestion reasons I had
  written and missed, one after another.

Two gates caught real defects on their own, with nothing injected: the
org-scope guard named the two unscoped reads in `useGroundedPrompts.ts`, and the
unit guard noticed that `src/hooks/ai/__tests__` was outside its scope and
would have run as zero tests.

## RLS posture

No new table, view, RPC, policy, storage path or migration. No policy widened.

Retrieval runs inside the existing `ai-chat` function on a Supabase client
built from your forwarded access token, so your own row-level security applies
to every lookup — now asserted by a test, because a service-role client there
would brief one reader on another firm's records.

The one data-path change is a narrowing: `trade_queue_items` and `coverage` in
the suggestion-facts hook now filter on `organization_id` explicitly instead of
relying on RLS alone. Consequence worth knowing: 8 of 241 ideas in production
have no organization at all and now drop out of those counts.

## What is left

1. **Open it in Chrome** and run the ten scenarios. This is the only
   outstanding acceptance work.
2. **Merge #291** once you have looked. All five required checks are green;
   confirm them again at the head you merge.
3. **Confirm the deploy.** Netlify posts no production status, so check by
   fetching the site and grepping the bundle for a new string.

Nothing here is blocked on a decision from you.

## Adjacent problems found, left unfixed

In rough order of how likely they are to bite:

1. **`price_targets` vs `analyst_price_targets`** remains an orphan trap for
   anything new that reads price targets.
2. **Two disagreeing portfolio-membership tables** — a collaborator added in the
   UI is invisible to half the app. Previously deferred on purpose.
3. **Overview and ACT AI can report different trade counts** for the same
   asset. They count different records in the decision chain. Neither is
   wrong; nothing reconciles them.
4. **`coveringUserIds` is rebuilt inline at three call sites**, so the attention
   memo recomputes every render. Pre-existing pattern, copied rather than
   introduced. Cheap to fix, costs nothing visible today.
5. **Dead imports in `gallery/lists.tsx`** still break vite's dependency
   pre-scan.
6. **The `DOM_HINT` heuristic in `vitest.config.ts`** routes a test file to
   jsdom based on words appearing in its *prose comments*. It mis-routed two
   files in this work and the fix each time was to reword a comment.
7. **Pre-existing unused-variable warnings** in `InvestmentSnapshot.tsx`.
8. **The parked Work-mode redesign** still needs a decision. Section F
   deliberately did not absorb it.
