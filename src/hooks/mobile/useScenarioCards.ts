import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { buildScenarioGapCard } from '../../lib/signals/builders/scenarioGap'
import { frameworkCapitalFor } from '../../lib/signals/framework-break'
import type { CurrentBook } from '../../lib/holdings/portfolio-context'
import type { PortfolioRef } from '../../lib/signals/contract'
import { latestSnapshotRows } from '../../lib/holdings/latest-snapshot'
import { selectCurrentLadders, type TargetRow } from '../../lib/signals/current-ladder'
import type { CardResult } from '../../lib/signals/contract'
import { SCENARIO_CARDS_KEY } from '../../lib/signals/scenario-cards-key'

/**
 * Scenario ladders against the live tape.
 *
 * Reads `analyst_price_targets` as what it actually is — one row per scenario,
 * each with a probability — rather than collapsing it to a single "official,
 * most recent" number the way every other surface does. That collapse is why
 * nobody has noticed TSLA trading below its own bear case.
 *
 * Quotes come from `getQuote`, which now returns null when it does not know.
 * That matters here more than anywhere: the entire card is a comparison
 * against the tape, so a fabricated price would produce a confident claim
 * about a number nobody measured. Only 68 of 911 assets carry a stored
 * `current_price`, so most names will simply have no card, which is correct.
 */
