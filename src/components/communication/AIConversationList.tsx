import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import {
  Plus, Archive, ArchiveRestore, Trash2, Pencil, MessageSquare, Search, X, Tag,
  Folder, FolderOpen, ChevronRight,
} from 'lucide-react'
import { clsx } from 'clsx'
import type { AIConversationSummary, TagRef } from '../../hooks/useAI'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { AiConversationMenu } from './AiConversationMenu'
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
  /**
   * Start a thread. The project id is passed when the reader started it from
   * inside a project, and the thread is filed there when it is first saved.
   */
  onNewConversation: (folderId?: string | null) => void
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
  /* Memoised because the tree's per-project grouping depends on it, and a
     fresh `[]` every render would rebuild that grouping every render. */
  const folderList = useMemo(() => folders ?? [], [folders])

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
   * ── Projects now CONTAIN their conversations ────────────────────────────
   *
   * This rail was flat on purpose, and said so: "a nested tree is the
   * obvious shape and the wrong one at this width". That judgement has been
   * overruled by the product owner, who could not tell from a flat filter
   * which project a thread was in or how to put it in one -- which is a
   * fair complaint about a rail where selecting a project and filing into
   * one looked identical.
   *
   * So the folder row is a disclosure, and its conversations are nested
   * under it. Expansion is view state and is deliberately NOT persisted:
   * a reader's open projects are not a document, and restoring a tree from
   * a previous session is a surprise, not a convenience.
   */
  const [expandedFolders, setExpandedFolders] = useState<ReadonlySet<string>>(new Set())

  const toggleFolder = useCallback((id: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  /*
   * A project opens itself when it holds the open conversation.
   *
   * Without this, selecting a thread from search and then clearing the
   * search left the reader looking at a collapsed project with no sign of
   * where the thread they are reading lives. It only ever opens: collapsing
   * a project the reader opened by hand would be the surprise above.
   */
  const activeFolderOfConversation = useMemo(() => {
    if (!activeConversationId) return null
    return conversations.find(c => c.id === activeConversationId)?.folder_id ?? null
  }, [conversations, activeConversationId])

  useEffect(() => {
    if (!activeFolderOfConversation) return
    setExpandedFolders(prev =>
      prev.has(activeFolderOfConversation) ? prev : new Set(prev).add(activeFolderOfConversation))
  }, [activeFolderOfConversation])

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

  /*
   * What each project holds, after the search and tag criteria.
   *
   * Built with the folder axis switched OFF and the grouping done here, so a
   * project's contents obey the same query and tag the flat list does
   * without the folder SELECTION narrowing them to one project. Running the
   * selection through here as well is how a nested tree ends up showing one
   * project's threads under every project's heading.
   */
  const conversationsByFolder = useMemo(() => {
    const textAndTag: ConversationFilter = { query, tag: activeTagFilter, foldersEnabled: false }
    const matched = filterConversations(conversations, textAndTag)
    const by = new Map<string, AIConversationSummary[]>()
    for (const c of matched) {
      const id = c.folder_id
      if (!id) continue
      const list = by.get(id)
      if (list) list.push(c)
      else by.set(id, [c])
    }
    /* Pinned first inside a project, same rule as the flat list. */
    for (const list of by.values()) {
      list.sort((a, b) => Number(!!b.is_pinned) - Number(!!a.is_pinned))
    }
    return by
  }, [conversations, query, activeTagFilter])

  /*
   * A search opens every project that has a hit.
   *
   * Otherwise filtering HIDES results: a reader who types the name of a
   * thread filed in a collapsed project is told nothing matches, while the
   * match sits one closed disclosure away. Search exists to reveal.
   *
   * Derived rather than written into state, so clearing the search returns
   * the tree to whatever the reader had open themselves.
   */
  const effectiveExpanded = useMemo(() => {
    const searchingOrFiltering = query.trim().length > 0 || activeTagFilter !== null
    if (!searchingOrFiltering) return expandedFolders
    const withHits = new Set(expandedFolders)
    for (const [folderId, list] of conversationsByFolder) {
      if (list.length > 0) withHits.add(folderId)
    }
    return withHits
  }, [expandedFolders, query, activeTagFilter, conversationsByFolder])

  /*
   * The list below the projects: everything the tree above does not show.
   *
   * NOT simply "unfiled". A thread whose project has been archived or
   * deleted still carries a `folder_id`, and no visible project will draw
   * it -- so filtering this list to `folder_id IS NULL` makes those threads
   * invisible in both places at once. That is how a reader loses a
   * conversation by archiving a project, and it is what the first version
   * of this change did.
   *
   * So the rule is "not inside a project the reader can currently open",
   * which is a different question from "unfiled" and the only one that
   * leaves every thread reachable.
   */
  const visibleFolderIds = useMemo(
    () => new Set(folderList.map(f => f.id)),
    [folderList],
  )

  const groups = useMemo(() => {
    const base = groupConversations(conversations, filter)
    if (!hasFolders || activeFolderId !== null) return base
    const loose = (c: AIConversationSummary) =>
      !c.folder_id || !visibleFolderIds.has(c.folder_id)
    return { pinned: base.pinned.filter(loose), rest: base.rest.filter(loose) }
  }, [conversations, filter, hasFolders, activeFolderId, visibleFolderIds])

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
          /* `onClick={onNewConversation}` would hand the MouseEvent to the
             handler as its folder id, which is now a parameter it reads.
             Called with nothing, because this is the UNFILED new thread --
             the project-scoped ones are in the rail and the project band. */
          onClick={() => onNewConversation()}
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
          expanded={effectiveExpanded}
          onToggleExpanded={toggleFolder}
          conversationsFor={conversationsByFolder}
          activeConversationId={activeConversationId}
          tagLabels={tagLabels}
          onNewConversation={onNewConversation}
          onSelectConversation={onSelect}
          onRenameConversation={onRename}
          onArchiveConversation={onArchive}
          onTogglePinConversation={onTogglePin}
          onMoveConversation={onMoveConversation}
          onRequestDeleteConversation={(id, title) => setDeletePrompt({ id, title })}
          onSelectFolder={onSelectFolder}
          onCreateFolder={onCreateFolder}
          onRenameFolder={onRenameFolder}
          onArchiveFolder={onArchiveFolder}
          onRequestDeleteFolder={(id, name) => setFolderDeletePrompt({ id, name })}
        />
      )}

      {/* Tag filter chips — click to scope the list to one tag at a time. */}
      {tagFilterChips.length > 0 && (
        <div
          data-testid="ai-tag-filters"
          className="px-2 py-1.5 border-b border-gray-200 dark:border-gray-700 flex flex-wrap gap-1"
        >
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

      {/*
        A project is somewhere you can be, not only a filter.

        With the rail alone, opening a project changed which threads were
        listed and nothing said which project that was or how to get out --
        the only clue was a highlighted row above a shorter list. This band
        is the project's identity while you are in it: its name, what it
        holds, the way to add to it, and the way back out.
      */}
      {selectedFolderName && (
        <div
          data-testid="ai-project-view"
          className="border-b border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-800/60"
        >
          <div className="flex items-center gap-1.5">
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-primary-600 dark:text-primary-300" aria-hidden="true" />
            <h3
              data-testid="ai-project-name"
              className="min-w-0 flex-1 truncate text-[13px] font-semibold text-gray-900 dark:text-white"
              title={selectedFolderName}
            >
              {selectedFolderName}
            </h3>
            <span className="shrink-0 text-[11px] tabular-nums text-gray-500 dark:text-gray-400">
              {counts.get(activeFolderId as string) ?? 0}
            </span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <button
              type="button"
              data-testid="ai-project-new-chat"
              onClick={() => onNewConversation(activeFolderId as string)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline dark:text-primary-400"
            >
              <Plus className="h-3 w-3" aria-hidden="true" />
              New conversation here
            </button>
            <button
              type="button"
              data-testid="ai-project-leave"
              onClick={() => onSelectFolder?.(null)}
              className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              All conversations
            </button>
          </div>
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
 * The projects, and the conversations inside them.
 *
 * ── A reversal, recorded ────────────────────────────────────────────────
 *
 * This was flat on purpose, and the previous version of this comment said
 * so: "a nested tree is the obvious shape and the wrong one at this width
 * -- it costs a disclosure triangle per level and buys an organization
 * nobody asked for."
 *
 * That has been overruled by the product owner, and the complaint behind it
 * is a fair one. A flat rail of shelves answers "show me one project" and
 * answers neither "which project is this thread in" nor "how do I put it in
 * one" -- and worse, SELECTING a project and FILING into one looked like the
 * same gesture on the same row. A tree answers all three by showing the
 * containment directly.
 *
 * So: one disclosure per project, its conversations nested under it, and the
 * unfiled threads in the list below. The counted flat selection still works
 * underneath -- `onSelectFolder` is unchanged -- because the existing filter
 * contract has its own suite and this is a presentation change.
 */
function FolderRail({
  folders, archivedFolders, counts, total, activeFolderId, error,
  expanded, onToggleExpanded, conversationsFor,
  activeConversationId, tagLabels, onNewConversation,
  onSelectConversation, onRenameConversation, onArchiveConversation,
  onTogglePinConversation, onMoveConversation, onRequestDeleteConversation,
  onSelectFolder, onCreateFolder, onRenameFolder, onArchiveFolder, onRequestDeleteFolder,
}: {
  folders: AIProjectFolder[]
  archivedFolders: AIProjectFolder[]
  counts: Map<string, number>
  total: number
  activeFolderId: FolderSelection
  error: string | null
  expanded: ReadonlySet<string>
  onToggleExpanded: (id: string) => void
  conversationsFor: Map<string, AIConversationSummary[]>
  activeConversationId: string | null
  tagLabels: Record<string, string>
  onNewConversation: (folderId?: string | null) => void
  onSelectConversation: (id: string) => void
  onRenameConversation: (id: string, title: string) => void
  onArchiveConversation: (id: string) => void
  onTogglePinConversation: (id: string, pinned: boolean) => void
  onMoveConversation?: (id: string, folderId: string | null) => void
  onRequestDeleteConversation: (id: string, title: string) => void
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
          Projects
        </span>
        <button
          type="button"
          data-testid="ai-folder-new"
          onClick={() => { setCreating(c => !c); setLocalError(null) }}
          className="p-0.5 rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-gray-200"
          title="New project"
          aria-label="New project"
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
        {folders.length === 0 && !creating && (
          <li
            data-testid="ai-folder-empty"
            className="px-2 py-1.5 text-[11px] italic text-gray-400 dark:text-gray-500"
          >
            No projects yet. Group related conversations with the + above.
          </li>
        )}
        {folders.map(f => {
          const isOpen = expanded.has(f.id)
          const inside = conversationsFor.get(f.id) ?? []
          return (
            <li key={f.id}>
              <FolderRow
                label={f.name}
                count={counts.get(f.id) ?? 0}
                icon={isOpen
                  ? <FolderOpen className="w-3.5 h-3.5" />
                  : <Folder className="w-3.5 h-3.5" />}
                isActive={activeFolderId === f.id}
                isExpanded={isOpen}
                /* Two acts, two controls. The name goes to the project; the
                   chevron looks inside it without leaving where you are. */
                onOpen={() => onSelectFolder?.(f.id)}
                onToggle={() => onToggleExpanded(f.id)}
                testId={`ai-folder-row-${f.id}`}
                onRename={onRenameFolder ? (name) => onRenameFolder(f.id, name) : undefined}
                onArchive={onArchiveFolder ? () => onArchiveFolder(f.id, true) : undefined}
                onDelete={() => onRequestDeleteFolder(f.id, f.name)}
              />
              {isOpen && (
                <ul data-testid={`ai-folder-threads-${f.id}`} className="ml-3 border-l border-gray-200 dark:border-gray-700">
                  {inside.length === 0 ? (
                    <li className="px-3 py-1 text-[11px] italic text-gray-400">
                      Nothing in this project yet.
                    </li>
                  ) : null}
                  {/* Starting a thread where you are looking. The alternative
                      is start-then-file, which is two gestures and a thread
                      that is briefly in the wrong place. */}
                  {onNewConversation && (
                    <li>
                      <button
                        type="button"
                        data-testid={`ai-folder-new-chat-${f.id}`}
                        onClick={() => onNewConversation(f.id)}
                        className="flex w-full items-center gap-1.5 px-3 py-1 text-[11px]
                                   text-primary-600 hover:underline dark:text-primary-400"
                      >
                        <Plus className="h-3 w-3" aria-hidden="true" />
                        New conversation in {f.name}
                      </button>
                    </li>
                  )}
                  {inside.map(c => (
                    <ConversationItem
                      key={c.id}
                      conversation={c}
                      tagLabels={tagLabels}
                      folders={folders}
                      isActive={c.id === activeConversationId}
                      onSelect={() => onSelectConversation(c.id)}
                      onRename={(title) => onRenameConversation(c.id, title)}
                      onArchive={() => onArchiveConversation(c.id)}
                      onTogglePin={() => onTogglePinConversation(c.id, !c.is_pinned)}
                      onMove={onMoveConversation ? (fid) => onMoveConversation(c.id, fid) : undefined}
                      onRequestDelete={() => onRequestDeleteConversation(c.id, c.title || '')}
                    />
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
      {/* "All conversations" is what clears a project selection. It sits
          below the tree rather than above it, because the tree is now the
          primary thing and this is an escape from a narrowed view.

          Only for a selection the project band cannot speak for -- the
          unfiled shelf. When a named project is open the band carries its own
          way out, and two controls doing one thing is how a reader stops
          trusting either. */}
      {activeFolderId === UNFILED && (
        <button
          type="button"
          data-testid="ai-folder-clear"
          onClick={() => onSelectFolder?.(null)}
          className="mt-1 flex w-full items-center gap-1.5 px-2 py-1 text-[11px] text-primary-600 hover:underline dark:text-primary-400"
        >
          <MessageSquare className="h-3 w-3" aria-hidden="true" />
          Show all conversations ({total})
        </button>
      )}

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

/**
 * One project row: a destination and a disclosure, which are not the same act.
 *
 * ── Why these were split ─────────────────────────────────────────────────
 *
 * Both the row and its chevron called one handler, so there was exactly one
 * thing a project could do and the reader had to guess which. Pressing the
 * NAME now opens the project as a place -- a view of its own, with its own
 * New conversation -- and pressing the CHEVRON expands it in the rail
 * without going anywhere. A reader can look inside a project while reading
 * a thread from another one, which a single handler made impossible.
 */
function FolderRow({
  label, count, icon, isActive, isExpanded, testId,
  onOpen, onToggle, onRename, onArchive, onDelete,
}: {
  label: string
  count: number
  icon: React.ReactNode
  isActive: boolean
  /** Undefined for a row that is not a disclosure. */
  isExpanded?: boolean
  testId?: string
  /** Go to the project. */
  onOpen: () => void
  /** Show or hide its threads in place. Undefined when it is not a tree row. */
  onToggle?: () => void
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
      <div
        data-slot="ai-folder-row"
        data-testid={testId}
        data-folder-active={isActive || undefined}
        onClick={() => !editing && onOpen()}
        className={clsx(
          'group flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer text-[12px] transition-colors',
          isActive
            ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-100'
            : 'text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800',
        )}
      >
        {/* The disclosure, when this row is one. A real button, so a project
            can be expanded from the keyboard -- which the flat rail's rows,
            being clickable divs, could not be. `stopPropagation` is what
            keeps it from also navigating: the chevron shows the contents in
            place and goes nowhere. */}
        {isExpanded !== undefined && onToggle && (
          <button
            type="button"
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${label}`}
            onClick={e => { e.stopPropagation(); onToggle() }}
            className="shrink-0 rounded text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
          >
            <ChevronRight
              className={clsx('h-3 w-3 transition-transform', isExpanded && 'rotate-90')}
              aria-hidden="true"
            />
          </button>
        )}
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
          /* A real button, for the same reason the conversation title is one:
             the row's handler is mouse-only, so without this a project could
             be expanded from the keyboard but never opened. */
          <button
            type="button"
            data-slot="ai-folder-open"
            onClick={e => { e.stopPropagation(); onOpen() }}
            aria-current={isActive || undefined}
            className="flex-1 truncate rounded text-left"
            title={`Open ${label}`}
          >
            {label}
          </button>
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
            /*
             * A real button, not a div inside a clickable row.
             *
             * Selecting a conversation was mouse-only: the row carried the
             * `onClick` and nothing in it was focusable, so a reader could
             * Tab to Rename and Archive on a thread they had no way to OPEN
             * from the keyboard. It is a sibling of those controls rather
             * than their ancestor, so the row stays valid -- a button cannot
             * contain buttons.
             *
             * The row's own `onClick` stays for the mouse, which is why this
             * does not need to fill the row.
             */
            <button
              type="button"
              onClick={e => { e.stopPropagation(); onSelect() }}
              data-testid="ai-conversation-title"
              aria-current={isActive || undefined}
              className="flex-1 truncate rounded text-left text-sm"
              title={conversation.title || 'Untitled conversation'}
            >
              {conversation.title || 'Untitled conversation'}
            </button>
          )}
        </div>

        {/* Bottom row — timestamp + tag indicator + (on hover) action buttons.
            Keeps actions out of the title's horizontal space entirely. */}
        <div className="flex items-center gap-1.5 mt-0.5 ml-[22px] text-[10px] text-gray-500 dark:text-gray-400 min-h-[18px]">
          <span className="shrink-0">{ago}</span>
          {tagCount > 0 && (
            /*
             * A label, not a button. It was a `<button>` whose only handler
             * stopped propagation, so it looked pressable, took a tab stop,
             * and did nothing at all -- the shape this file already rejects
             * two screens up ("an enabled button that does nothing is worse
             * than no button"). The tooltip and the name carry what it knows.
             */
            <span
              className="inline-flex items-center gap-0.5 px-1 py-0 text-gray-500 dark:text-gray-400"
              title={tagSummary}
              role="img"
              aria-label={`${tagCount} attached object${tagCount === 1 ? '' : 's'}: ${tagSummary.replace(/\n/g, ', ')}`}
            >
              <Tag className="w-3 h-3" aria-hidden="true" />
              <span className="text-[10px]">{tagCount}</span>
            </span>
          )}
          {!editing && (
            /*
             * One control, where five used to be.
             *
             * `focus-within` so tabbing into the row reveals it; without it
             * a keyboard reader focused an invisible button. The menu itself
             * is always in the tree so its own focus management works -- only
             * its opacity is tied to hover.
             */
            <div className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <AiConversationMenu
                conversationId={conversation.id}
                title={conversation.title || ''}
                isPinned={!!conversation.is_pinned}
                folderId={currentFolderId}
                folders={folders}
                onRename={() => { setDraft(conversation.title || ''); setEditing(true) }}
                onTogglePin={onTogglePin}
                onArchive={onArchive}
                onMove={canMove ? onMove : undefined}
                onRequestDelete={onRequestDelete}
              />
            </div>
          )}
        </div>
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
