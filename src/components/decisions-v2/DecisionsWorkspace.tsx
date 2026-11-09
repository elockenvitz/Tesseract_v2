/**
 * Desktop Decisions — the memory workspace.
 *
 * Browse the history, open one decision into the full canvas, come back to
 * where you were. Same shape as Ideas, Research and Portfolio, for the same
 * reason: a historical record is worth the whole page, and so is choosing
 * which one to read.
 *
 * ── This is a memory surface, not a queue ────────────────────────────────
 *
 * Ordered by when things were decided, newest first. No tier, no score, no
 * "worth revisiting" ranking — Today already answers what deserves attention,
 * and turning history into a second priority list would make the past
 * something to work through rather than something to consult.
 *
 * ── Terminal records are the content ─────────────────────────────────────
 *
 * Accepted, declined and withdrawn decisions are exactly what belongs here.
 * The active-work filters that Ideas and Today apply would empty this page.
 */

import { useEffect, useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { GALLERY_GROUND } from '../../lib/ui/surface'
import { Landmark } from 'lucide-react'
import { BookFilter } from '../shared/BookFilter'
import {
  useDecisionScan, usePortfoliosWithDecisions, useDecisionDetail,
  useDecisionOutcomeFacts,
} from '../../hooks/useDesktopDecisions'
import {
  outcomeOf, OUTCOME_LABEL, provenanceOf, workOf, daysSince,
  hasHumanReason, RESOLVED,
  type DecisionRecord,
} from '../../lib/desktop-decisions/model'
import {
  classifySituations, selectForLens, lensSentence, eyebrowLabels,
  PLACEHOLDER_PRICE,
  type ClassedSituation, type OutcomeFacts,
} from '../../lib/desktop-decisions/classes'
import { openOutcomesFor, openTradeBookFor } from '../../lib/desktop-decisions/navigate'
import { formatCompactDollars } from '../../lib/decision-intelligence'
import { batchPnlText } from '../../lib/outcomes/batch-groups'
import { usePilotProgress } from '../../hooks/usePilotProgress'
import { operationalAfterPilot } from '../../lib/pilot/seed-visibility'
import { DecisionDetailPane } from './DecisionDetail'
import {
  /* `TileReason` went with "Why it was proposed" — it existed to render the
     generated sentence that block labelled, and no decision tile draws one
     now. The component itself stays for its other callers. */
  DesktopGallery, DesktopTile, TileIdentity, TileQuote, TileLead,
  TileMeta, TileFigure, sizeByRecency, GallerySkeleton, type TileSize,
  /* `TileVisualSlot` went with the ladder it wrapped: the carousel's box
     reserves the height now, and reserving it twice put a fixed-height slot
     inside a floored one. */
  TileAction as ShelfAction,
  /* `TileSparkline` is no longer imported here -- see `PanelCarousel`. It
     stays in `DesktopTile` for any surface that genuinely wants a 48px mark
     rather than a chart; this lens does not. */
} from '../desktop/DesktopTile'
/* The shared price chart, which is what the other four lenses draw. */
import { TilePriceChart } from '../desktop/TilePriceChart'
/* The shared pager, so paging a decision card is the same gesture as paging
   an Ideas card -- same control, same place, same words. */
import { VisualPager } from '../desktop/VisualPager'
import { EYEBROW } from '../desktop/DesktopModule'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'
import { OUTCOME_INK, DecisionSize, RecordGaps, DecisionPath, PriceSinceFill } from './DecisionVisual'
import { useDecisionTileCloses } from '../../hooks/useDecisionTileCloses'
/* The shared slicer. Decisions measures its headline with the same function
   Research measures its stale-thesis chart with, so "since the fill" cannot
   mean one window here and another there. */
import { anchoredWindow } from '../research-v2/ResearchVisual'

export interface DecisionsWorkspaceProps {
  selectedPortfolioId?: string | null
  selectedDecisionId?: string | null
  /** Set by the Dashboard deck when this lens is the expanded workspace. */
  focusObjectId?: string | null
}

export function DecisionsWorkspace({
  selectedPortfolioId, selectedDecisionId, focusObjectId,
}: DecisionsWorkspaceProps = {}) {
  // The scan is unfiltered by book so the portfolio list can be built from the
  // decisions that actually exist; filtering happens in memory afterward.
  const { decisions, isLoading, error } = useDecisionScan(null)
  /*
   * What happened after each decision, in Outcomes' own terms.
   *
   * One shared query -- the same `outcomes_payload` Outcomes reads -- and the
   * same verdicts, moves and dollar proxies it renders. This lens classifies
   * and composes; it does not judge outcomes, because a second judgement is
   * how two surfaces come to disagree about one trade.
   */
  /*
   * `factsLoading` is not optional information.
   *
   * These facts decide the CLASS of every decision -- executed, hurting,
   * reviewed -- and the class is the first sort key, so it decides order, and
   * the order decides `sizeByRecency(i)`, so it decides every tile's size
   * band. It also decides membership: `selectForLens` truncates the `recent`
   * class to its limit.
   *
   * Painting on the scan alone meant every record arrived as
   * `NO_OUTCOME_FACTS`, and when the payload landed the whole gallery
   * re-classified, re-sorted, dropped rows past the limit and resized every
   * tile at once -- hero to compact, `2xl:col-span-6` to `2xl:col-span-3`.
   * That is the single largest layout event on the Dashboard, and it happened
   * on every cold load.
   */
  const { factsFor, pnlForBatch, isLoading: factsLoading } = useDecisionOutcomeFacts()

  const [portfolioId, setPortfolioId] = useState<string | null>(selectedPortfolioId ?? null)
  const [decisionId, setDecisionId] = useState<string | null>(selectedDecisionId ?? null)

  useEffect(() => { if (selectedPortfolioId) setPortfolioId(selectedPortfolioId) }, [selectedPortfolioId])
  useEffect(() => { if (selectedDecisionId) setDecisionId(selectedDecisionId) }, [selectedDecisionId])

  /*
   * What still wants something, not what has already happened.
   *
   * See `workOf`. A decision nobody has answered, or one answered with no
   * human reason on the record, is work; a decision made and explained is
   * history, and history does not spend a tile on a surface whose question
   * is what needs doing. Nothing is deleted -- the detail pane still opens
   * any record, and the rail still carries the neighbours.
   */
  /*
   * The pilot's seeded request stops being work once the pilot is over.
   *
   * One Dashboard rule (lib/pilot/seed-visibility): a seeded row nobody
   * answered is history and must not be counted, queued or ranked as a
   * decision awaiting one; a seeded row the reader DID answer is their
   * decision and stays, execution and rationale intact. The records are
   * untouched -- the detail pane still opens any of them by id, and every
   * archival surface still lists them.
   */
  const { hasGraduated, cachedHasGraduated } = usePilotProgress()
  const operational = useMemo(
    () => operationalAfterPilot(
      decisions.map(d => ({ ...d, pilotSeed: d.isPilotSeed, actedOn: RESOLVED.has(d.status) })),
      { hasGraduated: hasGraduated || cachedHasGraduated },
    ),
    [decisions, hasGraduated, cachedHasGraduated],
  )
  // The book filter counts what the lens would actually show.
  const books = usePortfoliosWithDecisions(operational)
  const inBook = useMemo(
    () => operational.filter(d => !portfolioId || d.portfolioId === portfolioId),
    [operational, portfolioId],
  )
  /*
   * One situation per decision ACT, in three ranked classes.
   *
   * Five trades committed in one batch were one thing somebody did, so the
   * batch is the container and the legs stay underneath it -- for what it
   * owes and for how it is going. Classification and order are
   * `lib/desktop-decisions/classes`: work first, longest waiting; then
   * outcomes to revisit; then the recent record, newest first, which fills
   * the page when little is owed.
   */
  const situations = useMemo(
    () => selectForLens(classifySituations(inBook, factsFor)),
    [inBook, factsFor],
  )
  const rows = useMemo(() => situations.map(s => s.lead), [situations])
  /** Records this lens is not showing: decided, explained and not recent. */
  const settled = inBook.length - situations.reduce((n, s) => n + s.legs.length, 0)

  // Entry lands in the record, never inside one. The chronology still decides
  // what the reader meets first; it does not decide what they read. A grid of
  // near-identical cards each repeating "Revisit this decision" read as an
  // inbox to work through -- the mental model this surface must not have --
  // and auto-opening the newest record makes the same claim more quietly.
  const activeId = focusObjectId ?? decisionId ?? null
  /*
   * Looked up across the whole book, not just the queue.
   *
   * A reader arriving from Today or from a rail card may be pointed at a
   * decision that is settled and explained -- which is exactly the record the
   * queue no longer lists. Failing to find it would show a not-found state
   * for a record that exists and is fine.
   */
  /*
   * Looked up across every record the scan read, including the pilot's
   * seeded ones. They are suppressed from the QUEUE, not from the product:
   * a link, a rail card or a deck request naming one must still open it,
   * exactly as it opens a settled decision the queue no longer lists.
   */
  const selected = activeId ? decisions.find(d => d.id === activeId) ?? null : null

  // Nothing deep is fetched while browsing.
  const { detail } = useDecisionDetail(selected)

  // How many OTHER books decided the same idea.
  //
  // Derived from the rows already in hand -- no query -- and computed over the
  // unfiltered scan, because narrowing to one book must not make a
  // multi-book decision look like a single-book one.
  const booksPerIdea = useMemo(() => {
    const byIdea = new Map<string, Set<string>>()
    for (const d of operational) {
      if (!d.ideaId) continue
      const set = byIdea.get(d.ideaId) ?? new Set<string>()
      set.add(d.portfolioId)
      byIdea.set(d.ideaId, set)
    }
    return new Map([...byIdea].map(([id, set]) => [id, set.size - 1]))
  }, [operational])

  // Narrowing the book returns the reader to the record for that book rather
  // than stranding them on one from a book they just filtered out.
  const selectBook = (id: string | null) => { setPortfolioId(id); setDecisionId(null) }

  const open = (d: DecisionRecord) => openDashboardFocus({
    target: {
      originLens: 'decisions',
      workspaceLens: 'decisions',
      objectType: 'decision',
      objectId: d.id,
      symbol: d.symbol,
      label: d.companyName,
      portfolioId: d.portfolioId,
      portfolioName: d.portfolioName,
      issue: OUTCOME_LABEL[outcomeOf(d.status)],
      origin: 'decisions',
    },
    backLabel: 'Decisions',
    // Chronological, like the lens itself: the records around this one by
    // date, never a re-ranking by perceived importance.
    // The whole record, in order. The deck windows it around whatever is
    // expanded, so a record you rotate away from becomes available again.
    rail: rows.map(toRailCard),
  })

  /*
   * Hold for the facts as well as the scan.
   *
   * Everything below this line -- the count, the lens sentence, the "N older
   * records" line, and every tile's class, order, membership and size -- is
   * derived from `situations`, and `situations` is derived from `factsFor`.
   * Painting before the payload lands is painting a gallery that is about to
   * become a different gallery.
   *
   * This also removes a false empty state: `rows` comes from `situations`, so
   * `!rows.length` was reachable with the payload still in flight, and the
   * reader was told nothing was owed while the thing that decides what is owed
   * had not answered.
   */
  if (isLoading || factsLoading) return <Loading />

  /*
   * A selected record renders before the empty check, always.
   *
   * The queue can legitimately be empty while a record is open: everything
   * has been answered and explained, and the reader is looking at one of
   * those. Ordering the checks the other way showed "nothing has ever been
   * decided" over a record that exists and is fine -- introduced the moment
   * this lens stopped listing settled records, and caught by the tests that
   * open one by id.
   */
  if (selected) return <DecisionDetailPane decision={selected} detail={detail} />

  if (error || !rows.length) {
    return (
      <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
        <h1 className="text-[21px] font-semibold tracking-tight">Decisions</h1>
        {/* A failed read and an empty queue look identical to a reader, and
            they are opposite problems -- one is broken and the other is the
            best possible state. The failure is named rather than rendered as
            "nothing needs doing". */}
        {error ? <Failed message={error.message} />
          : inBook.length > 0 ? <NothingOwed count={inBook.length} />
          : <Empty />}
      </div>
    )
  }

  /* The ground, as on Today, Ideas, Research and Portfolio. See the note on
     Ideas: left transparent, this showed through to the shell's
     `bg-gray-50/60` and the cards lost their edge. Five lenses, one pair of
     values -- no lens gets its own contrast. */
  return (
    <div
      className={clsx('h-full overflow-y-auto', GALLERY_GROUND)}
      data-testid="decisions-lens"
    >
      <DesktopGallery
        title="Decisions"
        count={rows.length}
        flow="chronological"
        /*
          The book selector is a CONTROL, and only where there is a choice.
          With one book it used to render the book's NAME in the corner of the
          page: passive text dressed as a filter, saying what every tile
          already says about itself. The book belongs to the decision.
        */
        action={books.length > 1
          ? <BookFilter books={books} portfolioId={portfolioId} onSelect={selectBook} compact />
          : undefined}
        note={<>
          {/*
            What the lens holds, in the order it holds it. Three classes, not
            a queue: what needs doing, what is worth another look, and what
            was recently committed.
          */}
          <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
            {lensSentence(situations)}
          </p>
          {/* What is NOT here, said once. A queue that silently drops the
              settled record looks like a lens that lost it. */}
          {settled > 0 && (
            <p className="mt-1 text-[11px] text-gray-500">
              {settled} older {settled === 1 ? 'record is' : 'records are'} not listed.
              Nothing needs doing to {settled === 1 ? 'it' : 'them'}.
            </p>
          )}
          {/*
            The counts describe the BOOK, not the queue.
            "6 resolved, 3 executed, 6 rationales" is a statement about the
            record this desk has built; computing it over the queue would make
            it fall as the desk did its job, so the better the book got the
            worse the header would read.
          */}
          <Metrics rows={inBook} />
        </>}
      >
        {/*
          One mosaic, the same one every lens uses.

          The order is the classes' -- work, then what to revisit, then the
          record -- and `sizeByRecency` turns that order into room: the first
          decision leads, the rest get denser behind it. Decisions must not
          have a grid of its own; a reader moving between tabs should see one
          product, not five.
        */}
        {situations.map((s, i) => (
          <DecisionTile
            key={s.subject}
            decision={s.lead}
            situation={s}
            facts={factsFor(s.lead)}
            batchPnl={batchPnlText(pnlForBatch(s.batch?.id) ?? { kind: 'none' })}
            alsoInBooks={booksPerIdea.get(s.lead.ideaId ?? '') ?? 0}
            bandSize={sizeByRecency(i)}
            onOpen={() => open(s.lead)}
          />
        ))}
      </DesktopGallery>
    </div>
  )
}

/**
 * Everything is answered and explained.
 *
 * Distinct from `Empty`, which means no decision has ever been recorded.
 * These are opposite situations and a queue that renders them identically
 * tells a desk that has done its job that it has done nothing.
 */
function NothingOwed({ count }: { count: number }) {
  return (
    <p className="mt-2 max-w-[70ch] text-[12px] text-gray-600 dark:text-gray-400">
      Nothing is waiting on an answer, and every decision in this book carries
      a reason. All {count} {count === 1 ? 'record is' : 'records are'} complete.
    </p>
  )
}

/* ----------------------------------------------------------------- metrics */

/**
 * What this history actually preserves.
 *
 * The first version read "22 carry a written reason", which fused two very
 * different things: 22 decisions have a `context_note` written by the person
 * who PROPOSED the trade, and exactly ONE has a rationale written by the person
 * who DECIDED it. Reporting them together made the record look four times
 * healthier than it is, on the one number whose whole job is to say how much
 * reasoning survives.
 *
 * They are now counted and named separately, and neither is called a "written
 * reason".
 */
function Metrics({ rows }: { rows: DecisionRecord[] }) {
  const resolved = rows.filter(d => outcomeOf(d.status) !== 'open').length
  const executed = rows.filter(d => d.execution?.completedAt).length
  // Human decision rationale: written by the decider, at decision time.
  // A batch description explains every leg in it, so the count has to read
  // the same rule the queue does or the header disagrees with the list.
  const rationale = rows.filter(hasHumanReason).length
  // Submission context: written by the requester, before anyone decided.
  const context = rows.filter(d => !!d.contextNote?.trim()).length

  if (!rows.length) return null

  return (
    <dl className="mt-2 flex flex-wrap gap-x-3.5 gap-y-0.5 text-[10px] text-gray-500">
      <Metric n={resolved} label="resolved" />
      <Metric n={executed} label="executed" />
      <Metric n={rationale} label={`decision rationale${rationale === 1 ? '' : 's'}`} />
      {context > 0 && <Metric n={context} label="with submission context" />}
    </dl>
  )
}

function Metric({ n, label }: { n: number; label: string }) {
  return (
    <div data-testid="decision-metric" className="flex items-baseline gap-1">
      <dt className="sr-only">{label}</dt>
      <dd className="font-mono text-[11px] font-semibold text-gray-800 dark:text-gray-200">{n}</dd>
      <span>{label}</span>
    </div>
  )
}

/*
 * `BookFilter` now lives in `components/shared/BookFilter.tsx`.
 *
 * It was lifted unchanged when the Investment Snapshot needed the same three
 * answers this page needed — null means every book, one book renders no
 * control, and the count is the caller's to define. A second copy would have
 * been free to drift on all three.
 */

/* ------------------------------------------------------------------- index */

/*
 * The outcome is ink on the card's own ground, never a filled badge -- the
 * treatment Ideas removed, because a gallery of filled pills reads as a queue
 * of tagged records rather than a set of decisions somebody made. The
 * distinctions survive in `OUTCOME_INK`, because telling them apart is the
 * point of this lens. It renders inside `DecisionEyebrow` now, so it can be
 * dropped when the reason already says the same word.
 */

/**
 * The eyebrow: where the decision stands, said once.
 *
 * Both render paths -- the two-column composition at hero/large and the
 * stacked body at medium/compact -- mount THIS, so a label collision cannot
 * be fixed on one and left on the other. That is how "Outcome not reviewed"
 * shipped twice: patched inline in the composed path while the stacked path
 * kept printing it, and "Awaiting decision" then collided the same way on
 * both.
 *
 * The ordering and the deduplication live in `eyebrowLabels`; this decides
 * only how each surviving label is inked. The outcome is the quietest (it is
 * the filing state), the reason carries the class's tone, and whichever label
 * turns out to be the unreviewed verdict gets the one tinted chip -- because
 * that is the only state here that asks the reader to do something.
 */
function DecisionEyebrow({ d, situation, facts }: {
  d: DecisionRecord
  situation: ClassedSituation
  facts: OutcomeFacts
}) {
  const chip = 'rounded-[3px] bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-400'
  return <>
    {eyebrowLabels(d, situation, facts).map(l => (
      <span
        key={l.role}
        data-testid={l.role === 'reason' ? 'decision-reason' : `decision-${l.role}`}
        className={clsx(
          l.asksForReview ? chip
            : l.role === 'outcome'
              ? clsx('font-medium uppercase tracking-[0.08em] text-[9px]', OUTCOME_INK[outcomeOf(d.status)])
              : clsx('text-[10px] font-semibold uppercase tracking-[0.1em]',
                  situation.klass === 'action' ? 'text-amber-700 dark:text-amber-500'
                  : situation.klass === 'revisit' ? 'text-slate-600 dark:text-slate-300'
                  : 'text-gray-500'),
        )}
        {...(l.asksForReview ? { 'data-verdict': 'unreviewed' } : {})}
      >
        {l.text}
      </span>
    ))}
  </>
}

/**
 * One line of the index.
 *
 * No button. Selecting IS revisiting, and a "Revisit this decision" control
 * repeated eighty-three times down a column is what made the first version
 * read as a queue of work rather than a record.
 */
/**
 * One decision in the scan.
 *
 * Outcome, action and age carry the identity; the summary says what happened
 * without judging it. A rationale somebody actually wrote is quoted here,
 * because it is the rarest and most valuable thing this history holds -- one
 * decision in eighty-three has one, and a scan that hides it wastes it.
 *
 * The month grouping the rail carried is dropped: a grid does not read as a
 * chronology, and a heading over every second tile would be noise. The age on
 * each tile does that work, and the order is still newest first.
 */
/**
 * A decision as a rail card.
 *
 * Never graded, never reordered: accepted is not success, and the record
 * beside this one is the record beside it by date. What it carries instead is
 * what the record actually remembers -- a written reason where one exists, and
 * the sizing that was asked for where it does not.
 */
export function toRailCard(d: DecisionRecord): RailCard {
  const when = d.decidedAt ?? d.requestedAt
  const humanReason = provenanceOf(d.decisionNote) === 'human' ? d.decisionNote : null
  return {
    id: d.id,
    workspaceLens: 'decisions',
    objectType: 'decision',
    symbol: d.symbol,
    reason: `${d.action ?? 'decision'} \u00b7 ${OUTCOME_LABEL[outcomeOf(d.status)]}`,
    tone: outcomeOf(d.status) === 'open' ? 'review' : 'neutral',
    figure: d.sizingWeight != null ? `${d.sizingWeight.toFixed(1)}%` : null,
    figureLabel: d.sizingWeight != null ? 'asked for' : null,
    detail: humanReason
      ? `\u201c${humanReason}\u201d`
      : when ? new Date(when).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : null,
    portfolioId: d.portfolioId,
    portfolioName: d.portfolioName,
    issue: OUTCOME_LABEL[outcomeOf(d.status)],
  }
}

/**
 * One decision in the record.
 *
 * ── The repetition problem ───────────────────────────────────────────────
 *
 * The tile used to say ACCEPTED, then TRIM, then MNST, then "Eric accepted a
 * trim in MNST at 2.0%", then the book, then Eric again. Six lines, three
 * facts, and the sentence in the middle -- the largest thing on the tile --
 * carried nothing the eyebrow had not already said. Across forty rows that
 * reads as one record repeated, which is the opposite of memory.
 *
 * Each fact now has one home: outcome and action in the eyebrow, identity in
 * the body, book and actor in the meta line. The space that freed goes to
 * whatever this particular decision actually remembers.
 *
 * ── Three families, by what was recorded ─────────────────────────────────
 *
 *   reasoned   somebody wrote why. The quote is the tile.
 *   proposed   no decision rationale, but the requester said why they asked.
 *              Shown as theirs, never promoted into a decision rationale.
 *   recorded   neither. Then the tile is the shape of the trade -- what size
 *              was asked for against what the book already held, and whether
 *              anything followed -- which is what is left to remember.
 *
 * ── Not graded ──────────────────────────────────────────────────────────
 *
 * Accepted is not success and withdrawn is not failure, so no family gets a
 * colour for its outcome. The only tone here is `review`, for a decision still
 * waiting on someone -- work outstanding, the same meaning it carries in every
 * other gallery.
 */
function DecisionTile({
  decision, situation, facts, batchPnl, alsoInBooks, bandSize, onOpen,
}: {
  decision: DecisionRecord
  /** The decision act this card stands for. One leg, or a whole batch. */
  situation: ClassedSituation
  /** What Outcomes knows about it. Never recomputed here. */
  facts: OutcomeFacts
  /** Outcomes' own batch total, where the act is a batch and it has one. */
  batchPnl: ReturnType<typeof batchPnlText>
  alsoInBooks: number
  /** The room this record earned in the gallery, from the shared rule. */
  bandSize: TileSize
  onOpen: () => void
}) {
  const d = decision
  const outcome = outcomeOf(d.status)
  /*
   * ── One dated series, read once, for everything that makes a claim ───────
   *
   * The chart used to fetch these itself, inside `PriceColumn`. That left the
   * tile with TWO price stories that could disagree: the chart measured from
   * the stored closes, while the headline percentage came from
   * `move_since_decision_pct`, computed upstream against
   * `submission_snapshot.price`. On a decision whose stored commit price is
   * the 100 placeholder, the snapshot route produced roughly +1050% while the
   * closes said the name had not moved at all since the fill.
   *
   * So the closes are read HERE, and the headline, the chart and the basis
   * check all read that one window. Agreement stops being something to keep
   * in sync and becomes structural.
   *
   * Unconditional, above every early return, because it is a hook. Medium and
   * compact tiles pay one cached query for a symbol the gallery is very likely
   * already asking about -- the hook's key is the symbol alone and its
   * staleTime is five minutes, so a gallery of tiles on the same name shares
   * a single request.
   */
  const { data: closesData, isLoading: closesLoading, error: closesError } =
    useDecisionTileCloses(d.symbol)
  const closes = closesData ?? []
  /** Which of the two jobs this card is here for. */
  const work = workOf(d)
  /** More than one execution leg under one committed act. */
  const batched = situation.batch != null && situation.legs.length > 1
  const when = d.decidedAt ?? d.requestedAt
  const humanReason = provenanceOf(d.decisionNote) === 'human' ? d.decisionNote : null
  const proposedReason = !humanReason && provenanceOf(d.contextNote) === 'human' ? d.contextNote : null
  /**
   * The sentence this card may quote as the decision's reason.
   *
   * The trade's own note, or -- where the act was committed as a batch of one
   * -- the batch's sentence, which is that trade's reason and nothing else's.
   */
  const reason = humanReason
    ?? (!batched && situation.batch?.description
      && provenanceOf(situation.batch.description) === 'human'
      ? situation.batch.description
      : null)

  /**
   * The room this record earned, from the gallery's own rule.
   *
   * Never a judgement: accepted is not success and withdrawn is not failure.
   * What varies with size is how much of the record the tile says -- the
   * shared density behaviour every other lens uses, rather than a second
   * layout system living on this tab.
   */
  /*
   * ── The move, only where it is trustworthy ───────────────────────────────
   *
   * Two ways the old giant figure lied, both visible to the reader:
   *
   *   1. undated. `current-price` falls back to `assets.current_price`, which
   *      has no timestamp. A percentage measured to it is unfalsifiable and
   *      has been wrong by 24 points.
   *   2. mislabelled. With no captured decision price the number is the move
   *      since the FILL, and the tile called it "since the decision".
   *
   * (2) is now labelled honestly rather than suppressed -- it is a real fact
   * about a real date. (1) is suppressed: a number nobody can date does not
   * get to be the largest thing on the card. It still appears in the quiet
   * strip below, where its size does not claim confidence.
   *
   *   3. computed from a price nobody paid. `move_since_decision_pct` is
   *      measured against `submission_snapshot.price`, which inherits the
   *      sizing price -- and that price is `baseline?.price || 100` when the
   *      quote provider fails, so it is the literal 100 on every new position
   *      booked during an outage. LLY filled at a real 1152.44 and the tile
   *      reported roughly +1050%: not a stale number, a number about a trade
   *      that never happened.
   *
   * (3) is why the headline now measures from the CLOSES -- the same dated
   * series the chart beside it draws. `priceWindow` is that measurement: it
   * starts at the first close on or after the anchor and ends at the newest
   * one, so both halves of the tile are the same arithmetic on the same rows
   * and neither can be right while the other is wrong.
   *
   * `facts.sincePct` is not consulted for the headline any more. It stays the
   * source for Outcomes, which owns the judgement; the tile's job is to show
   * a move the reader can check against the line next to it.
   */
  const anchorISO = d.execution?.completedAt ?? d.decidedAt ?? null
  const priceWindow = anchoredWindow(
    closes.map(p => ({ date: p.date.toISOString(), close: p.value })),
    anchorISO,
  )
  /*
   * Only a window that actually REACHES the anchor may make a since-claim.
   * Where the cache starts after the fill there is a line worth drawing but no
   * "since the fill" to say about it, and the chart captions itself "price
   * over available history" instead. A percentage over a window whose start
   * has nothing to do with this decision is not a smaller truth, it is a
   * different one.
   */
  /*
   * ── Is the execution price one anybody paid? ─────────────────────────────
   *
   * Declared HERE, above the figures that depend on it, not 120 lines below
   * where it used to sit. A const read before its declaration is a temporal
   * dead zone error, and one in this lens's tile code took the whole app to a
   * blank loading screen once already.
   *
   * ── Why the test is the literal, not the magnitude ───────────────────────
   *
   * A ratio band alone does not separate these two populations. Checked
   * against the close on each trade's own fill date, production says:
   *
   *   PLTR x5   100 vs 132.37   ratio 0.76  <- fabricated, inside any sane band
   *   ABT       100 vs  90.62   ratio 1.10  <- fabricated, looks perfect
   *   META      100 vs 675.03   ratio 0.15  <- fabricated
   *   AVB    177.81 vs  60.71   ratio 2.93  <- REAL price, the close is wrong
   *   MNST    77.56 vs  39.12   ratio 1.98  <- REAL price, the close is wrong
   *
   * A half-to-double band would have passed six fabricated rows and rejected
   * three genuine ones. The magnitude is not the signal.
   *
   * The signal is the literal itself. `baseline?.price || 100` writes exactly
   * 100, so a commit price of precisely 100 against a close that is not
   * approximately 100 is the fabrication, whatever the ratio works out to. A
   * genuine fill at 100.00 does happen -- and when it does, the close that day
   * is near 100 too, so it passes.
   *
   * The wide band stays as a second net for corruption of other shapes, but
   * loose enough not to catch a real price sitting beside a bad close: a
   * stored close can be stale or split-unadjusted, and that is the close's
   * problem, not the trade's.
   */
  const anchorClose = (() => {
    if (!anchorISO || closes.length === 0) return null
    const at = Date.parse(anchorISO)
    if (!Number.isFinite(at)) return null
    // The close on the fill day, or the nearest one before it.
    let found: number | null = null
    for (const p of closes) {
      if (p.date.getTime() <= at) found = p.value
      else break
    }
    return found ?? closes[0].value
  })()
  const commitPrice = d.execution?.priceAtAcceptance ?? null
  /**
   * Three states, because "we cannot check" is not "it is wrong".
   *
   *   ok      -- the commit price sits near the close on the day it filled.
   *   bad     -- it does not, so it is a price nobody paid, and everything
   *              computed from it is fiction.
   *   unknown -- there is nothing to check against: no commit price recorded,
   *              or no close on that date.
   *
   * The distinction matters for the dollar basis. A row with NO commit price
   * was not written by the failing path -- the same computed object supplies
   * the price and the notional together, so a corrupted row always carries
   * the price too, set to 100. Absence is the ordinary historical case, so
   * the notional still shows. It is only withheld where the price it came
   * from is demonstrably fabricated.
   */
  const basis: 'ok' | 'bad' | 'unknown' = (() => {
    if (commitPrice == null || commitPrice <= 0) return 'unknown'
    /* The literal the failing path writes. With no close to check it against
       -- PARA has no stored history at all -- an exact 100 is still the
       signature, and the live quote plainly did not answer for a name we hold
       no prices for. */
    const isLiteral = commitPrice === PLACEHOLDER_PRICE
    if (anchorClose == null || anchorClose <= 0) return isLiteral ? 'bad' : 'unknown'
    const ratio = commitPrice / anchorClose
    if (isLiteral) return Math.abs(ratio - 1) > 0.1 ? 'bad' : 'ok'
    return ratio >= 0.25 && ratio <= 4 ? 'ok' : 'bad'
  })()

  /*
   * ── The price it executed at, against the price now ─────────────────────
   *
   * The percentage used to come only from the closes window, which spans the
   * anchor to the newest close. That window does not exist for a trade filled
   * TODAY -- there are not yet two closes after it -- so the tile showed a
   * P&L with no percentage beside it. Two halves of one finding, and only one
   * of them on screen.
   *
   * This is the comparison a desk actually makes: what we paid, against what
   * it is worth now. It needs no window, only the execution price and the
   * latest close, so it answers on the day of the fill.
   *
   * The window still wins where it exists, because the chart draws that window
   * and the headline must not contradict the line beside it. This is the
   * fallback, not a second opinion.
   */
  const latestClose = closes.length > 0 ? closes[closes.length - 1].value : null
  const execMove = basis === 'ok' && commitPrice != null && latestClose != null
    ? ((latestClose - commitPrice) / commitPrice) * 100
    : null

  /*
   * Both figures, or neither.
   *
   * `facts.pnl` is `impact_proxy`: the trade's notional multiplied by the move
   * since it executed. Both it and the percentage are computed FROM the
   * execution price, so where that price is fabricated they are both fiction
   * and neither may appear -- the LLY tile was showing +$3.54M because 3,363
   * shares were booked at a notional of 336,300, which is $100 a share against
   * a real close of 1,152.44.
   *
   * Suppressing one and not the other would be worse than suppressing
   * neither: a lone dollar figure reads as authoritative precisely because
   * nothing beside it invites the reader to check it.
   */
  /*
   * ── Only the figures that DEPEND on the execution price are withheld ─────
   *
   * A first pass suppressed the percentage too whenever the execution price
   * was fabricated, and that was over-correction. The percentage measured
   * from the closes window is closes-to-closes arithmetic: it never touches
   * the execution price, so a fabricated one cannot make it wrong. Hiding it
   * threw away a true number because a different number was false.
   *
   * The P&L is different. `impact_proxy` is the trade's notional multiplied by
   * the move since it executed, and BOTH of those come from the execution
   * price -- the LLY tile reported +$3.54M because 3,363 shares were booked at
   * a notional of 336,300, which is $100 a share against a real close of
   * 1,152.44. That one stays withheld.
   *
   * `execMove` is the exception on the percentage side: where there is no
   * window it measures from the execution price itself, so it is already
   * gated on the basis being sound.
   */
  /*
   * ── The move since the fill, from the best real price available ──────────
   *
   * Three ways to measure it, each from dated closes the reader can check,
   * and the tile takes the first that answers:
   *
   *   1. the closes window from the fill to the newest close. Preferred,
   *      because it is exactly what the chart beside it draws.
   *   2. the recorded execution price against the newest close -- the desk's
   *      own comparison, used where the window is too short to exist but the
   *      recorded price is sound.
   *   3. the CLOSE ON THE DAY IT FILLED against the newest close.
   *
   * Three is the rung that was missing, and it is why the tile showed nothing
   * for a trade filled on the newest close date. A percentage needs two
   * prices, and there are two: the close the day it filled, and the latest
   * close. Where those are the same row -- a fill on the most recent close --
   * the answer is 0.00%, which is the truth and is worth saying. "Nothing
   * here" is not the same statement as "it has not moved".
   *
   * It is a proxy for the fill price, not the fill price, so it is only used
   * where no sound execution price exists. It is dated and traceable, which
   * is the standard everything else on this tile is held to.
   */
  const fillDayMove = latestClose != null && anchorClose != null && anchorClose > 0
    ? ((latestClose - anchorClose) / anchorClose) * 100
    : null

  const leadMove = priceWindow?.reachesAnchor
    ? priceWindow.changePct
    : execMove ?? fillDayMove

  /*
   * Which of the three it was, so the caption can say what it measured from
   * rather than implying a precision it does not have.
   */
  const moveBasis: 'window' | 'execution' | 'fill-day-close' | null =
    priceWindow?.reachesAnchor ? 'window'
      : execMove != null ? 'execution'
        : fillDayMove != null ? 'fill-day-close'
          : null

  const leadPnl = basis === 'bad' ? null : facts.pnl

  /*
   * ── When the track earns the slot ────────────────────────────────────────
   *
   * `DecisionPath` draws requested -> decided -> executed, and the LENGTHS
   * between those marks are the finding: a decision that sat unanswered for
   * three weeks then filled immediately is a different failure from one taken
   * in a day and filled three weeks later.
   *
   * On a simple decision there are no lengths. Requested, decided and filled
   * on the same day is three marks on top of each other and "0d" twice --
   * 64px of reserved height spent saying nothing happened slowly. That is the
   * dead air this pass is removing.
   *
   * So the track has to have at least one real interval to draw. One day is
   * enough: "answered in 1d, filled in 4d" is a shape. Zero everywhere is not.
   */
  const dayGap = (a: string | null, b: string | null | undefined) =>
    a && b ? Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000) : null
  const waitDays = dayGap(d.requestedAt, d.decidedAt)
  const fillDays = dayGap(d.decidedAt, d.execution?.completedAt)
  const pathHasIntervals = (waitDays != null && waitDays > 0) || (fillDays != null && fillDays > 0)

  /*
   * ── Hero is earned by having something to put in it ──────────────────────
   *
   * Recency hands the newest record the hero slot. Recency does not know
   * whether that record has anything to draw, so the first tile could be a
   * one-day decision with no captured price and no gaps in its record: 64px of
   * reserved visual over a claim and two figures. That is the oversized,
   * whitespace-heavy card this pass is about.
   *
   * So the band is a CEILING, not an allocation. A record that cannot fill a
   * hero takes `large` instead, which is the same width and less height, and
   * the order is untouched -- this changes how much room the newest record
   * gets, never which record is newest. No ranking logic is involved.
   */
  const objectCandidates = {
    path: d.decidedAt != null && pathHasIntervals,
    gaps: work === 'explain',
    sizes: outcome === 'open' && d.sizingWeight != null && d.baselineWeight != null,
    move: leadMove != null,
  }
  const earnsHero = Object.values(objectCandidates).some(Boolean)
  const size: TileSize = bandSize === 'hero' && !earnsHero ? 'large' : bandSize

  const big = size === 'hero' || size === 'large'
  /* The giant figure is a HERO device. At `large` it was a 40px block plus two
     gaps for one number the strip already had room for, which is most of the
     dead space this tile was carrying. Large routes it into the strip. */
  const leadsMove = size === 'hero' && !batched && leadMove != null

  /*
   * ── Does the stored commit price describe this trade at all? ──────────────
   *
   * `accepted_trades.price_at_acceptance` comes from the sizing computation,
   * whose price is `baseline?.price || 100` (SimulationPage) when the quote
   * provider fails. A new position booked during a provider outage therefore
   * stores 100, and a circuit breaker keeps the provider off for the rest of
   * the session, so it is 100 for every trade after the first failure. Live
   * rows confirm it: META 100 against a real close of 682.31, V 100 against
   * 369.93, PLTR 100 against 176.24, LLY 100 against 1152.44.
   *
   * Everything computed from that price inherits it -- `delta_shares`,
   * `target_shares`, `delta_weight` and `notional_value` are all
   * `(weight/100) * total / price`, so META's share count is inflated 6.82x
   * and its notional with it. There is no separate honest figure among them
   * to rescue.
   *
   * ── Why the test is the literal, not the magnitude ───────────────────────
   *
   * A ratio band alone does not separate these two populations. Checked
   * against the close on each trade's own fill date, production says:
   *
   *   PLTR x5   100 vs 132.37   ratio 0.76  <- fabricated, inside any sane band
   *   ABT       100 vs  90.62   ratio 1.10  <- fabricated, looks perfect
   *   META      100 vs 675.03   ratio 0.15  <- fabricated
   *   AVB    177.81 vs  60.71   ratio 2.93  <- REAL price, the close is wrong
   *   MNST    77.56 vs  39.12   ratio 1.98  <- REAL price, the close is wrong
   *
   * A half-to-double band would have passed six fabricated rows and rejected
   * three genuine ones. The magnitude is not the signal.
   *
   * The signal is the literal itself. `baseline?.price || 100` writes exactly
   * 100, so a commit price of precisely 100 against a close that is not
   * approximately 100 is the fabrication, whatever the ratio works out to. A
   * genuine fill at 100.00 does happen -- and when it does, the close that day
   * is near 100 too, so it passes.
   *
   * The wide band stays as a second net for corruption of other shapes, but
   * loose enough not to catch a real price sitting beside a bad close: a
   * stored close can be stale or split-unadjusted, and that is the close's
   * problem, not the trade's.
   */
  /* The fill is what the chart is "since". Where nothing filled, the decision
     is the next-best real date; where neither exists there is no anchor and no
     chart. Batches are several names and have no one series. */
  const priceAnchor = batched ? null : (d.execution?.completedAt ?? d.decidedAt ?? null)
  /* A bare noun, because the chart builds sentences out of it: "Price since
     the fill", "after this fill". Passing "Filled" produced "Price since
     Filled" and the unreadable "this is not a since-Filled move". */
  const priceAnchorLabel = d.execution?.completedAt ? 'fill' : 'decision'
  /* `drawsPrice` is gone. It required an anchor, which is what kept the slot
     off the two COIN heroes entirely, and it required `big`, which is what
     kept the shared chart out of every small card. `priceSlot` and
     `hasSeries` below replace it and say which of the two they mean. */
  /* Whether the track is this tile's one visual. Named once, because the
     visual slot and the figures strip have to agree: what the track draws,
     the words stop saying. */
  const drawsPath = big && objectCandidates.path
  /*
   * ── A drawable series, and a slot to put it in ───────────────────────────
   *
   * `drawsSpark` was the small-tile fallback at the BOTTOM of a ladder, so a
   * card with anything else to draw never showed a price. It is now one page
   * of a carousel rather than a last resort, and the name says what it is:
   * whether there is a series at all.
   */
  const hasSeries = !batched && !!d.symbol && closes.length >= 2
  /*
   * At hero and large the price column is the composition -- the record on
   * the left, the price on the right -- so the slot is drawn for any single
   * name even with nothing to put in it, and `TilePriceChart`'s `empty` node
   * says which name and why. That is the two COIN heroes, which stood 233px
   * tall around the bare words "No dated prices since this decision" with no
   * drawn slot at all.
   */
  const priceSlot = hasSeries || (big && !batched && !!d.symbol)

  /*
   * ── Which page of the carousel is showing ────────────────────────────────
   *
   * Declared here, above the `big` branch, because that branch returns early
   * and a hook cannot live inside it. Clamped at render rather than reset by
   * an effect: `closes` arriving or failing changes the panel COUNT after the
   * card has painted, and an index past the end would blank the picture --
   * the same reasoning as the Ideas grid, which hit it first.
   */
  const [panel, setPanel] = useState(0)

  /*
   * ── A composed tile at hero and large, not the stack with a chart under it ─
   *
   * The stacked body below answers this lens's question in eleven rows read
   * top to bottom, which is right at medium and compact where there is one
   * column and little room. At hero and large it left the card tall, thin down
   * the middle and padded at the bottom -- and putting the price chart in the
   * bottom slot made it taller rather than denser.
   *
   * So the big sizes get their own composition: the record on the left, the
   * price on the right, side by side at one height. Same data, same shelf,
   * same tone -- a different arrangement of it, and only where the width
   * exists to justify one. Medium and compact fall through to the stack
   * untouched.
   */
  /*
   * Single trades only, deliberately.
   *
   * A batch is several names, so it has no one price series to put in the
   * right column and its legs, description and explained-count are the
   * content -- which is exactly what the stacked body is good at. Composing
   * it side by side would spend the width on an empty panel.
   */
  if (big && !batched) {
    const e = d.execution
    const fig = 'font-mono tabular-nums text-[13px] font-semibold text-gray-900 dark:text-gray-100'
    const cap = 'text-[9px] font-semibold uppercase tracking-[0.09em] text-gray-400'

    /* Two decimals, and a label that says which quantity it is. "1.0%
       target" and "+1.00% change" were a weight and a DIFFERENCE of weights
       wearing the same unit -- the change is percentage POINTS. */
    /*
     * ── The pages of the right column, in the order the ladder tried them ──
     *
     * The old chain was `drawsPrice → sizes → path → bare text`, and
     * `drawsPrice` required an ANCHOR -- a fill, or failing that a decision
     * date. That is what decided the lead, not the mere existence of a
     * symbol, and it has to stay that way: an undecided request has no fill,
     * so "the price since the fill" is not a question it can answer, while
     * "6.1% held against 6.4% asked for" is the question itself.
     *
     * A first pass here drew the price slot for any single name and put it
     * first, which silently demoted the sizing rail on exactly those cards.
     * So the lead is still the anchor: anchored records lead with the price,
     * un-anchored ones lead with their own object and carry the price behind
     * it. Nothing is unreachable either way, which is the point.
     */
    const pricePanel = {
      key: 'price', tab: 'Price', label: 'the price',
      node: (
        <PriceColumn
          symbol={d.symbol!}
          anchorISO={priceAnchor}
          anchorLabel={priceAnchorLabel}
          height={size === 'hero' ? 200 : 168}
          points={closes}
          isLoading={closesLoading}
          error={closesError}
        />
      ),
    }
    const recordPanels = [
      ...(objectCandidates.sizes ? [{
        key: 'size', tab: 'Size', label: 'the size being asked for',
        node: (
          <DecisionSize
            from={d.baselineWeight!}
            to={d.sizingWeight!}
            requestedAt={d.requestedAt}
            decidedAt={d.decidedAt}
            open
          />
        ),
      }] : []),
      ...(drawsPath ? [{
        key: 'path', tab: 'Path', label: 'how long each step took',
        node: (
          <DecisionPath
            requestedAt={d.requestedAt}
            decidedAt={d.decidedAt}
            executedAt={d.execution?.completedAt ?? null}
            resolved={outcome !== 'open'}
          />
        ),
      }] : []),
    ]
    const bigPanels = !priceSlot
      ? recordPanels
      : priceAnchor != null
        ? [pricePanel, ...recordPanels]
        : [...recordPanels, pricePanel]

    const metrics: { cap: string; val: React.ReactNode }[] = []
    if (e?.targetWeight != null) {
      metrics.push({ cap: 'Target weight', val: <>{e.targetWeight.toFixed(2)}%</> })
    }
    if (e?.deltaWeight != null) {
      metrics.push({
        cap: 'Trade',
        val: <>{e.deltaWeight >= 0 ? '+' : ''}{e.deltaWeight.toFixed(2)} pp</>,
      })
    } else if (d.sizingWeight != null) {
      metrics.push({ cap: 'Asked for', val: <>{d.sizingWeight.toFixed(2)}%</> })
    }
    /*
      ── Dollar basis only, and why there is no per-share basis here ─────────

      `notional_value` is the cash this trade moved. Real, stored at commit,
      and it is the dollar basis.

      Average cost basis -- the per-share price paid across every share of
      the name the book holds -- is a POSITION fact, not a trade fact, and
      this record cannot supply it. `portfolio_holdings.cost` is per-share by
      design and would be the right source, but it is seeded with the current
      price: across a random sample of non-cash holdings (META, ADBE, AAPL,
      SBUX, ALLE, NOW, ZS, AMZN) `cost / price` is exactly 1.000 in every
      row. Rendering it would put "Average basis $228.50" beside a $228.50
      price and call it a computed figure.

      `price_at_acceptance` is not it either: that is what ONE commit paid,
      which is only the average where the position has exactly one trade.

      So the tile shows the basis it has and stays silent about the one it
      does not -- the same rule that took the undated return off the hero.
    */
    /*
      Both of these are `(weight/100) * total / price` on the sizing price, so
      they stand or fall together with `basisTrusted`. Where it fails the tile
      shows neither and names the reason -- a wrong dollar figure on a trade
      record is worse than a missing one, because the reader has no way to
      tell it is wrong.
    */
    if (basis !== 'bad' && e?.notional != null) {
      metrics.push({ cap: 'Dollar basis', val: <>{formatCompactDollars(Math.abs(e.notional))}</> })
    }
    if (basis === 'ok' && commitPrice != null) {
      metrics.push({
        /* "Paid at commit" was this codebase's own coinage and meant nothing
           to a reader: "commit" is an internal word for the moment a trade
           is written to the Trade Book. The thing itself is the price per
           share the trade went off at, which every desk calls the fill
           price. */
        cap: 'Fill price',
        val: <>${commitPrice.toFixed(2)}{e?.deltaShares ? <span className="text-gray-500"> · {Math.abs(e.deltaShares).toLocaleString()} sh</span> : null}</>,
      })
    } else if (basis === 'bad') {
      /* Named, not silently dropped. A trade record missing its price reads
         as an incomplete record; one that silently drops a price it DOES hold
         because that price is wrong reads as a bug. This says which. */
      metrics.push({
        cap: 'Fill price',
        val: (
          <span data-testid="decision-basis-untrusted" className="text-[11px] font-medium text-amber-700 dark:text-amber-500">
            not recorded
          </span>
        ),
      })
    }
    if (when) {
      metrics.push({
        cap: e?.completedAt ? 'Filled' : 'Decided',
        val: <>{shortDate(e?.completedAt ?? when)}{daysSince(when) != null ? ` · ${daysSince(when)}d ago` : ''}</>,
      })
    }

    return (
      <DesktopTile
        testId="decision-tile"
        dataAttrs={{
          'data-outcome': outcome,
          'data-memory': humanReason ? 'reasoned' : proposedReason ? 'proposed' : 'recorded',
          'data-subject': situation.subject,
          'data-legs': String(situation.legs.length),
          'data-composed': 'two-column',
        }}
        tone={outcome === 'open' ? 'review' : 'neutral'}
        size={size}
        flow="chronological"
        onOpen={onOpen}
        eyebrow={<DecisionEyebrow d={d} situation={situation} facts={facts} />}
        /* No standing context line here either — this is the two-column
           variant of the same card and it carried its own copy. Its version
           was the plainest case of all: the rail said "Review outcome →"
           directly beneath a shelf action labelled "Review outcome". A whole
           reserved rail spent restating the button next to it. */
        actions={<>
          {d.ideaId && (
            <ShelfAction
              testId="decision-review-outcome"
              label={facts.reviewed ? 'View review' : 'Review outcome'}
              onClick={() => openOutcomesFor(d)}
              primary
            />
          )}
          {(situation.batch || d.execution) && (
            <ShelfAction
              testId="decision-open-trade-book"
              label={situation.batch ? 'Open batch in Trade Book' : 'Open in Trade Book'}
              onClick={() => openTradeBookFor({ ...d, batch: situation.batch })}
            />
          )}
        </>}
      >
        <div data-testid="decision-composed" className="flex min-w-0 gap-4">
          {/* ── The record ───────────────────────────────────────────────── */}
          {/*
            ── 45/55, not 55/45 ───────────────────────────────────────────

            The record had the majority of the width and the price had the
            remainder: measured on a 923px tile, 489px of record against
            384px of chart. Reported as "charts are too narrow", and it is
            the wrong way round for what each half does with the space. The
            record is a symbol, a reason line and a two-column figure grid --
            four short rows that stop wrapping somewhere around 370px and
            gain nothing above it. A price path keeps getting more readable
            for every pixel of width it is given, because width is where the
            time axis lives.

            So the record takes what it needs and the chart takes the rest:
            ~373px and ~500px on the same tile.
          */}
          <div className="flex min-w-0 shrink-0 basis-[42%] flex-col gap-2">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[22px] font-black leading-none tracking-[-0.03em]">
                  {d.symbol ?? situation.batch?.name ?? '—'}
                </span>
                {/*
                  The stance sits at the ticker's own weight, not a footnote
                  beside it. At 10px against a 22px ticker it read as
                  metadata; BUY and SELL are the single most important word
                  on a decision card, so they are sized to be read at the
                  same glance as the name they apply to.
                */}
                {d.action && (
                  <span
                    data-testid="decision-stance"
                    className={clsx(
                      'shrink-0 rounded px-2 py-0.5 font-mono text-[15px] font-black uppercase leading-none tracking-wide',
                      /^(buy|add)$/i.test(d.action)
                        ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                        : /^(sell|trim)$/i.test(d.action)
                          ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400'
                          : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
                    )}
                  >
                    {d.action}
                  </span>
                )}
              </div>
              {/* Company and book on ONE row. They are both quiet grey
                  context at 11-12px and they were stacked, which spent two
                  rows of a card whose chart is the thing below them. Two
                  spans, not one joined string: the book is a fact a reader
                  -- and a test -- addresses on its own. Never the batch's
                  own auto-generated name. */}
              <div data-testid="decision-context" className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 text-[12px] text-gray-500">
                {d.companyName && <span className="truncate">{d.companyName}</span>}
                {d.companyName && d.portfolioName && <span aria-hidden>·</span>}
                {d.portfolioName && <span className="truncate">{d.portfolioName}</span>}
              </div>
            </div>

            {/*
              The move, where it is trustworthy, as the left column's figure.

              Coloured, because a return has a direction and this is the one
              number on the card that carries one. Labelled by what it
              actually measures -- the fill, or the decision -- and absent
              entirely when the price behind it carries no date.
            */}
            {(leadMove != null || leadPnl != null) && (
              <div data-testid="decision-lead-move" className="flex flex-wrap items-end gap-x-9 gap-y-2">
                {leadMove != null && (
                  <div>
                    <span className={clsx(
                      'font-mono text-[26px] font-bold leading-none tabular-nums',
                      leadMove >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400',
                    )}>
                      {leadMove >= 0 ? '+' : ''}{leadMove.toFixed(2)}%
                    </span>
                    {/* Named by the date the WINDOW starts from, which is the
                        anchor the chart beside it also uses -- not
                        `facts.sinceBasis`, which describes a different
                        measurement the headline no longer makes. */}
                    <div className={cap}>
                      {d.execution?.completedAt ? 'Since it filled' : 'Since the decision'}
                    </div>
                    {/* Measured from the close on the fill day rather than a
                        recorded fill price, so say so once, quietly. A 0.00%
                        that turns out to have been measured from a price the
                        reader did not expect is worse than a caption. */}
                    {moveBasis === 'fill-day-close' && (
                      <div
                        data-testid="decision-move-proxy"
                        className="mt-0.5 text-[9px] leading-snug text-gray-400"
                      >
                        from the close on the fill day
                      </div>
                    )}
                  </div>
                )}
                {/*
                  The dollars, at the same weight as the percentage.

                  A return and the money it made or lost are the same finding
                  measured two ways, and one of them was 10px grey in a strip
                  of metadata while the other was 26px and coloured. On a desk
                  the dollars are usually the half that gets said out loud.
                */}
                {leadPnl != null && (
                  <div data-testid="decision-lead-pnl">
                    <span className={clsx(
                      'font-mono text-[26px] font-bold leading-none tabular-nums',
                      leadPnl > 0 ? 'text-emerald-700 dark:text-emerald-400'
                        : leadPnl < 0 ? 'text-rose-700 dark:text-rose-400'
                        : 'text-gray-700 dark:text-gray-300',
                    )}>
                      {formatCompactDollars(leadPnl, leadPnl > 0 ? '+' : leadPnl < 0 ? '−' : '')}
                    </span>
                    {/* Named by what it measures. "P&L" alone left the reader
                        to guess whether it ran from the decision or the fill,
                        and those are different numbers -- the gap between
                        them is the delay cost, reported separately. */}
                    <div className={cap}>
                      P&amp;L {d.execution?.completedAt ? 'since fill' : 'to date'}
                    </div>
                  </div>
                )}
                {/*
                  ── Say why it is missing, where it is missing ──────────────

                  A blank beside a percentage reads as a bug, and the reader
                  cannot tell a figure we do not have from one we failed to
                  draw. P&L needs a fill price and a share count, and on a row
                  written during a quote outage both are the same fabricated
                  number -- so the tile names the gap instead of leaving it.
                */}
                {leadPnl == null && facts.pnl != null && (
                  <div data-testid="decision-pnl-unavailable" className="max-w-[190px]">
                    <span className="text-[13px] font-semibold text-amber-700 dark:text-amber-500">
                      No P&amp;L
                    </span>
                    <div className="mt-0.5 text-[9px] leading-snug text-gray-500">
                      the fill price on this trade was not recorded, so the
                      dollars cannot be worked out
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Two lines, and the reader opens the record for the rest.

                The generated `proposedReason` fallback is gone here too. This
                is the stacked branch of the same card and it carried its own
                copy of the line — the hero branch is not the whole card, and
                changing one is how a defect survives a fix. A human-written
                reason still shows. */}
            {reason && (
              <p
                data-testid="decision-rationale"
                className="line-clamp-2 text-[12px] leading-snug text-gray-700 dark:text-gray-300"
              >
                {reason}
              </p>
            )}
            {/*
              No "No decision reason".

              It drew on 23 of the 26 cards in the live field, in amber, which
              is a gallery announcing its own corpus rather than telling a
              reader anything about a decision. Nothing is actionable about
              it on a card -- the reader cannot write the missing reason from
              here -- and the detail pane states the absence properly, in a
              line that also says what WAS recorded. A label that is true of
              almost every card is a background condition, not a finding.
            */}

            {/* Readable figures, captioned, in a grid rather than a run-on
                strip of microtext joined by middots. */}
            {metrics.length > 0 && (
              <div data-testid="decision-figures" className="mt-auto grid grid-cols-2 gap-x-4 gap-y-1.5">
                {metrics.map(m => (
                  <div key={m.cap} className="min-w-0">
                    <div className={cap}>{m.cap}</div>
                    <div className={clsx(fig, 'truncate')}>{m.val}</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/*
            ── The price, and the record's own objects beside it ───────────

            This was a ladder of four mutually exclusive rungs, so a decision
            that had both a price AND an unanswered size, or both a price and
            a requested-to-filled path, drew exactly one of them and the
            other was unreachable without opening the record. Measured on the
            live field, no tile in this lens drew the shared chart and none
            offered a second visual, while the Ideas field next door offered
            45 of them.

            The rungs become pages of the shared pager, in the order they
            used to be tried -- so whatever each card led with before, it
            still leads with, and the rest is now one press away.
          */}
          <div className="flex min-w-0 flex-1 flex-col justify-center">
            <PanelCarousel
              testId="decision-visuals"
              index={panel}
              onChange={setPanel}
              /* Taller than the left column needs, deliberately: the record
                 stops after four short rows and the remaining height was
                 empty ground. The chart is the one element here that gets
                 better with vertical room -- it is where the price detail
                 lives -- so it takes the slack instead of the padding. */
              /* Same rule as the stacked body: the chart's height is
                 reserved where the chart is one of the pages. */
              box={priceSlot ? (size === 'hero' ? 200 : 168) + CHART_CHROME : 72}
              panels={bigPanels}
              /* A batch has no one price series and may have no intervals
                 either: say so rather than draw a shape. An empty panel here
                 is information. */
              empty={
                <div className="text-[10px] text-gray-400">
                  {d.symbol ? 'No dated prices since this decision' : 'No single price series for a batch'}
                </div>
              }
            />
          </div>
        </div>
      </DesktopTile>
    )
  }

  return (
    <DesktopTile
      testId="decision-tile"
      dataAttrs={{
        'data-outcome': outcome,
        'data-memory': humanReason ? 'reasoned' : proposedReason ? 'proposed' : 'recorded',
        /*
         * The act this card stands for, as a real id.
         *
         * Carried on the element so a disposition, a discussion, an Ask AI
         * turn or a future composer can name the same decision without
         * parsing the card's text. `trade_batch:<id>` or
         * `decision_request:<id>` -- never a rendered string.
         */
        'data-subject': situation.subject,
        'data-legs': String(situation.legs.length),
      }}
      tone={outcome === 'open' ? 'review' : 'neutral'}
      size={size}
      flow="chronological"
      onOpen={onOpen}
      eyebrow={<>
        {/* Where the record stands and why it is in the lens -- each said
            once. See `DecisionEyebrow`: the outcome and the reason agree far
            more often than they differ ("Awaiting decision" is both), so the
            dedupe is structural rather than a check per colliding pair. */}
        <DecisionEyebrow d={d} situation={situation} facts={facts} />
        {/*
          The stance, inked.

          Buy and sell were the same grey as the date, so the one word that
          says which way the desk went carried no more weight than the filing
          metadata. Ideas inks its stance; this is the same language, on the
          same axis, and it is direction rather than severity -- so it does not
          compete with the tone the state chip carries.
        */}
        {/* The stance moved beside the ticker: it is a fact about the OBJECT,
            not about where the record stands, and the eyebrow is for state. */}
        <TileFigure>{when ? shortDate(when) : '—'}</TileFigure>
      </>}
      /*
        No standing context line.

        It read "Review in Outcomes" / "Committed in a batch" / "Open the
        record" — four ways of naming a destination, directly under a card
        whose top-right corner already carries the button that GOES there.
        The verbs left the shelf for that corner in an earlier pass; what
        stayed behind was a caption for them.

        `TileShelf` renders nothing without `context`, so dropping it returns
        the whole rail — its height plus a top border and padding — to the
        card: 34px on a hero or large tile, 30px medium, 26px compact. That
        is room the chart and the figures were short of.
      */
      actions={(situation.klass !== 'action' || situation.reason === 'confirm') ? <>
        {d.ideaId && (
          <ShelfAction
            testId="decision-review-outcome"
            label={facts.reviewed ? 'View review' : 'Review outcome'}
            onClick={() => openOutcomesFor(d)}
            primary
          />
        )}
        {(situation.batch || d.execution) && (
          <ShelfAction
            testId="decision-open-trade-book"
            label={situation.batch ? 'Open batch in Trade Book' : 'Open in Trade Book'}
            onClick={() => openTradeBookFor({ ...d, batch: situation.batch })}
          />
        )}
      </> : undefined}
    >
      {/*
        A batch names itself as the act it is; a lone trade names its asset.

        No bespoke tile: this is `TileIdentity` with the batch's own words
        where it has them, because a five-leg batch is not "ORCL" and calling
        it that is what made five legs look like five unrelated decisions.
      */}
      {batched ? (
        <TileIdentity
          symbol={situation.batch!.name ?? 'Trade batch'}
          name={situation.batch!.name ? null : 'Trade batch'}
          size={size}
        />
      ) : (
        /*
          The book rides on the identity row, not under it.

          Measured on a 455x344 tile: the name row, the book row and the
          figures row used 139px of 421px across and 99px down, and the chart
          underneath got 141px. The book is three or four words; putting it
          on its own line spent a 25px row to place them at x=0. On the row
          above there is nothing to its right.
        */
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <TileIdentity symbol={d.symbol} name={d.companyName} size={size} />
          {d.action && (
            <span
              data-testid="decision-stance"
              className={clsx(
                'shrink-0 rounded-[3px] px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-wider',
                /^(buy|add)$/i.test(d.action)
                  ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-400'
                  : /^(sell|trim)$/i.test(d.action)
                    ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-400'
                    : 'bg-gray-100 text-gray-600 dark:bg-white/10 dark:text-gray-300',
              )}
            >
              {d.action}
            </span>
          )}
          {/* The book, and nothing else. This line used to append "committed
              in <batch name>", which on a batch called "testing" rendered as
              "committed in testing" -- an internal label reading as a
              statement about the trade. The batch is named in the batch block
              below, where it belongs. */}
          {d.portfolioName && (
            <span data-testid="decision-context" className="truncate text-[11px] text-gray-500">
              {d.portfolioName}
            </span>
          )}
        </div>
      )}

      {/*
        Where and when, on one line under the name.

        A single-trade batch says its batch name HERE rather than as the card's
        identity: the trade is the thing, and titling the card "1 buy ·
        09/15/2026" buried the ticker under a filename. A multi-leg batch is
        the thing, and its legs carry the tickers below.
      */}
      {/* The date is in the eyebrow and the people are in the footer; this
          line carries what neither does. */}
      {/* The book moved onto the identity row above, where there was 280px of
          empty space beside the ticker and this cost a 25px row of its own.
          A batched card has no identity row to ride on, so it keeps one. */}
      {batched && (
        <p data-testid="decision-context" className="text-[11px] text-gray-500">
          {d.portfolioName}
        </p>
      )}

      {/*
        What was actually committed, in the trade's own recorded figures.

        `accepted_trades` stores the weight the book was taken to, the change
        that made and the cash it moved. Where nothing was executed, what was
        ASKED for is the only quantity there is, and it says so.
      */}
      {/*
        The claim: what a person wrote, or why this needs attention.

        The same slot, and the same primitives, every other lens uses --
        `TileQuote` for words somebody actually wrote, `TileReason` for the
        system's own sentence. A card that said "reason recorded" made a
        reader open it to find out what the reason WAS, which is the content
        of a decision. A multi-leg batch keeps its description above its legs,
        because there it explains several names at once.
      */}
      {/*
        ── And nothing where nobody wrote anything ────────────────────────

        The third branch used to be `summaryOf(d)`, which assembles a sentence
        out of the fields this tile is already showing: "Eric accepted a trim
        in MNST at 2.0%" sits directly beneath the eyebrow carrying ACCEPTED,
        the ticker carrying MNST, the stance carrying TRIM and the figures
        carrying 2.0%. Four facts, printed twice, and the second printing
        looks like content -- so a reader scans it before discovering it says
        nothing new.

        It is also most of why a run of these tiles read as identical: the
        generated sentence has the same shape on every card, so the paragraph
        that should differentiate them was the part that differed least.

        Where a human wrote a reason it is quoted, because that is the rarest
        thing this history holds. Where nobody did, the tile says so by
        staying quiet and spends the room on the price instead.
      */}
      {/*
        "Why it was proposed" is gone, and with it the generated sentence it
        labelled.

        Two lines of boilerplate plus an eyebrow, on a card that already
        carries the ticker, the stance, the state, the date and the move. The
        note above says it: the generated sentence has the same shape on every
        card, so the paragraph meant to differentiate them differed least. It
        was spending three rows to say less than the figure beside it.

        A human-written reason still shows, unlabelled — it is the rarest
        thing this history holds and the one line here worth the space. The
        generated version belongs in the workspace, where there is room to
        read it, not on a tile.
      */}
      {!batched && reason && <TileQuote size={size}>{reason}</TileQuote>}

      {/*
        The move since the decision, where the tile has room to lead with it.

        `TileLead` is what Research gives a price move and Ideas gives a
        proposed weight: the one figure that IS the finding. Here it answers
        "does this deserve another look?". Outcomes' number, never recomputed.
      */}
      {leadsMove && (
        <TileLead
          figure={`${leadMove >= 0 ? '+' : ''}${leadMove.toFixed(1)}`}
          unit="%"
          /* Labelled by what it actually measures. The fallback measures from
             the FILL, which is a different number against a later date. */
          label={facts.sinceBasis === 'execution'
            ? <>since it filled</>
            : <>since the decision</>}
        />
      )}

      {/*
        The numbers, in the strip every lens carries them in.

        `accepted_trades` records the weight the book was taken to, the change
        that made and the cash it moved. A smaller tile carries fewer of them:
        the shared density behaviour, not a second layout.
      */}
      <div data-testid="decision-figures">
        <TileMeta>
          {(() => {
            const e = d.execution
            const out: React.ReactNode[] = []
            /* The figures are the readable part of this strip and were the
               same weight and near enough the same grey as the words joining
               them. Darker and a step up in size, so the numbers carry and the
               connective text stays quiet around them. */
            const strong = 'font-mono text-[11px] font-semibold text-gray-900 dark:text-gray-100'
            if (e?.targetWeight != null) out.push(<span key="t"><b className={strong}>{e.targetWeight.toFixed(1)}%</b> target</span>)
            if (big && e?.deltaWeight != null) {
              out.push(<span key="d"><b className={strong}>{e.deltaWeight >= 0 ? '+' : ''}{e.deltaWeight.toFixed(2)}%</b> change</span>)
            }
            if (e?.notional != null) out.push(<span key="n"><b className={strong}>{formatCompactDollars(Math.abs(e.notional))}</b> committed</span>)
            /*
              Nothing was executed, so the ask is the only quantity there is --
              and it is labelled as the ask, never as a position.
            */
            if (!out.length) {
              if (d.sizingWeight != null) out.push(<span key="a"><b className={strong}>{d.sizingWeight.toFixed(1)}%</b> asked for</span>)
              else if (d.sizingShares != null) out.push(<span key="a"><b className={strong}>{d.sizingShares.toLocaleString()} sh</b> asked for</span>)
              if (big && d.baselineWeight != null) out.push(<span key="b">{d.baselineWeight.toFixed(1)}% held then</span>)
            }
            // The outcome, wherever the lead has not already carried it.
            if (!leadsMove && !batched && leadMove != null) {
              out.push(<span key="s"><b className={strong}>{leadMove >= 0 ? '+' : ''}{leadMove.toFixed(1)}%</b> {facts.sinceBasis === 'execution' ? 'since fill' : 'since'}</span>)
            }
            // A batch reports dollars only where Outcomes says it may: every
            // leg priced, none counted into a second batch. Never a return.
            if (batched ? batchPnl : facts.pnl != null) {
              out.push(<span key="p">{batched ? batchPnl : `${formatCompactDollars(facts.pnl!, facts.pnl! > 0 ? '+' : facts.pnl! < 0 ? '−' : '')} P&L`}</span>)
            }
            if (when && daysSince(when) != null) out.push(<span key="e">{daysSince(when)}d ago</span>)
            /*
              The people, on the strip rather than on a row of their own.
              A second `TileMeta` under the batch block was one more line box
              and one more gap to carry a name and an execution word that sit
              perfectly well beside the figures.
            */
            if (d.decidedByName) out.push(<span key="w">{d.decidedByName}</span>)
            if (alsoInBooks > 0) {
              out.push(<span key="k">also in {alsoInBooks} other book{alsoInBooks === 1 ? '' : 's'}</span>)
            }
            if (outcome === 'accepted' && !(drawsPath && d.execution?.completedAt)) {
              out.push(
                <span key="x" className={d.execution?.completedAt ? strong : undefined}>
                  {d.execution?.completedAt ? 'Executed' : d.execution ? 'Execution open' : 'Never executed'}
                </span>,
              )
            }
            return out
          })()}
        </TileMeta>

      {/* Where the review stands, and whether anybody wrote why -- said once,
          and only where the status line above has not already said it.

          Inside the figures block on purpose: as its own child of the tile it
          collected another `gap-3` above it for one short line. */}
      {/*
        The missing-reason half of this line is gone; see the note on the big
        branch. It was true of 23 of 26 cards, so the line it forced appeared
        on nearly all of them -- 20px of vertical, in amber, on every card,
        for a fact about the corpus. The VERDICT half stays: it is the one
        piece of standing state that asks the reader for something.
      */}
      {facts.verdictLabel && situation.klass === 'recent' ? (
        <p data-testid="decision-state" className="mt-1 text-[11px]">
          {/*
            A tinted chip, not grey prose.

            "Outcome not reviewed" is the one piece of standing state on a
            committed record that asks the reader for something, and it was
            set in the same grey as the people's names beside it. Tinted and
            enclosed it reads as a condition; grey and inline it reads as
            filing. The other verdicts stay quiet -- a gallery where every
            label is coloured says nothing.
          */}
          {facts.verdictLabel && situation.klass === 'recent' && (
            facts.reviewed ? (
              <span className="text-gray-500">{facts.verdictLabel}</span>
            ) : (
              <span
                data-testid="decision-verdict-chip"
                className="rounded-[3px] bg-amber-50 px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-400"
              >
                {facts.verdictLabel}
              </span>
            )
          )}
        </p>
      ) : null}
      </div>

      {/*
        The legs, named. The act asks its question once, and the reader can
        still see exactly which trades it covers -- number, names, and their
        direction. Nothing is summarised away.
      */}
      {batched && (
        <>
          {/*
            What the batch says about itself, where it says anything.

            `trade_batches.description` is the only batch-level prose the
            schema has, and a card that owes a rationale should show whatever
            is already written rather than asking as if nothing were there.
            It is labelled by provenance: a workflow line is not a reason, and
            printing it unlabelled beside a request for one would read as
            though the desk had already answered.
          */}
          {situation.batch!.description && (
            <div data-testid="batch-description">
              <div className={EYEBROW}>
                {provenanceOf(situation.batch!.description) === 'human'
                  ? 'What the batch says'
                  : 'Recorded on the batch'}
              </div>
              <p className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-gray-700 dark:text-gray-300">
                {situation.batch!.description}
              </p>
            </div>
          )}

          {/*
            How much of the act is answered, and which legs are not.

            The count is the question restated as a quantity -- "two of four
            have no reason" is what a reader needs before deciding whether to
            write one -- and the per-leg mark says which two, so the answer
            does not require opening every trade.
          */}
          <div>
            <div className="flex items-baseline justify-between text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
              <span>{situation.legs.length} trades approved together</span>
              <span
                data-testid="batch-rationale-count"
                className="font-mono tracking-normal normal-case text-gray-500"
              >
                {situation.legs.length - situation.owed.length} of {situation.legs.length} explained
                {situation.owed.length > 0 && (
                  <span className="text-amber-700 dark:text-amber-500">
                    {' · '}{situation.owed.length} without a reason
                  </span>
                )}
              </span>
            </div>

            {/* Every leg named is a hero courtesy. At `large` the count above
                already says how many, and the list was the tallest block on a
                batch tile -- three legs wrapped to three rows. */}
            <ul
              data-testid="batch-legs"
              className={clsx(
                'mt-1.5 flex flex-wrap gap-x-4 gap-y-1',
                size !== 'hero' && 'hidden',
              )}
            >
              {situation.legs.map(l => {
                const explained = !situation.owed.includes(l)
                return (
                  <li key={l.id} className="flex items-baseline gap-1.5">
                    <span className={clsx(
                      'font-mono text-[12px] font-semibold',
                      explained ? 'text-gray-500' : 'text-gray-900 dark:text-gray-100',
                    )}>
                      {l.symbol ?? '—'}
                    </span>
                    {l.action && (
                      <span className="text-[10px] uppercase tracking-[0.06em] text-gray-500">
                        {l.action}
                      </span>
                    )}
                    {l.sizingWeight != null && (
                      <span className="font-mono text-[10px] tabular-nums text-gray-400">
                        {l.sizingWeight.toFixed(1)}%
                      </span>
                    )}
                    {/* A dot, not a word: five legs each captioned "explained"
                        is five times the ink for one bit of information. */}
                    <span
                      aria-label={explained ? 'has a reason' : 'no reason recorded'}
                      className={clsx(
                        'h-[5px] w-[5px] rounded-full',
                        explained
                          ? 'bg-slate-400 dark:bg-slate-500'
                          : 'border border-amber-600 dark:border-amber-500',
                      )}
                    />
                  </li>
                )
              })}
            </ul>
          </div>
        </>
      )}

      {/*
        A leg's prose is never shown as the act's.

        The lead is one of several trades, and its `contextNote` is why THAT
        trade was asked for. Printing it under the batch's own name says the
        desk proposed five names for one leg's reason -- the same error as
        reading a leg's decision note upward as the batch's rationale, made
        in the other field. The legs list already names them; a reader who
        wants one leg's ask opens that leg.
      */}
      {/*
        The reasoning itself, not a note that some exists.

        A card that says "reason recorded" makes a reader open it to find out
        what the reason WAS -- which is the whole content of the decision. A
        lone trade quotes its own note; where the act was committed as a batch
        of one, the batch's sentence is that trade's reason and is quoted the
        same way. A multi-leg batch keeps its description above the legs,
        because there it explains several names at once.
      */}

      {/*
        What the decision changed, and how long it took.

        Both facts were already on the record and both went undrawn, so these
        cards were prose above two hundred pixels of nothing. `baselineWeight`
        to `sizingWeight` IS the decision -- "trim NVDA from 7.4 to 5.0" is a
        different object from "add 0.2" -- and how long a request sat before
        anyone answered is the first thing that happened next, which is the
        question this lens asks.
      */}
      {/*
        Every card gets a visual, at every size.

        ── Why it did not ───────────────────────────────────────────────────

        Two gates, and both looked reasonable in the harness because the
        fixture happened to dodge them. `DecisionSize` required a baseline
        weight, which comes from `submission_snapshot` and plenty of real
        records simply do not carry -- so most cards drew nothing. And every
        visual was gated on `size !== 'compact'`, which is every card from the
        fourth onward. Between them, a real queue of any length was a wall of
        prose.

        Neither gate was protecting anything. A request with no baseline still
        has a size worth drawing; it just has no CHANGE, and the visual says
        which of the two it is showing. A compact tile still has room for an
        axis, it just cannot carry ticks and both end labels.

        Which visual still follows the job: an absence for a decision that
        owes a reason, a quantity for one that owes an answer.
      */}
      {/*
        ── The dominant visual, at hero and large ───────────────────────────

        `DecisionPath` was written for this lens and never imported by it: the
        requested -> decided -> executed track, with days-to-answer and
        days-to-fill on its own two legs. It takes only three timestamps the
        record already carries, so it needs no price plumbing and no new
        geometry.

        Gated on `decidedAt`, not merely on being big. An unanswered request
        has no second leg to draw, and the question it actually poses is the
        SIZE -- what the book holds against what is being asked for -- which
        `DecisionSize` below already draws. So the path takes hero and large
        only once there is a decision for it to be about, and the sizing rail
        keeps the open requests it was written for.

        One visual per tile: this replaces the rail on those cards, never
        joins it.
      */}
      {/*
        The price column, where a real dated series reaches the fill.

        This is the whitespace the tile was carrying. `usePriceHistory` reads
        `price_history_cache` -- the canonical dated closes -- and the chart
        draws nothing unless the window actually reaches the anchor, so an
        empty right column means "we cannot date this", never a line starting
        wherever the cache happens to begin.
      */}
      {/*
        ── The same ladder, as pages ──────────────────────────────────────

        Below `large` this was five mutually exclusive rungs ending in a
        sparkline, and the sparkline was the LAST of them -- so a card with
        a record gap or a sizing question never showed a price, and a card
        that showed a price was one with nothing else to say. Measured on the
        live field of 26 tiles: 11 drew record gaps, 8 drew a sparkline, 7
        drew nothing, and none offered a second visual.

        The rungs keep their precedence as the page ORDER, so each card
        still leads with what it led with and the rest is one press away.
      */}
      <PanelCarousel
        testId="decision-visuals"
        index={panel}
        onChange={setPanel}
        /*
          `flex-1`, so the carousel is the element that takes a row's spare
          height. A gallery row is as tall as its tallest card, and without
          this the box sat at its floor while the difference went to padding
          -- measured on the live field, a 65px plot inside a 370px card. The
          chart is in `fill` mode, so the box growing is the plot growing.
        */
        className="mt-1.5 min-h-0 flex-1"
        /*
          ── Reserve the chart's height only where a chart is a page ────────

          The box is floored to the tallest page so that turning one never
          relayouts the field, and the chart is comfortably the tallest page
          there is. But a floor derived from the chart was being applied to
          cards that have no chart at all -- a gaps-only record reserved
          125px for a drawing of about 50, and measured on the live field
          that put 93px onto cards that gained nothing for it.

          `RecordGaps` and `DecisionSize` are a track and two labels, so 56
          holds either of them with room. The reserved height is still
          identical across the pages a given card actually has, which is the
          property that matters.
        */
        box={hasSeries ? (size === 'compact' ? 64 : 80) + CHART_CHROME : 56}
        panels={[
          ...(work === 'explain' ? [{
            key: 'gaps', tab: 'Record', label: 'what the record is missing',
            node: (
              <RecordGaps
                requested={d.requestedAt != null}
                sized={d.sizingWeight != null || d.sizingShares != null}
                decided={d.decidedAt != null}
                explained={provenanceOf(d.decisionNote) === 'human'}
                // Only outcomes that call for a trade have an execution to miss.
                executed={outcome === 'accepted' ? d.execution?.completedAt != null : null}
                compact
              />
            ),
          }] : []),
          ...(outcome === 'open' && size !== 'compact'
            && d.sizingWeight != null && d.baselineWeight != null ? [{
            key: 'size', tab: 'Size', label: 'the size being asked for',
            /*
              The rail earns its space only where it draws a real change.

              `from → to` on an undecided request is the question itself:
              what the book holds against what is being asked for.
              Everywhere else it was a wide band restating one number the
              line above already carries -- and on a committed decision the
              figures are what was actually executed, which the rail cannot
              draw.

              Still not at compact. A share-of-book bar is the object this
              product draws most, so on the smallest tile it is the least
              informative thing that could take the one slot. The price goes
              there instead: it is the object that actually differs from the
              tile above.
            */
            node: (
              <DecisionSize
                from={d.baselineWeight}
                to={d.sizingWeight}
                requestedAt={d.requestedAt}
                decidedAt={d.decidedAt}
                open
                compact
              />
            ),
          }] : []),
          ...(hasSeries ? [{
            key: 'price', tab: 'Price', label: 'the price since the decision',
            /*
              ── The shared chart, not a sparkline reduction of it ─────────

              `TileSparkline` drew a visibly different object from the one
              every other lens draws: no price axis, no horizon chips, no
              anchor marker, the caption above the line instead of beside the
              percentage, an 11px readout instead of 18px, and a stroke that
              scales with the SVG so the line changed weight along its own
              path. Reported as the charts here not matching the other
              lenses, and that is exactly what it was -- the same complaint
              Portfolio's 20-30px micro sparkline drew, which is why
              `TilePriceChart` exists at all.

              Same component, same geometry, same ink, same horizon ladder.
              The heights are what Research gives the same card sizes.
            */
            node: (
              <TilePriceChart
                points={closes}
                anchorISO={priceAnchor}
                anchorLabel={priceAnchorLabel}
                fill
                height={size === 'compact' ? 64 : 80}
              />
            ),
          }] : []),
        ]}
      />
      {/*
        ── What the sparkline branch was, and why it is gone ──────────────

        It began as the rung that stopped this lens drawing NOTHING below
        `large`: "a decision with no gaps in its record, no intervals to draw
        and no sizing question rendered as text over text." Then its heights
        went 22 -> 48/56 because 22px of hairline is a rule, not a chart.

        Both steps were right about the problem and wrong about the object.
        The answer to "this card needs a price" is the price chart the other
        four lenses draw, not a second, smaller drawing of the same data with
        its own geometry -- which is the whole reason `TilePriceChart` was
        pulled out of this lens in the first place. It is a carousel page now,
        and it is the same chart.
      */}

      {/*
        Enough of what happened to answer "does this deserve another look?".

        Every figure is Outcomes' own: the move since the decision, the dollar
        proxy behind it, and where the review stands. Nothing is charted and
        nothing is reflected on here -- that is Outcomes' work, and the
        actions below go there rather than reproducing it.
      */}
      {/*
        Where the follow-up actually happens, on the card's own bottom rail.

        Outcomes owns the review and Trade Book owns the committed act; this
        lens hands off rather than growing a second copy of either. The people
        sit beside them as metadata, not as a separate line of their own.
      */}
      {/*
        The verbs moved to the shell's shelf, and that fixes a real bug as
        well as a visual one.

        These were `<button>`s rendered inside `DesktopTile`'s own `<button>`
        -- invalid HTML, and unreachable by keyboard, so the only way to review
        an outcome from this lens was with a mouse. They now go through
        `DesktopTile`'s `actions` prop, which renders them into the canonical
        shelf: hidden at rest, revealed on hover AND on keyboard focus, in
        height the tile already reserved.
      */}
      {/*
        The closing strip is gone: the decider, the other books and the
        execution word moved onto the figures strip above, which had room for
        them. Two `TileMeta` rows separated by the batch block was two line
        boxes and two gaps for one line of metadata -- the largest single
        piece of dead space on this tile.

        "Executed" is still suppressed where `DecisionPath` draws the fill,
        for the same reason as before: its third stop IS that fact, labelled
        and dated.
      */}
    </DesktopTile>
  )
}

/* The local `TileAction` lived here. It is now `TileAction` in
   `desktop/DesktopTile`, imported as `ShelfAction`, so the shelf that renders
   it and the button it renders share one definition -- and so the nested
   `<button>` inside the tile's own `<button>` is gone for good. */

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })

/* ------------------------------------------------------------------ states */

/* The canonical gallery skeleton, in this lens's own flow: chronological, and
   sized by recency, which is exactly what the loaded field does. The old one
   described a three-column grid of equal cards and handed over to a
   twelve-column mosaic -- a layout change dressed as a loading state. */
function Loading() {
  return <GallerySkeleton title="Decisions" flow="chronological" sizeAt={sizeByRecency} />
}

function Failed({ message }: { message: string }) {
  return (
    <div className="mt-4 rounded-xl border border-rose-200 bg-white px-6 py-12 text-center shadow-sm dark:border-rose-900/50 dark:bg-[#141a25]">
      <h2 className="text-[16px] font-semibold text-rose-700 dark:text-rose-400">
        The decision history could not be loaded
      </h2>
      <p className="mx-auto mt-1.5 max-w-[52ch] text-[12px] text-gray-600 dark:text-gray-400">
        This is a read failure, not an empty history.
      </p>
      <p className="mx-auto mt-2 max-w-[60ch] font-mono text-[11px] text-gray-500">{message}</p>
    </div>
  )
}

function Empty() {
  return (
    <div className="mt-4 rounded-xl border border-gray-200 bg-white px-6 py-16 text-center shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]">
      <Landmark className="mx-auto h-7 w-7 text-gray-400" />
      <h2 className="mt-4 text-[17px] font-semibold">No decisions on record yet</h2>
      <p className="mx-auto mt-1.5 max-w-[46ch] text-[12px] text-gray-600 dark:text-gray-400">
        A decision appears here once someone accepts, declines or defers a
        request against a portfolio.
      </p>
    </div>
  )
}

/**
 * Everything `TilePriceChart` draws around its plot: the horizon chips, the
 * date axis and the percentage readout.
 *
 * Duplicated from that component's own `CHROME` rather than exported from it,
 * and the duplication is deliberate: there it is the floor the chart states
 * for itself, here it is how tall a carousel box has to be to hold that
 * chart without the page resizing when the reader moves between panels. Two
 * callers, two reasons, one measurement -- if it drifts, the symptom is 2px
 * of slack in a box, not a broken chart.
 */
const CHART_CHROME = 61

/**
 * The tile's visuals, as pages rather than as a ladder.
 *
 * ── Why a carousel and not a choice ──────────────────────────────────────
 *
 * Every visual on a decision card used to be a rung of one `?:` chain, so a
 * record that had a price AND an unanswered size, or a price AND a
 * requested-to-filled path, drew exactly one of them -- and which one was
 * invisible from the outside. It looked as though charts came and went by
 * name. Measured on the live field of 26 cards: 11 drew record gaps, 8 drew
 * a sparkline, 7 drew nothing, 0 drew the shared chart and 0 offered a
 * second visual, while the Ideas field next door offered 45.
 *
 * None of these drawings is droppable -- a gap in the record, the size being
 * asked for and the price since the decision answer three different
 * questions -- so the resolution is the one Ideas reached: page between them.
 * Same shared `VisualPager`, same position under the picture, same words.
 *
 * ── The box is sized to the TALLEST panel, by a floor ────────────────────
 *
 * A read must not relayout the field under the reader's cursor. The panel is
 * taken out of flow and the box carries a `minHeight`, so the box's own
 * intrinsic height is identical whichever page is showing while `flex-1`
 * still lets a tall row hand it more. `overflow-hidden` is NOT enough and
 * that is worth keeping: clipping governs painting, not intrinsic sizing.
 * The Ideas grid measured the cost of getting this wrong -- paging grew the
 * card by 39px on four of its carousels, and the page grew with it.
 */
function PanelCarousel({
  panels, index, onChange, box, testId, className, empty = null,
}: {
  panels: { key: string; tab: string; label: string; node: React.ReactNode }[]
  index: number
  onChange: (next: number) => void
  /** The floor the box holds whichever page is showing. */
  box: number
  testId: string
  className?: string
  /** Drawn in place of the box when the record has no visual at all. */
  empty?: React.ReactNode
}) {
  if (!panels.length) return <>{empty}</>
  /* Clamped rather than reset: the panel COUNT changes after the card has
     painted when `closes` arrive or fail, and an index past the end would
     blank the picture. Derived, so there is no effect to miss. */
  const shown = Math.min(Math.max(index, 0), panels.length - 1)

  return (
    <div className={clsx('flex min-h-0 min-w-0 flex-col', className)}>
      <div
        data-testid={testId}
        data-panel={panels[shown].key}
        data-panels={String(panels.length)}
        data-no-portal
        className="relative flex min-h-0 min-w-0 flex-1 flex-col"
        style={{ minHeight: box }}
      >
        <div className="absolute inset-0 flex min-h-0 flex-col justify-center overflow-hidden">
          {panels[shown].node}
        </div>
      </div>
      {/* Draws nothing for a single page -- a pager over one page is
          furniture, and `VisualPager` already refuses it. */}
      <VisualPager
        className="mt-1.5 ml-auto"
        labels={panels.map(p => p.tab)}
        keys={panels.map(p => p.key)}
        index={shown}
        onChange={onChange}
        describe={i => `Show ${panels[i].label}`}
      />
    </div>
  )
}

/**
 * The tile's price column.
 *
 * Its own component so the fetch is a hook in a child rather than a
 * conditional hook in `DecisionTile`, and so a tile with no anchor pays
 * nothing: React only mounts this where `drawsPrice` is true.
 *
 * `1Y` because a decision is usually months old and the window is trimmed to
 * the anchor inside the chart; asking for less would leave a long-held
 * position with a line that does not reach its own fill.
 */
function PriceColumn({
  symbol, anchorISO, anchorLabel, height = 92, points, isLoading, error,
}: {
  symbol: string
  /* Nullable now. The column is drawn for any single name at hero and large,
     including one with no anchor to measure from -- `TilePriceChart` already
     refuses the since-claim and renders `empty` instead, which is what the
     two COIN heroes needed. An un-anchored column is not a broken one. */
  anchorISO: string | null
  anchorLabel: string
  height?: number
  /*
   * ── The series is handed in, not fetched here ────────────────────────────
   *
   * It used to call `useDecisionTileCloses` itself. That made the chart's
   * arithmetic private to the chart, so the headline percentage in the left
   * column could disagree with the line in the right one -- and it did, by
   * three orders of magnitude, because the headline was measuring against a
   * sizing price of 100. `DecisionTile` now reads the closes once and both
   * halves measure the same rows.
   *
   * (These are `price_history_cache` closes, not `usePriceHistory`: that hook
   * calls the `yahoo-chart-proxy` edge function, a live fetch that is
   * unreachable in local development -- "network refused" in the console --
   * which is why this column rendered blank for three diagnosis passes.)
   */
  points: { date: Date; value: number }[]
  isLoading: boolean
  error: unknown
}) {
  // Reserved height either way, so the row does not resize when the series
  // lands -- the same reason `TileVisualSlot` reserves its own. And the space
  // is never simply blank: where there is nothing to draw it says so, because
  // an empty half-tile reads as a broken card rather than as missing data.
  return (
    <div data-testid="decision-price-column" data-no-portal className="min-w-0">
      {isLoading ? (
        <div style={{ height }} className="animate-pulse rounded bg-gray-100 dark:bg-white/5" />
      ) : (
        <PriceSinceFill
          points={points}
          anchorISO={anchorISO}
          anchorLabel={anchorLabel}
          height={height}
          empty={
            <div
              data-testid="decision-price-empty"
              style={{ height }}
              className="flex flex-col justify-center gap-1 rounded border border-dashed border-gray-200 px-3 text-[10px] text-gray-400 dark:border-white/10"
            >
              <span className="font-semibold uppercase tracking-[0.09em]">
                {error ? 'Prices unavailable' : 'No price history'}
              </span>
              {/*
                The reason, in the reader's terms. "No data" with no cause is
                what sent this column round three diagnosis passes -- but the
                fix for that was developer shorthand ("272 closes, first
                2025-08-18 — after this filled"), which is no more use to a
                PM looking at a tile. This says what is missing and what it
                means for the card.
              */}
              <span className="break-words">
                {error ? `Couldn't load prices for ${symbol}.`
                  : points.length === 0
                    ? `We don't hold any price history for ${symbol} yet, so there is no chart to draw.`
                    : `The prices we hold for ${symbol} start after this ${anchorLabel}, so there is nothing to measure from it.`}
              </span>
            </div>
          }
        />
      )}
    </div>
  )
}
