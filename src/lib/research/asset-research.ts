/**
 * Reads an asset's proprietary research from the org-scoped model.
 *
 * `assets` is a global security master — one row per ticker, shared by every
 * organisation. The research columns that used to live on it (`thesis`,
 * `where_different`, `risks_to_thesis`, `quick_note`) were readable by every
 * authenticated user in every tenant, and `useExploreSearch` searched them, so
 * one firm could find another firm's thesis by typing a phrase into the search
 * box. Those columns are being retired; the authoritative home is
 * `asset_contributions`, which is org-scoped, already holds the same section
 * keys, and has been the write path for some time.
 *
 * Tenancy is enforced twice, on purpose. RLS on `asset_contributions` is the
 * real boundary and would hold on its own; every query here ALSO filters
 * `organization_id` explicitly, because this repository requires proprietary
 * reads to be scoped at the source as well (`src/lib/org-scope`). Defence in
 * depth is the lesser reason. The better one is that an unscoped query is
 * indistinguishable, in review, from one that forgot — and the guard exists so
 * nobody has to take that on trust.
 *
 * Every entry point therefore takes an `organizationId` and FAILS CLOSED when
 * it is missing: no organisation means no tenant research, not an unscoped
 * query that RLS happens to save.
 *
 * Section keys, not column names: `contribution-sections.ts` owns the mapping
 * from a template field slug to a section key, and several slugs alias one
 * section. This module speaks only the three legacy sections, because those are
 * the only ones that ever had a column on `assets`.
 */

import { supabase } from '../supabase'
import { CORE_SECTIONS, type CoreSection } from './case-state'

/**
 * The sections that were once columns on `assets`.
 *
 * Re-exported from `case-state` rather than declared here, and the direction
 * matters: this module imports `supabase`, which throws at module load in the
 * card gallery (a standalone Vite entry with no env). While the list lived
 * here, any pure consumer that wanted the three section keys pulled the whole
 * Supabase client in behind them and took the gallery down. The vocabulary is
 * a pure fact about what a case is, so it lives in the pure module and the
 * read path consumes it. Still one list; the alias is kept so no existing
 * caller had to change.
 */
export const LEGACY_RESEARCH_SECTIONS = CORE_SECTIONS

export type LegacyResearchSection = CoreSection

/** The old `assets` row shape, rebuilt from contributions so callers need not change. */
export type AssetResearch = Record<LegacyResearchSection, string | null>

export const EMPTY_ASSET_RESEARCH: AssetResearch = {
  thesis: null,
  where_different: null,
  risks_to_thesis: null,
}

interface ContributionRow {
  asset_id: string
  section: string
  content: string | null
  updated_at: string | null
}

/**
 * Collapse many contributions to one value per (asset, section).
 *
 * An asset can carry several contributions in the same section — one per author
 * — where the `assets` column held exactly one value. Callers that used to read
 * that column want a single string, so the most recently updated contribution
 * wins. That is a display choice, not a merge: the full set stays available
 * through `useContributions`, which is what the asset page renders.
 */
function collapse(rows: ContributionRow[]): Map<string, AssetResearch> {
  const byAsset = new Map<string, AssetResearch>()
  const seenAt = new Map<string, string>()

  for (const row of rows) {
    if (!LEGACY_RESEARCH_SECTIONS.includes(row.section as LegacyResearchSection)) continue
    const section = row.section as LegacyResearchSection
    const key = `${row.asset_id}:${section}`
    const stamp = row.updated_at ?? ''
    if (seenAt.has(key) && (seenAt.get(key) as string) >= stamp) continue

    seenAt.set(key, stamp)
    const current = byAsset.get(row.asset_id) ?? { ...EMPTY_ASSET_RESEARCH }
    current[section] = row.content ?? null
    byAsset.set(row.asset_id, current)
  }

  return byAsset
}

/**
 * Research for many assets at once, keyed by asset id.
 *
 * Batched rather than per-asset because every caller that lost its `assets`
 * columns was reading a list — a notes page, a portfolio grid, a search result
 * set. One round trip for the page, not one per row.
 */
