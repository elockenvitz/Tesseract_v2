/**
 * Resolving a conversation's typed references to objects that still exist.
 *
 * ── Why a query and not a label lookup ───────────────────────────────────
 *
 * `tagLabels` already gives a chip its name, and for a while that looked
 * like enough to make the chip a link. It is not. A label is cached text; a
 * destination has to be a row the reader can read RIGHT NOW. Between
 * attaching a reference and pressing it, the object can be deleted, the
 * reader can lose the portfolio, or the firm can archive the theme -- and in
 * every one of those cases a link built from the cached label opens a tab on
 * an id that resolves to nothing, or worse, looks like it is loading forever.
 *
 * So the references are resolved by reading the objects. One query per type
 * present, ids batched, and the reader's own RLS answers both questions at
 * once: a row that comes back is one they may open, and a row that does not
 * is gone or no longer theirs. The chip is a link exactly when its object
 * resolved.
 *
 * RLS posture — reads only, nothing widened, no new table or policy:
 *   assets           global reference data by design (no org column)
 *   portfolios       the table's own permission predicate
 *   org_themes_v     the org-scoped view the entity search already uses
 *   asset_notes      } each read through the caller's own policies, each
 *   portfolio_notes  } filtered to `is_deleted <> true` so a trashed note
 *   theme_notes      } reads as gone rather than as unreadable
 *
 * `custom_notebook_notes` is deliberately absent. The shell has no
 * destination for a notebook note -- its tab renderer knows asset,
 * portfolio and theme notes -- so such a reference stays unresolved and the
 * chip stays text. Inventing a destination for it would be a tab that
 * renders "Note data not available".
 *
 * ── Scale ────────────────────────────────────────────────────────────────
 *
 * A conversation carries a handful of references, so this is at most six
 * small `in` queries, keyed on the exact set of references and cached. It
 * runs when the attached set changes, not on every keystroke.
 */
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import {
  NOTE_SOURCES, referenceKey, isReferenceType,
  type ResolvedReference, type NoteEntityType,
} from '../../lib/ai/reference-targets'

export interface ReferenceTargets {
  /** `${type}:${id}` → the object, for references that resolved. */
  targets: Map<string, ResolvedReference>
  /** True while the first read for the current set is in flight. */
  isLoading: boolean
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v : null)

export function useReferenceTargets(
  tags: readonly { type: string; id: string }[],
): ReferenceTargets {
  /* Keyed on the exact set, sorted, so re-ordering the chips is not a new
     query and attaching one is. */
  const key = useMemo(
    () => tags.filter(t => isReferenceType(t.type) && t.id).map(referenceKey).sort().join('|'),
    [tags],
  )

  const { data, isLoading } = useQuery<Map<string, ResolvedReference>>({
    queryKey: ['ai-reference-targets', key],
    enabled: key.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const found = new Map<string, ResolvedReference>()
      const ids = (type: string) =>
        key.split('|').filter(k => k.startsWith(`${type}:`)).map(k => k.slice(type.length + 1))

      const assetIds = ids('asset')
      const portfolioIds = ids('portfolio')
      const themeIds = ids('theme')
      const noteIds = ids('note')

      const work: Promise<void>[] = []

      if (assetIds.length) {
        work.push((async () => {
          const { data: rows } = await supabase
            .from('assets')
            .select('id, symbol, company_name')
            .in('id', assetIds)
          for (const r of (rows ?? []) as Record<string, unknown>[]) {
            const id = str(r.id)
            if (!id) continue
            const symbol = str(r.symbol)
            found.set(`asset:${id}`, {
              type: 'asset', id, label: symbol ?? str(r.company_name) ?? 'Asset',
              symbol, companyName: str(r.company_name),
            })
          }
        })())
      }

      if (portfolioIds.length) {
        work.push((async () => {
          const { data: rows } = await supabase
            .from('portfolios')
            .select('id, name, description, benchmark, portfolio_id')
            .in('id', portfolioIds)
          for (const r of (rows ?? []) as Record<string, unknown>[]) {
            const id = str(r.id)
            if (!id) continue
            found.set(`portfolio:${id}`, {
              type: 'portfolio', id, label: str(r.name) ?? 'Portfolio', row: r,
            })
          }
        })())
      }

      if (themeIds.length) {
        work.push((async () => {
          const { data: rows } = await supabase
            .from('org_themes_v')
            .select('id, name, description, color, theme_type')
            .in('id', themeIds)
          for (const r of (rows ?? []) as Record<string, unknown>[]) {
            const id = str(r.id)
            if (!id) continue
            found.set(`theme:${id}`, {
              type: 'theme', id, label: str(r.name) ?? 'Theme', row: r,
            })
          }
        })())
      }

      /*
       * A note's id does not say which table it is in, so each is probed.
       * First table that returns it wins, and ids are uuids across all
       * three, so there is no ambiguity to resolve.
       */
      if (noteIds.length) {
        for (const source of NOTE_SOURCES) {
          work.push((async () => {
            const { data: rows } = await supabase
              .from(source.table)
              .select(`id, title, ${source.fk}, ${source.join}`)
              .in('id', noteIds)
              .neq('is_deleted', true)
            for (const r of (rows ?? []) as Record<string, unknown>[]) {
              const id = str(r.id)
              if (!id) continue
              const entityId = str(r[source.fk])
              if (!entityId) continue
              const entityRow = (r[source.join.split('(')[0]!] ?? null) as Record<string, unknown> | null
              const entityName = entityRow
                ? str(entityRow.symbol) ?? str(entityRow.name) ?? entityId
                : entityId
              found.set(`note:${id}`, {
                type: 'note', id,
                label: str(r.title) ?? 'Untitled note',
                entityType: source.entityType as NoteEntityType,
                entityId, entityName, entityRow,
              })
            }
          })())
        }
      }

      await Promise.all(work)
      return found
    },
  })

  return {
    targets: data ?? new Map(),
    isLoading: key.length > 0 && isLoading,
  }
}
