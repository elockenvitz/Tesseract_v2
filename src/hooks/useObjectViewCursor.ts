/**
 * When did this person last actually look at this object?
 *
 * ── The gap ──────────────────────────────────────────────────────────────
 *
 * `attention_user_state.last_viewed_at` has existed for a long time and has
 * never been written -- zero rows carry one. So every "new since" the product
 * shows is measured against the wrong thing: Research counts notes newer than
 * the THESIS date, which means a note you read yesterday still reads as new,
 * and will until somebody edits the thesis.
 *
 * This writes the cursor, and hands back the value it had BEFORE the visit so
 * a caller can still answer "what changed since I last looked". Reading after
 * advancing would always compare now against now.
 *
 * ── What counts as a view ────────────────────────────────────────────────
 *
 * A detail that actually opened. Not a tile, not a gallery render, not a
 * prefetch, not switching lenses. The caller decides by where it mounts this;
 * the rule is stated on `useRecordObjectView` and enforced by only ever
 * calling it from a detail pane.
 *
 * ── Why no `object.viewed` event ─────────────────────────────────────────
 *
 * A cursor is current state, not history: the only question asked of it is
 * "what is the latest". An append-only view log would be the noisiest table in
 * the product and would answer the same question more slowly.
 *
 * RLS posture: unchanged. `attention_user_state` is per-user and already
 * policy-gated on `user_id`; this adds rows in a new key namespace, no new
 * table and no widened policy.
 */
import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { useAuth } from './useAuth'
import { useOrganization } from '../contexts/OrganizationContext'
import { objectViewKey, type ViewSubjectType } from '../lib/attention-state/keys'

export const VIEW_CURSOR_KEY = ['attention-state', 'view-cursor'] as const

/** Read the stored cursor for one object. Null when never viewed. */
export async function fetchViewCursor(
  userId: string,
  attentionId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from('attention_user_state')
    .select('last_viewed_at')
    .eq('user_id', userId)
    .eq('attention_id', attentionId)
    .maybeSingle()
  if (error) return null
  return (data as { last_viewed_at?: string | null } | null)?.last_viewed_at ?? null
}

export interface ObjectViewCursor {
  /**
   * The cursor as it stood when this detail was opened -- i.e. the END of the
   * previous visit. This is what "since you last looked" compares against.
   * Null on a first-ever view, which callers must treat as "everything is
   * new", not as "nothing is new".
   */
  previous: string | null
  /** False until the prior value has been read, so a caller does not mistake
   *  "not loaded yet" for "never viewed". */
  ready: boolean
}

/**
 * Record that this person has opened this object's detail, and expose what the
 * cursor said beforehand.
 *
 * Call ONLY from a detail surface that has actually opened. Mounting this
 * behind a tile would make the cursor a lie, and every "new since you looked"
 * downstream would quietly become "new since it was last on screen".
 */
export function useRecordObjectView(
  subjectType: ViewSubjectType,
  subjectId: string | null | undefined,
): ObjectViewCursor {
  const { user } = useAuth()
  const { currentOrgId } = useOrganization()
  const queryClient = useQueryClient()

  const [cursor, setCursor] = useState<ObjectViewCursor>({ previous: null, ready: false })
  // One write per (user, object) per mount. A re-render is not a second visit.
  const recordedRef = useRef<string | null>(null)

  const key = objectViewKey(currentOrgId, subjectType, subjectId)

  useEffect(() => {
    if (!key || !user?.id) return
    if (recordedRef.current === key) return
    recordedRef.current = key

    void (async () => {
      // Order matters, and is the whole point: read the PRIOR value first.
      // Advancing before anyone can see it would answer every "what changed
      // since you last looked" with "nothing".
      const previous = await fetchViewCursor(user.id, key)
      setCursor({ previous, ready: true })

      const now = new Date().toISOString()
      const { error } = await supabase
        .from('attention_user_state')
        .upsert(
          {
            user_id: user.id,
            attention_id: key,
            last_viewed_at: now,
            updated_at: now,
          } as never,
          { onConflict: 'user_id,attention_id' },
        )
      // A failed cursor write must not break the detail the reader came for.
      // The consequence is one stale "since" comparison, not a broken page.
      if (error) {
        console.warn('[ViewCursor] could not record view', error)
        return
      }
      queryClient.invalidateQueries({ queryKey: VIEW_CURSOR_KEY })
    })()
  }, [key, user?.id, queryClient])

  return cursor
}
