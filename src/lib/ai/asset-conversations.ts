/**
 * The reader's own CoAnalyst conversations about one asset.
 *
 * ── What an asset tag does and does not say ─────────────────────────────
 *
 * `ai_conversation_tags` records that a conversation was STARTED with this
 * asset bound as context — nothing more. It is not evidence that the thread
 * substantively investigates the company, and this module never presents it
 * as such: it carries the title the conversation already has, the timestamps
 * it already has, and no claim about content. There is no message-level
 * entity index to support a stronger statement, and inventing one from a tag
 * would be the kind of inference that makes a surface untrustworthy.
 *
 * ── Privacy ─────────────────────────────────────────────────────────────
 *
 * `ai_conversations` is `user_id = auth.uid()` for ALL commands, and
 * `ai_conversation_tags` is gated through that ownership. So RLS alone would
 * return only the reader's own rows. The query still filters on `user_id`
 * explicitly — defence in depth, and so the intent is legible at the call
 * site rather than resting on a policy a reader has to go and look up.
 */

export interface AssetConversation {
  id: string
  /** The conversation's own title. Never synthesised from message content. */
  title: string
  /** Most recent activity: `last_message_at`, falling back to `updated_at`. */
  lastActivityAt: string | null
  isPinned: boolean
}

/** The row shape the query returns, before shaping. */
export interface AssetConversationRow {
  id: string
  title?: string | null
  last_message_at?: string | null
  updated_at?: string | null
  created_at?: string | null
  is_pinned?: boolean | null
  is_archived?: boolean | null
  user_id?: string | null
}

/** A conversation with no title still has to be nameable. */
export const UNTITLED_CONVERSATION = 'Untitled conversation'

/**
 * Shape and order the rows.
 *
 * Pinned first, then most recent activity. `last_message_at` is the honest
 * measure of "when did I last work on this" — `updated_at` also moves when a
 * thread is renamed or archived — but it is nullable, so `updated_at` is the
 * fallback and a row with neither sorts last rather than being dropped.
 *
 * `ownerId` is required: passing it is what makes the ownership filter a
 * decision rather than an oversight. A row that fails it is dropped silently,
 * because the only way one can arrive is a policy regression, and rendering
 * it would be the bug.
 */
export function shapeAssetConversations(
  rows: readonly AssetConversationRow[] | null | undefined,
  ownerId: string | null | undefined,
): AssetConversation[] {
  if (!rows || !ownerId) return []

  return rows
    .filter(r => !!r?.id && !r.is_archived && r.user_id === ownerId)
    .map(r => ({
      id: r.id,
      title: (r.title ?? '').trim() || UNTITLED_CONVERSATION,
      lastActivityAt: r.last_message_at ?? r.updated_at ?? null,
      isPinned: !!r.is_pinned,
    }))
    .sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1
      const at = a.lastActivityAt ? Date.parse(a.lastActivityAt) : NaN
      const bt = b.lastActivityAt ? Date.parse(b.lastActivityAt) : NaN
      const aOk = Number.isFinite(at)
      const bOk = Number.isFinite(bt)
      if (aOk !== bOk) return aOk ? -1 : 1
      if (!aOk && !bOk) return a.title.localeCompare(b.title)
      return bt - at
    })
}