export function useScenarioCards(options?: {
  enabled?: boolean
  /**
   * The canonical current book, from whoever already loaded it.
   *
   * Passed in rather than fetched: `usePortfolioLenses` reads the org's
   * holdings once and this hook's own holdings query is narrowed to the
   * scenario assets, so it has the positions but not the denominators. Taking
   * the book as an argument is what makes a size-aware framework break cost
   * zero additional requests.
   *
   * Optional, and absent is a real state — a caller without holdings gets
   * exactly the cards this hook produced before, unheld framing included.
   */
  book?: CurrentBook | null
}) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null
  const book = options?.book ?? null

  return useQuery<CardResult[]>({
    /**
     * A digest of the book, not the book.
     *
     * React Query hashes the key, and hashing several thousand positions on
     * every render would cost more than the derivation it guards. The snapshot
     * date and the position count change together whenever the book does,
     * which is the only thing this query needs to notice.
     */
    queryKey: [...SCENARIO_CARDS_KEY, currentOrgId, book?.asOf ?? null, book?.positions.length ?? 0],
    enabled: (options?.enabled ?? true) && !!currentOrgId,
    staleTime: 5 * 60 * 1000,
    /**
     * Two retries, not the app-wide one.
     *
     * The failure this guards against is a token refresh finishing a moment
     * after the query fired, and React Query's backoff means attempt two lands
     * well inside a second. One retry is enough for that; two costs nothing on
     * the path where the desk is genuinely empty, because an empty desk
     * succeeds on the first attempt and never retries at all.
     */
    retry: 2,
    queryFn: async () => {
      /**
       * A FAILED query is not an empty desk, and this is why the card vanished.
       *
       * ── The bug, exactly ──────────────────────────────────────────────
       *
       * This destructured `data` and threw the `error` away. Every way this
       * request can fail — an expired JWT mid-refresh, an RLS denial, a
       * network blip — returns `data: null`, so `rows` was `undefined`,
       * `targets` was `[]`, and the very next line returned `[]` as a
       * SUCCESSFUL result.
       *
       * React Query then cached that empty array under the final key,
       * `['scenario-cards', orgId]`. The org id does not change afterwards, so
       * the key never changes; `staleTime` is five minutes and this feed
       * deliberately does not refetch on mount or on focus. Nothing recovered
       * it. Case vs Price was gone for the rest of the visit and Curate
       * correctly reported zero, because the candidate genuinely was not there.
       *
       * That is the shape of "present after login, absent after a hard
       * reload": a fresh login holds a fresh access token, while a reload
       * restores a stored one that supabase-js may still be refreshing when
       * this query fires. The request loses the race, returns no rows without
       * raising anything this code looked at, and the failure is cached as an
       * answer.
       *
       * Throwing is the whole fix. React Query retries a rejected query and
       * marks it an error rather than a result, so a lost race becomes a
       * second attempt a moment later — by which time the token is refreshed —
       * and an empty desk still means an empty desk.
       */
      /**
       * Every applicable row, in a defined order — not an arbitrary 500.
       *
       * ── The defect this replaces ─────────────────────────────────────────
       *
       * `.limit(500)` with NO `.order()`. In SQL a LIMIT without an ORDER BY
       * does not define WHICH rows come back: Postgres is free to return them
       * in whatever order the plan produces, and that order changes as rows
       * are inserted, updated and vacuumed. So on an org whose ladder rows
       * exceed 500, the set of assets that reached the builder was chosen
       * arbitrarily and could differ between two loads seconds apart.
       *
       * That is exactly the reported behaviour, and it is the only place in
       * this pipeline where a valid candidate can vanish: everything
       * downstream — `diversify`, the Curate filter, `rankFeed` — reorders but
       * never drops, and the Curate predicate runs over the FULL pool before
       * ranking. A name that fell outside the arbitrary 500 had no card to
       * find, so `Curate → Case vs Price` correctly reported zero for a
       * finding that genuinely qualified.
       *
       * ── Why paging rather than a bigger number ───────────────────────────
       *
       * Raising 500 to 5000 leaves the same defect with a higher threshold and
       * no guarantee. What this needs is every row for the org, so the answer
       * does not depend on how many ladders the desk happens to keep.
       * `PAGE` is a transport detail — how much comes back per request — not a
       * cap on the answer: the loop continues while a full page arrives, so it
       * stops when the data does.
       *
       * `.order('asset_id').order('id')` makes the paging correct as well as
       * deterministic. Paging with `.range()` over an unordered query can
       * return the same row twice and skip another, because each request is a
       * fresh plan. Ordering by a unique column last makes the sequence total,
       * so the pages tile the set exactly.
       *
       * `SAFETY_ROWS` is a runaway guard, not a product limit — an org would
       * need 20,000 ladder rows to reach it. If it ever trips, that is a data
       * problem worth seeing rather than a feed silently missing names, so it
       * throws instead of returning what it has.
       */
      const PAGE = 1000
      const SAFETY_ROWS = 20_000
      const rows: any[] = []
      for (let from = 0; ; from += PAGE) {
        if (from >= SAFETY_ROWS) {
          throw new Error(
            `scenario cards: more than ${SAFETY_ROWS} price-target rows for this org`,
          )
        }
        const { data: page, error } = await supabase
          .from('analyst_price_targets')
          .select(`
            id, user_id, asset_id, price, probability, timeframe, reasoning, is_official, created_at, updated_at,
            scenarios(name),
            assets!inner(id, symbol, company_name)
          `)
          /**
           * NO client-side org filter, and this is the bug that outlived every
           * other fix.
           *
           * RLS on this table is `is_active_member_of_current_org() AND
           * organization_id = current_org_id()` — see
           * `20260425120000_org_scope_price_targets.sql`. The org scoping is
           * already done, by the SERVER, from `users.current_organization_id`.
           *
           * This query then intersected that with the CLIENT's org id from
           * `OrganizationProvider`, which is a different value whenever the two
           * disagree: while the membership query is loading the provider
           * exposes the unverified cached id, and after a self-heal it exposes
           * `userOrgs[0]` before `set_current_org` has persisted the change.
           * Two org ids joined by an AND return zero rows — and zero rows is
           * indistinguishable from an empty desk, so the feed showed nothing
           * and Curate correctly reported nothing.
           *
           * `useAnalystPriceTargets`, which powers Review Cases, never applied
           * a second filter. That is why the drawer kept showing cases for an
           * asset the feed had no card for. One source of truth for org scope,
           * and it is RLS.
           */
          // Total and stable: `id` is unique, so no two rows tie and the pages
          // cannot overlap or leave a gap.
          .order('asset_id', { ascending: true })
          .order('id', { ascending: true })
          .range(from, from + PAGE - 1)

        if (error) throw error
        const batch = (page ?? []) as any[]
        rows.push(...batch)
        if (batch.length < PAGE) break
      }

      const targets = rows
      // A genuine empty desk. Distinguishable from the above only because the
      // error was checked first.
      if (!targets.length) return []

      // Which of these do we hold, and where. The stake is what turns a
      // valuation observation into something with consequences.
      const assetIds = [...new Set(targets.map(t => t.asset_id).filter(Boolean))]
      // Same rule, lower stakes: a failed holdings read would silently claim
      // every name is unheld, which changes what the card says about the
      // reader's exposure. Better to retry than to under-report a position.
      const { data: holdings, error: holdingsError } = await supabase
        .from('portfolio_holdings')
        /**
         * `id`, `shares`, `price` and `date` as well as the name, so the chip
         * can DISCLOSE rather than just count.
         *
         * "2 portfolios" was inert text stating a number the reader
         * immediately wants to expand. `SignalCardView` already renders a
         * disclosure for any context chip carrying `portfolios` — the same one
         * `activeRisk` and the legacy builders use — so this card only had to
         * supply the books it already knew about. No new component, no second
         * drawer, no extra query: these are rows this hook was already
         * fetching to produce the count.
         *
         * `shares * price` is the position's value on its snapshot date. Both
         * columns are on the row and `usePortfolioLenses` already reads them
         * the same way. Nothing is derived that the table does not state — no
         * weights, no exposure percentages, no long/short flag, because this
         * table carries none of them and inventing one would be worse than an
         * absent field.
         */
        .select('asset_id, portfolio_id, shares, price, date, portfolios!inner(id, name, organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        .in('asset_id', assetIds)

      if (holdingsError) throw holdingsError

      /**
       * The latest snapshot per PORTFOLIO, from the one shared definition.
       *
       * `portfolio_holdings` is a time series — one row per holding per date —
       * so a name held for six months has six months of rows, and summing them
       * reports a position several times over.
       *
       * ── Why the newest row per (asset, portfolio) is not the same thing ──
       *
       * That was the rule here, and it is subtly wrong in one direction that
       * matters: it resurrects CLOSED positions. If a book's latest snapshot is
       * 1 August and a name last appeared in it on 1 July, the pair's newest row
       * is that July row — so the card discloses a position the desk exited a
       * month ago, with a value to go with it.
       *
       * `latestSnapshotRows` groups by portfolio and keeps only the rows
       * belonging to that portfolio's most recent date, which drops the name
       * exactly when the desk dropped it. Grouped per portfolio rather than
       * globally because books are uploaded on different schedules.
       *
       * `guard:holdings` is what caught this: an audit found 22 of 27
       * aggregating query sites had written their own date rule, so the helper
       * exists to stop the next one drifting again. This was the 23rd.
       */
      const latest = new Map<string, any>()
      for (const h of latestSnapshotRows((holdings ?? []) as any[])) {
        if (!h.asset_id || !h.portfolios?.name) continue
        // One entry per (asset, book). The snapshot filter has already removed
        // the other dates; this only guards a book listing a name twice on the
        // same date, which would otherwise disclose it twice.
        const key = `${h.asset_id}:${h.portfolios.id ?? h.portfolios.name}`
        if (!latest.has(key)) latest.set(key, h)
      }

      const heldIn = new Map<string, PortfolioRef[]>()
      for (const h of latest.values()) {
        const list = heldIn.get(h.asset_id) ?? []
        const shares = Number(h.shares)
        const px = Number(h.price)
        list.push({
          id: h.portfolios.id ?? undefined,
          name: h.portfolios.name,
          // Only when both halves are real. A partial row discloses the book
          // it is in and says nothing about size, which is honest.
          ...(Number.isFinite(shares) && Number.isFinite(px) && shares !== 0
            ? { valueUsd: shares * px }
            : {}),
        })
        heldIn.set(h.asset_id, list)
      }

      /**
       * The CURRENT framework per asset, from the one shared definition.
       *
       * This used to be a bespoke grouping right here: every row became a
       * rung, so three generations of a Bull target were three Bull rungs and
       * two analysts' Bear estimates were two Bear rungs. The ladder's low and
       * high — the entire claim of this card — could be values nobody
       * currently holds, and `cases.length >= 2` could be satisfied by two
       * copies of one case at one price.
       *
       * `selectCurrentLadders` is what Review Cases means by "the cases", in
       * one place: one rung per scenario, official first, then newest, then a
       * total tiebreak on id. The feed no longer reconstructs current meaning
       * from raw history; it consumes the same answer the drawer shows.
       */
      const ladders = selectCurrentLadders(rows as TargetRow[])
      const candidates = ladders.filter(l => l.valid)

      if (!candidates.length) return []

      const quotes = await Promise.all(
        candidates.map(async g => {
          try {
            return { g, quote: await financialDataService.getQuote(g.symbol) }
          } catch {
            return { g, quote: null }
          }
        }),
      )

      return quotes.map(({ g, quote }) =>
        buildScenarioGapCard({
          assetId: g.assetId,
          symbol: g.symbol,
          companyName: g.companyName,
          // Null quote flows straight through as an unusable price and is
          // suppressed as quote_unavailable, with the entity logged. It is
          // never replaced with a stored current_price: that column is not
          // dated, so a claim resting on it could not be checked for
          // freshness.
          price: quote?.price ?? 0,
          priceAsOf: quote?.timestamp ?? '',
          cases: g.cases,
          heldIn: heldIn.get(g.assetId) ?? [],
          statedAt: g.updatedAt,
          /**
           * The capital behind the break, or null when nobody owns it.
           *
           * Null keeps the card exactly as it was. The builder does no weight
           * math with this — it is the Stage 1 derivation, already chosen down
           * to one book by `frameworkCapitalFor`.
           */
          capital: frameworkCapitalFor(book, g.assetId),
        }),
      )
    },
  })
}
