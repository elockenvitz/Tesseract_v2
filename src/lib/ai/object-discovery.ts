/**
 * Finding the thing you want to talk about, instead of reading a wall of it.
 *
 * ── What this replaces ───────────────────────────────────────────────────
 *
 * The sidebar carried a permanent row of object chips -- every asset,
 * portfolio and theme any of the reader's conversations had ever been tagged
 * with, up to twelve of them, sorted by how often they appeared. It was
 * presented as a filter and it worked as one, but it had two problems that
 * get worse rather than better with use:
 *
 *   1. It does not scale. Twelve chips out of two hundred objects is a
 *      sample, not an index, and which twelve you get is decided by a
 *      frequency sort you cannot see or change. The reader who wants the one
 *      AAPL thread from March is not helped by a chip row at all.
 *   2. It is always there. It occupies a band above the conversation list
 *      whether or not the reader is looking for an object, and most of the
 *      time they are looking for a conversation.
 *
 * So discovery becomes a search, and the chips go. The capability does not:
 * narrowing to one object's conversations is still exactly what happens, it
 * is just reached by naming the object rather than by hunting for its chip.
 *
 * ── Canonical ids, and why `type:id` is the only key ────────────────────
 *
 * An object is identified by its type and its database id, never by its
 * label. `AAPL` is a symbol that can be reassigned, two themes can share a
 * name, and a note's title is whatever someone typed. `ai_conversation_tags`
 * stores `(tag_type, tag_id)` and the request body carries `{type, id}`, so
 * `type:id` is the key the whole surface already agrees on -- and matching a
 * conversation to an object by anything else is how a reader ends up looking
 * at another object's threads.
 *
 * ── Permission scoping is not done here ─────────────────────────────────
 *
 * Deliberately. The search runs through `useEntitySearch`, under the
 * reader's own RLS, so an object they cannot read is an object that never
 * comes back -- and nothing in this module can widen that, because it only
 * ever sorts and filters results it was handed. A client-side permission
 * filter would be the wrong place for one and would imply the query needed
 * it.
 */

/** The object types ACT AI can hold as context and be asked about. */
export const DISCOVERY_TYPES = ['asset', 'portfolio', 'theme', 'note'] as const
export type DiscoveryType = typeof DISCOVERY_TYPES[number]

/** An object the reader can open, as the sidebar needs it. */
export interface DiscoveredObject {
  type: DiscoveryType
  /** The database id. The canonical identity, and the only one. */
  id: string
  label: string
  /** The company name, the benchmark, what kind of note. Optional. */
  detail?: string | null
}

/** A search result as `useEntitySearch` returns it. */
export interface EntityResultLike {
  id: string
  type: string
  title?: string | null
  subtitle?: string | null
}

/** Anything with tags, which is what a conversation summary is here. */
export interface TaggedConversation {
  tags?: readonly { type: string; id: string }[] | null
}

export const discoveryKey = (o: { type: string; id: string }) => `${o.type}:${o.id}`

export function isDiscoveryType(type: string): type is DiscoveryType {
  return (DISCOVERY_TYPES as readonly string[]).includes(type)
}

/**
 * Whether a query is worth fanning out four table searches for.
 *
 * One character matches most of the database and costs the same four
 * round trips as a real query. Two is the shortest query that can mean
 * something -- there are two-letter tickers -- so that is the floor.
 */
export const OBJECT_SEARCH_FLOOR = 2

export function shouldSearchObjects(query: string): boolean {
  return query.trim().length >= OBJECT_SEARCH_FLOOR
}

/**
 * Search results as objects, ranked so the obvious answer is first.
 *
 * `useEntitySearch` resolves its per-type queries in parallel and pushes
 * them into one array as they land, so its order is whichever table answered
 * first. For a reader who typed `AAPL`, an asset note whose title happens to
 * contain `AAPL` arriving before the asset itself is a worse answer in a
 * higher position, decided by network timing.
 *
 * So: exact label match, then starts-with, then the rest, and within each
 * band the declared type order. Stable inside a band, because re-sorting
 * equal things differently on every keystroke makes a list that moves under
 * the pointer.
 */
export function rankObjects(
  results: readonly EntityResultLike[] | null | undefined,
  query: string,
  limit = 8,
): DiscoveredObject[] {
  const q = query.trim().toLowerCase()
  const seen = new Set<string>()
  const objects: DiscoveredObject[] = []

  for (const r of results ?? []) {
    if (!r?.id || !isDiscoveryType(r.type)) continue
    const label = (r.title ?? '').trim()
    if (!label) continue
    const key = discoveryKey({ type: r.type, id: r.id })
    if (seen.has(key)) continue
    seen.add(key)
    objects.push({ type: r.type, id: r.id, label, detail: r.subtitle ?? null })
  }

  const band = (o: DiscoveredObject): number => {
    const label = o.label.toLowerCase()
    if (!q) return 2
    if (label === q) return 0
    if (label.startsWith(q)) return 1
    return 2
  }
  const typeRank = (o: DiscoveredObject) => DISCOVERY_TYPES.indexOf(o.type)

  return objects
    .map((o, i) => ({ o, i }))
    .sort((a, b) =>
      band(a.o) - band(b.o) ||
      typeRank(a.o) - typeRank(b.o) ||
      /* The original index, so equal results keep the order they arrived in
         rather than being reshuffled by the sort. */
      a.i - b.i)
    .slice(0, limit)
    .map(({ o }) => o)
}

/**
 * The conversations that are about one object.
 *
 * Matched on `type:id`, never on a label. A conversation tagged with the
 * theme called "Power demand" and an asset whose company name contains
 * "power demand" are different things, and a label match would put one in
 * the other's list.
 */
export function conversationsAbout<T extends TaggedConversation>(
  conversations: readonly T[] | null | undefined,
  object: { type: string; id: string } | null | undefined,
): T[] {
  if (!object?.type || !object?.id) return []
  const key = discoveryKey(object)
  return (conversations ?? []).filter(c =>
    (c.tags ?? []).some(t => t?.type && t?.id && discoveryKey(t) === key))
}

/**
 * What to say above an object's conversations.
 *
 * Says the number, because "no conversations about AAPL" and "none that
 * match what you typed" are different facts and the reader acts on them
 * differently.
 */
export function describeObjectThreads(count: number, label: string): string {
  if (count === 0) return `No conversations about ${label} yet.`
  return `${count} conversation${count === 1 ? '' : 's'} about ${label}.`
}

/** The object as the context row holds it: a tag, with its canonical id. */
export function objectTag(o: DiscoveredObject): { type: DiscoveryType; id: string; label: string } {
  return { type: o.type, id: o.id, label: o.label }
}
