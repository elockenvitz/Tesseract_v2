# `Open idea` is a dead primary, and the resolver cannot see it

**Status**: documented, NOT fixed. Owner: the Action Engine workstream.
**Found**: 2026-08-26, Ideas/Explore quality review (`feat/ideas-quality`).

Deliberately not patched in `buildIdeaCard`. The defect is that the truthfulness
guard has a hole in it, and a per-builder patch would close one symptom while
leaving the next builder free to reopen it.

---

## 1. The path, in full

**Builder** — `src/lib/signals/builders/ideas.ts:195`

```ts
actions(
  isTrade
    ? { id: 'primary', label: 'Open idea', inline: false }
    : { id: 'capture', label: 'Capture', inline: true },
  …
)
```

`trade_idea` and `pair_trade` therefore ship a primary whose action key is the
literal string `'primary'`.

**Action key** — `src/lib/signals/feed-actions.ts:33-44`

`'primary'` is not a member of `FeedActionKey`. It is not in the union, not in
the switch, and not in `SURFACE_HANDLED`.

**Resolver** — `src/lib/signals/feed-actions.ts:141`

```ts
default:
  return null
```

`resolveFeedAction('primary', …)` returns `null`, correctly.

**Surface** — `src/components/mobile/SignalCardSection.tsx:168-181`

```ts
const target = resolveFeedAction(actionId as FeedActionKey, { … })
if (target && onFeedAction) return onFeedAction(target)
if (actionId === 'capture') { return onCapture(…) }
onPrimary(c, actionId)          // ← 'primary' lands here
```

**Handler** — `src/components/mobile/MobileDashboard.tsx` (idea branch)

```ts
onPrimary={(_card, actionId) => {
  switch (actionId) {
    case 'share':       …
    case 'ask':         …
    case 'promote':     …
    case 'readthrough': …
    default: note('open')      // ← telemetry, and nothing else
  }
}}
```

`note()` records a dwell signal. No navigation, no sheet, no state change. The
primary button on every trade-idea and pair-trade card in the feed does nothing
a reader can perceive.

---

## 2. Why the existing guard did not catch it

`feedActionIsRoutable` (`feed-actions.ts:161`) exists precisely to stop a builder
declaring a label it cannot honour, and its doc comment says so. It works — but
only where a builder calls it. `contextualActions` in `legacy-kinds.ts` does;
`buildIdeaCard` constructs its actions directly and never asks.

So the guard is opt-in, and the one builder that skipped it is the one with the
dead button. That is the actual finding: **the routability check is a function a
builder may call, when it should be a property the action grammar enforces.**

`feedActionIsRoutable` also takes `key: string` rather than `FeedActionKey`,
deliberately — its own comment explains that a typo or an invented action is
exactly what it is checking for. `'primary'` is that invented action, and
nothing ran the check.

---

## 3. What the fix is not

Do not give `buildIdeaCard` a different action id and stop there. Candidates
that look right and are not:

- `open_asset` — in `SURFACE_HANDLED`, so `feedActionIsRoutable` returns `true`,
  but `resolveFeedAction` returns `null` and `SignalCardSection` has no branch
  for it. It falls through to `onPrimary` and does exactly what `'primary'`
  does now. The guard would pass and the button would still be dead.
- `open_item` — same shape, same outcome.
- `capture` — routes, and is wrong: a trade idea's primary should not be a note.

Two of the three would pass the guard while remaining dead ends, which is the
strongest evidence that `SURFACE_HANDLED` is asserting something the surface
does not actually implement.

---

## 4. Suggested scope

1. Decide what `Open idea` should reach. A trade idea has a `trade_queue_item`
   behind it; the desktop feed routes to the asset page with
   `defaultTab: 'trade-queue'` (`IdeasFeedPage.tsx:190`), which is a real
   destination and has no mobile equivalent registered in
   `lib/mobile/mobile-surfaces.ts`.
2. Make routability structural rather than advisory — a builder should not be
   able to emit a primary whose id is outside `FeedActionKey`.
3. Audit `SURFACE_HANDLED` against what `SignalCardSection` actually handles.
   Today it claims `open_asset`, `open_item` and `resolve`; the switch
   implements `capture` only, and everything else reaches `onPrimary`, where
   five of the seven call sites in `MobileDashboard` have a `default:` that
   does nothing.
4. The attention card's verbs (`approve`, `reject`, `mark_done`, `defer`,
   `resolve`) reach `onPrimary` the same way. On the recommendation path
   `MobileDashboard` handles them; on the generic `renderCard` path the
   `onPrimary` is `() => {}`. Same class, different card.

---

## 5. Related gaps already recorded

`feed-actions.ts:79-90` already documents `review_position` and `update_status`
as deliberately absent because no mobile surface can honour them. That is the
right treatment; this ticket is the case where a label shipped without it.
