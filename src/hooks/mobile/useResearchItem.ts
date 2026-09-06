import { useQuery } from '@tanstack/react-query'

import { supabase } from '../../lib/supabase'
import type { ResearchReaderTarget } from '../../lib/signals/feed-actions'

/**
 * One research item, fetched to be READ.
 *
 * ── Why the body is not already in hand ───────────────────────────────────
 *
 * The candidate scan deliberately never selects `content` — production holds a
 * 2 MB note body, and reading it for every candidate would make the feed's
 * first paint a function of the longest note anybody has ever written. It
 * takes `content_preview` instead. So the full text is fetched here, once, for
 * the one item somebody chose to open, and not before.
 *
 * That is also why this is a hook rather than an enrichment: `enabled` is what
 * keeps the request from happening until the reader is actually open.
 */

export interface ResearchItem {
  id: string
  kind: 'note' | 'thought'
  title: string | null
  /** Raw stored content. Notes are HTML; thoughts are plain text. */
  content: string | null
  /** ISO. `created_at` — see `EvidenceArrival.at` for why never `updated_at`. */
  createdAt: string | null
  authorId: string | null
  authorName: string | null
  assetId: string | null
  /**
   * `note_type` on a note, `idea_type` on a thought. The object's own word for
   * what it is, shown rather than invented.
   */
  itemType: string | null
  /** Present on quick thoughts that were captured from somewhere. */
  source: { title: string | null; url: string | null } | null
}

async function authorNameFor(userId: string | null): Promise<string | null> {
  if (!userId) return null
  const { data } = await supabase
    .from('users')
    .select('id, email, first_name, last_name')
    .eq('id', userId)
    .maybeSingle()
  if (!data) return null
  const u = data as { email: string | null; first_name: string | null; last_name: string | null }
  const name = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return name || u.email || null
}

export function useResearchItem(target: ResearchReaderTarget | null) {
  return useQuery({
    queryKey: ['mobile-research-item', target?.kind, target?.id],
    enabled: !!target?.id,
    // The body of a note that already exists does not change while somebody
    // reads it, and re-fetching on every focus change would re-pull a large
    // document for no reason.
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ResearchItem | null> => {
      if (!target) return null

      if (target.kind === 'note') {
        const { data, error } = await supabase
          .from('asset_notes')
          .select('id, title, content, created_at, created_by, asset_id, note_type')
          .eq('id', target.id)
          .eq('is_deleted', false)
          .maybeSingle()
        if (error) throw error
        if (!data) return null
        const r = data as {
          id: string; title: string | null; content: string | null
          created_at: string | null; created_by: string | null
          asset_id: string | null; note_type: string | null
        }
        return {
          id: r.id,
          kind: 'note',
          // 'Untitled' is the editor's placeholder, not a title somebody chose
          // — the same normalisation the scan applies.
          title: r.title && r.title !== 'Untitled' ? r.title : null,
          content: r.content,
          createdAt: r.created_at,
          authorId: r.created_by,
          authorName: await authorNameFor(r.created_by),
          assetId: r.asset_id,
          itemType: r.note_type,
          source: null,
        }
      }

      const { data, error } = await supabase
        .from('quick_thoughts')
        .select('id, content, created_at, created_by, asset_id, idea_type, source_title, source_url')
        .eq('id', target.id)
        .maybeSingle()
      if (error) throw error
      if (!data) return null
      const r = data as {
        id: string; content: string | null; created_at: string | null
        created_by: string | null; asset_id: string | null; idea_type: string | null
        source_title: string | null; source_url: string | null
      }
      return {
        id: r.id,
        kind: 'thought',
        // A thought has no title field. Manufacturing one from its first
        // sentence would put the same words on screen twice.
        title: null,
        content: r.content,
        createdAt: r.created_at,
        authorId: r.created_by,
        authorName: await authorNameFor(r.created_by),
        assetId: r.asset_id,
        itemType: r.idea_type,
        source: r.source_title || r.source_url
          ? { title: r.source_title, url: r.source_url }
          : null,
      }
    },
  })
}
