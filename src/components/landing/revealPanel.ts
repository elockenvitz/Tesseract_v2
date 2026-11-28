/**
 * Put the top of a freshly selected panel just under whatever is pinned
 * over it.
 *
 * ── The problem this solves ──────────────────────────────────────────────
 *
 * Both tabbed sections on this page stack on a phone: selector, then the
 * role's or stage's argument, then a tall drawn screen. A visitor who is
 * two thirds of the way down the Analyst demonstration and taps "Portfolio
 * managers" keeps their scroll position, so they land two thirds of the way
 * down the PM demonstration, having never seen its headline. The sticky
 * selector made switching possible; it did not make the switch legible.
 *
 * ── Why the offset is measured rather than hard-coded ────────────────────
 *
 * Two things are pinned above the panel: the global header and the
 * section's own sticky selector. The selector's height is not a constant —
 * it wraps to two rows at 390 and one at 768, and the lifecycle rail is
 * six items where the role rail is three. A literal would be wrong on most
 * phones, so the caller passes the live `offsetHeight`.
 *
 * ── Reduced motion ───────────────────────────────────────────────────────
 *
 * A smooth scroll over a few hundred pixels is exactly the vestibular
 * trigger the preference exists for, so the jump is instant when it is set.
 * `matchMedia` is feature-detected because this page's jsdom suite has no
 * implementation and an unguarded call throws inside a passive effect,
 * which has already unmounted a header once in this file's history.
 */
export function revealPanel(panel: HTMLElement | null, pinnedPx: number) {
  if (!panel || typeof window === 'undefined') return

  const reduce =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* A few pixels of air, so the headline does not sit flush against the
     underside of the selector and read as clipped. */
  const top = panel.getBoundingClientRect().top + window.scrollY - pinnedPx - 12

  if (typeof window.scrollTo !== 'function') return
  window.scrollTo({ top: Math.max(0, top), behavior: reduce ? 'auto' : 'smooth' })
}

/**
 * True below Tailwind's `xl`, which is the width at which both tabbed
 * sections stop being two columns and start stacking. Above it the panel
 * and its selector already share one viewport and repositioning would be
 * the disorienting thing, so the callers only reveal below it.
 */
export function isStackedLayout() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(max-width: 1279px)').matches
}

/** The sticky global header, which both sections sit beneath. */
export const HEADER_PX = 72

/**
 * A selector's height, but only when it is actually pinned.
 *
 * The lifecycle rail is `lg:sticky`: six tabs wrap to three rows on a
 * phone, and pinning 270px of them to the top of an 844px screen costs
 * more than the scroll it saves, so below `lg` it scrolls away and the
 * stage controls under the demonstration do the navigating instead.
 * Measuring `offsetHeight` unconditionally would then push the reveal
 * 270px too far and leave the headline off the top of the screen.
 */
export function pinnedHeight(el: HTMLElement | null) {
  if (!el || typeof window === 'undefined' || typeof getComputedStyle !== 'function') return 0
  return getComputedStyle(el).position === 'sticky' ? el.offsetHeight : 0
}
