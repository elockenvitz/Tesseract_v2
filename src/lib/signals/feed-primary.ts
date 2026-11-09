import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'

/**
 * The verb this candidate wears ON THE DESKTOP FEED.
 *
 * ── The defect this exists to prevent, caught in the act ──────────────────
 *
 * Every action in the desktop feed opens the work pane. That is right for
 * "Review cases" or "Capture", which NAME the work and take you to where it
 * happens. It is wrong for `Approve`: a reader who presses Approve and lands
 * on a pane either believes they approved something they did not, or presses
 * it again. The phone's card can carry that label because the phone approves
 * inline; a column that can only navigate cannot.
 *
 * The first attempt substituted the label inside `IdeasExplore` alone. Live,
 * that produced a card footer reading "Open the decision" directly beneath a
 * Start here row reading "Approve - LLY" -- one finding, two verbs, on one
 * screen. Which is precisely the failure the Start here band was built to be
 * incapable of, reintroduced from the other side: the band is a faithful
 * projection of `actions.primary.label`, so the moment a renderer overrode
 * that label privately, the two surfaces disagreed.
 *
 * So the substitution lives here, where every surface drawing a feed entry
 * reads it, and no renderer holds a private opinion about what a card says.
 *
 * ── What this is not ──────────────────────────────────────────────────────
 *
 * Not a second action vocabulary. The ID is always the card's own, so routing,
 * analytics and the builder's ownership of what the action IS are untouched --
 * only the word changes, and only where the surface cannot honour the original
 * one. `SignalCardView.primaryOverride` documents the same split for the same
 * reason.
 */

/**
 * Families whose primary verb COMMITS something.
 *
 * A reader pressing one of these on a surface that can only navigate would be
 * told they had done a thing they have not done. Keyed on the family rather
 * than on the label, because matching the word "Approve" would be a renderer
 * guessing at meaning from copy -- and a copy change would silently switch the
 * behaviour back on.
 */
const NAVIGATES_INSTEAD: Partial<Record<AttentionEntry['family'], string>> = {
  /* The decision itself is one click further in, on the workspace's decisions
     surface, which leads with a "Waiting on you" band and a Decide button. */
  recommendation: 'Open the decision',
}

export function primaryForFeed(entry: AttentionEntry): { id: string; label: string } {
  const primary = entry.card.actions.primary
  const substitute = NAVIGATES_INSTEAD[entry.family]
  return { id: primary.id, label: substitute ?? primary.label }
}
