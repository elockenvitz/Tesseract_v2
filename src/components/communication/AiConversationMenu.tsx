/**
 * One menu per conversation, instead of five icons on hover.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 *
 * The row used to reveal five 12px icon buttons on hover: move, pin,
 * rename, archive, delete. Five competing targets in a narrow rail, each
 * identified only by a tooltip, with Delete adjacent to Archive — which is
 * the arrangement where a mis-click is destructive. They are all here now,
 * behind one `···`.
 *
 * Move to project is the item that prompted this. It existed, as a folder
 * icon among the five, and was not discoverable: nothing on screen said
 * "project", and the control that did the moving looked like the control
 * that filtered. It is now a named item that opens the list of projects.
 *
 * ── What it is, now ────────────────────────────────────────────────────
 *
 * The items, and the Move view. Open and closed, the arrow keys, Escape,
 * Tab, the outside press and where focus goes live in `AiRowMenu`, which
 * the project row uses as well — it had three bare hover icons and the
 * layout shift that goes with revealing them, and copying this behaviour
 * into it was not an option worth taking twice. The shell's own note says
 * what it does.
 *
 * ArrowLeft is this menu's, because only this menu has a second view: it
 * backs out of Move and puts focus on the first root item.
 *
 * ── What it does not do ─────────────────────────────────────────────────
 *
 * It does not delete. Delete asks the host to open its confirmation dialog,
 * which is the app's own `ConfirmDialog` and is the only thing that calls
 * through. A menu item that deletes on click is one keystroke from losing a
 * conversation.
 */
import { useState } from 'react'
import {
  Pencil, FolderInput, Pin, PinOff, Archive, ArchiveRestore,
  Trash2, Folder, Check, ArrowLeft, X,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { AIProjectFolder } from '../../lib/ai/folders'
import { AiRowMenu, Item } from './AiRowMenu'

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
  const [view, setView] = useState<View>('root')

  const label = title || 'Untitled conversation'

  /* The control appears only where there is somewhere to move to. An enabled
     item that does nothing is worse than an absent one. */
  const canMove = !!onMove && (folders.length > 0 || folderId !== null)

  return (
    <AiRowMenu
      testId={`ai-conv-menu-${conversationId}`}
      panelTestId={`ai-conv-menu-panel-${conversationId}`}
      label={label}
      className={className}
      refocusKey={view}
      /* Every open starts at the root, and so does every close: a menu that
         reopens on the project list the reader backed out of last time is
         showing them a state they did not ask for. */
      onOpenChange={() => setView('root')}
      onKeyDown={(e, api) => {
        if (e.key !== 'ArrowLeft' || view !== 'move') return false
        e.preventDefault()
        setView('root')
        api.focusFirstItem()
        return true
      }}
    >
      {api => (view === 'root' ? (
        <>
          <Item icon={Pencil} onPick={() => { api.close(false); onRename() }}>
            Rename
          </Item>

          {canMove && (
            <Item
              icon={FolderInput}
              testId={`ai-move-${conversationId}`}
              onPick={() => { setView('move'); api.focusFirstItem() }}
            >
              Move to project
            </Item>
          )}

          {onTogglePin && (
            <Item icon={isPinned ? PinOff : Pin} onPick={() => { api.close(false); onTogglePin() }}>
              {isPinned ? 'Unpin' : 'Pin'}
            </Item>
          )}

          {isArchived
            ? onUnarchive && (
              <Item icon={ArchiveRestore} onPick={() => { api.close(false); onUnarchive() }}>
                Restore
              </Item>
            )
            : onArchive && (
              <Item icon={Archive} onPick={() => { api.close(false); onArchive() }}>
                Archive
              </Item>
            )}

          <div className="my-1 border-t border-gray-100 dark:border-gray-700" />

          {/* Asks the host to confirm. Nothing here deletes. */}
          <Item icon={Trash2} danger onPick={() => { api.close(false); onRequestDelete() }}>
            Delete
          </Item>
        </>
      ) : (
        <>
          <button
            type="button"
            data-menu-item
            role="menuitem"
            onClick={() => { setView('root'); api.focusFirstItem() }}
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
                onClick={() => { api.close(false); if (!here) onMove?.(f.id) }}
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
                onClick={() => { api.close(false); onMove?.(null) }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm
                           text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
              >
                <X className="h-3.5 w-3.5 shrink-0 text-gray-400" aria-hidden="true" />
                Remove from project
              </button>
            </>
          )}
        </>
      ))}
    </AiRowMenu>
  )
}
