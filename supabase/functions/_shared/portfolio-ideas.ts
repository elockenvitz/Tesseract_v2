/**
 * Portfolio holdings and a portfolio's ideas, as the retrieval tools need them.
 *
 * ── Why this module exists at all ────────────────────────────────────────
 *
 * It was written to fix one reported failure. A reader attached the Large Cap
 * Growth portfolio to a conversation and asked "what are my active ideas for
 * this portfolio?", and ACT AI answered that the portfolio lookup had failed
 * and it could not retrieve holdings or ideas. The production log says why:
 *
 *     ai-chat tool get_portfolio/holdings failed:
 *     column portfolio_holdings.weight does not exist
 *
 * Three separate defects stacked up behind that one sentence, and all three
 * live here now because all three are arithmetic and arithmetic can be
 * tested without a database:
 *
 *   1. THE COLUMN DOES NOT EXIST. `portfolio_holdings` holds `shares`,
 *      `price`, `cost` and `date`. There is no `weight`; weight is DERIVED,
 *      and the frontend has always derived it (`PortfolioTab.tsx:357`). The
 *      tool asked Postgres for a column the schema has never had, which is
 *      the schema-drift trap this codebase keeps meeting: the migrations do
 *      not describe production, so a column name must be read off the live
 *      database and not off a type.
 *
 *   2. ONE FAILED SUB-QUERY DISCARDED A GOOD RESULT. `get_portfolio`
 *      resolved the portfolio, then failed on holdings, then returned a flat
 *      error -- throwing away the name and id it already had. The model was
 *      told "this lookup FAILED", which is why it would not answer a
 *      question about ideas that never needed holdings in the first place.
 *      `degradedNote` exists so a half-answer stays an answer.
 *
 *   3. HOLDINGS WERE NOT COLLAPSED TO A SNAPSHOT. `portfolio_holdings` is
 *      dated and holds one row per asset PER DATE. Summing them double-counts
 *      every asset by however many snapshots it has -- the "portfolio
 *      holdings collapse" defect this codebase documents as present across
 *      most aggregating query sites. `currentSnapshot` is the same
 *      newest-row-per-asset rule as `src/lib/portfolio/currentHoldings.ts`,
 *      and a drift test reads that file to keep the two honest.
 *
 * ── And the question that was actually asked ─────────────────────────────
 *
 * "Active ideas for this portfolio" is not a holdings question. It was
 * unanswerable for a second reason: `get_idea_pipeline` could be scoped to
 * `mine` or `organization` and nothing else, so there was no way to ask it
 * about a portfolio at all, even though `trade_queue_items.portfolio_id`
 * exists and the tool already selected it.
 *
 * `categorizeIdeas` adds that, and keeps the three relationships APART,
 * because merging them is a false statement about the book:
 *
 *   associated   the idea names this portfolio. A real association.
 *   held         the idea is about an asset the portfolio holds, but names a
 *                different portfolio or none. NOT an association -- it is a
 *                reason the reader might care.
 *   elsewhere    neither. Visible, and nothing to do with this portfolio.
 *
 * Only the first is "an idea for this portfolio". A reader shown a merged
 * list of fourteen would reasonably believe their portfolio had fourteen
 * ideas against it when it has three.
 *
 * Pure. No Supabase client, no network, no Deno APIs — so vitest imports it
 * directly, which is how `research-results.ts` is already tested.
 */

/* ── Holdings ─────────────────────────────────────────────────────────── */

export interface HoldingRow {
  asset_id?: string | null;
  portfolio_id?: string | null;
  date?: string | null;
  shares?: number | string | null;
  price?: number | string | null;
  cost?: number | string | null;
  asset?: {
    id?: string | null;
    symbol?: string | null;
    company_name?: string | null;
    sector?: string | null;
  } | null;
}

export interface WeightedHolding {
  asset_id: string | null;
  symbol: string | null;
  company: string | null;
  sector: string | null;
  shares: number | null;
  price: number | null;
  market_value: number | null;
  /** Share of the snapshot's total market value, or null when it cannot be computed. */
  weight_pct: number | null;
  as_of: string | null;
}

