/**
 * Desktop Portfolio — the selected position.
 *
 * Answers, in order: why look at this now, how big is it, what does the
 * framework say, what does the case say, and who is already working on it.
 *
 * ── Portfolio routes, it does not duplicate ───────────────────────────────
 *
 * The thesis is shown as two lines and a date, never as an editor: Research
 * owns authoring, and it can now complete it. The idea is shown as a state,
 * never as a decision form: Ideas V2 owns that. Both are reached through the
 * typed seams those stages built -- a tab descriptor to open or focus the one
 * fixed tab, plus the typed event to re-select inside a tab already mounted.
 * Neither is timed, and neither invents a second navigation system.
 *
 * ── Position identity is (asset, portfolio) ───────────────────────────────
 *
 * AAPL is 25.3% of Large Cap Growth and 4.0% of Vision Fund 5K. Every number
 * on this page belongs to the selected book. The other books that hold the
 * name are listed, but WITHOUT a weight -- a weight needs that book's NAV, and
 * showing this one's percentage under another one's name is precisely the
 * error the two-level identity exists to prevent.
 */

import { DesktopModule, DesktopStat } from '../desktop/DesktopModule'
import { clsx } from 'clsx'
import { ArrowUpRight, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openResearch, researchTabFor, type ResearchFocus } from '../../lib/desktop-research'
import { openIdea, ideasTabFor } from '../../lib/desktop-ideas'
import {
  gapOf, toneForGap, whyItMatters, primaryActionFor, targetFor, GAP_LABEL,
  type PositionFrame,
} from '../../lib/desktop-portfolio/model'
import { TONE_PILL, TONE_ACCENT } from '../../lib/semantic-tone'
import { SECTION_LABEL, CORE_SECTIONS } from '../../lib/desktop-research'
import { unrealised, type Position } from '../../lib/portfolio/holdings'
import type { PositionDetail as Detail } from '../../hooks/useDesktopPortfolio'
import { FrameworkScale, WeightBar, money, bigMoney } from './PortfolioVisual'

/**
 * Open another workspace on this object.
 *
 * Two dispatches, neither timed: the tab descriptor opens or focuses the one
 * fixed tab and carries the selection in its data, and the typed event
 * re-selects inside a tab that is already mounted. Whichever applies, the
 * other is a no-op. Exactly the pattern Today uses.
 */
function routeToResearch(assetId: string, focus: ResearchFocus, issue: string) {
  const request = { assetId, focus, issue, origin: 'portfolio' }
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: researchTabFor(request) }))
  openResearch(request)
}

function routeToIdea(ideaId: string, issue: string) {
  const request = { ideaId, focus: 'decision' as const, issue, origin: 'portfolio' }
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: ideasTabFor(request) }))
  openIdea(request)
}

