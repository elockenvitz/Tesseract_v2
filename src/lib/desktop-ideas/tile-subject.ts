import type { ExploreItem } from '../mobile/explore-item'

/**
 * What a tile is ABOUT, when it is not about a ticker.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * `TileIdentity` rendered `symbol ?? '—'`, so a card with no ticker led with a
 * bare em dash at the tile's largest type. Measured live on the desktop
 * Explore field: 16 Ideas tiles, and 6 of them had no symbol -- every one of
 * those drew the dash above its headline. It was reported as the Ideas cards
 * "showing as dashed", and the ask was that a card which is not about a name
 * should say what it IS about.
 *
 * ── The ladder, and why it stops ─────────────────────────────────────────
 *
 * A ticker is the strongest subject and is handled by the caller. Failing
 * that:
 *
 *   a BOOK -- a portfolio-scoped finding is about that portfolio, and the
 *   name of the book is the most specific true thing on the card.
 *
 *   a KIND -- a prompt, a thought, a trade idea. `postKind` is the row's own
 *   classification, already resolved by `postKindOf` and carried on the item,
 *   so this is a label for a fact rather than a guess at one.
 *
 *   nothing. Deliberately: the category is already printed on the eyebrow
 *   directly above this line, so falling back to it would print "Ideas" twice
 *   on the same card in two type sizes. An aggregate ("5 new ideas this
 *   week"), a macro story and an economic release all land here, and all three
 *   read better leading with their own headline than with a label.
 *
 * Pure: no React, no clock, no fetch.
 */

/**
 * The post kinds, in the product's own words.
 *
 * Not derived from the string: `trade_idea` would title-case to "Trade Idea",
 * and the product writes "Trade idea". Three entries, because `postKindOf`
 * answers with exactly these or null.
 */
const POST_KIND_SUBJECT: Record<string, string> = {
  thought: 'Thought',
  prompt: 'Prompt',
  trade_idea: 'Trade idea',
}

export function tileSubject(item: Pick<ExploreItem, 'symbol' | 'portfolio' | 'postKind'>): string | null {
  // A ticker is the caller's business; this answers only the absence of one.
  if (item.symbol) return null

  const book = item.portfolio?.name?.trim()
  if (book) return book

  const kind = item.postKind ? POST_KIND_SUBJECT[item.postKind] : null
  return kind ?? null
}
