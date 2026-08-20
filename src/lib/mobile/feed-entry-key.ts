/**
 * A stable identity for a feed entry.
 *
 * ── Why the feed needs one ────────────────────────────────────────────────
 *
 * Entries were rendered straight out of `.map`, with each branch of the
 * renderer inventing its own React key from whatever id that kind happened to
 * carry. That worked while every entry was mounted for the life of the feed.
 * It stops working the moment slots can collapse and re-expand: a key that
 * changes between renders remounts the card, and a card that remounts loses
 * its carousel position and re-fetches its chart.
 *
 * The pipeline also rebuilds every entry object on every recompute — `{...e,
 * subject}` then `{...r.item, score}` — so object identity is worthless here.
 * The key has to come from the CONTENT.
 *
 * ── Rounds ────────────────────────────────────────────────────────────────
 *
 * Derived insights are deliberately re-presented once per scroll cycle, so the
 * same insight legitimately appears several times in one list. `round` is part
 * of its identity rather than a collision to be papered over.
 */

type AnyEntry = Record<string, any>

/** The natural key for one entry, before collisions are considered. */
function naturalKey(e: AnyEntry): string {
  switch (e?.kind) {
    case 'attention': return `attention:${e.attention?.attention_id ?? ''}`
    case 'idea':      return `idea:${e.idea?.id ?? ''}`
    case 'signal':    return `signal:${e.signal?.id ?? ''}`
    case 'news':      return `news:${e.news?.id ?? ''}`
    case 'template':  return `template:${e.card?.id ?? ''}`
    case 'scenario':  return `scenario:${e.card?.id ?? e.card?.entity?.ticker ?? ''}`
    // Insights repeat by design, once per cycle. The round is part of what
    // this entry IS, not an accident to be disambiguated away.
    case 'insight':   return `insight:${e.insight?.id ?? e.insight?.symbol ?? ''}:${e.round ?? 0}`
    // A lens has no id of its own — it is a view over one position, so its
    // type and subject are its identity.
    case 'lens':      return `lens:${e.lens?.type ?? ''}:${lensSymbol(e.lens)}`
    default:          return `entry:${e?.kind ?? 'unknown'}`
  }
}

function lensSymbol(l: AnyEntry | undefined): string {
  if (!l) return ''
  return l.gap?.symbol ?? l.name?.symbol ?? l.breach?.symbol
      ?? l.target?.symbol ?? l.position?.symbol ?? ''
}

/**
 * Keys for a whole list, guaranteed unique.
 *
 * Uniqueness is enforced here rather than trusted, because a duplicate key is
 * the kind of defect that shows up as one card mysteriously not updating
 * rather than as an error. A repeat gets a deterministic occurrence suffix, so
 * the same list always produces the same keys — which is what keeps a card
 * mounted across recomputes.
 */
export function feedEntryKeys(entries: AnyEntry[]): string[] {
  const seen = new Map<string, number>()
  return entries.map(e => {
    const base = naturalKey(e)
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return n === 0 ? base : `${base}#${n}`
  })
}
