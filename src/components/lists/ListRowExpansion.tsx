/**
 * The List workspace: hooks, state and writes. The picture lives next door.
 *
 * Composition moved to `ListRowModes`, which is pure and therefore renderable
 * in the fixture gallery — the only way the layout of a virtualised, fixed
 * height, auth-gated row can actually be LOOKED at. Everything that reaches
 * Supabase stays here.
 *
 * ── Why the clicked field decides the mode ────────────────────────────────
 *
 * A reader who clicks Target is asking what the name is worth. One who clicks
 * the Work badge is asking what needs doing. Opening the same summary for both
 * makes them navigate twice to reach what they already pointed at — so the
 * expansion opens on the content the clicked field names, and the mode switch
 * exists to move on from there rather than to be the first decision. The map is
 * in `listRowModes`; the table hands the clicked column in as `entryColumnId`.
 *
 * Modes a security cannot answer are not offered. A switch full of empty tabs
 * is a worse answer than a shorter switch.
 *
 * ── The height contract ───────────────────────────────────────────────────
 *
 * `AssetTableView` gives every expanded row a FIXED height by density, because
 * its virtualiser must know row sizes up front. Nothing here may grow the row:
 * each mode's regions scroll internally, and the entrance animates OPACITY and
 * a small translate — never height, which would fight the virtualiser and move
 * the reader's place in the list.
 *
 * ── Writes ────────────────────────────────────────────────────────────────
 *
 * Every write goes through the path the rest of the product uses:
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
import { ExternalLink, Flag, ArrowUpRight, Plus, Pencil, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { format, parseISO } from 'date-fns'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import {
  OverviewMode, MarketMode, CaseMode, ValuationMode, PositionMode, WorkMode,
  ModeSkeleton, ModeLayout, RailBlock, Label, PrimaryButton, QuietButton,
  type WorkShape, type LadderRung,
} from './ListModeViews'
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
import { CORE_SECTIONS, STATE_LABEL } from '../../lib/desktop-research/model'
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
 * Same list, same order, same labels — a reader who reviews from a list row and
 * one who reviews from the research surface must be recording the same three
 * things, or the stale clock means two different things depending on where it
 * was cleared.
 */
