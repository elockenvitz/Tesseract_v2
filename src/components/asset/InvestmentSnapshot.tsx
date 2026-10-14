/**
 * The Investment Snapshot — the Asset page's landing.
 *
 * ── What this is for ─────────────────────────────────────────────────────
 *
 * One screen that answers "what is the state of this name here", before a
 * reader commits to a job. The four deeper workspaces — Research, Process,
 * Decisions, Lists — are where work happens and are unchanged. This is the
 * page you land on, and every domain on it links into the workspace that owns
 * it, so the Snapshot is a map rather than a destination.
 *
 * ── Why it is not a wall of cards ────────────────────────────────────────
 *
 * The domains are ordered as a reader reads an unfamiliar name: what we
 * believe, what we own against that belief, and what is currently owed. The
 * portfolio selector in the header governs all three at once — that single
 * control is what makes them one page instead of three widgets that happen to
 * share a route.
 *
 * ── One read, and no second opinion about weight ─────────────────────────
 *
 * Everything structural comes from `useAssetWorkspace`: one `Promise.all`
 * behind one React Query entry, deriving positions through
 * `lib/portfolio/holdings` — the same helper Portfolio, Research and Ideas
 * use, reading `portfolio_holdings` (canonical for this org; see that file's
 * header) and striking BOTH sides of the weight ratio at the book price.
 *
 * This file therefore computes no weight, no market value and no exposure of
 * its own. Adding a second definition here is the specific failure the Asset
 * page already had once, where weight-at-cost and weight-at-market disagreed
 * for the same position.
 *
 * ── Nothing is invented ──────────────────────────────────────────────────
 *
 * Absent data says it is absent. No AI conclusions, no derived "score", no
 * decision records that do not exist.
 *
 * Decision Memory arrived in Increment 2B and reads the same hook the
 * Decisions timeline reads, so the landing surface and the narrative beneath
 * it cannot report different states. It also discloses an authorization gap
 * rather than hiding it: holdings are org-scoped while decisions and
 * executions are portfolio-team scoped, so a reader can legitimately see a
 * name held in three books and a history covering fewer.
 */
import { useMemo, useState } from 'react'
import { useAssetWorkspace, primaryPosition, otherPositions } from '../../hooks/useAssetWorkspace'
import { DecisionMemorySummary } from './DecisionMemorySummary'
import { useAssetDecisionTimeline } from '../../hooks/useAssetDecisionTimeline'
import { OBSERVED_PROOFS } from '../../types/decision-timeline'
/*
 * `useAnalystRatings`, deliberately, and NOT `useRatingConsensus`.
 *
 * `useRatingConsensus` looks like the obvious choice and is dead: zero
 * importers, and the `get_rating_consensus` RPC it calls is invoked from
 * nowhere else in the repo. Building the Snapshot's headline rating on an
 * unexercised server function is how a landing page acquires a silent blank.
 *
 * `useAnalystRatings` is alive, and is the ONE Belief hook that already
 * filters by `organization_id` client-side — the others rely on RLS. It
 * returns `consensus` sorted by count, so the dominant rating is `[0]`.
 */
import { useAnalystRatings } from '../../hooks/useAnalystRatings'
import { usePortfolioList } from '../../hooks/useDesktopPortfolio'
import { CORE_SECTIONS } from '../../lib/desktop-research/model'
import {
  DesktopModule, DesktopSection, DesktopColumns, DeepLinks, DeepLink, Exists, EYEBROW,
} from '../desktop/DesktopModule'
import { FrameworkScale, WeightBar, money, bigMoney } from '../portfolio-v2/PortfolioVisual'
import {
  CoverageDisplay, type CoverageRecord, type ThesisStatus,
} from '../coverage/CoverageDisplay'
import { BookFilter, type BookOption } from '../shared/BookFilter'
import { InvestmentConclusion } from './InvestmentConclusion'
import { AttentionBand } from './AttentionBand'
/*
 * The workspace resolver. Pure, deterministic, and fed only from facts this
 * component already fetched — it issues no query of its own and decides no
 * permission. See `lib/asset-workspace/context` for what it may and may not
 * claim.
 */
import {
  resolveWorkspaceState, resolveWorkspaceSignals, type WorkspaceFacts,
} from '../../lib/asset-workspace/context'
/*
 * The excerpt helper, shared with Our View rather than reimplemented.
 *
 * Both surfaces quote an analyst verbatim and attribute it; two independent
 * clippers would eventually disagree about where a sentence ends, and one of
 * them would start paraphrasing.
 */
