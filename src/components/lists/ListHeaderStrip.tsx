import React, { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Star, Share2, Users, Bell, CircleDot, Archive, CheckCircle2,
  ChevronDown, Activity as ActivityIcon
} from 'lucide-react'
import { clsx } from 'clsx'
import { supabase } from '../../lib/supabase'
import { Button } from '../ui/Button'
import type { ListPermissions } from '../../hooks/lists/useListPermissions'
import { ListActivityPopover } from './ListActivityPopover'

// ── Types ──────────────────────────────────────────────────────────────

type Lifecycle = 'active' | 'converted' | 'archived'

interface ListLite {
  id: string
  name: string
  color: string | null
  list_type: 'mutual' | 'collaborative'
  lifecycle: Lifecycle | null
}

interface CollaboratorUser {
  user_id?: string
  permission?: 'read' | 'write' | 'admin'
  user?: {
    id?: string
    email?: string
    first_name?: string | null
    last_name?: string | null
  } | null
}

interface ListHeaderStripProps {
  list: ListLite
  assetCount: number
  collaborators: CollaboratorUser[]
  ownerName?: string | null
  ownerInitials?: string | null
  isFavorited: boolean
  onToggleFavorite: () => void
  suggestionsIncomingCount: number
  onToggleSuggestionsPanel: () => void
  showingSuggestionsPanel: boolean
  onShare: () => void
  permissions: ListPermissions
  /** Slot for the InlineAssetAdder (or any add-affordance) rendered on the far right */
  addAssetSlot?: React.ReactNode
}

// ── Lifecycle config ───────────────────────────────────────────────────

