/**
 * ACT AI project folders — the rules, kept away from the client.
 *
 * ── What a folder is ─────────────────────────────────────────────────────
 *
 * A named shelf for conversations, owned by one reader inside one
 * organization. "Earnings season", "the Apple case", "IC prep". It is
 * deliberately not a Tesseract Project: Projects carry assignments,
 * deliverables and workflow, and overloading them with chat semantics would
 * make both worse. A folder has a name and nothing else.
 *
 * ── One home, not many ───────────────────────────────────────────────────
 *
 * A conversation is in at most one folder. The alternative -- a membership
 * table -- buys multi-filing and costs the reader the question "where does
 * this live", which is the only question a filing system exists to answer.
 * Cross-cutting relationships are already modelled, by `ai_conversation_tags`
 * ("this thread is about AAPL"), and that is the right place for them.
 *
 * ── Why this module is pure ──────────────────────────────────────────────
 *
 * `hooks/useAI` builds a Supabase client at import time, so nothing declared
 * there can be tested without standing up auth. Naming rules, grouping and
 * the move decision are the parts worth testing, so they live here and take
 * plain data.
 */

/** A folder as the sidebar needs it. */
export interface AIProjectFolder {
  id: string
  name: string
  isArchived: boolean
  /** Null while a row has no stamp, which the live table does not allow. */
  organizationId: string | null
  updatedAt: string | null
}

/** The row shape the client selects. */
export interface AIProjectFolderRow {
  id: string
  name: string | null
  is_archived: boolean | null
  organization_id: string | null
  updated_at: string | null
}

/** Just enough of a conversation to file it. */
export interface FiledConversation {
  id: string
  folder_id?: string | null
  is_pinned?: boolean | null
  last_message_at?: string | null
  title?: string | null
}

export const UNFILED = '__unfiled__' as const
export type FolderSelection = string | typeof UNFILED | null

export const FOLDER_NAME_MAX = 120

/**
 * What the table will accept, decided before the round trip.
 *
 * The same three rules the database enforces (present, within length,
 * unique case- and space-insensitively per reader), checked here so the
 * reader gets a sentence instead of a constraint-violation code. The
 * database remains the authority -- this is a courtesy, not a gate.
 */
export type FolderNameVerdict =
  | { ok: true; name: string }
  | { ok: false; reason: 'empty' | 'too-long' | 'duplicate'; message: string }

export function validateFolderName(
  raw: string,
  existing: readonly { id: string; name: string }[] = [],
  /** The folder being renamed, which may keep its own name. */
  excludeId: string | null = null,
): FolderNameVerdict {
  const name = raw.trim().replace(/\s+/g, ' ')
  if (!name) {
    return { ok: false, reason: 'empty', message: 'Give the folder a name.' }
  }
  if (name.length > FOLDER_NAME_MAX) {
    return {
      ok: false,
      reason: 'too-long',
      message: `Keep the name to ${FOLDER_NAME_MAX} characters or fewer.`,
    }
  }
  const taken = existing.some(f => f.id !== excludeId && f.name.trim().toLowerCase() === name.toLowerCase())
  if (taken) {
    return { ok: false, reason: 'duplicate', message: `You already have a folder called ${name}.` }
  }
  return { ok: true, name }
}

export function shapeFolders(rows: readonly AIProjectFolderRow[] | null | undefined): AIProjectFolder[] {
  return (rows ?? [])
    .filter(r => !!r?.id)
    .map(r => ({
      id: r.id,
      /* A row cannot reach here nameless -- the column is NOT NULL with a
         non-blank check -- so this fallback is for a partial select, not for
         a state the table allows. */
      name: (r.name ?? '').trim() || 'Untitled folder',
      isArchived: r.is_archived === true,
      organizationId: r.organization_id ?? null,
      updatedAt: r.updated_at ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * How many conversations sit on each shelf, including the unfiled one.
 *
 * Counted from the conversations the reader can actually see, so the number
 * beside a folder is a number they can reach. A count taken from the folder
 * table would be a promise the list might not keep.
 */
export function folderCounts(conversations: readonly FiledConversation[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const c of conversations) {
    const key = c.folder_id ?? UNFILED
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/** The conversations on one shelf, or all of them when nothing is selected. */
export function filterByFolder<T extends FiledConversation>(
  conversations: readonly T[],
  selection: FolderSelection,
): T[] {
  if (selection === null) return [...conversations]
  if (selection === UNFILED) return conversations.filter(c => !c.folder_id)
  return conversations.filter(c => c.folder_id === selection)
}

/**
 * Whether a move is worth sending.
 *
 * Returns the folder id to write, or null for "leave it where it is". Moving
 * a conversation to the folder it is already in is a write that changes
 * nothing and invalidates three queries, and the menu offers it, so it is
 * refused here rather than in every caller.
 */
export function moveTarget(
  conversation: FiledConversation | null | undefined,
  to: string | typeof UNFILED,
): { change: true; folderId: string | null } | { change: false } {
  if (!conversation) return { change: false }
  const next = to === UNFILED ? null : to
  const current = conversation.folder_id ?? null
  if (next === current) return { change: false }
  return { change: true, folderId: next }
}

/**
 * A sentence for what just happened, in the product's own words.
 *
 * The reader moved something; the confirmation says where it went and, when
 * it left a shelf, that the thread itself is untouched. Archiving and
 * deleting a folder are different acts and this never blurs them.
 */
export function moveConfirmation(folderName: string | null): string {
  return folderName ? `Moved to ${folderName}.` : 'Moved out of its folder. The conversation is unchanged.'
}

/**
 * What deleting a folder does, spelled out before it is done.
 *
 * `ON DELETE SET NULL` in the schema, so the conversations survive. The
 * reader is told the count, because "delete" next to a list of threads reads
 * as "delete the threads".
 */
export function folderDeletionWarning(folderName: string, conversationCount: number): string {
  if (conversationCount === 0) {
    return `Delete ${folderName}? It holds no conversations.`
  }
  const n = conversationCount
  return `Delete ${folderName}? Its ${n} conversation${n === 1 ? '' : 's'} ${
    n === 1 ? 'is' : 'are'} kept and ${n === 1 ? 'becomes' : 'become'} unfiled. Nothing is deleted with it.`
}
