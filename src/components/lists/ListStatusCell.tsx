import React, { useState, useRef } from 'react'
import { Circle, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { useListStatuses } from '../../hooks/lists/useListStatuses'
import { useUpdateListItem } from '../../hooks/lists/useUpdateListItem'
import { PortalPopover } from './PortalPopover'

interface Status {
  id: string
  name: string
  color: string
}

interface ListStatusCellProps {
  rowId: string
  listId: string
  status: Status | null
  canEdit: boolean
}

export function ListStatusCell({ rowId, listId, status, canEdit }: ListStatusCellProps) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement | null>(null)

  const { statuses } = useListStatuses(open ? listId : null)
  const updateItem = useUpdateListItem(listId)

  const pick = (statusId: string | null) => {
    updateItem.mutate({ itemId: rowId, updates: { status_id: statusId } })
    setOpen(false)
  }

  const Trigger = status ? (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[11px] font-medium rounded-full border"
      style={{
        backgroundColor: `${status.color}18`,
        color: status.color,
        borderColor: `${status.color}40`
      }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full flex-shrink-0"
        style={{ backgroundColor: status.color }}
      />
      {status.name}
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-gray-400 dark:text-gray-500 text-[13px]">
      <Circle className="h-3 w-3" />
      —
    </span>
  )

  if (!canEdit) return <div className="px-1">{Trigger}</div>

  return (
    <>
      <button
        ref={anchorRef}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="inline-flex items-center px-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title={status ? `Status: ${status.name}` : 'Click to set status'}
      >
        {Trigger}
      </button>
      <PortalPopover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} width={192}>
        <div className="max-h-72 overflow-y-auto">
          <button
            onClick={() => pick(null)}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800 border-b border-gray-100 dark:border-gray-800',
              !status && 'font-semibold bg-gray-50 dark:bg-gray-800'
            )}
          >
            <Circle className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-gray-600 dark:text-gray-400">Clear status</span>
            {!status && <Check className="h-3.5 w-3.5 ml-auto text-gray-400" />}
          </button>
          {statuses.map((s) => {
            const isSelected = status?.id === s.id
            return (
              <button
                key={s.id}
                onClick={() => pick(s.id)}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-gray-50 dark:hover:bg-gray-800',
                  isSelected && 'font-semibold bg-gray-50 dark:bg-gray-800'
                )}
              >
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: s.color }}
                />
                <span className="flex-1 truncate text-gray-800 dark:text-gray-200">{s.name}</span>
                {isSelected && <Check className="h-3.5 w-3.5 text-primary-500" />}
              </button>
            )
          })}
          {statuses.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">No statuses yet</div>
          )}
        </div>
      </PortalPopover>
    </>
  )
}
