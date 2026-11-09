/**
 * The work deck: expanding one card, and the deck it came out of.
 *
 * ── The model ────────────────────────────────────────────────────────────
 *
 * The Dashboard is a deck of work. Clicking a card EXPANDS it into the primary
 * work surface; the remaining cards settle into a rail on the left, and the
 * reader can rotate through them without leaving. Back returns to the exact
 * deck they pulled the card out of.
 *
 * That is one continuous surface, not three pages.
 *
 * ── Origin is not workspace ──────────────────────────────────────────────
 *
 * Stage 3B carried a single `lens`, and it was doing two different jobs at
 * once: which focused workspace to render, AND where Back goes. Those are
 * different facts, and conflating them produced a real bug -- Today's "Review
 * thesis" opened a research-shaped workspace, so Back offered "All research"
 * to a reader who had never been in Research.
 *
 *   originLens      the deck the reader pulled this card from. Drives Back,
 *                   drives the rail, and never changes while rotating.
 *   workspaceLens   which focused workspace answers this issue. Changes with
 *                   every card, because different work needs different tools.
 *
 * TGT clicked from Today is `originLens: 'today'`, `workspaceLens: 'research'`.
 * Rotating to AMZN changes the second and leaves the first alone.
 *
 * ── The rail travels with the request ────────────────────────────────────
 *
 * Peers are built by the lens that already holds the ranked population, from
 * data it has already loaded, and handed over on the click. The deck runs no
 * query of its own to draw the rail -- four scans to render one workspace is
 * exactly the cost this avoids.
 */

export type DashboardLensId = 'today' | 'ideas' | 'research' | 'portfolio' | 'decisions'

export type FocusObjectType = 'asset' | 'idea' | 'position' | 'decision'

export interface DashboardFocusTarget {
  /** The deck this came out of. Drives Back. Never changes while rotating. */
  originLens: DashboardLensId
  /** Which focused workspace answers this issue. Changes as cards rotate. */
  workspaceLens: DashboardLensId
  objectType: FocusObjectType
  objectId: string
  symbol?: string | null
  label?: string | null
  /** Book context, where the issue is exposure-shaped. */
  portfolioId?: string | null
  portfolioName?: string | null
  /** Why it surfaced. The workspace states this rather than re-deriving it. */
  issue?: string | null
  /** Which surface raised it, for provenance copy. */
  origin?: string | null
  /**
   * The tile this came out of.
   *
   * ── Why this exists, and what it is not ─────────────────────────────────
   *
   * Opening a Dashboard object unmounts a tile and mounts a workspace, and
   * nothing connects the two on screen. Closing that gap eventually means a
   * shared-element transition, which has to know WHICH element to animate
   * from — and the only way to find it today would be to match on ticker or
   * heading text. That is not identity, and it breaks the moment two tiles
   * concern the same name.
   *
   * So identity is carried explicitly. `elementId` is the value of the tile's
   * `data-focus-source` attribute, so a later stage can address the exact node
   * the reader clicked instead of inferring it. `role` and `rect` record how
   * that node was presented at the moment of the click, because a lead tile
   * and a compact one should not expand the same way.
   *
   * This stage carries the seam and tests it. It deliberately animates
   * nothing: a transition built on identity that did not yet exist would be
   * the animation-over-broken-navigation the brief rules out.
   */
  source?: FocusSource | null
}

/** How the object was presented on the surface that raised it. */
export interface FocusSource {
  /** The clicked node's `data-focus-source`. A DOM handle, not a guess. */
  elementId: string
  /** The presentation role it held — not its object type. */
  role: 'lead' | 'standard' | 'compact'
  /** Viewport geometry at click time, for a later shared-element transition. */
  rect?: { top: number; left: number; width: number; height: number } | null
  /** Which part of the object the reader actually engaged with. */
  intent?: FocusIntent
}

