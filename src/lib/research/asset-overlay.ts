/**
 * The organisation's view of a set of global assets.
 *
 * `assets` is one shared row per ticker. The research and workflow columns that
 * used to sit on it — thesis, where_different, risks_to_thesis, quick_note,
 * completeness, priority, process_stage — were one value visible to all 27
 * organisations, which is why C1 retired them. Anything that used to read them
 * off the asset row now needs the same fields assembled per organisation
 * instead, and more than one caller needs it (screens today, and any future
 * grid or export that filters on research state), so the assembly lives here
 * rather than inside a hook.
 *
 * Two sources, both already authoritative:
 *
 *   research   asset_contributions           section -> content
 *   workflow   asset_workflow_progress       current_stage_key -> process_stage
 *              asset_workflow_priorities     priority
 *
 * `completeness` is derived rather than stored, from the same inputs the asset
 * page uses, so a screen and the asset page cannot disagree about it.
 *
 * Every query filters `organization_id` — or, for the workflow tables, the
 * organisation's workflows — explicitly, on top of RLS. Missing organisation
 * returns an EMPTY overlay: no org means no proprietary view, never an
 * unscoped read.
 */

import { supabase } from '../supabase'
import { LEGACY_RESEARCH_SECTIONS, type LegacyResearchSection } from './asset-research'
import { calculateAssetCompleteness } from '../../utils/assetCompleteness'

/** The section key `assets.quick_note` was migrated to. */
export const QUICK_NOTE_SECTION = 'quick_note'

const OVERLAY_SECTIONS = [...LEGACY_RESEARCH_SECTIONS, QUICK_NOTE_SECTION] as const

export interface AssetOverlay {
  thesis: string | null
  where_different: string | null
  risks_to_thesis: string | null
  quick_note: string | null
  quick_note_updated_at: string | null
  priority: string | null
  process_stage: string | null
  completeness: number | null
}

/** What an asset looks like to a caller with no organisation: nothing proprietary. */
export const EMPTY_OVERLAY: AssetOverlay = {
  thesis: null,
  where_different: null,
  risks_to_thesis: null,
  quick_note: null,
  quick_note_updated_at: null,
  priority: null,
  process_stage: null,
  completeness: null,
}

export interface PriceTargetLike {
  asset_id: string
  type: 'bull' | 'base' | 'bear'
  price: number
}

/**
 * Build one overlay per asset for a single organisation.
 *
 * `priceTargets` is passed in rather than fetched because every caller already
 * has them — completeness is half price targets, and refetching them here would
 * double the work to compute a number the caller could not otherwise derive.
 */
