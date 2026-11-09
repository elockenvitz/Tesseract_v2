/**
 * The Research toolbar's overflow menu.
 *
 * Customize and Export are real capabilities that almost nobody uses twice in
 * a session, and they sat on the toolbar at the same visual weight as the
 * controls that decide how the case is read. Moving them behind `⋯` takes two
 * permanent controls off the bar without removing either — the labels live in
 * the menu, so they are more discoverable here than they were as bare icons
 * with tooltips.
 *
 * It is deliberately a menu, not a popover of settings: every item does one
 * thing and closes. Anything that needs state belongs on the bar.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { MoreHorizontal } from 'lucide-react'

export interface ResearchToolbarMenuItem {
  key: string
  label: string
  icon: React.ElementType
  onSelect: () => void
  /** Hidden entirely when false — a capability the reader does not have is
   *  not shown disabled, which only advertises something they cannot do. */
  available?: boolean
}

export function ResearchToolbarMenu({
  items,
  className,
}: {
  items: ResearchToolbarMenuItem[]
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  const visible = items.filter(i => i.available !== false)

  const close = useCallback((restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) triggerRef.current?.focus()
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, close])

  // Focus the first item on open, so the menu is usable without a mouse.
  useEffect(() => {
    if (open) itemRefs.current[0]?.focus()
  }, [open])

  /** Arrow keys move within the menu and wrap, as a menu is expected to. */
  const onItemKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const next = e.key === 'ArrowDown'
      ? (index + 1) % visible.length
      : (index - 1 + visible.length) % visible.length
    itemRefs.current[next]?.focus()
  }

  if (visible.length === 0) return null

  return (
    <div ref={rootRef} className={clsx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? close() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More research actions"
        title="More research actions"
        data-testid="research-more-trigger"
        className={clsx(
          'flex items-center justify-center rounded-lg p-1.5 transition-colors',
          open
            ? 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200'
            : 'text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800 dark:hover:text-gray-200'
        )}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="More research actions"
          data-testid="research-more-menu"
          className={clsx(
            'absolute right-0 top-full z-30 mt-1.5 min-w-[13rem] overflow-hidden rounded-lg border bg-white py-1 shadow-lg',
            'border-gray-200 dark:border-gray-700 dark:bg-gray-800'
          )}
        >
          {visible.map((item, i) => {
            const Icon = item.icon
            return (
              <button
                key={item.key}
                ref={el => { itemRefs.current[i] = el }}
                role="menuitem"
                type="button"
                data-testid={`research-more-${item.key}`}
                onKeyDown={e => onItemKeyDown(e, i)}
                onClick={() => { close(false); item.onSelect() }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700"
              >
                <Icon className="h-4 w-4 shrink-0 text-gray-400" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
