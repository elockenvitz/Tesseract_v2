/**
 * One filter, two lists.
 *
 * ── The defect this closes ───────────────────────────────────────────────
 *
 * The sidebar had two lists and one of them was unreachable. The live list
 * honoured the search box, the folder rail and the tag chips; the archive,
 * disclosed underneath, honoured none of them and rendered its two hundred
 * rows raw. So a reader who archived a thread and then searched for it by
 * name found nothing -- the box filtered the list the thread was no longer
 * in -- and a folder with four archived threads in it looked empty while the
 * archive below showed every archived thread in the account.
 *
 * Archiving is meant to be reversible. A thread you cannot find is not
 * archived, it is lost, so the way back has to answer the same three
 * questions the way in does.
 *
 * ── Why this is a function and not a second copy ─────────────────────────
 *
 * Two filters over the same rows is two definitions of "matches", and the
 * one on the colder path is the one that rots. This takes the rows and the
 * three criteria and is used by both lists, so neither can drift and a test
 * can drive the rules without a sidebar.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * It does not read message bodies. The search is over titles, which is what
 * the list has loaded and what the reader sees; searching transcripts is a
 * server concern (a text index, or a column that does not exist yet) and
 * pretending to do it client-side over the most recent two hundred threads
 * would be a search that quietly stops at an arbitrary line.
 *
 * It does not scope by organization, because `ai_conversations` has no
 * `organization_id` -- a documented property of the live table, not an
 * oversight here. Ownership is the boundary the database enforces
 * (`user_id = auth.uid()`), and the FOLDER is the org-aware axis: folders
 * are per reader per organization, so a selection naming another firm's
 * folder matches nothing rather than falling back to everything.
 */
import { UNFILED, type FolderSelection } from './folders'

/** Just enough of a conversation to filter it. */
export interface FilterableConversation {
  id: string
  title?: string | null
  folder_id?: string | null
  is_pinned?: boolean | null
  tags?: readonly { type: string; id: string }[]
}

export interface ConversationFilter {
  /** The search box, as typed. Blank means no text criterion. */
  query?: string
  /** null = every thread; UNFILED = the ones on no shelf. */
  folder?: FolderSelection
  /** A `${type}:${id}` key from the chip row, or null. */
  tag?: string | null
  /**
   * Whether the folder axis applies at all.
   *
   * A surface with no folder rail wired must not have its list silently
   * narrowed by a stale selection. `false` means "this surface has no
   * folders feature", which is different from "no folder is selected".
   */
  foldersEnabled?: boolean
}

export const conversationTagKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`

/** Does one thread satisfy all three criteria? */
export function matchesFilter(
  conversation: FilterableConversation,
  { query = '', folder = null, tag = null, foldersEnabled = true }: ConversationFilter,
): boolean {
  if (foldersEnabled && folder !== null) {
    const home = conversation.folder_id ?? null
    if (folder === UNFILED ? home !== null : home !== folder) return false
  }

  const q = query.trim().toLowerCase()
  if (q && !(conversation.title ?? '').toLowerCase().includes(q)) return false

  if (tag && !(conversation.tags ?? []).some(t => conversationTagKey(t) === tag)) return false

  return true
}

/** The threads that satisfy the filter, in the order they arrived. */
export function filterConversations<T extends FilterableConversation>(
  conversations: readonly T[],
  filter: ConversationFilter,
): T[] {
  return conversations.filter(c => matchesFilter(c, filter))
}

/**
 * The live list, split into pinned and the rest.
 *
 * The archive is NOT split: a pin is a statement about what you are working
 * on now, and an archived thread is by definition not that. Honouring a
 * stale pin in the archive would put a thread the reader filed away at the
 * top of the place they filed it.
 */
export function groupConversations<T extends FilterableConversation>(
  conversations: readonly T[],
  filter: ConversationFilter,
): { pinned: T[]; rest: T[] } {
  const pinned: T[] = []
  const rest: T[] = []
  for (const c of filterConversations(conversations, filter)) {
    if (c.is_pinned) pinned.push(c)
    else rest.push(c)
  }
  return { pinned, rest }
}

/**
 * What to say when the archive has rows but none of them match.
 *
 * Named by criterion, because "nothing found" over a list the reader can see
 * is filtered reads as "the archive is empty" -- and the fix is to clear a
 * filter they may have forgotten is on.
 */
export function archiveEmptyReason(
  total: number,
  { query = '', folder = null, tag = null }: ConversationFilter,
): string {
  if (total === 0) return 'Nothing is archived.'
  const q = query.trim()
  if (q) return `No archived conversation matches ${q}.`
  if (tag) return 'No archived conversation carries that reference.'
  if (folder === UNFILED) return 'No archived conversation is unfiled.'
  if (folder) return 'No archived conversation is in this folder.'
  return 'Nothing is archived.'
}

/** Whether any criterion is narrowing the list right now. */
export function isFiltering({ query = '', folder = null, tag = null }: ConversationFilter): boolean {
  return Boolean(query.trim()) || folder !== null || Boolean(tag)
}
