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
  /** What it is about: `asset` | `portfolio` | `theme`, or null. */
  subject_type: string | null
  subject_id: string | null
  /** The project it was filed in, or null. */
  folder_id: string | null
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

/* ─── The save form ────────────────────────────────────────────────────────
 *
 * Everything below is about the dialog that opens when the reader keeps an
 * answer. It used to be a confirmation with a suggested title the reader
 * could not change, no preview, and nowhere to say what the answer was
 * about -- so the only way to find it again was to recognise a sentence
 * somebody's model wrote, in a list.
 *
 * The rules live here rather than in the component because they are the
 * testable part and because the component should not be the only thing that
 * knows what a valid save looks like.
 */

/**
 * What an artifact can be ABOUT.
 *
 * Three types, not the four the sidebar's object search offers. A note is
 * something the reader wrote and lives in one of four separate tables; an
 * asset, a portfolio and a theme are the research objects an ANSWER is
 * about, and each is one table the database guard can actually check. See
 * the trigger in the migration.
 */
export const ARTIFACT_SUBJECT_TYPES = ['asset', 'portfolio', 'theme'] as const
export type ArtifactSubjectType = typeof ARTIFACT_SUBJECT_TYPES[number]

export interface ArtifactSubject {
  type: ArtifactSubjectType
  id: string
  label: string
}

export function isArtifactSubjectType(type: string): type is ArtifactSubjectType {
  return (ARTIFACT_SUBJECT_TYPES as readonly string[]).includes(type)
}

/**
 * The reader's choices, as the dialog holds them while it is open.
 *
 * `subject` and `folderId` are both optional and both default to nothing.
 * Refusing to save an answer for want of a shelf or a subject would be the
 * wrong trade: the association makes it findable, it does not make it valid.
 */
export interface ArtifactDraft {
  title: string
  subject: ArtifactSubject | null
  folderId: string | null
}

/** What the dialog opens with, given the answer and where the reader is. */
export function initialArtifactDraft(input: {
  content: string | null | undefined
  conversationTitle?: string | null
  /** The pane's current subject, when it is a type an artifact can carry. */
  subject?: { type?: string | null; id?: string | null; label?: string | null } | null
  /** The project the conversation is filed in, offered as the default. */
  folderId?: string | null
}): ArtifactDraft {
  const s = input.subject
  /*
   * Pre-filled from where the reader already is, because they are keeping an
   * answer ABOUT something and the pane usually knows what. Pre-filled, not
   * forced: the picker shows it as a removable choice, so an answer kept on
   * the AAPL page that is really about the sector can be retargeted before
   * it is saved rather than mis-filed and corrected later.
   */
  const subject: ArtifactSubject | null =
    s?.type && s?.id && isArtifactSubjectType(s.type)
      ? { type: s.type, id: s.id, label: (s.label ?? '').trim() || s.id }
      : null

  return {
    title: suggestArtifactTitle(input.content, input.conversationTitle),
    subject,
    folderId: input.folderId ?? null,
  }
}

/**
 * The first lines of the answer, for the preview.
 *
 * The dialog shows what is being kept, because the title is a sentence
 * somebody's model wrote and the reader is about to agree to it. Collapsed
 * whitespace and a hard cap: this is a reminder of which answer, not a
 * second copy of it to read.
 */
export function artifactPreview(content: string | null | undefined, max = 280): string {
  const flat = (typeof content === 'string' ? content : '')
    /* Markdown that would render as punctuation in a plain-text block. */
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/[*_`>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Whether this draft can be saved, and why not when it cannot. */
export function artifactDraftError(draft: ArtifactDraft): string | null {
  const titleProblem = artifactTitleError(draft.title)
  if (titleProblem) return titleProblem
  /* Both or neither, the same rule the table's CHECK enforces. A subject
     with no id names nothing. */
  if (draft.subject && !draft.subject.id) return 'That object could not be identified.'
  if (draft.subject && !isArtifactSubjectType(draft.subject.type)) {
    return 'An artifact can be about an asset, a portfolio or a theme.'
  }
  return null
}

/** The row's association columns, as the write needs them. */
export function artifactAssociation(draft: ArtifactDraft): {
  subject_type: ArtifactSubjectType | null
  subject_id: string | null
  folder_id: string | null
} {
  return {
    subject_type: draft.subject?.type ?? null,
    subject_id: draft.subject?.id ?? null,
    folder_id: draft.folderId || null,
  }
}

/**
 * What the dialog says will happen, in the reader's words.
 *
 * Names the destinations rather than describing them generically, because
 * "it will be filed" and "it will be filed in Earnings season, about AAPL"
 * are different amounts of information at the moment of agreeing.
 */
export function describeArtifactSave(
  draft: ArtifactDraft,
  folderName?: string | null,
): string {
  const parts: string[] = []
  if (draft.subject) parts.push(`about ${draft.subject.label}`)
  if (draft.folderId && folderName) parts.push(`in ${folderName}`)
  if (parts.length === 0) return 'Findable outside this thread, and private to you.'
  return `Findable ${parts.join(' and ')}, and private to you.`
}
