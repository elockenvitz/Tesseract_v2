# 90-second introduction: script and shot list

**Audience.** A portfolio manager, a CIO, or a pre-seed investor who has
ninety seconds and has never heard of Tesseract.

**Objective.** They can explain to someone else what problem this solves.
Not feature recall. One sentence they can repeat.

**Total runtime.** 90 seconds. If a take comes in over 100 seconds, cut
words from segment 4, never from segment 1.

**What this video must not do.** Claim market-data coverage, claim AI
capability that is not built, or show the Outcomes surface. See
[demo-checklist.md](demo-checklist.md) for why.

---

## Segment 1. Hook (0:00 to 0:12)

**On screen.** No UI. Black, or the Tesseract mark on a dark field.

**Narration.**

> Six months ago your team bought a position. Can anyone still tell you why?
> Not the thesis as it reads today. The reasoning as it stood the morning the
> PM said yes.

**Direction.** Slow. Leave the half-second of silence after "why". The
question has to land before anything moves.

---

## Segment 2. The problem (0:12 to 0:30)

**On screen.** The landing page's problem section, scrolling slowly. Four
headings visible: research evolves, recommendations change, PMs disagree,
positions get adjusted.

**Narration.**

> Every firm has research, data, models and chat. What almost none of them
> have is a record of the decision itself. The note has been edited. The
> target moved. The PM's reasoning is in a message thread. So a year later
> nobody can separate a good call from a lucky one.

---

## Segment 3. What Tesseract is (0:30 to 0:44)

**On screen.** The four-stage lifecycle diagram on the landing page:
research, recommend, decide, review.

**Narration.**

> Tesseract is a decision operating system for investment teams. Research,
> recommendation, the portfolio manager's decision, and the review
> afterwards. Four linked records, not four folders.

---

## Segment 4. The loop, in product (0:44 to 1:12)

**On screen.** Four cuts, roughly seven seconds each. Real UI, QA
organization, one security throughout: **AAPL**.

| Cut | Screen | What the viewer sees |
| --- | --- | --- |
| 4a | Asset workspace, AAPL | Ticker, company, price with its provenance caption, exposure, the written case |
| 4b | Idea pipeline | AAPL in Ready to Recommend, conviction visible |
| 4c | Recommendation detail | The frozen reasoning panel, with its "immutable record of what was recommended at submission" label |
| 4d | Decision inbox | The accept, reject and defer controls on a pending request |

**Narration.**

> An analyst works on the name here, and the case lives with the security.
> When they recommend it, the reasoning is frozen at submission, so what the
> PM read is what the record keeps. The PM accepts, rejects or defers, and
> the rationale is captured as part of the decision. A deferral is a record
> too.

**Direction.** On cut 4c, hold on the frozen-reasoning label long enough to
read it. That label is the product.

---

## Segment 5. Why it compounds (1:12 to 1:24)

**On screen.** Landing page, institutional memory section.

**Narration.**

> Every firm can buy the same market data. What you cannot buy is a
> connected history of your own judgement. That record is the asset, and it
> gets more valuable the longer you keep it.

---

## Segment 6. Call to action (1:24 to 1:30)

**On screen.** Landing page hero, or the closing CTA section.

**Narration.**

> Tesseract is early, and we are choosing a small number of investment teams
> to shape it. If that is interesting, let us show you the loop on one of
> your own names.

---

## Recording guidance

**Capture.** 1920x1080 at 30fps. Browser at 1600px wide inside a 1920
frame, so the UI is not scaled down to illegibility. Hide bookmarks and
extensions. Light theme throughout, because it reproduces better after
compression.

**Cursor.** Move deliberately and do not click anything mid-sentence. Every
click is a cut point in the edit.

**Audio.** One take for the whole narration, recorded separately, then cut
picture to it. Narrating while clicking produces the pacing problem this
script is written to avoid.

**Pacing.** The script is roughly 215 words, which is about 145 words per
minute. That is deliberately slower than conversational. An investment
audience reads the screen while listening.

**Before you record.** Work through
[demo-checklist.md](demo-checklist.md). In particular confirm the AAPL
header shows a price with a provenance caption rather than an unavailable
state, because segment 4a has nothing to show otherwise.

**What to do if a price is missing.** Record anyway and cut 4a to the
written case instead of the header. Do not wait for a quote, and do not
substitute a screenshot from a different day.

---

## Claims audit

Every assertion in the narration, and what backs it:

| Claim | Status |
| --- | --- |
| "Research, recommendation, decision and review are four linked records" | Built. The linkage is enforced by database triggers. |
| "The reasoning is frozen at submission" | Built. `trade_proposal_versions`, surfaced with that label in the UI. |
| "A deferral is a record too" | Built, and the fix for it being displayed as a rejection is in open PR #345. |
| "The record gets more valuable the longer you keep it" | A product argument, not a measurement. Stated as an argument. |
| "We are choosing a small number of teams" | True. There are no design partners yet. |

No claim in this script depends on market-data licensing, platform AI, or
any unmerged fix except the deferral display, which segment 4d avoids by
showing a pending request rather than a decided one.
