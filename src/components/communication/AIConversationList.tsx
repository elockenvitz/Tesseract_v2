import { useState, useMemo, useEffect, useRef } from 'react'
import { Plus, Pin, PinOff, Archive, Trash2, Pencil, MessageSquare, Search, X, Tag } from 'lucide-react'
import { clsx } from 'clsx'
import type { AIConversation, TagRef } from '../../hooks/useAI'
import { ConfirmDialog } from '../ui/ConfirmDialog'

interface Props {
  conversations: AIConversation[]
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
}: Props) {
  const [query, setQuery] = useState('')
  const [activeTagFilter, setActiveTagFilter] = useState<string | null>(null)
  // App-native delete confirmation — replaces window.confirm so the
  // modal matches the rest of the product visually + is testable.
  const [deletePrompt, setDeletePrompt] = useState<{ id: string; title: string } | null>(null)

  // Build the set of unique tags across all conversations, with counts —
  // drives the filter chip row at the top.
  const tagFilterChips = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of conversations) {
      for (const t of (c.tags || [])) {
        const k = tagKey(t)
        counts.set(k, (counts.get(k) || 0) + 1)
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([key, count]) => ({ key, count }))
  }, [conversations])

  // Apply text search + tag filter, then bucket into pinned vs recent.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    let filtered = conversations
    if (q) {
      filtered = filtered.filter(c => (c.title || '').toLowerCase().includes(q))
    }
    if (activeTagFilter) {
      filtered = filtered.filter(c => (c.tags || []).some(t => tagKey(t) === activeTagFilter))
    }
    const pinned: AIConversation[] = []
    const rest:   AIConversation[] = []
    for (const c of filtered) {
      if (c.is_pinned) pinned.push(c)
      else             rest.push(c)
    }
    return { pinned, rest }
  }, [conversations, query, activeTagFilter])

  const totalShown = groups.pinned.length + groups.rest.length

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

      <div className="flex-1 overflow-y-auto py-1">
        {isLoading && conversations.length === 0 ? (
          <div className="p-4 text-xs text-gray-400 italic">Loading…</div>
        ) : conversations.length === 0 ? (
          <div className="p-4 text-xs text-gray-400 italic">
            No saved conversations yet. Send a message to start one.
          </div>
        ) : totalShown === 0 ? (
          <div className="p-4 text-xs text-gray-400 italic">No conversations match the current filter.</div>
        ) : (
          <>
            {groups.pinned.length > 0 && (
              <Group label="Pinned" items={groups.pinned}
                activeId={activeConversationId}
                tagLabels={tagLabels}
                onSelect={onSelect} onRename={onRename} onArchive={onArchive}
                onTogglePin={onTogglePin}
                onRequestDelete={(id, title) => setDeletePrompt({ id, title })} />
            )}
            {groups.rest.length > 0 && (
              <Group label="Recent" items={groups.rest}
                activeId={activeConversationId}
                tagLabels={tagLabels}
                onSelect={onSelect} onRename={onRename} onArchive={onArchive}
                onTogglePin={onTogglePin}
                onRequestDelete={(id, title) => setDeletePrompt({ id, title })} />
            )}
          </>
        )}
      </div>

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
    </div>
  )
}

// ─── Group of conversation items ────────────────────────────────────────────

function Group({
  label, items, activeId, tagLabels, onSelect, onRename, onArchive, onTogglePin, onRequestDelete,
}: {
  label: string
  items: AIConversation[]
  activeId: string | null
  tagLabels: Record<string, string>
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
            isActive={c.id === activeId}
            onSelect={() => onSelect(c.id)}
            onRename={(title) => onRename(c.id, title)}
            onArchive={() => onArchive(c.id)}
            onTogglePin={() => onTogglePin(c.id, !c.is_pinned)}
            onRequestDelete={() => onRequestDelete(c.id, c.title || '')}
          />
        ))}
      </ul>
    </div>
  )
}

// ─── A single conversation row ──────────────────────────────────────────────

function ConversationItem({
  conversation, tagLabels, isActive, onSelect, onRename, onArchive, onTogglePin, onRequestDelete,
}: {
  conversation: AIConversation
  tagLabels: Record<string, string>
  isActive: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onArchive: () => void
  onTogglePin: () => void
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
      </div>
    </li>
  )
}

function IconBtn({
  children, onClick, title, variant,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  variant?: 'danger'
}) {
  return (
    <button
      type="button"
      title={title}
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
