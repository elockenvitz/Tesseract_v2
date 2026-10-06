/**
 * The List workspace: one expandable surface for one security, in six modes.
 *
 * ── Why the clicked field decides the mode ────────────────────────────────
 *
 * A reader who clicks Target is asking what the name is worth. One who clicks
 * the Work badge is asking what needs doing. Opening the same summary for both
 * makes them navigate twice to reach what they already pointed at — so the
 * expansion opens on the content the clicked field names, and the mode switch
 * exists to move on from there rather than to be the first decision. The map
 * lives in `listRowModes`; the table hands the clicked column in as
 * `entryColumnId`.
 *
 * Modes offered are filtered by what this security actually has: no Position
 * tab on an unheld name, no Market tab without prices. A switch full of empty
 * tabs is a worse answer than a shorter switch.
 *
 * ── The height contract ───────────────────────────────────────────────────
 *
 * `AssetTableView` gives every expanded row a FIXED height by density
 * (360/320/260/220px) because its virtualiser must know row sizes up front.
 * Nothing here may grow the row. So each mode's body is `flex-1 min-h-0` and
 * scrolls internally; the header and footer are fixed; and the entrance
 * animates OPACITY and a small translate — never height, which would fight the
 * virtualiser and move the reader's place in the list.
 *
 * Each mode fills the canvas rather than sitting in a card. There is no
 * permanent right rail: the first version kept a 260px meta column that was
 * empty on most rows, which is what made the panel read as an inserted card
 * with dead space.
 *
 * ── Writes ────────────────────────────────────────────────────────────────
 *
 * Every write goes through the path the rest of the product uses. Nothing here
 * is a second writer:
 *
 *   case text          `useContributions().saveContribution`
 *   rating/conviction  `useAnalystRatings().saveRating`
 *   review verdict     `useRecordThesisReview`  (a `thesis.reviewed` event)
 *   list fields        `useUpdateListItem`
 *   new idea           `onCreateTradeIdea` → `ListTab`'s `AddTradeIdeaModal`
 *
 * Price targets, recommendations and idea stage moves are NOT written here:
 * each needs a scenario, a sizing decision or stage validation that a row
 * cannot honestly collect, so those link into their own workspace.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ExternalLink, Flag, ArrowUpRight, Plus, Check, Pencil } from 'lucide-react'
import { clsx } from 'clsx'
import { format, parseISO, formatDistanceToNow } from 'date-fns'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import { RowLabel, RatingPill, CoverageChip } from './ListRowAtoms'
import { Sparkline } from '../signals/Sparkline'
import {
  MODE_ORDER, MODE_LABEL, modeForEntryColumn, type ListRowMode,
} from './listRowModes'
import { useUpdateListItem } from '../../hooks/lists/useUpdateListItem'
import { useAssetWorkspace } from '../../hooks/useAssetWorkspace'
import {
  useAnalystRatings, useRatingScales,
  type ConvictionLevel,
} from '../../hooks/useAnalystRatings'
import { useRecordThesisReview, type ThesisReviewOutcome } from '../../hooks/useThesisReview'
import { useContributions } from '../../hooks/useContributions'
import { CORE_SECTIONS, SECTION_LABEL, STATE_LABEL } from '../../lib/desktop-research/model'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'

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
  /** The column the row was opened from. Decides the initial mode. */
  entryColumnId?: string
  /** Batched for the whole list by `useListRowSignals`. */
  signal?: ListRowSignal
  onOpenAsset?: () => void
  /**
   * Opens the page-level `AddTradeIdeaModal` with this asset preselected.
   *
   * Raised to the page deliberately: `ListTab` already owns that modal, and a
   * modal rendered from inside a virtualised row would be unmounted by a
   * scroll.
   */
  onCreateTradeIdea?: (assetId: string) => void
}

/**
 * The three verdicts a review can reach, in `ResearchDetail`'s wording.
 *
 * Same list, same order, same labels — a reader who reviews from a list row
 * and one who reviews from the research surface must be recording the same
 * three things, or the stale clock means two different things depending on
 * where it was cleared.
 */
const REVIEW_CHOICES: ReadonlyArray<{ outcome: ThesisReviewOutcome; label: string }> = [
  { outcome: 'holds', label: 'Still holds' },
  { outcome: 'changed', label: 'Changed' },
  { outcome: 'needs_work', label: 'Needs work' },
]

const CONVICTION_CHOICES: readonly ConvictionLevel[] = ['low', 'medium', 'high']

