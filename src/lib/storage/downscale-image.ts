/**
 * Shrink a logo before it is stored.
 *
 * ── The measured cause ───────────────────────────────────────────────────
 *
 * There is exactly one organization logo in the database and it is 1,513,770
 * bytes of PNG. The org switcher paints it into a 24x24 CSS box, and the
 * header renders one per row of the organization menu. So the switcher waits
 * on 1.44 MB to draw 576 pixels — about 2,600 bytes per pixel displayed.
 *
 * Signing was already fixed: `useSignedUrl` keys on `[bucket, path]` with a
 * 50-minute `staleTime`, so N logos pointing at one path share one signing
 * request and one stable URL, and the browser caches the bytes once. What
 * remained was the bytes themselves.
 *
 * ── Why this rather than Storage image transformation ────────────────────
 *
 * Supabase can resize on delivery via `/render/image/`, which would be the
 * neater fix and needs no re-upload. It is a paid feature, and this project
 * is on the free plan. Requesting a transform the plan does not serve yields
 * a URL whose fetch fails, which turns a slow logo into a missing one, so
 * this resizes at the source instead. If the Pro decision lands, delivery
 * transforms become the better answer for images already stored.
 *
 * ── What it does not change ──────────────────────────────────────────────
 *
 * Nothing about authorization. The bucket stays private, the path shape is
 * unchanged, and the upload still goes through the same authenticated client
 * under the same storage policies. This only makes the file smaller before it
 * gets there.
 */

/** The longest edge a stored logo needs. */
export const LOGO_MAX_EDGE = 256

/**
 * Below this, re-encoding is not worth it: it costs a decode and can make a
 * small, well-optimised PNG bigger.
 */
export const DOWNSCALE_MIN_BYTES = 64 * 1024

export interface DownscaleResult {
  file: File
  /** What happened, for the caller to report or log. Never thrown. */
  outcome: 'resized' | 'already-small' | 'not-an-image' | 'unsupported' | 'failed'
  originalBytes: number
  finalBytes: number
}

/**
 * Whether this file is worth resizing at all.
 *
 * SVG is excluded deliberately: it is already resolution-independent and
 * usually tiny, and rasterising it to a PNG would make it worse at every
 * size other than the one chosen here.
 */
export function shouldDownscale(file: { type: string; size: number }): boolean {
  if (!file.type.startsWith('image/')) return false
  if (file.type === 'image/svg+xml') return false
  return file.size > DOWNSCALE_MIN_BYTES
}

/**
 * The scale factor for an image, capped at 1.
 *
 * Pure and exported so the arithmetic can be tested without a canvas: an
 * image already within the cap must come back unchanged rather than be
 * enlarged, which would add bytes to fix a byte problem.
 */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge || longest === 0) return { width, height }
  const scale = maxEdge / longest
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

/**
 * Resize an image file so its longest edge is at most `maxEdge`.
 *
 * Never throws and never returns nothing: on any failure the ORIGINAL file
 * comes back with an outcome saying why. A logo upload must not fail because
 * the browser could not decode a thumbnail — the old behaviour (store it as
 * it is) is the correct fallback, and it is what happens today.
 *
 * Transparency is preserved by encoding PNG. JPEG would be smaller for a
 * photograph, but a logo on a dark header with a black box behind it is a
 * worse outcome than a few extra kilobytes.
 */
export async function downscaleImage(
  file: File,
  maxEdge: number = LOGO_MAX_EDGE,
): Promise<DownscaleResult> {
  const originalBytes = file.size
  const unchanged = (outcome: DownscaleResult['outcome']): DownscaleResult => ({
    file,
    outcome,
    originalBytes,
    finalBytes: originalBytes,
  })

  if (!file.type.startsWith('image/')) return unchanged('not-an-image')
  if (file.type === 'image/svg+xml') return unchanged('unsupported')
  if (file.size <= DOWNSCALE_MIN_BYTES) return unchanged('already-small')

  // Guarded because this runs in a browser but the module is imported by
  // tests and could be imported by a server-side path later.
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') {
    return unchanged('unsupported')
  }

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxEdge)

    // Already small enough in PIXELS: re-encoding a large-but-small-dimension
    // image is a gamble, so leave it alone.
    if (width === bitmap.width && height === bitmap.height) {
      return unchanged('already-small')
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return unchanged('failed')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.drawImage(bitmap, 0, 0, width, height)

    const blob = await new Promise<Blob | null>(res =>
      canvas.toBlob(b => res(b), 'image/png'),
    )
    if (!blob) return unchanged('failed')

    // If the round trip somehow produced something larger, keep the original.
    // The point is fewer bytes, not a resize for its own sake.
    if (blob.size >= originalBytes) return unchanged('already-small')

    const name = file.name.replace(/\.[^.]+$/, '') + '.png'
    return {
      file: new File([blob], name, { type: 'image/png' }),
      outcome: 'resized',
      originalBytes,
      finalBytes: blob.size,
    }
  } catch {
    return unchanged('failed')
  } finally {
    bitmap?.close?.()
  }
}
