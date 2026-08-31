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

import { clsx } from 'clsx'
import { ArrowUpRight, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openResearch, researchTabFor } from '../../lib/desktop-research'
import { openIdea, ideasTabFor } from '../../lib/desktop-ideas'
import {
  outcomeOf, OUTCOME_LABEL, statusDetail, summaryOf, headline,
  provenanceOf, reasonLabel, provable, NOT_RECORDED_AT_DECISION,
  daysSince, targetFor,
  type DecisionRecord,
} from '../../lib/desktop-decisions/model'
import type { DecisionDetail as Detail } from '../../hooks/useDesktopDecisions'
import { windowSinceDecision, PriceSinceDecision, OUTCOME_CHIP, money } from './DecisionVisual'

/** Same untimed two-dispatch pattern Today and Portfolio use. */
function routeToResearch(assetId: string, issue: string) {
  const request = { assetId, focus: 'thesis' as const, issue, origin: 'decisions' }
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: researchTabFor(request) }))
  openResearch(request)
}

function routeToIdea(ideaId: string, issue: string) {
  const request = { ideaId, focus: 'decision' as const, issue, origin: 'decisions' }
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: ideasTabFor(request) }))
  openIdea(request)
}

export function DecisionDetailPane({
  decision, detail,
}: { decision: DecisionRecord; detail: Detail | undefined }) {
  const d = decision
  const kind = outcomeOf(d.status)
  const win = windowSinceDecision(detail?.history, d.decidedAt)
  const sincePct = win?.reachesDecision ? win.changePct : null
  const target = targetFor(d, sincePct)
  const teamable = !!target && canDiscuss(target)
  const can = provable(d, detail?.priceAtDecision)
  const prov = provenanceOf(d.decisionNote)

  // Where execution landed inside the since-decision window, as a fraction.
  const execOffset = (() => {
    if (!win?.reachesDecision || !d.decidedAt || !d.execution?.completedAt) return null
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
              <span className="font-mono text-[13px] font-bold uppercase tracking-[0.08em] text-gray-500">
                {d.action}
              </span>
            )}
            <span className={clsx(
              'rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em]',
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
          <div className="ml-auto text-right text-[11.5px] text-gray-500">
            {can.actorAndDate ? (
              <>
                <div className="font-semibold text-gray-800 dark:text-gray-200">{d.decidedByName}</div>
                <div>
                  {new Date(d.decidedAt!).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}
                  {daysSince(d.decidedAt) != null && ` · ${daysSince(d.decidedAt)}d ago`}
                </div>
              </>
            ) : (
              <div>No decision recorded yet</div>
            )}
          </div>
        </div>

        <p className="mt-3 max-w-[84ch] text-[13px] text-gray-700 dark:text-gray-300">{summaryOf(d)}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          {d.assetId && (
            <button
              type="button"
              onClick={() => routeToResearch(d.assetId!, headline(d))}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              Review the case today
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
            </button>
          )}
          {d.ideaId && (
            <button
              type="button"
              onClick={() => routeToIdea(d.ideaId!, headline(d))}
              className="rounded-md px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              Open the idea
            </button>
          )}
          {target && (
            <button
              type="button"
              onClick={() => askAI(target)}
              className="inline-flex items-baseline gap-1.5 rounded-md px-3 py-2 text-[12.5px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              Ask AI
              <span className="font-mono text-[10.5px] opacity-75">{target.contextChips?.length ?? 0}</span>
            </button>
          )}
          {teamable && (
            <>
              <span className="text-[11px] text-gray-300 dark:text-gray-700">·</span>
              <button
                type="button"
                onClick={() => discuss(target!)}
                className="rounded-md px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
              >
                Team
              </button>
            </>
          )}
          <button type="button" aria-label="More actions"
                  className="ml-auto grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ---------------------------- why ---------------------------- */}
      <div className="px-6 pt-4">
        <Module title="Why" span>
          {prov === 'human' && d.decisionNote ? (
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
                {reasonLabel('human')}
              </div>
              <blockquote className="mt-1 border-l-2 border-gray-300 pl-3 text-[13.5px] italic leading-relaxed text-gray-800 dark:border-white/20 dark:text-gray-200">
                “{d.decisionNote}”
              </blockquote>
              <div className="mt-1 text-[10.5px] text-gray-500">
                {d.decidedByName ?? 'Decision maker'}
                {d.decidedAt && ` · ${new Date(d.decidedAt).toLocaleDateString()}`}
              </div>
            </div>
          ) : (
            <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
              No reason was written when this decision was recorded.
            </p>
          )}

          {/* The requester's rationale is a different claim by a different
              person at a different time, and is labelled as such. */}
          {d.contextNote?.trim() && (
            <div className="mt-3.5 border-t border-gray-200 pt-3 dark:border-white/10">
              <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
                Why it was proposed
              </div>
              <p className="mt-1 max-w-[84ch] text-[12.5px] leading-relaxed text-gray-700 dark:text-gray-300">
                {d.contextNote}
              </p>
              <div className="mt-1 text-[10.5px] text-gray-500">
                {d.requestedByName ?? 'Requester'}
                {d.requestedAt && ` · ${new Date(d.requestedAt).toLocaleDateString()}`}
                {' — the submission rationale, not the decision’s'}
              </div>
            </div>
          )}

          {/* System provenance is shown, but never as reasoning. */}
          {prov === 'system' && d.decisionNote && (
            <div className="mt-3.5 border-t border-gray-200 pt-3 dark:border-white/10">
              <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
                {reasonLabel('system')}
              </div>
              <p className="mt-1 font-mono text-[11.5px] text-gray-500">{d.decisionNote}</p>
              <p className="mt-1 text-[10.5px] text-gray-500">
                Written by the system to record how this was resolved. Not a stated rationale.
              </p>
            </div>
          )}
        </Module>
      </div>

      {/* ------------------- at decision  vs  today ------------------- */}
      <div className="grid grid-cols-1 gap-3.5 px-6 pt-3.5 xl:grid-cols-2">
        <Module title="At the decision" meta={d.decidedAt ? new Date(d.decidedAt).toLocaleDateString() : undefined}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
            {can.actorAndDate && <Row k="Decided by" v={d.decidedByName ?? '—'} />}
            {d.requestedByName && <Row k="Requested by" v={d.requestedByName} />}
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

          {/* The absence is the finding. Printing it stops a reader assuming
              the framework simply did not change. */}
          <div className="mt-3 border-t border-gray-200 pt-2.5 dark:border-white/10">
            <p className="text-[10.5px] leading-relaxed text-gray-500">
              Not captured at decision time:{' '}
              {NOT_RECORDED_AT_DECISION.join(', ')}. Those exist only in their
              current form, shown alongside — they are not what was known that day.
            </p>
          </div>
        </Module>

        <Module title="Today" meta="current state">
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
          <p className="mt-3 border-t border-gray-200 pt-2.5 text-[10.5px] text-gray-500 dark:border-white/10">
            Everything in this column is the state right now, not the state when
            the decision was made.
          </p>
        </Module>

        {/* ------------------------ what happened ------------------------ */}
        {win && (
          <Module title="What happened next" span>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <PriceSinceDecision w={win} executedOffsetPct={execOffset} />
              <div>
                <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">Chronology</div>
                <ol className="mt-1.5 flex flex-col gap-2">
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
                    <li className="text-[11.5px] text-gray-500">
                      No execution is recorded against this decision.
                    </li>
                  )}
                </ol>
                {/* Decision and execution are separate facts and are never
                    presented as the same event. */}
                {d.execution && !d.execution.completedAt && (
                  <p className="mt-2 text-[10.5px] text-gray-500">
                    An execution exists but has not completed
                    {d.execution.status ? ` (${d.execution.status})` : ''}.
                  </p>
                )}
              </div>
            </div>
          </Module>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

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
    <li className="flex items-baseline gap-2 text-[11.5px]">
      <span className="w-[64px] shrink-0 font-mono text-[10.5px] text-gray-500">
        {new Date(when).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
      <span className={clsx(strong ? 'font-semibold text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300')}>
        {what}
      </span>
    </li>
  )
}

function Module({
  title, meta, span, children,
}: { title: string; meta?: string; span?: boolean; children: React.ReactNode }) {
  return (
    <section className={clsx(
      'overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-[#141a25]',
      span && 'xl:col-span-2',
    )}>
      <div className="flex items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-4 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500">{title}</h3>
        {meta && <span className="ml-auto text-[10.5px] text-gray-500">{meta}</span>}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}
