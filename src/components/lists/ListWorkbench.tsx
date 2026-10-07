/**
 * Engaging a security: the reads, the writes and the state. Picture next door.
 *
 * ── The model this implements ─────────────────────────────────────────────
 *
 *   universe → identify attention → engage security → contextual workbench
 *
 * The collapsed list is a scanner whose job is to say which names want
 * attention. Engaging one does not expand a row: the universe recedes to a
 * spine and the security takes the canvas, on the surface its ENTRY POINT
 * named — a click on the price opens Market, on the work badge opens Work, on
 * the rating or target opens Case, on the ticker opens Overview.
 *
 * ── Every figure is a stored fact ─────────────────────────────────────────
 *
 *   current weight      `useAssetWorkspace` → `positions` (book NAV-derived)
 *   proposed weight     `trade_queue_items.proposed_weight` via `useIdeaScan`
 *   direction / stage   the idea's own lifecycle fields
 *   rationale, author   the idea as written
 *   case sections       `asset_contributions` via `useAssetWorkspace`
 *   evidence + "new"    `asset_notes`, against the case's own review clock
 *   rating / conviction `analyst_ratings`
 *   target / upside     `analyst_price_targets` against the stored price
 *
 * Nothing is summarised, scored or interpreted. See `ListBenchViews` for what
 * the prototype showed that we cannot derive, and why it is absent instead.
 *
 * ── Writes ────────────────────────────────────────────────────────────────
 *
 * All four go through the path the rest of the product uses, unchanged:
 *
 *   case text          `useContributions().saveContribution`
 *   rating/conviction  `useAnalystRatings().saveRating`
 *   review verdict     `useRecordThesisReview`  (a `thesis.reviewed` event)
 *   new idea           `onCreateTradeIdea` → `ListTab`'s `AddTradeIdeaModal`
 *
 * Accepting a recommendation, setting a price target and moving an idea's stage
 * are NOT written here. Each needs a sizing decision, a scenario or stage
 * validation this surface cannot honestly collect, and the first is PM-gated —
 * so they link into the workspace that owns them.
 *
 * RLS posture: unchanged. Every read is an existing hook called with an asset id
 * and the current organisation; no table, view or policy is touched.
 */
import { useMemo, useEffect, useCallback } from 'react'
import {
  BenchSpine, BenchHeader, BenchSkeleton,
  WorkSurface, MarketSurface, CaseSurface, OverviewSurface,
  type BenchMode, type SpineEntry, type ReviewControl, type BenchIdea,
} from './ListBenchViews'
import { useAssetWorkspace } from '../../hooks/useAssetWorkspace'
import { useAnalystRatings, useRatingScales, type ConvictionLevel } from '../../hooks/useAnalystRatings'
import { useRecordThesisReview } from '../../hooks/useThesisReview'
import { useContributions } from '../../hooks/useContributions'
import { CORE_SECTIONS, STATE_LABEL } from '../../lib/desktop-research/model'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'
import type { ListRowCoverage } from './ListRowExpansion'

interface ListWorkbenchProps {
  /** The list's rows in their current order — the spine is the universe as sorted. */
  assets: any[]
  assetId: string
  mode: BenchMode
  /** Batched for the whole list by `useListRowSignals`; never null. */
  signalFor: (assetId?: string | null) => ListRowSignal
  coverageFor?: (assetId: string) => ListRowCoverage[]
  onSelectAsset: (assetId: string) => void
  onModeChange: (mode: BenchMode) => void
  onClose: () => void
  onOpenAsset?: (asset: any) => void
  onCreateTradeIdea?: (assetId: string) => void
}