/**
 * What inside the object the reader reached for.
 *
 * ── Why this is not a second identity ────────────────────────────────────
 *
 * The object is still `objectId`, and it still decides which object the
 * workspace opens. This only says which PART of it the reader touched, so the
 * destination can lead with that part instead of always opening at the top.
 * Two findings about one ticker stay distinct because the intent never
 * participates in identity — it refines a destination that has already been
 * resolved.
 *
 * ── Why these five ───────────────────────────────────────────────────────
 *
 * One per element a reader can currently engage with on a card, and no more.
 * `overview` is what a click on the card's own ground means: the reader chose
 * the object without choosing a part of it. The other four exist because the
 * card actually draws them today — a claim, a framework of cases, a price
 * path, and the book the position sits in. Nothing here is aspirational:
 * an intent is added when the element that raises it ships, not before, so
 * this list cannot drift into naming parts of a card that do not exist.
 */
export type FocusIntent = 'overview' | 'claim' | 'framework' | 'price' | 'book'

/**
 * One card in the left rail.
 *
 * A card, not a list row: it carries an object, the reason it deserves
 * attention, one figure that matters and a semantic state. Everything needed
 * to make a reader want to click it, and everything needed to expand it when
 * they do -- so rotation costs no lookup.
 */
export interface RailCard {
  id: string
  workspaceLens: DashboardLensId
  objectType: FocusObjectType
  symbol: string | null
  /** The state, in the lens's own words. Never a restated name. */
  reason: string
  tone?: 'critical' | 'review' | 'info' | 'neutral'
  /** The one number that makes this matter. */
  figure?: string | null
  /** What the figure counts. */
  figureLabel?: string | null
  /** A second fact, where one genuinely adds to the first. */
  secondary?: { value: string; label: string } | null
  /** One line of substance: a claim, an evidence title, a rationale. */
  detail?: string | null
  /**
   * The object's own price path, for lenses that have one.
   *
   * ── Why the rail earns a picture ─────────────────────────────────────────
   *
   * The rail is where a reader chooses what to look at next, and it was doing
   * that job with a ticker, a percentage and two lines of clamped prose. Ten
   * of those are ten paragraphs: nothing separates them at a glance, so the
   * only way to compare the neighbours of the thing you are reading is to
   * read all of them.
   *
   * A price path separates them instantly, and it is the same fact the field
   * behind the deck is already drawing -- so moving from the gallery into a
   * focused object does not mean losing the picture you were scanning by.
   *
   * Optional, and null wherever it would be a fiction. A decision record and
   * a research document have no price of their own, and drawing one for them
   * would be an invented fact dressed as a shared component.
   */
  spark?: { closes: number[]; changePct: number } | null
  portfolioId?: string | null
  portfolioName?: string | null
  issue?: string | null
}

export interface DashboardFocusRequest {
  target: DashboardFocusTarget
  /**
   * What Back says. Named for the destination -- "Today", "Large Cap Core" --
   * because a reader returning wants to know where to, not merely that they
   * can.
   */
  backLabel: string
  /**
   * The WHOLE peer population, in the deck's own order.
   *
   * Not a pre-pruned window. The deck computes the neighbourhood around
   * whichever card is currently expanded, which is what makes the card you
   * just left re-enter the rail when you rotate away from it -- open JNJ,
   * rotate to AAPL, and JNJ is available again. A window pruned once at open
   * time would have removed it permanently.
   */
  rail: RailCard[]
}

export const DASHBOARD_FOCUS_EVENT = 'tesseract:dashboard-focus' as const

/**
 * Expand a card, in place.
 *
 * One dispatch, and deliberately no tab descriptor: producing one is exactly
 * the mistake this seam replaces. Only an explicit deep handoff may open a
 * top-level work tab.
 */
export function openDashboardFocus(request: DashboardFocusRequest): boolean {
  if (typeof window === 'undefined') return false
  const t = request?.target
  if (!t?.objectId || !t?.originLens || !t?.workspaceLens) return false
  window.dispatchEvent(
    new CustomEvent<DashboardFocusRequest>(DASHBOARD_FOCUS_EVENT, { detail: request }),
  )
  return true
}

