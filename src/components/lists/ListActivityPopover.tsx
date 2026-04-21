import React from 'react'
import { formatDistanceToNow } from 'date-fns'
import { Activity as ActivityIcon } from 'lucide-react'
import { useListActivityFeed, type ListActivityEvent } from '../../hooks/lists/useListActivityFeed'
import { describeActivity } from '../../lib/lists/describeActivity'
import { PortalPopover } from './PortalPopover'

interface ListActivityPopoverProps {
  listId: string
  anchorRef: React.RefObject<HTMLElement | null>
  open: boolean
  onClose: () => void
}

export function ListActivityPopover({ listId, anchorRef, open, onClose }: ListActivityPopoverProps) {
  const { data: events = [], isLoading } = useListActivityFeed(open ? listId : null, 30)

  return (
    <PortalPopover
      anchorRef={anchorRef}
      open={open}
      onClose={onClose}
      width={380}
      align="end"
      className="max-h-[520px] flex flex-col"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400">
          <ActivityIcon className="h-3 w-3" />
          Activity
          {!isLoading && events.length > 0 && (
            <span className="normal-case font-normal text-gray-400 dark:text-gray-500">· {events.length}</span>
          )}
        </div>
      </div>

      <div className="overflow-y-auto">
        {isLoading ? (
          <div className="px-4 py-6 text-xs text-gray-400">Loading…</div>
        ) : events.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="text-xs text-gray-400 dark:text-gray-500">No activity yet</p>
            <p className="text-[11px] text-gray-400 dark:text-gray-600 mt-1">Changes will appear here as the team works.</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/60">
            {events.map(e => <FeedRow key={e.id} event={e} />)}
          </div>
        )}
      </div>
    </PortalPopover>
  )
}

function FeedRow({ event }: { event: ListActivityEvent }) {
  const actor = event.actor
  const actorName = actor
    ? (actor.first_name && actor.last_name)
      ? `${actor.first_name} ${actor.last_name}`
      : actor.first_name ?? actor.email ?? 'Someone'
    : 'Someone'
  const initials = getInitials(actor)
  const verb = describeActivity(event)
  const when = formatDistanceToNow(new Date(event.created_at), { addSuffix: true })

  return (
    <div className="flex items-start gap-2.5 px-3 py-2.5">
      <div className="w-6 h-6 flex-shrink-0 rounded-full bg-primary-500 text-white flex items-center justify-center text-[10px] font-semibold mt-0.5">
        {initials}
      </div>
      <div className="min-w-0 flex-1 text-[12px] leading-snug">
        <div className="text-gray-700 dark:text-gray-300">
          <span className="font-semibold text-gray-900 dark:text-gray-100">{actorName}</span>{' '}
          <span className="text-gray-500 dark:text-gray-400">{verb}</span>
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">{when}</div>
      </div>
    </div>
  )
}

function getInitials(u: { first_name?: string | null; last_name?: string | null; email?: string | null } | null): string {
  if (!u) return '?'
  if (u.first_name && u.last_name) return `${u.first_name[0]}${u.last_name[0]}`.toUpperCase()
  if (u.first_name) return u.first_name[0].toUpperCase()
  if (u.email) return u.email[0].toUpperCase()
  return '?'
}
