# Asset experience: load depth, and how to profile it

Written 2026-11-14, on `discovery/asset-page-2`.

**No measurement was taken.** No browser was available in this session, so
nothing below reports a millisecond, and nothing in the branch claims a
measured improvement. What is reported is **depth**: how many database round
trips the reader waits through in series before a surface can answer. Depth
is readable from the code and provable with a test, and it is the thing a
profile would have to point at anyway.

Two serializations were removed on that basis. The rest is a map and a
procedure.

---

## 1. What the reader waits for, by surface

### Dashboard first paint

`DashboardNext` → `useDesktopAttentionFeed('all')` → `useDesktopCandidates`.

Four producer groups, started together, plus the attention feed:

| producer | reads | internal depth |
| --- | --- | --- |
| `useDesktopIdeasFeed('all')` | paged | 1 wave |
| `usePortfolioLenses` | 6 | shallow |
| `useScenarioCards` | 2 | shallow |
| `useDerivedInsights` | 13 | **~8 layers in series** |
| `useAttention` | 31 | 1 layer, after this branch |

First paint is **latched**: `useDesktopCandidates` reports `isLoading` until
the ideas feed, the lenses, the scenarios and the derived insights have each
resolved once. That latch is deliberate and documented in the hook — without
it the feed painted, then reordered when the lenses landed, then reordered
again for the scenarios. So first paint costs `max()` of the four, and the
longest pole is whichever producer is deepest, not whichever is largest.

`useAttention` is **not** in the latch, so it cannot hold the paint. Its 31
reads still compete for the same connection budget.

### Asset Workspace (the embedded pane)

`AssetWorkspace` → `useAssetWorkspace(assetId, symbol, focus)`.

Eight reads in **one** `Promise.all`, one layer deep, `staleTime` 60s, keyed
`[prefix, assetId, symbol, days, orgId]`. Plus `useThesisReviews`, one read,
independent, started in the same render. No waterfall, and no `enabled` on
either hook that waits for the other's data.

A second visit inside the `staleTime` issues **no** read at all and reports
no loading — covered by `src/hooks/__tests__/returning-does-not-rebuild-the-pane.test.tsx`.

### Canonical Asset Page

Reached through the same `useAssetWorkspace` key, so arriving from the pane
is a cache hit rather than a fetch.

### No model call on either path

Verified by search: nothing under `components/asset-v2`, `components/ideas-app`
or `components/dashboard-next` calls `ai-chat`, `functions.invoke` or any
streaming helper. Workspace content is built from database rows by
`lib/asset-workspace/context.ts`. The brief's constraint here is already met,
and it should stay met: deterministic content must not acquire a model round
trip.

---

## 2. What was changed

Both are reorderings. Same queries, same filters, same results.

### `attention_user_state` was read ahead of thirteen collectors

It had its own `await` above `computeAttention`'s fan-out, so nothing else
started until it came back. No collector reads it: it is used after they all
return, to drop what the reader dismissed or snoozed and to merge read state
into the rest. One full round trip on the critical path of every Dashboard
load and every refetch, for a dependency that did not exist. It is now the
fourteenth member of the same `Promise.all`.

### A quick thought's context was four trips deep

`collectQuickThoughts` read the reader's own thoughts, then their holdings,
then their project assignments, then their portfolios — four in a row, where
only the teammate query at the end depends on any of them. Those four are now
one wave. This collector runs inside the fan-out, so its depth was the
fan-out's depth whenever it was the slowest member.

### How that is proved

`src/hooks/__tests__/attention-reads-do-not-queue.test.tsx`. It holds every
read open and never resolves it, then asserts which tables were **issued**: a
read parked behind an `await` cannot have been issued, so the recorded set is
exactly the feed's first layer. Before the change the whole set was
`['attention_user_state']`.

Both halves were re-broken to check the test sees it. Putting the user-state
read back in series reduced the wave to that one table and failed all four
assertions; re-serializing the holdings read failed the two that name
`quick_thoughts`.

---

## 3. Ranked hypotheses that still need a browser

