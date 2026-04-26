import React, { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  Edit3,
  Check,
  X,
  Trash2,
  Pin,
  PinOff,
  Building2,
  Globe,
  FileText,
} from 'lucide-react'
import { Button } from '../../ui/Button'
import { RichTextEditor, type RichTextEditorRef } from '../../rich-text-editor/RichTextEditor'
import { SmartInputRenderer } from '../../smart-input'
import { useAuth } from '../../../hooks/useAuth'
import {
  useThemeContributionsV2,
  type ThemeContribution,
  type ThemeContributionVisibility,
  type ThemeResearchField,
} from '../../../hooks/useThemeResearch'

export type ThemeResearchActiveTab = 'aggregated' | string

interface ThemeContributionSectionProps {
  themeId: string
  themeIsPublic: boolean
  field: ThemeResearchField
  activeTab: ThemeResearchActiveTab
  hideWhenEmpty?: boolean
  onTabChange?: (tab: ThemeResearchActiveTab) => void
}

// Visual theme — matches asset ContributionSection styling
const TILE_THEME = {
  accent: 'border-l-blue-400',
  iconBg: 'bg-blue-50',
  iconColor: 'text-blue-600',
  hoverBorder: 'hover:border-amber-200',
  hoverBg: 'hover:bg-amber-50/30',
} as const

// Helpers ------------------------------------------------------------------

function displayName(c: ThemeContribution | null | undefined): string {
  const u = c?.author
  if (!u) return 'Unknown'
  const full = [u.first_name, u.last_name].filter(Boolean).join(' ').trim()
  return full || u.email?.split('@')[0] || 'Unknown'
}

function initials(c: ThemeContribution): string {
  const u = c.author
  const first = (u?.first_name || u?.email || '?').charAt(0).toUpperCase()
  const last = (u?.last_name || '').charAt(0).toUpperCase()
  return (first + last).slice(0, 2) || '?'
}

function hasText(html: string | null | undefined): boolean {
  if (!html) return false
  return html.replace(/<[^>]*>/g, '').trim().length > 0
}

