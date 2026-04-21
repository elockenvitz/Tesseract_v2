import React, { useState, useRef, useMemo } from 'react'
import { Tag as TagIcon, Plus, Check, X, Loader2 } from 'lucide-react'
import { clsx } from 'clsx'
import { useListTags, type ListTag } from '../../hooks/lists/useListTags'
import { useListItemTags } from '../../hooks/lists/useListItemTags'
import { PortalPopover } from './PortalPopover'

interface ListTagsCellProps {
  rowId: string
  listId: string
  tags: Array<{ id: string; name: string; color: string }>
  canEdit: boolean
}

const PALETTE = [
  '#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899',
  '#06b6d4', '#84cc16', '#f97316', '#6366f1', '#14b8a6', '#64748b'
]

export function ListTagsCell({ rowId, listId, tags, canEdit }: ListTagsCellProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  const { tags: allTags, createTagAsync, isCreating } = useListTags(open ? listId : null)
  const { addTagAsync, removeTagAsync } = useListItemTags(listId)

  const assignedIds = useMemo(() => new Set(tags.map(t => t.id)), [tags])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return allTags
    return allTags.filter(t => t.name.toLowerCase().includes(q))
  }, [allTags, query])

  const exactMatch = useMemo(
    () => allTags.find(t => t.name.toLowerCase() === query.trim().toLowerCase()),
    [allTags, query]
  )

  const toggleTag = async (tag: ListTag) => {
    if (assignedIds.has(tag.id)) {
      await removeTagAsync({ listItemId: rowId, tagId: tag.id })
    } else {
      await addTagAsync({ listItemId: rowId, tagId: tag.id })
    }
  }

  const handleCreateAndAssign = async () => {
    const name = query.trim()
    if (!name) return
    const color = PALETTE[Math.floor(Math.random() * PALETTE.length)]
    const created = await createTagAsync({ name, color })
    await addTagAsync({ listItemId: rowId, tagId: created.id })
    setQuery('')
  }

  return (
    <div className="inline-flex items-center gap-1 flex-wrap max-w-full" onClick={(e) => e.stopPropagation()}>
      {tags.map((t) => (
        <span
          key={t.id}
          className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded border"
          style={{
            backgroundColor: `${t.color}18`,
            color: t.color,
            borderColor: `${t.color}40`
          }}
          title={t.name}
        >
          {t.name}
          {canEdit && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                removeTagAsync({ listItemId: rowId, tagId: t.id })
              }}
              className="hover:opacity-70"
            >
              <X className="h-2.5 w-2.5" />
            </button>
          )}
        </span>
      ))}
      {canEdit && (
        <button
          ref={anchorRef}
          onClick={() => setOpen(o => !o)}
          className="inline-flex items-center text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 rounded p-0.5 transition-colors"
          title="Add tag"
        >
          <Plus className="h-3 w-3" />
        </button>
      )}
      {!canEdit && tags.length === 0 && (
        <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500 text-[13px]">
          <TagIcon className="h-3 w-3" />
          —
        </span>
      )}

      <PortalPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={224}>
        <div className="p-2 border-b border-gray-100 dark:border-gray-800">
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or create tag…"
            className="w-full px-2 py-1 text-xs border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-500 bg-white dark:bg-gray-900"
          />
        </div>
        <div className="max-h-48 overflow-y-auto">
          {filtered.map((t) => {
            const isAssigned = assignedIds.has(t.id)
            return (
              <button
                key={t.id}
                onClick={() => toggleTag(t)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800',
                  isAssigned && 'bg-gray-50 dark:bg-gray-800'
                )}
              >
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: t.color }}
                />
                <span className="flex-1 truncate">{t.name}</span>
                {isAssigned && <Check className="h-3 w-3 text-primary-500" />}
              </button>
            )
          })}
          {query.trim() && !exactMatch && (
            <button
              onClick={handleCreateAndAssign}
              disabled={isCreating}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800 text-primary-600 dark:text-primary-400 border-t border-gray-100 dark:border-gray-800"
            >
              {isCreating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
              Create "{query.trim()}"
            </button>
          )}
          {filtered.length === 0 && !query.trim() && (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">No tags yet — type to create one</div>
          )}
        </div>
      </PortalPopover>
    </div>
  )
}
