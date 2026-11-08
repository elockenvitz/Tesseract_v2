import React from 'react'
import { clsx } from 'clsx'
import { useThemeWorkflows } from '../../hooks/useThemeWorkflows'
import { useThemeContributionsV2 } from '../../hooks/useThemeResearch'
import { useHoldingsForAssets } from '../../hooks/useHoldingsForAssets'
import { heldNames } from '../../lib/theme-workspace/held-positions'
import type { ThemeMode, ThemeReadMode } from '../../lib/theme-workspace/modes'

/**
 * The theme's persistent context strip.
 *
 * ── Why the Theme page gets one ──────────────────────────────────────────
 *
 * This is the Theme counterpart of `AssetContextStrip`, and it exists for the
 * same reason: the load-bearing facts about the subject lived inside whichever
 * mode happened to own them, so answering "is anything actually happening with
 * this theme" meant visiting four surfaces. The strip rides in the sticky
 * header, so they stay on screen in every mode.
 *
 * ── It owns no data and adds no query path ───────────────────────────────
 *
 * Every cell reads a hook some mode of this page already calls, under the
 * SAME query key, so React Query serves one shared cache entry and the RLS
 * boundary is exactly the one those modes already rely on:
 *
 *   useThemeWorkflows         also called by ThemeProcessesPanel (Work)
 *   useThemeContributionsV2   also called by ThemeResearchTab (Research)
 *   useHoldingsForAssets      also called by ThemeHeldPositions (Overview)
 *
 * Notes and the roster count are passed in, because `ThemeTab` already holds
 * both queries. Nothing here edits anything.
 *
 * ── Two rules it keeps, copied deliberately from the asset strip ─────────
 *
 *  - A cell names a FACT, not a page. It hands back the mode (and read mode)
 *    that owns the fact, and the page decides where that is. The asset strip
 *    used to hand over a sub-page, which is how its Research cells landed
 *    wherever Research was last scrolled to.
 *  - Absence is stated quietly, in words, at full contrast. One muted dash
 *    with "No case yet" rather than a strip full of zeroes, and never
 *    `opacity-55` over muted ink, which quiets a label into illegibility
 *    rather than into the background.
 */

export interface ThemeStripJump {
  mode: ThemeMode
  read?: ThemeReadMode
}

interface Props {
  themeId: string
  /** Every asset in the theme. Drives the roster and held cells. */
  assetIds: string[]
  /** Notes count, from the query `ThemeTab` already holds. */
  noteCount: number
  onJump: (jump: ThemeStripJump) => void
  className?: string
}

const EYEBROW = 'block text-[11px] font-semibold uppercase tracking-wide text-[color:var(--ux2-ink-3)]'
const VALUE = 'text-[14px] font-semibold leading-tight text-[color:var(--ux2-ink)]'
const SUB = 'text-[11px] leading-tight mt-0.5 truncate text-[color:var(--ux2-ink-2)]'

function Cell({
  label, onClick, title, children,
}: {
  label: string
  onClick: () => void
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={clsx(
        'flex-1 min-w-[150px] max-w-[300px] px-5 py-1 first:pl-0 text-left bg-transparent',
        'hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-inset',
      )}
    >
      <span className={EYEBROW}>{label}</span>
      <div className="mt-0.5 min-w-0">{children}</div>
    </button>
  )
}

/** Absence, in words rather than as a zero or a faded label. */
function Empty({ children }: { children: React.ReactNode }) {
  return <div className={clsx(VALUE, 'text-[color:var(--ux2-ink-2)]')}>{children}</div>
}

export function ThemeContextStrip({
  themeId, assetIds, noteCount, onJump, className,
}: Props) {
  const { joined } = useThemeWorkflows(themeId)
  const { contributors } = useThemeContributionsV2(themeId)
  const { rows, settled } = useHoldingsForAssets(assetIds)

  const held = React.useMemo(() => heldNames(rows, assetIds), [rows, assetIds])

  /* Open means joined, started and not finished. A joined-but-unstarted
     process is not work in progress, and counting it would make every theme
     look busy the moment somebody attached a template. */
  const openWork = joined.filter(w => w.progress?.is_started && !w.progress?.is_completed).length

  return (
    <div
      className={clsx(
        'flex flex-nowrap overflow-x-auto items-stretch',
        'divide-x divide-[color:var(--ux2-strip-line)]',
        className,
      )}
    >
      <Cell label="Names" onClick={() => onJump({ mode: 'assets' })} title="The assets in this theme">
        {assetIds.length === 0
          ? <Empty>None yet</Empty>
          : <div className={VALUE}>{assetIds.length}</div>}
      </Cell>

      <Cell label="Held" onClick={() => onJump({ mode: 'overview' })} title="Names the firm owns, and the largest single-portfolio stake">
        {!settled ? (
          <div className={clsx(VALUE, 'text-[color:var(--ux2-ink-2)]')}>&hellip;</div>
        ) : held.names.length === 0 ? (
          <Empty>Watchlist only</Empty>
        ) : (
          <div className={VALUE}>{held.names.length} of {assetIds.length}</div>
        )}
        {/* Largest single-portfolio stake, never a cross-book sum. The band
            says which book; here there is room only for the size.

            The slot is RESERVED, not conditional. This is the only cell with
            a second line, so it sets the strip's height: rendering it only
            once the holdings query settles made the whole header grow 16px
            after paint and pushed the mode nav down under the user's cursor.
            An invisible element keeps its box; an absent one gives it up. */}
        <div className={clsx(SUB, held.names.length === 0 && 'invisible')} aria-hidden={held.names.length === 0}>
          top {held.names.length > 0 ? held.names[0].topWeightPct.toFixed(1) : '0.0'}%
        </div>
      </Cell>

      <Cell label="Case" onClick={() => onJump({ mode: 'research' })} title="Who has written on this theme">
        {contributors.length === 0
          ? <Empty>No case yet</Empty>
          : (
            <>
              <div className={VALUE}>{contributors.length} {contributors.length === 1 ? 'contributor' : 'contributors'}</div>
            </>
          )}
      </Cell>

      <Cell label="Open work" onClick={() => onJump({ mode: 'work' })} title="Processes running against this theme">
        {openWork === 0
          ? <Empty>{joined.length > 0 ? 'None started' : 'No process'}</Empty>
          : <div className={VALUE}>{openWork} running</div>}
      </Cell>

      <Cell
        label="Notes"
        onClick={() => onJump({ mode: 'research', read: 'notes' })}
        title="Notes and links on this theme"
      >
        {noteCount === 0
          ? <Empty>None yet</Empty>
          : <div className={VALUE}>{noteCount}</div>}
      </Cell>
    </div>
  )
}
