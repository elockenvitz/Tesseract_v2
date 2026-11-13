/**
 * One menu per conversation, instead of five icons on hover.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 *
 * The row used to reveal five 12px icon buttons on hover: move, pin,
 * rename, archive, delete. Five competing targets in a 240px rail, each
 * identified only by a tooltip, with Delete adjacent to Archive — which is
 * the arrangement where a mis-click is destructive. They are all here now,
 * behind one `···`.
 *
 * Move to project is the item that prompted this. It existed, as a folder
 * icon among the five, and was not discoverable: nothing on screen said
 * "project", and the control that did the moving looked like the control
 * that filtered. It is now a named item that opens the list of projects.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────
 *
 * Arrow keys move, Enter and Space activate, Escape closes and returns
 * focus to the trigger, Tab closes. Opening with the keyboard focuses the
 * first item; opening with the mouse does not move focus, because a reader
 * who clicked knows where their pointer is.
 *
 * ── What it does not do ─────────────────────────────────────────────────
 *
 * It does not delete. Delete asks the host to open its confirmation dialog,
 * which is the app's own `ConfirmDialog` and is the only thing that calls
 * through. A menu item that deletes on click is one keystroke from losing a
 * conversation.
 */
import { useEffect, useRef, useState } from 'react'
import {
  MoreHorizontal, Pencil, FolderInput, Pin, PinOff, Archive, ArchiveRestore,
  Trash2, Folder, Check, ArrowLeft, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { AIProjectFolder } from '../../lib/ai/folders'

export interface AiConversationMenuProps {
  conversationId: string
  title: string
  isPinned: boolean
  isArchived?: boolean
  /** The project it currently sits in, or null for unfiled. */
  folderId: string | null
  /** Projects it could be moved to. */
  folders: AIProjectFolder[]
  onRename: () => void
  onTogglePin?: () => void
  onArchive?: () => void
  onUnarchive?: () => void
  /** null moves it out of every project. */
  onMove?: (folderId: string | null) => void
  onRequestDelete: () => void
  className?: string
}

type View = 'root' | 'move'

export function AiConversationMenu({
  conversationId, title, isPinned, isArchived = false,
  folderId, folders,
  onRename, onTogglePin, onArchive, onUnarchive, onMove, onRequestDelete,
  className,
}: AiConversationMenuProps) {
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('root')
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  /** Set when the menu was opened from the keyboard, so focus follows. */
  const focusFirst = useRef(false)

  const label = title || 'Untitled conversation'

  /* The control appears only where there is somewhere to move to. An enabled
     item that does nothing is worse than an absent one. */
  const canMove = !!onMove && (folders.length > 0 || folderId !== null)

  const close = (restoreFocus = true) => {
    setOpen(false)
    setView('root')
    if (restoreFocus) trigger.current?.focus()
  }

  /* Outside click. Pointerdown rather than click, so the menu is gone before
     the row underneath it decides it was selected. */
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
    const first = panel.current?.querySelector<HTMLElement>('[data-menu-item]')
    first?.focus()
  }, [open, view])

  /** Arrow-key movement across whichever items this view is showing. */
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      close()
      return
    }
    if (e.key === 'Tab') {
      close(false)
      return
    }
    if (e.key === 'ArrowLeft' && view === 'move') {
      e.preventDefault()
      setView('root')
      focusFirst.current = true
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
    /*
     * The key handler is on the WRAPPER, not the panel.
     *
     * Opening with the mouse deliberately leaves focus on the trigger, so a
     * handler on the panel never saw the reader's Escape -- the menu stayed
     * open and only a click elsewhere would shut it. The wrapper contains
     * both the trigger and the panel, so it sees the keystroke either way.
     */
    <div
      ref={wrap}
      className={clsx('relative', className)}
      onKeyDown={open ? onPanelKeyDown : undefined}
    >
      <button
        ref={trigger}
        type="button"
        data-testid={`ai-conv-menu-${conversationId}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`More actions for ${label}`}
        title="More actions"
        onClick={e => {
          e.stopPropagation()
          /* `detail` is 0 for a keyboard-driven click, which is how the menu
             knows whether to move focus into itself. */
          focusFirst.current = e.detail === 0
          setView('root')
          setOpen(o => !o)
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault()
            focusFirst.current = true
            setOpen(true)
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
          data-testid={`ai-conv-menu-panel-${conversationId}`}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 z-50 mt-1 w-48 overflow-hidden rounded-lg border
                     border-gray-200 bg-white py-1 shadow-lg
                     dark:border-gray-700 dark:bg-gray-800"
        >
          {view === 'root' ? (
            <>
              <Item icon={Pencil} onPick={() => { close(false); onRename() }}>
                Rename
              </Item>

              {canMove && (
                <Item
                  icon={FolderInput}
                  testId={`ai-move-${conversationId}`}
                  onPick={() => { setView('move'); focusFirst.current = true }}
                >
                  Move to project
                </Item>
              )}

              {onTogglePin && (
                <Item icon={isPinned ? PinOff : Pin} onPick={() => { close(false); onTogglePin() }}>
                  {isPinned ? 'Unpin' : 'Pin'}
                </Item>
              )}

              {isArchived
                ? onUnarchive && (
                  <Item icon={ArchiveRestore} onPick={() => { close(false); onUnarchive() }}>
                    Restore
                  </Item>
                )
                : onArchive && (
                  <Item icon={Archive} onPick={() => { close(false); onArchive() }}>
                    Archive
                  </Item>
                )}

              <div className="my-1 border-t border-gray-100 dark:border-gray-700" />

              {/* Asks the host to confirm. Nothing here deletes. */}
              <Item icon={Trash2} danger onPick={() => { close(false); onRequestDelete() }}>
                Delete
              </Item>
            </>
          ) : (
            <>
              <button
                type="button"
                data-menu-item
                role="menuitem"
                onClick={() => { setView('root'); focusFirst.current = true }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs
                           font-medium text-gray-500 hover:bg-gray-100
                           dark:text-gray-400 dark:hover:bg-gray-700"
              >
                <ArrowLeft className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Move to project
              </button>
              <div className="my-1 border-t border-gray-100 dark:border-gray-700" />

              {folders.length === 0 && (
                <p className="px-2.5 py-1.5 text-xs italic text-gray-400">
                  No projects yet.
                </p>
              )}

              {folders.map(f => {
                const here = f.id === folderId
                return (
                  <button
                    key={f.id}
                    type="button"
                    data-menu-item
                    data-slot="ai-move-option"
                    role="menuitem"
                    disabled={here}
                    onClick={() => { close(false); if (!here) onMove?.(f.id) }}
                    className={clsx(
                      'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm',
                      here
                        ? 'text-primary-600 dark:text-primary-400'
                        : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-700',
                    )}
                  >
                    {here
                      ? <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      : <Folder className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />}
                    <span className="truncate">{f.name}</span>
                  </button>
                )
              })}

              {folderId !== null && (
                <>
                  <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
                  <button
                    type="button"
                    data-menu-item
                    data-slot="ai-move-option"
                    role="menuitem"
                    data-testid={`ai-unfile-${conversationId}`}
                    onClick={() => { close(false); onMove?.(null) }}
                    className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm
                               text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                  >
                    <X className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                    Remove from project
                  </button>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Item({
  children, icon: Icon, onPick, danger, testId,
}: {
  children: React.ReactNode
  icon: typeof Pencil
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
