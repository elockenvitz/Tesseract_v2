import type { ExploreItem } from '../mobile/explore-item'

/**
 * Whether an Explore preview has anything to show.
 *
 * ── The defect this exists to stop recurring ──────────────────────────────
 *
 * Desktop Explore rendered tiles whose entire visible content was the category
 * word — a grid cell, a border, and `DECISIONS`. The cause was a shape
 * mismatch upstream and is fixed at its source, but the shape of the failure is
 * worth guarding: every field a tile draws is optional, so ANY producer that
 * hands over the wrong object produces a card-shaped hole rather than an error.
 * Nothing between the adapter and the DOM had an opinion about whether there
 * was anything to draw.
 *
 * So this is the opinion. It is a filter on the INPUT to composition, not a
 * style on the output: a contentless item must never reach `diversifyExplore`,
 * because by then it has been scored, given emphasis and allocated a cell, and
 * hiding it afterwards leaves the hole it was occupying.
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *
 * One genuine thing beyond the category. A claim, a number, a drawable object,
 * or a clause of context. Deliberately generous — the job is to catch nothing,
 * not to police quality — and deliberately NOT satisfiable by anything derived
 * from the category or the type, because a label expanded into a sentence is
 * the placeholder prose this must not produce.
 *
 * Pure. `hasVisual` is passed in rather than computed, so the caller asks
 * `exploreVisualFor` exactly once and the answer the tile will draw is the
 * answer this decides on.
 */

export interface Renderability {
  ok: boolean
  /** Why not, for the caller to report. Empty when it is fine. */
  why: string
}

export function exploreRenderability(
  item: ExploreItem,
  opts: { hasVisual?: boolean } = {},
): Renderability {
  if (item.title?.trim()) return OK
  if (item.metric?.value?.trim()) return OK
  if (opts.hasVisual) return OK
  if (item.context?.trim()) return OK

  return {
    ok: false,
    why: `${item.id}: no headline, metric, visual or context`,
  }
}

const OK: Renderability = { ok: true, why: '' }

/**
 * Drop the ones that cannot be drawn, and say which.
 *
 * Returns the reasons rather than logging them, so the surface can report a gap
 * the same way it reports a missing producer — named, not silently absent.
 */
export function renderableExploreItems(
  items: ExploreItem[],
  hasVisual: (item: ExploreItem) => boolean,
): { items: ExploreItem[]; dropped: string[] } {
  const kept: ExploreItem[] = []
  const dropped: string[] = []
  for (const item of items) {
    const r = exploreRenderability(item, { hasVisual: hasVisual(item) })
    if (r.ok) kept.push(item)
    else dropped.push(r.why)
  }
  return { items: kept, dropped }
}
