/**
 * The expanded list row: a working surface for one security, not a dashboard.
 *
 * ── What it answers, and why there are no headings saying so ──────────────
 *
 * A reader opening a row wants to know what we believe, what has changed,
 * what we are doing about it, who is involved, and what they can do next.
 * Those five questions are the INFORMATION ARCHITECTURE — the order and the
 * visual weight — and deliberately not section titles. Boxes labelled "What's
 * changed?" would be a dashboard about the questions rather than a surface
 * that answers them.
 *
 * So the layout answers them positionally:
 *
 *   strip        price, position, rating, conviction, target — orientation
 *   case         thesis and where we differ, dominant, summarised to scan
 *   since review newest evidence, directly under the case it may contradict
 *   right rail   active idea / decision, then who owns it
 *   footer       one primary action, and the way into the full case
 *
 * "Since review" sits immediately below the case on purpose. The adjacency IS
 * the point: the question a list is for is whether what we wrote still holds,
 * and `isNewSinceReview` is derived from two real timestamps rather than
 * guessed, so it can carry that weight honestly.
 *
 * ── The height contract ───────────────────────────────────────────────────
 *
 * `AssetTableView` gives every expanded row a FIXED height by density
 * (360/320/260/220px) because its virtualiser must know row sizes up front.
 * Nothing here may grow the row. So the case and the rail scroll internally,
 * the strip and footer are fixed, and the entrance animates OPACITY and a
 * small translate — never height, which would fight the virtualiser and
 * shift the reader's position in the list.
 *
 * Single-open, chevron/double-click/Enter/Esc and scroll-into-view all stay
 * where they are: `AssetTableView` owns them and this component is only the
 * slot's content.
 *
 * ── Where the data comes from ─────────────────────────────────────────────
 *
 * `useAssetWorkspace` already returns sections, evidence, caseWrittenAt,
 * spot, target, positions, liveIdeas and decisions in one call, so the case,
 * the change and the active work are one hook rather than six. Ratings are a
 * second hook because the workspace does not carry them. Coverage is PASSED
 * IN: the table already resolved it for the whole page, and re-reading it per
 * row would be the same query again.
 *
 * `focus: 'overview'` is deliberate — it selects the shallow price history,
 * which is all a row needs and a fraction of the deep window the Asset page
 * pulls.
 */