import { ourViewExcerpt } from './OurViewSummary'

export type SnapshotSubPage = 'research' | 'workflow' | 'decisions' | 'lists'

/** The tab-data blob AssetTab is handed; only these three fields are read. */
export interface SnapshotAsset {
  id: string
  symbol?: string | null
  company_name?: string | null
}

export interface InvestmentSnapshotProps {
  asset: SnapshotAsset
  /** Already fetched by AssetTab; not re-queried here. */
  coverage: CoverageRecord[]
  thesisStatuses?: ThesisStatus[]
  /** AssetTab's live quote (`['stock-quote', symbol]`), or undefined. */
  currentQuote?: {
    price?: number | null
    changePercent?: number | null
    timestamp?: string | number | Date | null
  } | null
  /** Hand the reader to the workspace that owns a domain. */
  onOpenSubPage: (page: SnapshotSubPage) => void
}

const pct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
const shares = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 })

/**
 * Reader-facing names for the core sections.
 *
 * The raw keys are column values (`risks_to_thesis`, `where_different`), and
 * title-casing them produced "Where different" and "Risks to thesis" — which
 * is a schema leaking onto a page an investor reads. Unlisted keys still fall
 * back to the de-underscored key, so a new section appears rather than
 * vanishing.
 */
const SECTION_LABEL: Record<string, string> = {
  thesis: 'Investment thesis',
  where_different: 'Where our thesis differs',
  risks_to_thesis: 'Risks to the thesis',
  bull_case: 'Bull case',
  bear_case: 'Bear case',
  base_case: 'Base case',
}

