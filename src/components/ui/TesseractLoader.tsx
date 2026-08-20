import { TesseractMark } from './TesseractMark'

/**
 * The branded loading state: the Tesseract turning through itself.
 *
 * The geometry, the schedules and the drawing all live in
 * `lib/brand/tesseract-geometry` and `TesseractMark`, shared with the app
 * launcher. This file is now only the loading COMPOSITION — the mark at a
 * readable size with a line of copy under it — because everything else was
 * identical to what the launcher needed, and a second copy would have drifted.
 *
 * See the geometry module for why the rotation is ZW rather than XW, why the
 * camera is isometric, and why the loop is phrased rather than constant.
 */

interface TesseractLoaderProps {
  size?: number
  className?: string
  showText?: boolean
  text?: string
  /**
   * Smaller type for in-surface use. The default is the app-boot treatment,
   * where the loader IS the screen and a large heading is right; inside the
   * feed it is one element among a header and a mode switch, and a heading
   * that size reads as an error state.
   */
  compact?: boolean
}

/** One loop. Three beats — invert, turn, invert — so ~1.8s per inversion. */
const PERIOD_MS = 4500

export function TesseractLoader({
  size = 80,
  className = '',
  showText = true,
  text = 'Loading...',
  compact = false,
}: TesseractLoaderProps) {
  return (
    <div className={`flex flex-col items-center justify-center ${className}`} data-testid="tesseract-loader">
      <TesseractMark size={size} periodMs={PERIOD_MS} animate />

      {showText && (
        <p className={compact
          ? 'mt-4 text-[13px] font-medium text-gray-500 dark:text-gray-400'
          : 'mt-6 text-2xl font-bold text-gray-900 dark:text-white'}>
          {text}
        </p>
      )}
    </div>
  )
}
