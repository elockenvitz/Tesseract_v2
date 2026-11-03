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
  /* And stop turning. See `animateBootLoader` -- the loop costs 224 attribute
     writes a frame, and once this class is on, every one of them lands on an
     element at `opacity: 0`. */
  pauseBootLoaderAnimation()
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
  /* Back in phase without being told where the phase is: `EPOCH` is
     module-level and `phaseAt` reads the wall clock, so a loop restarted now
     draws the frame the loop would have been on had it never stopped. That
     property is what made it safe to stop at all. */
  animateBootLoader()
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
 *
 * ── And it stops when nobody can see it ───────────────────────────────────
 *
 * "The app runs it for the session" was the original rule, and it was one
 * rule too many. The element is kept in the DOM for the session, which is
 * what makes a re-show cheap; the LOOP does not have to run for the session
 * to get that, and running it costs the same whether the figure is on screen
 * or at `opacity: 0` behind the whole application.
 *
 * MEASURED in the running app, on the Dashboard, long after boot: 4,704 DOM
 * mutations in 700ms of complete idleness -- about 6,700 attribute writes a
 * second -- every one of them on this element while it was faded out. The
 * loop writes 32 lines x 5 attributes and 16 nodes x 4 every frame, and the
 * browser recomputes style and repaints that subtree for each one. On a
 * frame that is already doing real work, such as revealing a lens with 145
 * tiles in it, that is what turns a long frame into a visible hitch.
 *
 * So the loop is paused when the loader fades and restarted when it is
 * shown. Nothing about the figure changes: `EPOCH` is module-level and
 * `phaseAt` reads the wall clock, so a restarted loop draws the frame it
 * would have been on had it never stopped. Every reason the loop was made
 * continuous -- one clock, no handover, no remount, in phase with any React
 * mark beside it -- is a property of that epoch and survives a pause.
 */
let stopLoop: (() => void) | null = null

/** Stop turning, keeping the element and its last drawn frame in place. */
function pauseBootLoaderAnimation(): void {
  stopLoop?.()
  stopLoop = null
}

export function animateBootLoader(periodMs = 4500): void {
  if (stopLoop) return
  const node = el()
  /* Nothing to watch it. The loop restarts from `showBootLoader`, which is
     the only way this element comes back. */
  if (!node || node.classList.contains('is-fading')) return
  const svg = node.querySelector('svg')
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

/** Stop the loop. For teardown in tests; the app pauses it on `hide`. */
export function stopBootLoaderAnimation(): void {
  pauseBootLoaderAnimation()
}
