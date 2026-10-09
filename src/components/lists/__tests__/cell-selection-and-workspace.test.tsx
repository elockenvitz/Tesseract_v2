/**
 * Three defects reported together, and the single cause under each one.
 *
 * All three were found by MEASURING THE RUNNING APP, not by reading the code —
 * in every case the source looked right and the screen was wrong. So the tests
 * below guard the specific declaration that was wrong, and where that
 * declaration lives inside the 6,600-line virtualised table it is asserted
 * against comment-stripped source (see `contextual-entry-seam` for why prose
 * must not be able to satisfy a gate).
 *
 *   1. SELECTION COVERED PART OF A CELL. An expanded row becomes a column flex
 *      and its cells were `h-auto`, so each sized to its own content: 42, 30,
 *      30, 30, 30, 10, 35 and 10 pixels inside a 44px stripe. The outline is
 *      drawn to the cell's box, so it covered a fraction of the row.
 *
 *   2. THE TICKER CO-HIGHLIGHTED. The outline was keyed off the mode the PANEL
 *      resolved to, which falls back to Overview whenever the clicked mode is
 *      unavailable — and Overview's entry is the frozen ticker. Clicking
 *      Exposure on a name we do not hold ringed the ticker.
 *
 *   3. HOVER WAS INVISIBLE ON HALF THE ROWS. The hover tint was slate-50,
 *      which is the exact colour of the even-row zebra.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const SRC = resolve(__dirname, '../../..')
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const TABLE = codeOf(readFileSync(resolve(SRC, 'components/table/AssetTableView.tsx'), 'utf8'))
const CSS = readFileSync(resolve(SRC, 'components/lists/lists-surface.css'), 'utf8')

describe('a cell is the full row stripe, open or closed', () => {
  it('never sizes a cell to its own content', () => {
    /*
     * The regression this catches is a one-word edit: putting the expanded
     * branch back on the cell's height class. It is invisible in review and
     * instantly visible on screen, which is the worst combination.
     */
    expect(TABLE).not.toMatch(/isExpanded \? 'h-auto' : 'h-full'/)
  })

  it('pins the cells band to the row height when the row is expanded', () => {
    // Without this the band is the column flex's auto-height child and
    // `h-full` on the cells inside it resolves against nothing.
    expect(TABLE).toMatch(/height: isExpanded \? densityRowHeight : undefined/)
  })
})

describe('the outline follows the cell the reader touched', () => {
  it('is driven by the focused cell, not by the panel\'s resolved mode', () => {
    expect(CSS).toMatch(/\.pro-table-cell\.focused::after/)
  })

  it('no longer keys any highlight off data-open-entry', () => {
    /*
     * `data-open-entry` still exists and still chooses the panel's mode and
     * height — it just must not decide what looks selected, because it
     * reports where the PANEL landed and not where the READER clicked.
     */
    expect(CSS).not.toMatch(/\[data-open-entry[^\]]*\][^{]*\{[^}]*box-shadow/)
    expect(CSS).not.toMatch(/data-open-entry="overview"\][^{]*\[data-col="ticker"\]/)
  })

  it('draws one ring, not the table\'s flush one as well', () => {
    // Two concentric outlines in two blues is what "not clean" looked like.
    // The scoped rule has to cancel the shared table's own focus shadow.
    const focusRule = CSS.slice(CSS.indexOf('.lists-surface .pro-table-cell.focused {'))
      .slice(0, 400)
    expect(focusRule).toMatch(/box-shadow:\s*none/)
  })

  it('insets the ring so it is not clipped by the column rules', () => {
    expect(CSS).toMatch(/\.pro-table-cell\.focused::after[\s\S]{0,300}inset:\s*3px 2px/)
  })
})

describe('hover is distinguishable from the zebra it sits on', () => {
  /** Every colour the table paints an un-hovered row. */
  const ZEBRA = ['rgb(248 250 252)', '#f8fafc', '#ffffff', 'rgb(255 255 255)']

  it('does not reuse the even-row colour as the hover colour', () => {
    const hover = CSS.match(/\.pro-table-row:hover,[\s\S]{0,120}?background:\s*([^;!]+)/)
    expect(hover, 'the hover rule must exist').not.toBeNull()
    const colour = hover![1].trim().toLowerCase()
    for (const z of ZEBRA) {
      expect(colour, `hover must differ from the zebra colour ${z}`).not.toBe(z.toLowerCase())
    }
  })

  it('reaches the frozen identity cell, whose background is an inline style', () => {
    // An inline style beats any non-`!important` declaration, so without this
    // the hover stopped dead at the pinned column.
    expect(CSS).toMatch(
      /\.pro-table-row:hover \.pro-table-cell\[data-col="ticker"\][\s\S]{0,120}!important/,
    )
  })

  it('keeps a selected cell readable underneath a hovered row', () => {
    // Hover + selection must stay two states, not merge into one wash.
    expect(CSS).toMatch(/\.pro-table-row:hover \.pro-table-cell\.focused/)
  })
})