function VisibilityBadge({ visibility, isOwn }: { visibility: ThemeContributionVisibility; isOwn?: boolean }) {
  const common = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium'
  if (visibility === 'shared') {
    return (
      <span className={clsx(common, 'bg-violet-50 text-violet-700')}>
        <Globe className="w-2.5 h-2.5" /> Shared
      </span>
    )
  }
  return (
    <span className={clsx(common, isOwn ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600')}>
      <Building2 className="w-2.5 h-2.5" /> Org
    </span>
  )
}

// Component ----------------------------------------------------------------

export function ThemeContributionSection({
  themeId, themeIsPublic, field, activeTab, hideWhenEmpty = false, onTabChange,
}: ThemeContributionSectionProps) {
  const { user } = useAuth()
  const {
    contributions,
    isLoading,
    upsertContribution,
    isUpserting,
    deleteContribution,
    togglePin,
  } = useThemeContributionsV2(themeId)

  const fieldContributions = useMemo(
    () => contributions.filter(c => c.section === field.slug),
    [contributions, field.slug]
  )

  const isAggregated = activeTab === 'aggregated'
  const focusedUserId = isAggregated ? null : activeTab
  const isOwnView = !!user && focusedUserId === user.id

  const ownContribution = useMemo(
    () => fieldContributions.find(c => c.created_by === user?.id) || null,
    [fieldContributions, user?.id]
  )

  const otherContributions = useMemo(
    () => fieldContributions
      .filter(c => c.created_by !== user?.id)
      .sort((a, b) => {
        if (a.is_pinned !== b.is_pinned) return a.is_pinned ? -1 : 1
        return b.updated_at.localeCompare(a.updated_at)
      }),
    [fieldContributions, user?.id]
  )

  const focusedContribution = useMemo(
    () => (isAggregated ? null : fieldContributions.find(c => c.created_by === focusedUserId) || null),
    [fieldContributions, focusedUserId, isAggregated]
  )

  // Hide empty field when viewing someone else's tab
  if (!isAggregated && !isOwnView && !hasText(focusedContribution?.content) && hideWhenEmpty) {
    return null
  }

  // Inline edit state (used both in aggregated view and own view)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState<string>(ownContribution?.content || '')
  const [visibility, setVisibility] = useState<ThemeContributionVisibility>(ownContribution?.visibility || 'org')
  const editorRef = useRef<RichTextEditorRef>(null)

  useEffect(() => {
    if (!isEditing) {
      setDraft(ownContribution?.content || '')
      setVisibility(ownContribution?.visibility || 'org')
    }
  }, [ownContribution?.id, ownContribution?.content, ownContribution?.visibility, isEditing])

  const startEdit = () => {
    setDraft(ownContribution?.content || '')
    setVisibility(ownContribution?.visibility || 'org')
    setIsEditing(true)
  }
  const cancelEdit = () => {
    setIsEditing(false)
    setDraft(ownContribution?.content || '')
  }
  const commitEdit = async () => {
    try {
      await upsertContribution({
        section: field.slug,
        content: draft,
        visibility: themeIsPublic ? visibility : 'org',
      })
      setIsEditing(false)
    } catch (e) {
      console.error('[theme research] failed to save', e)
    }
  }
  const clearOwn = async () => {
    if (!ownContribution) return
    await deleteContribution(ownContribution.id)
  }

  // Hover-gated toolbar (matches asset page pattern)
  const [isHovered, setIsHovered] = useState(false)

  // Timestamp to show in header
  const lastUpdated = isAggregated
    ? fieldContributions.reduce<string | null>((max, c) => (!max || c.updated_at > max ? c.updated_at : max), null)
    : focusedContribution?.updated_at ?? null

  // Match the asset page: the prominent pencil button only appears on
  // the user's own view, never on the aggregated "Our View" — the
  // aggregated view is read-only by convention. Editing from the
  // aggregated view goes through the (subtle) title-click affordance.
  const canEditInline = user && isOwnView
  const showEditButton = canEditInline && !isEditing && isHovered

  return (
    <div
      className={clsx(
        'bg-white border border-gray-200 rounded-lg border-l-4 transition-all duration-200',
        TILE_THEME.accent,
        TILE_THEME.hoverBorder,
        TILE_THEME.hoverBg,
        'hover:shadow-sm'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <div className={clsx('p-1.5 rounded-lg shrink-0', TILE_THEME.iconBg)}>
            <FileText className={clsx('w-4 h-4', TILE_THEME.iconColor)} />
          </div>
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            {/* Our View is read-only — title is static, no edit
                affordance. Editing happens from the user's own view tab. */}
            <h3 className="text-base font-semibold text-gray-900 truncate">{field.name}</h3>
            {lastUpdated && (
              <span className="text-xs text-gray-400">
                Updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
              </span>
            )}
            {!isAggregated && focusedContribution && (
              <VisibilityBadge
                visibility={focusedContribution.visibility}
                isOwn={focusedContribution.created_by === user?.id}
              />
            )}
          </div>
        </div>

        {/* Toolbar — only the edit pencil, shown on hover (matches asset page) */}
        <div className="flex items-center gap-2 shrink-0">
          {showEditButton && (
            <button
              onClick={startEdit}
              title={ownContribution ? 'Edit your view' : 'Add your view'}
              className="flex items-center justify-center p-1 text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors animate-in fade-in duration-150"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="px-4 py-3">
        {isEditing ? (
          <InlineEditor
            draft={draft}
            setDraft={setDraft}
            placeholder={field.placeholder || 'Share your take...'}
            themeIsPublic={themeIsPublic}
            visibility={visibility}
            setVisibility={setVisibility}
            onCancel={cancelEdit}
            onSave={commitEdit}
            isSaving={isUpserting}
            editorRef={editorRef}
          />
        ) : isAggregated ? (
          <AggregatedContent
            own={ownContribution}
            others={otherContributions}
            placeholder={field.placeholder || 'Share your take...'}
            currentUserId={user?.id ?? null}
            onContributorClick={(uid) => onTabChange?.(uid)}
            onStartEdit={startEdit}
            onClearOwn={clearOwn}
            onTogglePin={(id, pinned) => togglePin({ id, pinned })}
          />
        ) : isOwnView ? (
          <FocusedOwn
            own={ownContribution}
            placeholder={field.placeholder || 'Share your take...'}
            onStartEdit={startEdit}
            onClear={clearOwn}
          />
        ) : (
          <FocusedOther contribution={focusedContribution} />
        )}

        {isLoading && fieldContributions.length === 0 && (
          <div className="h-16 bg-gray-50 rounded animate-pulse mt-2" />
        )}
      </div>
    </div>
  )
}

// ==========================================================================
// Inline editor
// ==========================================================================

interface InlineEditorProps {
  draft: string
  setDraft: (v: string) => void
  placeholder: string
  themeIsPublic: boolean
  visibility: ThemeContributionVisibility
  setVisibility: (v: ThemeContributionVisibility) => void
  onCancel: () => void
  onSave: () => Promise<void>
  isSaving: boolean
  editorRef: React.RefObject<RichTextEditorRef>
}

function InlineEditor({
  draft, setDraft, placeholder, themeIsPublic, visibility, setVisibility,
  onCancel, onSave, isSaving, editorRef,
}: InlineEditorProps) {
  return (
    <div className="space-y-2">
      <RichTextEditor
        ref={editorRef}
        value={draft}
        onChange={(html) => setDraft(html)}
        placeholder={placeholder}
        minHeight="140px"
      />
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-gray-500">
          {themeIsPublic ? (
            <>
              <span>Visible to:</span>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as ThemeContributionVisibility)}
                className="text-xs px-2 py-1 border border-gray-200 rounded bg-white"
              >
                <option value="org">Org only</option>
                <option value="shared">Shared</option>
              </select>
            </>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Org only
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={onCancel}>
            <X className="w-3.5 h-3.5 mr-1" /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            <Check className="w-3.5 h-3.5 mr-1" /> Save
          </Button>
        </div>
      </div>
    </div>
  )
}

// ==========================================================================
// Aggregated content: own at top + others stacked like asset page
// ==========================================================================

interface AggregatedContentProps {
  own: ThemeContribution | null
  others: ThemeContribution[]
  placeholder: string
  currentUserId: string | null
  onContributorClick: (userId: string) => void
  onStartEdit: () => void
  onClearOwn: () => void
  onTogglePin: (id: string, pinned: boolean) => void
}

function AggregatedContent({
  own, others, placeholder, currentUserId, onContributorClick, onStartEdit, onClearOwn, onTogglePin,
}: AggregatedContentProps) {
  const hasAny = others.length > 0 || (!!own && hasText(own.content))
  if (!hasAny) {
    // Our View is pure read-only aggregation — no edit affordance.
    // Editing happens from the user's own view tab.
    return (
      <p className="text-sm text-gray-400 italic py-1">
        No views shared yet.
      </p>
    )
  }

  // Mirror the asset page's "Our View" — a flat list where each
  // contribution renders as `<Name>: <content>` inline. No per-row
  // chrome (avatars, visibility badges, pin toggles) — keeps the
  // aggregation visually scannable like the asset page.
  const all: ThemeContribution[] = [
    ...(own && hasText(own.content) ? [own] : []),
    ...others.filter(o => hasText(o.content)),
  ]
  return (
    <div className="space-y-3">
      {all.map(c => {
        const isOwn = !!currentUserId && c.created_by === currentUserId
        return (
          <div key={c.id} className="text-sm text-gray-700 leading-relaxed">
            <span
              className="font-medium text-gray-900 inline-flex items-center gap-1 align-top cursor-pointer hover:text-primary-600 transition-colors"
              onClick={() => !isOwn && onContributorClick(c.created_by)}
              title={isOwn ? 'You' : `View ${displayName(c)}'s full research`}
            >
              {isOwn ? 'You' : displayName(c)}:
            </span>{' '}
            <span className="prose prose-sm max-w-none inline [&>p]:inline [&>p]:m-0">
              <SmartInputRenderer content={c.content} inline />
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ==========================================================================
// Focused views (single user)
// ==========================================================================

function FocusedOwn({ own, placeholder, onStartEdit, onClear }: {
  own: ThemeContribution | null
  placeholder: string
  onStartEdit: () => void
  onClear: () => void
}) {
  const hasOwn = !!own && hasText(own.content)
  return (
    <div className="group cursor-text" onClick={onStartEdit}>
      {hasOwn ? (
        <div className="relative">
          <div
            className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0"
            dangerouslySetInnerHTML={{ __html: own!.content }}
          />
          <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
            <button
              onClick={(e) => { e.stopPropagation(); onStartEdit() }}
              className="p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded"
              title="Edit"
            >
              <Edit3 className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onClear() }}
              className="p-1 text-gray-400 hover:text-error-600 hover:bg-error-50 rounded"
              title="Clear"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        // Mirror the asset page's empty state — styled "Add your view"
        // button rather than an italic placeholder line.
        <div className="text-center py-1">
          <button
            onClick={(e) => { e.stopPropagation(); onStartEdit() }}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
          >
            <Edit3 className="w-3.5 h-3.5" />
            Add your view
          </button>
        </div>
      )}
    </div>
  )
}

function FocusedOther({ contribution }: { contribution: ThemeContribution | null }) {
  if (!contribution || !hasText(contribution.content)) {
    return <p className="text-sm text-gray-400 italic">No content.</p>
  }
  return (
    <div
      className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0"
      dangerouslySetInnerHTML={{ __html: contribution.content }}
    />
  )
}

