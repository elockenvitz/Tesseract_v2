/**
 * Desktop Decisions — one decision, revisited.
 *
 * ── The signature separation: AT DECISION vs TODAY ───────────────────────
 *
 * Two columns that never blend. The left holds only facts that were durably
 * recorded when the decision was made; the right holds current state and says
 * so in its heading. Showing today's thesis under "what we knew then" would be
 * the single most damaging thing this surface could do — it would let a reader
 * judge a past decision against information nobody had.
 *
 * So the AT DECISION column is mostly empty, and it says why. Production
 * records the actor, the date, the requested sizing, sometimes the book weight
 * and very occasionally an approval price. It does NOT record the thesis, the
 * target, the ladder or the research as they stood that day. That absence is
 * printed rather than hidden, because a reader who sees no thesis module cannot
 * otherwise tell "unchanged" from "never captured".
 *
 * ── No verdict ───────────────────────────────────────────────────────────
 *
 * Nothing here scores a decision. The price path is stated, the execution is
 * stated, the current framework is stated, and the reader draws the conclusion.
 * There is no good/bad, no hit rate, no quality grade.
 */

import { DesktopModule, DesktopSection, DesktopColumns, DeepLinks, DeepLink } from '../desktop/DesktopModule'
import { clsx } from 'clsx'
import { ArrowUpRight } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openAsset } from '../../lib/desktop-asset'
import { openIdeaDetail } from '../../lib/navigation/open-idea'
import { openTradeBookFor } from '../../lib/desktop-decisions/navigate'
import {
  outcomeOf, OUTCOME_LABEL, statusDetail, summaryOf, headline,
  provenanceOf, provable,
  daysSince, targetFor,
  type DecisionRecord,
} from '../../lib/desktop-decisions/model'
import type { DecisionDetail as Detail } from '../../hooks/useDesktopDecisions'
import { anchoredWindow, PriceSinceDecision, OUTCOME_CHIP, money } from './DecisionVisual'

/** Same untimed two-dispatch pattern Today and Portfolio use. */
function routeToResearch(assetId: string, symbol: string | null, issue: string) {
  // The case belongs to the asset, so this opens the asset. The Research lens
  // finds work; it is not a waypoint on the way to doing it.
  openAsset({ assetId, symbol, focus: 'research', issue, origin: 'decisions' })
}

/**
 * Decisions -> the idea itself: the Idea Pipeline, with the idea's detail open.
 *
 * Two earlier destinations were both wrong. It first fired an `ideas-v2` tab
 * descriptor unconditionally, which opened a SECOND Dashboard tab showing the
 * same shell. It then moved the Ideas LENS in place, which is the right
 * mechanic for crossing lenses but the wrong place for this button: the Ideas
 * lens is a gallery for finding work, and the reader who clicks "Open the
 * idea" has already found it.
 *
 * `openIdeaDetail` is the mechanism the Pipeline already consumes -- switch to
 * the `trade-queue` tab, then pop `TradeIdeaDetailModal` once it is mounted.
 * A top-level tab is correct here, because the Pipeline genuinely is a
 * different screen rather than a lens of the one the reader is on.
 *
 * The `issue` caption does not travel: the Pipeline's modal has no slot that
 * displays why the reader was sent, and inventing one is a separate decision.
 */

