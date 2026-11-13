/**
 * Keeping an answer as an artifact, and the reason this is gated.
 *
 * ── The persistence model, resolved ───────────────────────────────────────
 *
 * An artifact is a POINTER, never a copy: the conversation, the message's own
 * id, and a title the reader wrote. There is no content column.
 *
 * That is settled rather than cautious. `stripStoredExcerpts` exists in this
 * codebase because a record's words copied into `ai_conversations.messages`
 * became a copy living outside that record's own policy, which nothing
 * re-checked when the original was restricted or deleted. A content column
 * here would reintroduce that one level further out. The answer is already
 * durable where it was written, so an artifact that outlived its
 * conversation would be a title pointing at nothing -- which is why the
 * table cascades with it.
 *
 * ── Why the table is private, not org-wide ────────────────────────────────
 *
 * `ai_conversations` is strictly `user_id = auth.uid()` and carries NO
 * organization at all (verified against the live database, not the
 * migrations). So an org-wide read here would show a colleague a TITLE whose
 * answer they cannot open: a disclosure of what someone is working on with
 * nothing behind it. The row still carries `organization_id`, stamped at
 * write time, because the title is user-authored text and a reader who works
 * in two firms must not see one firm's titles while in the other.
 *
 * Sharing these needs the CONVERSATION's boundary to move first. That is a
 * product decision, not a policy tweak, and nothing here anticipates it.
 *
 * ── Why everything here is behind a capability check ──────────────────────
 *
 * `public.ai_artifacts` DOES NOT EXIST in any environment. The migration is
 * authored and unapplied, and applying it is a production schema change that
 * belongs to its own approval. Until then this must be off -- not failing,
 * not silently discarding, OFF -- because a Keep option that throws is worse
 * than one that is not offered, and a feature that looks live while writing
 * nothing is how this repository accumulated unreachable surfaces.
 *
 * `isMissingTable` is how that is detected rather than declared, so applying
 * the migration turns the feature on with no code change and no flag to
 * remember.
 *
 * Pure. No React, no Supabase.
 */

/** A row of `public.ai_artifacts`, as stored. No content column, by design. */
export interface ArtifactRow {
  id: string
  user_id: string
  organization_id: string
  conversation_id: string
  /** `ChatMessage.id` from inside the conversation's `messages` jsonb. */
  message_id: string
  title: string
  created_at: string
  updated_at: string
}

/** The longest title the table accepts. Enforced by a CHECK, mirrored here. */
export const ARTIFACT_TITLE_MAX = 200

/**
 * Does this error mean the table is not there?
 *
 * Three shapes, because PostgREST reports a missing relation differently
 * depending on where it notices:
 *
 *   42P01     Postgres `undefined_table`, when the statement reaches the
 *             database.
 *   PGRST205  the schema cache has no such table, which is what an
 *             unmigrated project actually returns.
 *   PGRST106  the schema itself is not exposed.
 *
 * The message is checked only as a fallback, and deliberately narrowly: a
 * permission error must NOT land here. "Denied" and "absent" are different
 * findings, and treating a denial as absence would hide a real RLS failure
 * behind a disabled feature.
 */
export function isMissingTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = (error as { code?: unknown }).code
  if (code === '42P01' || code === 'PGRST205' || code === 'PGRST106') return true
  const message = (error as { message?: unknown }).message
  if (typeof message !== 'string') return false
  return /could not find the table|relation .* does not exist/i.test(message)
}

/**
 * The title the dialog opens with.
 *
 * Derived from the answer rather than left empty, because a reader asked to
 * name something before they can keep it mostly does not keep it. The first
 * heading is preferred -- it is what the answer calls itself -- then the
 * first sentence, then the conversation. Never blank: the column has a
 * non-empty CHECK, so a blank default would fail at the database with
 * nothing on screen explaining why.
 */
export function suggestArtifactTitle(
  content: string | null | undefined,
  conversationTitle?: string | null,
): string {
  const text = typeof content === 'string' ? content : ''

  /* A markdown heading, first, with its hashes and emphasis removed. */
  const heading = text.match(/^\s{0,3}#{1,6}\s+(.+)$/m)?.[1]
  const candidate = heading ?? firstSentence(text) ?? conversationTitle ?? ''

  const cleaned = candidate
    .replace(/[*_`]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) return 'Kept answer'
  return clampTitle(cleaned)
}

function firstSentence(text: string): string | null {
  /*
   * Prose only: a fenced block or a table row makes a poor name and a
   * confusing one, since it would read as the answer itself.
   *
   * The fence is tracked rather than matched line by line. Skipping only the
   * ``` delimiters left the CODE between them eligible, so an answer that
   * opened with a query got named `select 1`.
   */
  let fenced = false
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (line.startsWith('```')) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    if (!line || line.startsWith('|') || line.startsWith('>')) continue
    const stripped = line.replace(/^[-*+]\s+/, '').replace(/^\d+[.)]\s+/, '')
    if (!stripped) continue
    const end = stripped.search(/[.!?](\s|$)/)
    return end === -1 ? stripped : stripped.slice(0, end)
  }
  return null
}

/**
 * Cut to what the column accepts, on a word where possible.
 *
 * The ellipsis is included in the budget. A clamp that produced exactly 201
 * characters would be refused by the CHECK, which is the kind of failure that
 * only ever appears for the one reader with a long heading.
 */
export function clampTitle(title: string): string {
  const flat = title.replace(/\s+/g, ' ').trim()
  if (flat.length <= ARTIFACT_TITLE_MAX) return flat
  const room = ARTIFACT_TITLE_MAX - 1
  const cut = flat.slice(0, room)
  const space = cut.lastIndexOf(' ')
  const body = space > room * 0.6 ? cut.slice(0, space) : cut
  return `${body.trimEnd()}…`
}

/** Is this a title the table will accept? Checked before the write, so the
    reason can be shown next to the field rather than thrown. */
export function artifactTitleError(title: string): string | null {
  const flat = title.trim()
  if (!flat) return 'Give it a name you will recognise later.'
  if (flat.length > ARTIFACT_TITLE_MAX) return `Keep it under ${ARTIFACT_TITLE_MAX} characters.`
  return null
}

/**
 * The Keep menu's artifact row.
 *
 * First in the list when the feature is on, because it is the option that
 * does not assert anything about the answer. Filing a comparison table as a
 * "quick thought" claims it is one; keeping it as an artifact claims only
 * that the reader wanted it again.
 */
export const ARTIFACT_KEEP_OPTION = Object.freeze({
  id: 'artifact' as const,
  label: 'Keep as an artifact',
  hint: 'Findable later, outside this thread. Not filed as research.',
})
