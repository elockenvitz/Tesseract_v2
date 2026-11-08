import React, { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import {
  Edit3,
  Check,
  X,
  Building2,
} from 'lucide-react'
import { Button } from '../../ui/Button'
import { RichTextEditor, type RichTextEditorRef } from '../../rich-text-editor/RichTextEditor'
import { useIsMobile } from '../../../hooks/useMediaQuery'
import { SmartInputRenderer } from '../../smart-input'
import { useAuth } from '../../../hooks/useAuth'
import { useOrgAudienceContext } from '../../../hooks/useOrgAudienceContext'
import { describeAudience } from '../../contributions/AudiencePicker'
import {
  useThemeContributionsV2,
  type ThemeContribution,
  type ThemeContributionVisibility,
  type ThemeResearchField,
} from '../../../hooks/useThemeResearch'

export type ThemeResearchActiveTab = 'aggregated' | string

interface ThemeContributionSectionProps {
  themeId: string
  field: ThemeResearchField
  activeTab: ThemeResearchActiveTab
  hideWhenEmpty?: boolean
  onTabChange?: (tab: ThemeResearchActiveTab) => void
  /**
   * The audience chosen on the toolbar, which every save on this page writes.
   *
   * It is a page-level control, as on the asset page, so it is passed in
   * rather than chosen here. A per-field select is what used to be here, and
   * it offered two levels the database ignored.
   */
  sharedVisibility?: ThemeContributionVisibility
  sharedTargetIds?: string[]
}

// Visual theme — matches asset ContributionSection styling
// `iconBg` / `iconColor` are gone with the icon tile they coloured. Leaving
// them would describe an element the card no longer has.
const TILE_THEME = {
  accent: 'border-l-blue-400',
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

/*
 * There is deliberately no per-field VisibilityBadge here any more.
 *
 * One lived at the top of every field and named that contribution's own
 * audience. It is gone because the audience is a page-level choice on this
 * page: the toolbar's `AudiencePicker` decides it and every save writes it,
 * so the badge restated one setting once per field and implied each field
 * could carry its own. The asset page passes `hideVisibility` to
 * `ContributionSection` for exactly that reason.
 *
 * What it USED to say is worth recording, because the information has not
 * gone anywhere and the toolbar is now its only home: a contribution whose
 * `visibility` is outside the five levels is a row written under the old
 * ('org','shared') vocabulary and reaches the whole firm, and a non-firm
 * level naming no group is readable by its author alone. The toolbar's
 * picker, and `describeAudience`, state both.
 */

// Component ----------------------------------------------------------------

export function ThemeContributionSection({
  themeId, field, activeTab, hideWhenEmpty = false, onTabChange,
  sharedVisibility, sharedTargetIds = [],
}: ThemeContributionSectionProps) {
  const { user } = useAuth()
  /* The same react-query entry the toolbar picker reads, so N fields on a
     theme share one org-chart fetch. See useOrgAudienceContext. */
  const { nodeById: audienceNodeById } = useOrgAudienceContext()
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
  const editorRef = useRef<RichTextEditorRef>(null)
  /** What the server said when it refused an audience, shown in place. */
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!isEditing) setDraft(ownContribution?.content || '')
  }, [ownContribution?.id, ownContribution?.content, isEditing])

  const startEdit = () => {
    setDraft(ownContribution?.content || '')
    setSaveError(null)
    setIsEditing(true)
  }
  const cancelEdit = () => {
    setIsEditing(false)
    setSaveError(null)
    setDraft(ownContribution?.content || '')
  }
  const commitEdit = async () => {
    setSaveError(null)
    try {
      await upsertContribution({
        section: field.slug,
        content: draft,
        /*
         * The toolbar's choice is forwarded on every save, as the asset page
         * does from its AssetTab host: the picker is the explicit audience
         * control, so its value is deliberate and a save has to carry it.
         * Omitting it would leave a first contribution at the 'firm' default
         * while the toolbar showed a restriction.
         *
         * Omitted entirely when the page has not resolved an audience yet, in
         * which case `undefined` means PRESERVE — never a silent 'firm'.
         */
        ...(sharedVisibility
          ? { visibility: sharedVisibility, targetIds: sharedTargetIds }
          : {}),
      })
      setIsEditing(false)
    } catch (e) {
      /*
       * Shown, not just logged. `set_theme_contribution_audience` refuses for
       * reasons the analyst can act on -- "a team audience must name at least
       * one group" -- and a console line the analyst never opens made a
       * refused save look like a successful one. The editor stays OPEN so the
       * prose survives.
       */
      console.error('[theme research] failed to save', e)
      setSaveError(
        e instanceof Error && e.message ? e.message : 'Could not save this research.'
      )
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
        {/* No icon tile.

            Every field on the theme page carried the same blue FileText
            square, so the icon identified nothing: it was a 28px block of
            colour repeated down the page, ahead of the one thing that does
            identify the field, its name. The asset page's section takes an
            `Icon` prop and the research surface passes none, for exactly
            this reason. */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            {/* Our View is read-only — title is static, no edit
                affordance. Editing happens from the user's own view tab. */}
            <h3 className="text-base font-semibold text-gray-900 truncate dark:text-white">{field.name}</h3>
            {lastUpdated && (
              <span className="text-xs text-gray-400">
                Updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
              </span>
            )}
            {/* No per-field audience badge.

                The audience is a PAGE-level choice here, made once on the
                toolbar and written by every save, so a "Firm" badge on each
                field restated the toolbar's own setting once per field and
                implied the field could differ from it. The asset page passes
                `hideVisibility` for the same reason. The toolbar's picker
                already says who can read this. */}
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
            audience={sharedVisibility
              ? describeAudience({ visibility: sharedVisibility, targetIds: sharedTargetIds }, audienceNodeById)
              : null}
            error={saveError}
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
            onStartEdit={startEdit}
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
  /** The audience this save will be written under, in words. Null before the
   *  page has resolved one, in which case the save preserves what is stored. */
  audience: string | null
  /** The server's refusal, if the last save was refused. */
  error: string | null
  onCancel: () => void
  onSave: () => Promise<void>
  isSaving: boolean
  editorRef: React.RefObject<RichTextEditorRef>
}

function InlineEditor({
  draft, setDraft, placeholder, audience, error,
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
      {error && (
        /* In place, beside the prose it refused to save, and the editor stays
           open. The message is the server's own. */
        <p className="text-xs text-red-600 dark:text-red-400" role="alert">{error}</p>
      )}
      {/* The audience and the commit pair share a line at desktop width and
          stack on a phone — the statement plus Cancel plus Save is wider than
          390px, and Save is not something to leave hanging off the edge. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 min-w-0">
          {/* A statement, not a control. The audience is chosen once on the
              toolbar for the whole page -- as on the asset page -- so a select
              here would be a second control over one value. What used to sit
              here offered "Org only" and "Shared", which named one reach
              twice: the policy ignored the column entirely. */}
          <span className="inline-flex items-center gap-1 min-w-0">
            <Building2 className="w-3 h-3 shrink-0" />
            <span className="truncate">
              {audience ? `Visible to ${audience}` : 'Audience unchanged'}
            </span>
          </span>
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

/**
 * The reader's own view of one field.
 *
 * ── No hover overlay, and no Clear ───────────────────────────────────────
 *
 * This used to pin a pencil and a bin to the top-right of the prose on
 * hover. Both are gone, because the asset page has neither and the reasons
 * it has neither apply here:
 *
 *  - The pencil was a THIRD way to start the same edit. The header already
 *    carries an Edit/Add pill, and the prose itself is click-to-edit. A
 *    control that duplicates the surface it floats over is not an
 *    affordance, it is a second thing to explain.
 *  - The bin was a destructive action, unconfirmed, one pixel from the
 *    pencil, over the user's own writing. Nothing else in the research
 *    surface offers that. Clearing a field is an edit: select the text and
 *    save it empty.
 *
 * The overlay also had to be special-cased for touch, where the base layer
 * reveals `opacity-0` hover controls outright and the two buttons landed on
 * top of the first line of the user's text. That case goes with it.
 */
function FocusedOwn({ own, onStartEdit }: {
  own: ThemeContribution | null
  onStartEdit: () => void
}) {
  const hasOwn = !!own && hasText(own.content)

  return (
    <div className="group cursor-text" onClick={onStartEdit}>
      {hasOwn ? (
        <div
          className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0 dark:text-gray-300"
          dangerouslySetInnerHTML={{ __html: own!.content }}
        />
      ) : (
        /* "Add your view", the asset page's words, not the field's own
           question.

           The question was the empty state here, which made the two pages
           ask for the same thing in two different registers, and made the
           absence of content look like content. The question is not lost:
           it is the editor's placeholder, which is where it does its work,
           at the moment the user is about to answer it.

           Left-aligned with the prose that will replace it rather than
           centred, because a centred button in an otherwise left-aligned
           card reads as a separate element instead of the absence of the
           thing it stands in for. */
        <button
          onClick={(e) => { e.stopPropagation(); onStartEdit() }}
          className="inline-flex items-center gap-1.5 -ml-2 px-2 py-1 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors dark:hover:bg-primary-900/20"
        >
          <Edit3 className="w-3.5 h-3.5 shrink-0" />
          Add your view
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

