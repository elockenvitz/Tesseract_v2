/**
 * One-time backfill script for object_links.
 *
 * Parses all existing note content and populates the object_links table
 * with auto-extracted references.
 *
 * Usage (from browser console or a dev page):
 *   import { backfillObjectLinks } from './lib/object-links/backfill-links'
 *   await backfillObjectLinks()
 *
 * Characteristics:
 * - Idempotent: uses upsert with ignoreDuplicates
 * - Non-destructive: only inserts, never deletes
 * - Batched: processes notes in batches of 50
 * - Logs progress to console
 */

import { supabase } from '../supabase'
import { extractReferencesFromHTML, extractPlainTextPatterns, type ExtractedReference } from './extract-references'
import type { NoteSourceType } from './sync-note-links'

interface NoteRow {
  id: string
  content: string
  created_by: string | null
}

const NOTE_TABLES: { table: string; sourceType: NoteSourceType }[] = [
  { table: 'asset_notes',           sourceType: 'asset_note' },
  { table: 'portfolio_notes',       sourceType: 'portfolio_note' },
  { table: 'theme_notes',           sourceType: 'theme_note' },
  { table: 'custom_notebook_notes', sourceType: 'custom_note' },
]

const BATCH_SIZE = 50

export async function backfillObjectLinks(): Promise<{
  processed: number
  linksCreated: number
  errors: string[]
}> {
  let processed = 0
  let linksCreated = 0
  const errors: string[] = []

  // Pre-build lookup maps for plain-text pattern resolution
  const tickerMap = new Map<string, string>() // symbol → asset ID
  const themeMap = new Map<string, string>()   // lowercase-no-spaces name → theme ID
  const portfolioMap = new Map<string, string>() // lowercase-no-spaces name → portfolio ID

  try {
    const [assetRes, themeRes, portfolioRes] = await Promise.all([
      supabase.from('assets').select('id, symbol'),
      supabase.from('org_themes_v').select('id, name'),
      supabase.from('portfolios').select('id, name'),
    ])
    if (assetRes.data) assetRes.data.forEach(a => tickerMap.set(a.symbol, a.id))
    if (themeRes.data) themeRes.data.forEach(t => themeMap.set(t.name.toLowerCase().replace(/\s+/g, ''), t.id))
    if (portfolioRes.data) portfolioRes.data.forEach(p => portfolioMap.set(p.name.toLowerCase().replace(/\s+/g, ''), p.id))
  } catch (err) {
    console.warn('[backfill] Failed to load lookup maps, plain-text patterns will be skipped:', err)
  }

  for (const { table, sourceType } of NOTE_TABLES) {
    // Fetch all non-deleted notes with content
    const { data: notes, error: fetchError } = await supabase
      .from(table)
      .select('id, content, created_by')
      .eq('is_deleted', false)
      .not('content', 'eq', '')
      .order('created_at', { ascending: true })

    if (fetchError) {
      const msg = `[backfill] Error fetching ${table}: ${fetchError.message}`
      console.error(msg)
      errors.push(msg)
      continue
    }

    if (!notes || notes.length === 0) {
      continue
    }

    // Process in batches
    for (let i = 0; i < notes.length; i += BATCH_SIZE) {
      const batch = notes.slice(i, i + BATCH_SIZE) as NoteRow[]
      const rows: any[] = []

      for (const note of batch) {
        // Structured TipTap refs
        const structuredRefs = extractReferencesFromHTML(note.content)

        // Plain-text refs resolved via pre-built lookup maps
        const plainTextRefs: ExtractedReference[] = []
        const { tickers, hashtags } = extractPlainTextPatterns(note.content)
        for (const ticker of tickers) {
          const assetId = tickerMap.get(ticker)
          if (assetId) plainTextRefs.push({ targetType: 'asset', targetId: assetId })
        }
        for (const tag of hashtags) {
          const normalizedTag = tag.toLowerCase().replace(/\s+/g, '')
          const themeId = themeMap.get(normalizedTag)
          if (themeId) plainTextRefs.push({ targetType: 'theme', targetId: themeId })
          const portfolioId = portfolioMap.get(normalizedTag)
          if (portfolioId) plainTextRefs.push({ targetType: 'portfolio', targetId: portfolioId })
        }

        // Merge and deduplicate
        const seen = new Set(structuredRefs.map(r => `${r.targetType}:${r.targetId}`))
        const allRefs = [...structuredRefs]
        for (const ref of plainTextRefs) {
          const key = `${ref.targetType}:${ref.targetId}`
          if (!seen.has(key)) { seen.add(key); allRefs.push(ref) }
        }

        for (const ref of allRefs) {
          rows.push({
            source_type: sourceType,
            source_id: note.id,
            target_type: ref.targetType,
            target_id: ref.targetId,
            link_type: 'references',
            is_auto: true,
            created_by: note.created_by,
          })
        }
        processed++
      }

      if (rows.length > 0) {
        const { error: upsertError, count } = await supabase
          .from('object_links')
          .upsert(rows, {
            onConflict: 'source_type,source_id,target_type,target_id,link_type',
            ignoreDuplicates: true,
            count: 'exact',
          })

        if (upsertError) {
          const msg = `[backfill] Upsert error in ${table} batch ${i}: ${upsertError.message}`
          console.error(msg)
          errors.push(msg)
        } else {
          linksCreated += count || 0
        }
      }

    }
  }

  return { processed, linksCreated, errors }
}
