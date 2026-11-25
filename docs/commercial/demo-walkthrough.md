# Product walkthrough: five minutes, one name

**Audience.** A portfolio manager or research director, live, on a call.

**Runtime.** Five minutes of demonstration. Budget eight for the slot:
nobody gets through five minutes of software without one question.

**The security.** AAPL, start to finish. Every segment stays on it.

**Why one name.** A demo that hops between securities demonstrates screens.
A demo that stays on one demonstrates a workflow, and the workflow is the
product. If the viewer remembers one thing, it should be that the AAPL
record accumulated as people worked rather than being assembled afterwards.

**Environment.** QA Lifecycle Validation organization, signed in as the
platform admin. See [demo-checklist.md](demo-checklist.md) before every run.

---

## What this demo deliberately does not show

Read this before running it once.

**The Outcomes surface.** Four defects in decision attribution have open,
unmerged PRs: outcome attribution crediting a decision with a rally that
preceded it (#342), an execution event recording a cut as an add (#341),
review timestamps never recorded (#343), and a deferral displayed as a
rejection (#345). Until those merge, Outcomes shows numbers we know are
wrong. Showing it would be a misrepresentation, and a PM will spot an
attribution error faster than anything else on the screen.

**Any return or P&L figure.** Decision-time price snapshots currently copy
`assets.current_price`, a column with no timestamp, so a computed return can
be arbitrary. One observed case produced +35.8% on a decision that was
twenty minutes old. Do not put a return on screen.

**Charting.** It works and it is not the differentiator. Showing it invites
a comparison with the terminal on their desk, which is a comparison
Tesseract loses and does not need to win. If asked, say it exists and move
on.

**ACT AI, unless asked.** It runs on a BYOK key. If the QA organization has
no key configured it will fail live. Segment 6 covers how to handle it.

---

## Segment 1. The problem, before any software (0:00 to 0:40)

**Screen.** None. Talk to the person.

**Say:**

> Before I show you anything, one question. When your team revisits a
> position from last year, where does the reasoning come from? Not the
> current thesis. The reasoning as it stood when the decision was made.

Then stop and let them answer. Their answer is the most valuable thirty
seconds of the call and it tells you which of the next four segments to
spend time on.

**Typical answers and what they mean**

| They say | Spend time on |
| --- | --- |
| "The analyst's note, but it's been updated" | Segment 3, frozen reasoning |
| "Email or chat" | Segment 4, the decision record |
| "We have a formal IC memo" | Segment 5, the historical record and continuity |
| "Honestly, we don't" | Segment 5, and ask the discovery questions instead of demoing further |

---

## Segment 2. The asset workspace (0:40 to 1:40)

**Navigate.** Idea Pipeline, then click the **AAPL** ticker in Ready to
Recommend. (Global search is the natural route and is currently broken for
assets. See the checklist.)

**Screenshot to capture:** `asset-workspace-aapl.png`

**Point at, in this order:**

1. **The header.** Ticker, company, price. Then the line under it: currency,
   security type, "Held in 1 portfolio", and the price provenance, which
   reads something like `Delayed · Nov 19, 4:00 PM · eodhd`.

   > That caption is there because a price with no as-of and no source is a
   > number you cannot act on. If we have no usable previous close we show
   > no day change rather than computing one against a zero.

   This lands with a PM. It is a small thing that signals the system was
   built by someone who has been burned by a bad mark.

2. **Exposure.** The firm's position in the name, on the same screen as the
   research.

3. **The written case.** Scroll into Research. The thesis, where we differ,
   risks to the thesis.

**Say:**

> This is where an analyst works. The case lives with the security, not in a
> document in a folder named after a quarter.

---

## Segment 3. Idea to recommendation (1:40 to 2:40)

**Navigate.** Back to Idea Pipeline. Show the four stages: Exploring,
Researching, Developing, Ready to Recommend.

**Screenshot to capture:** `idea-pipeline.png`

**Say:**

> Ideas have a lifecycle before they are anyone's decision. Conviction and
> staleness are visible, so a name that has been "developing" for five
> months is obvious rather than quietly forgotten.

**Navigate.** Open the AAPL recommendation (the "1 recommendation" control
on the card).

**Screenshot to capture:** `frozen-reasoning.png`

**This is the centre of the demo. Point at the frozen-reasoning panel and
its label**, which reads "Immutable record of what was recommended at
submission."

**Say:**

> When the analyst submits, the reasoning is frozen. If they revise the
> thesis tomorrow, that is a new version. The record keeps what the PM
> actually read. This is the difference between a document system and a
> decision system.

**Direction.** Slow down here. Everything before this segment is setup and
everything after is consequence.

---

## Segment 4. The PM decision (2:40 to 3:40)

**Navigate.** Decision Inbox (the bottom drawer, showing "2 pending").

**Screenshot to capture:** `decision-inbox.png`

**Say:**

> This is the PM's queue. What they see is the frozen case, not a forwarded
> email. Three outcomes: accept, reject, defer.

**Point at defer specifically.**

> Defer is a first-class outcome, not an absence of one. "Not now, revisit
> after the print" is a decision, and most systems lose it because there is
> nothing to file. Here it is a record with a rationale, and it comes back.

**Do not click accept or reject during a live demo.** Those write to the
record and change the state of the demo environment. If you want to show the
act of deciding, do it on a dedicated run-through and reset afterwards per
the checklist.

**Optional, if they ask what happens on accept:** explain that acceptance
creates an execution record linked to the decision, and that the system
distinguishes an assumed execution from a broker-confirmed one. Be explicit
that in this environment the executions are assumed, not confirmed.

---

## Segment 5. The record, a year later (3:40 to 4:30)

**Navigate.** The historical decision record for AAPL (the decision timeline
on the asset workspace, not the Outcomes page).

**Screenshot to capture:** `decision-history-aapl.png`

**Say:**

> Here is every decision this firm has made on this name. The case at the
> time, who decided, on what basis, and what happened next. An analyst
> inheriting this name starts here instead of starting over.

**Then make the argument explicitly:**

> This is the part that compounds. Year one it is a record. Year three it is
> the only place that knows how this firm actually makes decisions, and that
> is not something a competitor can buy.

**If they ask about outcome measurement:** be straight.

> Structured outcome review is built, and the attribution layer on top of it
> has bugs we have found and are fixing. I would rather show you that in two
> weeks than show you a number I do not trust today.

That answer builds more credibility than a demo of it would.

---

## Segment 6. ACT AI, only if asked (4:30 to 5:00)

**If the organization has a provider key configured**, ask it something that
requires the firm's own records, for example "what is our case on AAPL and
who last changed it". The point is that it answers from the firm's corpus.

**If no key is configured, do not improvise.** Say:

> The assistant runs on your own provider key today, and this environment
> does not have one. Platform-provided AI with per-firm budgets is on the
> roadmap and not built. I would rather tell you that than show you a
> canned answer.

**Never** describe proactive surfacing of prior decisions, or firm-level
pattern analysis across outcomes, as working. Neither is built.

---

## Close (5:00)

> That is the loop. Research, recommend, decide, review, all linked.
>
> We are early and we are choosing a small number of teams to shape the
> institutional rollout. Two things I would want from you: whether this maps
> to how your desk actually works, and where it does not.

Then go to [discovery-questions.md](discovery-questions.md).

---

## Data and setup requirements

| Requirement | Current state in QA Lifecycle Validation |
| --- | --- |
| A security with a written case | AAPL, present |
| Ideas across pipeline stages | 4 ideas spanning all four stages |
| A recommendation with a frozen version | 4 of 5 decision requests carry a `proposal_version_id` |
| A pending request for the inbox | 2 pending |
| All four decision outcomes represented | accepted, rejected, deferred, pending all present |
| An execution record | 1 accepted trade |
| A decision review | 1 review |
| Holdings for exposure | 72 holdings in 1 portfolio |
| Coverage assignment | 1 (DUOL) |

**Gaps that affect the demo**

- One decision request has no frozen proposal version behind it, which is
  the defect PR #340 fixes. Do not open that one. Identify which it is
  during the dry run.
- Only one decision review exists, so segment 5's history is thin. It is
  enough to show the shape, not enough to look like a firm with a track
  record.
- The single coverage assignment is on DUOL, not AAPL, so coverage is not
  part of this narrative. Leave it out.

---

## Screenshots to capture

For the landing page's product section and any deck. Capture at 1600px
browser width, light theme, QA organization.

| File | Screen | Blocked by |
| --- | --- | --- |
| `asset-workspace-aapl.png` | Asset workspace header and overview | Nothing |
| `idea-pipeline.png` | Idea pipeline, four stages | Nothing |
| `frozen-reasoning.png` | Recommendation with the frozen-reasoning panel | Nothing |
| `decision-inbox.png` | Decision inbox, pending request with the three controls | Nothing |
| `decision-history-aapl.png` | Decision timeline for AAPL | Nothing |
| `outcome-review.png` | Outcome review form and a recorded review | PRs #341, #342, #343, #345 |

The first five can be taken now. The sixth should wait, because a capture of
Outcomes today preserves a known-wrong attribution in a marketing asset,
which is the hardest kind of error to retract.
