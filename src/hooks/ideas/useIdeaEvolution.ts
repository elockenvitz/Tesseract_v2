import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { summariseEvolution, type IdeaChangeEvent, type IdeaEvolution } from '../../lib/signals/idea-evolution'

/**
 * How each idea on the page has CHANGED, from the record that can prove it.
 *
 * ── What this deliberately does not do ────────────────────────────────────
 *
 * It does not reconstruct before-and-after values, because the record does not
 * hold them. `updateTradeIdea` writes `changed_fields` accurately — it names
 * `target_price`, `conviction`, `time_horizon` and the rest — but its
 * `state.from` contains only `{ rationale }`. So the log can prove THAT a
 * target was revised and WHEN, and cannot prove what it was revised from.
 *
 * "Target revised · 6d ago" is therefore what this returns. "$120 → $135" is
 * not, and must not be synthesised by chaining events: `createTradeIdea`'s own
 * audit `to` omits `target_price` and `conviction` entirely, so the first
 * revision of either has no floor to measure from and the chain would silently
 * begin at whatever the second edit happened to say.
 *
 * That is a real product gap and it belongs to the durable investment-history
 * work, not here. Widening `state.from` is a one-line service change plus a
 * backfill; doing it as a side effect of a feed pass would put a half-populated
 * history behind a UI that reads as complete.
 *
 * ── One query for the page ────────────────────────────────────────────────
 *
 * `getEntityAuditEvents` exists and takes a single entity, which would be a
 * request per card. This is the same read, batched over the ids the page is
 * already rendering, ordered newest-first and capped — a feed must not issue an
 * unbounded audit scan because somebody scrolled.
 */

/** Cap on rows read for one page of ideas. Generous; bounded. */
const MAX_EVENTS = 400

export function useIdeaEvolution(ideaIds: string[], options?: { enabled?: boolean }) {
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null

  /**
   * Sorted and joined, so scrolling back to a page already fetched is a cache
   * hit rather than a new key. The feed re-renders constantly and an unsorted
   * id list would produce a different key on every pass.
   */
  const key = [...ideaIds].sort().join(',')

  return useQuery<Map<string, IdeaEvolution>>({
    queryKey: ['idea-evolution', currentOrgId, key],
    enabled: (options?.enabled ?? true) && ideaIds.length > 0,
    // Evolution changes when somebody edits an idea, which is not often and is
    // never urgent enough to refetch behind the reader.
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('audit_events')
        .select('entity_id, action_type, changed_fields, occurred_at, actor_name')
        .eq('entity_type', 'trade_idea')
        .in('entity_id', ideaIds)
        .order('occurred_at', { ascending: false })
        .limit(MAX_EVENTS)

      /**
       * A failed read is an absence of evolution, not an error state.
       *
       * The card renders perfectly well with no evolution strip — that is the
       * common case for an idea nobody has revised. Throwing would take a whole
       * feed page down over a decoration, so this logs and degrades, which is
       * the same posture `emitAuditEvent` takes on the write side.
       */
      if (error) {
        console.warn('[ideas] evolution read failed', error)
        return new Map<string, IdeaEvolution>()
      }

      const byIdea = new Map<string, IdeaChangeEvent[]>()
      for (const row of (data ?? []) as any[]) {
        if (!row.entity_id) continue
        const list = byIdea.get(row.entity_id)
        const event: IdeaChangeEvent = {
          actionType: String(row.action_type ?? ''),
          changedFields: Array.isArray(row.changed_fields) ? row.changed_fields : [],
          occurredAt: String(row.occurred_at ?? ''),
          actorName: row.actor_name ?? null,
        }
        if (list) list.push(event)
        else byIdea.set(row.entity_id, [event])
      }

      const out = new Map<string, IdeaEvolution>()
      for (const [id, events] of byIdea) out.set(id, summariseEvolution(events))
      return out
    },
  })
}
