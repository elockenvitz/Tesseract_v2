/**
 * ONE definition of "the scenario framework for this asset, right now".
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * Three experiences answered that question three different ways, and the feed
 * answered it worst:
 *
 *   Review Cases (`MobileCaseTargets` + `useAnalystPriceTargets`)
 *     Scenario-driven. Lists the asset's `scenarios` in Bear/Base/Bull order
 *     and shows, per scenario, its target rows ordered `updated_at desc` — so
 *     one rung per scenario, the newest. Asset-scoped, no org filter: RLS does
 *     the org scoping.
 *
 *   Portfolio lenses (`usePortfolioLenses`)
 *     Orders `is_official desc, created_at desc`. A third convention.
 *
 *   Case vs Price (`useScenarioCards`), before this file
 *     Row-driven. EVERY `analyst_price_targets` row became a rung. Three
 *     generations of a Bull target were three Bull rungs; two analysts' Bear
 *     estimates were two Bear rungs. The ladder's low and high — the whole
 *     claim of the card — could come from values nobody currently holds. And
 *     it filtered `.eq('organization_id', currentOrgId)` on top of RLS.
 *
 * The last of those is why the card was missing. RLS already restricts this
 * table to `organization_id = current_org_id()` — the SERVER's org, from
 * `users.current_organization_id`. The feed then intersected that with the
 * CLIENT's org id from `OrganizationProvider`, which is a different value
 * whenever the two disagree: while membership is still loading the provider
 * exposes the unverified cached id, and after a self-heal it exposes
 * `userOrgs[0]` before `set_current_org` has persisted. Two org ids, one
 * `AND`, zero rows — and zero rows is indistinguishable from an empty desk, so
 * the feed showed nothing and `Curate → Case vs Price` correctly reported
 * nothing. Review Cases kept working throughout, because it never applied the
 * second filter.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * One rung per (asset, scenario). Where a scenario has several rows, take:
 *
 *   1. `is_official` first        — an official target supersedes a personal one
 *   2. then latest `updated_at`   — the newest statement of that case
 *   3. then greatest `id`         — a total order, so ties cannot vary
 *
 * (1) matches `usePortfolioLenses`. (2) matches Review Cases. (3) is what makes
 * the answer identical on every load: without it two rows saved in the same
 * second could swap, and a ladder that changes is a card that appears and
 * disappears.
 *
 * A scenario with no priced target contributes no rung, which is what Review
 * Cases shows too — an empty row you can fill in.
 *
 * ── What this deliberately does NOT decide ────────────────────────────────
 *
 * Whose targets count when several analysts have written against the same
 * scenario and none is official. This takes the most recent, which is the rule
 * every other consumer already implies. Scoping the ladder to one author is a
 * product decision with real consequences — it would remove cards for names
 * covered by a colleague — and it is not one to make silently inside a bug fix.
 * Reported rather than chosen.
 */

/** A raw `analyst_price_targets` row, as every consumer selects it. */
export interface TargetRow {
  id: string
  asset_id: string | null
  scenario_id?: string | null
  user_id?: string | null
  price: number | string | null
  probability?: number | string | null
  timeframe?: string | null
  reasoning?: string | null
  is_official?: boolean | null
  created_at?: string | null
  updated_at?: string | null
  scenarios?: { name?: string | null } | null
  assets?: { id?: string; symbol?: string | null; company_name?: string | null } | null
}

export interface LadderCase {
  /** The scenario this rung belongs to. Null for a target with no scenario. */
  scenarioId: string | null
  name: string
  price: number
  probability: number | null
  timeframe: string | null
  reasoning: string | null
  /** The row that won selection, so a caller can link back to it. */
  id: string
  userId: string | null
}

export interface CurrentLadder {
  assetId: string
  symbol: string
  companyName: string | null
  cases: LadderCase[]
  /** The newest `updated_at` among the rungs that were selected. */
  updatedAt: string
  /** A ladder needs two distinct rungs to describe a range. */
  valid: boolean
  /** Why not, when `valid` is false. Empty when it is. */
  reason: string
}

/** Bear before Base before Bull; anything else after, alphabetically. */
const ORDER = ['Bear', 'Base', 'Bull']

