# Ideas feed reads holdings without an organization filter

**Status**: escalated, NOT fixed. Do not patch these queries in isolation —
the tenant-scoping audit owns the canonical fix across the repository.
**Found**: 2026-08-26, during the Ideas/Explore quality review (`feat/ideas-quality`).
**Branch that found it**: `feat/ideas-quality`. That branch deliberately changed
none of the code below.

---

## 1. Why this was left alone

The obvious patch is three `.eq()` calls. It was not applied because the same
pattern almost certainly recurs outside the Ideas feed, and a per-site fix would
close the two instances a reviewer happened to look at while leaving the class
open — and would also consume the evidence the audit needs to size the problem.
The `portfolios!inner(organization_id)` join used by the mobile hooks (§6) is
probably the canonical answer, but "probably" is not a basis for a repo-wide
convention.

---

## 2. Exact locations

### 2.1 `generateStaleCoverageSignals` — the one that renders

`src/hooks/ideas/useSignalCards.ts:129-141`

```ts
async function generateStaleCoverageSignals(userId: string, orgId: string) {
  // Get user's portfolio holdings
  const { data: holdings } = await supabase
    .from('portfolio_holdings')
    .select('asset_id, assets:asset_id(id, symbol, company_name)')
  //  ^ no .eq('organization_id', …), no portfolios!inner join, no filter at all
```

The function *takes* `orgId` and never applies it to this query. It applies it
to three of the four activity probes below.

### 2.2 The activity probes — RESOLVED on main

