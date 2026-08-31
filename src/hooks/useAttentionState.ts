/**
 * Durable personal attention state.
 *
 * Replaces `lib/attention-feed/snooze.ts`, which kept dispositions in
 * `localStorage`: per-browser, per-device, unattributable, and gone when site
 * data is cleared.
 *
 * ── Why this adds no new persistence layer ────────────────────────────────
 *
 * Everything here goes through RPCs that already exist in production, are
 * already `SECURITY DEFINER`, and already derive the acting user from
 * `auth.uid()`:
 *
 *   snooze_attention(p_attention_id, p_until)   unsnooze_attention(p_attention_id)
 *   dismiss_attention(p_attention_id)           undismiss_attention(p_attention_id)
 *   dismiss_attention_with_reason(p_attention_id, p_reason, p_note)
 *
 * Both writers `INSERT ... ON CONFLICT (user_id, attention_id) DO UPDATE`, so
 * repeated dispositions are idempotent rather than duplicating rows. No table,
 * no column, no migration, and no client-side store were added.
 *
 * ── Attribution ───────────────────────────────────────────────────────────
 *
 * The client never sends a user id and could not spoof one if it tried: the
 * RPCs take only the key. The human in the session is always the actor, and
 * there is no code path by which an AI proposal could take a disposition on
 * someone's behalf.
 */

import { useCallback, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import {
  suppressedKeys,
  suppressionFor,
  snoozeUntilISO,
} from '../lib/attention-state/suppression'
import type {
  DismissReason,
  PersonalAttentionRow,
  SuppressionReason,
} from '../lib/attention-state/types'

export const ATTENTION_STATE_QUERY_KEY = ['attention-user-state'] as const

/**
 * One user's personal attention state, plus the verbs that change it.
 *
 * Reads the whole of the user's own state in a single query. That is cheap and
 * stays cheap: RLS scopes the table to the caller, and a row only exists once
 * a person has actually snoozed or dismissed something — so the common case is
 * a handful of rows, not a scan.
 */
export function useAttentionState() {
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const { data: rows = [], isLoading } = useQuery<PersonalAttentionRow[]>({
    queryKey: ATTENTION_STATE_QUERY_KEY,
    enabled: !!user?.id,
    // Personal state changes only through this hook or another of the user's
    // own sessions, so it does not need to be re-fetched aggressively; a
    // window focus is the moment another device's change matters.
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('attention_user_state')
        .select('attention_id, snoozed_until, dismissed_at, dismiss_reason')
      if (error) throw new Error(error.message)
      return (data ?? []) as PersonalAttentionRow[]
    },
  })

  const byKey = useMemo(() => {
    const map = new Map<string, PersonalAttentionRow>()
    for (const row of rows) map.set(row.attention_id, row)
    return map
  }, [rows])

  const suppressed = useMemo(() => suppressedKeys(rows), [rows])

  /**
   * Optimistic local write.
   *
   * A disposition is a click on a row the user wants gone; waiting on a round
   * trip to make it disappear reads as a broken button. The mutation's
   * `onSettled` refetch is what makes the server the source of truth again.
   */
  const patch = useCallback(
    (attentionId: string, next: Partial<PersonalAttentionRow>) => {
      queryClient.setQueryData<PersonalAttentionRow[]>(ATTENTION_STATE_QUERY_KEY, prev => {
        const list = prev ?? []
        const existing = list.find(r => r.attention_id === attentionId)
        if (existing) {
          return list.map(r => (r.attention_id === attentionId ? { ...r, ...next } : r))
        }
        return [
          ...list,
          {
            attention_id: attentionId,
            snoozed_until: null,
            dismissed_at: null,
            dismiss_reason: null,
            ...next,
          },
        ]
      })
    },
    [queryClient],
  )

  const settle = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ATTENTION_STATE_QUERY_KEY })
    // The attention surfaces read the same rows through their own query.
    queryClient.invalidateQueries({ queryKey: ['attention'] })
  }, [queryClient])

  const snoozeMutation = useMutation({
    mutationFn: async ({ attentionId, hours }: { attentionId: string; hours: number }) => {
      const { error } = await supabase.rpc('snooze_attention', {
        p_attention_id: attentionId,
        p_until: snoozeUntilISO(hours),
      })
      if (error) throw new Error(error.message)
    },
    onMutate: ({ attentionId, hours }) =>
      patch(attentionId, { snoozed_until: snoozeUntilISO(hours), dismissed_at: null }),
    onSettled: settle,
  })

  const unsnoozeMutation = useMutation({
    mutationFn: async (attentionId: string) => {
      const { error } = await supabase.rpc('unsnooze_attention', { p_attention_id: attentionId })
      if (error) throw new Error(error.message)
    },
    onMutate: attentionId => patch(attentionId, { snoozed_until: null }),
    onSettled: settle,
  })

  const dismissMutation = useMutation({
    mutationFn: async ({
      attentionId,
      reason,
      note,
    }: { attentionId: string; reason?: DismissReason; note?: string }) => {
      // The reasoned variant is a different RPC rather than a nullable
      // argument on the plain one, so passing no reason cannot accidentally
      // write a null into a CHECK-constrained column.
      const { error } = reason
        ? await supabase.rpc('dismiss_attention_with_reason', {
            p_attention_id: attentionId,
            p_reason: reason,
            p_note: note ?? null,
          })
        : await supabase.rpc('dismiss_attention', { p_attention_id: attentionId })
      if (error) throw new Error(error.message)
    },
    onMutate: ({ attentionId, reason }) =>
      patch(attentionId, {
        dismissed_at: new Date().toISOString(),
        dismiss_reason: reason ?? null,
      }),
    onSettled: settle,
  })

  const undismissMutation = useMutation({
    mutationFn: async (attentionId: string) => {
      const { error } = await supabase.rpc('undismiss_attention', { p_attention_id: attentionId })
      if (error) throw new Error(error.message)
    },
    onMutate: attentionId => patch(attentionId, { dismissed_at: null, dismiss_reason: null }),
    onSettled: settle,
  })

  return {
    isLoading,
    /** Keys currently hidden from this user, snooze expiry already applied. */
    suppressedKeys: suppressed,
    isSuppressed: useCallback((key: string) => suppressed.has(key), [suppressed]),
    /** Why an item is hidden, for a UI that wants to say so. */
    suppressionFor: useCallback(
      (key: string): SuppressionReason => suppressionFor(byKey.get(key)),
      [byKey],
    ),

    /** Personal. Hides the item for this user until the snooze expires. */
    snoozeForMe: useCallback(
      (attentionId: string, hours: number) => snoozeMutation.mutate({ attentionId, hours }),
      [snoozeMutation],
    ),
    unsnoozeForMe: useCallback(
      (attentionId: string) => unsnoozeMutation.mutate(attentionId),
      [unsnoozeMutation],
    ),
    /** Personal. Hides the item for this user; changes no shared state. */
    dismissForMe: useCallback(
      (attentionId: string, reason?: DismissReason, note?: string) =>
        dismissMutation.mutate({ attentionId, reason, note }),
      [dismissMutation],
    ),
    undismissForMe: useCallback(
      (attentionId: string) => undismissMutation.mutate(attentionId),
      [undismissMutation],
    ),
  }
}
