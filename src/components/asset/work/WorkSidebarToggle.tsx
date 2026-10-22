/**
 * The control that hides and restores the Work sidebar.
 *
 * One component for both affordances — the collapse control sits at the top
 * right of the sidebar, the expand control at the top left of the working
 * surface — because they are the same control in two places, and two
 * hand-written buttons drift in icon, label and size.
 *
 * Focus is handed across the toggle deliberately. Collapsing removes the
 * button that was just pressed, and a browser left to itself drops focus to
 * `body`, so a keyboard user loses their place in the page. Each button
 * carries the other's id and moves focus there after the layout has
 * settled.
 */
import { useCallback, useRef } from 'react'
import { clsx } from 'clsx'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'

export const WORK_SIDEBAR_COLLAPSE_ID = 'work-sidebar-collapse'
export const WORK_SIDEBAR_EXPAND_ID = 'work-sidebar-expand'
/** The sidebar element this control governs, for `aria-controls`. */
export const WORK_SIDEBAR_REGION_ID = 'asset-work-sidebar-region'

export interface WorkSidebarToggleProps {
  /** `collapse` hides the sidebar; `expand` restores it. */
  direction: 'collapse' | 'expand'
  onToggle: () => void
  className?: string
}

export function WorkSidebarToggle({ direction, onToggle, className }: WorkSidebarToggleProps) {
  const collapsing = direction === 'collapse'
  const Icon = collapsing ? PanelLeftClose : PanelLeftOpen
  const label = collapsing ? 'Collapse Work sidebar' : 'Expand Work sidebar'
  const ref = useRef<HTMLButtonElement>(null)

  const handle = useCallback(() => {
    onToggle()
    /*
      The counterpart does not exist until this render commits, so the
      lookup waits a frame. If it is not there — a narrow layout where the
      other control is not rendered — focus is left where the browser put
      it rather than thrown somewhere arbitrary.
    */
    const targetId = collapsing ? WORK_SIDEBAR_EXPAND_ID : WORK_SIDEBAR_COLLAPSE_ID
    requestAnimationFrame(() => {
      const next = document.getElementById(targetId)
      if (next instanceof HTMLElement) next.focus()
    })
  }, [onToggle, collapsing])

  return (
    <button
      ref={ref}
      type="button"
      id={collapsing ? WORK_SIDEBAR_COLLAPSE_ID : WORK_SIDEBAR_EXPAND_ID}
      onClick={handle}
      aria-label={label}
      title={label}
      aria-expanded={collapsing}
      aria-controls={WORK_SIDEBAR_REGION_ID}
      data-testid={collapsing ? 'work-sidebar-collapse' : 'work-sidebar-expand'}
      className={clsx(
        'inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-gray-300',
        'transition-colors hover:bg-gray-100 hover:text-gray-500',
        'dark:hover:bg-gray-800 dark:hover:text-gray-300',
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  )
}