**Closed 2026-08-27.** The Quick Thoughts tenant-boundary work (#211, #212)
added `.eq('organization_id', orgId)` to the `recentThoughts` probe, which was
the one gap here. All four probes are scoped now:

| Probe | Table | Org filter |
|---|---|---|
| `recentThoughts` | `quick_thoughts` | `.eq('organization_id', orgId)` — **fixed on main** |
| `recentContributions` | `asset_contributions` | `.eq('organization_id', orgId)` |
| `recentNotes` | `asset_notes` | `.eq('organization_id', orgId)` |
| `recentTargets` | `analyst_price_targets` | `.eq('organization_id', orgId)` |

The asymmetry described in §4 no longer applies to this section. It still
applies to the `portfolio_holdings` reads in §2.1 and §2.3, which remain open.

### 2.3 `holdingsQuery` — the one that ranks

`src/hooks/ideas/useIdeasFeed.ts:108-124`

```ts
const holdingsQuery = useQuery({
  queryKey: ['feed-context', 'holdings', user?.id],
  queryFn: async () => {
    const { data } = await supabase
      .from('portfolio_holdings')
      .select('asset_id, portfolios!inner(id)')
    //  ^ joins portfolios but selects only `id`, so there is nothing to filter on
```

Note this one *already joins* `portfolios` — it selects `id` rather than
`organization_id`, so the join exists and the filter does not. Compare §6.

---

## 3. Query keys, and one that is wrong independently

| Key | Includes org? | Consequence |
|---|---|---|
| `['signal-cards', user?.id, currentOrgId]` (`useSignalCards.ts:216`) | yes | refetches on org switch, so the card set is at least recomputed |
| `['feed-context', 'holdings', user?.id]` (`useIdeasFeed.ts:109`) | **no** | the cached `heldAssetIds` set survives an org switch untouched |
| `['feed-context', 'followed', user?.id]` (`useIdeasFeed.ts:95`) | no | follows are user-level, so this is probably correct; confirm |

The holdings key is a second, independent defect: even once the query is scoped,
a key without the org id will serve one org's holdings to another until the
`staleTime` (60s) lapses.

---

## 4. `currentOrgId` behaviour

Both hooks read `currentOrgId` from `useOrganization()`.

- `useSignalCards` is `enabled: !!user` — **not** `!!user && !!currentOrgId`. It
  runs before an org resolves, returns `[]` from the guard on line 221, then
  refetches when the key changes. No leak, but the gate does not match the
  function's own precondition.
- `useIdeasFeed`'s feed queries use `.eq('organization_id', ctx.organizationId!)`
  on all five content sources (`useIdeasFeed.ts:351, 403, 466, 579, 621`). The
  post content itself is correctly scoped. Only the holdings *context* is not.

So the tenant boundary holds for what the feed **shows** and fails for what the
feed **knows**.

---

## 5. What can influence what

### 5.1 `stale_coverage` cards — foreign influence, and a rendered symbol

`heldAssets` is built from every `portfolio_holdings` row RLS admits, which for
a user in more than one organization spans all of them. `staleAssets` is then
`heldAssets` minus assets with recent activity, where "recent activity" is
measured **in the current org only** for three of the four probes.

The failure is therefore not merely "an extra asset appears". It is
*systematically biased*: an asset held in org B, worked on actively in org B,
has none of that work visible to the org-A queries — so it is maximally likely
to be classified stale and surfaced in org A's feed, reading

> `<SYMBOL>: held position with no recent activity`
> `No posts, thesis updates, notes, or target changes on <SYMBOL> in the last 30 days.`

Both statements are false in the org the reader is looking at, because the
position is not held there.

**Is a foreign-tenant field rendered?** A qualified yes, and the qualification
is the part the audit should settle:

- The strings on screen are `assets.symbol` and `assets.company_name`.
  `assets` is not in `ORG_SCOPED_TABLES` and has 158 unfiltered `.from('assets')`
  call sites across the app, so it appears to be a shared reference table — the
  symbol itself is probably not tenant-private.
- What *is* tenant-private is the **existence of the `portfolio_holdings` row**.
  Rendering the symbol asserts "somebody you can see holds this", which is a
  fact about another organization's book, inferable from the card alone.
- The `quick_thoughts` probe is unscoped in the other direction: a thought
  written in org B can *suppress* a card in org A. That is a read of foreign
  content influencing org-A output, even though the thought is never displayed.

Confirm against the live database rather than the migrations — `docs/tickets`
and prior work both record that migrations do not describe production. In
particular: whether `portfolio_holdings` has RLS at all, what its policy admits,
and whether `assets` is genuinely global.

### 5.2 `heldAssetIds` — influence only, nothing rendered

`useIdeasFeed.ts` uses the set purely inside `scoreFeedItem` as a relevance
boost. No foreign row is displayed and no foreign row can create a feed item —
the five content queries are all org-filtered. The effect is that a post about
an asset held in another org ranks higher in this org than it should.

Lower severity than §5.1, same root cause, and it should be fixed by the same
convention.

---

## 6. The pattern that appears to be canonical

`portfolio_holdings` carries no `organization_id` of its own; the org lives on
`portfolios`. The mobile hooks already do this and should be the reference:

```ts
// src/hooks/mobile/usePortfolioLenses.ts:332-333
.select('portfolio_id, asset_id, shares, price, date, assets(symbol, company_name), portfolios!inner(name, organization_id)')
.eq('portfolios.organization_id', currentOrgId!)

// src/hooks/mobile/useScenarioCards.ts:49-50
.select('asset_id, portfolios!inner(name, organization_id)')
.eq('portfolios.organization_id', currentOrgId!)
```

---

## 7. The lint does not cover any of this

`scripts/frontend-tenant-lint.mjs` only inspects tables in `ORG_SCOPED_TABLES`
(`scripts/frontend-tenant-lint.mjs:35`). `portfolio_holdings`, `quick_thoughts`
and `assets` are all absent from that set, so none of the queries above is
reported by `npm run tenant:lint:frontend` — they are invisible to the guard,
not merely un-baselined.

Separately, and pre-existing on `main`: that script currently exits non-zero
(30 P0 against a `BASELINE_P0` of 17). It is not part of `npm run guard`, so
nothing in CI runs it.

---

## 8. Suggested scope for the audit

1. Every `.from('portfolio_holdings')` call site in `src/`, with the
   `portfolios!inner(organization_id)` join treated as the fix.
2. Every `.from('quick_thoughts')` call site — the org column exists there
   (migration `20260605120000`) so the fix is a plain `.eq`.
3. Whether `assets` is genuinely a global reference table, recorded somewhere
   durable so the next reviewer does not have to re-derive it from 158 call
   sites.
4. Whether `ORG_SCOPED_TABLES` should gain these tables, and what that does to
   `BASELINE_P0`.
5. Whether react-query keys across the app carry the org id wherever the data
   they hold is org-scoped. §3 suggests at least one does not.
