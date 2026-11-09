/**
 * Scroll one section of the Asset page into view.
 *
 * ── Why not scrollIntoView ──────────────────────────────────────────────
 *
 * `scrollIntoView` adjusts EVERY scrollable ancestor. The Asset page is a
 * nested scroll container under a sticky header, so the browser moved both and
 * the target landed ~600px above the viewport — measured, not guessed. This
 * finds the one container that actually scrolls and moves it by the measured
 * delta, which lands the section `offset` pixels below the container's top.
 *
 * Falls back to `scrollIntoView` only when no scrollable ancestor exists,
 * which is the case the old behaviour was correct for.
 */

/** The nearest ancestor that can actually scroll, or null. */
function scrollableAncestor(el: HTMLElement): HTMLElement | null {
  let sc: HTMLElement | null = el.parentElement
  while (sc) {
    const style = getComputedStyle(sc)
    if (/(auto|scroll)/.test(style.overflowY) && sc.scrollHeight > sc.clientHeight) return sc
    sc = sc.parentElement
  }
  return null
}

/**
 * Scroll `id` into view inside its own scroll container.
 *
 * Returns false when the element is not in the DOM, so a caller inside an
 * animation frame can tell "not rendered yet" from "done".
 */
export function scrollToSection(id: string, offset = 8): boolean {
  const el = document.getElementById(id)
  if (!el) return false
  const sc = scrollableAncestor(el)
  if (!sc) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    return true
  }
  const delta = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - offset
  sc.scrollBy({ top: delta, behavior: 'smooth' })
  return true
}
