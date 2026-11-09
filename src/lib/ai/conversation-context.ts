/**
 * Does the open CoAnalyst conversation belong to where the reader is standing?
 *
 * ── The defect this exists to make impossible ───────────────────────────
 *
 * The pane takes its subject from the engagement target, and `Layout` sets
 * that target on every engagement and never clears it. So after resuming a
 * thread from AAPL, walking to MSFT left the pane holding AAPL's conversation
 * and labelling itself "Asset AAPL" while the screen said MSFT. Measured, in
 * that order, on the running app. A message typed there joined the AAPL
 * thread, and nothing on screen said so.
 *
 * Clearing the thread on navigation would fix the mislabel by throwing away
 * the investigation, and investigations legitimately span companies — a
 * thread comparing AAPL and MSFT is a thread, not a mistake. So the fix is
 * not to move the conversation. It is to stop the pane claiming a subject the
 * conversation does not have, and to make "continue here" and "start one
 * about what I am looking at" two visible choices instead of one silent one.
 *
 * This module decides only which of those three states the pane is in. It
 * moves nothing, writes nothing, and re-tags nothing.
 */

/** A tag on a conversation: what the thread is bound to. */
export interface ConversationTagLike {
  type: string
  id: string
}

/** Where the reader is standing right now. */
export interface CurrentSubject {
  type: string
  id: string
  /** For the prompt: "Start one about MSFT". */
  label?: string | null
}

export type ConversationContextState =
  /** No conversation is open. Anything sent begins a new one, here. */
  | 'empty'
  /** The open conversation is already bound to where the reader is. */
  | 'matches'
  /**
   * A conversation is open and the current subject is NOT among its tags.
   * Continuing is valid and stays available; it must simply be said out loud.
   */
  | 'foreign'

export interface ConversationContextInput {
  /** Null/undefined when no thread is loaded. */
  conversationId: string | null | undefined
  /** The OPEN conversation's own tags, as loaded with it. */
  conversationTags: readonly ConversationTagLike[] | null | undefined
  /** The asset/portfolio/theme page the reader is on, if any. */
  currentSubject: CurrentSubject | null | undefined
}

export function conversationContextState(
  input: ConversationContextInput,
): ConversationContextState {
  const { conversationId, conversationTags, currentSubject } = input

  if (!conversationId) return 'empty'

  /*
   * No current subject is not a mismatch.
   *
   * The reader may be on a dashboard, a list, or any surface that binds
   * nothing. Warning there would fire on screens where there is no second
   * subject to confuse the first with, and a warning that cries wolf is how
   * the real one stops being read.
   */
  if (!currentSubject?.id || !currentSubject?.type) return 'matches'

  const tags = conversationTags ?? []
  /*
   * An open conversation whose tags have not loaded is NOT declared foreign.
   *
   * `selectConversation` sets the id and the tags from two different places,
   * and an empty array during that gap would flash "this is about something
   * else" at a thread that is about exactly this. Silence until it is known.
   */
  if (tags.length === 0) return 'matches'

  const bound = tags.some(t => t.type === currentSubject.type && t.id === currentSubject.id)
  return bound ? 'matches' : 'foreign'
}

/**
 * Do two subjects describe the same object?
 *
 * Absent on either side is agreement, not disagreement: a reader on a
 * dashboard has no subject to contradict the pane's, and a pane with no
 * bound object contradicts nothing.
 */
export function subjectsAgree(
  a: { type: string; id: string } | null | undefined,
  b: { type: string; id: string } | null | undefined,
): boolean {
  if (!a?.id || !a?.type) return true
  if (!b?.id || !b?.type) return true
  return a.type === b.type && a.id === b.id
}

/**
 * The tag a new conversation started from this subject should carry.
 *
 * `ai_conversation_tags.tag_type` understands four kinds; a fifth would be
 * stored, shown, and silently ignored by the edge function that assembles
 * context. Anything else returns null, and the caller must then not claim
 * the new thread is bound to it.
 */
const TAGGABLE = new Set(['asset', 'portfolio', 'theme', 'note'])

export function subjectTag(
  subject: { type: string; id: string; label?: string | null } | null | undefined,
): { type: string; id: string; label?: string } | null {
  if (!subject?.id || !TAGGABLE.has(subject.type)) return null
  const label = shortSubjectLabel(subject.label)
  return { type: subject.type, id: subject.id, ...(label ? { label } : {}) }
}

/**
 * The short name for a subject, for use inside a sentence or a button.
 *
 * Tab titles are built as "MSFT - Microsoft Corporation", which reads badly
 * in "Start one about …". Takes the ticker half when the title has that
 * shape and otherwise leaves the label alone — it never invents a name.
 */
export function shortSubjectLabel(label: string | null | undefined): string | null {
  const text = (label ?? '').trim()
  if (!text) return null
  const [head] = text.split(' - ')
  const short = head.trim()
  return short || text
}

/**
 * What a message sent right now would do, in the reader's words.
 *
 * Used for the one line the pane shows when the states diverge; also the
 * single sentence a test can assert, so "which conversation receives this"
 * is answerable without reading the component.
 */
export function describeSendTarget(
  state: ConversationContextState,
  conversationTitle: string | null | undefined,
): string {
  if (state === 'empty') return 'Starts a new conversation.'
  const name = (conversationTitle ?? '').trim()
  return name
    ? `Continues “${name}”.`
    : 'Continues the open conversation.'
}