export function DecisionDetailPane({
  decision, detail,
}: { decision: DecisionRecord; detail: Detail | undefined }) {
  const d = decision
  const kind = outcomeOf(d.status)
  const win = anchoredWindow(detail?.history, d.decidedAt)
  const sincePct = win?.reachesAnchor ? win.changePct : null
  const target = targetFor(d, sincePct)
  const teamable = !!target && canDiscuss(target)
  const can = provable(d, detail?.priceAtDecision)
  const prov = provenanceOf(d.decisionNote)
  /*
   * The batch's "Why this decision?" (`trade_batches.description`), for a
   * decision whose own note is not a human reason. Trade Book writes the
   * rationale there, once for the batch, and a Trade Lab decision's note is
   * always system provenance -- so without this the one reason the desk wrote
   * never reached the record. Labelled as the batch's, never as this note.
   */
  const batchReason = prov !== 'human' && provenanceOf(d.batch?.description) === 'human'
    ? d.batch!.description
    : null

  // Where execution landed inside the since-decision window, as a fraction.
  const execOffset = (() => {
    if (!win?.reachesAnchor || !d.decidedAt || !d.execution?.completedAt) return null
    const a = Date.parse(d.decidedAt), b = Date.parse(d.execution.completedAt)
    if (!Number.isFinite(a) || !Number.isFinite(b) || win.days <= 0) return null
    return (b - a) / (win.days * 86_400_000)
  })()

  return (
    <div data-testid="decision-detail" className="pb-12">
      {/* header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5 dark:border-white/10 dark:bg-[#141a25]">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-2.5">
            <span className="font-black text-[30px] leading-[1.05] tracking-[-0.035em]">
              {d.symbol ?? '—'}
            </span>
            {d.action && (
              <span className="font-mono text-[13px] font-bold uppercase tracking-widest text-gray-500">
                {d.action}
              </span>
            )}
            <span className={clsx(
              'rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider',
              OUTCOME_CHIP[kind],
            )}>
              {OUTCOME_LABEL[kind]}
            </span>
            {statusDetail(d) && (
              <span className="text-[11px] text-gray-500">{statusDetail(d)}</span>
            )}
            {d.portfolioName && (
              <span className="rounded-full bg-gray-100 px-2 py-[2px] text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
                {d.portfolioName}
              </span>
            )}
          </div>
        </div>

        {/* One narrative sentence, and only one. The actor and the date live
            inside it rather than being repeated in a corner block, in At the
            decision and again in the chronology before the reader reaches
            anything substantive. */}
        <p className="mt-2.5 max-w-[84ch] text-[14px] leading-relaxed text-gray-800 dark:text-gray-200">
          {summaryOf(d)}
          {can.actorAndDate && (
            <span className="text-gray-500">
              {' '}{new Date(d.decidedAt!).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
              {daysSince(d.decidedAt) != null && `, ${daysSince(d.decidedAt)} days ago.`}
            </span>
          )}
        </p>

        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          {d.assetId && (
            <button
              type="button"
              onClick={() => routeToResearch(d.assetId!, d.symbol, headline(d))}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              Review the case today
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
            </button>
          )}
          {d.ideaId && (
            <button
              type="button"
              onClick={() => openIdeaDetail(d.ideaId!)}
              className="rounded-md px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              Open the idea
            </button>
          )}
          {target && (
            <button
              type="button"
              onClick={() => askAI(target)}
              className="rounded-md px-3 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              {/* The count that used to sit here was contextChips.length -- an
                  implementation detail. A reader saw "Ask AI 7" and could not
                  know what 7 was. Ask AI is a mode, not a metric. */}
              Ask AI
            </button>
          )}
          {teamable && (
            <>
              <span className="text-[11px] text-gray-300 dark:text-gray-700">·</span>
              <button
                type="button"
                onClick={() => discuss(target!)}
                className="rounded-md px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
              >
                Team
              </button>
            </>
          )}
          {/*
            No overflow control, for the reason ResearchDetail records at
            length: the `MoreHorizontal` button that sat here had no onClick,
            no menu state and no popover. It hovered, it focused, assistive
            tech announced it as "More actions", and clicking it did nothing.
            It was never wired, so there is no regression in removing it.

            Removed rather than filled because nothing was waiting to go in
            it. Every action this header offers already has a labelled control
            beside it, and the deep links sit at the foot of the pane. An
            overflow menu is for actions that exist and do not fit; there were
            none of either.
          */}
        </div>
      </div>

      {/*
        One lead column and one context column, like every other detail pane.

        This pane kept a bare `xl:grid-cols-2` from before `DesktopColumns`
        existed, and auto-placement did what auto-placement does: the
        deep-link row landed in a grid cell and drew at 559px, and the whole
        region was capped at 1180px inside a 1605px surface -- 473px of
        canvas, 29% of it, left empty beside a chart 92px tall. The reader's
        own column holds what they came to read; the chronology is what they
        read it against, so it sits beside rather than inside it.
      */}
      <div className="px-6 pb-10 pt-5">
        <DesktopColumns
          lead={<>
            {/* ---------------------------- why ---------------------------- */}
            {/* Adaptive: a rationale somebody wrote is the most valuable thing
                on this page and leads it. An absence is worth one line, not a
                hero box -- the first version gave "no reason was written" the
                same height as a real one, so the module that had nothing to
                say was the loudest thing in the workspace. */}
            {prov === 'human' && d.decisionNote ? (
              /* Unboxed on purpose. This is the one thing on the page somebody
                 actually wrote, and a border around it made it a panel among
                 panels rather than the reason the record exists. */
              <DesktopSection title="Why we decided" lead>
                <blockquote className="max-w-[62ch] border-l-[3px] border-gray-300 pl-5 text-[21px] font-medium leading-[1.5] tracking-[-0.01em] text-gray-900 dark:border-white/20 dark:text-gray-100">
                  “{d.decisionNote}”
                </blockquote>
                <div className="mt-3 pl-5 text-[11px] text-gray-500">
                  {d.decidedByName ?? 'Decision maker'}
                  {d.decidedAt && ` · ${new Date(d.decidedAt).toLocaleDateString()}`}
                </div>
                {d.contextNote?.trim() && <ProposalNote decision={d} />}
              </DesktopSection>
            ) : batchReason ? (
              <DesktopSection title="Why this decision?" lead>
                <blockquote
                  data-testid="decision-batch-reason"
                  className="max-w-[62ch] border-l-[3px] border-gray-300 pl-5 text-[21px] font-medium leading-[1.5] tracking-[-0.01em] text-gray-900 dark:border-white/20 dark:text-gray-100"
                >
                  “{batchReason}”
                </blockquote>
                <div className="mt-3 pl-5 text-[11px] text-gray-500">
                  Written for the batch{d.batch?.name ? ` · ${d.batch.name}` : ''}
                </div>
                {d.contextNote?.trim() && <ProposalNote decision={d} />}
              </DesktopSection>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-300 px-4 py-2.5 dark:border-white/15">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
                    Decision record
                  </span>
                  <span className="text-[12px] text-gray-600 dark:text-gray-400">
                    No human rationale was captured.
                  </span>
                  {prov === 'system' && d.decisionNote && (
                    <span className="font-mono text-[11px] text-gray-500">
                      · {d.decisionNote} <span className="font-sans">— written by the system, not a stated rationale</span>
                    </span>
                  )}
                </div>
                {d.contextNote?.trim() && <ProposalNote decision={d} compact />}
              </div>
            )}

            {/* ------------------- at decision  vs  today ------------------- */}
            {/* At the decision → what happened next → today. A temporal reading
                order, carried by placement rather than by decoration. */}
            {/* The pair stays a pair and stays capped: two four-row tables
                spread across a 2560px screen are further apart than they are
                comparable, and comparison is the only reason they sit
                together. The cap is the lead column's now, not a magic 1180. */}
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
              <DesktopModule title="At the decision" meta={d.decidedAt ? new Date(d.decidedAt).toLocaleDateString() : undefined}>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  {d.requestedByName && <Row k="Proposed by" v={d.requestedByName} />}
                  {can.requestedSizing && (
                    <Row k="Sizing requested" v={
                      d.sizingWeight != null
                        ? `${d.sizingWeight.toFixed(1)}%`
                        : `${d.sizingShares?.toLocaleString()} sh`
                    } />
                  )}
                  {can.weightAtDecision && <Row k="Weight then" v={`${d.baselineWeight!.toFixed(1)}%`} />}
                  {can.priceAtDecision && <Row k="Price then" v={money(detail!.priceAtDecision!)} />}
                  {d.deferredUntil && <Row k="Deferred until" v={new Date(d.deferredUntil).toLocaleDateString()} />}
                </dl>

                {/* The absence is still the finding, but it is a footnote now.
                    As a four-line paragraph it was the most prominent thing in
                    the column it was qualifying. */}
                <p className="mt-2.5 border-t border-gray-200 pt-2 text-[10px] leading-snug text-gray-400 dark:border-white/10 dark:text-gray-500">
                  Historical framework not captured: thesis · target · scenarios · research state
                </p>
              </DesktopModule>

              <DesktopModule title="Today" meta="current state">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
                  {detail?.currentPrice != null && <Row k="Price now" v={money(detail.currentPrice)} />}
                  {detail?.currentWeightPct != null && (
                    <Row k="Weight now" v={`${detail.currentWeightPct.toFixed(1)}%`} />
                  )}
                  {detail?.currentThesisUpdatedAt
                    ? <Row k="Thesis reviewed" v={`${daysSince(detail.currentThesisUpdatedAt)}d ago`} />
                    : <Row k="Thesis" v="none written" />}
                  {detail?.currentEvidenceCount != null && (
                    <Row k="Research on file" v={String(detail.currentEvidenceCount)} />
                  )}
                  {detail?.currentIdeaStatus && (
                    <Row k="Idea now" v={
                      detail.currentIdeaStatus.outcome
                        ? detail.currentIdeaStatus.outcome
                        : (detail.currentIdeaStatus.status ?? detail.currentIdeaStatus.stage ?? '—')
                    } />
                  )}
                </dl>
                <p className="mt-3 border-t border-gray-200 pt-2.5 text-[10px] text-gray-500 dark:border-white/10">
                  Everything in this column is the state right now, not the state
                  when the decision was made.
                </p>
              </DesktopModule>
            </div>

          </>}
          context={<>
            {/* ------------------------ what happened ------------------------ */}
            {/*
              The chart sits where Research puts its own: the context column,
              above the record's other dates. Giving it the lead column made
              it 857px wide against Research's 585 -- the same component at a
              different size on two tabs, which is the complaint this pane has
              now had twice. Same column, same width, same height, same ink.
            */}
            {win && (
              <DesktopModule title="What happened next">
                <PriceSinceDecision w={win} executedOffsetPct={execOffset} />
              </DesktopModule>
            )}
            {/*
              The chronology, out of the price module and under it.

              It was a child of `{win && ...}`, so a decision with no cached
              closes -- which is every decision taken since the cache last ran
              -- rendered no dates at all. The gap between proposing, deciding
              and executing is a fact about the record, not about the price,
              and it is now stated whether or not a line can be drawn.
            */}
            <DesktopModule title="Chronology">
              <ol data-testid="decision-chronology" className="flex flex-col gap-2.5">
                {d.requestedAt && (
                  <Event when={d.requestedAt} what={`Proposed by ${d.requestedByName ?? 'a requester'}`} />
                )}
                {d.decidedAt && (
                  <Event when={d.decidedAt} what={`${OUTCOME_LABEL[kind]}${d.decidedByName ? ` by ${d.decidedByName}` : ''}`} strong />
                )}
                {d.execution?.completedAt && (
                  <Event when={d.execution.completedAt}
                         what={`Executed${d.execution.executedByName ? ` by ${d.execution.executedByName}` : ''}`} />
                )}
                {kind === 'accepted' && !d.execution && (
                  <li className="text-[11px] text-gray-500">
                    No execution is recorded against this decision.
                  </li>
                )}
              </ol>
              {/* Decision and execution are separate facts and are never
                  presented as the same event. */}
              {d.execution && !d.execution.completedAt && (
                <p className="mt-2 text-[10px] text-gray-500">
                  An execution exists but has not completed
                  {d.execution.status ? ` (${d.execution.status})` : ''}.
                </p>
              )}
            </DesktopModule>
          </>}
        />

        <DeepLinks>
          {d.assetId && (
            <DeepLink
              label="Open full asset"
              onClick={() => routeToResearch(d.assetId!, d.symbol, headline(d))}
            />
          )}
          {d.ideaId && (
            <DeepLink label="Open idea" onClick={() => openIdeaDetail(d.ideaId!)} />
          )}
          {/*
            This said "View decision record" and dispatched a hardcoded
            `trade-queue` tab with `data: null` — so it opened the bare
            Pipeline WORKSPACE rather than any record, and it offered to do
            that even for a decision with nothing committed behind it.

            The committed record is the Trade Book entry. `openTradeBookFor`
            returns false when there is no batch and no execution, which is
            also the condition for not drawing the link at all: a click with
            nothing to open must be inert, not open an empty tab. Same rule
            DecisionTimeline settled on.
          */}
          {(d.batch?.id || d.execution?.id) && (
            <DeepLink
              label="View trade record"
              onClick={() => openTradeBookFor(d)}
            />
          )}
        </DeepLinks>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

/**
 * The requester's rationale.
 *
 * A different person, at a different time, answering a different question.
 * Kept visually separate and explicitly attributed so it can never be read as
 * the decider's reasoning -- the most tempting fabrication this surface offers.
 */
function ProposalNote({ decision, compact }: { decision: DecisionRecord; compact?: boolean }) {
  const d = decision
  return (
    <div className={clsx(
      'border-t border-gray-200 dark:border-white/10',
      compact ? 'mt-2 pt-2' : 'mt-4 pt-3',
    )}>
      <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
        Why it was proposed
      </div>
      <p className={clsx(
        'mt-1 max-w-[80ch] leading-relaxed text-gray-700 dark:text-gray-300',
        compact ? 'text-[12px]' : 'text-[13px]',
      )}>
        “{d.contextNote}”
      </p>
      <div className="mt-1 text-[10px] text-gray-500">
        Submitted by {d.requestedByName ?? 'a requester'}
        {d.requestedAt && ` · ${new Date(d.requestedAt).toLocaleDateString()}`}
        {' — the proposal rationale, not the decider’s'}
      </div>
    </div>
  )
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt className="text-gray-500">{k}</dt>
      <dd className="text-right font-mono tabular-nums text-gray-800 dark:text-gray-200">{v}</dd>
    </>
  )
}

function Event({ when, what, strong }: { when: string; what: string; strong?: boolean }) {
  return (
    <li className="flex items-baseline gap-3 text-[12px]">
      <span className="w-[62px] shrink-0 font-mono text-[11px] text-gray-500">
        {new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
      <span className={clsx(strong ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300')}>
        {what}
      </span>
    </li>
  )
}