export interface HoldingsSnapshot {
  as_of: string | null;
  holdings: WeightedHolding[];
  total_market_value: number | null;
  /** Rows dropped because they carried no asset. */
  rows_without_asset: number;
  /** Rows kept but unpriced, so they hold no weight. */
  rows_without_price: number;
  /** Earlier snapshots collapsed away, as a fact rather than a silent filter. */
  superseded_rows: number;
  /**
   * Stated whenever a weight was derived, because it was: these are marks on
   * the stored snapshot date, not live prices, and the provenance rule in
   * this codebase is that a figure shown to a reader must be traceable.
   */
  weight_basis: string | null;
}

/** A number, or null. Postgres numerics arrive as strings over PostgREST. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Newest row per asset.
 *
 * Mirrors `currentHoldings` in `src/lib/portfolio/currentHoldings.ts`. It does
 * NOT trust the caller's ordering, unlike that one: this runs against a query
 * whose ORDER BY was wrong for two years, so the date comparison happens here
 * where a test can see it. A row with no date loses to any dated row and wins
 * over nothing, which keeps an undated straggler from hiding a real snapshot.
 */
export function currentSnapshot(rows: readonly HoldingRow[] | null | undefined): {
  kept: HoldingRow[];
  superseded: number;
  withoutAsset: number;
} {
  if (!rows?.length) return { kept: [], superseded: 0, withoutAsset: 0 };

  const best = new Map<string, HoldingRow>();
  let withoutAsset = 0;
  let considered = 0;

  for (const row of rows) {
    const id = row?.asset_id ?? row?.asset?.id ?? null;
    if (!id) {
      withoutAsset++;
      continue;
    }
    considered++;
    const key = String(id);
    const held = best.get(key);
    if (!held) {
      best.set(key, row);
      continue;
    }
    if (isNewer(row.date ?? null, held.date ?? null)) best.set(key, row);
  }

  const kept = [...best.values()];
  return { kept, superseded: considered - kept.length, withoutAsset };
}

/** Is `a` a later snapshot than `b`? An absent date is older than any date. */
function isNewer(a: string | null, b: string | null): boolean {
  if (a === b) return false;
  if (!a) return false;
  if (!b) return true;
  return a > b;
}

/**
 * Derive weights for one portfolio's current snapshot.
 *
 * Weight is `shares * price` over the snapshot total, which is what
 * `PortfolioTab` computes and therefore what the reader has already seen on
 * screen. Anything else would put two different numbers in front of them for
 * the same holding.
 *
 * An unpriced row keeps its place in the list with `weight_pct: null` rather
 * than being dropped or counted as zero: a holding the desk owns and has no
 * mark for is a fact, and silently removing it would make the weights of
 * everything else add to 100% of a smaller book.
 */
export function weightHoldings(
  rows: readonly HoldingRow[] | null | undefined,
  limit = 15,
): HoldingsSnapshot {
  const { kept, superseded, withoutAsset } = currentSnapshot(rows);

  if (kept.length === 0) {
    return {
      as_of: null, holdings: [], total_market_value: null,
      rows_without_asset: withoutAsset, rows_without_price: 0,
      superseded_rows: superseded, weight_basis: null,
    };
  }

  const priced = kept.map((row) => {
    const shares = num(row.shares);
    const price = num(row.price);
    const mv = shares !== null && price !== null ? shares * price : null;
    return { row, shares, price, mv };
  });

  const total = priced.reduce((sum, p) => sum + (p.mv ?? 0), 0);
  const haveTotal = total > 0;

  /* The latest date actually present, so "as of" is read off the data and
     never assumed to be today. */
  const asOf = kept.reduce<string | null>(
    (latest, row) => (isNewer(row.date ?? null, latest) ? row.date ?? null : latest),
    null,
  );

  const holdings: WeightedHolding[] = priced
    .map(({ row, shares, price, mv }) => ({
      asset_id: row.asset_id ?? row.asset?.id ?? null,
      symbol: row.asset?.symbol ?? null,
      company: row.asset?.company_name ?? null,
      sector: row.asset?.sector ?? null,
      shares,
      price,
      market_value: mv === null ? null : round2(mv),
      weight_pct: mv !== null && haveTotal ? round2((mv / total) * 100) : null,
      as_of: row.date ?? null,
    }))
    .sort((a, b) => (b.market_value ?? -1) - (a.market_value ?? -1))
    .slice(0, Math.max(0, limit));

  return {
    as_of: asOf,
    holdings,
    total_market_value: haveTotal ? round2(total) : null,
    rows_without_asset: withoutAsset,
    rows_without_price: priced.filter((p) => p.mv === null).length,
    superseded_rows: superseded,
    weight_basis: haveTotal
      ? `Weights are shares x price over the portfolio's total market value on its stored snapshot${asOf ? ` of ${asOf}` : ""}. These are the stored marks on that date, not live prices.`
      : null,
  };
}

