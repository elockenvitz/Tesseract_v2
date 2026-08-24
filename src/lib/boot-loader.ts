import { EDGES } from './brand/tesseract-geometry'
import { runLoop } from './brand/tesseract-draw'

/**
 * boot-loader — DOM helpers for the static `#tesseract-boot-loader`
 * element painted by `index.html`. The element lives as a sibling of
 * `#root` so React's mount cycle doesn't tear it down, and we keep
 * it in the DOM permanently — gate transitions just toggle
 * visibility. That way the mark's animation is started exactly once
 * for the whole session: every show/hide is a 220ms opacity fade,
 * never a remount that resets the loop.
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

/**
 * Start the mark turning, the moment the bundle can.
 *
 * ── Why the boot element animates itself ──────────────────────────────────
 *
 * This element sits at `z-index: 2147483647` and stays visible across the
 * whole cold boot — auth, organisation resolve, pilot gate. So for the entire
 * time anybody actually watches a loading screen, the figure on screen is this
 * one. React's animated `TesseractMark` was mounted underneath it the whole
 * time, covered.
 *
 * Handing over sooner would only trade one problem for another: the element
 * exists precisely because React's gates each used to remount their own
 * spinner, and the reader saw three loading screens for one wait.
 *
 * So it drives itself instead, through the same `runLoop` the React mark uses,
 * on the same module-level clock. There is no handover to make seamless,
 * because nothing is ever swapped — the figure that painted before the bundle
 * parsed is the figure that keeps turning until the app is ready, and any
 * React mark that appears alongside it is already in phase.
 *
 * Idempotent, and safe to call before the element exists.
 */
let stopLoop: (() => void) | null = null

export function animateBootLoader(periodMs = 4500): void {
  if (stopLoop) return
  const svg = el()?.querySelector('svg')
  if (!svg) return
  const lines = [...svg.querySelectorAll('line')] as SVGLineElement[]
  const dots = [...svg.querySelectorAll('circle')] as SVGCircleElement[]
  // The markup is generated from the same geometry module, so a mismatch here
  // means the two have drifted — draw nothing rather than a scrambled figure.
  if (lines.length !== EDGES.length) return
  // The CSS breathing was there to say "alive" while nothing could move it.
  // It has something better now, and two overlapping opacity animations would
  // fight over the same property.
  svg.style.animation = 'none'
  svg.style.opacity = '1'
  stopLoop = runLoop({ lines, dots }, periodMs)
}

/** Stop the loop. Only for teardown in tests; the app runs it for the session. */
export function stopBootLoaderAnimation(): void {
  stopLoop?.()
  stopLoop = null
}
