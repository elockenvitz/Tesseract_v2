import type { CardAction, CardActions } from '../contract'

/**
 * Pieces every builder needs, in one place so three builders cannot invent
 * three action grammars — which is precisely how the previous seven card
 * components ended up with four different action bars.
 */

export const pct = (n: number, dp = 1) => `${n >= 0 ? '+' : ''}${n.toFixed(dp)}%`

/** Day precision, for dedupeKey trigger periods. */
export const dayKey = (iso: string): string => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10)
}

/**
 * How old a holdings snapshot may be and still just be called "the book".
 *
 * Three weeks covers any normal upload cadence, including a monthly file that
 * has slipped a little.
 */
export const BOOK_FRESH_DAYS = 21

/**
 * Whether a weight may be spoken about in the present tense.
 *
 * ── The two failures this sits between ────────────────────────────────────
 *
 * Weights come off `portfolio_holdings`, which is a dated snapshot rather than
 * a live position feed. The product's intent is that the newest snapshot IS the
 * current book, and cards should read that way: "MSFT is 6.2% of Core Equity"
 * is what the reader wants, and hedging every such sentence into the past tense
 * makes the whole surface sound like an archive of somebody else's portfolio.
 *
 * The opposite failure is the one this codebase has already shipped once, where
 * a weight from an April upload was presented as current. That is not a wording
 * problem, it is a false claim.
 *
 * So the tense follows the data. Inside the window the card speaks in the
 * present and says nothing about dates, because there is nothing worth saying.
 * Outside it the card carries an explicit chip, because at that point the age of
 * the book is itself part of the finding.
 */
export function bookIsCurrent(asOf: string, now: number = Date.now()): boolean {
  const t = new Date(asOf).getTime()
  if (!Number.isFinite(t)) return false
  return (now - t) / 86_400_000 <= BOOK_FRESH_DAYS
}

/**
 * Deliberately empty. The book-age chip is gone.
 *
 * ── Why it was removed rather than reworded ───────────────────────────────
 *
 * "Book 4mo old" was a caveat about the HOLDINGS SNAPSHOT — a statement that
 * the weights on this card come from a file that is four months old. That is
 * true and it matters, and a chip in the context row is the wrong place to say
 * it: the row is scanned as "is any of this my problem", and a fact about data
 * vintage sitting beside portfolio names reads as a property of the position.
 *
 * It also fired on nearly every card in an org whose holdings load monthly, so
 * it stopped carrying information and became furniture — the reader learns to
 * skip the row that contains it, which is the row that also names their books.
 *
 * The staleness itself is not lost. `PriceContext` states the age of its own
 * series, weights carry their `asOf` into the notes the capture sheet writes,
 * and `bookIsCurrent` is still exported for callers that need to BRANCH on
 * vintage rather than merely mention it.
 *
 * Kept as an empty function rather than deleted so the spread sites do not all
 * have to change shape at once; it returns nothing, so `...bookAgeChip(asOf)`
 * contributes nothing.
 */
export function bookAgeChip(_asOf: string, _now: number = Date.now()): { label: string }[] {
  return []
}

/**
 * Snooze and dismiss on every card, always in that order.
 *
 * Both are inline by definition — a triage surface where dismissing something
 * takes you off the surface is not a triage surface. They live here rather
 * than in each builder so the pair cannot drift apart or go missing from one
 * card type, which is how two of the old cards became dead ends.
 */
export const TRIAGE: CardAction[] = [
  { id: 'snooze', label: 'Snooze for a week', inline: true },
  // "Dismiss", not "Not useful". This hides the card; it says nothing about
  // whether the card was worth showing. Feed-quality feedback is a separate
  // menu item with a separate store — see lib/signals/feed-feedback.ts.
  { id: 'dismiss', label: 'Dismiss', inline: true },
]

/** Always last in the menu, on every card type. */
export const WHY: CardAction = { id: 'why', label: 'Why am I seeing this', inline: true }

/**
 * The app is tab-based rather than routed — there is no `/asset/:id` route —
 * so hrefs here are logical targets the feed resolves to a tab open. They are
 * kept in URL shape because the contract asks for an href and because the
 * moment a route does exist, nothing about these builders has to change.
 */
export const assetHref = (assetId: string) => `/asset/${assetId}`

/**
 * Same convention, for the books a name is held in.
 *
 * A context chip naming a portfolio is the reader's shortest route to "so what
 * does that position actually look like", and until now it was inert text. A
 * chip with an href is a chip the card surface can route.
 */
export const portfolioHref = (portfolioId: string) => `/portfolio/${portfolioId}`

export function actions(
  primary: CardAction,
  open: { label: string; href: string },
  quick: CardAction[] = [],
  menu: CardAction[] = TRIAGE,
): CardActions {
  return { primary, quick, menu: [...menu, WHY], open }
}