describe('the maximized workspace is a shell around the same expansion', () => {
  const OVERLAY = readFileSync(resolve(SRC, 'components/lists/ListWorkspaceOverlay.tsx'), 'utf8')
  const LIST = codeOf(readFileSync(resolve(SRC, 'components/lists/ListTableView.tsx'), 'utf8'))
  const OVERLAY_CODE = codeOf(OVERLAY)

  it('renders one ListRowExpansion, used by both branches', () => {
    /*
     * The requirement is "do not create a second Asset Page or duplicate
     * investment workflow logic". A second `<ListRowExpansion` in this file
     * would mean two call sites to keep in step on props, permissions and
     * canonical actions — so there is exactly one, and the overlay receives it.
     */
    const mounts = LIST.match(/<ListRowExpansion\b/g) ?? []
    expect(mounts.length).toBe(1)
    expect(LIST).toMatch(/<ListWorkspaceOverlay[\s\S]{0,200}\{panel\}/)
  })

  it('is a labelled modal dialog', () => {
    expect(OVERLAY_CODE).toMatch(/role="dialog"/)
    expect(OVERLAY_CODE).toMatch(/aria-modal="true"/)
    expect(OVERLAY_CODE).toMatch(/aria-label=\{`\$\{label\} workspace`\}/)
  })

  it('takes Escape in the capture phase so it does not also close the row', () => {
    /*
     * `AssetTableView` has a window-level Escape handler that collapses the
     * expanded row. Bubbling, one Escape would restore the workspace AND lose
     * the security — the reader would be charged a security for making a
     * panel smaller.
     */
    expect(OVERLAY_CODE).toMatch(/addEventListener\('keydown', onKey, true\)/)
    expect(OVERLAY_CODE).toMatch(/stopPropagation\(\)/)
  })

  it('moves focus in and gives it back', () => {
    expect(OVERLAY_CODE).toMatch(/panelRef\.current\?\.focus/)
    expect(OVERLAY_CODE).toMatch(/previous\?\.focus/)
  })

  it('traps Tab inside the dialog', () => {
    expect(OVERLAY_CODE).toMatch(/if \(e\.key !== 'Tab'\) return/)
  })

  it('survives StrictMode\'s double mount', () => {
    /*
     * A bare unmount cleanup here cleared the maximized row id during
     * StrictMode's synthetic unmount, so in development the workspace closed
     * in the frame it opened and never appeared. Observed, not theorised.
     */
    expect(OVERLAY_CODE).toMatch(/alive\.current = true/)
    expect(OVERLAY_CODE).toMatch(/if \(!alive\.current\) closeRef\.current\(\)/)
  })

  it('holds the mode above the component that the transition remounts', () => {
    // Re-parenting changes depth, and React remounts across a depth change —
    // so a mode held inside the expansion is lost exactly when the reader asks
    // for more room to keep looking at it.
    expect(LIST).toMatch(/modeOverride/)
    expect(LIST).toMatch(/onModeOverride=\{next => setModeOverride\(\{ rowId, value: next \}\)\}/)
  })

  it('leaves the row in place so the list is unchanged behind it', () => {
    expect(LIST).toMatch(/data-testid="expansion-placeholder"/)
  })
})

describe('the chart does not call a cached close live', () => {
  const EXPANSION = codeOf(
    readFileSync(resolve(SRC, 'components/lists/ListRowExpansion.tsx'), 'utf8'),
  )
  const CHART = codeOf(readFileSync(resolve(SRC, 'components/charts/PriceChart.tsx'), 'utf8'))

  it('prints the caller\'s label and never invents one', () => {
    expect(CHART).not.toMatch(/liveSpot != null \? 'live'/)
    expect(CHART).toMatch(/liveSpot != null[\s\S]{0,60}spotLabel/)
  })

  it('only claims live when the quote produced a real day\'s move', () => {
    /*
     * The quote layer hands back a zero-filled object when its providers
     * fail — a real-looking price with `changePercent: 0`. `ListRowCells`
     * already refuses to render a zero change from any source; the same
     * evidence has to govern the same claim here.
     */
    expect(EXPANSION).toMatch(/Number\.isFinite\(move\) && move !== 0/)
    expect(EXPANSION).toMatch(/corroborated \? 'live' : 'undated'/)
  })

  it('names an undated price rather than leaving the stamp blank', () => {
    /*
     * A blank stamp beside a chart whose other states all carry one reads as
     * current. There is exactly one branch that may print no label, and it is
     * the one with no price to label.
     */
    const labels = EXPANSION.match(/displaySpotLabel: [^,\n}]+/g) ?? []
    expect(labels.length).toBeGreaterThanOrEqual(4)
    expect(labels.filter(l => /:\s*null$/.test(l)).length).toBe(1)
  })

  it('labels a cached close with its own date', () => {
    expect(EXPANSION).toMatch(/`Close of \$\{last\.date\}`/)
  })
})

describe('the chart stops giving away width it has the height to use', () => {
  const CHART = codeOf(readFileSync(resolve(SRC, 'components/charts/PriceChart.tsx'), 'utf8'))

  it('releases the aspect cap once the box can resolve a move', () => {
    // Measured: at 145px tall the 4:1 cap drew a 579px plot in a 1,322px
    // region. The cap protects short boxes; it was flattening tall ones.
    expect(CHART).toMatch(/H >= TALL_ENOUGH \? \(box\.w \|\| 720\) : Math\.min\(box\.w \|\| 720, H \* MAX_ASPECT\)/)
  })

  it('still caps a short box', () => {
    expect(CHART).toMatch(/const MAX_ASPECT = 4/)
  })
})
