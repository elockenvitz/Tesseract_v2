import { supabase } from '../supabase'

/**
 * The Operations Portal's only route to quick_thoughts.
 *
 * Ops reads this table across every tenant on purpose. That used to work
 * because the SELECT policy was `TO public` with no organization predicate —
 * i.e. it worked because the table was open, which is the thing the
 * tenant-isolation work removes. `OpsGuard` gates the *page*, in the browser;
 * it never gated the data.
 *
 * So the cross-org read now goes through `ops_quick_thought_activity`, a
 * SECURITY DEFINER RPC that checks `is_platform_admin()` server-side and
 * raises 'Platform admin required' for anyone else. An ordinary user calling
 * it gets an error, not a quietly narrowed result — which matters, because a
 * silently-scoped ops metric is indistinguishable from a real one.
 *
 * The RPC returns author ids and counts only. Never content.
 */
export interface OpsThoughtActivityRow {
  created_by: string
  thought_count: number
  /** Earliest matching row for this author, ISO. Null if the author has none. */
  first_created_at: string | null
}

export interface OpsThoughtActivityParams {
  /** Restrict to these authors. Omit for every author in every tenant. */
  userIds?: string[] | null
  /** ISO timestamp; rows created at or after it. */
  since?: string | null
  /** e.g. 'prompt', 'trade_idea'. */
  ideaType?: string | null
  excludeArchived?: boolean
}

export async function fetchOpsQuickThoughtActivity(
  params: OpsThoughtActivityParams = {}
): Promise<OpsThoughtActivityRow[]> {
  const { data, error } = await supabase.rpc('ops_quick_thought_activity', {
    p_user_ids: params.userIds ?? null,
    p_since: params.since ?? null,
    p_idea_type: params.ideaType ?? null,
    p_exclude_archived: params.excludeArchived ?? false,
  })

  if (error) throw error

  // thought_count arrives as bigint, which PostgREST serialises as a string.
  return (data ?? []).map((r: any) => ({
    created_by: r.created_by as string,
    thought_count: Number(r.thought_count) || 0,
    first_created_at: (r.first_created_at as string | null) ?? null,
  }))
}

/** Total rows across every author in the result. */
export function totalThoughtCount(rows: OpsThoughtActivityRow[]): number {
  return rows.reduce((n, r) => n + r.thought_count, 0)
}

/** The distinct authors who wrote at least one row. */
export function activeAuthorIds(rows: OpsThoughtActivityRow[]): Set<string> {
  return new Set(rows.filter(r => r.thought_count > 0).map(r => r.created_by))
}
