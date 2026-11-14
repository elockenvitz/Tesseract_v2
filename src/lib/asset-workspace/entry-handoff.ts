/**
 * Carrying the entry context across the hop into the canonical Asset page.
 *
 * ── Why this is not tab data ──────────────────────────────────────────────
 *
 * `openAsset` writes its request into a TAB DESCRIPTOR, and a tab descriptor
 * is durable: the shell merges it into the open tab and keeps it there across
 * sessions. That is exactly right for `focus` and the handful of ids, and
 * exactly wrong for an event. A target breach is a reading of a moment -- a
 * mark, a stated target, an overshoot, a timestamp -- and a reading persisted
 * into a tab would be restated as current every time the reader came back to
 * that tab, for as long as the tab existed. The workspace pane carries the
 * context in props for the same reason: it lives as long as the arrival does.
 *
 * So the context travels in memory, for the length of one navigation, and
 * nothing writes it down.
 *
 * ── One offer, one take ───────────────────────────────────────────────────
 *
 * A single slot, not a map. The sender offers immediately before calling
 * `openAsset`, the receiver takes it on arrival, and the slot is emptied by
 * the take whether or not the context applied. Two senders cannot interleave:
 * a navigation is one gesture by one reader.
 *
 * The take is guarded three ways, because the cost of getting this wrong is a
 * page stating another name's or another organisation's event as fact:
 *
 *   identity   `contextAppliesTo` -- same asset, same organisation. Not a
 *              heuristic, and a null organisation matches nothing.
 *   freshness  an offer older than `HANDOFF_TTL_MS` is discarded. An offer
 *              is taken milliseconds later in the normal case; a stale one
 *              means the arrival never happened, and a later unrelated mount
 *              of the same name must not inherit it.
 *   once       the slot is cleared on the first take, so a remount -- which
 *              is what returning to a tab is -- gets nothing. The band is an
 *              orientation for an ARRIVAL, not a property of the page.
 *   not twice  the sender says whether it has ALREADY shown the reader this
 *              orientation. Every offer today comes from the embedded
 *              workspace, which has, so the canonical page stops restating
 *              it. See `Offer`.
 *
 * The receiving page pairs this with `asset.focusRequestId`, the id
 * `openAsset` stamps per call, so a fresh request lands even when the tab was
 * already open and no mount occurs. See `arrival-focus.ts` for why that id
 * exists and what replaying an arrival costs.
 *
 * ── Not authority ─────────────────────────────────────────────────────────
 *
 * Nothing read from here decides what a reader may see. The receiving page
 * runs its own org-scoped, RLS-backed queries and the context only decides
 * what the page LEADS with. The `organizationId` travels so it can be
 * discarded, never so it can be asserted.
 */
import { contextAppliesTo, type WorkspaceEntryContext } from './entry-context'

/**
 * How long an unclaimed offer stays live.
 *
 * Ten seconds: the normal gap between the offer and the take is one tab open,
 * well under a second, and the only thing a longer window buys is the chance
 * of a stale orientation on a page the reader reached some other way.
 */
export const HANDOFF_TTL_MS = 10_000

/**
 * Whether the reader has ALREADY been shown this orientation.
 *
 * ── The fourth property, and the defect it closes ────────────────────────
 *
 * Every offer in this product is made by the embedded Asset Workspace, and
 * that workspace has already drawn the band for this arrival before the
 * reader presses anything. So "Review the case" handed the canonical Asset
 * page a context it then stated a SECOND time, as a second large band, in
 * the research content the reader had navigated to in order to read.
 *
 * The reported symptom was four competing attention indicators on one
 * screen. One of the four was this band, restating what the pane beside it
 * had just said.
 *
 * `oriented` is the sender declaring "I have already explained this". The
 * receiving surface decides what to do with that; the handoff only carries
 * it. An un-oriented offer -- a future Dashboard control that opens the
 * canonical page directly, with no pane in between -- still earns its band,
 * which is why this is a flag rather than a deletion.
 */
interface Offer {
  context: WorkspaceEntryContext
  offeredAt: number
  oriented: boolean
}

/** An offer that applied, with the sender's declaration alongside it. */
export interface TakenArrival {
  context: WorkspaceEntryContext
  /** True when the sender had already shown the reader this orientation. */
  oriented: boolean
}

/* Module scope, deliberately: this is a handoff between two surfaces that are
   never mounted at the same moment, so there is no component that could own
   it. It is also why it is cleared aggressively. */
let pending: Offer | null = null

/**
 * Offer the context for the navigation about to happen.
 *
 * Call it immediately before `openAsset`. A null context clears the slot
 * rather than leaving an older offer behind for the next arrival.
 */
export function offerEntryContext(
  context: WorkspaceEntryContext | null | undefined,
  now = Date.now(),
  /* Defaults to false so that a sender which says nothing is treated as one
     that has explained nothing. The failure mode of the wrong default is a
     band that never draws, which is invisible; this way it is a band that
     draws, which a reader reports. */
  opts: { oriented?: boolean } = {},
): void {
  pending = context
    ? { context, offeredAt: now, oriented: opts.oriented === true }
    : null
}

/**
 * Take the offer, if it describes this page and this moment.
 *
 * Empties the slot either way: an offer that did not apply is an offer that
 * will never apply, and leaving it would hand it to the next arrival.
 *
 * Returns the sender's `oriented` declaration alongside the context rather
 * than the context alone, because the receiver cannot otherwise tell a first
 * explanation from a second one. See `Offer`.
 */
export function takeEntryArrival(
  to: { assetId: string | null; organizationId: string | null },
  now = Date.now(),
): TakenArrival | null {
  const offer = pending
  pending = null
  if (!offer) return null
  if (now - offer.offeredAt > HANDOFF_TTL_MS) return null
  if (!contextAppliesTo(offer.context, to)) return null
  return { context: offer.context, oriented: offer.oriented }
}

/** Drop any outstanding offer. For a sender that decides not to navigate. */
export function clearEntryContext(): void {
  pending = null
}

/** Whether an offer is outstanding. For tests and for nothing else. */
export function hasPendingEntryContext(): boolean {
  return pending !== null
}
