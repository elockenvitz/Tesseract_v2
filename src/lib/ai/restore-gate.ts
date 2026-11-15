/*
 * Does the pane yet know what it is showing?
 *
 * ── The defect this exists to name ───────────────────────────────────────
 *
 * Opening the assistant on an asset painted three times:
 *
 *   1. the empty state, with generic prompts, because no tag label had
 *      resolved yet;
 *   2. the same empty state with the labelled prompts, once the asset's
 *      symbol arrived;
 *   3. a restored thread, once the conversation tag rows arrived, a prior
 *      conversation on that asset was matched, and its transcript was
 *      fetched.
 *
 * Every one of those is an honest render of what was known at the time. The
 * defect is that two different facts rendered identically: "we have not
 * finished looking" and "there is nothing here, ask me something". The second
 * is a claim, and it was being made before it was known, then withdrawn.
 *
 * ── Why a pure function ──────────────────────────────────────────────────
 *
 * This lived as an expression inside `useAI`, which builds a Supabase client
 * at import time, so nothing could test it without mocking the data layer --
 * the same reason the suggested prompts moved to `lib/ai`. The condition is
 * four booleans and an upper bound; it should be readable and provable on its
 * own, because a gate nobody can test is how the flicker comes back.
 *
 * No timers here, and none anywhere in this path. A minimum display duration
 * would trade a flicker for a stall, which is the other half of the same bug.
 */

export interface RestoreGateInput {
  /** Messages currently in the thread. */
  messageCount: number
  /** Tags the parent surface bound to NEW conversations (the asset, say). */
  initialTagCount: number
  /** Tags on the OPEN conversation, which the prompts are written from. */
  openTagCount: number
  /** A conversation is already selected. */
  hasConversation: boolean
  /** A transcript this pane has claimed but not yet received. */
  isFetchingClaimedTranscript: boolean
  /** The conversation list is still loading. */
  isLoadingList: boolean
  /**
   * The list has rows whose tag rows have not arrived.
   *
   * Separate from `isLoadingList` because the match is made on TAGS: with the
   * list loaded and the tag rows still in flight, every candidate looks
   * untagged and matches nothing. That frame is what produced paint 2.
   */
  isLoadingConversationTags: boolean
  /** Display labels for the open conversation's tags are still loading. */
  isLoadingTagLabels: boolean
}

/**
 * True while the pane should claim nothing.
 *
 * `messageCount > 0` short-circuits to false by construction: once a thread
 * has content it paints regardless of what else is in flight, so no
 * combination of stuck flags can leave a reader staring at a held frame.
 */
export function isThreadSettling(i: RestoreGateInput): boolean {
  if (i.messageCount > 0) return false

  /* A transcript we asked for. The id is already set, so without this the
     pane would show the empty state for a conversation it is reading. */
  if (i.isFetchingClaimedTranscript) return true

  /* A restore is possible but undecided. Only when the surface actually bound
     something: an unbound pane has nothing to look for and should offer its
     prompts on the first frame. */
  const restorePossible = i.initialTagCount > 0 && !i.hasConversation
  if (restorePossible && (i.isLoadingList || i.isLoadingConversationTags)) return true

  /* The names the prompts are written from. Without this the prompts paint
     unnamed and rewrite themselves a frame later, which is paint 1 to 2. */
  if (i.openTagCount > 0 && i.isLoadingTagLabels) return true

  return false
}
