# Asset Workspace — section inventory

ACT AI 2.4, §2. Taken from `src/components/asset-v2/AssetWorkspace.tsx` as it
stands, not from the design intent. Every row below is a thing that renders.

The point of the exercise: the brief asks for each section to be classifiable
as **Essential context**, **Supporting detail**, or **Full workflow**, and for
the page to stop repeating facts, stop embedding whole pages, and stop putting
prose in a narrow column. Two of those were already true. The inventory found
one duplication and a handful of copy defects, listed at the bottom.

## The three classes, as this page uses them

| Class | What it means here | Where it goes |
|---|---|---|
| **Essential context** | The answer, or the thing the answer is checked against. A reader who skips it has not read the page. | The lead column |
| **Supporting detail** | Evidence for an answer given elsewhere. Scannable, not read. | The context column |
| **Full workflow** | Another object with its own page. Named and linked, never embedded. | A hop out |

## Inventory

| Section | Class | Renders when | Notes |
|---|---|---|---|
| Header (ticker, verdict, tools) | Essential context | always | Sticky. Carries the verdict and the three routed actions. |
| `DecisionBand` — "Waiting on you" | Essential context | a `pending` decision row exists | The page's hero and its one primary button. Absent, not empty, when nothing waits. |
| `EntryOrientation` | Essential context | arrived carrying an entry context | Above the band deliberately: it says why the reader is here. |
| `theCase` — "The case" | Essential context | always | The written thesis. `lead`, full column measure. |
| `framework` — "Framework" | Essential context | ladder valid **and** spot known | Leads above the case only under `position`/`framework` focus, where the ladder is the subject. |
| `arrival` — "New since the case was written" | Supporting detail | evidence dated after the case | States that support-vs-challenge is not recorded, rather than implying it is. |
| `priceSince` — "Price" | Supporting detail | a price window resolves | `research` focus only. |
| `researchState` — "Research status" | Supporting detail | always | State pill plus evidence counts. |
| `evidenceOnRecord` — "Evidence on record" | Supporting detail | evidence predating the case | `research` focus only. |
| `positionModule` — "Position · <book>" | Supporting detail | a position resolves | Titled for the named book, or "Largest position" with no portfolio in context. |
| `alsoHeld` — "Also held in" | Supporting detail | held in other books | Each weight against its own book's market value; never one book's percentage beside another's name. |
| `ideas` — "Live ideas" | **Full workflow** | at least one live idea | Rows hop to the Ideas object. Says so: "Opening one leaves this page." |
| `decisions` — "Recent decisions" | **Full workflow** | at least one **decided** row | The record. Hops are to Decisions. |

Nothing on this surface embeds another page. The two Full-workflow sections
are lists of links out, and both say in words that pressing one leaves.

## Ordering per focus

Focus reorders; it never hides a section behind a tab. That is the rule the
composition block enforces, and it holds for all five focus values.

| Focus | Lead | Context, in order |
|---|---|---|
| `overview` (and any unknown value) | case, framework | position, also-held, research status, arrival, ideas, decisions |
| `research` | case, framework | arrival, price, research status, evidence, position, ideas |
| `position`, `framework` | **framework, case** | position, also-held, arrival, ideas, decisions |
| `decisions` | case | decisions, ideas, position, research status |

`position` and `framework` share the only ordering that puts the ladder above
the case. That is why the `framework` focus value still exists: a scenario-gap
finding arrives with it, and the ladder is then the subject rather than the
check.

Two asymmetries, both deliberate and both worth knowing: `evidenceOnRecord`
and `priceSince` render under `research` only, and `alsoHeld` is absent from
`research` and `decisions`. Neither is a bug; both are places where a reader
switching focus will see a section appear or vanish, which is the cost of
reordering one page instead of building four.

## What the inventory found

1. **The pending request rendered twice.** `data.decisions` was unfiltered, so
   the row the band presents as the hero also appeared in "Recent decisions"
   as a grey line whose status column read `pending` and whose date column was
   empty. One object, two renderings, the second looking like history. Fixed:
   "Recent decisions" is now the decided rows, and its count is the count of
   what it renders. An asset whose only decision is the open one shows no such
   section at all, which is correct.

2. **Six user-visible em dashes**, against a standing rule that there are none
   in app copy. Two in prose, three as null-value glyphs in data columns
   (`—` for an absent weight, an undecided date, a missing ticker), one in the
   Ideas hop label. Replaced with sentences, `n/a`, `not yet`, and `·`.

3. **A dangling referent.** "Research status" ended with "Saving a core section
   is the only thing that moves this date" while displaying no date; the date
   lives in The case's meta, in a different column. Reworded to name it.

4. **Two hop labels for one kind of hop.** The decision handoff wrote
   `AAPL — decide: …` and the ideas list wrote `AAPL — open idea`. Both now
   use `·`, so the Ideas tab's issue line reads the same whichever control
   sent the reader.

## What was already right

- No section is hidden behind a tab in any focus.
- No whole page is embedded. The two workflow sections link out and say so.
- The case's measure is the column's, not a second narrower cap inside it.
  (There were two stacked `ch` caps; the inner one won and ran the prose to
  about 64% of its column. Removed in an earlier pass, recorded at
  `CASE_MEASURE`.)
- The band is absent rather than empty when nothing is waiting, and the same
  is true of every conditional section above.
