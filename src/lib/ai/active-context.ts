/**
 * The one authoritative answer to "what will ACT AI receive on the next message".
 *
 * ── The defect this exists to make impossible ───────────────────────────
 *
 * The pane drew context in three places from three different sources:
 *
 *   EngagementContextHeader  from `engagementTarget`, never cleared
 *   AiContextChips           from `currentSubject` + `engagementTarget`
 *   AiContextAttach          from `tags`
 *
 * Only the third one is real. `tags` is what is written to
 * `ai_conversation_tags` AND what travels in the request body as
 * `tags: [...]`, so it is the only one of the three that decides what the
 * model is given. The other two were parallel descriptions built from inputs
 * the request never reads.
 *
 * That is why removing a chip near the composer did not remove the context at
 * the top: the top was never showing the same thing. It was showing the
 * request that opened the pane, which nothing can revoke because nothing
 * stores it as context in the first place.
 *
 * So this module does not reconcile the three. It declares that there is one,
 * sources it from `tags` alone, and gives the other two nothing to render.
 *
 * ── The four categories, kept apart on purpose ──────────────────────────
 *
 * Active context      objects in `tags`. Sent. Removable. This module.
 * Event orientation   why the pane was opened. NOT sent as an object, and not
 *                     an attachment -- it is a sentence about the reader's
 *                     own screen. Dismissible, because a reader who has read
 *                     it is done with it.
 * Conversation history previous messages. Already in the transcript, bounded
 *                     and sent as history. Not an attachment, and removing a
 *                     chip must not rewrite it.
 * Evidence            what an answer cited. A record of a past retrieval, not
 *                     a standing permission to read it again.
 *
 * Conflating any two of these is how "I cleared the context" stops being
 * true. `objects` therefore has exactly one input, and the type system is the
 * enforcement: there is no parameter here that could add an object to the
 * list from anywhere else.
 */

import { subjectsAgree } from './conversation-context'

/** Where an active object came from, which is all the reader needs to know. */
export type ContextOrigin =
  /** Supplied by the entry point: the page, event or recommendation. */
  | 'inherited'
  /** The reader attached it by hand. */
  | 'attached'

/** A tag as the pane holds it. */
export interface ActiveContextTag {
  type: string
  id: string
  label?: string
}

/**
 * One object in the active set.
 *
 * Generic over the tag, so `objects` hands back exactly the type it was
 * given. Narrowing it to `ActiveContextTag` here would make the pane cast on
 * the way out -- and a cast is the one thing that could put an object in this
 * list that `tags` did not, which is precisely what this module exists to
 * make impossible.
 */
export interface ActiveContextObject<T extends ActiveContextTag = ActiveContextTag> {
  tag: T
  origin: ContextOrigin
  /** `${type}:${id}`, the key the rest of the AI code uses. */
  key: string
}

/**
 * Why the pane was opened, in words a person reads once.
 *
 * Never carries the producer's `reason` code. "thesisStale" is an evaluator
 * key; it was being rendered to readers as `Raised by thesisStale`, which is
 * an internal identifier wearing a label. The trace still exists on the
 * target for anyone debugging — it just is not UI.
 */
export interface ActiveContextEvent {
  title: string
  detail: string | null
  /**
   * The question the surface suggested about this event, if it offered one.
   *
   * Carried here rather than read from the target directly so that one rule
   * governs it: a seed belongs to an EVENT entry. Opening ACT AI from an
   * asset with nothing wrong is not an event and gets an empty composer.
   */
  seedPrompt: string | null
}

export interface ActiveContextInput<T extends ActiveContextTag = ActiveContextTag> {
  /**
   * The open conversation's tags: the authoritative set.
   *
   * This is the ONLY source of `objects`. Deliberately the only parameter
   * that can contribute one.
   */
  tags: readonly T[] | null | undefined
  /** Which of those keys arrived with the pane rather than from the reader. */
  inheritedKeys?: readonly string[] | null
  /** The entry point's event, when it was opened from one. */
  target?: {
    objectType?: string
    objectId?: string
    issue?: { title?: string | null; detail?: string | null } | null
    seedPrompt?: string | null
  } | null
  /** Where the reader is standing now, from the active tab. */
  currentSubject?: { type: string; id: string } | null
  /** The reader dismissed the orientation line. */
  eventDismissed?: boolean
}

export interface ActiveContext<T extends ActiveContextTag = ActiveContextTag> {
  /** Every object the next message will carry, inherited and attached alike. */
  objects: ActiveContextObject<T>[]
  /** The orientation line, or null when there is nothing to orient about. */
  event: ActiveContextEvent | null
  /** No objects attached. The event does not count: it is not an object. */
  isEmpty: boolean
  /** How many of `objects` the reader did not choose. */
  inheritedCount: number
}

export const contextKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`

export function activeContext<T extends ActiveContextTag>(
  input: ActiveContextInput<T>,
): ActiveContext<T> {
  const inherited = new Set(input.inheritedKeys ?? [])

  /*
   * Deduplicated by key, first occurrence winning.
   *
   * `tags` can legitimately hold the same object twice across a reset: the
   * entry point seeds it and the reader attaches the same name again. Two
   * chips for one object both carry a remove button, and pressing either
   * leaves the other behind looking like the removal failed.
   */
  const seen = new Set<string>()
  const objects: ActiveContextObject<T>[] = []
  for (const tag of input.tags ?? []) {
    if (!tag?.type || !tag?.id) continue
    const key = contextKey(tag)
    if (seen.has(key)) continue
    seen.add(key)
    objects.push({
      tag,
      key,
      origin: inherited.has(key) ? 'inherited' : 'attached',
    })
  }

  return {
    objects,
    event: resolveEvent(input),
    isEmpty: objects.length === 0,
    inheritedCount: objects.filter(o => o.origin === 'inherited').length,
  }
}

/**
 * The orientation line, under three conditions, all of which must hold.
 *
 * Dismissed wins, because the reader said so. Then the target has to still
 * describe where the reader is -- the same `subjectsAgree` rule the rest of
 * the pane uses, and the reason walking from AAPL to MSFT does not leave
 * AAPL's valuation breach announced over an MSFT thread. Then there has to
 * be an issue at all: an asset opened with nothing wrong is category A in the
 * brief, and it gets a context chip and an empty composer, not a banner.
 */
function resolveEvent(input: ActiveContextInput): ActiveContextEvent | null {
  if (input.eventDismissed) return null

  const target = input.target
  const title = target?.issue?.title?.trim()
  if (!title) return null

  const targetSubject = target?.objectType && target?.objectId
    ? { type: target.objectType, id: target.objectId }
    : null
  if (!subjectsAgree(targetSubject, input.currentSubject ?? null)) return null

  const detail = target?.issue?.detail?.trim() || null
  const seed = target?.seedPrompt?.trim() || null

  return { title, detail, seedPrompt: seed }
}

/**
 * One sentence naming what the next message will carry.
 *
 * The pane shows chips; this is for the places a sentence is what fits -- a
 * tooltip, a screen-reader summary, and an assertion a test can make about
 * the whole state rather than about one chip's styling.
 *
 * It names objects only. The event is excluded by design: it is not sent as
 * an object, and a sentence that listed it would restate the confusion this
 * module removes.
 */
export function describeActiveContext(
  context: ActiveContext,
  labelFor: (o: ActiveContextObject) => string = o => o.tag.label || o.tag.id,
): string {
  if (context.objects.length === 0) return 'No context attached. ACT AI answers from this conversation alone.'
  const names = context.objects.map(labelFor)
  const list = names.length === 1
    ? names[0]
    : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  return `ACT AI can use ${list}.`
}
