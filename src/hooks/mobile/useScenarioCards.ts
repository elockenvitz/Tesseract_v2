import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { financialDataService } from '../../lib/financial-data/browser-client'
import { buildScenarioGapCard, type ScenarioCase } from '../../lib/signals/builders/scenarioGap'
import type { PortfolioRef } from '../../lib/signals/contract'
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
export function useScenarioCards(options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  return useQuery<CardResult[]>({
    queryKey: [...SCENARIO_CARDS_KEY, currentOrgId],
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
      const { data: rows, error } = await supabase
        .from('analyst_price_targets')
        .select(`
          id, user_id, asset_id, price, probability, timeframe, reasoning, is_official, created_at, updated_at,
          scenarios(name),
          assets!inner(id, symbol, company_name)
        `)
        .eq('organization_id', currentOrgId!)
        .limit(500)

      if (error) throw error

      const targets = (rows ?? []) as any[]
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
        .select('asset_id, shares, price, date, portfolios!inner(id, name, organization_id)')
        .eq('portfolios.organization_id', currentOrgId!)
        .in('asset_id', assetIds)

      if (holdingsError) throw holdingsError

      /**
       * The latest snapshot per (asset, portfolio).
       *
       * `portfolio_holdings` is a time series — one row per holding per date —
       * so a name held for six months has six months of rows. Summing them
       * would report a position several times over. Keeping the newest `date`
       * per pair is what `usePortfolioLenses` does with the same table.
       */
      const latest = new Map<string, any>()
      for (const h of (holdings ?? []) as any[]) {
        if (!h.asset_id || !h.portfolios?.name) continue
        const key = `${h.asset_id}:${h.portfolios.id ?? h.portfolios.name}`
        const prev = latest.get(key)
        if (!prev || String(h.date ?? '') > String(prev.date ?? '')) latest.set(key, h)
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

      // Group the ladder per asset.
      interface Group {
        assetId: string
        symbol: string
        companyName: string | null
        cases: ScenarioCase[]
        statedAt: string
      }
      const byAsset = new Map<string, Group>()
      for (const t of targets) {
        const symbol = t.assets?.symbol
        if (!t.asset_id || !symbol) continue
        const g: Group = byAsset.get(t.asset_id) ?? {
          assetId: t.asset_id,
          symbol,
          companyName: t.assets?.company_name ?? null,
          cases: [],
          statedAt: t.updated_at || t.created_at,
        }
        const price = Number(t.price)
        if (Number.isFinite(price) && price > 0) {
          g.cases.push({
            // The scenario name is the analyst's own word — "Uber Bull" is a
            // real one in this database. Never normalise it to bear/base/bull.
            name: t.scenarios?.name || 'Case',
            id: t.id,
            userId: t.user_id ?? null,
            price,
            probability: t.probability != null ? Number(t.probability) : null,
            timeframe: t.timeframe ?? null,
            reasoning: t.reasoning ?? null,
          })
        }
        const stamp = t.updated_at || t.created_at
        if (stamp && stamp > g.statedAt) g.statedAt = stamp
        byAsset.set(t.asset_id, g)
      }

      // A ladder needs at least two rungs, so anything smaller is not worth a
      // quote request. Quotes are the expensive part.
      const candidates = [...byAsset.values()].filter(g => g.cases.length >= 2)
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
          statedAt: g.statedAt,
        }),
      )
    },
  })
}
