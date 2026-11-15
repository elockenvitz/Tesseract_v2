/**
 * What the reader had OPEN and how far they had SCROLLED in the work pane.
 *
 * ── The complaint, and the part of it `place.ts` does not cover ───────────
 *
 * "I opened an asset from the Dashboard, went to the canonical Asset Page to
 * edit the case, then returned to the Dashboard. The left-hand Asset
 * Workspace pane appeared to reload and rebuild its content."
 *
 * `DashboardPage.renderTabContent()` renders the ACTIVE tab only, so every
 * tab in this application is unmounted the moment it stops being the one on
 * screen. `place.ts` already gives the Dashboard shell back its lens, its
 * selected name and its open work pane, so the reader does not have to
 * reopen the event. What it does not give back is the state INSIDE the pane:
 * which disclosure the reader had opened to read, and where in a long
 * surface they were.
 *
 * Those are the two things a reader notices as "it rebuilt itself", because
 * they are the two things they had done by hand.
 *
 * ── Why memory, and not storage ───────────────────────────────────────────
 *
 * Same reasoning as `place.ts`, and it holds even harder here. A scroll
 * offset is only meaningful against the content that produced it; the same
 * asset a day later has a different case, different evidence and a different
 * height, so an offset written to storage and revived tomorrow puts the
 * reader somewhere arbitrary and calls it where they were. A module-scoped
 * value lasts exactly as long as the complaint describes: switch away, come
 * back. A reload starts at the top, which is correct.
 *
 * ── Why it is not keyed by the reader ─────────────────────────────────────
 *
 * `place.ts` is, because it holds a built card and a feed row -- one
 * reader's material, which must not appear on another's screen. This holds a
 * pixel offset and a set of disclosure ids. There is nothing in it to
 * attribute, and nothing a second reader could learn from it. Stated here so
 * the difference is a decision rather than an oversight.
 *
 * ── Why it is bounded ─────────────────────────────────────────────────────
 *
 * A reader working through a feed opens dozens of names in a session, and a
 * map that only ever grows is a leak however small each entry is. The oldest
 * entries are dropped past `LIMIT`, which costs nothing a reader would
 * notice: the point of this is the trip they JUST made.
 *
 * ── Where the scroll half lives now ───────────────────────────────────────
 *
 * In `lib/ui/scroll-memory`, because the canonical Asset Page needs exactly
 * the same thing for a different reason -- `Layout` owns one scroller that
 * every non-full-width tab renders into, so its offset is clamped by the
 * next tab's height rather than destroyed with the element. Two surfaces
 * losing an offset two ways is still one question about what to do with it,
 * and the subtle part is the restore rather than the map: see that module
 * for why it assigns once and retries once instead of looping.
 *
 * The functions below keep their names and their behaviour. What they do not
 * keep is a second implementation of it.
 */
import { createScrollMemory, TOP, type ScrollPosition } from '../../lib/ui/scroll-memory'

/** What is remembered for one open object. */
export type PaneView = ScrollPosition

/** The default for an object the reader has not been in. The top of it. */
export const NO_PANE_VIEW: PaneView = TOP

/**
 * How many open objects are remembered at once.
 *
 * Eight: enough to cover going back and forth between a handful of names,
 * far short of a session's worth. Insertion order decides what goes, so the
 * entry the reader touched least recently is the one dropped.
 */
export const LIMIT = 8

/** This pane's own budget. Tab offsets have theirs; neither evicts the other. */
export const paneScroll = createScrollMemory(LIMIT)

/**
 * Disclosures the reader has opened, by a stable id of their own choosing.
 *
 * Separate from `views` and keyed differently on purpose. "Show the
 * supporting sections" is a decision about a NAME, not about the card that
 * happened to open it, so it survives arriving at the same asset from a
 * different finding. A scroll offset is about the rendered surface and does
 * not.
 */
const disclosed = new Set<string>()

/** Hand back what was remembered for this object, or the top of it. */
export function readPaneView(key: string | null | undefined): PaneView {
  return paneScroll.read(key)
}

/** Remember the scroller's offset for this object. */
export function rememberPaneScroll(key: string | null | undefined, scrollTop: number): void {
  paneScroll.remember(key, scrollTop)
}

/** Whether the reader had this disclosure open. */
export function isDisclosed(id: string | null | undefined): boolean {
  return !!id && disclosed.has(id)
}

/** Remember that the reader opened, or closed, this disclosure. */
export function rememberDisclosure(id: string | null | undefined, open: boolean): void {
  if (!id) return
  if (open) disclosed.add(id)
  else disclosed.delete(id)
}

/** For tests, and for a deliberate reset. */
export function forgetPaneViews(): void {
  paneScroll.forget()
  disclosed.clear()
}
