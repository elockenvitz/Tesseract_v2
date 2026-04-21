import React, { useState, useRef } from 'react'
import { User, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useListMembers } from '../../hooks/lists/useListMembers'
import { useUpdateListItem } from '../../hooks/lists/useUpdateListItem'
import { PortalPopover } from './PortalPopover'

interface Assignee {
  id: string
  email: string | null
  first_name?: string | null
  last_name?: string | null
}

interface ListAssigneeCellProps {
  rowId: string
  listId: string
  assignee: Assignee | null
  canEdit: boolean
}

function initials(a: { first_name?: string | null; last_name?: string | null; email?: string | null }) {
  if (a.first_name && a.last_name) return `${a.first_name[0]}${a.last_name[0]}`.toUpperCase()
  if (a.first_name) return a.first_name[0].toUpperCase()
  if (a.email) return a.email[0].toUpperCase()
  return '?'
}

function displayName(a: { first_name?: string | null; last_name?: string | null; email?: string | null }) {
  if (a.first_name && a.last_name) return `${a.first_name} ${a.last_name}`
  if (a.first_name) return a.first_name
  return a.email ?? 'Unknown'
}

export function ListAssigneeCell({ rowId, listId, assignee, canEdit }: ListAssigneeCellProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  const { data: members = [] } = useListMembers(open ? listId : null)
  const updateItem = useUpdateListItem(listId)

  const pick = (userId: string | null) => {
    updateItem.mutate({ itemId: rowId, updates: { assignee_id: userId } })
    setOpen(false)
  }

  const Trigger = assignee ? (
    <div className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <div className="w-5 h-5 flex-shrink-0 rounded-full bg-primary-500 text-white flex items-center justify-center text-[10px] font-semibold">
        {initials(assignee)}
      </div>
      <span className="text-[13px] font-medium text-gray-700 dark:text-gray-300 truncate">{displayName(assignee)}</span>
    </div>
  ) : (
    <div className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500">
      <User className="h-3.5 w-3.5" />
      <span className="text-[13px]">—</span>
    </div>
  )

  if (!canEdit) return <div className="px-1">{Trigger}</div>

  return (
    <>
      <button
        ref={anchorRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="inline-flex items-center gap-1 px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title={assignee ? `Assigned to ${displayName(assignee)}` : 'Click to assign'}
      >
        {Trigger}
      </button>
      <PortalPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={224}>
        <div className="max-h-72 overflow-y-auto">
          <button
            onClick={() => pick(null)}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800',
              !assignee && 'font-semibold bg-gray-50 dark:bg-gray-800'
            )}
          >
            <User className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-gray-600 dark:text-gray-400">Unassigned</span>
            {!assignee && <Check className="h-3.5 w-3.5 ml-auto text-gray-400" />}
          </button>
          {members.map((m) => {
            const isSelected = assignee?.id === m.user_id
            return (
              <button
                key={m.user_id}
                onClick={() => pick(m.user_id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800',
                  isSelected && 'font-semibold bg-gray-50 dark:bg-gray-800'
                )}
              >
                <div className="w-5 h-5 flex-shrink-0 rounded-full bg-primary-500 text-white flex items-center justify-center text-[9px] font-semibold">
                  {initials(m)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-gray-800 dark:text-gray-200">{displayName(m)}</div>
                  {m.role === 'owner' && <div className="text-[10px] text-yellow-600 dark:text-yellow-400">Owner</div>}
                </div>
                {isSelected && <Check className="h-3.5 w-3.5 ml-auto text-primary-500" />}
              </button>
            )
          })}
          {members.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">No members</div>
          )}
        </div>
      </PortalPopover>
    </>
  )
}
