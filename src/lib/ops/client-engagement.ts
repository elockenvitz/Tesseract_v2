import { supabase } from '../supabase'

/**
 * Ops client-detail metrics, attributed to the org being VIEWED.
 *
 * ── Why this is an RPC and not a set of table reads ────────────────────────
 *
 * `OpsClientDetailPage` used to read tenant tables directly. That fails in
 * two directions at once, and both were live:
 *
 *   * Queries that DID carry `organization_id = <viewed org>` returned
 *     nothing, because RLS also requires `organization_id = current_org_id()`
 *     and the operator is normally sitting in their own org. A real pilot
 *     portfolio read as zero.
 *   * Queries that carried no org predicate — only `created_by IN memberIds`
 *     — counted whatever RLS happened to let through. A note with
 *     `organization_id IS NULL`, written eight days before the org existed,
 *     was reported as that org's engagement.
 *
 * `OpsGuard` does not prevent either: it calls `is_platform_admin()` in the
 * browser to decide whether to RENDER. Authorization for the data lives in
 * the database, in `ops_client_engagement`, which re-checks and raises.
 *
 * Counts only. An operator learns that a client wrote four notes, not what
 * the notes say — which is why this is a narrow RPC rather than a
 * platform-admin SELECT policy on `asset_notes`.
 */

export interface OpsClientEngagement {
  notes: number
  ratings: number
  ideas: number
  tradeIdeas: number
  sessions: number
  avgDurationSeconds: number
  portfolioCount: number
  activePortfolios: number
}

export interface OpsClientPortfolio {
  id: string
  name: string
  isActive: boolean
  createdAt: string
}

const EMPTY: OpsClientEngagement = {
  notes: 0, ratings: 0, ideas: 0, tradeIdeas: 0,
  sessions: 0, avgDurationSeconds: 0, portfolioCount: 0, activePortfolios: 0,
}

/**
 * One org-aware summary fetch.
 *
 * `since` is optional and windows the activity counts only — portfolio
 * counts are lifetime, because "this client has one portfolio" is a fact
 * about the org rather than about the last 30 days.
 *
 * Errors are thrown, not swallowed. A non-admin caller gets
 * "Platform admin required" from the database, and a page that quietly
 * rendered zeros instead would be repeating the original defect in a new
 * place: a wrong number that looks like an unengaged client.
 */
/**
 * One cast, in one place.
 *
 * The generated `Database` type in this repo has no `Relationships` on its
 * tables, which collapses supabase-js's generics — every `rpc()` argument
 * object resolves to `never` and every result to `never`. The sibling ops
 * helper simply wears the two resulting errors; spending type-ceiling on the
 * same known defect twice more is worse than naming it once here.
 *
 * This is a typing workaround, not a runtime one: the argument names and the
 * shape are still checked against the function signature by Postgres, and
 * the SQL suite asserts the contract.
 */
const rpcArgs = (o: Record<string, unknown>) => o as never

export async function fetchOpsClientEngagement(
  orgId: string,
  since?: string | null,
): Promise<OpsClientEngagement> {
  const { data, error } = await supabase.rpc('ops_client_engagement', rpcArgs({
    p_org_id: orgId,
    p_since: since ?? null,
  }))
  if (error) throw error

  // The function RETURNS TABLE, so PostgREST hands back an array of one.
  const row: any = Array.isArray(data) ? data[0] : data
  if (!row) return EMPTY

  // count(*) is bigint, which PostgREST serialises as a string.
  const n = (v: unknown) => Number(v ?? 0)

  return {
    notes: n(row.notes),
    ratings: n(row.ratings),
    ideas: n(row.ideas),
    tradeIdeas: n(row.trade_ideas),
    sessions: n(row.sessions),
    avgDurationSeconds: n(row.avg_duration_seconds),
    portfolioCount: n(row.portfolio_count),
    activePortfolios: n(row.active_portfolios),
  }
}

/**
 * The minimal portfolio metadata the page renders: name and active state.
 *
 * Deliberately not a platform-admin SELECT policy on `portfolios` — that
 * would expose every column of every tenant's portfolios to satisfy a panel
 * that shows three.
 */
export async function fetchOpsClientPortfolios(
  orgId: string,
): Promise<OpsClientPortfolio[]> {
  const { data, error } = await supabase.rpc('ops_client_portfolios', rpcArgs({
    p_org_id: orgId,
  }))
  if (error) throw error

  return ((data ?? []) as any[]).map((r: any) => ({
    id: r.id,
    name: r.name,
    isActive: !!r.is_active,
    createdAt: r.created_at,
  }))
}
