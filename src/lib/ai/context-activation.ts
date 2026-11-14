/**
 * Two different facts that `ai_conversation_tags` was being asked to hold.
 *
 * ── The defect this exists to close ─────────────────────────────────────
 *
 * One table was serving two unrelated purposes:
 *
 *   1. ACTIVE REQUEST CONTEXT — what travels in the next request body as
 *      `tags: [...]`. `ai-chat` reads `body.tags` and never re-reads the
 *      table, so this is genuinely the request's own list.
 *   2. THE DURABLE ASSOCIATION — what a conversation is ABOUT, which is how
 *      it is discovered later. `useAssetConversations` inner-joins this exact
 *      table to answer "show me my conversations about AAPL".
 *
 * `removeTag` deleted the row, so it changed both. A reader who finished a
 * twenty-message investigation of AAPL and then cleared context to ask about
 * something else destroyed the only record that the thread was ever about
 * AAPL -- and it vanished from AAPL's conversation list permanently. Adding
 * "Clear all" turned that from a per-chip footgun into one press.
 *
 * ── The split, and why it needs no migration ────────────────────────────
 *
 * The association stays in the table and is no longer deleted by a context
 * change. Activation is held separately, and the request is built from the
 * ACTIVE set, so clearing context still changes the next payload -- it just
 * stops destroying history to do it.
 *
 * ── Where activation is kept, and the honest limitation ─────────────────
 *
 * Per viewer, in `localStorage`, keyed by conversation.
 *
 * There is nowhere else without a migration: `ai_conversation_tags` has only
 * (conversation_id, tag_type, tag_id, created_at) and no `is_active`, and
 * `ai_conversations` has no metadata column to put a deactivated list in.
 * Both were checked against the live schema rather than against the
 * migrations, which do not describe production.
 *
 * So the limitation is real and worth stating plainly: a reader who clears
 * context and then opens the same thread in another browser sees the objects
 * active again. The association is intact and the thread is still
 * discoverable, which is the half that was being lost; the preference is the
 * half that does not survive. The durable fix is one additive column --
 * `ai_conversation_tags.is_active boolean not null default true` -- and it
 * is not applied here because applying a production migration needs
 * approval.
 *
 * ── Why detaching is not ALWAYS a deactivation ──────────────────────────
 *
 * A tag the reader attached and then removed without ever asking anything
 * established no association: nothing was ever sent with it, and no answer
 * ever rested on it. Keeping that row would file the thread under an object
 * it never discussed, which is the mirror of the defect above. So a tag that
 * has not yet travelled in a request is DELETED on detach, and one that has
 * is deactivated. `established` is the caller's record of which.
 */

/** A tag as the pane holds it. */
export interface ActivationTag {
  type: string
  id: string
  label?: string
}

export const activationKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`

/** Where one conversation's deactivated set is kept, per viewer. */
export function activationStorageKey(conversationId: string): string {
  return `ai-context.inactive.${conversationId}`
}

/**
 * What detaching this object should do to the row.
 *
 * `delete` is for an object that never reached a request: no association was
 * established, so there is none to preserve. `deactivate` is for everything
 * else, because the conversation really was conducted with it.
 */
export function detachAction(established: boolean): 'delete' | 'deactivate' {
  return established ? 'deactivate' : 'delete'
}

/**
 * The objects the next request will carry.
 *
 * Order follows the association, so a chip does not move when its neighbour
 * is deactivated. Malformed entries are dropped rather than rendered as a
 * chip with no identity.
 */
export function activeTags<T extends ActivationTag>(
  association: readonly T[] | null | undefined,
  deactivated: ReadonlySet<string> | null | undefined,
): T[] {
  const off = deactivated ?? new Set<string>()
  return (association ?? []).filter(t => t?.type && t?.id && !off.has(activationKey(t)))
}

/**
 * Read one conversation's deactivated set.
 *
 * Every access is guarded. `localStorage` throws on access in a private
 * window and with site data blocked, it is absent in jsdom configurations and
 * in embedded webviews, and a corrupt value is a `JSON.parse` away from
 * taking the pane down. An unreadable store means "nothing deactivated",
 * which renders the association as fully active -- the behaviour this had
 * before activation existed, and therefore the safe failure.
 */
export function readDeactivated(
  conversationId: string | null | undefined,
  store: Pick<Storage, 'getItem'> | null | undefined = safeStore(),
): Set<string> {
  if (!conversationId || !store) return new Set()
  try {
    const raw = store.getItem(activationStorageKey(conversationId))
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((k): k is string => typeof k === 'string'))
  } catch {
    return new Set()
  }
}

/**
 * Write one conversation's deactivated set, or remove the entry when empty.
 *
 * Removing rather than storing `[]` matters: the entries are per
 * conversation and never expire, so a reader who clears and then restores
 * context would otherwise leave a key behind for every thread they ever
 * touched.
 */
export function writeDeactivated(
  conversationId: string | null | undefined,
  keys: ReadonlySet<string>,
  store: Pick<Storage, 'setItem' | 'removeItem'> | null | undefined = safeStore(),
): void {
  if (!conversationId || !store) return
  try {
    const name = activationStorageKey(conversationId)
    if (keys.size === 0) store.removeItem(name)
    else store.setItem(name, JSON.stringify([...keys]))
  } catch {
    /* A full or blocked store costs the preference, not the session. */
  }
}

/** `localStorage` where it exists and can be touched, otherwise null. */
function safeStore(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}
