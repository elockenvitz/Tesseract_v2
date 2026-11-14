/**
 * One menu per project, instead of three icons that resize the row.
 *
 * ── What it replaces ────────────────────────────────────────────────────
 *
 * Rename, Archive and Delete as three 12px icon buttons inside
 * `hidden group-hover:flex`. Two problems, and the second is the one the
 * reader reported:
 *
 *   it was not the pattern  The conversation row next to it had already
 *                           been reduced to a single `···`, for reasons
 *                           that apply identically here -- small targets
 *                           told apart by a tooltip, with Delete beside
 *                           Archive.
 *
 *   it moved the row        `display: none` -> `display: flex` adds the
 *                           three buttons' width to a flex row. The
 *                           project name beside them is `flex-1 truncate`,
 *                           so it got narrower, its text re-truncated, and
 *                           the count after them slid left -- every time
 *                           the pointer crossed the row. Hover feedback has
 *                           to be colour, background or icon visibility
 *                           inside space that was already reserved.
 *
 * The row now keeps this menu in the tree at all times and animates only
 * its opacity, so nothing reflows. See `FolderRow` in `AIConversationList`.
 *
 * ── What it does not do ─────────────────────────────────────────────────
 *
 * It does not delete, and it does not rename. Delete asks the host for the
 * app's own `ConfirmDialog`, which has to say that a project's conversations
 * survive it (`folder_id` is ON DELETE SET NULL). Rename puts the row into
 * its inline edit, where the name is replaced in place.
 */
import { Pencil, Archive, Trash2 } from 'lucide-react'
import { AiRowMenu, Item } from './AiRowMenu'

export function AiFolderMenu({
  folderId, name, onRename, onArchive, onRequestDelete, className,
}: {
  folderId: string
  name: string
  /** Opens the row's inline rename. */
  onRename?: () => void
  onArchive?: () => void
  onRequestDelete?: () => void
  className?: string
}) {
  return (
    <AiRowMenu
      testId={`ai-folder-menu-${folderId}`}
      panelTestId={`ai-folder-menu-panel-${folderId}`}
      label={name}
      width="w-44"
      className={className}
    >
      {api => (
        <>
          {onRename && (
            <Item icon={Pencil} onPick={() => { api.close(false); onRename() }}>
              Rename
            </Item>
          )}

          {onArchive && (
            <Item icon={Archive} onPick={() => { api.close(false); onArchive() }}>
              Archive
            </Item>
          )}

          {onRequestDelete && (
            <>
              {(onRename || onArchive) && (
                <div className="my-1 border-t border-gray-100 dark:border-gray-700" />
              )}
              {/* Asks the host to confirm. Nothing here deletes. */}
              <Item icon={Trash2} danger onPick={() => { api.close(false); onRequestDelete() }}>
                Delete
              </Item>
            </>
          )}
        </>
      )}
    </AiRowMenu>
  )
}