/** Sector weights over the same snapshot, so the two cannot disagree. */
export function sectorBreakdown(holdings: readonly WeightedHolding[]): Array<{
  sector: string;
  weight_pct: number;
}> {
  const by: Record<string, number> = {};
  for (const h of holdings) {
    if (h.weight_pct === null) continue;
    const sector = h.sector || "Unknown";
    by[sector] = (by[sector] || 0) + h.weight_pct;
  }
  return Object.entries(by)
    .sort((a, b) => b[1] - a[1])
    .map(([sector, w]) => ({ sector, weight_pct: round2(w) }));
}

function round2(n: number): number {
  return Number(n.toFixed(2));
}

/* ── A portfolio's ideas ──────────────────────────────────────────────── */

export type IdeaRelation = "associated" | "held" | "elsewhere";

export interface IdeaRow {
  id?: string | null;
  asset_id?: string | null;
  portfolio_id?: string | null;
}

export interface CategorizedIdeas<T extends IdeaRow> {
  /** The idea names this portfolio. The only true "idea for this portfolio". */
  associated: T[];
  /** About an asset this portfolio holds, but named against another book or none. */
  held: T[];
  /** Visible, and unrelated to this portfolio. */
  elsewhere: T[];
}

/**
 * Split visible live ideas by their actual relationship to one portfolio.
 *
 * `heldAssetIds` must come from the portfolio's CURRENT snapshot, not from
 * every holdings row ever written, or an asset sold two snapshots ago would
 * make an unrelated idea look like a position.
 *
 * Nothing is inferred. An idea with no `portfolio_id` is not quietly assigned
 * to the attached portfolio because its asset happens to be held: that is the
 * relationship this codebase forbids inventing, and it is the difference
 * between "you have three ideas on this book" and "you have three ideas, and
 * eleven others touch names you own".
 */
export function categorizeIdeas<T extends IdeaRow>(
  ideas: readonly T[] | null | undefined,
  portfolioId: string | null,
  heldAssetIds: readonly string[] | null | undefined,
): CategorizedIdeas<T> {
  const held = new Set((heldAssetIds || []).filter(Boolean).map(String));
  const out: CategorizedIdeas<T> = { associated: [], held: [], elsewhere: [] };

  for (const idea of ideas || []) {
    if (!idea) continue;
    if (portfolioId && idea.portfolio_id && String(idea.portfolio_id) === String(portfolioId)) {
      out.associated.push(idea);
      continue;
    }
    if (idea.asset_id && held.has(String(idea.asset_id))) {
      out.held.push(idea);
      continue;
    }
    out.elsewhere.push(idea);
  }

  return out;
}

/**
 * The sentence the model must repeat when part of a lookup failed.
 *
 * Returned inside an `ok` result, never as a status. The result contract here
 * is three states -- ok, empty, error -- and `summarizeToolResult` already
 * treats an unknown status such as "partial" AS AN ERROR, with a test on it.
 * So a half-answer stays `ok` and carries what is missing in its payload,
 * which is the only shape that both keeps the good half and stops the model
 * presenting it as whole.
 */
export function degradedNote(failed: readonly string[]): string {
  const list = failed.filter(Boolean);
  if (list.length === 0) return "";
  return (
    `Part of this lookup failed: ${list.join(", ")}. The rest of this result is ` +
    "complete and may be used. Tell the reader which part could not be read, and do " +
    "not describe the missing part as empty or absent -- you do not know what is in it."
  );
}
