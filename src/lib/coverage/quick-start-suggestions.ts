import { supabase } from '../supabase'
import type { CoverageCandidate } from './quick-start-selection'

/**
 * The names `CoverageQuickStart` offers first, and the key they are cached at.
 *
 * ── Why this is not inside the component ─────────────────────────────────
 *
 * Because the component mounts too late to start it. On the pilot home the
 * chain was serial: read the reader's coverage to decide whether setup is
 * still pending, then mount the prompt, then mount the card, and only THEN
 * ask what to suggest. Three round trips end to end for a screen whose whole
 * job is to be answered in under a minute, and the reader watched a spinner
 * through all of them.
 *
 * Key and fetcher live here so the pilot home can start this request on its
 * first render, beside the coverage read rather than behind it. Same key, so
 * the card finds the result already in the cache instead of issuing a second.
 *
 * ── What it asks ─────────────────────────────────────────────────────────
 *
 * What the reader's books already hold, what they told the profile wizard
 * they follow, and what the rest of the workspace covers. The first and third
 * are one round trip; the sector list is a second only when a sector focus
 * exists, which for a fresh pilot it usually does not.
 *
 * RLS posture: unchanged. Three reads on tables the product already reads
 * through the same client. `portfolio_holdings` and `coverage` are org-scoped
 * by policy, `assets` is a shared catalogue, and the profile read is filtered
 * to the caller's own row.
 */
export const coverageSuggestionsKey = (userId: string | null, orgId: string | null) =>
  ['coverage-quick-start-suggestions', userId, orgId] as const

export async function fetchCoverageSuggestions(
  userId: string,
  orgId: string,
): Promise<CoverageCandidate[]> {
  const [holdingsRes, profileRes, teamRes] = await Promise.all([
    supabase
      .from('portfolio_holdings')
      /* The portfolio comes back on the same read. A second query for a
         label the join already reaches would be a round trip for a string. */
      .select('asset_id, assets:asset_id(id, symbol, company_name, sector), portfolios:portfolio_id(id, name)')
      .limit(60),
    supabase
      .from('user_profile_extended')
      .select('sector_focus')
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('coverage')
      .select('asset_id, assets:asset_id(id, symbol, company_name, sector)')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .limit(40),
  ])

  const out = new Map<string, CoverageCandidate>()

  for (const row of (holdingsRes.data ?? []) as any[]) {
    const a = row.assets
    if (!a?.id) continue
    const portfolioName: string | null = row.portfolios?.name ?? null
    const existing = out.get(a.id)
    if (existing) {
      // The same name in a second book: record it rather than drop it, so the
      // row can say "+1" instead of picking one arbitrarily.
      if (portfolioName && !existing.portfolioNames?.includes(portfolioName)) {
        existing.portfolioNames = [...(existing.portfolioNames ?? []), portfolioName]
      }
      continue
    }
    out.set(a.id, {
      ...a,
      reason: 'holding',
      portfolioNames: portfolioName ? [portfolioName] : [],
    })
  }

  const sectors: string[] = ((profileRes.data as any)?.sector_focus as string[]) ?? []
  /*
   * The one sequential read, and it is skipped whenever the books already
   * answered the question. A sector top-up behind a list that is full anyway
   * is a round trip the reader waits through for names below the fold.
   */
  if (sectors.length > 0 && out.size < 30) {
    const { data } = await supabase
      .from('assets')
      .select('id, symbol, company_name, sector')
      .in('sector', sectors)
      .order('market_cap', { ascending: false, nullsFirst: false })
      .limit(20)
    for (const a of (data ?? []) as CoverageCandidate[]) {
      if (!out.has(a.id)) out.set(a.id, { ...a, reason: 'sector' })
    }
  }

  for (const row of (teamRes.data ?? []) as any[]) {
    const a = row.assets
    if (a?.id && !out.has(a.id)) out.set(a.id, { ...a, reason: 'team' })
  }

  return [...out.values()].slice(0, 30)
}