function rank(name: string): number {
  const i = ORDER.indexOf(name)
  return i === -1 ? ORDER.length : i
}

/**
 * `is_official`, then newest, then greatest id. Returns true when `a` wins.
 *
 * Total: `id` is unique, so no two rows compare equal and the winner never
 * depends on the order the rows arrived in.
 */
function supersedes(a: TargetRow, b: TargetRow): boolean {
  const ao = a.is_official === true
  const bo = b.is_official === true
  if (ao !== bo) return ao
  const at = String(a.updated_at ?? a.created_at ?? '')
  const bt = String(b.updated_at ?? b.created_at ?? '')
  if (at !== bt) return at > bt
  return String(a.id) > String(b.id)
}

const priceOf = (r: TargetRow): number => {
  const n = Number(r.price)
  return Number.isFinite(n) && n > 0 ? n : NaN
}

/**
 * The current framework for every asset present in `rows`.
 *
 * Pure. Deterministic for a given set of rows regardless of their order — the
 * property `shuffling the source rows cannot change the ladder` asserts.
 */
export function selectCurrentLadders(rows: readonly TargetRow[]): CurrentLadder[] {
  /** asset -> scenario key -> winning row */
  const byAsset = new Map<string, {
    symbol: string
    companyName: string | null
    winners: Map<string, TargetRow>
  }>()

  for (const r of rows) {
    const assetId = r.asset_id
    const symbol = r.assets?.symbol
    // No asset or no ticker means nothing this card could name.
    if (!assetId || !symbol) continue
    // A rung is a PRICE. A row without one is an unfilled case, not a level.
    if (!Number.isFinite(priceOf(r))) continue

    const g = byAsset.get(assetId) ?? {
      symbol,
      companyName: r.assets?.company_name ?? null,
      winners: new Map<string, TargetRow>(),
    }
    /**
     * Keyed by scenario, falling back to the row id.
     *
     * A target with no `scenario_id` cannot be deduplicated against anything —
     * there is no case for it to be a newer version OF — so it keys to itself
     * and stands alone. That is the honest handling: it is a level somebody
     * recorded, and collapsing all such rows into one bucket would silently
     * drop every one but the newest.
     */
    const key = r.scenario_id ?? `row:${r.id}`
    const held = g.winners.get(key)
    if (!held || supersedes(r, held)) g.winners.set(key, r)
    byAsset.set(assetId, g)
  }

  const out: CurrentLadder[] = []
  for (const [assetId, g] of byAsset) {
    const cases: LadderCase[] = [...g.winners.values()]
      .map(r => ({
        scenarioId: r.scenario_id ?? null,
        // The analyst's own word. "Uber Bull" is a real one in this database;
        // never normalise it to bear/base/bull.
        name: r.scenarios?.name || 'Case',
        price: priceOf(r),
        probability: r.probability != null ? Number(r.probability) : null,
        timeframe: r.timeframe ?? null,
        reasoning: r.reasoning ?? null,
        id: String(r.id),
        userId: r.user_id ?? null,
      }))
      // Bear, Base, Bull, then anything custom — the same order Review Cases
      // lists them in. `id` last so the sort is total.
      .sort((a, b) =>
        rank(a.name) - rank(b.name)
        || a.name.localeCompare(b.name)
        || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    const updatedAt = [...g.winners.values()]
      .map(r => String(r.updated_at ?? r.created_at ?? ''))
      .sort()
      .pop() ?? ''

    /**
     * Two DISTINCT prices, not two rows.
     *
     * A ladder whose rungs are all the same number describes no range, and the
     * card's whole claim is about a range. The old row-driven path could reach
     * two rungs with two generations of one case at one price and emit a card
     * about a framework that does not exist.
     */
    const distinct = new Set(cases.map(c => c.price)).size
    out.push({
      assetId,
      symbol: g.symbol,
      companyName: g.companyName,
      cases,
      updatedAt,
      valid: cases.length >= 2 && distinct >= 2,
      reason: cases.length < 2
        ? `needs 2+ priced cases, has ${cases.length}`
        : distinct < 2
          ? `all ${cases.length} cases sit at one price`
          : '',
    })
  }

  // Deterministic output order, so two runs produce identical arrays.
  return out.sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))
}