export function subscribeToDashboardFocus(
  handler: (r: DashboardFocusRequest) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}
  const listener = (e: Event) => {
    const detail = (e as CustomEvent<DashboardFocusRequest>).detail
    if (!detail?.target?.objectId || !detail.target.originLens) return
    handler(detail)
  }
  window.addEventListener(DASHBOARD_FOCUS_EVENT, listener)
  return () => window.removeEventListener(DASHBOARD_FOCUS_EVENT, listener)
}

/**
 * The surrounding work, in the deck's own order.
 *
 * ── No carousel ──────────────────────────────────────────────────────────
 *
 * Stage 3B wrapped from the end of the list back to the head and called it
 * "up next", which told a reader that rank #15 is followed by rank #1. It is
 * not. The rail shows what comes AFTER, and only backfills with what came
 * immediately before when there is not enough after -- still in order, so the
 * rail always describes a neighbourhood rather than a loop.
 *
 * ── Why there is no default length any more ──────────────────────────────
 *
 * `limit` used to default to 5, and every caller took the default. Measured
 * with a card open on Ideas at 1920x889: five cards came to 470px inside a
 * 733px rail that already scrolls, leaving 209px of empty column -- while 50
 * of the field's 55 peers sat in `cards` unused. The cap was not protecting
 * anything; it was chosen once and never revisited.
 *
 * Unbounded now, so the column fills and the remainder is one scroll away.
 *
 * What that changes for a reader, stated plainly because it is not nothing:
 * a bounded rail spent its few rows on what comes AFTER the active card, so
 * it opened on the followers. Unbounded, the window is the whole deck minus
 * the active card, which means the head of the field is above it and the
 * followers sit further down the column.
 *
 * That is the faithful extension of the rule rather than a new one -- the
 * window is a contiguous slice read in rank order, at every length. The
 * alternative, followers first with the head underneath, is precisely the
 * wrap described above: it would put rank #1 directly below rank #15.
 *
 * If the rail should OPEN scrolled to the active card's position, that is a
 * scroll concern in the deck and not a different window.
 *
 * `limit` survives for a caller that genuinely has a reason to bound its
 * rail, but it has no default -- a number this one needs is a number it
 * should have to state.
 */
export function railAround(
  cards: readonly RailCard[],
  activeId: string | null,
  limit?: number,
): RailCard[] {
  // `Infinity` rather than `cards.length`: it reads as "no bound" at every
  // use below, including the two slices, without arithmetic on a length.
  const cap = limit ?? Infinity
  const at = cards.findIndex(c => c.id === activeId)
  if (at < 0) return cards.filter(c => c.id !== activeId).slice(0, cap)

  const after = cards.slice(at + 1)
  if (after.length >= cap) return after.slice(0, cap)

  // Preceding work, kept in its own order and placed before what follows, so
  // the column still reads top-to-bottom the way the deck does. Unbounded,
  // `cap - after.length` is Infinity and `Math.max(0, -Infinity)` is 0 --
  // which is the whole head of the list, exactly as intended.
  const before = cards.slice(Math.max(0, at - (cap - after.length)), at)
  return [...before, ...after].slice(0, cap)
}

/**
 * Which Today issues the Dashboard can resolve without leaving.
 *
 * Everything else on a Today card -- raising an idea, opening a simulation,
 * filtering the trade queue -- is operational work the deep product owns, and
 * still goes through the shared dispatcher untouched. That dispatcher also
 * serves the Asset page, the old Dashboard and the Action Center, so it is
 * read here and never modified.
 *
 * The value is the WORKSPACE that answers the issue. The origin stays Today.
 */
export const TODAY_FOCUS_ACTIONS: Record<string, DashboardLensId> = {
  OPEN_ASSET_UPDATE_THESIS: 'research',
  OPEN_ASSET_REVIEW_SEQUENCE: 'research',
}
