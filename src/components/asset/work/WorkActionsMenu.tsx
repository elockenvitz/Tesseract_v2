import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { MoreHorizontal } from 'lucide-react'

/**
 * One menu for a surface's secondary actions.
 *
 * ── Why this exists ─────────────────────────────────────────────────────
 *
 * The Process header carried nine controls across one row: a selector, Mark
 * Complete, priority, Timeline, Files, assignment, deadline, advance, and
 * the stage navigation. Everything was permanently visible and nothing was
 * primary, so the row read as a toolbar for an application rather than the
 * identity of the thing being worked on.
 *
 * Actions that are used once a session belong behind one control that says
 * what it is. The alternative the product kept reaching for — turning each
 * into an unlabelled icon — makes the row narrower and the meanings worse.
 *
 * Every item here is a labelled row. The trigger is labelled for assistive
 * technology, and the menu closes on an outside click, on Escape, and after
 * any choice: a menu that stays open after acting is a menu you have to
 * dismiss twice.
 */

export interface WorkAction {
  key: string
  label: string
  icon?: React.ReactNode
  onSelect: () => void
  /** Marks the current state, e.g. the Documents view already open. */
  active?: boolean
  /** Rendered muted and unclickable, with the reason as a title. */
  disabled?: boolean
  disabledReason?: string
  /** Starts a new group above this item. */
  startsGroup?: boolean
}

interface Props {
  actions: readonly WorkAction[]
  /** What the trigger says to assistive technology. */
  label: string
  /** Rendered inside the menu above the actions, e.g. a process switcher. */
  header?: React.ReactNode
  align?: 'left' | 'right'
  className?: string
}

export function WorkActionsMenu({ actions, label, header, align = 'right', className }: Props) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (!actions.length && !header) return null

  return (
    <div ref={root} className={clsx('relative', className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        data-testid="work-actions-trigger"
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors',
          open
            ? 'border-gray-900 bg-gray-900 text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900'
            : 'border-gray-200 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300',
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          data-testid="work-actions-menu"
          className={clsx(
            'absolute z-30 mt-1 min-w-[230px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {header && (
            <div className="border-b border-gray-100 px-3 py-2 dark:border-gray-700">{header}</div>
          )}
          {actions.map(a => (
            <div key={a.key}>
              {a.startsGroup && <div className="my-1 border-t border-gray-100 dark:border-gray-700" />}
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled}
                title={a.disabled ? a.disabledReason : undefined}
                data-testid={`work-action-${a.key}`}
                onClick={() => { setOpen(false); a.onSelect() }}
                className={clsx(
                  'flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] transition-colors',
                  a.disabled
                    ? 'cursor-not-allowed text-gray-300 dark:text-gray-600'
                    : 'text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700',
                  a.active && 'font-medium text-primary-700 dark:text-primary-300',
                )}
              >
                {a.icon}
                {a.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
