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
import { useMemo, type ReactNode } from 'react'
import { clsx } from 'clsx'
import { useAssetWorkspace } from '../../hooks/useAssetWorkspace'
import { DecisionMemorySummary } from './DecisionMemorySummary'
import { useAssetDecisionTimeline } from '../../hooks/useAssetDecisionTimeline'
import { OBSERVED_PROOFS, isAwaitingDecision } from '../../types/decision-timeline'
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
import { CORE_SECTIONS } from '../../lib/desktop-research/model'
/*
 * Snapshot-local blocks, NOT the shared `DesktopModule` grammar.
 *
 * `desktop/DesktopModule` is shared by six workspaces; the Snapshot had to
 * match the Asset Page's own Research language (14/15px type, one readable
 * heading per block, rounded-xl cards with a thin rail), and editing the shared
 * chrome to get there would have redesigned five other workspaces. It is left
 * untouched; these live beside the Snapshot.
 */
import {
  SnapBlock, StatusChip, GapChip, ActionRow, QuietLine, FactRow,
} from './SnapshotBlocks'
import { FrameworkScale, WeightBar, money, bigMoney } from '../portfolio-v2/PortfolioVisual'
/* Only the TYPE now: coverage is still read to resolve who is responsible
   for the name, but it is no longer DRAWN here — the asset's own sticky
   header carries the roster, and this page was the second copy. */
import { type CoverageRecord } from '../coverage/CoverageDisplay'
import { EXPOSURE_ANCHOR_ID } from '../../lib/asset-workspace/strip-targets'
/* The bear/bull arithmetic only — the big conclusion CARD is gone; its figures
   now sit inline in Our view, and its absences are gap chips rather than a
   130px empty hero. The helper stays exported for the phone shell. */
import { conclusionFigures } from './InvestmentConclusion'
/*
 * The workspace resolver. Pure, deterministic, and fed only from facts this
 * component already fetched — it issues no query of its own and decides no
 * permission. See `lib/asset-workspace/context` for what it may and may not
 * claim.
 */
import {
  resolveWorkspaceState, STALE_CASE_DAYS, type WorkspaceFacts,
} from '../../lib/asset-workspace/context'
/*
 * The excerpt helper, shared with Our View rather than reimplemented.
 *
 * Both surfaces quote an analyst verbatim and attribute it; two independent
 * clippers would eventually disagree about where a sentence ends, and one of
 * them would start paraphrasing.
 */
import { ourViewExcerpt, hasLiveProse, OurViewSummary, type OurViewField } from './OurViewSummary'
import type { Contribution } from '../../hooks/useContributions'

/* 'decisions' lands in Work (the open items); 'history' lands in History (the
   decision record). The Overview links to both and they are not the same
   place any more. */
export type SnapshotSubPage = 'research' | 'workflow' | 'decisions' | 'lists' | 'history'

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
  /** AssetTab's live quote (`['stock-quote', symbol]`), or undefined. */
  currentQuote?: {
    price?: number | null
    changePercent?: number | null
    timestamp?: string | number | Date | null
  } | null
  /** Hand the reader to the workspace that owns a domain. */
  onOpenSubPage: (page: SnapshotSubPage) => void
  /*
   * The firm's written contributions, passed down rather than re-queried.
   *
   * These moved here from the Research tab's "Our View" pane. Research is one
   * analyst's document; WHO ELSE has written and where they disagree is a
   * fact about the organisation, and it belongs on the surface that describes
   * the organisation's position. Optional so the component still renders for
   * callers that have not wired it.
   */
  contributions?: Contribution[]
  contributionFields?: OurViewField[]
  coveringAnalystIds?: Set<string>
  /** Open one analyst's full research document. */
  onOpenAnalyst?: (userId: string) => void
  /** The viewer, so the Snapshot can distinguish THEIR view from the firm's
   *  (research authorship + rating) without a second query. */
  currentUserId?: string
  /**
   * Open one research note, through AssetTab's existing note navigation.
   *
   * Without it "What changed" can only state a count: naming items a reader
   * cannot open would be a list of dead ends. Optional, so a caller that has
   * not wired it still gets the truthful summary.
   */
  onOpenEvidence?: (noteId: string) => void
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


