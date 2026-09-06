/**
 * Browse, then engage. One mode at a time.
 *
 * ── Why the stacked layout went ──────────────────────────────────────────
 *
 * Stage 2A put a capped tile band above the detail workspace. Both regions
 * were on screen at once, which meant neither got the canvas: the scan was
 * squeezed into 340px and the detail started halfway down the page, under a
 * second scroll container. It read as two products stacked vertically.
 *
 * The two states are different questions asked at different moments. "What
 * deserves my attention?" wants the whole surface to compare across objects.
 * "I chose this — give me room to think" wants the whole surface for one. A
 * layout optimised for both is optimised for neither, so the gallery now hands
 * the canvas over and steps out.
 *
 * ── A state, not an overlay ──────────────────────────────────────────────
 *
 * This is `browse | detail(objectId)` inside the same workspace tab. Not a
 * modal, not a drawer, not a sheet over the gallery: those all keep the
 * gallery mounted underneath, competing for layout and rendering, which is the
 * problem rather than a lighter version of it. The gallery genuinely unmounts.
 *
 * ── What it owns, and what it must not ───────────────────────────────────
 *
 * It owns the mode shell: one scroll container (so there is never a band
 * scroll inside a page scroll), the return affordance, and remembering where
 * the reader was in the gallery so coming back is a return rather than a
 * restart.
 *
 * It owns no ranking, no tile data, no detail module and no action semantics.
 * Each surface still decides what it lists, how it orders it and what opening
 * something means.
 */

import { useEffect, useRef } from 'react'
import { ArrowLeft } from 'lucide-react'

export type WorkspaceMode = 'browse' | 'detail'

export function DesktopWorkspace({
  mode, backLabel, onBack, children,
}: {
  mode: WorkspaceMode
  /**
   * Where the reader returns TO, named as the destination.
   *
   * "Large Cap Core" beats "All Portfolio" — the reader is going back to a
   * specific book, and the control should say which.
   */
  backLabel: string
  onBack: () => void
  children: React.ReactNode
}) {
  const scroller = useRef<HTMLDivElement>(null)
  // Where the reader had scrolled to in the gallery. Kept across the unmount
  // so returning lands them where they were, not at the top.
  const browseScroll = useRef(0)

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    // Detail always starts at its own top; browse resumes.
    el.scrollTop = mode === 'browse' ? browseScroll.current : 0
  }, [mode])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      {mode === 'detail' && (
        <div className="shrink-0 border-b border-gray-200 bg-white px-6 py-2 dark:border-white/10 dark:bg-[#141a25]">
          <button
            type="button"
            onClick={onBack}
            data-testid="workspace-back"
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {backLabel}
          </button>
        </div>
      )}

      {/* One scroll container for the whole mode. Neither state nests a second
          one, which is what made the stacked version confusing to move around
          in. */}
      <div
        ref={scroller}
        data-testid={mode === 'browse' ? 'workspace-browse' : 'workspace-detail'}
        onScroll={() => {
          if (mode === 'browse' && scroller.current) {
            browseScroll.current = scroller.current.scrollTop
          }
        }}
        className="min-h-0 flex-1 overflow-y-auto"
      >
        {children}
      </div>
    </div>
  )
}