import React, { useState, useEffect, useMemo } from 'react'
import { ExternalLink, Flag, ArrowUpRight, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import { RowLabel, StateCell, RatingPill, ConvictionBars, CoverageChip } from './ListRowAtoms'
import { useUpdateListItem } from '../../hooks/lists/useUpdateListItem'
import { useAssetWorkspace } from '../../hooks/useAssetWorkspace'
import { useAnalystRatings, useRatingScales } from '../../hooks/useAnalystRatings'
import { CORE_SECTIONS, SECTION_LABEL } from '../../lib/desktop-research/model'

export interface ListRowCoverage {
  analyst: string
  team: string
  isLead: boolean
}

interface ListRowExpansionProps {
  listId: string
  rowId: string
  asset: any
  canEdit: boolean
  /** Resolved by the table for the whole page. Absent on mobile, which is fine. */
  coverage?: ListRowCoverage[]
  onOpenAsset?: () => void
}

export function ListRowExpansion({
  listId,
  rowId,
  asset,
  canEdit,
  coverage,
  onOpenAsset,
}: ListRowExpansionProps) {
  const status = asset._status ?? null
  const assignee = asset._assignee ?? null
  const tags = asset._tags ?? []
  const dueDate: string | null = asset._dueDate ?? null
  const isFlagged: boolean = !!asset._isFlagged
  const listNote: string = asset._listNotes ?? ''

  const updateItem = useUpdateListItem(listId)

  // `useAssetWorkspace` returns `{ data, isLoading, error }` and `data` is
  // never undefined — it falls back to an EMPTY shape — so the fields below
  // can be read without guarding every one.
  const { data: workspace } = useAssetWorkspace(asset?.id ?? null, asset?.symbol ?? null, 'overview')
  const { ratings } = useAnalystRatings({ assetId: asset?.id })
  const { scales } = useRatingScales()

  /*
   * One rating, chosen the way the rest of the product chooses it: the
   * organisation's official rating if there is one, else the most recently
   * updated. A row has space for one answer, and silently showing an
   * arbitrary analyst's would be worse than showing the official one.
   */
  const rating = useMemo(() => {
    const rows = ratings ?? []
    if (rows.length === 0) return null
    const official = rows.find((r: any) => r.is_official)
    if (official) return official
    return [...rows].sort((a: any, b: any) =>
      Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))[0]
  }, [ratings])

  const ratingColor = useMemo(() => {
    if (!rating) return null
    const scale = (scales ?? []).find((s: any) => s.id === rating.rating_scale_id)
    return scale?.values?.find((v: any) => v.value === rating.rating_value)?.color ?? null
  }, [rating, scales])

  // Local drafts; commit on blur so the cache stays calm while typing.
  const [dueDraft, setDueDraft] = useState(dueDate ?? '')
  const [noteDraft, setNoteDraft] = useState(listNote)
  useEffect(() => { setDueDraft(dueDate ?? '') }, [dueDate])
  useEffect(() => { setNoteDraft(listNote) }, [listNote])

  const commitDue = () => {
    if ((dueDraft || null) !== dueDate) {
      updateItem.mutate({ itemId: rowId, updates: { due_date: dueDraft || null } })
    }
  }
  const commitNote = () => {
    if (noteDraft !== listNote) {
      updateItem.mutate({ itemId: rowId, updates: { notes: noteDraft } })
    }
  }
  const toggleFlag = () => {
    updateItem.mutate({ itemId: rowId, updates: { is_flagged: !isFlagged } })
  }

  const { spot, target, positions, liveIdeas, decisions, sections, evidence, caseWrittenAt } = workspace

  /** The book this list reader most plausibly means: the largest weight. */
  const primaryPosition = useMemo(() => {
    const withWeight = (positions ?? []).filter(p => p.weightPct != null)
    if (withWeight.length === 0) return (positions ?? [])[0] ?? null
    return [...withWeight].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))[0]
  }, [positions])

  const upsidePct = spot != null && spot > 0 && target != null
    ? ((target - spot) / spot) * 100
    : null

  /*
   * The case, core sections only, in the product's own order.
   *
   * `CORE_SECTIONS` is thesis / where_different / risks_to_thesis. The row
   * shows the first two — what we believe and why we differ — because those
   * are the dominant content the reader came for. Risks stay on the Asset
   * page: a row that tried to carry the whole case would become it.
   */
  const caseSections = useMemo(() => {
    // Derived from CORE_SECTIONS rather than a second hardcoded list, so a core
    // section added to the product appears here too. `risks_to_thesis` is the
    // one deliberate exclusion.
    const wanted = CORE_SECTIONS.filter(s => s !== 'risks_to_thesis')
    return wanted
      .map(key => (sections ?? []).find(s => s.section === key))
      .filter((s): s is NonNullable<typeof s> => !!s && !!(s.content ?? '').trim())
  }, [sections])

  /** Newest first, and whatever arrived after the case was written leads. */
  const changes = useMemo(() => {
    const items = [...(evidence ?? [])]
    items.sort((a, b) => {
      if (a.isNewSinceReview !== b.isNewSinceReview) return a.isNewSinceReview ? -1 : 1
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    return items.slice(0, 3)
  }, [evidence])

  const newSinceReview = (evidence ?? []).filter(e => e.isNewSinceReview).length
  const activeIdea = (liveIdeas ?? [])[0] ?? null
  const latestDecision = (decisions ?? [])[0] ?? null

  /*
   * One primary action, chosen from state rather than offered as a menu.
   *
   * The useful next move differs: an unreviewed change wants reading, a live
   * idea wants opening, an unwritten case wants writing. All three land in the
   * Asset workspace — this row proposes the move and does not try to be the
   * place it happens.
   */
  const primaryAction = useMemo(() => {
    if (newSinceReview > 0) {
      return { label: `Review ${newSinceReview} new`, icon: Sparkles }
    }
    if (activeIdea) return { label: 'Open active idea', icon: ArrowUpRight }
    if (caseSections.length === 0) return { label: 'Write the case', icon: ArrowUpRight }
    return null
  }, [newSinceReview, activeIdea, caseSections.length])

  return (
    /*
     * `animate-in` is the entrance: opacity and a 2px lift, 150ms, matching
     * the chevron's existing 150ms rotate. No height transition — see the
     * height contract above.
     */
    <div
      data-testid="list-row-expansion"
      className="flex flex-col h-full max-sm:h-auto sm:overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150"
    >
      {/* ── Orientation strip ─────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center gap-4 pb-2.5 mb-2.5 border-b border-gray-100 dark:border-gray-800 overflow-x-auto">
        <div className="flex items-baseline gap-2 min-w-0 flex-shrink-0">
          <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {asset.symbol}
          </span>
          {asset.company_name && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[160px]">
              {asset.company_name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-5 flex-shrink-0">
          <StateCell label="Price" value={spot != null ? `$${spot.toFixed(2)}` : null} />
          <StateCell
            label="Position"
            value={
              primaryPosition?.weightPct != null
                ? `${primaryPosition.weightPct.toFixed(2)}%`
                : primaryPosition
                  ? `${primaryPosition.shares.toLocaleString()} sh`
                  : null
            }
            title={primaryPosition?.portfolioName ?? undefined}
          />
          {rating && (
            <div className="flex flex-col gap-0.5">
              <RowLabel>Rating</RowLabel>
              <div className="flex items-center gap-1.5 leading-none">
                <RatingPill value={rating.rating_value} color={ratingColor} />
                {rating.conviction && <ConvictionBars level={rating.conviction} />}
              </div>
            </div>
          )}
          <StateCell label="Target" value={target != null ? `$${target.toFixed(2)}` : null} />
          <StateCell
            label="Upside"
            value={upsidePct != null ? `${upsidePct > 0 ? '+' : ''}${upsidePct.toFixed(1)}%` : null}
            tone={upsidePct == null ? 'default' : upsidePct >= 0 ? 'positive' : 'negative'}
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_260px] gap-4 sm:gap-6 sm:overflow-hidden">

        {/* ── The case, then what has changed since it was written ────── */}
        <main className="min-w-0 sm:overflow-y-auto sm:pr-1">
          {caseSections.length > 0 ? (
            <div className="space-y-3">
              {caseSections.map(s => (
                <div key={s.section}>
                  <div className="flex items-baseline gap-2 mb-1">
                    <RowLabel>{SECTION_LABEL[s.section] ?? s.section}</RowLabel>
                    {s.authorName && (
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {s.authorName}
                      </span>
                    )}
                  </div>
                  {/* Clamped, not truncated mid-render: the full text is one
                      click away in the case, and an unbounded thesis would
                      push "since review" out of a fixed-height row. */}
                  <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-4 whitespace-pre-wrap">
                    {s.content}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-xs text-gray-400 dark:text-gray-600 italic">
              No case written yet.
            </div>
          )}

          {changes.length > 0 && (
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-baseline gap-2 mb-1.5">
                <RowLabel>Since review</RowLabel>
                {caseWrittenAt && (
                  <span className="text-[10px] text-gray-400 dark:text-gray-500">
                    case written {formatDistanceToNow(new Date(caseWrittenAt), { addSuffix: true })}
                  </span>
                )}
              </div>
              <div className="space-y-1.5">
                {changes.map(c => (
                  <div key={c.id} className="flex items-start gap-1.5 text-[12px] leading-snug">
                    {c.isNewSinceReview && (
                      <span className="mt-[5px] h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <span className={clsx(
                        'truncate',
                        c.isNewSinceReview
                          ? 'text-gray-800 dark:text-gray-100 font-medium'
                          : 'text-gray-600 dark:text-gray-400',
                      )}>
                        {c.title || 'Untitled note'}
                      </span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1.5">
                        {c.authorName ? `${c.authorName} · ` : ''}
                        {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>

        {/* ── Active work and who owns it ─────────────────────────────── */}
        <aside className="min-w-0 border-t pt-3 sm:border-t-0 sm:pt-0 sm:border-l border-gray-200 dark:border-gray-800 sm:pl-5 flex flex-col sm:overflow-y-auto">
          {(activeIdea || latestDecision) && (
            <div className="flex-shrink-0 mb-3">
              <RowLabel>Active work</RowLabel>
              <div className="mt-1 space-y-1">
                {activeIdea && (
                  <div className="text-[12px] text-gray-800 dark:text-gray-200">
                    <span className="font-semibold uppercase text-[10px] tracking-wide text-primary-700 dark:text-primary-300">
                      {activeIdea.action ?? 'idea'}
                    </span>
                    {activeIdea.stage && (
                      <span className="text-gray-500 dark:text-gray-400"> · {activeIdea.stage}</span>
                    )}
                    {activeIdea.portfolioName && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                        {activeIdea.portfolioName}
                      </div>
                    )}
                  </div>
                )}
                {latestDecision && (
                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                    {latestDecision.status}
                    {latestDecision.decidedAt && (
                      <> · {formatDistanceToNow(new Date(latestDecision.decidedAt), { addSuffix: true })}</>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex-shrink-0 space-y-2">
            {coverage && coverage.length > 0 && (
              <MetaRow label="Covered">
                <div className="flex flex-col gap-0.5 min-w-0">
                  {coverage.slice(0, 2).map((c, i) => (
                    <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
                  ))}
                </div>
              </MetaRow>
            )}
            <MetaRow label="Owner">
              <ListAssigneeCell rowId={rowId} listId={listId} assignee={assignee} canEdit={canEdit} />
            </MetaRow>
            <MetaRow label="Status">
              <ListStatusCell rowId={rowId} listId={listId} status={status} canEdit={canEdit} />
            </MetaRow>
            <MetaRow label="Due">
              {canEdit ? (
                <input
                  type="date"
                  value={dueDraft}
                  onChange={e => setDueDraft(e.target.value)}
                  onBlur={commitDue}
                  className="w-full text-xs px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500"
                />
              ) : dueDate ? (
                <span className="text-xs text-gray-700 dark:text-gray-300">
                  {format(parseISO(dueDate), 'MMM d, yyyy')}
                </span>
              ) : (
                <span className="text-xs text-gray-400">Not set</span>
              )}
            </MetaRow>
            <MetaRow label="Tags">
              <ListTagsCell rowId={rowId} listId={listId} tags={tags} canEdit={canEdit} />
            </MetaRow>
            <div>
              <RowLabel>List note</RowLabel>
              {canEdit ? (
                <textarea
                  value={noteDraft}
                  onChange={e => setNoteDraft(e.target.value)}
                  onBlur={commitNote}
                  placeholder="Why this name is on this list…"
                  rows={2}
                  className="mt-1 w-full text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none leading-relaxed"
                />
              ) : (
                <div className="mt-1 text-xs text-gray-600 dark:text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {listNote || <span className="text-gray-400">—</span>}
                </div>
              )}
            </div>
          </div>
        </aside>
      </div>

      {/* ── One primary action, and the way into the full case ────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 pt-2.5 mt-2.5 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          {primaryAction && onOpenAsset && (
            <button
              onClick={onOpenAsset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors flex-shrink-0"
            >
              <primaryAction.icon className="h-3 w-3" />
              {primaryAction.label}
            </button>
          )}
          <button
            onClick={canEdit ? toggleFlag : undefined}
            disabled={!canEdit}
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors',
              isFlagged
                ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30'
                : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100 dark:hover:text-gray-200 dark:hover:bg-gray-800 dark:text-gray-400',
              !canEdit && 'cursor-default',
            )}
          >
            <Flag className={clsx('h-3 w-3', isFlagged && 'fill-current')} />
            {isFlagged ? 'Flagged' : 'Flag'}
          </button>
        </div>

        {onOpenAsset && (
          <button
            onClick={onOpenAsset}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-primary-700 hover:bg-primary-50 dark:text-gray-400 dark:hover:text-primary-300 dark:hover:bg-primary-900/20 rounded-md transition-colors flex-shrink-0"
          >
            Open full case
            <ExternalLink className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  )
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-14 flex-shrink-0 pt-1">
        <RowLabel>{label}</RowLabel>
      </div>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
