/**
 * Finds the elements actually causing horizontal overflow.
 *
 * Static analysis has repeatedly pointed at the wrong culprit — a wide class
 * name is not the same as a wide rendered box, and the real offenders have
 * been things with no suspicious class at all (an <input>'s intrinsic
 * min-content width, for instance). This measures the rendered layout instead.
 *
 * Only elements whose own box exceeds the viewport are reported, and a parent
 * is suppressed when a child is equally guilty, so the output points at the
 * leaf that needs fixing rather than every ancestor containing it.
 */

export interface OverflowOffender {
  /** Readable path, e.g. `div.flex > header#app > input.block` */
  path: string
  tag: string
  className: string
  /** Rendered width in px. */
  width: number
  /** How far past the viewport's right edge, in px. */
  overhangRight: number
  /** How far past the left edge (negative left positions). */
  overhangLeft: number
  element: Element
}

function describe(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const id = el.id ? `#${el.id}` : ''
  const cls =
    typeof el.className === 'string' && el.className.trim()
      ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.')
      : ''
  return `${tag}${id}${cls}`
}

function pathTo(el: Element, depth = 3): string {
  const parts: string[] = []
  let node: Element | null = el
  while (node && parts.length < depth) {
    parts.unshift(describe(node))
    node = node.parentElement
  }
  return parts.join(' > ')
}

export function auditOverflow(tolerance = 1): OverflowOffender[] {
  if (typeof document === 'undefined') return []

  const viewportWidth = document.documentElement.clientWidth
  const found: OverflowOffender[] = []

  for (const el of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
    // Skip things that are not laid out, and our own audit UI.
    if (el.closest('[data-overflow-audit]')) continue
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue

    const style = window.getComputedStyle(el)
    if (style.display === 'none' || style.visibility === 'hidden') continue
    // Fixed/sticky overlays legitimately sit outside flow while animating off
    // screen (drawers, sheets). A translated-off element is not an overflow bug.
    if (style.transform !== 'none' && rect.left >= viewportWidth) continue

    const overhangRight = Math.round(rect.right - viewportWidth)
    const overhangLeft = Math.round(-rect.left)

    if (overhangRight > tolerance || overhangLeft > tolerance) {
      found.push({
        path: pathTo(el),
        tag: el.tagName.toLowerCase(),
        className: typeof el.className === 'string' ? el.className : '',
        width: Math.round(rect.width),
        overhangRight: Math.max(0, overhangRight),
        overhangLeft: Math.max(0, overhangLeft),
        element: el,
      })
    }
  }

  // Drop ancestors whose overhang is fully explained by a reported descendant —
  // fixing the leaf usually fixes the chain.
  const leaves = found.filter(
    candidate =>
      !found.some(
        other =>
          other.element !== candidate.element &&
          candidate.element.contains(other.element) &&
          other.overhangRight >= candidate.overhangRight - 1
      )
  )

  return leaves.sort((a, b) => b.overhangRight - a.overhangRight)
}

/** True when the document itself can be scrolled sideways. */
export function hasHorizontalScroll(): boolean {
  if (typeof document === 'undefined') return false
  const doc = document.documentElement
  return doc.scrollWidth > doc.clientWidth + 1
}
