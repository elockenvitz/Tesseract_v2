import { useState } from 'react'

import { TesseractMark } from './TesseractMark'

/**
 * The app-launcher mark: still by default, turning slowly under a pointer.
 *
 * ── What this replaces ────────────────────────────────────────────────────
 *
 * Eight vertices on eight separate CSS keyframe tracks, each tweening its own
 * cx/cy, plus dashed "dynamic" edges on a ninth. It could not produce a
 * coherent projection because nothing tied the vertices to a shape — they were
 * eight independent animations that happened to start on a cube, which is why
 * the edges drifted out of square as soon as it ran.
 *
 * It is now the same real 4D projection the loader draws, from the same module,
 * so the launcher and the loading state are recognisably one mark.
 *
 * ── Why hover, and why slow ───────────────────────────────────────────────
 *
 * At rest it is a logo and should behave like one: a static, precise isometric
 * hexagon that never competes with the content next to it. Chrome that moves on
 * its own is chrome you learn to tune out.
 *
 * Under a pointer it earns a little life, at 15 seconds a loop against the
 * loader's 4.5. Three times slower is the difference between "this is working"
 * and "this is alive" — a launcher that inverted at loading speed would read as
 * a progress indicator and imply something was happening when nothing was.
 *
 * Touch has no hover, so on a phone this is simply the static mark. That is the
 * correct outcome rather than a gap: the drawer it opens is one tap away, and
 * an animation nobody asked for is not worth a pointer-type branch.
 */

interface TesseractLogoProps {
  size?: number
  className?: string
}

export function TesseractLogo({ size = 32, className = '' }: TesseractLogoProps) {
  const [hovered, setHovered] = useState(false)

  return (
    <div
      className={`cursor-pointer transition-transform duration-200 hover:scale-105 ${className}`}
      style={{ width: size, height: size }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-testid="tesseract-logo"
      data-animating={hovered ? 'true' : 'false'}
    >
      <TesseractMark
        size={size}
        // Fifteen seconds. See the header: slow enough to read as life rather
        // than as progress.
        periodMs={15000}
        animate={hovered}
        // Heavier than the loader's proportionally, because the launcher is
        // drawn at 24-26px where a hairline disappears into the header.
        weight={3.4}
        // No nodes at this size — sixteen dots on a 24px mark close up the
        // gaps between the lines and it reads as a blob.
        showNodes={false}
      />
    </div>
  )
}
