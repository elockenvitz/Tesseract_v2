/**
 * The card, and the page it sits on. One definition, read by every field.
 *
 * ── Why these moved out of the components ─────────────────────────────────
 *
 * The product draws the same object on seven surfaces: the five lens tabs, the
 * Dashboard's three sections, and the feed. Until now each one spelled the
 * card's skin and its page ground as literal class strings in its own file,
 * and the result was the defect this file exists to end -- twice, in opposite
 * directions. First four lenses kept a radius and a shadow that Ideas had
 * dropped, so the same card looked like a different product one tab away.
 * Then three lenses declared no page background at all and showed through to
 * a near-white shell, so their cards had no edge.
 *
 * Both were fixed by copying one lens's literals into the others, which is a
 * fix with a half-life. A constant cannot be copied wrong.
 *
 * ── The reversal recorded ─────────────────────────────────────────────────
 *
 * The values below are not the ones the convergence suite used to pin, and
 * the change was asked for directly: remove the grey page from Explore and
 * Portfolio, and give the tiles better contrast on all three Dashboard
 * sections.
 *
 * The previous answer put the contrast in the PAGE -- a `bg-gray-100` mat
 * behind white cards with a hairline edge and no shadow, on the argument that
 * a shadow under every tile makes a field read as a stack of floating panels
 * rather than one instrument. That argument is still true of a shadow spent
 * everywhere, and it is not what is happening here: the ground goes white, so
 * the mat is no longer available to do the work, and the card's own edge has
 * to carry it instead. A stronger border and one step of elevation is the
 * card doing what the page used to do, not ornament added on top of it.
 *
 * The feed's card was already drawn this way and was never part of the
 * convergence -- which is the other half of the complaint, because the
 * Dashboard's own three sections then disagreed with each other. These values
 * are the feed's, so the convergence now includes the surface that was
 * outside it.
 */

/**
 * The page behind a field of cards.
 *
 * White, and stated rather than left transparent. A field that declares no
 * background inherits whatever shell it happens to be mounted in, which is
 * how three lenses ended up on a ground nobody chose for them.
 */
export const GALLERY_GROUND = 'bg-white dark:bg-gray-900'

/**
 * The card itself, minus its edge colour.
 *
 * `shadow` rather than `shadow-sm`: on a white page the smaller one is
 * `0 1px 2px rgb(0 0 0 / 0.05)`, which is inside the range a cheap monitor
 * renders as nothing -- the same reason the grey mat existed.
 */
export const CARD_SURFACE =
  'rounded-xl border bg-white shadow transition-all dark:bg-gray-800'

/**
 * The resting edge.
 *
 * Kept separate from the hover below so that a tile with nothing to open can
 * take the edge without the reaction. Condition is not interactivity: a break
 * is still a break on a card you cannot press.
 */
export const CARD_EDGE = 'border-gray-300 dark:border-gray-700'

/** A break. Loud on purpose, and the only tone that colours the edge. */
export const CARD_EDGE_CRITICAL = 'border-rose-300 dark:border-rose-900/60'

/**
 * What hover does, on a card that can be opened.
 *
 * Omitted entirely where there is nothing behind the card: one that lights up
 * under the cursor is claiming a press it cannot take.
 */
export const CARD_HOVER =
  'hover:border-gray-400 hover:shadow-md dark:hover:border-gray-600'

export const CARD_HOVER_CRITICAL =
  'hover:border-rose-400 hover:shadow-md dark:hover:border-rose-800'

/**
 * The object in the workspace beside the field.
 *
 * A ring, not a fill. The card's own severity already uses colour, and a
 * selected state that competed with it would make every list look alarming.
 */
export const CARD_EDGE_SELECTED =
  'border-primary-400 ring-1 ring-primary-400 dark:border-primary-500 dark:ring-primary-500'
