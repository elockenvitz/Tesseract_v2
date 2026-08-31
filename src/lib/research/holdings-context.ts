/**
 * Current exposure for a Research card, from the CURRENT snapshot only.
 *
 * ── The defect this closes ────────────────────────────────────────────────
 *
 * `portfolio_holdings_positions` is one row per (snapshot, portfolio, asset),
 * and the research scan used to read every row for the organisation, order the
 * whole set by `weight_pct` descending, and dedupe by asset id — taking the
 * FIRST row seen for each. That picks the largest weight an asset ever had in
 * any snapshot, not its weight today. In production the one org with real
 * research carries three snapshots of a single portfolio (7, 8 and 36
 * positions), so the bug is live rather than theoretical: a card could print a
 * weight from a March upload beside a case written in April.
 *
 * ── Why the snapshot is derived from two sources ──────────────────────────
 *
 * The obvious answer — order `portfolio_holdings_snapshots` by `snapshot_date`
 * and take the newest per portfolio — is right for every organisation that
 * uploaded its book through the product, and returns NOTHING for the one
 * organisation whose research this family exists to surface: its three snapshot
 * ids are seeded fixtures with no matching row in that table at all. A
 * derivation that silently drops all exposure for the only populated org is not
 * a fix.
 *
 * So both are used, in that order of authority:
 *
 *   1. `snapshot_date` where the snapshot row exists. It is the book's own
 *      statement of which upload is current, and survives a backdated upload.
 *   2. Otherwise the newest `created_at` among the snapshot's own position
 *      rows, which is present on every row by definition and needs no join.
 *
 * A snapshot the ledger knows about always beats one it does not, so a real
 * upload can never be outranked by an orphan.
 *
 * ── Pure ──────────────────────────────────────────────────────────────────
 *
 * No React, no Supabase. The rule is the interesting part and it is reachable
 * without a mocked client — which is how the ordering bug survived: it was only
 * expressible as a chained query, so nothing could assert against it.
 */

/** A row from `portfolio_holdings_snapshots`. Only what the ranking needs. */
export interface SnapshotRef {
  id: string
  portfolio_id?: string | null
  snapshot_date?: string | null
}

/** A row from `portfolio_holdings_positions`. Only what the ranking needs. */
export interface PositionRow {
  snapshot_id?: string | null
  portfolio_id?: string | null
  asset_id?: string | null
  weight_pct?: number | string | null
  created_at?: string | null
  /** The embedded `portfolios(name)` join, where the caller asked for it. */
  portfolios?: { name?: string | null } | null
}

/** What a card may say about where a name sits, and nothing more. */
export interface Exposure {
  /** In the current book at all. Drives "held in ..." and `materialityBand`. */
  held: boolean
  /**
   * The largest current weight across the books it sits in, or null.
   *
   * Null is not zero, and must never be rendered as "0.0%". Only 10 of 36
   * positions in the newest production snapshot carry a weight at all, so the
   * absent case is the common one — see `PortfolioRef` in the card contract,
   * which makes the same argument for the same reason.
   */
  weightPct: number | null
  /** The book the weight belongs to, so a chip can name what it is measuring. */
  portfolioId: string | null
  portfolioName: string | null
  /** How many current books hold it. 1 for almost everything in production. */
  portfolioCount: number
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const ms = (v: string | null | undefined): number => {
  const t = new Date(v ?? '').getTime()
  return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY
}

/**
 * The one current snapshot id per portfolio.
 *
 * Positions with no `snapshot_id` are not snapshotted and cannot be stale
 * relative to anything, so they are kept unconditionally by `exposureByAsset`
 * rather than being ranked here.
 */
export function latestSnapshotIds(
  snapshots: readonly SnapshotRef[],
  positions: readonly PositionRow[],
): Set<string> {
  const dated = new Map<string, string | null>()
  for (const s of snapshots) {
    if (s?.id) dated.set(s.id, s.snapshot_date ?? null)
  }

  /** portfolio -> snapshot -> newest position `created_at` seen for it. */
  const seen = new Map<string, Map<string, number>>()
  for (const p of positions) {
    const snap = p?.snapshot_id
    if (!snap) continue
    // A position with no portfolio still belongs to its own snapshot lineage;
    // bucketing them together is better than discarding the rows entirely.
    const book = p.portfolio_id ?? '__unassigned__'
    const forBook = seen.get(book) ?? new Map<string, number>()
    const at = ms(p.created_at)
    forBook.set(snap, Math.max(forBook.get(snap) ?? Number.NEGATIVE_INFINITY, at))
    seen.set(book, forBook)
  }

  const out = new Set<string>()
  for (const forBook of seen.values()) {
    let best: string | null = null
    let bestKey: [number, number, number] = [-1, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY]

    for (const [snap, newestPosition] of forBook) {
      const known = dated.has(snap)
      const key: [number, number, number] = [
        // A snapshot the ledger knows about always outranks an orphan.
        known ? 1 : 0,
        known ? ms(dated.get(snap) ?? null) : Number.NEGATIVE_INFINITY,
        newestPosition,
      ]
      const wins = key[0] !== bestKey[0] ? key[0] > bestKey[0]
        : key[1] !== bestKey[1] ? key[1] > bestKey[1]
        : key[2] !== bestKey[2] ? key[2] > bestKey[2]
        // Fully tied: settle on the id so the choice is reproducible rather
        // than dependent on row order, which PostgREST does not guarantee.
        : best != null && snap > best
      if (best == null || wins) { best = snap; bestKey = key }
    }

    if (best) out.add(best)
  }

  return out
}

/**
 * Current exposure per asset, keyed by asset id.
 *
 * Where a name sits in more than one current book, the LARGEST weight is named
 * and the count is carried alongside — never an arbitrary pick, and never a
 * sum, which would invent a total exposure across books that do not add up.
 * No asset in production is currently held in two books with a written case,
 * so this path is designed rather than proven; the count is what stops a card
 * from implying otherwise.
 */
export function exposureByAsset(
  positions: readonly PositionRow[],
  latest: Set<string>,
): Map<string, Exposure> {
  const out = new Map<string, Exposure>()

  for (const p of positions) {
    const assetId = p?.asset_id
    if (!assetId) continue
    // Snapshotted rows must belong to the current snapshot. Unsnapshotted rows
    // are the only record of themselves and are always kept.
    if (p.snapshot_id && !latest.has(p.snapshot_id)) continue

    const weight = num(p.weight_pct)
    const current = out.get(assetId)

    if (!current) {
      out.set(assetId, {
        held: true,
        weightPct: weight,
        portfolioId: p.portfolio_id ?? null,
        portfolioName: p.portfolios?.name ?? null,
        portfolioCount: p.portfolio_id ? 1 : 0,
      })
      continue
    }

    if (p.portfolio_id && p.portfolio_id !== current.portfolioId) {
      current.portfolioCount += 1
    }
    // The larger weight names the chip. A row with no weight never displaces
    // one that has a number, and two absent weights stay absent.
    if (weight != null && (current.weightPct == null || weight > current.weightPct)) {
      current.weightPct = weight
      current.portfolioId = p.portfolio_id ?? current.portfolioId
      current.portfolioName = p.portfolios?.name ?? current.portfolioName
    }
  }

  return out
}

/** The neutral answer for a name that is not in the book at all. */
export const UNHELD: Exposure = {
  held: false,
  weightPct: null,
  portfolioId: null,
  portfolioName: null,
  portfolioCount: 0,
}