const LIFECYCLE_CONFIG: Record<Lifecycle, { label: string; Icon: React.ComponentType<{ className?: string }>; className: string }> = {
  active:    { label: 'Active',    Icon: CircleDot,     className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-800' },
  converted: { label: 'Resolved',  Icon: CheckCircle2,  className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-800' },
  archived:  { label: 'Archived',  Icon: Archive,       className: 'bg-gray-100 text-gray-600 border-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:border-gray-700' }
}

// ── Main ───────────────────────────────────────────────────────────────

export function ListHeaderStrip({
  list,
  assetCount,
  collaborators,
  ownerName,
  ownerInitials,
  isFavorited,
  onToggleFavorite,
  suggestionsIncomingCount,
  onToggleSuggestionsPanel,
  showingSuggestionsPanel,
  onShare,
  permissions,
  addAssetSlot
}: ListHeaderStripProps) {
  const isCollaborative = list.list_type === 'collaborative'

  // Activity popover (anchored to the activity button)
  const [activityOpen, setActivityOpen] = useState(false)
  const activityBtnRef = useRef<HTMLButtonElement | null>(null)

  return (
    <div className="flex items-center justify-between py-2 flex-shrink-0 gap-3">
      {/* ── Identity cluster ─────────────────────────────────────── */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {/* Color dot */}
        <div
          className="w-3 h-3 rounded-full flex-shrink-0"
          style={{ backgroundColor: list.color || '#3b82f6' }}
        />

        {/* Name */}
        <h1 className="text-xl font-semibold tracking-tight text-gray-900 dark:text-gray-100 truncate">
          {list.name}
        </h1>

        {/* Favorite */}
        <button
          onClick={onToggleFavorite}
          className="transition-colors flex-shrink-0"
          title={isFavorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star className={clsx(
            'h-4 w-4 transition-colors',
            isFavorited ? 'text-yellow-500 fill-yellow-500' : 'text-gray-300 hover:text-yellow-500'
          )} />
        </button>

        {/* Lifecycle pill (always visible; editable by owner) */}
        <LifecyclePill
          listId={list.id}
          lifecycle={(list.lifecycle ?? 'active') as Lifecycle}
          canEdit={permissions.isOwner}
        />

        {/* Collaborative indicator (quieter — just an icon + tooltip) */}
        {isCollaborative && (
          <span
            title="Collaborative list"
            className="inline-flex items-center text-[11px] font-medium text-violet-600 dark:text-violet-400 flex-shrink-0"
          >
            <Users className="h-3.5 w-3.5" />
          </span>
        )}

        {/* Member avatar stack (only if >0 collaborators) */}
        {collaborators.length > 0 && (
          <MemberAvatarStack
            collaborators={collaborators}
            ownerName={ownerName}
            ownerInitials={ownerInitials}
          />
        )}
      </div>

      {/* ── Action cluster ───────────────────────────────────────── */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <button
          ref={activityBtnRef}
          onClick={() => setActivityOpen(o => !o)}
          className={clsx(
            'p-1.5 rounded-md transition-colors',
            activityOpen
              ? 'text-primary-700 bg-primary-50 dark:text-primary-300 dark:bg-primary-900/30'
              : 'text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800'
          )}
          title="Activity"
        >
          <ActivityIcon className="h-3.5 w-3.5" />
        </button>
        <ListActivityPopover
          listId={list.id}
          anchorRef={activityBtnRef}
          open={activityOpen}
          onClose={() => setActivityOpen(false)}
        />

        {suggestionsIncomingCount > 0 && (
          <button
            onClick={onToggleSuggestionsPanel}
            className={clsx(
              'relative flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-md transition-colors',
              showingSuggestionsPanel
                ? 'text-amber-800 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200'
                : 'text-amber-700 bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300'
            )}
            title={`${suggestionsIncomingCount} pending suggestion${suggestionsIncomingCount !== 1 ? 's' : ''}`}
          >
            <Bell className="h-3.5 w-3.5" />
            {suggestionsIncomingCount}
          </button>
        )}

        {permissions.canManageCollaborators && (
          <Button variant="outline" size="sm" onClick={onShare}>
            <Share2 className="h-3.5 w-3.5" />
            {collaborators.length > 0 && <span className="ml-1">{collaborators.length}</span>}
          </Button>
        )}

        {addAssetSlot}
      </div>
    </div>
  )
}

// ── LifecyclePill ──────────────────────────────────────────────────────

function LifecyclePill({
  listId,
  lifecycle,
  canEdit
}: {
  listId: string
  lifecycle: Lifecycle
  canEdit: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const config = LIFECYCLE_CONFIG[lifecycle]

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const updateLifecycle = useMutation({
    mutationFn: async (next: Lifecycle) => {
      const { error } = await supabase
        .from('asset_lists')
        .update({ lifecycle: next, updated_at: new Date().toISOString() })
        .eq('id', listId)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-list', listId] })
      queryClient.invalidateQueries({ queryKey: ['list-surfaces'] })
      queryClient.invalidateQueries({ queryKey: ['asset-lists'] })
      queryClient.invalidateQueries({ queryKey: ['asset-list-activity', listId] })
      setOpen(false)
    }
  })

  const Pill = (
    <span className={clsx(
      'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border rounded-full flex-shrink-0',
      config.className
    )}>
      <config.Icon className="h-3 w-3" />
      {config.label}
    </span>
  )

  if (!canEdit) return Pill

  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-medium border rounded-full transition-colors hover:brightness-95',
          config.className
        )}
      >
        <config.Icon className="h-3 w-3" />
        {config.label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-40 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-50 overflow-hidden">
          {(Object.keys(LIFECYCLE_CONFIG) as Lifecycle[]).map((l) => {
            const c = LIFECYCLE_CONFIG[l]
            const isSelected = l === lifecycle
            return (
              <button
                key={l}
                onClick={() => updateLifecycle.mutate(l)}
                disabled={updateLifecycle.isPending}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 text-xs text-left transition-colors',
                  isSelected
                    ? 'bg-gray-100 dark:bg-gray-800 font-semibold'
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800'
                )}
              >
                <c.Icon className="h-3.5 w-3.5" />
                {c.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── MemberAvatarStack ──────────────────────────────────────────────────

function getInitials(first?: string | null, last?: string | null, email?: string) {
  if (first && last) return `${first[0]}${last[0]}`.toUpperCase()
  if (first) return first[0].toUpperCase()
  if (email) return email[0].toUpperCase()
  return '?'
}

function getDisplayName(first?: string | null, last?: string | null, email?: string) {
  if (first && last) return `${first} ${last}`
  if (first) return first
  return email ?? 'Unknown'
}

function MemberAvatarStack({
  collaborators,
  ownerName,
  ownerInitials
}: {
  collaborators: CollaboratorUser[]
  ownerName?: string | null
  ownerInitials?: string | null
}) {
  const VISIBLE = 3
  const visible = collaborators.slice(0, VISIBLE)
  const overflow = Math.max(0, collaborators.length - VISIBLE)

  return (
    <div className="flex items-center flex-shrink-0 pl-1">
      {/* Owner */}
      {ownerInitials && (
        <Avatar
          initials={ownerInitials}
          label={ownerName ?? 'Owner'}
          className="bg-primary-500 text-white ring-white dark:ring-gray-900"
          isOwner
        />
      )}
      {/* Visible collaborators */}
      {visible.map((c) => {
        const u = c.user
        return (
          <Avatar
            key={c.user_id}
            initials={getInitials(u?.first_name, u?.last_name, u?.email)}
            label={getDisplayName(u?.first_name, u?.last_name, u?.email)}
            className="bg-gray-500 text-white ring-white dark:ring-gray-900"
          />
        )
      })}
      {overflow > 0 && (
        <Avatar
          initials={`+${overflow}`}
          label={`${overflow} more`}
          className="bg-gray-200 text-gray-700 ring-white dark:bg-gray-700 dark:text-gray-300 dark:ring-gray-900"
        />
      )}
    </div>
  )
}

function Avatar({
  initials,
  label,
  className,
  isOwner
}: {
  initials: string
  label: string
  className?: string
  isOwner?: boolean
}) {
  return (
    <div
      title={isOwner ? `${label} · Owner` : label}
      className={clsx(
        'relative w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ring-2 -ml-1 first:ml-0',
        className
      )}
    >
      {initials}
      {isOwner && (
        <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-yellow-400 border border-white dark:border-gray-900" title="Owner" />
      )}
    </div>
  )
}