**1. `useDerivedInsights` is the longest pole on Dashboard first paint.**
Roughly eight layers in series: `coverage` ∥ `portfolio_holdings_snapshots` ∥
`portfolio_holdings_positions` → `asset_contributions` ∥ `asset_notes` ∥
`quick_thoughts` → `audit_events` → `users` → `assets` →
`price_history_cache` count → the paged price reads → `trade_queue_items`.

Three of those layers look collapsible: `audit_events`, `users` and `assets`
each depend on the first two waves and **not on each other** (`audit_events`
and `assets` are both bounded by `universeIds`, `users` by the author ids from
`coverage`). Collapsing them into one wave would remove two round trips from
the latched path.

Not done here. It is a restructuring of the middle of a 600-line hook with
processing interleaved between the reads, it belongs in its own reviewable
change, and the measurement below should come first so the result is
attributable.

**2. The latch itself may be the perceived cost, not any one producer.**
Waiting for four producers to make the feed stable is a trade. If the profile
shows three of them land quickly and one does not, the answer may be to let
that one arrive into the list — which is how the machine families already
behave — rather than to make it faster.

**3. `useAttention`'s 31 reads cost the Dashboard something even unlatched.**
They cannot hold the paint, but they are in flight during it.

**4. Workspace render cost after the data lands.** Unmeasured, and the brief
is explicit that speculative memoization is the wrong starting point. Nothing
here suggests it is the problem.

---

## 4. The procedure

Run against the canonical dev server on **port 5190**. Do not start another;
one is already running.

### 4a. Dashboard first paint

1. Chrome, new profile or a hard reload with cache disabled, DevTools open.
2. **Network** tab, filter `rest/v1`, "Preserve log" off, throttling
   **Fast 4G** (the office network is not the measurement that matters).
3. Load `http://localhost:5190/` with the Dashboard tab active.
4. Record, from the Network panel:
   - the number of `rest/v1` requests before the feed renders its first card;
   - the **waterfall depth** — count the distinct start-time clusters, not the
     request count. Each cluster is one round trip the reader waited for;
   - the slowest single request, by table, and its `Waiting (TTFB)`;
   - the wall time from navigation to the first card.
5. **Performance** tab, record the same load. Read off: total scripting time,
   the longest task, and the time from the last `rest/v1` response to the
   first paint of a card. A large gap there means the cost is render, not
   fetch, and hypothesis 4 moves up.
6. Repeat warm (no cache disable). A warm load that is still slow is a
   `staleTime` question; a warm load that is fast means the cost is the cold
   fan-out.

To attribute hypothesis 1, read the cluster that contains
`audit_events` / `users` / `assets`: three clusters means the collapse is
worth two trips, one cluster means something else already serialized them.

### 4b. Asset Workspace, and the return trip

1. From the Dashboard, open a target-reached card into the work pane.
2. Record the `rest/v1` requests the pane issues. Expect **eight** for
   `useAssetWorkspace` plus one for `useThesisReviews`, in one cluster.
3. Press "Review the Case" to the canonical Asset Page. Expect **no new**
   `asset-workspace` reads inside 60s.
4. Return to the Dashboard. Expect no reads, no skeleton, the same selection,
   the same disclosure, and the scroll position restored.
5. Wait past 60s and return again. Expect a background refetch with **no**
   skeleton — the pane keeps its content while the data refreshes.

### 4c. What a claim needs

A number in this document needs: the surface, cold or warm, the throttling
profile, the wall time, the cluster count, and the slowest table. Anything
less is not attributable and should not be written down.

---

## 5. Adjacent, unfixed

- `generateAttentionId` awaits a `crypto.subtle.digest` **per item inside each
  collector's loop**, so the hashes are serialized on the main thread. Each
  collector is `limit(20)`, so this is bounded and almost certainly not worth
  changing, but it is main-thread work during the Dashboard's load.
- `useThesisReviews` selects every `thesis.reviewed` row for the org with no
  bound. Correct today and a scan that grows forever.
- `collectQuickThoughts` reads `portfolio_holdings` with no limit to build an
  id list. See the holdings-collapse defect class before touching it.
