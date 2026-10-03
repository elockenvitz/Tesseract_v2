# READY TO REVISIT — honest evaluation

Written after building it, against the questions that were set before.

**Verdict: useful, not yet WOW.** It is the first thing in the product that
is genuinely about the user's own working memory rather than about the
market, and that is a real step. But two of the three sentences on the card
are things the user already knew, and the third — "what changed" — is
currently thin enough that the card often has nothing interesting to say.

---

## 1. Does it tell the user something Bloomberg/FactSet cannot?

**Yes, and this is the strongest claim it has.** "You parked NVDA 11 days
ago, at Researching, Medium conviction" is unavailable anywhere else at any
price, because it is a fact about this person's own workflow. No terminal
knows what you shelved or where you left it.

The *changes* it reports, taken individually, are mostly not exclusive — a
terminal shows the price move, and better. What is exclusive is the
**pairing**: this price move, against the date *you* stopped looking, next to
the conviction *you* held when you stopped. The anchor is the user's own
decision, and that is the part no data vendor has.

## 2. Is the memory claim completely grounded?

**Yes.** Every element traces to a row:

| On screen | Row |
|---|---|
| "You parked NVDA 11 days ago" | `memory_obligations.raised_at` / `due_at` |
| "Researching · Medium conviction" | `trade_queue_items.stage` / `.conviction` |
| "+8.4% price" | two dated closes in `price_history_cache`, both shown |
| "3 new research items" | `object_links` rows since `raised_at` |
| "Target changed from $120 to $135" | frozen `trade_proposal_versions` vs current |

No model runs. Nothing is inferred. The card refuses to render without a
resolvable asset, omits a price comparison when no close precedes the park,
and omits a target change when no frozen before-value exists.

The one place it could still mislead is "The idea was edited" — true, but
uninformative, and a reader may assume we know *how* it was edited. We do
not, because `audit_events` had `from_state` hardcoded for idea edits.

## 3. Is it clear why this appears today?

**Yes, unusually so.** Most feed cards answer "why now" with a threshold
nobody chose. This one answers it with the reader's own instruction, and
says so twice — in the headline and behind "Why this matters" ("You asked to
revisit this on 2026-09-20"). This is the question the whole feed has
historically been worst at, and this card is the best answer in it.

## 4. Does "where you left it" materially help?

**Partially.** "Researching · Medium conviction" is real orientation and
costs nothing. But stage and conviction are coarse: they tell you the shape
of the work, not its state. What a returning analyst actually needs is
closer to "you had written the bull case and not the bear case" or "you were
waiting on the 10-K" — and the product does not store either.

So it helps, and it is the weakest of the three sections.

## 5. Are the "since then" facts useful enough?

**This is the honest weak point.** Of the six fact types, the ones that will
fire most often are the two least interesting:

- `idea_edited` — "the idea was edited". Says almost nothing.
- `price_change` — real, but a terminal does it better, and it only covers
  137 of 912 assets.

The genuinely valuable ones are rare by construction: `target_price_changed`
needs a frozen version predating the park (so it only works for ideas
recommended after slice 2), and `trade_committed` / `decision_recorded` mean
the work was *finished* while parked, which is an edge case.

`research_added` is the quiet winner — "3 new research items" while you were
away is useful, exclusive, and will fire reasonably often on active names.

So: on a good day the card says something a terminal cannot. On a typical
day it says "nothing has been recorded against it since", which is honest
and mildly useful but not a reason to open the app.

## 6. Does Resume work land in the right context?

**No — this is the clearest gap.** The desktop CTA lands on the asset's
*research* surface, which is adjacent to the parked thesis but is not the
idea. The idea detail is reached through the feed's `post` path, which needs
a `ScoredFeedItem` this producer does not have.

The mobile href is `/trade-queue` — the right page, no deep link, because
`TradeQueuePage` reads no idea parameter. (An earlier version of this work
emitted `/trade-queue?idea=<id>`, which looked like a deep link and silently
did nothing. That was fixed rather than kept.)

A card whose entire promise is "come back to this work" should land *on the
work*. It currently lands near it.

## 7. Does it feel like the beginning of a Decision OS?

**Yes — more than anything else shipped so far.** The chain now exists end to
end: a person parks work → an obligation records the promise → suppression
honours it → the date arrives → a candidate resolves → deterministic facts
are gathered → a card says what happened. Every link is a row, and no link
is a guess.

That is the skeleton of a system that remembers. What it does not yet have is
anything to say about *judgement*.

## 8. What prevents this from being a true WOW?

Three things, in order of weight:

1. **The product does not know why you parked it.** The single most valuable
   sentence would be "You parked this waiting for the Q3 print. It printed."
   We record *that* work was parked and never *why*, so the card can only
   ever say "you asked" and not "you were waiting for X". Everything else is
   second order.

2. **"What changed" is mostly bookkeeping.** Edits and link counts are
   activity, not information. A thesis edit that *contradicts* the parked
   conviction would be information — and we cannot tell the difference
   because theses are not versioned.

3. **The CTA lands near the work rather than on it.** Cheapest of the three
   to fix.

---

## The smallest next improvement

**Capture the reason for parking — one optional line in the snooze dialog.**

The snooze modal already asks for a date. Adding one free-text field —
"What are you waiting for?" — stored on the obligation, changes the card
from:

> You parked NVDA 11 days ago.

to:

> You parked NVDA 11 days ago, waiting for the Q3 print.

That is a different product. It needs no model, no inference, and no new
table: a nullable `note` column on `memory_obligations` and one input. It
is the highest ratio of perceived intelligence to invented truth available,
because **the user supplies the truth** — which is precisely the constraint
every other improvement runs into.

Second cheapest: fix the CTA to open the idea. Third: thesis versioning, so
"the idea was edited" becomes "the bear case was rewritten".
