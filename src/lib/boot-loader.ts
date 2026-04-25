/**
 * boot-loader — DOM helpers for the static `#tesseract-boot-loader`
 * element painted by `index.html`. The element lives as a sibling of
 * `#root` so React's mount cycle doesn't tear it down, and we keep
 * it in the DOM permanently — gate transitions just toggle
 * visibility. That way the spinner's CSS rotation animation is
 * mounted exactly once for the whole session: every show/hide is a
 * 220ms opacity fade, never a remount that resets the rotation.
 *
 * Keeping it permanently mounted also lets in-session gates (org
 * switch without reload, pilot-flag refetches) re-show the same
 * loader without the cold-boot spinner having to be re-painted by
 * a full document reload.
 */

const LOADER_ID = 'tesseract-boot-loader'
const LABEL_ID = 'tesseract-boot-loader-label'

function el(): HTMLElement | null {
  return document.getElementById(LOADER_ID)
}

/** Update the label below the spinner. Used to surface what gate is
 *  currently blocking ("Loading…", "Switching workspace…") without
 *  swapping out the spinner itself. */
export function setBootLoaderLabel(text: string): void {
  const label = document.getElementById(LABEL_ID)
  if (label && label.textContent !== text) label.textContent = text
}

/** Fade the boot loader out. Idempotent. The element stays in the
 *  DOM (with `pointer-events: none` from the CSS) so a future gate
 *  can re-show it without any remount / animation reset. */
export function hideBootLoader(): void {
  const node = el()
  if (!node) return
  node.classList.add('is-fading')
}

/** Re-show the boot loader. Used by in-session gates (org switch
 *  without a full reload, post-mount pilot-flag refetch) so we can
 *  paint a continuous spinner across the gate without remounting any
 *  React tree. Optional `label` updates the caption in the same call. */
export function showBootLoader(label?: string): void {
  const node = el()
  if (!node) return
  node.classList.remove('is-fading')
  if (label) setBootLoaderLabel(label)
}

/** True when the boot loader is currently painted (not faded).
 *  Components can read this to avoid stacking duplicate spinners. */
export function isBootLoaderVisible(): boolean {
  const node = el()
  return !!node && !node.classList.contains('is-fading')
}
