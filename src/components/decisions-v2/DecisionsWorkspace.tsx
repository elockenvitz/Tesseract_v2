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

import { useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, Landmark } from 'lucide-react'
import {
  useDecisionScan, usePortfoliosWithDecisions, useDecisionDetail,
} from '../../hooks/useDesktopDecisions'
import {
  outcomeOf, OUTCOME_LABEL, provenanceOf, workOf, compareWork,
  hasHumanReason, groupIntoSituations, type DecisionSituation,
  type DecisionRecord,
} from '../../lib/desktop-decisions/model'
import { DecisionDetailPane } from './DecisionDetail'
import {
  DesktopGallery, DesktopTile, TileIdentity, TileQuote, TileMeta, TileFigure,
  sizeByRecency, type TileSize,
} from '../desktop/DesktopTile'
import { EYEBROW } from '../desktop/DesktopModule'
import {
  openDashboardFocus, type RailCard,
} from '../../lib/dashboard/focus'
import { OUTCOME_INK, DecisionSize, DecisionPath, RecordGaps } from './DecisionVisual'

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
  const books = usePortfoliosWithDecisions(decisions)

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
  const inBook = useMemo(
    () => decisions.filter(d => !portfolioId || d.portfolioId === portfolioId),
    [decisions, portfolioId],
  )
  /*
   * One situation per decision ACT, not per execution leg.
   *
   * Five trades committed in one batch were one thing somebody did, so they
   * ask for one rationale. `groupIntoSituations` collapses only that case and
   * only on a real `batch_id`; everything else stays per request. Ordering is
   * applied to the situations, so a five-leg batch takes ONE position in the
   * queue rather than five -- which is the composition half of the same
   * problem.
   */
  const situations = useMemo(
    () => groupIntoSituations(inBook.slice().sort(compareWork)),
    [inBook],
  )
  const rows = useMemo(() => situations.map(s => s.lead), [situations])
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
  const selected = activeId ? inBook.find(d => d.id === activeId) ?? null : null

  // Nothing deep is fetched while browsing.
  const { detail } = useDecisionDetail(selected)

  // How many OTHER books decided the same idea.
  //
  // Derived from the rows already in hand -- no query -- and computed over the
  // unfiltered scan, because narrowing to one book must not make a
  // multi-book decision look like a single-book one.
  const booksPerIdea = useMemo(() => {
    const byIdea = new Map<string, Set<string>>()
    for (const d of decisions) {
      if (!d.ideaId) continue
      const set = byIdea.get(d.ideaId) ?? new Set<string>()
      set.add(d.portfolioId)
      byIdea.set(d.ideaId, set)
    }
    return new Map([...byIdea].map(([id, set]) => [id, set.size - 1]))
  }, [decisions])

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

  if (isLoading) return <Loading />

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

  return (
    <div className="h-full overflow-y-auto" data-testid="decisions-lens">
      <DesktopGallery
        title="Decisions"
        count={rows.length}
        flow="chronological"
        action={<BookFilter books={books} portfolioId={portfolioId} onSelect={selectBook} compact />}
        note={<>
          <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
            Decisions waiting on an answer, and decisions taken with no reason
            recorded. Longest waiting first.
          </p>
          {/* What is NOT here, said once. A queue that silently drops the
              settled record looks like a lens that lost it. */}
          {settled > 0 && (
            <p className="mt-1 text-[11px] text-gray-500">
              {settled} decided and explained {settled === 1 ? 'record is' : 'records are'}{' '}
              not listed. Nothing needs doing to {settled === 1 ? 'it' : 'them'}.
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
        {situations.map((s, i) => (
          <DecisionTile
            key={s.subject}
            decision={s.lead}
            situation={s}
            alsoInBooks={booksPerIdea.get(s.lead.ideaId ?? '') ?? 0}
            // Longest-waiting first is the order; this only decides how much
            // room each record gets, never which comes first.
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

function BookFilter({
  books, portfolioId, onSelect, compact,
}: {
  books: { id: string; name: string; count: number }[]
  portfolioId: string | null
  onSelect: (id: string | null) => void
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  // One book that has decisions is not a choice worth a control.
  if (books.length <= 1) {
    const only = books[0]?.name
    return only
      ? <span className={clsx('truncate text-gray-500', compact ? 'text-[12px] font-semibold' : 'text-[12px]')}>{only}</span>
      : null
  }

  const current = books.find(b => b.id === portfolioId)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={clsx(
          'flex min-w-0 items-center gap-1 rounded-md border border-gray-300 hover:bg-gray-100 dark:border-white/15 dark:hover:bg-white/[0.06]',
          compact ? 'px-1.5 py-0.5 text-[11px] font-semibold' : 'px-2 py-1 text-[11px]',
        )}
      >
        <span className="min-w-0 truncate">{current?.name ?? 'All portfolios'}</span>
        <ChevronDown className="h-3 w-3 shrink-0 text-gray-500" />
      </button>
      {open && (
        <div role="listbox"
             className="absolute left-0 top-full z-20 mt-1 max-h-[60vh] w-60 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-[#141a25]">
          <button type="button" role="option" aria-selected={!portfolioId}
                  onClick={() => { onSelect(null); setOpen(false) }}
                  className={clsx('block w-full px-3 py-1.5 text-left text-[12px]',
                    !portfolioId ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                 : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
            All portfolios
          </button>
          {books.map(b => (
            <button key={b.id} type="button" role="option" aria-selected={b.id === portfolioId}
                    onClick={() => { onSelect(b.id); setOpen(false) }}
                    className={clsx('flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-[12px]',
                      b.id === portfolioId ? 'bg-blue-50 font-semibold text-blue-800 dark:bg-blue-950/40 dark:text-blue-300'
                                           : 'hover:bg-gray-100 dark:hover:bg-white/[0.06]')}>
              <span className="min-w-0 flex-1 truncate">{b.name}</span>
              <span className="font-mono text-[10px] text-gray-500">{b.count}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- index */

/**
 * The outcome, as ink on the card's own ground.
 *
 * It was a rounded, filled, bordered badge on every tile -- the treatment
 * Ideas removed and Today lost with it, because a gallery of filled pills
 * reads as a queue of tagged records rather than a set of decisions somebody
 * made. Two of the five variants carried a background AND a border AND a
 * dashed border to say what the word already said.
 *
 * The distinctions survive in `OUTCOME_INK`, because telling them apart is
 * the point of this lens.
 */
function OutcomeChip({ decision, small }: { decision: DecisionRecord; small?: boolean }) {
  const kind = outcomeOf(decision.status)
  return (
    <span className={clsx(
      'font-medium uppercase tracking-[0.08em]',
      small ? 'text-[9px]' : 'text-[10px]',
      OUTCOME_INK[kind],
    )}>
      {OUTCOME_LABEL[kind]}
    </span>
  )
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
  decision, situation, alsoInBooks, bandSize, onOpen,
}: {
  decision: DecisionRecord
  /** The decision act this card stands for. One leg, or a whole batch. */
  situation: DecisionSituation
  alsoInBooks: number
  /** Where this record sits in the chronology. Never a judgement of it. */
  bandSize: TileSize
  onOpen: () => void
}) {
  const d = decision
  const outcome = outcomeOf(d.status)
  /** Which of the two jobs this card is here for. */
  const work = workOf(d)
  /** More than one execution leg under one committed act. */
  const batched = situation.batch != null && situation.legs.length > 1
  const when = d.decidedAt ?? d.requestedAt
  const humanReason = provenanceOf(d.decisionNote) === 'human' ? d.decisionNote : null
  const proposedReason = !humanReason && provenanceOf(d.contextNote) === 'human' ? d.contextNote : null

  /**
   * Size is recency, and content is memory richness.
   *
   * The newest record leads and history gets denser behind it -- what a
   * newspaper does with today's front page and last week's briefs. Because the
   * order is fixed and the largest card is always first, a two-row block
   * leaves no hole and nothing has to be reordered to make the page work.
   *
   * Size is never a judgement: accepted is not success, withdrawn is not
   * failure, and a bigger card must never read as a better decision. What
   * varies WITHIN a size is how much the record actually remembers -- a
   * written reason where one exists, the shape of the trade where it does not.
   */
  const size = bandSize

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
        <OutcomeChip decision={d} small />
        {d.action && (
          <span className="font-mono text-[10px] font-bold uppercase tracking-wider text-gray-500">
            {d.action}
          </span>
        )}
        <TileFigure>{when ? shortDate(when) : '—'}</TileFigure>
      </>}
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
        <TileIdentity symbol={d.symbol} name={d.companyName} size={size} />
      )}

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

            <ul data-testid="batch-legs" className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1">
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
      {batched ? null : humanReason ? (
        <TileQuote size={size}>{humanReason}</TileQuote>
      ) : proposedReason ? (
        <div>
          <div className={EYEBROW}>Why it was proposed</div>
          <p className="mt-0.5 line-clamp-3 text-[12px] leading-snug text-gray-700 dark:text-gray-300">
            {proposedReason}
          </p>
        </div>
      ) : (
        /* Nothing was written either way. The shape of the trade is the whole
           of what this record remembers, so it is stated once, plainly, rather
           than narrated back as a sentence. */
        <TileShape decision={d} />
      )}

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
      {work === 'explain' ? (
        <div className="mt-1">
          <RecordGaps
            requested={d.requestedAt != null}
            sized={d.sizingWeight != null || d.sizingShares != null}
            decided={d.decidedAt != null}
            explained={provenanceOf(d.decisionNote) === 'human'}
            // Only outcomes that call for a trade have an execution to miss.
            executed={outcome === 'accepted' ? d.execution?.completedAt != null : null}
            compact={size === 'compact'}
          />
        </div>
      ) : d.sizingWeight != null ? (
        <div className="mt-1">
          <DecisionSize
            from={d.baselineWeight}
            to={d.sizingWeight}
            requestedAt={d.requestedAt}
            decidedAt={d.decidedAt}
            open={outcome === 'open'}
            compact={size === 'compact'}
          />
        </div>
      ) : (
        /*
          No size was asked for, so there is no quantity to draw -- but the
          wait is a fact and it is the whole complaint on a card nobody has
          answered. The lifecycle draws it, and draws the execution legs too
          where the record has them.
        */
        <div className="mt-1">
          <DecisionPath
            requestedAt={d.requestedAt}
            decidedAt={d.decidedAt}
            executedAt={d.execution?.completedAt ?? null}
            resolved={outcome !== 'open'}
          />
        </div>
      )}

      <TileMeta>
        <span className="font-medium text-gray-600 dark:text-gray-400">{d.portfolioName ?? '—'}</span>
        {d.decidedByName && <span>{d.decidedByName}</span>}
        {/* One idea decided in several books is a fact about the desk, not
            about this row -- and it is the reason two near-identical tiles are
            not a duplicate. */}
        {alsoInBooks > 0 && (
          <span>also decided in {alsoInBooks} other book{alsoInBooks === 1 ? '' : 's'}</span>
        )}
        {outcome === 'accepted' && (
          <span className={d.execution?.completedAt
            ? 'font-semibold text-gray-700 dark:text-gray-300'
            : 'text-gray-500'}>
            {d.execution?.completedAt ? 'Executed' : d.execution ? 'Execution open' : 'Never executed'}
          </span>
        )}
      </TileMeta>
    </DesktopTile>
  )
}

/**
 * What was actually asked for, against what the book already held.
 *
 * The one durable quantity on a decision with no written reason. Both halves
 * are shown only where both were recorded -- a sizing with no baseline is a
 * number with nothing to read it against, and inventing the baseline from
 * today's book would date the wrong fact to the wrong day.
 */
function TileShape({ decision: d }: { decision: DecisionRecord }) {
  const size = d.sizingWeight != null ? `${d.sizingWeight.toFixed(1)}%`
    : d.sizingShares != null ? `${d.sizingShares.toLocaleString()} sh`
    : null

  if (!size) {
    return (
      <p className="text-[12px] italic leading-snug text-gray-500">
        No reason and no sizing were recorded with this decision.
      </p>
    )
  }

  return (
    <div className="flex items-baseline gap-2">
      <span className="font-mono text-[19px] font-semibold leading-none tabular-nums">{size}</span>
      <span className="text-[11px] leading-tight text-gray-600 dark:text-gray-400">
        {d.baselineWeight != null
          ? <>asked for, against {d.baselineWeight.toFixed(1)}% then held</>
          : <>asked for</>}
      </span>
    </div>
  )
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: '2-digit' })

/* ------------------------------------------------------------------ states */

function Loading() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <div className="h-8 w-40 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      <div className="mt-5 grid grid-cols-1 gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map(i => (
          <div key={i} className="h-48 animate-pulse rounded-xl border border-gray-200 bg-white dark:border-white/[0.08] dark:bg-[#141a25]" />
        ))}
      </div>
    </div>
  )
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
