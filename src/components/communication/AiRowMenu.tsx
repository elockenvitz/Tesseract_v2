/**
 * The `···` menu a rail row opens, without the items.
 *
 * ── Why this is its own file ────────────────────────────────────────────
 *
 * The conversation row had this and the project row did not. A project
 * revealed three bare icon buttons on hover instead -- rename, archive,
 * delete, 12px each, identified only by a tooltip, with Delete next to
 * Archive -- which is the arrangement the conversation row was built to
 * replace.
 *
 * It also revealed them by going from `display: none` to `display: flex`,
 * which ADDS WIDTH to the row the moment the pointer enters it. The name
 * beside them is `flex-1 truncate`, so it shrank, and the count after
 * them moved. That is the reported "hovering a project folder causes its
 * size or layout to shift", and it is a layout change rather than a
 * colour one, which is the thing the brief rules out.
 *
 * Giving the project row the same menu meant either a second copy of the
 * keyboard handling, the outside-press handling and the focus rules, or
 * this. The items differ between the two rows; none of the behaviour does.
 *
 * ── What it owns ────────────────────────────────────────────────────────
 *
 * Open and closed. Arrow keys across whatever `[data-menu-item]` the
 * current panel holds, Escape to close and return focus to the trigger,
 * Tab to close. Opening from the keyboard focuses the first item; opening
 * with the mouse does not move focus, because a reader who clicked knows
 * where their pointer is. An outside press closes on `pointerdown`, so
 * the menu is gone before the row underneath decides it was selected.
 *
 * A caller that needs a key the shell does not handle -- the conversation
 * menu's ArrowLeft, which backs out of its Move view -- gets it through
 * `onKeyDown` and says whether it consumed it.
 *
 * The key handler is on the WRAPPER, not the panel. Opening with the
 * mouse deliberately leaves focus on the trigger, so a handler on the
 * panel never saw the reader's Escape: the menu stayed open and only a
 * click elsewhere would shut it.
 *
 * ── What it does not own ────────────────────────────────────────────────
 *
 * Anything destructive. `Item` calls what it is given, and the Delete item
 * in both callers asks its host to open the app's own `ConfirmDialog`. A
 * menu item that deletes on click is one keystroke from losing something.
 */
import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { clsx } from 'clsx'

export interface AiRowMenuApi {
  /** Shut the panel. Pass false to leave focus where it is. */
  close: (restoreFocus?: boolean) => void
  /** Move focus to the first item once the next render has drawn it. */
  focusFirstItem: () => void
}

export function AiRowMenu({
  testId, panelTestId, label, width = 'w-48', className,
  refocusKey, onOpenChange, onKeyDown, children,
}: {
  testId: string
  panelTestId: string
  /** The thing being acted on. Names the trigger and the panel. */
  label: string
  /** Tailwind width for the panel. */
  width?: string
  className?: string
  /** Changes when the panel swaps its item set, so focus can follow. */
  refocusKey?: unknown
  onOpenChange?: (open: boolean) => void
  /** Runs first. Return true when it has consumed the key. */
  onKeyDown?: (e: React.KeyboardEvent, api: AiRowMenuApi) => boolean
  children: (api: AiRowMenuApi) => React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  /** Set when the menu was opened from the keyboard, so focus follows. */
  const focusFirst = useRef(false)

  const change = (next: boolean) => {
    setOpen(next)
    onOpenChange?.(next)
  }

  const close = (restoreFocus = true) => {
    change(false)
    if (restoreFocus) trigger.current?.focus()
  }

  const api: AiRowMenuApi = {
    close,
    focusFirstItem: () => { focusFirst.current = true },
  }

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false)
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [open])

  useEffect(() => {
    if (!open || !focusFirst.current) return
    focusFirst.current = false
    panel.current?.querySelector<HTMLElement>('[data-menu-item]')?.focus()
  }, [open, refocusKey])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onKeyDown?.(e, api)) return
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Tab') {
      close(false)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const items = [...(panel.current?.querySelectorAll<HTMLElement>('[data-menu-item]') ?? [])]
    if (items.length === 0) return
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'ArrowDown'
      ? items[(at + 1 + items.length) % items.length]
      : items[(at - 1 + items.length) % items.length]
    next?.focus()
  }

  return (
    <div
      ref={wrap}
      className={clsx('relative', className)}
      onKeyDown={open ? handleKeyDown : undefined}
    >
      <button
        ref={trigger}
        type="button"
        data-testid={testId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${label}`}
        title="More actions"
        onClick={e => {
          e.stopPropagation()
          /* `detail` is 0 for a keyboard-driven click, which is how the menu
             knows whether to move focus into itself. */
          focusFirst.current = e.detail === 0
          change(!open)
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            focusFirst.current = true
            change(true)
          }
        }}
        className="flex h-6 w-6 items-center justify-center rounded text-gray-400
                   hover:bg-gray-200 hover:text-gray-700
                   dark:hover:bg-gray-700 dark:hover:text-gray-200"
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panel}
          role="menu"
          aria-label={`Actions for ${label}`}
          data-testid={panelTestId}
          onClick={e => e.stopPropagation()}
          className={clsx(
            'absolute right-0 z-50 mt-1 overflow-hidden rounded-lg border',
            'border-gray-200 bg-white py-1 shadow-lg',
            'dark:border-gray-700 dark:bg-gray-800',
            width,
          )}
        >
          {children(api)}
        </div>
      )}
    </div>
  )
}

export function Item({
  children, icon: Icon, onPick, danger, testId,
}: {
  children: React.ReactNode
  icon: typeof MoreHorizontal
  onPick: () => void
  danger?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      data-menu-item
      role="menuitem"
      data-testid={testId}
      onClick={onPick}
      className={clsx(
        'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm',
        danger
          ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20'
          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </button>
  )
}
