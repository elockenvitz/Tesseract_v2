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
 * Snooze and dismiss on every card, always in that order.
 *
 * Both are inline by definition — a triage surface where dismissing something
 * takes you off the surface is not a triage surface. They live here rather
 * than in each builder so the pair cannot drift apart or go missing from one
 * card type, which is how two of the old cards became dead ends.
 */
export const TRIAGE: CardAction[] = [
  { id: 'snooze', label: 'Snooze', inline: true },
  { id: 'dismiss', label: 'Not useful', inline: true },
]

/**
 * The app is tab-based rather than routed — there is no `/asset/:id` route —
 * so hrefs here are logical targets the feed resolves to a tab open. They are
 * kept in URL shape because the contract asks for an href and because the
 * moment a route does exist, nothing about these builders has to change.
 */
export const assetHref = (assetId: string) => `/asset/${assetId}`

export function actions(
  primary: CardAction,
  open: { label: string; href: string },
  quick: CardAction[] = TRIAGE,
): CardActions {
  return { primary, quick, open }
}
