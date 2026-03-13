/**
 * Syncs auto-extracted object links for a note after save.
 *
 * Flow:
 * 1. Extract references from the note's HTML content
 * 2. Fetch existing auto-links for this note
 * 3. Upsert new links, delete stale ones
 *
 * This is called AFTER a successful note save, never during.
 * It does not block the save flow — failures are logged, not thrown.
 */

import { supabase } from '../supabase'
import {
  extractReferencesFromHTML,
  extractPlainTextPatterns,
  type LinkableEntityType,
  type ExtractedReference,
} from './extract-references'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which note table the source note lives in */
export type NoteSourceType = 'asset_note' | 'portfolio_note' | 'theme_note' | 'custom_note'

/** Map from UniversalNoteEditor's entityType to link source type */
const ENTITY_TYPE_TO_SOURCE: Record<string, NoteSourceType> = {
  asset: 'asset_note',
  portfolio: 'portfolio_note',
  theme: 'theme_note',
  custom: 'custom_note',
}

export function getNoteSourceType(entityType: string): NoteSourceType {
  return ENTITY_TYPE_TO_SOURCE[entityType] || 'asset_note'
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/**
 * Sync auto-extracted links for a note.
 *
 * @param noteId     The note's UUID
 * @param sourceType The note's source type (asset_note, portfolio_note, etc.)
 * @param html       The note's current HTML content
 * @param userId     The current user's ID (for created_by)
 */
export async function syncNoteLinks(
  noteId: string,
  sourceType: NoteSourceType,
  html: string,
  userId: string,
): Promise<void> {
  try {
    // 1. Extract current references from content
    //    First: structured TipTap spans (data-type="asset", etc.)
    const structuredRefs = extractReferencesFromHTML(html)

    //    Second: plain-text $TICKER and #Tag patterns resolved against DB
    const plainTextRefs = await resolvePlainTextPatterns(html)

    //    Merge and deduplicate
    const seen = new Set(structuredRefs.map(r => `${r.targetType}:${r.targetId}`))
    const currentRefs = [...structuredRefs]
    for (const ref of plainTextRefs) {
      const key = `${ref.targetType}:${ref.targetId}`
      if (!seen.has(key)) {
        seen.add(key)
        currentRefs.push(ref)
      }
    }

    // 2. Fetch existing auto-links for this note
    const { data: existingLinks, error: fetchError } = await supabase
      .from('object_links')
      .select('id, target_type, target_id')
      .eq('source_type', sourceType)
      .eq('source_id', noteId)
      .eq('is_auto', true)

    if (fetchError) {
      console.warn('[syncNoteLinks] Failed to fetch existing links:', fetchError)
      return
    }

    const existing = existingLinks || []

    // 3. Determine inserts and deletes
    const currentSet = new Set(currentRefs.map(r => `${r.targetType}:${r.targetId}`))
    const existingSet = new Set(existing.map(l => `${l.target_type}:${l.target_id}`))

    const toInsert = currentRefs.filter(r => !existingSet.has(`${r.targetType}:${r.targetId}`))
    const toDelete = existing.filter(l => !currentSet.has(`${l.target_type}:${l.target_id}`))

    // 4. Delete stale links
    if (toDelete.length > 0) {
      const deleteIds = toDelete.map(l => l.id)
      const { error: deleteError } = await supabase
        .from('object_links')
        .delete()
        .in('id', deleteIds)

      if (deleteError) {
        console.warn('[syncNoteLinks] Failed to delete stale links:', deleteError)
      }
    }

    // 5. Insert new links
    if (toInsert.length > 0) {
      const rows = toInsert.map(ref => ({
        source_type: sourceType,
        source_id: noteId,
        target_type: ref.targetType,
        target_id: ref.targetId,
        link_type: 'references' as const,
        is_auto: true,
        created_by: userId,
      }))

      const { error: insertError } = await supabase
        .from('object_links')
        .upsert(rows, {
          onConflict: 'source_type,source_id,target_type,target_id,link_type',
          ignoreDuplicates: true,
        })

      if (insertError) {
        console.warn('[syncNoteLinks] Failed to insert new links:', insertError)
      }
    }
  } catch (err) {
    // Never throw — link sync is non-blocking
    console.warn('[syncNoteLinks] Unexpected error:', err)
  }
}

// ---------------------------------------------------------------------------
// Plain-text pattern resolution
// ---------------------------------------------------------------------------

/**
 * Detect plain-text $TICKER and #Tag patterns, resolve against DB.
 *
 * This catches references users type as regular text without using
 * the suggestion dropdown (e.g. "I think $COIN is a winner").
 *
 * Runs two parallel queries:
 * - $TICKER → assets table (by symbol, case-insensitive)
 * - #Tag → themes (by name, case-insensitive) + portfolios (by name)
 */
async function resolvePlainTextPatterns(html: string): Promise<ExtractedReference[]> {
  const { tickers, hashtags } = extractPlainTextPatterns(html)
  if (tickers.length === 0 && hashtags.length === 0) return []

  const refs: ExtractedReference[] = []
  const queries: Promise<void>[] = []

  // Resolve $TICKER → asset IDs
  if (tickers.length > 0) {
    queries.push((async () => {
      const { data: assets, error } = await supabase
        .from('assets')
        .select('id, symbol')
        .in('symbol', tickers)

      if (error) {
        console.warn('[syncNoteLinks] Failed to resolve tickers:', error)
        return
      }
      if (assets) {
        for (const asset of assets) {
          refs.push({ targetType: 'asset', targetId: asset.id })
        }
      }
    })())
  }

  // Resolve #Tag → themes and portfolios
  if (hashtags.length > 0) {
    // Themes — case-insensitive name match
    queries.push((async () => {
      const { data: themes, error } = await supabase
        .from('org_themes_v')
        .select('id, name')

      if (error) {
        console.warn('[syncNoteLinks] Failed to resolve theme hashtags:', error)
        return
      }
      if (themes) {
        const lowerHashtags = hashtags.map(h => h.toLowerCase())
        for (const theme of themes) {
          // Match hashtag against theme name (case-insensitive, ignore spaces)
          const normalizedName = theme.name.toLowerCase().replace(/\s+/g, '')
          if (lowerHashtags.includes(normalizedName)) {
            refs.push({ targetType: 'theme', targetId: theme.id })
          }
        }
      }
    })())

    // Portfolios — case-insensitive name match
    queries.push((async () => {
      const { data: portfolios, error } = await supabase
        .from('portfolios')
        .select('id, name')

      if (error) {
        console.warn('[syncNoteLinks] Failed to resolve portfolio hashtags:', error)
        return
      }
      if (portfolios) {
        const lowerHashtags = hashtags.map(h => h.toLowerCase())
        for (const portfolio of portfolios) {
          const normalizedName = portfolio.name.toLowerCase().replace(/\s+/g, '')
          if (lowerHashtags.includes(normalizedName)) {
            refs.push({ targetType: 'portfolio', targetId: portfolio.id })
          }
        }
      }
    })())
  }

  await Promise.all(queries)
  return refs
}