export function InvestmentSnapshot({
  asset, coverage, currentQuote, onOpenSubPage,
  contributions, contributionFields, coveringAnalystIds, onOpenAnalyst, currentUserId,
  onOpenEvidence,
}: InvestmentSnapshotProps) {
  const symbol = asset.symbol ?? null

  /*
   * ── There is no book selector any more, and nothing to configure ───────
   *
   * This was a three-state control at the top of the Overview — a chip, the
   * coverage roster and an "Organization-wide" dropdown — that narrowed every
   * domain below at once.
   *
   * The reason it goes: an Overview is the answer you get before you have
   * asked a question. Opening a name and being handed a scope selector asks
   * the reader to configure the page before it will tell them anything, and
   * the configuration they nearly always want is the one it already defaults
   * to. The narrowing it offered is also available where it belongs — the
   * Decisions and Work surfaces scope themselves, and every book this name
   * sits in is now listed outright in "Exposure & valuation" rather than one
   * being picked and the rest named in a footnote.
   *
   * Kept as a `const null` rather than deleted so the four consumers below
   * still read as "org-wide" explicitly, and so re-introducing a scope — in
   * a place a reader asked for one — is one line here.
   */
  const portfolioId: string | null = null

  const { data, isLoading } = useAssetWorkspace(asset.id, symbol, 'overview')
  /*
   * The same key `DecisionMemorySummary` uses below, with the same arguments,
   * so this is a cache read rather than a second request — and the attention
   * band cannot report a different execution history from the panel it sits
   * above.
   */
  const { allEvents: timelineEvents } = useAssetDecisionTimeline({ assetId: asset.id, portfolioId })
  const { consensus, ratings, myRating } = useAnalystRatings({ assetId: asset.id })

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

  /*
   * The list of every book the reader may see went with the selector.
   *
   * It existed to populate the scope dropdown, each entry flagged "held" or
   * not so a reader could tell before picking. With nothing to pick, what
   * matters is only the books that DO hold this name, and those come from
   * `data.positions` — which is the set "Exposure & valuation" now draws in
   * full. `usePortfolioList` is no longer read here at all.
   */

  /*
   * ── Every hook in this component lives ABOVE the `isLoading` return ──
   *
   * This `useMemo` was further down, next to the panel that consumes it, and
   * that crashed the authenticated app:
   *
   *     Rendered more hooks than during the previous render.
   *
   * `if (isLoading) return <SnapshotSkeleton />` sits below this line. On the
   * first render the workspace query is in flight, the component returns at
   * that guard, and React records seven hooks. On the next render the data has
   * arrived, execution continues past the guard, and an eighth hook appears —
   * which React cannot reconcile against a list of seven.
   *
   * The harness never caught it because its stubbed `useAssetWorkspace`
   * returns `isLoading: false` on the first render, so the loading -> loaded
   * transition that triggers this never happens there. Only a real async
   * query produces it. `__tests__/snapshot-hook-order.test.tsx` now drives
   * that transition for real.
   *
   * So: new hooks go here, above the guard, whatever they are for. Proximity
   * to the consumer is not worth a crash.
   *
   * Execution proof is counted from the same timeline the Decision Memory
   * panel reads — same hook, same key, same arguments, so React Query serves
   * the second caller from cache and the band and the panel cannot disagree
   * about how many fills were actually observed.
   */
  const executionProvenance = useMemo(() => {
    const executed = timelineEvents.filter(e => e.executionProof != null)
    const observed = executed.filter(e => OBSERVED_PROOFS.includes(e.executionProof!))
    return { total: executed.length, unobserved: executed.length - observed.length }
  }, [timelineEvents])

  /*
   * Personal vs. firm: what the VIEWER has written on this name, and where the
   * firm's analysts diverge — derived from the SAME RLS-scoped contributions
   * the roster uses (already visibility-filtered upstream; private views never
   * reach here). It counts and links, it never merges several analysts into one
   * "firm thesis". A core section with two authors is "2 views → compare", not a
   * majority. `where_different` is a core section, so it counts even though its
   * prose is shown in the conclusion band, not re-quoted here.
   */
  const firmVsYou = useMemo(() => {
    const coreKeys = CORE_SECTIONS as readonly string[]
    const live = (contributions ?? []).filter(
      c => !c.is_archived && hasLiveProse(c) && coreKeys.includes(c.section),
    )
    const bySection = new Map<string, Set<string>>()
    for (const c of live) {
      const set = bySection.get(c.section) ?? new Set<string>()
      if (c.created_by) set.add(c.created_by)
      bySection.set(c.section, set)
    }
    const yours = currentUserId ? coreKeys.filter(k => bySection.get(k)?.has(currentUserId)) : []
    const divergent = coreKeys.filter(k => (bySection.get(k)?.size ?? 0) >= 2)
    /* Distinct people who have written any core section, which is what
       decides whether a roster of contributors tells a reader anything the
       case above it has not already. */
    const authors = new Set<string>()
    for (const set of bySection.values()) for (const id of set) authors.add(id)
    return {
      bySection,
      authorCount: authors.size,
      coreCount: coreKeys.length,
      writtenCount: coreKeys.filter(k => (bySection.get(k)?.size ?? 0) > 0).length,
      yourCount: yours.length,
      divergentCount: divergent.length,
      hasContext: contributions != null,
    }
  }, [contributions, currentUserId])

  /* The bar scale is shared across every book's row, so two weights drawn on
     this page are comparable by eye. Each is still a percentage of its OWN
     book and they are never summed. */
  const maxWeight = data.positions.reduce((m, p) => Math.max(m, p.weightPct ?? 0), 0)

  /* `primaryPosition` / `otherPositions` are gone from this surface. They
     nominated one book as the principal holding so the rest could be a
     footnote; every book is drawn the same way now, so there is no principal
     to pick. The newest as-of across them dates the block. */
  const positionAsOf = data.positions.reduce<string | null>(
    (max, p) => (p.asOf && (max == null || p.asOf > max) ? p.asOf : max),
    null,
  )

  const core = data.sections.filter(s => (CORE_SECTIONS as readonly string[]).includes(s.section))
  const newEvidence = data.evidence.filter(e => e.isNewSinceReview)

  const quotePrice = currentQuote?.price != null && currentQuote.price > 0 ? currentQuote.price : null

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

  /* `firmRatingTotal` went with the rail's rating line — the header strip
     states "N of M" and this page no longer repeats it. */
  const yourRatingDiffers = !!myRating && (!dominant || myRating.rating_value !== dominant.value)

  /* Bear/bull arithmetic, inline — no longer a 130px card that says "Not set". */
  const figures = conclusionFigures({ target: data.target, spot: quotePrice ?? data.spot, ladder: data.ladder })
  const sectionRow = (k: string) => core.find(c => c.section === k && (c.content ?? '').trim().length > 0)
  /* `thesis` and `risks_to_thesis` render inline in the case (including their
     own "Not written"), so only the variant is pulled out here. */
  const variantRow = sectionRow('where_different')

  const caseAgeDays = data.caseWrittenAt
    ? Math.floor((Date.now() - new Date(data.caseWrittenAt).getTime()) / 86_400_000)
    : null
  /* The resolver's own threshold, imported rather than retyped as `120`.
     A literal here is how two surfaces end up disagreeing about staleness. */
  const caseStale = caseAgeDays != null && caseAgeDays >= STALE_CASE_DAYS
  const caseAgeLabel = caseAgeDays == null
    ? undefined
    : caseAgeDays < 31 ? 'written this month' : `written ${Math.floor(caseAgeDays / 30)} months ago`

  /*
   * ── The stale treatment ────────────────────────────────────────────────
   *
   * This used to be the age label tinted amber. Tinted text is not a state:
   * at a glance "written 11 months ago" in amber and the same words in grey
   * are the same sentence, and nothing on screen said what the colour meant
   * or what the reader was supposed to do about it. A reader who had never
   * been told the rule could not learn it from the page.
   *
   * So the state gets its own chip in the one "act now" colour the Snapshot
   * uses, the chip carries the exact last-written date rather than the
   * rounded age, and hovering it states the rule in words. The rounded age
   * stays beside it, untinted, because that is the readable version.
   */
  const caseWrittenOn = data.caseWrittenAt
    ? new Date(data.caseWrittenAt).toLocaleDateString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
      })
    : null
  const staleTitle = caseAgeDays == null ? undefined : (
    `Nothing has been added to the investment case since ${caseWrittenOn}`
    + ` — ${caseAgeDays} days. A case is treated as stale after ${STALE_CASE_DAYS} days,`
    + ' which is one quarter plus a reporting lag.'
  )

  /*
   * Each absence is one quiet chip, named ONCE, where it can be filled.
   *
   * Only gaps in the written CASE belong here. `risks_to_thesis` is excluded
   * because it already renders inline as "Not written", and the valuation gaps
   * (no target, no bear/bull range) are excluded because Exposure & valuation
   * states them — a sparse name was otherwise carrying the same "no price
   * target" message in two blocks with two calls to action.
   */
  const caseGaps: string[] = []
  if (!variantRow) caseGaps.push('Where we differ not recorded')

  /*
   * ── One byline, or per-section attribution ─────────────────────────────
   *
   * Every written section used to carry a heading ROW: the section name, the
   * author, the date, a YOU chip, and sometimes a "2 views" link — five
   * pieces of chrome stacked above a two-line paragraph, three times over.
   * On the common name, which is one analyst writing in one sitting, that
   * printed the same name and the same date three times and the block read
   * as a form with the answers filled in.
   *
   * When one person wrote all of it, they are named once, in the meta line,
   * and the sections become prose. When more than one person wrote, the
   * attribution goes back per section — because then WHO said it is part of
   * what was said — but inline after the sentence rather than above it.
   */
  const writtenRows = [...caseSections.map(c => c.row), variantRow]
    .filter((r): r is NonNullable<typeof r> => !!r && (r.content ?? '').trim().length > 0)
  const namedAuthors = new Set(writtenRows.map(r => r.authorName).filter(Boolean))
  /*
   * `authorCount` is the gate, not `namedAuthors`, and the first draft got
   * this wrong in a way a render test caught: `caseSections` holds ONE row
   * per section (`core.find`), so when two analysts write the same section
   * only one of them appears in `writtenRows`. Keying off that set alone
   * named a sole author on a name two people had written — the single worst
   * thing this block could claim. `firmVsYou.authorCount` counts distinct
   * authors across every contribution, which is the actual question.
   */
  const soleAuthor = firmVsYou.authorCount === 1 && writtenRows.length > 0 && namedAuthors.size === 1
    ? [...namedAuthors][0]!
    : null
  /* Whether that one author is the reader — so the per-section YOU chips can
     go without the page losing the fact that this is the reader's own work. */
  const soleAuthorIsYou = !!soleAuthor && !!currentUserId
    && writtenRows.every(r => {
      const authors = firmVsYou.bySection.get(r.section)
      return !!authors && authors.size === 1 && authors.has(currentUserId)
    })

  const metaParts: ReactNode[] = []
  if (soleAuthor) {
    metaParts.push(<span key="by">by {soleAuthor}{soleAuthorIsYou ? ' (you)' : ''}</span>)
  } else if (firmVsYou.authorCount > 0) {
    metaParts.push(<span key="n">{firmVsYou.authorCount} contributors</span>)
  }
  /* The rounded age is dropped once the chip is showing: "written 11 months
     ago · Stale · last written Nov 20, 2025" states the same date twice, and
     the exact one is the one you act on. */
  if (caseAgeLabel && !caseStale) metaParts.push(<span key="age">{caseAgeLabel}</span>)

  const ourViewMeta = (metaParts.length > 0 || caseStale) ? (
    <span className="inline-flex flex-wrap items-center gap-x-1.5">
      {metaParts.map((part, i) => (
        <span key={i}>
          {i > 0 && <span className="px-1 opacity-60">·</span>}
          {part}
        </span>
      ))}
      {caseStale && (
        <span
          title={staleTitle}
          data-testid="snapshot-stale-chip"
          className="inline-flex cursor-help items-center gap-1 rounded bg-amber-50 px-1.5 py-px text-[11px] font-semibold uppercase tracking-wide text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
        >
          Stale
          <span className="font-normal normal-case tracking-normal opacity-80">
            · last written {caseWrittenOn}
          </span>
        </span>
      )}
    </span>
  ) : undefined

  const ourView = (
    <SnapBlock
      key="our-view"
      testId="snapshot-our-view"
      rail="primary"
      title="Our view"
      /*
        Age and authorship on one line, because they are one question: how
        current is this, and whose is it. The contributor count used to be the
        heading of a whole separate block below ("Research perspectives · the
        firm, by contributor"), which on a single-author name listed the same
        three section names as the prose directly above it.
      */
      meta={ourViewMeta}
      /* When the case is stale the way in is named as the job, not as a
         destination: the chip states the problem, this states the fix. */
      action={(
        <button
          type="button"
          onClick={() => onOpenSubPage('research')}
          className={clsx(
            'text-sm hover:underline',
            caseStale
              ? 'font-medium text-amber-700 dark:text-amber-400'
              : 'text-primary-600 dark:text-primary-400',
          )}
        >
          {caseStale ? 'Update the case →' : 'Open Research →'}
        </button>
      )}
    >
      {/*
        Two columns: the argument at a reading measure, and a narrow rail that
        uses the space beside it.

        The card spans the page, but prose must not: at full width a thesis ran
        to ~160 characters a line while the right half of a tall card stayed
        empty. The rail is not new information — it is the firm-vs-you summary
        and the case gaps, moved out of the reading column to where the blank
        was. Nothing in it is repeated anywhere else on the page.
      */}
      <div className="flex flex-col gap-5 xl:flex-row xl:gap-8">
        <div className="min-w-0 flex-1">
      {data.caseWrittenAt ? (
        /*
          Prose, not fields.
          Each section is one paragraph with its name as a run-in lead, so the
          block reads as an argument rather than as a filled-in form. The
          excerpt budget went 280 -> 420 characters for the same reason: at
          280 a thesis was routinely cut inside its second sentence, which is
          where analysts here put the actual claim.
          The text is still verbatim and still clipped on a sentence boundary
          by `ourViewExcerpt`. Nothing on this page paraphrases an analyst.
        */
        <div className="flex max-w-[72ch] flex-col gap-3">
          {caseSections.map(({ key, row }) => {
            const written = (row?.content ?? '').trim().length > 0
            const authors = firmVsYou.bySection.get(key)
            const n = authors?.size ?? 0
            const mine = !!currentUserId && !!authors?.has(currentUserId)
            return (
              <p key={key} className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                <span className="font-semibold text-gray-900 dark:text-gray-100">
                  {SECTION_LABEL[key] ?? key.replace(/_/g, ' ')}.
                </span>{' '}
                {written ? ourViewExcerpt(row!.content, 420) : (
                  /* An unwritten section is a hole in the case, and naming it
                     is more useful than hiding it — it is the next job. */
                  <span className="text-gray-400 dark:text-gray-500">Not written.</span>
                )}
                {/* Attribution trails the sentence, and only when the meta
                    line cannot already carry it for the whole block. */}
                {written && !soleAuthor && row?.authorName && (
                  <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                    — {row.authorName}
                    {row.updatedAt && `, ${new Date(row.updatedAt).toLocaleDateString()}`}
                  </span>
                )}
                {written && !soleAuthorIsYou && mine && (
                  <span className="ml-1.5 align-middle"><StatusChip tone="recommended">You</StatusChip></span>
                )}
                {written && n >= 2 && (
                  <button
                    type="button"
                    onClick={() => onOpenSubPage('research')}
                    className="ml-1.5 text-xs text-amber-700 hover:underline dark:text-amber-400"
                  >
                    {n} views →
                  </button>
                )}
              </p>
            )
          })}
        </div>
      ) : (
        /* A compact, actionable absence — one line and the way to fix it, not a
           hero panel announcing emptiness. */
        <div className="max-w-[72ch]">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No core investment case has been written for {symbol ?? 'this name'}.
            {data.evidence.length > 0
              ? ` ${data.evidence.length} research item${data.evidence.length === 1 ? '' : 's'} exist against it.`
              : ' No research is on record either.'}
          </p>
          <button
            type="button"
            onClick={() => onOpenSubPage('research')}
            className="mt-1.5 text-sm font-medium text-primary-600 hover:underline dark:text-primary-400"
          >
            Write the investment case →
          </button>
        </div>
      )}

      {/* "Where we differ" renders HERE, once. The conclusion card that used to
          own it is gone, and printing it in two places made one record look
          like two. */}
      {variantRow && (
        <div className="mt-4 max-w-[72ch] border-t border-gray-200/70 pt-3 dark:border-white/[0.07]">
          <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              Where our thesis differs.
            </span>{' '}
            {ourViewExcerpt(variantRow.content ?? '', 420)}
            {!soleAuthor && variantRow.authorName && (
              <span className="ml-1.5 text-xs text-gray-400 dark:text-gray-500">
                — {variantRow.authorName}
              </span>
            )}
          </p>
        </div>
      )}
        </div>

        {/*
          The rail: firm-vs-you and what the case still lacks.

          The firm RATING is no longer repeated here. The header strip states
          it a couple of hundred pixels above and never scrolls away, so this
          was the same fact twice in one eyeful — and when the name has no
          rating, which is the common case, it was a labelled blank taking the
          top of the rail. What survives is the part the strip cannot say:
          whether YOU have recorded a view, and where the firm disagrees with
          itself.
        */}
        <aside className="flex shrink-0 flex-col gap-4 border-t border-gray-200/70 pt-4 dark:border-white/[0.07] xl:w-56 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0">
          {yourRatingDiffers && (
            <div>
              <div className="text-xs text-gray-500">Your rating</div>
              {/* Kept, because this is precisely what the strip does NOT
                  show once the two differ: the strip states the consensus. */}
              <div className="mt-1"><StatusChip tone="recommended">You {myRating!.rating_value}</StatusChip></div>
            </div>
          )}

          {firmVsYou.hasContext && (
            <div>
              <div className="text-xs text-gray-500">Your research</div>
              {firmVsYou.yourCount > 0 ? (
                <div className="mt-0.5 text-sm text-gray-800 dark:text-gray-200">
                  {firmVsYou.yourCount} of {firmVsYou.coreCount} case sections
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => onOpenSubPage('research')}
                  className="mt-0.5 text-left text-sm text-primary-600 hover:underline dark:text-primary-400"
                >
                  You haven't recorded your own view →
                </button>
              )}
              {firmVsYou.divergentCount > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenSubPage('research')}
                  className="mt-1 block text-left text-sm text-amber-700 hover:underline dark:text-amber-400"
                >
                  {firmVsYou.divergentCount} section{firmVsYou.divergentCount === 1 ? '' : 's'} with differing views →
                </button>
              )}
            </div>
          )}

          {caseGaps.length > 0 && (
            <div>
              <div className="text-xs text-gray-500">Not yet recorded</div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {caseGaps.map(g => <GapChip key={g} label={g} onClick={() => onOpenSubPage('research')} />)}
              </div>
            </div>
          )}
        </aside>
      </div>
    </SnapBlock>
  )

  /* ----------------------------------------------------------- position */

  /*
   * ── Every book that holds it, each stated the same way ─────────────────
   *
   * This drew ONE book in full — a weight bar, shares, market value, average
   * cost and unrealised — and then listed the others under "Also held in" as
   * a name, a share count and a percentage. Which book got the full treatment
   * was `primaryPosition`'s pick, so the page silently nominated a principal
   * holding the firm had not nominated, and the reader was told four things
   * about one book and two about the rest.
   *
   * On AMZN that read as "Weight in Large Cap Growth 14.2% / 95 sh / $15k /
   * $148.90 / +$608" and then, in a footnote, "Vision Fund 10K · 16,947 sh ·
   * 3.9%" — a far larger position, demoted to a line because of a sort order.
   *
   * Now each book is a row of the same shape. The weights are still never
   * summed: each is against its OWN book's market value, so 14.2% of one fund
   * and 3.9% of another is not 18.1% of anything.
   */
  const positionBody = data.positions.length > 0 ? (
    <div className="flex flex-col gap-4">
      {data.positions.map(p => (
        <div key={p.portfolioId}>
          {p.weightPct != null ? (
            <WeightBar weightPct={p.weightPct} max={maxWeight} label={p.portfolioName} />
          ) : (
            <div className="text-[12px] font-medium text-gray-800 dark:text-gray-200">
              {p.portfolioName}
              <span className="ml-2 text-[11px] font-normal text-gray-500">
                market value could not be derived, so no weight is shown
              </span>
            </div>
          )}
          <ul className="mt-2 flex flex-col gap-1 text-[12px]">
            <FactRow label="Shares" value={shares(p.shares)} />
            <FactRow label="Market value" value={bigMoney(p.marketValue)} />
            <FactRow label="Average cost" value={p.avgCost != null ? money(p.avgCost) : null} />
            <FactRow
              label="Unrealised"
              value={p.unrealisedGain != null
                ? `${p.unrealisedGain >= 0 ? '+' : ''}${bigMoney(p.unrealisedGain)} (${pct(p.unrealisedPct!)})`
                : null}
            />
          </ul>
          {p.avgCost == null && (
            <p className="mt-1.5 text-xs text-gray-500">
              No average cost on record, so no unrealised figure is shown.
            </p>
          )}
        </div>
      ))}
    </div>
  ) : (
    <QuietLine>Not held in any book you can see.</QuietLine>
  )

  /*
   * Exposure and valuation in ONE block.
   *
   * Apart they were two modules that are each empty on most names — "Not held
   * in any book you can see" and "no target" given a bordered card apiece. They
   * answer the same question (where do we stand against what we think it is
   * worth), so they share a block and each absence compresses to one line.
   */
  /* A bear/bull pair, or a drawable ladder: either is something the strip's
     single target number cannot express. Neither means the whole band is
     just a rule across an empty strip. */
  const spreadWorthShowing =
    (figures.bear != null && figures.bull != null)
    || (data.ladder?.valid === true && data.spot != null)

  const exposureValuation = (
    <SnapBlock
      key="exposure"
      testId="snapshot-exposure"
      /* The header strip's Exposure cell lands here — this is where the
         position is actually drawn. See `lib/asset-workspace/strip-targets`. */
      anchorId={EXPOSURE_ANCHOR_ID}
      title="Exposure & valuation"
      meta={positionAsOf ? `position as of ${new Date(positionAsOf).toLocaleDateString()}` : undefined}
    >
      {positionBody}
      {/*
        ── The target itself is not restated here ─────────────────────────

        The header strip states the firm target and the implied upside, in
        exactly those words, and it never scrolls away. This block used to
        print "Target $180.00 · −26.17%" again at its foot, two hundred pixels
        below — the same two numbers, read from the same field.

        What is NOT in the strip, and is worth the room, is the SPREAD: where
        the bear and bull cases sit around that one number, and how the spot
        falls against the ladder. A single target says what we think it is
        worth; the spread says how sure we are. So the spread stays and the
        point estimate goes.
      */}
      {(spreadWorthShowing || data.target == null) && (
        <div className="mt-4 border-t border-gray-200/70 pt-3 dark:border-white/[0.07]">
          {data.target == null && (
            <GapChip label="No price target set" onClick={() => onOpenSubPage('research')} />
          )}
          {figures.bear != null && figures.bull != null && (
            <div className="text-xs text-gray-500">
              bear {money(figures.bear)} · bull {money(figures.bull)}
              {figures.skew != null ? ` · skew ${figures.skew.toFixed(1)}:1` : ''}
            </div>
          )}
          {data.ladder?.valid && data.spot != null && (
            <div className="mt-3"><FrameworkScale ladder={data.ladder} spot={data.spot} /></div>
          )}
        </div>
      )}
    </SnapBlock>
  )

  /* ----------------------------------------------------- the decision queue */

  /*
   * Only work somebody still OWES.
   *
   * This filtered on `decidedAt == null` alone, which is "nobody ruled" — not
   * "somebody still owes a ruling". A withdrawn request is never ruled on, so
   * its `reviewed_at` stays null and it sat in the queue reading "Awaiting
   * decision" under its own note saying there was no active recommendation.
   * `isAwaitingDecision` checks the status as well, from the one place that
   * owns the decision vocabulary.
   */
  const openDecisions = data.decisions.filter(isAwaitingDecision)

  /* Every book, because there is no selector to narrow it to one. Each row
     still names its own book, so nothing is lost by not filtering. */
  const scopedOpen = openDecisions

  /*
   * An idea with a pending request on it is ONE piece of work, not two.
   *
   * The request is the further-along state, so it represents the pair and the
   * idea row is suppressed; an idea with no request still stands on its own.
   */
  const queuedIdeaIds = new Set(scopedOpen.map(d => d.ideaId).filter((v): v is string => !!v))
  const scopedIdeas = data.liveIdeas.filter(i => !queuedIdeaIds.has(i.id))

  /*
   * A request carries the idea's words when it has none of its own.
   *
   * `decision_note` is usually blank on submission, which left the queue row
   * reading "buy" — the action verb and nothing else — even though the idea it
   * was raised on says why. Same records, no extra read.
   */
  const ideaRationaleById = new Map(
    data.liveIdeas.map(i => [i.id, i.rationale] as const),
  )
  const queueTitle = (d: typeof data.decisions[number]) =>
    d.decisionNote
    ?? (d.ideaId ? ideaRationaleById.get(d.ideaId) ?? null : null)
    ?? d.action
    ?? 'Decision request'

  const hasActionable = scopedIdeas.length > 0 || scopedOpen.length > 0

  /*
   * Promoted to the top of the page, and ABSENT when nothing is owed.
   *
   * This was a right-column module sitting level with two empty cards, so the
   * one thing on the page a reader can act on today read as the least
   * important. Each row is now the navigation — which replaced the identical
   * "Open in full · Decisions · Process · Lists" footer every module carried.
   *
   * Lifecycle labels come from the record that owns each fact: an open
   * `decision_requests` row is AWAITING A DECISION (nobody has ruled); a live
   * `trade_queue_items` idea shows its own stage. "Committed, not executed" is
   * deliberately NOT restated here — Decision Memory owns it, from the same
   * timeline, and two surfaces counting fills independently is how they come
   * to disagree.
   */
  const needsDecision = hasActionable ? (
    <SnapBlock
      key="needs-decision"
      testId="snapshot-needs-decision"
      rail="action"
      title="Needs a decision"
    >
      <div className="flex flex-col gap-0.5">
        {scopedOpen.map(d => (
          <ActionRow
            key={d.id}
            tone="waiting"
            status="Awaiting decision"
            title={queueTitle(d)}
            meta={d.portfolioName ?? undefined}
            onClick={() => onOpenSubPage('decisions')}
          />
        ))}
        {scopedIdeas.map(i => (
          <ActionRow
            key={i.id}
            tone={i.stage === 'ready_to_recommend' ? 'recommended' : 'neutral'}
            /* `stage` is a raw enum; a reader should not be shown a column name. */
            status={i.stage ? i.stage.replace(/_/g, ' ') : (i.action ?? 'idea')}
            title={i.rationale ?? `${i.action ?? 'Idea'} — no rationale recorded`}
            meta={i.portfolioName ?? undefined}
            onClick={() => onOpenSubPage('decisions')}
          />
        ))}
      </div>
    </SnapBlock>
  ) : null

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
  /* The panel already carries its own "See the full history →"; the extra
     "Open in full · Decisions" footer was a second link to the same place. */
  const decisionHistory = (
    <SnapBlock
      key="memory"
      testId="snapshot-decision-history"
      title="Decision history"
      meta="recommended → decided → executed → reviewed"
    >
      <DecisionMemorySummary
        assetId={asset.id}
        portfolioId={portfolioId}
        symbol={symbol}
        heldBookIds={data.positions.map(p => p.portfolioId)}
        /* The timeline is History's content, not Work's. */
        onOpenTimeline={() => onOpenSubPage('history')}
      />
    </SnapBlock>
  )

  /* ------------------------------------------------ who else has written */

  /*
   * The organisation's contributors, moved here out of the Research tab.
   *
   * Research is one analyst's document — their sections, their ratings, their
   * targets, their editing. Who ELSE has written on this name, and where they
   * disagree, is a fact about the firm rather than about that document, and a
   * reader asking "what does this organisation think" was previously answered
   * by a pane inside one person's workspace.
   *
   * Rendered only when the tab wired it; a caller that passes nothing gets
   * nothing rather than an empty panel.
   */
  /*
   * ── Only when there is more than one voice ─────────────────────────────
   *
   * This block always rendered. On a single-author name it listed the same
   * three section names as the prose directly above it — Investment Thesis,
   * Where Our Thesis Differs, Risks to Thesis — with "1 entry" beside each,
   * attributed to the one person whose words were already on screen. Measured
   * on AMZN: 224px to restate the 250px block above it as a table of
   * contents.
   *
   * A roster earns its space when there is a roster. With one contributor the
   * fact is now a line on "Our view" ("11 mo old · 1 contributor") and the
   * link into Research moved there with it.
   */
  const perspectives = contributions && contributionFields && contributionFields.length > 0
    && firmVsYou.authorCount >= 2 ? (
    <SnapBlock
      key="contributors"
      testId="snapshot-perspectives"
      title="Research perspectives"
      meta={`${firmVsYou.authorCount} contributors`}
      action={(
        <button
          type="button"
          onClick={() => onOpenSubPage('research')}
          className="text-sm text-primary-600 hover:underline dark:text-primary-400"
        >
          Open Research →
        </button>
      )}
    >
      <OurViewSummary
        contributions={contributions}
        fields={contributionFields}
        coveringAnalystIds={coveringAnalystIds}
        onOpenAnalyst={onOpenAnalyst}
        currentUserId={currentUserId}
        symbol={symbol}
        mode="roster"
        bare
      />
    </SnapBlock>
  ) : null

  /* ---------------------------------------------------------- what changed */

  /*
   * The SUPPORTED freshness summary — deliberately not a list of evidence rows.
   *
   * `useAssetWorkspace.evidence` carries id / createdAt / authorName / isShared
   * reliably, but `title` is NULLABLE and nothing in this component's prop
   * surface can open a single note: `onOpenSubPage` takes a page, and the
   * per-note route (`asset.noteId`) belongs to AssetTab. Rendering rows under
   * possibly-blank titles that cannot be opened would be a list of dead ends,
   * so this states what is actually on record — how many items postdate the
   * case, and when the newest arrived.
   *
   * Whether an item supports or challenges the thesis is recorded nowhere, and
   * is not inferred here.
   */
  const newestEvidenceAt = newEvidence.reduce<string | null>(
    (max, e) => (max == null || e.createdAt > max ? e.createdAt : max),
    null,
  )

  /*
   * ── Absent when nothing changed ────────────────────────────────────────
   *
   * It always rendered, and on a quiet name it spent a whole band — 87px
   * measured on AMZN — to say "No research has been filed since the case was
   * last written." The header strip already says that, permanently, in three
   * words: "no new research since". A section whose entire content is a
   * restatement of the strip is not telling the reader anything; it is
   * occupying the place where something might have.
   *
   * So this is now the answer to a question only worth asking when it has
   * one. The quiet case is carried by the strip and by "Our view"'s own age.
   */
  const whatChanged = newEvidence.length === 0 ? null : (
    <SnapBlock
      key="changed"
      testId="snapshot-what-changed"
      title="What changed"
      meta={caseAgeLabel ? `since the case was ${caseAgeLabel}` : undefined}
      action={(
        <button
          type="button"
          onClick={() => onOpenSubPage('research')}
          className="text-sm text-primary-600 hover:underline dark:text-primary-400"
        >
          Open Research →
        </button>
      )}
    >
      {/* The empty branch is gone with the empty block: this only renders
          when `newEvidence` has something in it. */}
      <p className="text-sm text-gray-800 dark:text-gray-200">
        <span className="font-semibold">
          {newEvidence.length} research item{newEvidence.length === 1 ? '' : 's'}
        </span>{' '}
        dated after the case was last written
        {newestEvidenceAt ? `, newest ${new Date(newestEvidenceAt).toLocaleDateString()}` : ''}.
      </p>
          {/*
            Name them only when they can be OPENED. `onOpenEvidence` is
            AssetTab's own note navigation; without it this stays a count,
            because a row a reader cannot follow is a dead end. `title` is
            nullable on `asset_notes`, so an untitled note falls back to its
            own opening words — never an invented label.
          */}
          {onOpenEvidence && (
            <div className="mt-2 flex flex-col gap-0.5">
              {newEvidence.slice(0, 3).map(e => {
                const label = (e.title ?? '').trim()
                  || ourViewExcerpt(e.content ?? '', 60)
                  || 'Untitled research note'
                return (
                  <ActionRow
                    key={e.id}
                    tone={e.isShared ? 'neutral' : 'waiting'}
                    status={e.isShared ? 'Shared' : 'Private'}
                    title={label}
                    meta={[e.authorName, new Date(e.createdAt).toLocaleDateString()]
                      .filter(Boolean).join(' · ')}
                    onClick={() => onOpenEvidence(e.id)}
                  />
                )
              })}
              {newEvidence.length > 3 && (
                <button
                  type="button"
                  onClick={() => onOpenSubPage('research')}
                  className="mt-1 self-start text-sm text-primary-600 hover:underline dark:text-primary-400"
                >
                  {newEvidence.length - 3} more →
                </button>
              )}
            </div>
          )}
      <QuietLine className="mt-2">
        Whether each supports or challenges the thesis is not recorded — that is the review.
      </QuietLine>
    </SnapBlock>
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
  // The attention band is no longer rendered here: it moved to one connected
  // surface at the Asset-page level (AssetAttentionBand), shown above every
  // sub-page, so the reader never sees two copies. The facts above still drive
  // this page's state/emphasis (`workspaceState`); the signals themselves are
  // resolved by AssetAttentionBand from the same cached hooks.

  /* --------------------------------------------------------- composition */

  return (
    <div
      data-testid="investment-snapshot"
      data-asset={asset.id}
      data-portfolio={portfolioId ?? 'all'}
      data-workspace-state={workspaceState}
      className="flex flex-col gap-5"
    >
      {/*
        ── No header row ──────────────────────────────────────────────────

        A "Held · 2 books" chip, the coverage roster and an "Organization-wide"
        selector used to sit here, above everything.

        All three were either answered elsewhere or asked the reader to set
        something up before the page would speak. HELD is now stated properly
        rather than counted — "Exposure & valuation" lists every book by name
        with its own weight. COVERAGE is on the asset's own sticky header,
        under the ticker, which is where it belongs: it is a fact about the
        name, not about this one sub-page, and it was being drawn twice.
        The SELECTOR is gone with the scope it set.

        What is left is the brief itself, starting at the top of the surface.
      */}
      {/*
        The brief, in the order a reader asks the questions:

          1. what do we think        — Our view (full width, the page's lead)
          2. what is owed            — Needs a decision, ABSENT when nothing is
          3. what changed / who says — left column
          4. where we stand          — right column

        The two blocks that can carry an action lead the page; the rest support
        them. Attention itself is NOT here: it lives in one connected surface at
        the Asset-page level (AssetAttentionBand) above every sub-page, so the
        reader never sees two copies.
      */}
      {/*
        The top row carries the two things worth the full width: the argument
        and what is owed on it. Prose holds a reading measure inside its own
        column, so pairing them removes the empty band that opened up when a
        72ch paragraph sat alone in a page-wide card. With nothing owed, the
        view takes the row by itself.
      */}
      {needsDecision ? (
        /* `items-start` so a short queue does not stretch to the height of a
           long thesis beside it. */
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(320px,1fr)]">
          {ourView}
          {needsDecision}
        </div>
      ) : ourView}
      {/*
        Both left-column blocks are now conditional — "What changed" only when
        something did, the contributor roster only when there is more than one
        contributor — and on a quiet single-author name that is the common
        case. A fixed two-column grid would hold 62% of the row open for
        nothing, so the position and the record take the full width when there
        is no left column to sit beside.
      */}
      {whatChanged || perspectives ? (
        <div className="grid grid-cols-1 gap-x-8 gap-y-5 xl:grid-cols-[minmax(0,1.62fr)_minmax(320px,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            {whatChanged}
            {perspectives}
          </div>
          <div className="flex min-w-0 flex-col gap-5">
            {exposureValuation}
            {decisionHistory}
          </div>
        </div>
      ) : (
        /* Side by side rather than stacked: each is a compact block of
           figures, and two of them in a page-wide column is a lot of white
           to the right of a weight bar. */
        <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-2">
          {exposureValuation}
          {decisionHistory}
        </div>
      )}
    </div>
  )
}

/*
 * `SnapshotHeader` is gone, with everything it drew.
 *
 * It was written as "the Snapshot's context strip — NOT a second asset
 * header", and that framing is the thing that kept it alive: each round of
 * pruning asked only whether it repeated the sticky header, and the answer
 * was no. The question it never got asked is whether a reader opening a name
 * needs any of it before the page will say something.
 *
 * It carried three things. The HELD CHIP counted books ("Held · 2 books")
 * where "Exposure & valuation" now names each one and states its weight — a
 * count is the least useful form of that fact. COVERAGE was a second copy:
 * the asset's own sticky header renders the same roster from the same prop,
 * under the ticker, where it describes the name rather than this one
 * sub-page. The BOOK FILTER narrowed every domain below, which is a question
 * an Overview should not make the reader answer before it will speak; the
 * surfaces that genuinely need a scope — Work, Decisions — set their own.
 *
 * Its comment argued the held chip earned its place by being SCOPE-reactive.
 * That was true while there was a scope. There is not one now, so the
 * argument retires with it.
 */

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