export async function fetchAssetResearch(
  assetIds: string[],
  organizationId: string | null | undefined,
): Promise<Map<string, AssetResearch>> {
  const ids = [...new Set(assetIds.filter(Boolean))]
  // Fail closed: an unresolved organisation returns nothing rather than an
  // unscoped read.
  if (ids.length === 0 || !organizationId) return new Map()

  const { data, error } = await supabase
    .from('asset_contributions')
    .select('asset_id, section, content, updated_at')
    .eq('organization_id', organizationId)
    .in('asset_id', ids)
    .in('section', LEGACY_RESEARCH_SECTIONS as unknown as string[])
    .eq('is_archived', false)
    .order('updated_at', { ascending: false })

  if (error) throw error
  return collapse((data ?? []) as ContributionRow[])
}

/** Research for a single asset. Never null — an asset with no research reads as empty. */
export async function fetchOneAssetResearch(
  assetId: string,
  organizationId: string | null | undefined,
): Promise<AssetResearch> {
  const byAsset = await fetchAssetResearch([assetId], organizationId)
  return byAsset.get(assetId) ?? { ...EMPTY_ASSET_RESEARCH }
}

/**
 * The org-scoped replacement for searching `assets.thesis` and friends.
 *
 * `apply` is the caller's token combinator (every word / any word) so search
 * semantics stay identical to the pass this replaces; only the table changes.
 * The `assets` join supplies the ticker for display — that half is global and
 * always was.
 */
export function assetResearchSearchQuery(organizationId: string) {
  return supabase
    .from('asset_contributions')
    .select('id, asset_id, section, content, updated_at, assets(id, symbol, company_name, sector)')
    .eq('organization_id', organizationId)
    .in('section', LEGACY_RESEARCH_SECTIONS as unknown as string[])
    .eq('is_archived', false)
}

export interface ThesisReference {
  type: 'note' | 'file' | 'link' | 'model'
  id?: string
  title: string
  url?: string
  addedAt: string
}

/**
 * Supporting documents attached to a thesis.
 *
 * Was `assets.thesis_references`, a jsonb column on the global row — so one
 * organisation's supporting documents were listed on an asset every other
 * organisation could read, and any of them could overwrite the list. The
 * org-scoped equivalent is `asset_contributions.attachments` on the `thesis`
 * section, which is where contribution attachments already live.
 *
 * One consequence worth stating plainly: contributions are one row per user per
 * section (`unique_user_asset_section`), so these references become the author's
 * own rather than the asset's. That is a narrowing, and it is the correct one —
 * a reference list with no owner is exactly what made the column unattributable
 * in the first place.
 */
export async function fetchThesisReferences(
  assetId: string,
  userId: string | undefined,
  organizationId: string | null | undefined,
): Promise<ThesisReference[]> {
  if (!userId || !organizationId) return []
  const { data, error } = await supabase
    .from('asset_contributions')
    .select('attachments')
    .eq('organization_id', organizationId)
    .eq('asset_id', assetId)
    .eq('section', 'thesis')
    .eq('created_by', userId)
    .maybeSingle()

  if (error) throw error
  // The shared client is untyped, so a narrowed select resolves to `never`.
  return (((data as { attachments?: ThesisReference[] } | null)?.attachments ?? []) as ThesisReference[])
}

/**
 * Replace the caller's thesis references.
 *
 * Updates only — a reference cannot be attached to a thesis that has not been
 * written. Creating an empty contribution here would put a blank row in every
 * teammate's view of the section, so an absent thesis is a no-op that reports
 * itself rather than a silent insert.
 */
export async function saveThesisReferences(
  assetId: string,
  userId: string | undefined,
  organizationId: string | null | undefined,
  references: ThesisReference[],
): Promise<{ saved: boolean }> {
  if (!userId || !organizationId) return { saved: false }

  const { data: existing, error: findError } = await supabase
    .from('asset_contributions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('asset_id', assetId)
    .eq('section', 'thesis')
    .eq('created_by', userId)
    .maybeSingle()

  if (findError) throw findError
  if (!existing) return { saved: false }

  const { error } = await (supabase.from('asset_contributions') as any)
    .update({ attachments: references, updated_at: new Date().toISOString() })
    .eq('id', (existing as { id: string }).id)

  if (error) throw error
  return { saved: true }
}

/** Human-facing label for the section a search hit landed in. */
export const RESEARCH_SECTION_LABEL: Record<LegacyResearchSection, string> = {
  thesis: 'thesis',
  where_different: 'where we differ',
  risks_to_thesis: 'risks',
}
