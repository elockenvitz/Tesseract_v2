# One ranking engine

**Status**: the single named architecture lane for feed ordering. Nothing
below is scheduled; this document exists so that the next ranking defect is
routed here instead of being patched twice.
**Consolidated**: 2026-09-10, backlog closure.
**Supersedes as a work item**: `docs/tickets/ideas-ranking-divergence.md`,
which remains as the evidence and is not edited.

---

## 1. Why this document exists

Ranking defects kept arriving one at a time, and each one is individually
small enough to patch. That is the trap. Tesseract has two ranking systems —
not two configurations of one, two implementations sharing no code — so every
patch is a choice between fixing one shell and leaving the other wrong, or
fixing both and adding a third place the next person has to remember.

| | Mobile | Desktop |
|---|---|---|
| Entry point | `rankFeed` → `priorityFor` | `useIdeasFeed` → `scoreFeedItem` |
| File | `src/lib/signals/feed-priority.ts` | `src/hooks/ideas/useIdeasFeed.ts` |
| Shape | tier first, then weighted score | one weighted score |
| Components | severity, recency, ownership, staleness | freshness, authorRelevance, assetRelevance, engagement, contentQuality |
| Suppression | judgment policy: dismiss, snooze | none |
| Diversity | run rule with `DIVERSITY_TOLERANCE` | `applyDiversity`, no equivalent guard |

The consequence is a correctness problem, not a styling one: the same account
on two devices gets two different orders, and a signal settled on the phone
reappears on the laptop.

**The rule this document establishes: a ranking change lands in one engine or
it waits for this lane. It does not land in two.**

---

## 2. What is consolidated into this lane

### 2.1 Recency-bounded candidate selection (desktop)

Every source query in `fetchFeedPage` is
`.order('created_at', desc).range(offset, offset + 19)`, and scoring is applied
to that window afterwards. So a signal can reorder a page but can never pull a
relevant item from page 3 onto page 1. For a reader whose covered names were
quiet this week, coverage relevance is invisible no matter how the weights are
set.

This is the item most likely to be mistaken for a weights problem and patched
as one. It is not: any real fix has to score a candidate set that was not
chosen by recency alone, which is a change to how the feed is *assembled*,
not to how it is ordered.

### 2.2 Two constants for one intent

Coverage relevance needed an additive lift of 0.12 on desktop and 0.10 on
mobile to express the same product intent, because the two scales differ.
Every future ranking input pays this tax twice, and the temptation each time
is to do it in one shell only. One engine would have one number.

### 2.3 Suppression is not portable

Judgment suppression — `judgmentApplies`, dismiss, snooze — exists only on
mobile. It removes cards rather than reordering them, so it is the divergence
a user can most clearly name, and it directly undercuts the judgment model
this product is built on.

### 2.4 Diversity has no counterpart

Mobile's run rule strips the coverage bonus before asking "is there a credible
alternative?" via `comparableTotal`, so coverage decides order without
deciding what counts as a competitor. Desktop's `applyDiversity` has no
equivalent guard because desktop has no equivalent rule.

---

## 3. What is NOT in this lane

Kept out deliberately, because folding them in is how a bounded lane becomes a
rewrite:

- **Cross-tenant correctness.** The unscoped `portfolio_holdings` reads that
  fed both rankers were a security defect, not a ranking one, and were fixed
  on their own with a ratchet
  (`src/hooks/ideas/__tests__/feed-holdings-org-scope.test.ts`). Do not wait
  for this lane to fix that class elsewhere.
- **Dead or mislabelled actions.** The `Open idea` dead primary is closed. The
  remaining action-grammar work — making routability structural rather than
  advisory — is `docs/tickets/feed-primary-action-dead-ends.md` §4.2–4.3 and
  belongs to the action grammar, not to ordering.
- **Coverage relevance itself.** `lib/signals/coverage-relevance.ts` is one
  module feeding both shells and it holds. It does not depend on this lane.

---

## 4. The sequence that keeps it safe

Order matters more than usual here, because the failure mode is an unreviewed
reordering of everybody's feed shipped under a smaller heading.

1. **Capture before/after ranked feeds** for real accounts on both shells.
   Without this, "the order changed" is unfalsifiable and every subsequent
   step is unreviewable. This is the step most likely to be skipped and the
   one that makes the rest possible.
2. **Port judgment suppression to desktop.** It removes cards rather than
   reordering them, so its effect is legible in the captures from step 1, and
   it is the divergence users can name.
3. **Fix desktop candidate selection** (§2.1), because until the candidate set
   is honest, tuning weights against it measures the wrong thing.
4. **Fold `scoreFeedItem`'s components into `priorityFor`'s weights**,
   retuning deliberately and reviewing the diff on the captured feeds.
5. **Delete the loser.** Two engines with one of them unused is the same
   problem waiting.

---

## 5. The trigger for starting it

Not scheduled, and it should not be started to tidy the backlog. Start it when
any of these is true:

- A third ranking input is required. Coverage cost two projections and one
  shared module; the next one pays the same tax, and paying it twice knowingly
  is the point at which this becomes cheaper than not doing it.
- A user reports the two-device ordering difference. It is currently latent
  because few readers use both shells on the same account.
- Judgment suppression is needed on desktop for any reason. That is step 2
  above, and doing it outside this lane means doing it again.
