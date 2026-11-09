/**
 * The requirements of one stage, as a navigator.
 *
 * ── What changed ────────────────────────────────────────────────────────
 *
 * Requirements were a list of accordions: clicking one pushed everything
 * below it down and revealed owner, notes, attachments and comments in a
 * column about 670px wide, while the rest of the working surface sat empty.
 * The list is now a rail and the selected requirement gets the space.
 *
 * ── Completion and selection are different gestures ─────────────────────
 *
 * The circle completes; the row selects. They were already distinct in the
 * accordion (the circle stopped propagation) and they stay distinct here,
 * because a reader moving between requirements to read them must never
 * discover they have been ticking them off.
 *
 * This component owns no data. `onToggleStatus` is the existing
 * `handleChecklistToggle`, which is the only thing that writes completion.
 */
import { clsx } from 'clsx'
import { Check, Paperclip, MessageSquare } from 'lucide-react'
import type { ChecklistItemData } from '../ui/checklist/types'
import { userName } from '../ui/checklist/types'
import {
  statusOf, primaryAction, isSatisfied, ACTION_LABEL,
  type RequirementAction,
} from '../../lib/asset-work/requirement-status'

export interface RequirementsNavigatorProps {
  items: readonly ChecklistItemData[]
  /** `asset_checklist_items.id` — stable, never an array index. */
  selectedId: string | null
  onSelect: (id: string) => void
  /**
   * The named transition this row's control performs. The rail has room
   * for one, so it is the primary action for the row's current state —
   * complete when open, reopen when complete, restore when not
   * applicable. Marking a requirement not applicable is offered on the
   * detail surface, where a control can be named in words.
   */
  onAction: (id: string, action: RequirementAction) => void
  isEditable: boolean
  /**
   * Requirements that carry a written finding in `checklist_item_comments`.
   *
   * The rail looked at `notes` alone, which only operational items use, so a
   * thinking requirement with three paragraphs of analysis against it
   * rendered exactly like one nobody had opened. The caller already holds
   * this query; passing the ids keeps the rail free of data access.
   */
  documentedIds?: ReadonlySet<string>
  /** The existing "Add item" control, passed in rather than rebuilt. */
  addSlot?: React.ReactNode
  className?: string
}

export function RequirementsNavigator({
  items, selectedId, onSelect, onAction, isEditable, documentedIds, addSlot, className,
}: RequirementsNavigatorProps) {
  return (
    <div className={clsx('flex min-h-0 flex-col', className)} data-testid="requirements-navigator">
      <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {items.map(item => {
          const status = statusOf(item)
          const selected = item.id === selectedId
          const done = isSatisfied(status)
          const action = primaryAction(status)
          return (
            <li key={item.id}>
              <div
                className={clsx(
                  'flex items-start gap-2 rounded-md px-2 py-1.5 transition-colors',
                  selected
                    ? 'bg-primary-50 ring-1 ring-primary-200 dark:bg-primary-500/10 dark:ring-primary-400/30'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-800',
                )}
              >
                {/* The completion control. Separate from selection, and the
                    only thing here that writes. */}
                <button
                  type="button"
                  onClick={() => onAction(item.id, action)}
                  disabled={!isEditable}
                  /* The label is the action, so it can never promise a
                     transition the handler will not perform. */
                  aria-label={`${ACTION_LABEL[action]}: ${item.text}`}
                  data-testid={`requirement-toggle-${item.id}`}
                  data-action={action}
                  className={clsx(
                    'mt-[2px] flex h-[17px] w-[17px] flex-shrink-0 items-center justify-center rounded-full border-[1.5px] transition-colors',
                    status === 'completed' ? 'border-emerald-500 bg-emerald-500 text-white'
                      : status === 'na' ? 'border-gray-400 bg-gray-400 text-white'
                      : isEditable ? 'border-gray-300 hover:border-gray-400 dark:border-gray-600'
                      : 'border-gray-200 dark:border-gray-700',
                    !isEditable && 'cursor-not-allowed',
                  )}
                >
                  {status === 'completed' && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  {status === 'na' && <span className="text-[7px] font-bold leading-none">N/A</span>}
                </button>

                {/* The selection control. */}
                <button
                  type="button"
                  onClick={() => onSelect(item.id)}
                  aria-current={selected ? 'true' : undefined}
                  data-testid={`requirement-select-${item.id}`}
                  className="min-w-0 flex-1 text-left"
                >
                  <span className={clsx(
                    'block text-[12px] leading-snug',
                    done ? 'text-gray-400' : 'text-gray-900 dark:text-gray-100',
                    selected && 'font-medium',
                  )}>
                    {item.text}
                  </span>
                  {/*
                    Indicators only where the row's own data supports them.
                    No counts are fetched for the rail — an attachment count
                    per requirement would be one query per row to decorate a
                    list, and the detail surface shows the real thing.

                    `documented` is the one addition: a requirement with a
                    written finding is not untouched, and saying so costs one
                    word. It is deliberately NOT "in progress" — nothing in
                    the schema separates a half-written note from a finished
                    thought nobody ticked.
                  */}
                  {(() => {
                    const documented = !done && (
                      !!item.notes?.trim()
                      || !!item.attachments?.length
                      || !!(item.dbId && documentedIds?.has(item.dbId))
                    )
                    if (!item.assignee && !documented) return null
                    return (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-400">
                        {documented && (
                          <span
                            className="font-medium text-amber-600 dark:text-amber-500"
                            data-testid={`requirement-documented-${item.id}`}
                          >
                            Documented
                          </span>
                        )}
                        {item.assignee && <span className="truncate">{userName(item.assignee)}</span>}
                        {item.notes && <MessageSquare className="h-2.5 w-2.5 shrink-0" aria-label="Has notes" />}
                        {item.attachments && item.attachments.length > 0 && (
                          <Paperclip className="h-2.5 w-2.5 shrink-0" aria-label="Has attachments" />
                        )}
                      </span>
                    )
                  })()}
                </button>
              </div>
            </li>
          )
        })}
      </ul>
      {addSlot && <div className="mt-1 shrink-0">{addSlot}</div>}
    </div>
  )
}
