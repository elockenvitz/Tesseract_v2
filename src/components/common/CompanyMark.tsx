import { useState } from 'react'
import { clsx } from 'clsx'
import { MARK_PALETTE, markPaletteIndex, monogramFor } from './company-mark-identity'

/**
 * One company's visual mark, used everywhere a security is named.
 *
 * ── Why this is a monogram and not a logo ─────────────────────────────────
 *
 * There is no company-logo data in this system. `assets` carries symbol,
 * company_name, sector, industry, country, exchange, market_cap,
 * asset_type, currency, isin, figi and mic — and no logo column, no logo
 * URL, no cache table. `OrgLogo` exists, but that is the CUSTOMER's own
 * uploaded mark in Storage, which is a different thing entirely.
 *
 * The obvious shortcut is a public logo endpoint keyed on domain. We are not
 * taking it. A logo is a trademark: fetching one from an aggregator that
 * does not grant redistribution rights would put someone else's mark into a
 * commercial product on the strength of the endpoint answering, which is the
 * same reasoning error as treating an API that returns prices as a licence
 * to show them. It would also leak every ticker a user searches to a third
 * party on the keystroke.
 *
 * So the default is a monogram we own outright, and `src` is the seam for a
 * licensed source later. When one is wired up, nothing but the caller's
 * `src` changes: every surface already renders through this component, at
 * the same size, with the same fallback.
 *
 * The colour and the letters are in `company-mark-identity`, which is both
 * where they can be tested and where they do not break fast refresh.
 */

interface Props {
  /** The ticker. Drives both the monogram and the colour. */
  symbol?: string | null
  /** Used for the accessible name, and for the monogram when there is no ticker. */
  name?: string | null
  /**
   * A licensed logo URL, when one exists. Absent for every caller today:
   * see the note above. A load failure falls back to the monogram rather
   * than leaving a broken-image glyph in a results list.
   */
  src?: string | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE = {
  sm: 'h-6 w-6 text-[10px] rounded',
  // 36px, which is exactly the icon box every other global-search row
  // draws. A security row and a portfolio row must occupy the same height
  // or the list jolts as the result mix changes between keystrokes.
  md: 'h-9 w-9 text-xs rounded-lg',
  lg: 'h-10 w-10 text-sm rounded-md',
} as const

export function CompanyMark({ symbol, name, src, size = 'md', className }: Props) {
  const [failed, setFailed] = useState(false)

  const seed = (symbol ?? name ?? '').trim().toUpperCase()
  const label = symbol ? `${symbol}${name ? ` (${name})` : ''}` : (name ?? 'Security')

  // Fixed box in every state. A results list that sizes itself to whichever
  // marks happened to load reflows as they arrive, and a reflow inside a
  // keyboard-navigable list moves the row under the user's selection.
  const box = clsx(
    'shrink-0 flex items-center justify-center font-semibold tracking-tight select-none',
    SIZE[size],
    className,
  )

  if (src && !failed) {
    return (
      <img
        src={src}
        alt={label}
        loading="lazy"
        decoding="async"
        onError={() => setFailed(true)}
        className={clsx(box, 'object-contain bg-white dark:bg-gray-800 ring-1 ring-black/5')}
      />
    )
  }

  return (
    <span
      className={clsx(box, MARK_PALETTE[markPaletteIndex(seed)])}
      role="img"
      aria-label={label}
      data-testid="company-mark"
    >
      {monogramFor(symbol, name)}
    </span>
  )
}