export function ListWorkbench({
  assets, assetId, mode, signalFor, coverageFor,
  onSelectAsset, onModeChange, onClose, onOpenAsset, onCreateTradeIdea,
}: ListWorkbenchProps) {
  const asset = useMemo(() => assets.find(a => a?.id === assetId) ?? null, [assets, assetId])
  const signal = signalFor(assetId)

  // `useAssetWorkspace` returns `{ data, isLoading, error }` and `data` is never
  // undefined — it falls back to an EMPTY shape — so the fields below can be
  // read without guarding every one.
  const { data: workspace, isLoading } =
    useAssetWorkspace(assetId ?? null, asset?.symbol ?? null, 'overview')
  const { ratings, saveRating } = useAnalystRatings({ assetId })
  const { scales } = useRatingScales()
  const { saveContribution } = useContributions({ assetId })
  const review = useRecordThesisReview(assetId)

  const { spot, target, positions, sections, evidence, caseWrittenAt } = workspace

  /**
   * One rating, chosen the way the rest of the product chooses it: the
   * organisation's official rating if there is one, else the most recently
   * updated.
   */
  const rating = useMemo(() => {
    const rows = ratings ?? []
    if (rows.length === 0) return null
    return rows.find((r: any) => r.is_official)
      ?? [...rows].sort((a: any, b: any) =>
        Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))[0]
  }, [ratings])

  /*
   * The scale this surface writes against: the one the existing rating already
   * uses, else the organisation's default. Never a scale invented here — a
   * rating recorded against the wrong scale produces a value string matching no
   * configured value, and then drops silently out of every colour read.
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

  /** The book this reader most plausibly means: the largest weight. */
  const primaryPosition = useMemo(() => {
    const withWeight = (positions ?? []).filter(p => p.weightPct != null)
    if (withWeight.length === 0) return (positions ?? [])[0] ?? null
    return [...withWeight].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))[0]
  }, [positions])

  const weightPct = primaryPosition?.weightPct ?? signal.weightPct ?? null
  const upsidePct = spot != null && spot > 0 && target != null
    ? ((target - spot) / spot) * 100
    : null

  /** The case, core sections in the product's own order. */
  const caseSections = useMemo(
    () => CORE_SECTIONS.map(key => ({
      key: key as string,
      row: (sections ?? []).find(s => s.section === key) ?? null,
    })),
    [sections],
  )
  const leadCase = useMemo(
    () => caseSections.find(s => !!(s.row?.content ?? '').trim()) ?? null,
    [caseSections],
  )

  /** Newest first, and whatever arrived after the review anchor leads. */
  const changes = useMemo(() => {
    const items = [...(evidence ?? [])]
    items.sort((a, b) => {
      if (a.isNewSinceReview !== b.isNewSinceReview) return a.isNewSinceReview ? -1 : 1
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    return items
  }, [evidence])

  /*
   * The live idea comes from the LIST-WIDE scan, not from the workspace.
   *
   * `useIdeaScan` is already in memory when the security is engaged and it
   * carries the proposed weight, the author and the rationale —
   * `AssetWorkspaceData.liveIdeas` carries none of those. Same rows, more of
   * them, and no second read.
   */
  const idea: BenchIdea | null = signal.idea

  const spine: SpineEntry[] = useMemo(
    () => assets
      .filter(a => !!a?.id)
      .map(a => ({
        assetId: a.id as string,
        symbol: (a.symbol ?? '—') as string,
        tier: signalFor(a.id).work.tier,
      })),
    [assets, signalFor],
  )

  const coverage = coverageFor?.(assetId)

  // ── Writes ───────────────────────────────────────────────────────────

  /*
   * Not gated on list edit permission: that is permission to curate THIS list
   * row. A rating is the reader's own org-level judgement on the security, and
   * `saveRating` writes it keyed on (asset, user, org).
   */
  const commitRating = useCallback((next: { value?: string; conviction?: ConvictionLevel | null }) => {
    const ratingValue = next.value ?? rating?.rating_value
    if (!activeScale || !ratingValue) return
    saveRating.mutate({
      ratingValue,
      ratingScaleId: activeScale.id,
      conviction: next.conviction !== undefined ? next.conviction : rating?.conviction ?? null,
    })
  }, [activeScale, rating, saveRating])

  /**
   * Save one case section.
   *
   * `saveContribution` invalidates `contributions` AND `desktop-research`, so a
   * save here moves the anchor `isNewSinceReview` is measured against. That is
   * the reason editing the case from a list is worth having: it is the only
   * honest way to clear "3 new".
   */
  const commitSection = useCallback(async (sectionKey: string, content: string) => {
    await saveContribution.mutateAsync({ content, sectionKey })
  }, [saveContribution])

  const reviewControl: ReviewControl = useMemo(() => ({
    isDone: review.isDone, isPending: review.isPending, onRecord: review.record,
  }), [review.isDone, review.isPending, review.record])

  // Esc returns to the universe, the way it used to close an expansion.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // A reader escaping out of a field means "stop editing", not "leave".
      const el = document.activeElement
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (!asset) return null

  /**
   * Why the reader is here — a stored state, never a verdict on the thesis.
   *
   * A pending recommendation outranks research hygiene, the same ordering
   * `workStateFor` applies to the collapsed Work column.
   */
  const why = idea && signal.work.tier === 'decision'
    ? { tone: 'decide' as const, text: 'Awaiting a decision' }
    : signal.state && signal.state !== 'current'
      ? { tone: 'warn' as const, text: STATE_LABEL[signal.state] }
      : null

  const scaleValues = activeScale?.values as Array<{ value: string; label?: string }> | undefined
  const openAsset = onOpenAsset ? () => onOpenAsset(asset) : undefined
  const createIdea = onCreateTradeIdea ? () => onCreateTradeIdea(assetId) : undefined

  return (
    <div
      data-testid="list-workbench"
      data-mode={mode}
      className="flex-1 min-h-0 flex border-t border-gray-900/[0.07] dark:border-white/10"
    >
      {/* The spine collapses entirely on a phone: 150px of tickers beside a
          working surface leaves neither usable. Mobile keeps the row expansion. */}
      <div className="hidden sm:flex min-h-0">
        <BenchSpine entries={spine} activeAssetId={assetId} onSelect={onSelectAsset} />
      </div>

      <section className="flex-1 min-w-0 flex flex-col overflow-hidden bg-white dark:bg-gray-900">
        <BenchHeader
          symbol={asset.symbol}
          companyName={asset.company_name}
          why={why}
          mode={mode}
          onModeChange={onModeChange}
          onClose={onClose}
        />

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-150">
          {isLoading ? (
            <BenchSkeleton />
          ) : mode === 'work' ? (
            <WorkSurface
              idea={idea}
              tier={signal.work.tier}
              stateLabel={signal.state ? STATE_LABEL[signal.state] : null}
              secondary={signal.work.secondary}
              changes={changes}
              caseWrittenAt={caseWrittenAt}
              leadCase={leadCase}
              weightPct={weightPct}
              target={target}
              upsidePct={upsidePct}
              coverage={coverage}
              review={reviewControl}
              onOpenAsset={openAsset}
              onGoToCase={() => onModeChange('case')}
              onCreateIdea={createIdea}
            />
          ) : mode === 'market' ? (
            <MarketSurface
              closes={signal.closes}
              spot={spot}
              target={target}
              upsidePct={upsidePct}
              weightPct={weightPct}
              bookName={primaryPosition?.portfolioName}
              ratingValue={rating?.rating_value ?? null}
              ratingColor={ratingColor}
              conviction={rating?.conviction ?? null}
              changes={changes}
              caseWrittenAt={caseWrittenAt}
              idea={idea}
            />
          ) : mode === 'case' ? (
            <CaseSurface
              symbol={asset.symbol}
              caseSections={caseSections}
              caseWrittenAt={caseWrittenAt}
              changes={changes}
              ratingValue={rating?.rating_value ?? null}
              ratingColor={ratingColor}
              conviction={rating?.conviction ?? null}
              scaleValues={scaleValues}
              onRate={v => commitRating({ value: v })}
              onConviction={c => commitRating({ conviction: c })}
              busy={saveRating.isPending}
              onSaveSection={commitSection}
              target={target}
              upsidePct={upsidePct}
              weightPct={weightPct}
              bookName={primaryPosition?.portfolioName}
              proposedWeight={idea?.proposedWeight ?? null}
              review={reviewControl}
            />
          ) : (
            <OverviewSurface
              spot={spot}
              target={target}
              upsidePct={upsidePct}
              weightPct={weightPct}
              bookName={primaryPosition?.portfolioName}
              ratingValue={rating?.rating_value ?? null}
              ratingColor={ratingColor}
              conviction={rating?.conviction ?? null}
              leadCase={leadCase}
              changes={changes}
              caseWrittenAt={caseWrittenAt}
              idea={idea}
              workLabel={signal.work.tier === 'clear' ? null : signal.work.label || null}
              coverage={coverage}
              onGo={onModeChange}
            />
          )}
        </div>

        {review.error && (
          <div className="flex-none px-5 pb-2 text-[11.5px] text-rose-600 dark:text-rose-400">
            Review not saved
          </div>
        )}
      </section>
    </div>
  )
}
