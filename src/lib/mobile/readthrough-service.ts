import { supabase } from '../supabase'

/**
 * Readthroughs — "this post changes how I think about a *different* stock".
 *
 * Modelled on the existing `object_links` table rather than a new one. That
 * table already carries source_type/source_id -> target_type/target_id with a
 * `link_type` enum and free-text `context`, and its `linkable_entity_type`
 * enum already covers every feed item type plus `asset`.
 *
 * `informs` is the closest existing relationship: the source item informs a
 * view on the target asset. Reusing it avoids a production migration; if
 * readthroughs become a first-class concept worth reporting on separately, the
 * upgrade is adding a `readthrough` value to `link_relationship_type` and
 * changing the constant below.
 */
export const READTHROUGH_LINK_TYPE = 'informs' as const

/** Feed item types that can be the source of a readthrough. */
export type ReadthroughSourceType =
  | 'quick_thought'
  | 'trade_idea'
  | 'asset_note'
  | 'portfolio_note'
  | 'theme_note'
  | 'custom_note'
  | 'trade_idea_thesis'

export interface CreateReadthroughInput {
  sourceType: ReadthroughSourceType
  sourceId: string
  /** The *other* asset this item has implications for. */
  targetAssetId: string
  /** Why it reads through — optional but the point of the feature. */
  note?: string
}

export async function createReadthrough({
  sourceType,
  sourceId,
  targetAssetId,
  note,
}: CreateReadthroughInput) {
  const { data: userData } = await supabase.auth.getUser()

  const payload = {
    source_type: sourceType,
    source_id: sourceId,
    target_type: 'asset',
    target_id: targetAssetId,
    link_type: READTHROUGH_LINK_TYPE,
    context: note?.trim() || null,
    // Human-created, as opposed to links inferred by automation. Keeps
    // hand-marked readthroughs distinguishable from generated ones.
    is_auto: false,
    created_by: userData?.user?.id ?? null,
  }

  // The cast is load-bearing only because `src/types/database.ts` is stale and
  // omits `object_links`, so Supabase resolves the row type to `never` and
  // rejects any payload. Delete the cast once the database types are
  // regenerated — it is hiding nothing else.
  const { data, error } = await supabase
    .from('object_links')
    .insert(payload as never)
    .select()
    .single()

  if (error) throw error
  return data
}

/** Readthroughs already recorded from a given feed item. */
export async function getReadthroughsForItem(sourceType: string, sourceId: string) {
  const { data, error } = await supabase
    .from('object_links')
    .select('id, target_id, context, created_at')
    .eq('source_type', sourceType)
    .eq('source_id', sourceId)
    .eq('target_type', 'asset')
    .eq('link_type', READTHROUGH_LINK_TYPE)

  if (error) throw error
  return data ?? []
}

export async function deleteReadthrough(linkId: string) {
  const { error } = await supabase.from('object_links').delete().eq('id', linkId)
  if (error) throw error
}
