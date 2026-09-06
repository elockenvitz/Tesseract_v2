/**
 * The chip rail that sits directly under the app header.
 *
 * ── Why this is a shared constant and not two similar class strings ───────
 *
 * Two things occupy this slot, and only ever one at a time: the
 * Ideas/Explore/Curate switch, and the "Back to Explore" bar that replaces it
 * while a tile is open. Because they swap, any difference between them changes
 * the height of the box the content below is given — so a card that fits the
 * grid stops fitting the detail, and the reader sees a tile resize itself
 * simply for having been opened.
 *
 * That is the defect this closes, and it happened twice with two different
 * numbers: the bar shipped at 61px, then at 49px, against a rail of 45. Both
 * were wrong the same way — the height was being CHOSEN rather than matched.
 *
 * Stating it once means it cannot drift. `BAR` is the row; `CHIP` is a control
 * inside it. `no-touch-target` is on the chip for the reason its neighbours
 * carry it: a 44px control inside a 45px row bursts the row it belongs to, and
 * the tap area here is the one the mode switch has always used.
 */
export const MODE_BAR = {
  /** The row itself. 45px at every supported width. */
  BAR: 'flex shrink-0 items-center gap-2 border-b border-gray-200 px-3 pb-1.5 pt-1.5'
    + ' [padding-top:calc(0.375rem+env(safe-area-inset-top))] dark:border-gray-800',
  /** A labelled pill inside it — the filter chip's shape, and the back control's. */
  CHIP: 'flex h-8 items-center gap-1 rounded-full bg-gray-100 px-3 text-[12px] font-bold'
    + ' text-gray-700 no-touch-target dark:bg-gray-800 dark:text-gray-200',
} as const

/** What `MODE_BAR.BAR` measures, so a layout test can assert against a number. */
export const MODE_BAR_HEIGHT_PX = 45