export async function fetchAssetOverlays(
  assetIds: string[],
  organizationId: string | null | undefined,
  priceTargets: PriceTargetLike[] = [],
): Promise<Map<string, AssetOverlay>> {
  const ids = [...new Set(assetIds.filter(Boolean))]
  if (ids.length === 0 || !organizationId) return new Map()

  const [contributions, progress, priorities] = await Promise.all([
    supabase
      .from('asset_contributions')
      .select('asset_id, section, content, updated_at')
      .eq('organization_id', organizationId)
      .in('asset_id', ids)
      .in('section', OVERLAY_SECTIONS as unknown as string[])
      .eq('is_archived', false)
      .order('updated_at', { ascending: false }),

    // The workflow tables carry no organization_id of their own; their tenant is
    // the workflow's, which is NOT NULL. Filtering on the org's workflow ids is
    // the source-level equivalent of the EXISTS the policy applies.
    supabase
      .from('workflows')
      .select('id')
      .eq('organization_id', organizationId),

    supabase
      .from('asset_workflow_priorities')
      .select('asset_id, workflow_id, priority')
      .in('asset_id', ids),
  ])

  if (contributions.error) throw contributions.error
  if (progress.error) throw progress.error
  if (priorities.error) throw priorities.error

  const orgWorkflowIds = new Set(((progress.data ?? []) as Array<{ id: string }>).map(w => w.id))

  const stageRows = orgWorkflowIds.size === 0
    ? { data: [] as any[], error: null }
    : await supabase
        .from('asset_workflow_progress')
        .select('asset_id, workflow_id, current_stage_key, updated_at')
        .in('asset_id', ids)
        .in('workflow_id', [...orgWorkflowIds])
        .order('updated_at', { ascending: false })

  if (stageRows.error) throw stageRows.error

  const targetsByAsset = new Map<string, PriceTargetLike[]>()
  for (const t of priceTargets) {
    const arr = targetsByAsset.get(t.asset_id) ?? []
    arr.push(t)
    targetsByAsset.set(t.asset_id, arr)
  }

  const out = new Map<string, AssetOverlay>()
  const ensure = (assetId: string): AssetOverlay => {
    let o = out.get(assetId)
    if (!o) { o = { ...EMPTY_OVERLAY }; out.set(assetId, o) }
    return o
  }

  // Research. Ordered newest-first, so the first row per (asset, section) wins —
  // the same "most recent contribution represents the section" rule the asset
  // page's collapsed view uses.
  const seen = new Set<string>()
  for (const row of (contributions.data ?? []) as Array<{
    asset_id: string; section: string; content: string | null; updated_at: string | null
  }>) {
    const key = `${row.asset_id}:${row.section}`
    if (seen.has(key)) continue
    seen.add(key)
    const o = ensure(row.asset_id)
    if (row.section === QUICK_NOTE_SECTION) {
      o.quick_note = row.content ?? null
      o.quick_note_updated_at = row.updated_at ?? null
    } else if ((LEGACY_RESEARCH_SECTIONS as readonly string[]).includes(row.section)) {
      o[row.section as LegacyResearchSection] = row.content ?? null
    }
  }

  // Workflow state. Newest-first again: an asset can sit in more than one of the
  // organisation's workflows, where the legacy column held exactly one value.
  const seenStage = new Set<string>()
  for (const row of (stageRows.data ?? []) as Array<{ asset_id: string; current_stage_key: string | null }>) {
    if (seenStage.has(row.asset_id)) continue
    seenStage.add(row.asset_id)
    ensure(row.asset_id).process_stage = row.current_stage_key ?? null
  }

  const seenPriority = new Set<string>()
  for (const row of (priorities.data ?? []) as Array<{ asset_id: string; workflow_id: string; priority: string | null }>) {
    // asset_workflow_priorities has no org column either, so the org's workflow
    // set is what scopes it.
    if (!orgWorkflowIds.has(row.workflow_id)) continue
    if (seenPriority.has(row.asset_id)) continue
    seenPriority.add(row.asset_id)
    ensure(row.asset_id).priority = row.priority ?? null
  }

  // Completeness, derived from this organisation's research plus the shared
  // price targets — the same function the asset page uses.
  for (const [assetId, o] of out) {
    o.completeness = calculateAssetCompleteness({
      thesis: o.thesis,
      where_different: o.where_different,
      risks_to_thesis: o.risks_to_thesis,
      priceTargets: targetsByAsset.get(assetId) ?? [],
    })
  }

  return out
}

/**
 * Merge a global asset row with its organisation overlay.
 *
 * Explicit rather than a spread of whatever the overlay happens to contain: the
 * keys below are exactly the proprietary fields, so a global row can never
 * carry one by accident and an overlay can never introduce a field the caller
 * did not ask for.
 */
export function applyAssetOverlay<T extends { id: string }>(
  asset: T,
  overlay: AssetOverlay | undefined,
): T & AssetOverlay {
  const o = overlay ?? EMPTY_OVERLAY
  return {
    ...asset,
    thesis: o.thesis,
    where_different: o.where_different,
    risks_to_thesis: o.risks_to_thesis,
    quick_note: o.quick_note,
    quick_note_updated_at: o.quick_note_updated_at,
    priority: o.priority,
    process_stage: o.process_stage,
    completeness: o.completeness,
  }
}