export function ListRowExpansion({
  listId,
  rowId,
  asset,
  canEdit,
  coverage,
  entryColumnId,
  signal,
  onOpenAsset,
  onCreateTradeIdea,
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
  const { ratings, saveRating } = useAnalystRatings({ assetId: asset?.id })
  const { scales } = useRatingScales()
  const { saveContribution } = useContributions({ assetId: asset?.id })
  /*
   * Recording a review already has a canonical writer:
   * `useRecordThesisReview` inserts a `thesis.reviewed` memory event,
   * idempotent on a per-submit request id, which `useDesktopResearch` folds
   * back in as `lastReviewedAt` and `stateOf` reads. So "reviewed, nothing
   * changed" clears the clock here exactly as it does on the research surface.
   */
  const review = useRecordThesisReview(asset?.id ?? null)

  const { spot, target, positions, liveIdeas, decisions, sections, evidence, caseWrittenAt, ladder } = workspace

  // ── Derived investment state ─────────────────────────────────────────

  /**
   * One rating, chosen the way the rest of the product chooses it: the
   * organisation's official rating if there is one, else the most recently
   * updated. A row has space for one answer.
   */
  const rating = useMemo(() => {
    const rows = ratings ?? []
    if (rows.length === 0) return null
    const official = rows.find((r: any) => r.is_official)
    if (official) return official
    return [...rows].sort((a: any, b: any) =>
      Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))[0]
  }, [ratings])

  /*
   * The scale this row writes against: the one the existing rating already
   * uses, else the organisation's default. Never a scale invented here — a
   * rating recorded against the wrong scale produces a value string that
   * matches no configured value, and it then drops silently out of every
   * colour and consensus read.
   */
  const activeScale = useMemo(() => {
    const all = scales ?? []
    if (rating) {
      const own = all.find((s: any) => s.id === rating.rating_scale_id)
      if (own) return own
    }
    return all.find((s: any) => s.is_default) ?? all[0] ?? null
  }, [rating, scales])

  const ratingColor = useMemo(() => {
    if (!rating) return null
    const scale = (scales ?? []).find((s: any) => s.id === rating.rating_scale_id)
    return scale?.values?.find((v: any) => v.value === rating.rating_value)?.color ?? null
  }, [rating, scales])

  /** The book this list reader most plausibly means: the largest weight. */
  const primaryPosition = useMemo(() => {
    const withWeight = (positions ?? []).filter(p => p.weightPct != null)
    if (withWeight.length === 0) return (positions ?? [])[0] ?? null
    return [...withWeight].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))[0]
  }, [positions])

  const upsidePct = spot != null && spot > 0 && target != null
    ? ((target - spot) / spot) * 100
    : null

  /**
   * The case, core sections in the product's own order.
   *
   * Derived from `CORE_SECTIONS` rather than a second hardcoded list, so a core
   * section added to the product appears here too.
   */
  const caseSections = useMemo(
    () => CORE_SECTIONS.map(key => ({
      key,
      row: (sections ?? []).find(s => s.section === key) ?? null,
    })),
    [sections],
  )
  const writtenCaseSections = useMemo(
    () => caseSections.filter(s => !!(s.row?.content ?? '').trim()),
    [caseSections],
  )

  /** Newest first, and whatever arrived after the case was written leads. */
  const changes = useMemo(() => {
    const items = [...(evidence ?? [])]
    items.sort((a, b) => {
      if (a.isNewSinceReview !== b.isNewSinceReview) return a.isNewSinceReview ? -1 : 1
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    return items
  }, [evidence])

  const newSinceReview = (evidence ?? []).filter(e => e.isNewSinceReview).length
  const activeIdea = (liveIdeas ?? [])[0] ?? null
  const latestDecision = (decisions ?? [])[0] ?? null

  // ── Modes ────────────────────────────────────────────────────────────

  const hasPosition = (positions ?? []).length > 0
  const hasMarket = (signal?.closes?.length ?? 0) > 1 || spot != null
  const hasValuation = target != null || spot != null

  /**
   * Only the modes this security can actually answer.
   *
   * Overview, Case and Work are always offered: the first orients, and the
   * other two are meaningful precisely when they are empty — an unwritten case
   * and an unstarted piece of work are the things a list is for.
   */
  const availableModes = useMemo(
    () => MODE_ORDER.filter(m => {
      if (m === 'market') return hasMarket
      if (m === 'valuation') return hasValuation
      if (m === 'position') return hasPosition
      return true
    }),
    [hasMarket, hasValuation, hasPosition],
  )

  const [mode, setMode] = useState<ListRowMode>(() => modeForEntryColumn(entryColumnId))

  /*
   * Re-enter on the clicked field.
   *
   * Clicking a second cell on a row that is ALREADY open changes
   * `entryColumnId`, which is the reader restating their intent — so the mode
   * follows. Switching tabs by hand does not change `entryColumnId`, so this
   * does not fight the switch.
   */
  useEffect(() => { setMode(modeForEntryColumn(entryColumnId)) }, [entryColumnId])

  /** A mode that stopped being available must not leave a blank canvas. */
  const activeMode = availableModes.includes(mode) ? mode : 'overview'

  // ── Writes ───────────────────────────────────────────────────────────

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

  /**
   * Set the rating, or its conviction, through the canonical writer.
   *
   * Not gated on `canEdit`: that is permission to curate THIS list row, and a
   * rating is the reader's own org-level judgement on the security —
   * `saveRating` writes the current user's rating, keyed on (asset, user, org).
   */
  const commitRating = (next: { value?: string; conviction?: ConvictionLevel | null }) => {
    const ratingValue = next.value ?? rating?.rating_value
    if (!activeScale || !ratingValue) return
    saveRating.mutate({
      ratingValue,
      ratingScaleId: activeScale.id,
      conviction: next.conviction !== undefined ? next.conviction : rating?.conviction ?? null,
    })
  }

  /**
   * Save one case section.
   *
   * `saveContribution` resolves the user and org itself, does its own
   * existing-row lookup, and invalidates `contributions` AND `desktop-research`
   * — so a save made here moves the review anchor that `newSinceReview` is
   * measured against. That is the whole reason editing the case from a list row
   * is worth having: it is the only honest way to clear "3 new".
   */
  const commitSection = useCallback(async (sectionKey: string, content: string) => {
    await saveContribution.mutateAsync({ content, sectionKey })
  }, [saveContribution])

  // ── Footer action, chosen from state ─────────────────────────────────

  const primaryAction = useMemo(() => {
    /*
     * Work mode IS this action, at full size and with the evidence attached.
     * Repeating it in the footer gave the reader two "Write the case" buttons
     * and two "Review due" labels in one view.
     */
    if (activeMode === 'work') return null
    // Unreviewed evidence is answerable HERE — a verdict, not a trip to another
    // surface. Everything below it needs a surface this row is not.
    if (newSinceReview > 0 && !!asset?.id) return { kind: 'review' as const }
    if (activeIdea) return { kind: 'open' as const, label: 'Open active idea', icon: ArrowUpRight }
    if (writtenCaseSections.length === 0) return { kind: 'case' as const, label: 'Write the case', icon: Pencil }
    if (onCreateTradeIdea) return { kind: 'idea' as const, label: 'Start an idea', icon: Plus }
    return null
  }, [activeMode, newSinceReview, activeIdea, writtenCaseSections.length, onCreateTradeIdea, asset?.id])

  const reviewGroup = (
    review.isDone ? (
      <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
        <Check className="h-3 w-3" />
        Review recorded
      </span>
    ) : (
      <div className="flex items-center gap-1.5 min-w-0">
        {REVIEW_CHOICES.map(({ outcome, label }) => (
          <button
            key={outcome}
            onClick={() => review.record(outcome)}
            disabled={review.isPending}
            className={clsx(
              'px-2 py-1 text-[11px] font-semibold rounded-md transition-colors flex-shrink-0',
              outcome === 'holds'
                ? 'bg-primary-600 text-white hover:bg-primary-700'
                : 'text-gray-600 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700',
              review.isPending && 'opacity-50 cursor-wait',
            )}
          >
            {label}
          </button>
        ))}
      </div>
    )
  )

  return (
    /*
     * `animate-in` is the entrance: opacity and a 2px lift, 150ms, matching the
     * chevron's existing 150ms rotate. No height transition — see the height
     * contract above.
     */
    <div
      data-testid="list-row-expansion"
      data-mode={activeMode}
      className="flex flex-col h-full max-sm:h-auto sm:overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150"
    >
      {/* ── Identity and the mode switch ──────────────────────────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-4 pb-2 mb-2 border-b border-gray-100 dark:border-gray-800">
        <div className="flex items-baseline gap-2 min-w-0">
          <span className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-100">
            {asset.symbol}
          </span>
          {asset.company_name && (
            <span className="text-xs text-gray-400 dark:text-gray-500 truncate max-w-[220px]">
              {asset.company_name}
            </span>
          )}
          {/* Suppressed in Work mode, which states the same thing as its own
              heading — two copies of "Review due" in one view is noise. */}
          {signal?.state && signal.state !== 'current' && activeMode !== 'work' && (
            <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 flex-shrink-0">
              {STATE_LABEL[signal.state]}
            </span>
          )}
        </div>

        {/* Text tabs, not buttons in boxes: the switch is a way back, not the
            surface's main furniture. */}
        <div className="flex items-center gap-0.5 flex-shrink-0" role="tablist">
          {availableModes.map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={activeMode === m}
              onClick={() => setMode(m)}
              className={clsx(
                'px-2 py-0.5 rounded text-[11px] font-medium transition-colors',
                activeMode === m
                  ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900'
                  : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800',
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {/* ── The canvas ────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 sm:overflow-y-auto sm:pr-1">
        {activeMode === 'overview' && (
          <OverviewMode
            spot={spot}
            target={target}
            upsidePct={upsidePct}
            primaryPosition={primaryPosition}
            rating={rating}
            ratingColor={ratingColor}
            writtenCaseSections={writtenCaseSections}
            newSinceReview={newSinceReview}
            activeIdea={activeIdea}
            coverage={coverage}
            listId={listId}
            rowId={rowId}
            assignee={assignee}
            status={status}
            tags={tags}
            canEdit={canEdit}
            dueDate={dueDate}
            dueDraft={dueDraft}
            setDueDraft={setDueDraft}
            commitDue={commitDue}
            noteDraft={noteDraft}
            setNoteDraft={setNoteDraft}
            commitNote={commitNote}
            listNote={listNote}
          />
        )}

        {activeMode === 'market' && (
          <MarketMode spot={spot} target={target} upsidePct={upsidePct} signal={signal} />
        )}

        {activeMode === 'case' && (
          <CaseMode
            caseSections={caseSections}
            caseWrittenAt={caseWrittenAt}
            rating={rating}
            ratingColor={ratingColor}
            activeScale={activeScale}
            commitRating={commitRating}
            savingRating={saveRating.isPending}
            commitSection={commitSection}
            symbol={asset.symbol}
          />
        )}

        {activeMode === 'valuation' && (
          <ValuationMode
            spot={spot}
            target={target}
            upsidePct={upsidePct}
            ladder={ladder}
            onOpenAsset={onOpenAsset}
          />
        )}

        {activeMode === 'position' && (
          <PositionMode positions={positions ?? []} spot={spot} />
        )}

        {activeMode === 'work' && (
          <WorkMode
            newSinceReview={newSinceReview}
            changes={changes}
            caseWrittenAt={caseWrittenAt}
            hasCase={writtenCaseSections.length > 0}
            state={signal?.state ?? null}
            activeIdea={activeIdea}
            latestDecision={latestDecision}
            reviewGroup={reviewGroup}
            onGoToCase={() => setMode('case')}
            onOpenAsset={onOpenAsset}
            onCreateTradeIdea={onCreateTradeIdea ? () => onCreateTradeIdea(asset.id) : undefined}
          />
        )}
      </div>

      {/* ── One primary action, and the way into the full case ────────── */}
      <div className="flex-shrink-0 flex items-center justify-between gap-3 pt-2 mt-2 border-t border-gray-100 dark:border-gray-800">
        <div className="flex items-center gap-2 min-w-0">
          {/* Work mode shows the verdict beside the evidence; everywhere else
              the footer carries it, so an unreviewed change is answerable
              without changing tab. `primaryAction` is null in Work mode. */}
          {primaryAction?.kind === 'review' && (
            <>
              <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">
                {newSinceReview} new · does the case hold?
              </span>
              {reviewGroup}
            </>
          )}

          {primaryAction?.kind === 'idea' && (
            <button
              onClick={() => onCreateTradeIdea!(asset.id)}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors flex-shrink-0"
            >
              <primaryAction.icon className="h-3 w-3" />
              {primaryAction.label}
            </button>
          )}

          {primaryAction?.kind === 'case' && (
            <button
              onClick={() => setMode('case')}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors flex-shrink-0"
            >
              <primaryAction.icon className="h-3 w-3" />
              {primaryAction.label}
            </button>
          )}

          {primaryAction?.kind === 'open' && onOpenAsset && (
            <button
              onClick={onOpenAsset}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700 transition-colors flex-shrink-0"
            >
              <primaryAction.icon className="h-3 w-3" />
              {primaryAction.label}
            </button>
          )}

          {review.error && (
            <span className="text-[11px] text-rose-600 dark:text-rose-400 truncate">
              Review not saved
            </span>
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

// ── Shared pieces ──────────────────────────────────────────────────────

/**
 * One fact. Renders nothing without a value.
 *
 * The strip is orientation, and a row of "—" placeholders makes a thin case
 * look like a broken one.
 */
function Fact({
  label, value, tone = 'default', title,
}: {
  label: string
  value: React.ReactNode
  tone?: 'default' | 'positive' | 'negative'
  title?: string
}) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex flex-col gap-0.5 min-w-0" title={title}>
      <RowLabel>{label}</RowLabel>
      <div className={clsx(
        'text-[13px] font-semibold tabular-nums leading-none truncate',
        tone === 'positive' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'negative' && 'text-rose-600 dark:text-rose-400',
        tone === 'default' && 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </div>
    </div>
  )
}

const money = (n: number) => `$${n.toFixed(2)}`
const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full flex items-center justify-center">
      <span className="text-xs text-gray-400 dark:text-gray-600 italic">{children}</span>
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────────────

/**
 * Orientation plus the list's own fields, in one pass down the canvas.
 *
 * No right rail. The meta fields are a wrapping row at the bottom because they
 * are short, and a 260px column reserved for them was empty on most rows —
 * which is what made this panel read as a card with dead space in it.
 */
function OverviewMode(p: {
  spot: number | null
  target: number | null
  upsidePct: number | null
  primaryPosition: any
  rating: any
  ratingColor: string | null
  writtenCaseSections: Array<{ key: string; row: any }>
  newSinceReview: number
  activeIdea: any
  coverage?: ListRowCoverage[]
  listId: string
  rowId: string
  assignee: any
  status: any
  tags: any[]
  canEdit: boolean
  dueDate: string | null
  dueDraft: string
  setDueDraft: (v: string) => void
  commitDue: () => void
  noteDraft: string
  setNoteDraft: (v: string) => void
  commitNote: () => void
  listNote: string
}) {
  return (
    <div className="flex flex-col gap-2.5 h-full">
      {/* Facts */}
      <div className="flex items-start gap-6 flex-wrap flex-shrink-0">
        <Fact label="Price" value={p.spot != null ? money(p.spot) : null} />
        <Fact
          label="Position"
          value={
            p.primaryPosition?.weightPct != null
              ? `${p.primaryPosition.weightPct.toFixed(2)}%`
              : p.primaryPosition
                ? `${p.primaryPosition.shares.toLocaleString()} sh`
                : null
          }
          title={p.primaryPosition?.portfolioName ?? undefined}
        />
        {p.rating && (
          <div className="flex flex-col gap-0.5">
            <RowLabel>View</RowLabel>
            <div className="flex items-center gap-1.5 leading-none">
              <RatingPill value={p.rating.rating_value} color={p.ratingColor} />
              {p.rating.conviction && (
                <span className="text-[10px] text-gray-500 dark:text-gray-400">
                  {p.rating.conviction}
                </span>
              )}
            </div>
          </div>
        )}
        <Fact label="Target" value={p.target != null ? money(p.target) : null} />
        <Fact
          label="Upside"
          value={p.upsidePct != null ? pct(p.upsidePct) : null}
          tone={p.upsidePct == null ? 'default' : p.upsidePct >= 0 ? 'positive' : 'negative'}
        />
        {p.activeIdea && (
          <div className="flex flex-col gap-0.5 min-w-0">
            <RowLabel>Active</RowLabel>
            <div className="text-[12px] text-gray-800 dark:text-gray-200 leading-none truncate">
              <span className="font-semibold uppercase text-[10px] tracking-wide text-primary-700 dark:text-primary-300">
                {p.activeIdea.action ?? 'idea'}
              </span>
              {p.activeIdea.stage && (
                <span className="text-gray-500 dark:text-gray-400"> · {p.activeIdea.stage}</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* What we believe — two sections side by side, each clamped */}
      <div className="flex-1 min-h-0">
        {p.writtenCaseSections.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            {p.writtenCaseSections.slice(0, 2).map(s => (
              <div key={s.key} className="min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <RowLabel>{SECTION_LABEL[s.key] ?? s.key}</RowLabel>
                  {s.row?.authorName && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                      {s.row.authorName}
                    </span>
                  )}
                </div>
                <p className="text-[12.5px] text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-4 whitespace-pre-wrap">
                  {s.row.content}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs text-gray-400 dark:text-gray-600 italic">
            No case written yet.
          </div>
        )}
      </div>

      {/* The list's own fields — one wrapping row, not a column */}
      <div className="flex-shrink-0 flex items-center gap-x-5 gap-y-1.5 flex-wrap pt-2 border-t border-gray-100 dark:border-gray-800">
        {p.coverage && p.coverage.length > 0 && (
          <Meta label="Covered">
            <div className="flex items-center gap-2 min-w-0">
              {p.coverage.slice(0, 2).map((c, i) => (
                <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
              ))}
            </div>
          </Meta>
        )}
        <Meta label="Owner">
          <ListAssigneeCell rowId={p.rowId} listId={p.listId} assignee={p.assignee} canEdit={p.canEdit} />
        </Meta>
        <Meta label="Status">
          <ListStatusCell rowId={p.rowId} listId={p.listId} status={p.status} canEdit={p.canEdit} />
        </Meta>
        <Meta label="Due">
          {p.canEdit ? (
            <input
              type="date"
              value={p.dueDraft}
              onChange={e => p.setDueDraft(e.target.value)}
              onBlur={p.commitDue}
              className="text-xs px-1.5 py-0.5 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          ) : p.dueDate ? (
            <span className="text-xs text-gray-700 dark:text-gray-300">
              {format(parseISO(p.dueDate), 'MMM d, yyyy')}
            </span>
          ) : null}
        </Meta>
        <Meta label="Tags">
          <ListTagsCell rowId={p.rowId} listId={p.listId} tags={p.tags} canEdit={p.canEdit} />
        </Meta>
        <Meta label="List note">
          {p.canEdit ? (
            <input
              value={p.noteDraft}
              onChange={e => p.setNoteDraft(e.target.value)}
              onBlur={p.commitNote}
              placeholder="Why this name is here…"
              className="w-56 text-xs px-1.5 py-0.5 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500"
            />
          ) : (
            <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[220px]">
              {p.listNote || '—'}
            </span>
          )}
        </Meta>
      </div>
    </div>
  )
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <RowLabel>{label}</RowLabel>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

// ── Market ─────────────────────────────────────────────────────────────

/**
 * A month of movement, at a size worth drawing.
 *
 * This is the one mode where a chart IS the answer, so it gets real height —
 * but it is still a sparkline with a target reference, not an interactive
 * chart. The interactive one is one click away on the Asset page, and a row
 * cannot host a crosshair without stealing the scroll.
 *
 * `closes` comes from the list-wide `useSparklines` batch, so opening a row
 * issues no new request.
 */
function MarketMode(p: {
  spot: number | null
  target: number | null
  upsidePct: number | null
  signal?: ListRowSignal
}) {
  const closes = p.signal?.closes ?? null
  const oneMonthPct = closes && closes.length > 1
    ? ((closes[closes.length - 1] - closes[0]) / closes[0]) * 100
    : null

  if (!closes && p.spot == null) return <Empty>No price history.</Empty>

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-start gap-6 flex-shrink-0">
        <Fact label="Last" value={p.spot != null ? money(p.spot) : null} />
        <Fact
          label="1 month"
          value={oneMonthPct != null ? pct(oneMonthPct) : null}
          tone={oneMonthPct == null ? 'default' : oneMonthPct >= 0 ? 'positive' : 'negative'}
        />
        <Fact label="Target" value={p.target != null ? money(p.target) : null} />
        <Fact
          label="Upside"
          value={p.upsidePct != null ? pct(p.upsidePct) : null}
          tone={p.upsidePct == null ? 'default' : p.upsidePct >= 0 ? 'positive' : 'negative'}
        />
      </div>
      {closes && closes.length > 1 ? (
        <div className="flex-1 min-h-0">
          {/* The target joins the chart's SCALE — see `Sparkline`. A target
              above every close would otherwise sit off the top of the box,
              which is the common case for a stale one. */}
          <Sparkline points={closes} reference={p.target} className="w-full h-full min-h-[64px]" />
        </div>
      ) : (
        <Empty>No price history.</Empty>
      )}
    </div>
  )
}

// ── Case ───────────────────────────────────────────────────────────────

/**
 * The case, editable where it stands.
 *
 * All three core sections, each writing through `saveContribution` — the same
 * writer the Asset page and the mobile case section use. Saving here also
 * moves the review anchor, which is the only honest way to clear "new since
 * review": there is no reviewed-at column, and a dismiss button would be a
 * second meaning for a clock the rest of the product already reads.
 */
function CaseMode(p: {
  caseSections: Array<{ key: string; row: any }>
  caseWrittenAt: string | null
  rating: any
  ratingColor: string | null
  activeScale: any
  commitRating: (next: { value?: string; conviction?: ConvictionLevel | null }) => void
  savingRating: boolean
  commitSection: (sectionKey: string, content: string) => Promise<void>
  symbol?: string
}) {
  return (
    <div className="flex flex-col h-full gap-2.5">
      {/* The house view, editable in place */}
      <div className="flex items-center gap-4 flex-shrink-0">
        <div className="flex items-center gap-2">
          <RowLabel>View</RowLabel>
          {p.activeScale ? (
            <span className="relative inline-flex items-center">
              <span data-testid="row-rating-display">
                {p.rating ? (
                  <RatingPill value={p.rating.rating_value} color={p.ratingColor} />
                ) : (
                  <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 px-1.5 py-0.5 rounded border border-dashed border-gray-300 dark:border-gray-600">
                    Rate
                  </span>
                )}
              </span>
              {/* Transparent native select over the pill: the row keeps a
                  finance-table look while the control stays a real
                  keyboard-accessible <select>. */}
              <select
                aria-label={`Rating for ${p.symbol ?? 'this security'}`}
                value={p.rating?.rating_value ?? ''}
                onChange={e => p.commitRating({ value: e.target.value })}
                disabled={p.savingRating}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              >
                <option value="" disabled>Set rating…</option>
                {(p.activeScale.values ?? []).map((v: any) => (
                  <option key={v.value} value={v.value}>{v.label ?? v.value}</option>
                ))}
              </select>
            </span>
          ) : p.rating ? (
            <RatingPill value={p.rating.rating_value} color={p.ratingColor} />
          ) : null}
        </div>

        {/*
          * Conviction, as the meter it already is.
          *
          * The read-only glyph is three bars of rising height; this is the same
          * glyph with each bar as its own target, so the control and the
          * display are one object rather than a meter beside a picker.
          */}
        {p.rating && (
          <div className="flex items-center gap-1.5">
            <RowLabel>Conviction</RowLabel>
            <span className="inline-flex items-end gap-[2px] align-middle">
              {CONVICTION_CHOICES.map((level, i) => {
                const current = p.rating.conviction
                const filledTo = current ? CONVICTION_CHOICES.indexOf(current) : -1
                return (
                  <button
                    key={level}
                    onClick={() => p.commitRating({ conviction: level })}
                    disabled={p.savingRating}
                    aria-label={`Set ${level} conviction`}
                    aria-pressed={current === level}
                    className={clsx(
                      'w-[5px] rounded-sm transition-colors',
                      i === 0 && 'h-[5px]',
                      i === 1 && 'h-[8px]',
                      i === 2 && 'h-[11px]',
                      i <= filledTo
                        ? 'bg-gray-700 dark:bg-gray-200'
                        : 'bg-gray-200 hover:bg-gray-400 dark:bg-gray-700 dark:hover:bg-gray-500',
                    )}
                  />
                )
              })}
            </span>
          </div>
        )}

        {p.caseWrittenAt && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-auto">
            case written {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
          </span>
        )}
      </div>

      {/* The three core sections */}
      <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-3 gap-x-5">
        {p.caseSections.map(s => (
          <CaseSectionEditor
            key={s.key}
            sectionKey={s.key}
            label={SECTION_LABEL[s.key] ?? s.key}
            content={s.row?.content ?? ''}
            authorName={s.row?.authorName ?? null}
            onSave={p.commitSection}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * One section, read until clicked.
 *
 * Read mode is text, not a form field: three permanently-open textareas read
 * as a CRUD screen and lose the thing being written to. Save is explicit, on
 * blur, and only when the text actually changed — a stray focus must not
 * create a contribution revision.
 */
function CaseSectionEditor({
  sectionKey, label, content, authorName, onSave,
}: {
  sectionKey: string
  label: string
  content: string
  authorName: string | null
  onSave: (sectionKey: string, content: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(content) }, [content])

  const commit = async () => {
    setEditing(false)
    if (draft.trim() === content.trim()) return
    setSaving(true)
    try { await onSave(sectionKey, draft) } finally { setSaving(false) }
  }

  return (
    <div className="min-w-0 flex flex-col h-full">
      <div className="flex items-baseline gap-2 mb-1 flex-shrink-0">
        <RowLabel>{label}</RowLabel>
        {authorName && !editing && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{authorName}</span>
        )}
        {saving && <span className="text-[10px] text-gray-400">saving…</span>}
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          className="flex-1 min-h-0 w-full text-[12.5px] px-2 py-1.5 border border-primary-300 dark:border-primary-700 rounded bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500 resize-none leading-relaxed"
        />
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex-1 min-h-0 text-left group/sec overflow-hidden"
          aria-label={`Edit ${label}`}
        >
          {content.trim() ? (
            <p className="text-[12.5px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
              {content}
            </p>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-gray-400 dark:text-gray-500 italic group-hover/sec:text-primary-600 dark:group-hover/sec:text-primary-400">
              <Pencil className="h-3 w-3" />
              Write {label.toLowerCase()}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

// ── Valuation ──────────────────────────────────────────────────────────

/**
 * What it is worth, and against what.
 *
 * Read-only on purpose. `savePriceTarget` needs a resolved scenario, and
 * picking a scenario is a decision a row cannot collect honestly — so setting
 * one links into the case where the scenarios live.
 */
function ValuationMode(p: {
  spot: number | null
  target: number | null
  upsidePct: number | null
  ladder: any
  onOpenAsset?: () => void
}) {
  /*
   * The ladder's own rungs, under the scenario names the desk configured —
   * not a Bear/Base/Bull guess. `selectCurrentLadders` already picked the
   * winning row per scenario, and a ladder is only `valid` with two distinct
   * rungs, so these are the range the case actually describes.
   */
  const rungs = useMemo(() => {
    const cases = p.ladder?.cases ?? []
    return [...cases]
      .filter(c => Number.isFinite(c.price) && c.price > 0)
      .sort((a, b) => a.price - b.price)
  }, [p.ladder])

  if (p.target == null && p.spot == null) return <Empty>No valuation on file.</Empty>

  return (
    <div className="flex flex-col h-full gap-3">
      <div className="flex items-start gap-6 flex-shrink-0">
        <Fact label="Price" value={p.spot != null ? money(p.spot) : null} />
        <Fact label="Target" value={p.target != null ? money(p.target) : null} />
        <Fact
          label="Upside"
          value={p.upsidePct != null ? pct(p.upsidePct) : null}
          tone={p.upsidePct == null ? 'default' : p.upsidePct >= 0 ? 'positive' : 'negative'}
        />
      </div>

      {rungs.length > 0 ? (
        <div className="flex-1 min-h-0">
          <RowLabel>Scenarios</RowLabel>
          <div className="mt-1.5 space-y-1">
            {rungs.map(r => {
              const up = p.spot != null && p.spot > 0
                ? ((r.price - p.spot) / p.spot) * 100
                : null
              return (
                <div key={r.id} className="flex items-baseline gap-3 text-[12.5px]">
                  <span className="w-24 truncate text-gray-500 dark:text-gray-400" title={r.reasoning ?? undefined}>
                    {r.name}
                  </span>
                  <span className="font-semibold tabular-nums text-gray-900 dark:text-gray-100">
                    {money(r.price)}
                  </span>
                  {up != null && (
                    <span className={clsx(
                      'text-[11px] font-semibold tabular-nums',
                      up >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                    )}>
                      {pct(up)}
                    </span>
                  )}
                  {r.probability != null && (
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                      {Math.round(r.probability * 100)}%
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex items-start">
          <span className="text-xs text-gray-400 dark:text-gray-600 italic">
            No scenario targets on file.
          </span>
        </div>
      )}

      {p.onOpenAsset && (
        <button
          onClick={p.onOpenAsset}
          className="flex-shrink-0 self-start inline-flex items-center gap-1 text-[11px] font-medium text-primary-700 hover:text-primary-800 dark:text-primary-300"
        >
          Set a target in the case
          <ExternalLink className="h-3 w-3" />
        </button>
      )}
    </div>
  )
}

// ── Position ───────────────────────────────────────────────────────────

/** Every book holding it, largest first. */
function PositionMode({ positions, spot }: { positions: any[]; spot: number | null }) {
  const rows = useMemo(
    () => [...positions].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0)),
    [positions],
  )
  if (rows.length === 0) return <Empty>Not held in any book.</Empty>

  return (
    <div className="h-full overflow-y-auto">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left">
            {['Portfolio', 'Shares', 'Weight', 'Value', 'Unrealised'].map(h => (
              <th key={h} className="pb-1 font-normal">
                <RowLabel>{h}</RowLabel>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.portfolioId ?? i} className="border-t border-gray-100 dark:border-gray-800">
              <td className="py-1 pr-3 text-gray-800 dark:text-gray-200 truncate max-w-[200px]">
                {r.portfolioName ?? 'Unnamed book'}
              </td>
              <td className="py-1 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                {r.shares?.toLocaleString() ?? '—'}
              </td>
              <td className="py-1 pr-3 tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                {r.weightPct != null ? `${r.weightPct.toFixed(2)}%` : '—'}
              </td>
              <td className="py-1 pr-3 tabular-nums text-gray-700 dark:text-gray-300">
                {r.marketValue != null
                  ? `$${Math.round(r.marketValue).toLocaleString()}`
                  : spot != null && r.shares != null
                    ? `$${Math.round(spot * r.shares).toLocaleString()}`
                    : '—'}
              </td>
              <td className={clsx(
                'py-1 tabular-nums font-semibold',
                r.unrealisedPct == null
                  ? 'text-gray-400'
                  : r.unrealisedPct >= 0
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
              )}>
                {r.unrealisedPct != null ? pct(r.unrealisedPct) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── Work ───────────────────────────────────────────────────────────────

/**
 * The actual workflow the signal names — not a description of it.
 *
 * Branch order is the order the work is urgent in: unreviewed evidence first,
 * because it is the one state where the written case may already be wrong.
 * Each branch ends in something the reader can DO, and the two that can be
 * done from a row (record a verdict, write the case) are done here rather than
 * linked away.
 */
function WorkMode(p: {
  newSinceReview: number
  changes: any[]
  caseWrittenAt: string | null
  hasCase: boolean
  state: string | null
  activeIdea: any
  latestDecision: any
  reviewGroup: React.ReactNode
  onGoToCase: () => void
  onOpenAsset?: () => void
  onCreateTradeIdea?: () => void
}) {
  // 1. New evidence the case has not answered.
  if (p.newSinceReview > 0) {
    const unread = p.changes.filter(c => c.isNewSinceReview)
    return (
      <div className="flex flex-col h-full gap-2">
        <div className="flex items-baseline gap-2 flex-shrink-0">
          <span className="text-[12.5px] font-semibold text-gray-900 dark:text-gray-100">
            {p.newSinceReview} new since the case was written
          </span>
          {p.caseWrittenAt && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500">
              {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
            </span>
          )}
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
          {unread.map(c => (
            <div key={c.id} className="flex items-start gap-1.5 text-[12px] leading-snug">
              <span className="mt-[5px] h-1.5 w-1.5 rounded-full bg-amber-500 flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-800 dark:text-gray-100 truncate">
                  {c.title || 'Untitled note'}
                </div>
                {c.content && (
                  <p className="text-[11.5px] text-gray-500 dark:text-gray-400 line-clamp-2 leading-snug">
                    {c.content}
                  </p>
                )}
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  {c.authorName ? `${c.authorName} · ` : ''}
                  {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
        <div className="flex-shrink-0 flex items-center gap-2 flex-wrap pt-2 border-t border-gray-100 dark:border-gray-800">
          <span className="text-[11px] font-semibold text-gray-500 dark:text-gray-400">
            Does the case still hold?
          </span>
          {p.reviewGroup}
          <button
            onClick={p.onGoToCase}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-300 rounded-md"
          >
            <Pencil className="h-3 w-3" />
            Update the case
          </button>
        </div>
      </div>
    )
  }

  // 2. No case to review yet — the work is writing one.
  if (!p.hasCase) {
    return (
      <div className="flex flex-col h-full gap-2 justify-center items-start">
        <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
          No thesis on file
        </span>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">
          Nothing here says what we believe about this name, so there is nothing to
          review against and no anchor for new research.
        </p>
        <button
          onClick={p.onGoToCase}
          className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700"
        >
          <Pencil className="h-3 w-3" />
          Write the case
        </button>
      </div>
    )
  }

  // 3. A live idea is the open work.
  if (p.activeIdea) {
    return (
      <div className="flex flex-col h-full gap-2.5">
        <div className="flex items-start gap-6 flex-shrink-0">
          <Fact label="Idea" value={(p.activeIdea.action ?? 'idea').toUpperCase()} />
          <Fact label="Stage" value={p.activeIdea.stage ?? null} />
          <Fact label="Book" value={p.activeIdea.portfolioName ?? null} />
          <Fact label="Conviction" value={p.activeIdea.conviction ?? null} />
        </div>
        {p.activeIdea.rationale && (
          <p className="flex-1 min-h-0 overflow-y-auto text-[12.5px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
            {p.activeIdea.rationale}
          </p>
        )}
        {p.latestDecision && (
          <div className="flex-shrink-0 text-[11.5px] text-gray-500 dark:text-gray-400">
            Decision: {p.latestDecision.status}
            {p.latestDecision.decidedAt && (
              <> · {formatDistanceToNow(new Date(p.latestDecision.decidedAt), { addSuffix: true })}</>
            )}
          </div>
        )}
        {/*
          * Advancing a stage and acting on a recommendation are NOT done here:
          * a forward move to the final stage is gated on a rationale and a
          * thesis, an outcome needs recorded decision evidence, and accepting
          * a recommendation needs a sizing decision and is PM-gated. A row
          * that pretended otherwise would be a second, weaker writer.
          */}
        {p.onOpenAsset && (
          <button
            onClick={p.onOpenAsset}
            className="flex-shrink-0 self-start inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700"
          >
            Continue the idea
            <ArrowUpRight className="h-3 w-3" />
          </button>
        )}
      </div>
    )
  }

  // 4. A case that is simply due a look.
  if (p.state === 'stale' || p.state === 'thin' || p.state === 'incomplete-thesis') {
    return (
      <div className="flex flex-col h-full gap-2 justify-center items-start">
        <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
          {p.state === 'stale' ? 'Review due' : p.state === 'thin' ? 'Thin evidence' : 'Incomplete case'}
        </span>
        <p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">
          {p.caseWrittenAt
            ? `The case was last written ${formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}.`
            : 'Nothing records when this case was last confirmed.'}
        </p>
        <div className="mt-1 flex items-center gap-2 flex-wrap">
          {p.reviewGroup}
          <button
            onClick={p.onGoToCase}
            className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-gray-500 hover:text-primary-700 dark:text-gray-400 dark:hover:text-primary-300 rounded-md"
          >
            <Pencil className="h-3 w-3" />
            Update the case
          </button>
        </div>
      </div>
    )
  }

  // 5. Nothing is outstanding. The next move is an idea.
  return (
    <div className="flex flex-col h-full gap-2 justify-center items-start">
      <span className="text-[13px] font-semibold text-gray-900 dark:text-gray-100">
        Nothing outstanding
      </span>
      <p className="text-[12px] text-gray-500 dark:text-gray-400 max-w-md leading-relaxed">
        The case is written and current, and no idea is live on this name.
      </p>
      {p.onCreateTradeIdea && (
        <button
          onClick={p.onCreateTradeIdea}
          className="mt-1 inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-semibold rounded-md bg-primary-600 text-white hover:bg-primary-700"
        >
          <Plus className="h-3 w-3" />
          Start an idea
        </button>
      )}
    </div>
  )
}