const REVIEW_CHOICES: ReadonlyArray<{ outcome: ThesisReviewOutcome; label: string }> = [
  { outcome: 'holds', label: 'Still holds' },
  { outcome: 'changed', label: 'Changed' },
  { outcome: 'needs_work', label: 'Needs work' },
]

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

  // `useAssetWorkspace` returns `{ data, isLoading, error }` and `data` is never
  // undefined — it falls back to an EMPTY shape — so the fields below can be
  // read without guarding every one.
  const { data: workspace, isLoading: workspaceLoading } =
    useAssetWorkspace(asset?.id ?? null, asset?.symbol ?? null, 'overview')
  const { ratings, saveRating } = useAnalystRatings({ assetId: asset?.id })
  const { scales } = useRatingScales()
  const { saveContribution } = useContributions({ assetId: asset?.id })
  /*
   * Recording a review already has a canonical writer: `useRecordThesisReview`
   * inserts a `thesis.reviewed` memory event, idempotent on a per-submit request
   * id, which `useDesktopResearch` folds back in as `lastReviewedAt` and
   * `stateOf` reads. So "reviewed, nothing changed" clears the clock here
   * exactly as it does on the research surface.
   */
  const review = useRecordThesisReview(asset?.id ?? null)

  const {
    spot, target, positions, liveIdeas, decisions, sections, evidence, caseWrittenAt, ladder,
  } = workspace

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
   * The scale this row writes against: the one the existing rating already uses,
   * else the organisation's default. Never a scale invented here — a rating
   * recorded against the wrong scale produces a value string that matches no
   * configured value, and it then drops silently out of every colour and
   * consensus read.
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

  /** Today's move, where the asset row carries it. Never computed from a guess. */
  const changePct = useMemo(() => {
    const raw = asset?.change_percent ?? asset?.changePercent ?? null
    const n = raw == null ? null : Number(raw)
    return n != null && Number.isFinite(n) ? n : null
  }, [asset])

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
  const leadCase = useMemo(() => {
    const first = writtenCaseSections[0]
    return first ? { key: first.key, content: first.row!.content as string } : null
  }, [writtenCaseSections])

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

  /*
   * The ladder's own rungs, under the scenario names the desk configured — not a
   * Bear/Base/Bull guess. `selectCurrentLadders` already picked the winning row
   * per scenario, and a ladder is only `valid` with two distinct rungs.
   */
  const rungs: LadderRung[] = useMemo(() => {
    const cases = ladder?.cases ?? []
    return [...cases]
      .filter(c => Number.isFinite(c.price) && c.price > 0)
      .sort((a, b) => a.price - b.price)
      .map(c => ({
        id: c.id, name: c.name, price: c.price,
        probability: c.probability, reasoning: c.reasoning,
      }))
  }, [ladder])

  const weightPct = primaryPosition?.weightPct ?? signal?.weightPct ?? null
  const ideaLabel = activeIdea
    ? [(activeIdea.action ?? 'idea').toUpperCase(), activeIdea.stage].filter(Boolean).join(' · ')
    : null

  // ── Modes ────────────────────────────────────────────────────────────

  /*
   * Availability is answered from the LIST-WIDE signal first, not only from the
   * per-row workspace. The signal is already in memory when the row opens; the
   * workspace is still fetching. Deriving availability from the workspace alone
   * made the Position and Valuation tabs pop into the switch a moment after
   * opening, which moves the tab the reader is aiming at.
   */
  const hasPosition = (positions ?? []).length > 0 || signal?.weightPct != null
  const hasMarket = (signal?.closes?.length ?? 0) > 1 || spot != null
  const hasValuation = target != null || spot != null || signal?.targetPrice != null

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
   * Re-enter on the clicked field. Clicking a second cell on a row that is
   * ALREADY open changes `entryColumnId`, which is the reader restating their
   * intent — so the mode follows. Switching tabs by hand does not change it, so
   * this does not fight the switch.
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
   * `saveContribution` resolves the user and org itself and invalidates
   * `contributions` AND `desktop-research` — so a save made here moves the
   * review anchor that `newSinceReview` is measured against. That is the whole
   * reason editing the case from a list row is worth having: it is the only
   * honest way to clear "3 new".
   */
  const commitSection = useCallback(async (sectionKey: string, content: string) => {
    await saveContribution.mutateAsync({ content, sectionKey })
  }, [saveContribution])

  // ── Footers, per mode ────────────────────────────────────────────────

  const reviewGroup = review.isDone ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">
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
            'px-2 py-1 text-[11.5px] font-semibold rounded-md transition-colors flex-shrink-0',
            outcome === 'holds'
              ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900'
              : 'text-gray-600 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700',
            review.isPending && 'opacity-50 cursor-wait',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const openFullCase = onOpenAsset ? (
    <QuietButton onClick={onOpenAsset} icon={ExternalLink}>Open full case</QuietButton>
  ) : null

  const flagButton = (
    <button
      onClick={canEdit ? toggleFlag : undefined}
      disabled={!canEdit}
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors',
        isFlagged
          ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800',
        !canEdit && 'cursor-default',
      )}
    >
      <Flag className={clsx('h-3 w-3', isFlagged && 'fill-current')} />
      {isFlagged ? 'Flagged' : 'Flag'}
    </button>
  )

  /**
   * The verdict, offered wherever the reader is — except Work, which shows it
   * beside the evidence it is about.
   */
  const reviewPrompt = newSinceReview > 0 && !!asset?.id && !workspaceLoading ? (
    <>
      <span className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">
        {newSinceReview} new · does the case hold?
      </span>
      {reviewGroup}
    </>
  ) : null

  /**
   * Only what belongs here.
   *
   * A constant toolbar made every mode end the same way and taught the reader
   * to stop looking at the footer. Each mode states what it can do, and nothing
   * is proposed from data that has not loaded.
   */
  const footerFor = (m: ListRowMode): React.ReactNode => {
    if (workspaceLoading) return openFullCase
    const common = <>{flagButton}{openFullCase}</>

    if (m === 'work') return <>{workFooter()}{common}</>
    if (m === 'case') {
      return <>{reviewPrompt}{common}</>
    }
    if (m === 'valuation') {
      return (
        <>
          {onOpenAsset && (
            <QuietButton onClick={onOpenAsset} icon={ExternalLink}>Set a target in the case</QuietButton>
          )}
          {common}
        </>
      )
    }
    if (m === 'position') return common
    // Overview and Market: the state-chosen next move.
    return (
      <>
        {reviewPrompt}
        {!reviewPrompt && activeIdea && onOpenAsset && (
          <PrimaryButton onClick={onOpenAsset} icon={ArrowUpRight}>Open active idea</PrimaryButton>
        )}
        {!reviewPrompt && !activeIdea && writtenCaseSections.length === 0 && (
          <PrimaryButton onClick={() => setMode('case')} icon={Pencil}>Write the case</PrimaryButton>
        )}
        {!reviewPrompt && !activeIdea && writtenCaseSections.length > 0 && onCreateTradeIdea && (
          <PrimaryButton onClick={() => onCreateTradeIdea(asset.id)} icon={Plus}>Start an idea</PrimaryButton>
        )}
        {common}
      </>
    )
  }

  const workShape: WorkShape =
    newSinceReview > 0 ? 'unread'
      : writtenCaseSections.length === 0 ? 'no-case'
        : activeIdea ? 'idea'
          : (signal?.state === 'stale' || signal?.state === 'thin' || signal?.state === 'incomplete-thesis')
            ? 'revisit'
            : 'clear'

  function workFooter(): React.ReactNode {
    if (workShape === 'unread') {
      return (
        <>
          <span className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400">
            Does the case still hold?
          </span>
          {reviewGroup}
          <QuietButton onClick={() => setMode('case')} icon={Pencil}>Update the case</QuietButton>
        </>
      )
    }
    if (workShape === 'no-case') {
      return <PrimaryButton onClick={() => setMode('case')} icon={Pencil}>Write the case</PrimaryButton>
    }
    if (workShape === 'idea') {
      return onOpenAsset
        ? <PrimaryButton onClick={onOpenAsset} icon={ArrowUpRight}>Continue the idea</PrimaryButton>
        : null
    }
    if (workShape === 'revisit') {
      return (
        <>
          {reviewGroup}
          <QuietButton onClick={() => setMode('case')} icon={Pencil}>Update the case</QuietButton>
        </>
      )
    }
    return onCreateTradeIdea
      ? <PrimaryButton onClick={() => onCreateTradeIdea(asset.id)} icon={Plus}>Start an idea</PrimaryButton>
      : null
  }

  // The list-scoped editors, which own hooks and so cannot live in the pure
  // composition file. Passed down as a slot.
  const listFieldsSlot = (
    <RailBlock label="On this list">
      <div className="space-y-2">
        <ListStatusCell rowId={rowId} listId={listId} status={status} canEdit={canEdit} />
        <ListAssigneeCell rowId={rowId} listId={listId} assignee={assignee} canEdit={canEdit} />
        <ListTagsCell rowId={rowId} listId={listId} tags={tags} canEdit={canEdit} />
        <div>
          <Label>Due</Label>
          {canEdit ? (
            <input
              type="date"
              value={dueDraft}
              onChange={e => setDueDraft(e.target.value)}
              onBlur={commitDue}
              className="mt-1 w-full text-[11.5px] px-1.5 py-1 rounded bg-white dark:bg-gray-900 ring-1 ring-gray-900/10 dark:ring-gray-100/15 focus:outline-none focus:ring-gray-900/30"
            />
          ) : dueDate ? (
            <div className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-300">
              {format(parseISO(dueDate), 'MMM d, yyyy')}
            </div>
          ) : <div className="mt-1 text-[11.5px] text-gray-400">Not set</div>}
        </div>
        <div>
          <Label>List note</Label>
          {canEdit ? (
            <textarea
              value={noteDraft}
              onChange={e => setNoteDraft(e.target.value)}
              onBlur={commitNote}
              placeholder="Why this name is here…"
              rows={2}
              className="mt-1 w-full text-[11.5px] px-1.5 py-1 rounded bg-white dark:bg-gray-900 ring-1 ring-gray-900/10 dark:ring-gray-100/15 focus:outline-none focus:ring-gray-900/30 resize-none leading-relaxed"
            />
          ) : (
            <div className="mt-1 text-[11.5px] text-gray-600 dark:text-gray-400 leading-snug">
              {listNote || '—'}
            </div>
          )}
        </div>
      </div>
    </RailBlock>
  )

  const scaleValues = activeScale?.values as Array<{ value: string; label?: string }> | undefined

  return (
    /*
     * A surface, not a card. The expansion sits on a faintly recessed ground so
     * it reads as belonging to the row above it; the first version was white on
     * white inside a border, which is what made it look inserted.
     *
     * `animate-in` is the entrance: opacity and a 2px lift, 150ms, matching the
     * chevron's rotate. No height transition — see the height contract.
     */
    <div
      data-testid="list-row-expansion"
      data-mode={activeMode}
      className="flex flex-col h-full max-sm:h-auto sm:overflow-hidden motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150"
    >
      {/* ── Context header ───────────────────────────────────────────── */}
      <div className="flex-shrink-0 flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-1.5 sm:gap-4 pb-2 mb-2.5">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <span className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
            {asset.symbol}
          </span>
          {asset.company_name && (
            <span className="text-[12px] text-gray-400 dark:text-gray-500 truncate max-w-[280px]">
              {asset.company_name}
            </span>
          )}
          {/* Suppressed in Work mode, which states the same thing as its own
              heading. Weight and colour only — not a pill. */}
          {signal?.state && signal.state !== 'current' && activeMode !== 'work' && (
            <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300 flex-shrink-0">
              {STATE_LABEL[signal.state]}
            </span>
          )}
        </div>

        {/* Text tabs, not buttons in boxes: the switch is a way back, not the
            surface's main furniture. */}
        <div
          className="flex items-center gap-0.5 flex-shrink-0 -mx-0.5 px-0.5 overflow-x-auto sm:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="tablist"
        >
          {availableModes.map(m => (
            <button
              key={m}
              role="tab"
              aria-selected={activeMode === m}
              onClick={() => setMode(m)}
              className={clsx(
                'px-2 py-0.5 rounded text-[11.5px] font-medium transition-colors flex-shrink-0',
                activeMode === m
                  ? 'text-gray-900 dark:text-gray-50 bg-gray-900/[0.07] dark:bg-gray-100/10'
                  : 'text-gray-400 hover:text-gray-700 dark:text-gray-500 dark:hover:text-gray-200',
              )}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
      </div>

      {/* ── The canvas ───────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0">
        {workspaceLoading ? (
          // The skeleton keeps the layout AND the footer: "Open full case" is
          // true regardless of what loads, so removing it made the row briefly
          // offer no way out at all.
          <ModeLayout main={<ModeSkeleton mode={activeMode} />} footer={openFullCase} />
        ) : (
          <>
            {activeMode === 'overview' && (
              <OverviewMode
                spot={spot} changePct={changePct} target={target} upsidePct={upsidePct}
                weightPct={weightPct} shares={primaryPosition?.shares ?? null}
                bookName={primaryPosition?.portfolioName}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                ideaLabel={ideaLabel}
                writtenCaseSections={writtenCaseSections}
                changes={changes} caseWrittenAt={caseWrittenAt}
                coverage={coverage}
                listFieldsSlot={listFieldsSlot}
                footer={footerFor('overview')}
              />
            )}
            {activeMode === 'market' && (
              <MarketMode
                symbol={asset.symbol} spot={spot} changePct={changePct}
                closes={signal?.closes ?? null} target={target} upsidePct={upsidePct}
                weightPct={weightPct} bookName={primaryPosition?.portfolioName}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                changes={changes} ideaLabel={ideaLabel}
                footer={footerFor('market')}
              />
            )}
            {activeMode === 'case' && (
              <CaseMode
                symbol={asset.symbol}
                caseSections={caseSections} caseWrittenAt={caseWrittenAt}
                changes={changes} newSinceReview={newSinceReview}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                scaleValues={scaleValues}
                onRate={v => commitRating({ value: v })}
                onConviction={c => commitRating({ conviction: c })}
                busy={saveRating.isPending}
                onSaveSection={commitSection}
                coverage={coverage}
                footer={footerFor('case')}
              />
            )}
            {activeMode === 'valuation' && (
              <ValuationMode
                spot={spot} target={target} upsidePct={upsidePct} rungs={rungs}
                weightPct={weightPct}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                footer={footerFor('valuation')}
              />
            )}
            {activeMode === 'position' && (
              <PositionMode
                positions={positions ?? []} spot={spot} target={target} upsidePct={upsidePct}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null} ideaLabel={ideaLabel}
                footer={footerFor('position')}
              />
            )}
            {activeMode === 'work' && (
              <WorkMode
                shape={workShape}
                changes={changes} newSinceReview={newSinceReview}
                caseWrittenAt={caseWrittenAt}
                stateLabel={signal?.state ? STATE_LABEL[signal.state] : null}
                leadCase={leadCase}
                idea={activeIdea}
                decisionLabel={latestDecision
                  ? latestDecision.status
                  : null}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                weightPct={weightPct}
                coverage={coverage}
                footer={footerFor('work')}
              />
            )}
          </>
        )}
      </div>

      {review.error && (
        <div className="flex-shrink-0 pt-1 text-[11px] text-rose-600 dark:text-rose-400">
          Review not saved
        </div>
      )}
    </div>
  )
}
