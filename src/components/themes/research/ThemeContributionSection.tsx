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
import { useIsMobile } from '../../../hooks/useMediaQuery'
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
    <span className={clsx(common, isOwn ? 'bg-sky-50 text-sky-700' : 'bg-gray-100 text-gray-600 dark:text-gray-400 dark:bg-gray-800')}>
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
  const isMobileViewport = useIsMobile()
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
  // Hover does not exist on a phone, so gating the edit control on it made
  // thesis fields permanently read-only there — the surface looked complete and
  // simply could not be used. On touch the control is always present.
  const showEditButton = !!canEditInline && !isEditing && (isHovered || isMobileViewport)

  return (
    <div
      className={clsx(
        'bg-white border border-gray-200 rounded-lg border-l-4 transition-all duration-200 dark:border-gray-700 dark:bg-gray-800',
        TILE_THEME.accent,
        TILE_THEME.hoverBorder,
        TILE_THEME.hoverBg,
        'hover:shadow-sm'
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-1.5 border-b border-gray-100 gap-2 dark:border-gray-800">
        <div className="flex items-center gap-3 min-w-0">
          <div className={clsx('p-1.5 rounded-lg shrink-0', TILE_THEME.iconBg)}>
            <FileText className={clsx('w-4 h-4', TILE_THEME.iconColor)} />
          </div>
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            {/* Our View is read-only — title is static, no edit
                affordance. Editing happens from the user's own view tab. */}
            <h3 className="text-base font-semibold text-gray-900 truncate dark:text-white">{field.name}</h3>
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
            /* A quiet pill, matching the asset case fields exactly — same
               shape, same weight, same words. A filled primary block made the
               single most emphatic thing on the page the act of starting to
               type, and it read as a different product from the asset page
               asking for the same thing. */
            <button
              onClick={startEdit}
              title={ownContribution ? 'Edit your view' : 'Add your view'}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-primary-900/30 transition-colors animate-in fade-in duration-150 no-touch-target"
            >
              <Edit3 className="w-3.5 h-3.5 shrink-0" />
              {ownContribution ? 'Edit' : 'Add'}
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
          <div className="h-16 bg-gray-50 rounded animate-pulse mt-2 dark:bg-gray-900" />
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
      {/* Visibility and the commit pair share a line at desktop width and
          stack on a phone — "Visible to:" plus a select plus Cancel plus Save
          is wider than 390px, and Save is not something to leave hanging off
          the edge. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          {themeIsPublic ? (
            <>
              <span className="shrink-0">Visible to:</span>
              <select
                value={visibility}
                onChange={(e) => setVisibility(e.target.value as ThemeContributionVisibility)}
                className="text-xs px-2 py-1 border border-gray-200 rounded bg-white dark:border-gray-700 dark:bg-gray-800"
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
        <div className="flex items-center gap-2 shrink-0">
          <Button size="sm" variant="outline" onClick={onCancel} className="flex-1 sm:flex-none">
            <X className="w-3.5 h-3.5 mr-1" /> Cancel
          </Button>
          <Button size="sm" onClick={onSave} disabled={isSaving} className="flex-1 sm:flex-none">
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
          <div key={c.id} className="text-sm text-gray-700 leading-relaxed dark:text-gray-300">
            <span
              className="font-medium text-gray-900 inline-flex items-center gap-1 align-top cursor-pointer hover:text-primary-600 transition-colors dark:text-white"
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
  const isMobileViewport = useIsMobile()

  // Edit and Clear are a hover overlay pinned to the top-right of the prose on
  // desktop. On touch there is no hover, and the app's base layer reveals
  // opacity-0 hover controls outright — so these landed as two 44px buttons
  // sitting on top of the first line of the user's own text. On a phone they
  // become a normal labelled row underneath it instead.
  const actions = (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); onStartEdit() }}
        className={clsx(
          'flex items-center gap-1.5 rounded transition-colors',
          isMobileViewport
            ? 'px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:hover:bg-primary-900/20'
            : 'no-touch-target p-1 text-gray-400 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-700',
        )}
        title="Edit"
      >
        <Edit3 className="w-3.5 h-3.5 shrink-0" />
        {isMobileViewport && 'Edit'}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onClear() }}
        className={clsx(
          'flex items-center gap-1.5 rounded transition-colors',
          isMobileViewport
            ? 'px-2.5 py-1.5 text-xs font-medium text-gray-500 hover:text-error-600 hover:bg-error-50 dark:text-gray-400'
            : 'no-touch-target p-1 text-gray-400 hover:text-error-600 hover:bg-error-50',
        )}
        title="Clear"
      >
        <Trash2 className="w-3.5 h-3.5 shrink-0" />
        {isMobileViewport && 'Clear'}
      </button>
    </>
  )

  return (
    <div className="group cursor-text" onClick={onStartEdit}>
      {hasOwn ? (
        <div className="relative">
          <div
            className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0 dark:text-gray-300"
            dangerouslySetInnerHTML={{ __html: own!.content }}
          />
          {isMobileViewport ? (
            <div className="flex items-center gap-1 mt-2 -ml-2.5 border-t border-gray-100 pt-2 dark:border-gray-800">
              {actions}
            </div>
          ) : (
            <div className="absolute right-0 top-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
              {actions}
            </div>
          )}
        </div>
      ) : (
        /* The empty state is the prompt itself, left-aligned with the prose
           that will replace it rather than centred — a centred button in an
           otherwise left-aligned card reads as a separate element instead of
           the absence of the content it stands in for. */
        <button
          onClick={(e) => { e.stopPropagation(); onStartEdit() }}
          className="w-full flex items-center gap-2 py-1.5 text-left text-sm text-gray-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors"
        >
          <Edit3 className="w-3.5 h-3.5 shrink-0" />
          {placeholder}
        </button>
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
      className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0 dark:text-gray-300"
      dangerouslySetInnerHTML={{ __html: contribution.content }}
    />
  )
}