export function PositionDetailPane({
  position, frame, detail, portfolioName, role, maxWeight,
}: {
  position: Position
  frame: PositionFrame
  detail: Detail | undefined
  portfolioName: string | null
  role: 'pm' | 'analyst' | null
  maxWeight: number
}) {
  const gap = gapOf(position, frame)
  const action = primaryActionFor(position, frame)
  const target = position.isCash ? null : targetFor(position, frame, portfolioName ?? undefined)
  const teamable = !!target && canDiscuss(target)
  const pnl = unrealised(position)

  const core = (detail?.sections ?? []).filter(s => (CORE_SECTIONS as readonly string[]).includes(s.section))

  const runPrimary = () => {
    if (action.route === 'research') {
      routeToResearch(
        position.assetId,
        gap === 'no-framework' ? 'thesis' : gap === 'evidence-since' ? 'evidence' : 'thesis',
        GAP_LABEL[gap],
      )
    } else if (action.route === 'ideas' && frame.liveIdea) {
      routeToIdea(frame.liveIdea.id, GAP_LABEL[gap])
    }
  }

  return (
    <div data-testid="position-detail" className="pb-12">
      {/* header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5 dark:border-white/10 dark:bg-[#141a25]">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-black text-[30px] leading-[1.05] tracking-[-0.035em]">
              {position.symbol ?? '—'}
            </span>
            {position.companyName && (
              <span className="truncate text-[13px] font-medium text-gray-500">{position.companyName}</span>
            )}
            {portfolioName && (
              <span className="rounded-full bg-gray-100 px-2 py-[2px] text-[10px] font-semibold text-gray-600 dark:bg-white/10 dark:text-gray-300">
                {portfolioName}
              </span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            <DesktopStat value={`${position.weightPct.toFixed(1)}%`} label="Weight" />
            <DesktopStat value={bigMoney(position.marketValue)} label="Market value" />
            {position.price > 0 && <DesktopStat value={money(position.price)} label="Spot" />}
            {frame.daysSinceReview != null && (
              <DesktopStat value={`${frame.daysSinceReview}d`} label="Last review" />
            )}
          </div>
        </div>

        <div className={clsx(
          'mt-3 max-w-[84ch] border-l-2 pl-3',
          TONE_ACCENT[toneForGap(gap)],
        )}>
          <span className={clsx(
            'inline-block rounded-full border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.06em]',
            TONE_PILL[toneForGap(gap)],
          )}>
            {GAP_LABEL[gap]}
          </span>
          <p className="mt-1.5 text-[13px] text-gray-700 dark:text-gray-300">
            {whyItMatters(position, frame)}
          </p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          {action.route ? (
            <button
              type="button"
              onClick={runPrimary}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              {action.label}
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
            </button>
          ) : (
            // Cash has no case to open and no idea to decide. Naming the work
            // beats a button that would land nowhere.
            <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-[13px] text-gray-600 dark:border-white/20 dark:text-gray-400">
              <strong className="font-semibold text-gray-800 dark:text-gray-200">{action.label}</strong>
              <span className="text-[11.5px]">— an allocation question, not a position one</span>
            </span>
          )}
          {target && (
            <button
              type="button"
              onClick={() => askAI(target)}
              className="rounded-md px-3 py-2 text-[12.5px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              Ask AI
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

      <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 xl:grid-cols-2">
        {/* The framework leads whenever there is one: it is the only module
            that can contradict the position. */}
        {frame.ladder?.valid && position.price > 0 && (
          <DesktopModule title="Framework" span>
            <FrameworkScale ladder={frame.ladder} spot={position.price} />
          </DesktopModule>
        )}

        <DesktopModule title="Size">
          <WeightBar weightPct={position.weightPct} max={maxWeight} label="Weight in this book" />
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[11.5px]">
            <Row k="Shares" v={position.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
            <Row k="Market value" v={bigMoney(position.marketValue)} />
            {position.avgCost != null && <Row k="Average cost" v={money(position.avgCost)} />}
            {/* Unrealised against average cost, and named as such. This is not
                portfolio P&L: there is no realised leg, no flows and no
                cost-basis lots anywhere in the model. */}
            {pnl && (
              <Row
                k="Unrealised"
                v={`${pnl.gain >= 0 ? '+' : ''}${bigMoney(pnl.gain)} (${pnl.pct >= 0 ? '+' : ''}${pnl.pct.toFixed(1)}%)`}
                tone={pnl.gain >= 0 ? 'up' : 'down'}
              />
            )}
            {position.asOf && <Row k="Book as of" v={new Date(position.asOf).toLocaleDateString()} />}
          </div>
          {!pnl && !position.isCash && (
            <p className="mt-2 text-[10.5px] text-gray-500">
              No average cost on record, so no unrealised figure is shown.
            </p>
          )}
        </DesktopModule>

        <DesktopModule title="The case" meta={frame.daysSinceReview != null ? `reviewed ${frame.daysSinceReview}d ago` : undefined}>
          {core.length > 0 ? (
            <>
              <div className="flex flex-col gap-2.5">
                {core.map(s => (
                  <div key={s.section}>
                    <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
                      {SECTION_LABEL[s.section] ?? s.section}
                    </div>
                    <p className="mt-0.5 line-clamp-3 max-w-[70ch] text-[12.5px] leading-snug text-gray-800 dark:text-gray-200">
                      {s.content || <span className="italic text-gray-500">Empty.</span>}
                    </p>
                  </div>
                ))}
              </div>
              <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 text-[11px] text-gray-500">
                <span>{frame.evidenceCount} research item{frame.evidenceCount === 1 ? '' : 's'}</span>
                {frame.newEvidence > 0 && (
                  <span className="font-semibold text-amber-700 dark:text-amber-400">
                    {frame.newEvidence} since the last review
                  </span>
                )}
              </div>
            </>
          ) : (
            <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
              No core thesis has been written for {position.symbol ?? 'this name'}.
              {frame.evidenceCount > 0 && ` ${frame.evidenceCount} research item${frame.evidenceCount === 1 ? '' : 's'} exist${frame.evidenceCount === 1 ? 's' : ''} against it.`}
            </p>
          )}
          {!position.isCash && (
            <button
              type="button"
              onClick={() => routeToResearch(position.assetId, 'thesis', GAP_LABEL[gap])}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              Open in Research
              <ArrowUpRight className="h-3 w-3" />
            </button>
          )}
        </DesktopModule>

        {frame.liveIdea && (
          <DesktopModule title="Idea">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className={clsx(
                'rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-[0.06em]',
                // An outstanding decision is work, not a break.
                TONE_PILL[frame.liveIdea.awaitingDecision ? 'review' : 'neutral'],
              )}>
                {frame.liveIdea.action ?? 'idea'}
              </span>
              <span className="text-[12.5px] text-gray-700 dark:text-gray-300">
                {frame.liveIdea.awaitingDecision
                  ? 'Awaiting a decision on this book.'
                  : 'Recorded against this book; no decision outstanding.'}
              </span>
            </div>
            {/* Authority is read, never assumed: only a PM on THIS book can
                decide, and offering the verb to anyone else is a promise the
                permission layer will refuse. */}
            <button
              type="button"
              onClick={() => routeToIdea(frame.liveIdea!.id, GAP_LABEL[gap])}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              {role === 'pm' && frame.liveIdea.awaitingDecision ? 'Decide in Ideas' : 'Open in Ideas'}
              <ArrowUpRight className="h-3 w-3" />
            </button>
            {role !== 'pm' && frame.liveIdea.awaitingDecision && (
              <p className="mt-1 text-[10.5px] text-gray-500">
                Only a portfolio manager on this book can record the decision.
              </p>
            )}
          </DesktopModule>
        )}

        {detail?.alsoHeldIn.length ? (
          <DesktopModule title="Also held in">
            <div className="flex flex-col gap-1">
              {detail.alsoHeldIn.map(o => (
                <div key={o.portfolioId} className="flex items-baseline gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{o.portfolioName}</span>
                  <span className="font-mono text-[11px] text-gray-500">
                    {o.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} sh
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10.5px] text-gray-500">
              Share counts only. A weight belongs to a book's own market value, so
              this book's percentage is not shown against another book's name.
            </p>
          </DesktopModule>
        ) : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function Row({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <>
      <span className="text-gray-500">{k}</span>
      <span className={clsx(
        'text-right font-mono tabular-nums',
        tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'down' && 'text-rose-600 dark:text-rose-400',
      )}>{v}</span>
    </>
  )
}


