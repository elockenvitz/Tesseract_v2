import { useState, useMemo, useEffect, useRef } from 'react'
import {
  Plus, Pin, PinOff, Archive, ArchiveRestore, Trash2, Pencil, MessageSquare, Search, X, Tag,
  Folder, FolderOpen, FolderInput, ChevronRight, Check,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { AIConversationSummary, TagRef } from '../../hooks/useAI'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import {
  UNFILED, folderCounts, folderDeletionWarning, validateFolderName,
  type AIProjectFolder, type FolderSelection,
} from '../../lib/ai/folders'
import {
  groupConversations, filterConversations, archiveEmptyReason,
  type ConversationFilter,
} from '../../lib/ai/conversation-filter'

interface Props {
  /*
    The summary, not the full row: this list renders titles, pins, tags and
    dates and has never read a transcript. Asking for `AIConversation` here is
    what let the sidebar query fetch up to two hundred of them — the prop type
    was the only thing claiming they were needed.
  */
  conversations: AIConversationSummary[]
  activeConversationId: string | null
  onSelect: (id: string) => void
  onNewConversation: () => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onDelete: (id: string) => void
  isLoading: boolean
  // When true, the list fills its parent's width (used for the compact
  // "screen-takeover" mode in the right pane). Default false uses w-60.
  fullWidth?: boolean
  // Map of `${tag.type}:${tag.id}` → display name (e.g. "AAPL"). Used to
  // render tag chips on each conversation row + filter chips at top.
  tagLabels?: Record<string, string>

  /* ─── Project folders ────────────────────────────────────────────────────
     All optional. The list predates folders and still renders without them,
     so a surface that has not been wired yet loses the rail and keeps
     everything else rather than crashing or showing dead controls. */
  folders?: AIProjectFolder[]
  archivedFolders?: AIProjectFolder[]
  /** null = every conversation; UNFILED = the ones on no shelf. */
  activeFolderId?: FolderSelection
  onSelectFolder?: (selection: FolderSelection) => void
  onCreateFolder?: (name: string) => void | Promise<unknown>
  onRenameFolder?: (id: string, name: string) => void
  onArchiveFolder?: (id: string, archived: boolean) => void
  onDeleteFolder?: (id: string) => void
  onMoveConversation?: (id: string, folderId: string | null) => void
  /** A rejection in the reader's words, from the folder hook. */
  folderError?: string | null

  /* ─── Archived conversations ─────────────────────────────────────────────
     Archiving was one-way in practice: the sidebar query filters
     `is_archived = false`, so an archived thread was reachable by id and by
     nothing a reader could click. These three props are the way back. */
  archivedConversations?: AIConversationSummary[]
  /** Fetched on first disclosure, not on mount: most readers never look. */
  onLoadArchived?: () => void | Promise<unknown>
  onUnarchive?: (id: string) => void
}

function tagKey(t: TagRef): string {
  return `${t.type}:${t.id}`
}

export function AIConversationList({
  conversations,
  activeConversationId,
  onSelect,
  onNewConversation,
  onRename,
  onArchive,
  onTogglePin,
  onDelete,
  isLoading,
  fullWidth = false,
  tagLabels = {},
  folders,
  archivedFolders = [],
  activeFolderId = null,
  onSelectFolder,
  onCreateFolder,
  onRenameFolder,
  onArchiveFolder,
  onDeleteFolder,
  onMoveConversation,
  folderError = null,
  archivedConversations,
  onLoadArchived,
  onUnarchive,
}: Props) {
  const [query, setQuery] = useState('')
  const [showArchivedThreads, setShowArchivedThreads] = useState(false)
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  // App-native delete confirmation — replaces window.confirm so the
  // modal matches the rest of the product visually + is testable.
  const [deletePrompt, setDeletePrompt] = useState<{ id: string; title: string } | null>(null)
  const [folderDeletePrompt, setFolderDeletePrompt] = useState<{ id: string; name: string } | null>(null)

  /* The rail only exists when a host wired it. `folders` being undefined and
     being empty are different: the first means "this surface has no folders
     feature", the second means "you have no folders yet", and the second one
     still needs the New folder control. */
  const hasFolders = Array.isArray(folders)
  const folderList = folders ?? []

  /*
   * The reference chips, over live AND archived threads.
   *
   * The row used to be built from the live list alone, which made the
   * archive's reference filter unusable in the one case it matters: a
   * reference carried only by threads you have archived had no chip, so
   * there was nothing to press to find them. The archive is counted here
   * once it has been loaded -- which, since searching now loads it, is
   * whenever the reader is actually looking for something.
   *
   * The count is across both, because it answers "how many of my
   * conversations were about this", and a reader who archived four of five
   * AAPL threads is not helped by being told there is one.
   */
  const tagFilterChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of [...conversations, ...(archivedConversations ?? [])]) {
      for (const t of (c.tags || [])) {
        const k = tagKey(t)
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }))
  }, [conversations, archivedConversations])

  /* Counted from the conversations the reader can actually see, so the number
     beside a folder is a number they can reach. */
  const counts = useMemo(() => folderCounts(conversations), [conversations])

  /*
   * One filter, both lists.
   *
   * The live list and the archive below it are filtered by the same three
   * criteria through the same function, so a thread cannot be findable in
   * one and invisible in the other. See `lib/ai/conversation-filter` for why
   * that used to be two implementations and what it cost.
   */
  const filter: ConversationFilter = useMemo(
    () => ({ query, folder: activeFolderId, tag: activeTagFilter, foldersEnabled: hasFolders }),
    [query, activeFolderId, activeTagFilter, hasFolders],
  )

  const groups = useMemo(
    () => groupConversations(conversations, filter),
    [conversations, filter],
  )

  const archivedShown = useMemo(
    () => (archivedConversations ? filterConversations(archivedConversations, filter) : undefined),
    [archivedConversations, filter],
  )

  /*
   * Searching reaches the archive without the reader knowing to look there.
   *
   * The archive is fetched on first disclosure, which was fine while it was
   * a shelf you went to deliberately. It is not fine for search: a reader
   * who types the name of a thread they archived last week would see "no
   * conversations" and a collapsed row that could not even show a count,
   * because nothing had been loaded to count. So typing loads it, and if the
   * live list has nothing while the archive has something, the archive opens
   * itself -- once, and never closing a disclosure the reader opened.
   */
  const searching = query.trim().length > 0
  useEffect(() => {
    if (searching && archivedConversations === undefined) void onLoadArchived?.()
  }, [searching, archivedConversations, onLoadArchived])

  const totalShown = groups.pinned.length + groups.rest.length

  useEffect(() => {
    if (searching && totalShown === 0 && (archivedShown?.length ?? 0) > 0) {
      setShowArchivedThreads(true)
    }
  }, [searching, totalShown, archivedShown])
  const selectedFolderName = activeFolderId && activeFolderId !== UNFILED
    ? folderList.find(f => f.id === activeFolderId)?.name ?? null
    : null

  return (
    <div className={clsx(
      'flex flex-col h-full border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40',
      fullWidth ? 'w-full' : 'w-60',
    )}>
      {/* Header — new conversation button + search */}
      <div className="p-2 border-b border-gray-200 dark:border-gray-700 space-y-2">
        <button
          type="button"
          onClick={onNewConversation}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm font-medium
                     text-primary-700 dark:text-primary-300
                     bg-white dark:bg-gray-800 hover:bg-primary-50 dark:hover:bg-gray-700
                     border border-primary-200 dark:border-primary-800 rounded-md transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New conversation
        </button>
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
          <input
            type="search"
            placeholder="Search conversations…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-7 pr-7 py-1.5 text-sm bg-white dark:bg-gray-800
                       border border-gray-200 dark:border-gray-700 rounded-md
                       placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary-400"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              title="Clear search"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {hasFolders && (
        <FolderRail
          folders={folderList}
          archivedFolders={archivedFolders}
          counts={counts}
          total={conversations.length}
          activeFolderId={activeFolderId}
          error={folderError}
          onSelectFolder={onSelectFolder}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onArchiveFolder={onArchiveFolder}
          onRequestDeleteFolder={(id, name) => setFolderDeletePrompt({ id, name })}
        />
      )}

      {/* Tag filter chips — click to scope the list to one tag at a time. */}
      {tagFilterChips.length > 0 && (
        <div className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-1">
          {activeTagFilter && (
            <button
              type="button"
              onClick={() => setActiveTagFilter(null)}
              className="text-[11px] px-2 py-0.5 rounded-full font-medium
                         bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300
                         hover:bg-gray-300 dark:hover:bg-gray-600"
            >
              Clear ✕
            </button>
          )}
          {tagFilterChips.slice(0, 12).map(({ key, count }) => {
            const label = tagLabels[key] || key.split(':')[1].slice(0, 6)
            const isActive = activeTagFilter === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTagFilter(isActive ? null : key)}
                className={clsx(
                  'text-[11px] px-2 py-0.5 rounded-full font-medium transition-colors',
                  isActive
                    ? 'bg-primary-600 text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 border border-gray-200 dark:border-gray-700 hover:border-primary-400',
                )}
                title={label}
              >
                {label} <span className="opacity-60">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1" data-testid="ai-conversation-list">
        {isLoading && conversations.length === 0 ? (
          <div className="p-4 text-xs text-gray-400 italic">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-xs text-gray-400 italic">
            No saved conversations yet. Send a message to start one.
          </div>
        ) : totalShown === 0 ? (
          <div className="p-4 text-xs text-gray-400 italic" data-testid="ai-conversation-empty">
            {/* Named, so the empty state tells the reader WHICH shelf is empty
                rather than implying they have nothing. */}
            {selectedFolderName
              ? `Nothing is filed in ${selectedFolderName} yet.`
              : activeFolderId === UNFILED
                ? 'Every conversation is filed in a folder.'
                : 'No conversations match the current filter.'}
          </div>
        ) : (
          <>
            {groups.pinned.length > 0 && (
              <Group label="Pinned" items={groups.pinned}
                activeId={activeConversationId}
                tagLabels={tagLabels}
                folders={folderList}
                onMoveConversation={onMoveConversation}
                onSelect={onSelect} onRename={onRename} onArchive={onArchive}
                onTogglePin={onTogglePin}
                onRequestDelete={(id, title) => setDeletePrompt({ id, title })} />
            )}
            {groups.rest.length > 0 && (
              <Group label="Recent" items={groups.rest}
                activeId={activeConversationId}
                tagLabels={tagLabels}
                folders={folderList}
                onMoveConversation={onMoveConversation}
                onSelect={onSelect} onRename={onRename} onArchive={onArchive}
                onTogglePin={onTogglePin}
                onRequestDelete={(id, title) => setDeletePrompt({ id, title })} />
            )}
          </>
        )}
      </div>

      {onLoadArchived && (
        <div className="border-t border-gray-200 px-1 py-1 dark:border-gray-700">
          <button
            type="button"
            data-testid="ai-archived-toggle"
            aria-expanded={showArchivedThreads}
            onClick={() => {
              const next = !showArchivedThreads
              setShowArchivedThreads(next)
              /* Fetched when asked for. Archived threads are the minority
                 case and most readers never open this. */
              if (next) void onLoadArchived()
            }}
            className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ChevronRight className={clsx('w-3 h-3 transition-transform', showArchivedThreads && 'rotate-90')} />
            Archived conversations
            {/* The count is what the filters leave, out of what is archived,
                so a reader can tell a narrowed list from an empty archive
                without opening it. */}
            {archivedShown && archivedConversations
              ? archivedShown.length === archivedConversations.length
                ? ` (${archivedConversations.length})`
                : ` (${archivedShown.length} of ${archivedConversations.length})`
              : ''}
          </button>
          {showArchivedThreads && (
            <ul data-testid="ai-archived-list" className="max-h-40 overflow-y-auto">
              {!archivedConversations || !archivedShown ? (
                <li className="px-2 py-1 text-[11px] italic text-gray-400">Loading…</li>
              ) : archivedShown.length === 0 ? (
                <li
                  className="px-2 py-1 text-[11px] italic text-gray-400"
                  data-testid="ai-archived-empty"
                >
                  {archiveEmptyReason(archivedConversations.length, filter)}
                </li>
              ) : (
                archivedShown.map(c => (
                  <li key={c.id} className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-gray-600 dark:text-gray-300">
                    <Archive className="w-3 h-3 shrink-0 text-gray-400" />
                    <span className="flex-1 truncate" title={c.title || 'Untitled conversation'}>
                      {c.title || 'Untitled conversation'}
                    </span>
                    {onUnarchive && (
                      <IconBtn
                        title={`Restore ${c.title || 'Untitled conversation'}`}
                        onClick={() => onUnarchive(c.id)}
                      >
                        <ArchiveRestore className="w-3 h-3" />
                      </IconBtn>
                    )}
                    <IconBtn
                      title={`Delete ${c.title || 'Untitled conversation'}`}
                      variant="danger"
                      onClick={() => setDeletePrompt({ id: c.id, title: c.title || '' })}
                    >
                      <Trash2 className="w-3 h-3" />
                    </IconBtn>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={!!deletePrompt}
        onClose={() => setDeletePrompt(null)}
        onConfirm={() => {
          if (deletePrompt) onDelete(deletePrompt.id)
          setDeletePrompt(null)
        }}
        title="Delete conversation"
        message={
          deletePrompt
            ? `Delete "${deletePrompt.title || 'Untitled conversation'}"? This can't be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Cancel"
        variant="danger"
      />

      {/* Deleting a shelf is not deleting what is on it, and the message says
          the count so "delete" beside a list of threads cannot be read as
          deleting the threads. */}
      <ConfirmDialog
        isOpen={!!folderDeletePrompt}
        onClose={() => setFolderDeletePrompt(null)}
        onConfirm={() => {
          if (folderDeletePrompt) {
            onDeleteFolder?.(folderDeletePrompt.id)
            if (activeFolderId === folderDeletePrompt.id) onSelectFolder?.(null)
          }
          setFolderDeletePrompt(null)
        }}
        title="Delete folder"
        message={
          folderDeletePrompt
            ? folderDeletionWarning(
              folderDeletePrompt.name,
              counts.get(folderDeletePrompt.id) ?? 0,
            )
            : ''
        }
        confirmText="Delete folder"
        cancelText="Cancel"
        variant="danger"
      />
    </div>
  )
}

// ─── The folder rail ────────────────────────────────────────────────────────

/**
 * The shelves, above the threads.
 *
 * Flat on purpose. A nested tree is the obvious shape and the wrong one at
 * this width: it costs a disclosure triangle per level and buys an
 * organization nobody asked for. One level, counted, with "All" and
 * "Unfiled" as the two rows that always exist.
 */
function FolderRail({
  folders, archivedFolders, counts, total, activeFolderId, error,
  onSelectFolder, onCreateFolder, onRenameFolder, onArchiveFolder, onRequestDeleteFolder,
}: {
  folders: AIProjectFolder[]
  archivedFolders: AIProjectFolder[]
  counts: Map<string, number>
  total: number
  activeFolderId: FolderSelection
  error: string | null
  onSelectFolder?: (selection: FolderSelection) => void
  onCreateFolder?: (name: string) => void | Promise<unknown>
  onRenameFolder?: (id: string, name: string) => void
  onArchiveFolder?: (id: string, archived: boolean) => void
  onRequestDeleteFolder: (id: string, name: string) => void
}) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const createRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (creating) createRef.current?.focus()
  }, [creating])

  const commitCreate = () => {
    /* Validated here as well as in the hook: the reader gets the sentence
       before the round trip, and the database stays the authority. */
    const verdict = validateFolderName(draft, folders)
    if (!verdict.ok) {
      setLocalError(verdict.message)
      return
    }
    setLocalError(null)
    setDraft('')
    setCreating(false)
    void onCreateFolder?.(verdict.name)
  }

  return (
    <div className="border-b border-gray-200 dark:border-gray-700 px-1 py-1.5" data-testid="ai-folder-rail">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
          Folders
        </span>
        <button
          type="button"
          data-testid="ai-folder-new"
          onClick={() => { setCreating(c => !c); setLocalError(null) }}
          className="p-0.5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          title="New folder"
          aria-label="New folder"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {creating && (
        <div className="px-2 pb-1.5">
          <input
            ref={createRef}
            value={draft}
            placeholder="Folder name"
            data-testid="ai-folder-name-input"
            onChange={e => { setDraft(e.target.value); setLocalError(null) }}
            onKeyDown={e => {
              if (e.key === 'Enter') commitCreate()
              if (e.key === 'Escape') { setCreating(false); setDraft(''); setLocalError(null) }
            }}
            className="w-full px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-primary-300 dark:border-primary-700 rounded outline-none"
          />
        </div>
      )}

      {(localError || error) && (
        <p className="px-2 pb-1 text-[11px] text-red-600 dark:text-red-400" data-testid="ai-folder-error">
          {localError || error}
        </p>
      )}

      <ul>
        <FolderRow
          label="All conversations"
          count={total}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
          isActive={activeFolderId === null}
          onSelect={() => onSelectFolder?.(null)}
        />
        {folders.map(f => (
          <FolderRow
            key={f.id}
            label={f.name}
            count={counts.get(f.id) ?? 0}
            icon={activeFolderId === f.id
              ? <FolderOpen className="w-3.5 h-3.5" />
              : <Folder className="w-3.5 h-3.5" />}
            isActive={activeFolderId === f.id}
            onSelect={() => onSelectFolder?.(f.id)}
            onRename={onRenameFolder ? (name) => onRenameFolder(f.id, name) : undefined}
            onArchive={onArchiveFolder ? () => onArchiveFolder(f.id, true) : undefined}
            onDelete={() => onRequestDeleteFolder(f.id, f.name)}
          />
        ))}
        <FolderRow
          label="Unfiled"
          count={counts.get(UNFILED) ?? 0}
          icon={<Folder className="w-3.5 h-3.5 opacity-50" />}
          isActive={activeFolderId === UNFILED}
          onSelect={() => onSelectFolder?.(UNFILED)}
        />
      </ul>

      {archivedFolders.length > 0 && (
        <div className="mt-1">
          <button
            type="button"
            data-testid="ai-folder-archived-toggle"
            aria-expanded={showArchived}
            onClick={() => setShowArchived(s => !s)}
            className="w-full flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ChevronRight className={clsx('w-3 h-3 transition-transform', showArchived && 'rotate-90')} />
            Archived folders ({archivedFolders.length})
          </button>
          {showArchived && (
            <ul data-testid="ai-folder-archived">
              {archivedFolders.map(f => (
                <li key={f.id} className="flex items-center gap-1.5 px-2 py-1 text-[12px] text-gray-500 dark:text-gray-400">
                  <Archive className="w-3 h-3 shrink-0" />
                  <span className="flex-1 truncate" title={f.name}>{f.name}</span>
                  <span className="shrink-0 tabular-nums opacity-70">{counts.get(f.id) ?? 0}</span>
                  {onArchiveFolder && (
                    <button
                      type="button"
                      title={`Restore ${f.name}`}
                      aria-label={`Restore ${f.name}`}
                      onClick={() => onArchiveFolder(f.id, false)}
                      className="p-0.5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
                    >
                      <ArchiveRestore className="w-3 h-3" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

function FolderRow({
  label, count, icon, isActive, onSelect, onRename, onArchive, onDelete,
}: {
  label: string
  count: number
  icon: React.ReactNode
  isActive: boolean
  onSelect: () => void
  onRename?: (name: string) => void
  onArchive?: () => void
  onDelete?: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== label) onRename?.(next)
    else setDraft(label)
  }

  return (
    <li>
      <div
        data-slot="ai-folder-row"
        data-folder-active={isActive || undefined}
        onClick={() => !editing && onSelect()}
        className={clsx(
          'group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-[12px] transition-colors',
          isActive
            ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-100'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
        )}
      >
        <span className={clsx('shrink-0', isActive ? 'text-primary-600 dark:text-primary-300' : 'text-gray-400')}>
          {icon}
        </span>
        {editing ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={e => {
              if (e.key === 'Enter') commit()
              if (e.key === 'Escape') { setEditing(false); setDraft(label) }
            }}
            onClick={e => e.stopPropagation()}
            className="flex-1 min-w-0 px-1 text-[12px] rounded border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-900 outline-none"
          />
        ) : (
          <span className="flex-1 truncate" title={label}>{label}</span>
        )}
        {!editing && (
          <>
            <span className="shrink-0 tabular-nums text-[11px] opacity-60">{count}</span>
            {(onRename || onArchive || onDelete) && (
              <span className="hidden group-hover:flex items-center gap-0.5">
                {onRename && (
                  <IconBtn title={`Rename ${label}`} onClick={() => { setDraft(label); setEditing(true) }}>
                    <Pencil className="w-3 h-3" />
                  </IconBtn>
                )}
                {onArchive && (
                  <IconBtn title={`Archive ${label}`} onClick={onArchive}>
                    <Archive className="w-3 h-3" />
                  </IconBtn>
                )}
                {onDelete && (
                  <IconBtn title={`Delete ${label}`} variant="danger" onClick={onDelete}>
                    <Trash2 className="w-3 h-3" />
                  </IconBtn>
                )}
              </span>
            )}
          </>
        )}
      </div>
    </li>
  )
}

// ─── Group of conversation items ────────────────────────────────────────────

function Group({
  label, items, activeId, tagLabels, folders, onMoveConversation,
  onSelect, onRename, onArchive, onTogglePin, onRequestDelete,
}: {
  label: string
  items: AIConversationSummary[]
  activeId: string | null
  tagLabels: Record<string, string>
  folders: AIProjectFolder[]
  onMoveConversation?: (id: string, folderId: string | null) => void
  onSelect: (id: string) => void
  onRename: (id: string, title: string) => void
  onArchive: (id: string) => void
  onTogglePin: (id: string, pinned: boolean) => void
  onRequestDelete: (id: string, title: string) => void
}) {
  return (
    <div className="mb-2">
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </div>
      <ul>
        {items.map(c => (
          <ConversationItem
            key={c.id}
            conversation={c}
            tagLabels={tagLabels}
            folders={folders}
            isActive={c.id === activeId}
            onSelect={() => onSelect(c.id)}
            onRename={(title) => onRename(c.id, title)}
            onArchive={() => onArchive(c.id)}
            onTogglePin={() => onTogglePin(c.id, !c.is_pinned)}
            onMove={onMoveConversation ? (folderId) => onMoveConversation(c.id, folderId) : undefined}
            onRequestDelete={() => onRequestDelete(c.id, c.title || '')}
          />
        ))}
      </ul>
    </div>
  )
}

// ─── A single conversation row ──────────────────────────────────────────────

function ConversationItem({
  conversation, tagLabels, folders, isActive,
  onSelect, onRename, onArchive, onTogglePin, onMove, onRequestDelete,
}: {
  conversation: AIConversationSummary
  tagLabels: Record<string, string>
  folders: AIProjectFolder[]
  isActive: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onArchive: () => void
  onTogglePin: () => void
  onMove?: (folderId: string | null) => void
  onRequestDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(conversation.title || '')
  const [moving, setMoving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const lastIso = conversation.last_message_at || conversation.updated_at
  const ago = lastIso ? formatRelative(lastIso) : ''

  const commitRename = () => {
    setEditing(false)
    const next = draft.trim()
    if (next && next !== conversation.title) onRename(next)
    else setDraft(conversation.title || '')
  }

  // Build a single tag-summary string for the hover tooltip — keeps the
  // row compact while still letting users see which assets/portfolios a
  // conversation is about by hovering the Tag icon.
  const tagSummary = (conversation.tags || [])
    .map(t => `${t.type}: ${tagLabels[tagKey(t)] || t.id.slice(0, 6)}`)
    .join('\n')
  const tagCount = (conversation.tags || []).length
  const currentFolderId = conversation.folder_id ?? null
  /* The control appears only when there is somewhere to move it to: a reader
     with no folders and a thread already unfiled has no move to make, and an
     enabled button that does nothing is worse than no button. */
  const canMove = !!onMove && (folders.length > 0 || currentFolderId !== null)

  return (
    <li>
      <div
        className={clsx(
          'group flex flex-col px-3 py-1.5 cursor-pointer transition-colors',
          isActive
            ? 'bg-primary-100 dark:bg-primary-900/30 text-primary-900 dark:text-primary-100'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-800 dark:text-gray-200',
        )}
        onClick={() => !editing && onSelect()}
      >
        {/* Title row — full width, never blocked by buttons. */}
        <div className="flex items-start gap-2 min-w-0">
          <MessageSquare className={clsx(
            'w-3.5 h-3.5 mt-0.5 shrink-0',
            isActive ? 'text-primary-600 dark:text-primary-300' : 'text-gray-400',
          )} />
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') { setEditing(false); setDraft(conversation.title || '') }
              }}
              onClick={e => e.stopPropagation()}
              className="flex-1 text-sm px-1 py-0 rounded border border-primary-300 dark:border-primary-700 bg-white dark:bg-gray-900 outline-none"
            />
          ) : (
            <div className="flex-1 text-sm truncate" title={conversation.title || 'Untitled conversation'}>
              {conversation.title || 'Untitled conversation'}
            </div>
          )}
        </div>

        {/* Bottom row — timestamp + tag indicator + (on hover) action buttons.
            Keeps actions out of the title's horizontal space entirely. */}
        <div className="flex items-center gap-1.5 mt-0.5 ml-[22px] text-[10px] text-gray-500 dark:text-gray-400 min-h-[18px]">
          <span className="shrink-0">{ago}</span>
          {tagCount > 0 && (
            <button
              type="button"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-0.5 px-1 py-0 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400"
              title={tagSummary}
              aria-label={`${tagCount} tag${tagCount === 1 ? '' : 's'} — hover to see`}
            >
              <Tag className="w-3 h-3" />
              <span className="text-[10px]">{tagCount}</span>
            </button>
          )}
          {!editing && (
            <div className="ml-auto opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
              {canMove && (
                <IconBtn
                  title="Move to folder"
                  testId={`ai-move-${conversation.id}`}
                  onClick={() => setMoving(m => !m)}
                >
                  <FolderInput className="w-3 h-3" />
                </IconBtn>
              )}
              <IconBtn title={conversation.is_pinned ? 'Unpin' : 'Pin'} onClick={onTogglePin}>
                {conversation.is_pinned ? <PinOff className="w-3 h-3" /> : <Pin className="w-3 h-3" />}
              </IconBtn>
              <IconBtn title="Rename" onClick={() => { setDraft(conversation.title || ''); setEditing(true) }}>
                <Pencil className="w-3 h-3" />
              </IconBtn>
              <IconBtn title="Archive" onClick={onArchive}>
                <Archive className="w-3 h-3" />
              </IconBtn>
              <IconBtn title="Delete" variant="danger" onClick={onRequestDelete}>
                <Trash2 className="w-3 h-3" />
              </IconBtn>
            </div>
          )}
        </div>

        {moving && canMove && (
          <div
            data-testid={`ai-move-menu-${conversation.id}`}
            onClick={e => e.stopPropagation()}
            className="ml-[22px] mt-1 rounded border border-gray-200 bg-white py-1 shadow-sm dark:border-gray-700 dark:bg-gray-900"
          >
            <p className="px-2 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              Move to
            </p>
            {folders.map(f => (
              <button
                key={f.id}
                type="button"
                data-slot="ai-move-option"
                onClick={() => { setMoving(false); if (f.id !== currentFolderId) onMove?.(f.id) }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                {f.id === currentFolderId
                  ? <Check className="w-3 h-3 shrink-0 text-primary-600" />
                  : <Folder className="w-3 h-3 shrink-0 text-gray-400" />}
                <span className="truncate">{f.name}</span>
              </button>
            ))}
            {currentFolderId !== null && (
              <button
                type="button"
                data-slot="ai-move-option"
                data-testid={`ai-unfile-${conversation.id}`}
                onClick={() => { setMoving(false); onMove?.(null) }}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <X className="w-3 h-3 shrink-0 text-gray-400" />
                Remove from folder
              </button>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function IconBtn({
  children, onClick, title, variant, testId,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  variant?: 'danger'
  testId?: string
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      data-testid={testId}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={clsx(
        'p-1 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700',
        variant === 'danger'
          ? 'hover:text-red-600 dark:hover:text-red-400'
          : 'hover:text-gray-700 dark:hover:text-gray-200',
      )}
    >
      {children}
    </button>
  )
}

function formatRelative(iso: string): string {
  const t = new Date(iso).getTime()
  const ago = Math.floor((Date.now() - t) / 60000)
  if (ago < 1)    return 'just now'
  if (ago < 60)   return `${ago}m ago`
  if (ago < 1440) return `${Math.floor(ago / 60)}h ago`
  if (ago < 10080) return `${Math.floor(ago / 1440)}d ago`
  return new Date(iso).toLocaleDateString()
}
