import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'
import type { IdeasSelection } from '../../lib/desktop-ideas/selection'
import type { Progression } from '../../lib/desktop-ideas/progression'

/**
 * Where the reader was on the Dashboard, kept across a tab switch.
 *
 * ── The complaint, and what actually causes it ────────────────────────────
 *
 * Leaving the Dashboard tab and coming back put the reader on the Ideas lens
 * with an empty work pane, whatever they had been doing. That is not a bug in
 * this shell: `DashboardPage.renderTabContent()` renders the ACTIVE tab only,
 * so every tab in this application is unmounted the moment it stops being the
 * one on screen, and `useState` in any of them is gone with it.
 *
 * Fixing that for every tab type is a change to the tab host and is not this.
 * This module gives one surface its place back.
 *
 * ── Why memory and not sessionStorage ─────────────────────────────────────
 *
 * The place includes `IdeasSelection` and `AttentionEntry`, which hold a live
 * feed row and a built card. Neither survives JSON, and a row written out
 * today and revived tomorrow is a stale row presented as current -- the feed
 * reranks, rows are resolved, a trade gets answered. A module-scoped value
 * lasts exactly as long as the complaint describes: switch away, come back.
 * A reload puts the reader back on the Ideas lens, which is correct.
 *
 * ── Why it is keyed by owner ──────────────────────────────────────────────
 *
 * Signing out of this application does not reload the page: `AuthProvider`
 * swaps `user` to null in place. Without a key, the next reader to sign in on
 * the same browser session would open the Dashboard already pointed at the
 * previous reader's name, with that reader's finding in the work pane. That is
 * one reader's material on another reader's screen, so the read is gated on
 * the owner matching rather than on a sign-out listener that has to be
 * remembered somewhere else.
 *
 * Nothing here reaches the database. Every value was already fetched and
 * rendered for the owner that held it; the key decides whether it is handed
 * back, and a mismatch forgets it rather than keeping it around.
 */

export type NextLens = 'feed' | 'explore' | 'portfolio'

export type DashboardNextPlace = {
  lens: NextLens
  selected: { selection: IdeasSelection; entry: AttentionEntry | null } | null
  workMode: Progression['mode'] | null
  splitOpen: boolean
}

/*
 * ── `portfolioSeen` is deliberately NOT part of the place ─────────────────
 *
 * It was, for a pass, on the reasoning that Portfolio is mounted on first use
 * and kept mounted after, so restoring `lens: 'portfolio'` needed the latch
 * restored with it. That reasoning is wrong twice over.
 *
 * It is unnecessary: the latch is set DURING the render in which the lens is
 * portfolio, so a restored `lens: 'portfolio'` mounts the book on the first
 * pass by itself.
 *
 * And it is harmful in the one case where it would do anything. A reader who
 * opened the book earlier and left from the feed would come back with the
 * book mounted and hidden, paying for its several queries without looking at
 * it -- which is the exact cost the latch exists to avoid.
 */

/**
 * The Ideas lens, nothing selected. What a reader gets on a first open, on a
 * reload, and after another reader has been signed in.
 */
export const NO_PLACE: DashboardNextPlace = {
  lens: 'feed', selected: null, workMode: null, splitOpen: false,
}

/**
 * The article reader is deliberately NOT part of the place.
 *
 * It is a full-screen overlay over the whole shell. Restoring it would mean a
 * reader who switched tabs comes back to a modal they have to dismiss before
 * they can see the Dashboard at all, which is worse than losing the article --
 * and the article is a link they can press again, in a list that is still
 * where they left it.
 */
let held: DashboardNextPlace = NO_PLACE
let heldFor: string | null = null

/** Hand the place back, but only to the reader who left it. */
export function readPlace(owner: string | null): DashboardNextPlace {
  if (owner === null || owner !== heldFor) {
    // Forget rather than merely withhold: a value nobody can be handed is a
    // value waiting for a coincidence to make it reachable.
    held = NO_PLACE
    heldFor = null
    return NO_PLACE
  }
  return held
}

/** Remember the place, against the reader standing in it. */
export function writePlace(owner: string | null, place: DashboardNextPlace): void {
  if (owner === null) {
    // No signed-in reader, nothing to attribute it to.
    held = NO_PLACE
    heldFor = null
    return
  }
  held = place
  heldFor = owner
}

/** For tests, and for a deliberate reset. */
export function forgetPlace(): void {
  held = NO_PLACE
  heldFor = null
}