function asOfLabel(ts: string | number | Date | null | undefined): string | null {
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function InvestmentSnapshot({
  asset, coverage, thesisStatuses = [], currentQuote, onOpenSubPage,
}: InvestmentSnapshotProps) {
  const symbol = asset.symbol ?? null

  /*
   * Organization-wide is the DEFAULT, and null is what expresses it.
   *
   * Not "no portfolio chosen yet" — the whole-organization view is the answer
   * most readers want first, and it is the only view that can say "held in
   * three of nine books". Selecting a book narrows every domain below at
   * once; it never changes what the data means.
   */
  const [portfolioId, setPortfolioId] = useState<string | null>(null)

  const { data, isLoading } = useAssetWorkspace(asset.id, symbol, 'overview')
  /*
   * The same key `DecisionMemorySummary` uses below, with the same arguments,
   * so this is a cache read rather than a second request — and the attention
   * band cannot report a different execution history from the panel it sits
   * above.
   */
  const { allEvents: timelineEvents } = useAssetDecisionTimeline({ assetId: asset.id, portfolioId })
  const { consensus, ratings } = useAnalystRatings({ assetId: asset.id })
  const { portfolios } = usePortfolioList()

  /*
   * The dominant rating, and the n it rests on.
   *
   * `n` is rendered beside it always, never suppressed. One analyst holding a
   * view is not "the firm's rating", and the existing Firm Consensus panel
   * states a percentage with no minimum-n gate — a single Buy reads there as
   * "100%". The Snapshot shows the count so the reader can discount it
   * themselves; it does not invent a threshold, which would be a product
   * decision nobody has made.
   */
  const dominant = consensus[0] ?? null

  const held = data.positions.length > 0
  const heldIds = useMemo(() => new Set(data.positions.map(p => p.portfolioId)), [data.positions])

  /*
   * Every book the reader may see, flagged by whether it holds this name.
   *
   * `usePortfolioList` is the visibility source: org-scoped, RLS-scoped, and
   * the only reader in the repo that normalises BOTH role spellings
   * production carries ('pm' and 'Portfolio Manager'). The older
   * `getUserPMPortfolios` / `getVisiblePortfoliosForUser` helpers read one
   * spelling each, have no live callers, and would silently offer a different
   * set of books than the actions accept.
   *
   * Each book is marked "held" or not, which is what a reader picking a book
   * on an ASSET page needs to know before picking. As a word, not a 1/0 —
   * a bare digit beside a book name reads as a quantity of something.
   */
  const books = useMemo(
    () => portfolios.map(p => ({
      id: p.id,
      name: p.name,
      badge: heldIds.has(p.id) ? 'held' : undefined,
    })),
    [portfolios, heldIds],
  )

  const position = primaryPosition(data.positions, portfolioId)
  const others = otherPositions(data.positions, position)
  const maxWeight = data.positions.reduce((m, p) => Math.max(m, p.weightPct ?? 0), 0)

  const core = data.sections.filter(s => (CORE_SECTIONS as readonly string[]).includes(s.section))
  const newEvidence = data.evidence.filter(e => e.isNewSinceReview)

  /* A book was chosen and this name is not in it. That is a fact, not an empty state. */
  const selectedBookName = portfolioId ? books.find(b => b.id === portfolioId)?.name ?? null : null
  const notInSelectedBook = portfolioId != null && position == null

  const quotePrice = currentQuote?.price != null && currentQuote.price > 0 ? currentQuote.price : null
  const quoteAsOf = asOfLabel(currentQuote?.timestamp)

  if (isLoading) return <SnapshotSkeleton />

  /* ------------------------------------------------------------- belief */

  /*
   * The case: what each core section actually SAYS, then the valuation.
   *
   * This section used to be three figures and a list of section names with
   * dates beside them — it could tell a reader that a thesis had been written
   * on 28 September without telling them what it said, which is the opposite
   * of what a landing surface on an investment workspace is for. The figures
   * moved up into the conclusion band; what is left here is the argument.
   *
   * Excerpts are verbatim and attributed, through the same helper Our View
   * uses. Nothing on this page paraphrases an analyst.
   */
  /*
   * `where_different` is omitted HERE because the conclusion band above owns
   * it, verbatim and attributed. Rendering it in both places printed the same
   * paragraph twice in one screen — and a reader cannot tell whether two
   * identical quotes are one record or two.
   */
  const caseSections = (CORE_SECTIONS as readonly string[])
    .filter(s => s !== 'where_different')
    .map(s => ({ key: s, row: core.find(c => c.section === s) }))

  const belief = (
    <DesktopSection key="belief" title="The case" meta="what we argue, in our own words" lead>
      {data.caseWrittenAt ? (
        <div className="flex flex-col gap-3">
          {caseSections.map(({ key, row }) => {
            const written = (row?.content ?? '').trim().length > 0
            return (
              <div key={key} className="max-w-[88ch]">
                <div className="flex items-baseline gap-2">
                  <span className="text-[12px] font-semibold text-gray-900 dark:text-gray-100">
                    {SECTION_LABEL[key] ?? key.replace(/_/g, ' ')}
                  </span>
                  {written && row?.authorName && (
                    <span className="text-[11px] text-gray-500 dark:text-gray-400">{row.authorName}</span>
                  )}
                  {written && row?.updatedAt && (
                    <span className="text-[10px] text-gray-400">
                      {new Date(row.updatedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {written ? (
                  <p className="mt-0.5 text-[12px] leading-snug text-gray-600 dark:text-gray-400">
                    {ourViewExcerpt(row!.content, 200)}
                  </p>
                ) : (
                  /* An unwritten section is a hole in the case, and naming it
                     is more useful than hiding it — it is the next job. */
                  <p className="mt-0.5 text-[12px] text-gray-400 dark:text-gray-500">Not written.</p>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="max-w-[70ch] text-[13px] text-gray-600 dark:text-gray-400">
          No core investment case has been written for {symbol ?? 'this name'}.
          {data.evidence.length > 0
            ? ` ${data.evidence.length} research item${data.evidence.length === 1 ? '' : 's'} exist against it.`
            : ' No research is on record either.'}
        </p>
      )}

      {data.ladder?.valid && data.spot != null && (
        <div className="mt-5 border-t border-gray-200/70 pt-4 dark:border-white/[0.07]">
          <div className="flex items-baseline justify-between gap-3">
            <span className={EYEBROW}>Valuation — the ladder against today</span>
            {data.target != null && quotePrice != null && (
              <span className="font-mono text-[11px] text-gray-500">
                target {money(data.target)} · {pct(((data.target - quotePrice) / quotePrice) * 100)}
              </span>
            )}
          </div>
          <div className="mt-2"><FrameworkScale ladder={data.ladder} spot={data.spot} /></div>
        </div>
      )}

      {newEvidence.length > 0 && (
        <p className="mt-3 text-[11px] text-amber-700 dark:text-amber-400">
          {newEvidence.length} item{newEvidence.length === 1 ? '' : 's'} dated after the case was last
          written. Whether each supports or challenges it is not recorded — that is the review.
        </p>
      )}

      <DeepLinks>
        <DeepLink label="Research" onClick={() => onOpenSubPage('research')} />
        <DeepLink label="Process" onClick={() => onOpenSubPage('workflow')} />
      </DeepLinks>
    </DesktopSection>
  )

  /* ----------------------------------------------------------- position */

  const positionBody = notInSelectedBook ? (
    <p className="text-[12px] text-gray-600 dark:text-gray-400">
      {selectedBookName} does not hold {symbol ?? 'this name'}.
      {data.positions.length > 0 && ` It is held in ${data.positions.length} other book${data.positions.length === 1 ? '' : 's'}.`}
    </p>
  ) : position ? (
    <>
      {position.weightPct != null ? (
        <WeightBar weightPct={position.weightPct} max={maxWeight} label={`Weight in ${position.portfolioName}`} />
      ) : (
        <p className="text-[11px] text-gray-500">
          This book&apos;s market value could not be derived, so no weight is shown.
        </p>
      )}
      <ul className="mt-3 flex flex-col gap-1 text-[12px]">
        <Exists label="Shares" value={shares(position.shares)} />
        <Exists label="Market value" value={bigMoney(position.marketValue)} />
        <Exists label="Average cost" value={position.avgCost != null ? money(position.avgCost) : null} />
        <Exists
          label="Unrealised"
          value={position.unrealisedGain != null
            ? `${position.unrealisedGain >= 0 ? '+' : ''}${bigMoney(position.unrealisedGain)} (${pct(position.unrealisedPct!)})`
            : null}
        />
      </ul>
      {position.avgCost == null && (
        <p className="mt-2 text-[10px] text-gray-500">
          No average cost on record, so no unrealised figure is shown.
        </p>
      )}
      {others.length > 0 && !portfolioId && (
        <div className="mt-4 border-t border-gray-200/70 pt-3 dark:border-white/[0.07]">
          <div className={EYEBROW}>Also held in</div>
          <div className="mt-2 flex flex-col gap-1">
            {/* Each book's weight is against its OWN market value. 25% of one
                fund plus 4% of another is not 29% of anything, so these are
                never summed. */}
            {others.map(o => (
              <div key={o.portfolioId} className="flex items-baseline gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{o.portfolioName}</span>
                <span className="font-mono text-[11px] text-gray-500">{shares(o.shares)} sh</span>
                <span className="w-14 text-right font-mono text-[11px] font-semibold tabular-nums">
                  {o.weightPct != null ? `${o.weightPct.toFixed(1)}%` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  ) : (
    <p className="text-[12px] text-gray-600 dark:text-gray-400">
      Not held in any book you can see.
    </p>
  )

  const positionModule = (
    <DesktopModule
      key="position"
      title={held ? (portfolioId ? 'Position' : 'Largest position') : 'Position'}
      meta={position?.asOf ? `as of ${new Date(position.asOf).toLocaleDateString()} · at book price` : undefined}
    >
      {positionBody}
      <DeepLinks>
        <DeepLink label="Decisions" onClick={() => onOpenSubPage('decisions')} />
      </DeepLinks>
    </DesktopModule>
  )

  /* -------------------------------------------------------- active work */

  const openDecisions = data.decisions.filter(d => d.decidedAt == null)

  /*
   * Execution proof, counted from the same timeline the Decision Memory panel
   * reads. Same hook, same key, same arguments — React Query serves the second
   * caller from cache, so this costs no request and the band and the panel
   * cannot disagree about how many fills were actually observed.
   */
  const executionProvenance = useMemo(() => {
    const executed = timelineEvents.filter(e => e.executionProof != null)
    const observed = executed.filter(e => OBSERVED_PROOFS.includes(e.executionProof!))
    return { total: executed.length, unobserved: executed.length - observed.length }
  }, [timelineEvents])
  const scopedIdeas = portfolioId
    ? data.liveIdeas.filter(i => i.portfolioName === selectedBookName)
    : data.liveIdeas
  const scopedOpen = portfolioId
    ? openDecisions.filter(d => d.portfolioId === portfolioId)
    : openDecisions

  /*
   * Boxed, and in the right-hand column beside the position.
   *
   * It was an unboxed section under the case, which put "what is owed on this
   * name" at the bottom of a long read. Active work is the only thing on this
   * page a reader can act on today, so it sits with the book rather than
   * trailing the argument.
   */
  const activeWork = (
    <DesktopModule key="work" title="Active work" meta="what is owed on this name">
      {scopedIdeas.length === 0 && scopedOpen.length === 0 ? (
        <p className="text-[12px] text-gray-600 dark:text-gray-400">
          Nothing open{portfolioId ? ` in ${selectedBookName}` : ''}. No live ideas and no pending
          decision requests.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {scopedIdeas.map(i => (
            <div key={i.id} className="flex items-baseline gap-2 text-[12px]">
              <span className="rounded bg-blue-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                {i.action ?? 'idea'}
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                {i.rationale ?? 'No rationale recorded'}
              </span>
              <span className="shrink-0 text-[11px] text-gray-500">{i.portfolioName ?? '—'}</span>
              {/* `stage` is a raw enum (`ready_to_recommend`); a reader should
                  not be shown a column name. */}
              <span className="shrink-0 text-[10px] uppercase tracking-wide text-gray-500">
                {i.stage ? i.stage.replace(/_/g, ' ') : ''}
              </span>
            </div>
          ))}
          {scopedOpen.map(d => (
            <div key={d.id} className="flex items-baseline gap-2 text-[12px]">
              <span className="rounded bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                pending
              </span>
              <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
                {d.decisionNote ?? d.action ?? 'Decision request'}
              </span>
              <span className="shrink-0 text-[11px] text-gray-500">{d.portfolioName ?? '—'}</span>
            </div>
          ))}
        </div>
      )}
      <DeepLinks>
        <DeepLink label="Decisions" onClick={() => onOpenSubPage('decisions')} />
        <DeepLink label="Process" onClick={() => onOpenSubPage('workflow')} />
        <DeepLink label="Lists" onClick={() => onOpenSubPage('lists')} />
      </DeepLinks>
    </DesktopModule>
  )

  /* ----------------------------------------------------- decision memory */

  /*
   * No longer reserved — Increment 2B built it.
   *
   * This panel used to list `data.decisions` filtered to `decidedAt != null`
   * and say that the real thing was coming. It now reads the SAME hook the
   * Decisions timeline reads, through `DecisionMemorySummary`, so the landing
   * surface and the narrative beneath it cannot report different states.
   *
   * It summarises rather than truncating: a landing surface answers "where
   * does this stand", and the newest four events on an active name are often
   * four executions, which says nothing about whether anything is waiting.
   * The summary counts the states and flags executions that are not evidenced
   * by an observed fill.
   */
  const decisionMemory = (
    <DesktopModule key="memory" title="Decision memory" meta="recommended → decided → executed → reviewed">
      <DecisionMemorySummary
        assetId={asset.id}
        portfolioId={portfolioId}
        symbol={symbol}
        heldBookIds={data.positions.map(p => p.portfolioId)}
        onOpenTimeline={() => onOpenSubPage('decisions')}
      />
      <DeepLinks>
        <DeepLink label="Decisions" onClick={() => onOpenSubPage('decisions')} />
      </DeepLinks>
    </DesktopModule>
  )

  /* ------------------------------------------------- what needs attention */

  /*
   * Facts in, signals out. Nothing here queries.
   *
   * `timelineEvents` comes from the SAME `useAssetDecisionTimeline` key
   * `DecisionMemorySummary` already uses with the same arguments, so React
   * Query serves it from cache rather than issuing a second request — and the
   * band cannot report a different execution history from the panel below it.
   */
  const workspaceFacts: WorkspaceFacts = {
    symbol,
    positions: data.positions.map(p => ({
      portfolioId: p.portfolioId, portfolioName: p.portfolioName, weightPct: p.weightPct ?? null,
    })),
    coveringUserIds: coverage.map(c => c.user_id).filter((v): v is string => Boolean(v)),
    caseWrittenAt: data.caseWrittenAt,
    writtenSections: core.map(c => ({ section: c.section, updatedAt: c.updatedAt ?? null })),
    rating: dominant ? { value: dominant.value, count: dominant.count, total: ratings.length } : null,
    target: data.target,
    spot: quotePrice ?? data.spot,
    newEvidenceCount: newEvidence.length,
    openDecisions: openDecisions.map(d => ({
      id: d.id, action: d.action ?? null,
      portfolioId: d.portfolioId ?? null, portfolioName: d.portfolioName ?? null,
    })),
    liveIdeaCount: data.liveIdeas.length,
    unobservedExecutionCount: executionProvenance.unobserved,
    executionCount: executionProvenance.total,
    viewerId: null,
    arrivalIntent: null,
  }
  const workspaceState = resolveWorkspaceState(workspaceFacts)
  /*
   * Execution provenance is withheld HERE, and only here.
   *
   * The Decision Memory panel on this same screen already states it, word for
   * word, from the same counts — and the first build rendered both, 700px
   * apart, so one screen made the same claim twice. The band's job is to
   * surface what a reader could not otherwise assemble; a fact the
   * authoritative panel is already stating beside its own data is not that.
   *
   * The signal stays in the resolver because it is real, and a consumer that
   * is NOT next to Decision Memory — the phone, a lens, a digest — should
   * still get it.
   */
  const workspaceSignals = resolveWorkspaceSignals(workspaceFacts)
    .filter(s => s.kind !== 'provenance')

  /* --------------------------------------------------------- composition */

  return (
    <div
      data-testid="investment-snapshot"
      data-asset={asset.id}
      data-portfolio={portfolioId ?? 'all'}
      data-workspace-state={workspaceState}
    >
      <SnapshotHeader
        price={quotePrice}
        asOf={quoteAsOf}
        lastClose={data.spot}
        /*
         * The chip answers the question IN THE CURRENT SCOPE.
         *
         * It used to always report the organization-wide truth, so selecting
         * a book that does not hold the name left "Held · 3 books" sitting
         * directly above "Large Cap Value does not hold AAPL". Both were
         * true and together they read as a contradiction — the exact
         * incoherence a single governing selector is supposed to remove.
         */
        held={portfolioId ? position != null : held}
        heldLabel={portfolioId
          ? (position != null ? `Held in ${selectedBookName}` : `Not held in ${selectedBookName}`)
          : held ? `Held · ${data.positions.length} book${data.positions.length === 1 ? '' : 's'}` : 'Not held'}
        coverage={coverage}
        thesisStatuses={thesisStatuses}
        books={books}
        portfolioId={portfolioId}
        onSelectBook={setPortfolioId}
      />
      {/*
        The conclusion comes FIRST, above the columns, at full width.

        It used to be three figures inside the Belief section, level with
        everything else on the page, so the four questions a reader actually
        arrives with — what do we think, what is it worth, where are we
        different, are we positioned for it — had to be assembled from four
        places. Nothing below it repeats a figure it states.
      */}
      <div className="pt-4">
        <InvestmentConclusion
          symbol={symbol}
          rating={dominant ? { value: dominant.value, count: dominant.count } : null}
          analystCount={ratings.length}
          target={data.target}
          spot={quotePrice ?? data.spot}
          ladder={data.ladder}
          sections={core.map(c => ({
            section: c.section,
            content: c.content,
            updatedAt: c.updatedAt ?? null,
            authorName: c.authorName ?? null,
          }))}
          weightPct={position?.weightPct ?? null}
          bookName={position?.portfolioName ?? selectedBookName}
          heldBookCount={data.positions.length}
          notInSelectedBook={notInSelectedBook}
          onOpenResearch={() => onOpenSubPage('research')}
        />
      </div>

      {/*
        What needs attention, between the conclusion and the detail.

        Placed here because it is the only thing on the page a reader could
        not assemble themselves: the conclusion states figures, the panels
        below state records, and this states the RELATIONSHIPS between them —
        a rating that disagrees with an open recommendation, exposure with no
        case behind it, a price past its target.

        Absent when there is nothing to say. Not an empty state and not a
        reassuring all-clear: on a half-loaded page "no signals" is not a
        finding this surface is entitled to assert.
      */}
      {workspaceSignals.length > 0 && (
        <div className="pt-3">
          <AttentionBand
            state={workspaceState}
            signals={workspaceSignals}
            /* `snapshot` is where the reader already is, so it is a no-op
               here rather than a navigation to the current page. */
            onOpen={(page) => { if (page !== 'snapshot') onOpenSubPage(page) }}
          />
        </div>
      )}

      <div className="pt-5">
        {/*
          Left is the argument and what we did about it; right is where we
          stand and what is owed.

          Decision memory sits on the WIDE side deliberately: it is prose with
          five status chips and a disclosure sentence, and in the narrow column
          every one of those wrapped. It also reads as the end of the left-hand
          story — thesis, valuation, then the record of acting on them.
        */}
        <DesktopColumns
          lead={<>{belief}{decisionMemory}</>}
          context={<>{positionModule}{activeWork}</>}
        />
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- header */

/**
 * The Snapshot's context strip — NOT a second asset header.
 *
 * ── What it deliberately does not render ─────────────────────────────────
 *
 * Symbol, company name, price and change. The page's own sticky header sits
 * roughly eight pixels above this and already carries all four. The first
 * build of this strip repeated them, and seeing the same quote printed twice
 * in one eyeful is exactly the incoherence this page exists to remove: a
 * reader cannot tell whether two figures that agree are one fact or two
 * reads, and the moment they disagree — they ARE two independent fetches of
 * the same symbol — the page is lying in one of the two places.
 *
 * So this carries only what the header above it cannot say:
 *
 *   as-of     the header shows a price with NO date. A figure presented as
 *             "current" with no date invites the reader to trade against a
 *             number that may be hours or days old. When no live quote
 *             resolves, the last close is named AS the last close rather
 *             than silently standing in for today.
 *   held      whether this organization owns it at all, and in how many books
 *   coverage  who is responsible for it
 *   scope     the one selector, which governs all three domains below
 */
function SnapshotHeader({
  price, asOf, lastClose, held, heldLabel,
  coverage, thesisStatuses, books, portfolioId, onSelectBook,
}: {
  price: number | null
  asOf: string | null
  lastClose: number | null
  /** Held IN THE CURRENT SCOPE — drives the chip's tone. */
  held: boolean
  heldLabel: string
  coverage: CoverageRecord[]
  thesisStatuses: ThesisStatus[]
  books: BookOption[]
  portfolioId: string | null
  onSelectBook: (id: string | null) => void
}) {
  const basis = price != null
    ? (asOf ? `Quote as of ${asOf}` : 'Live quote')
    : lastClose != null
      ? `Last close ${money(lastClose)}`
      : 'No price on record'

  return (
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-gray-200 pb-3 dark:border-white/[0.08]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={`rounded-full px-2 py-px text-[10px] font-semibold uppercase tracking-wide ${
            held
              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'bg-gray-100 text-gray-600 dark:bg-white/[0.06] dark:text-gray-400'
          }`}
        >
          {heldLabel}
        </span>
        <span className={`text-[11px] ${price == null && lastClose == null ? 'text-gray-400' : 'text-gray-500'}`}>
          {basis}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {coverage.length > 0 ? (
          <CoverageDisplay
            coverage={coverage}
            showHeader={false}
            thesisStatuses={thesisStatuses}
            showThesisStatus
          />
        ) : (
          <span className="text-[11px] text-gray-500">No coverage assigned</span>
        )}
        <BookFilter
          books={books}
          portfolioId={portfolioId}
          onSelect={onSelectBook}
          allLabel="Organization-wide"
          testId="snapshot-book-filter"
        />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- bits */

/*
 * `Figure` lived here and is gone: the three figures it drew moved into
 * `InvestmentConclusion`, which needs a richer one (a direction arrow, an
 * explicit "Not set" rather than an em-dash). Keeping this as a second,
 * simpler figure for nobody to use is how two of them end up on one page
 * disagreeing about what an absent value looks like.
 */

function SnapshotSkeleton() {
  return (
    <div className="animate-pulse space-y-5" data-testid="snapshot-skeleton">
      <div className="flex items-center justify-between border-b border-gray-200 pb-4 dark:border-white/[0.08]">
        <div className="space-y-2">
          <div className="h-6 w-48 rounded bg-gray-200 dark:bg-gray-700" />
          <div className="h-3 w-64 rounded bg-gray-100 dark:bg-gray-800" />
        </div>
        <div className="h-7 w-40 rounded bg-gray-100 dark:bg-gray-800" />
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.62fr)_minmax(300px,1fr)]">
        <div className="space-y-4">
          <div className="h-40 rounded-xl bg-gray-100 dark:bg-gray-800" />
          <div className="h-32 rounded-xl bg-gray-100 dark:bg-gray-800" />
        </div>
        <div className="space-y-4">
          <div className="h-48 rounded-xl bg-gray-100 dark:bg-gray-800" />
          <div className="h-28 rounded-xl bg-gray-100 dark:bg-gray-800" />
        </div>
      </div>
    </div>
  )
}
