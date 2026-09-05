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

import {
  DesktopModule, DesktopSection, DesktopColumns, DeepLinks, DeepLink,
  MetricStrip, Metric, Exists, EYEBROW,
} from '../desktop/DesktopModule'
import { openAsset } from '../../lib/desktop-asset'
import { clsx } from 'clsx'
import { ArrowUpRight, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openResearch, researchTabFor, type ResearchFocus } from '../../lib/desktop-research'
import { openIdea, ideasTabFor } from '../../lib/desktop-ideas'
import {
  gapOf, toneForGap, whyItMatters, primaryActionFor, targetFor, GAP_LABEL,
  type PositionFrame,
} from '../../lib/desktop-portfolio/model'
import { TONE_PILL } from '../../lib/semantic-tone'
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

  /**
   * How far outside the case spot actually sits.
   *
   * Stated, never left for the reader to compute from three prices on a
   * scale. Only where a valid ladder and a real price exist AND spot is
   * genuinely outside -- a position inside its case has no distance to state.
   */
  const breakBy = (() => {
    const rung = (n: string) => frame.ladder?.cases.find(c => c.name === n)?.price ?? null
    const bear = rung('Bear'), bull = rung('Bull'), spot = position.price
    if (!frame.ladder?.valid || !(spot > 0)) return null
    if (bear != null && spot < bear) {
      return { value: `${(((bear - spot) / bear) * 100).toFixed(1)}%`, label: 'below bear case' }
    }
    if (bull != null && spot > bull) {
      return { value: `${(((spot - bull) / bull) * 100).toFixed(1)}%`, label: 'above bull case' }
    }
    return null
  })()

  return (
    <div data-testid="position-detail" className="pb-12">
      {/* header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5 dark:border-white/10 dark:bg-[#141a25]">
        {/*
          Identity, then the finding, then the size that makes it matter.

          The four bordered stat boxes that used to sit here said Weight,
          Market value, Spot and Last review in identical chrome, so the one
          number that explains why the reader is here -- 28.2% of a book with
          no written case -- had exactly the same visual weight as the price.
          The finding leads now, and the figures support it in a strip.
        */}
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-black text-[30px] leading-[1.05] tracking-[-0.035em]">
            {position.symbol ?? '—'}
          </span>
          {position.companyName && (
            <span className="truncate text-[13px] font-medium text-gray-500">{position.companyName}</span>
          )}
          {portfolioName && (
            <span className="text-[12px] text-gray-500">· {portfolioName}</span>
          )}
        </div>

        <h2 className={clsx(
          'mt-2 text-[21px] font-semibold tracking-[-0.015em]',
          toneForGap(gap) === 'critical' ? 'text-rose-700 dark:text-rose-400'
            : toneForGap(gap) === 'review' ? 'text-amber-800 dark:text-amber-400'
            : 'text-gray-900 dark:text-gray-100',
        )}>
          {GAP_LABEL[gap]}
        </h2>
        <p className="mt-1 max-w-[80ch] text-[13px] text-gray-600 dark:text-gray-400">
          {whyItMatters(position, frame)}
        </p>

        {/* An issue-specific strip, not four identical boxes. */}
        <MetricStrip>
          <Metric value={`${position.weightPct.toFixed(1)}%`} label="of this book" lead />
          <Metric value={bigMoney(position.marketValue)} label="market value" />
          {position.price > 0 && <Metric value={money(position.price)} label="spot" />}
          {breakBy && (
            <Metric value={breakBy.value} label={breakBy.label} tone="critical" />
          )}
          {frame.daysSinceReview != null && (
            <Metric value={`${frame.daysSinceReview}d`} label="since the case" />
          )}
          {core.length === 0 && (
            <Metric value={String(frame.evidenceCount)} label="research on file" />
          )}
        </MetricStrip>

        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          {action.route ? (
            <button
              type="button"
              onClick={runPrimary}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              {action.label}
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
            </button>
          ) : (
            // Cash has no case to open and no idea to decide. Naming the work
            // beats a button that would land nowhere.
            <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-[13px] text-gray-600 dark:border-white/20 dark:text-gray-400">
              <strong className="font-semibold text-gray-800 dark:text-gray-200">{action.label}</strong>
              <span className="text-[11px]">— an allocation question, not a position one</span>
            </span>
          )}
          {target && (
            <button
              type="button"
              onClick={() => askAI(target)}
              className="rounded-md px-3 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
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
                className="rounded-md px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
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

      {/*
        The analytical region.

        The case and the framework lead: they are the only things here that can
        contradict the position. Size, other books and any outstanding idea are
        what the reader checks the case AGAINST, so they sit beside it rather
        than under it -- which is what left the right half of this page blank.
      */}
      <div className="px-6 pb-10 pt-5">
        <DesktopColumns
          lead={<>
            {/* The one module that can say the position is wrong. It keeps its
                chrome, and on a broken framework it is the loudest object on
                the page. */}
            {frame.ladder?.valid && position.price > 0 && (
              <DesktopModule
                title="Framework"
                meta={breakBy ? `${breakBy.value} ${breakBy.label}` : 'spot inside the case'}
              >
                <FrameworkScale ladder={frame.ladder} spot={position.price} />
                {breakBy && (
                  <p className="mt-3 text-[12px] text-rose-700 dark:text-rose-400">
                    Spot is <span className="font-semibold">{breakBy.value}</span> {breakBy.label}.
                    The desk wrote that range; price has left it.
                  </p>
                )}
              </DesktopModule>
            )}

            <DesktopSection
              title="The case"
              lead
              meta={frame.daysSinceReview != null ? `reviewed ${frame.daysSinceReview}d ago` : undefined}
              action={!position.isCash ? (
                <button
                  type="button"
                  onClick={() => routeToResearch(position.assetId, 'thesis', GAP_LABEL[gap])}
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                >
                  Open in Research
                  <ArrowUpRight className="h-3 w-3" />
                </button>
              ) : undefined}
            >
              {core.length > 0 ? (
                <>
                  <div className="flex flex-col gap-3.5">
                    {core.map(s => (
                      <div key={s.section}>
                        <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
                          {SECTION_LABEL[s.section] ?? s.section}
                        </div>
                        <p className="mt-1 line-clamp-4 max-w-[74ch] text-[13px] leading-[1.6] text-gray-900 dark:text-gray-100">
                          {s.content || <span className="italic text-gray-500">Empty.</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex flex-wrap items-baseline gap-x-3 text-[11px] text-gray-500">
                    <span>{frame.evidenceCount} research item{frame.evidenceCount === 1 ? '' : 's'}</span>
                    {frame.newEvidence > 0 && (
                      <span className="font-semibold text-amber-700 dark:text-amber-400">
                        {frame.newEvidence} since the last review
                      </span>
                    )}
                  </div>
                </>
              ) : (
                /*
                  The absence, made specific.

                  "No core thesis has been written" is one sentence and it left
                  the rest of the canvas empty, which is the wrong answer to a
                  28% position. What is missing is named section by section,
                  and what DOES exist is named beside it -- because a name with
                  six research items and no case is a different problem from one
                  with nothing at all.
                */
                <div className="max-w-[74ch]">
                  <p className="text-[15px] leading-relaxed text-gray-900 dark:text-gray-100">
                    No thesis on file for {position.symbol ?? 'this name'} — and {position.weightPct.toFixed(1)}%
                    of the book sits behind it.
                  </p>

                  <div className="mt-5 grid gap-x-10 gap-y-5 sm:grid-cols-2">
                    <div>
                      <div className={EYEBROW}>What is missing</div>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {(CORE_SECTIONS as readonly string[]).map(k => (
                          <li key={k} className="flex items-baseline gap-2 text-[12px]">
                            <span className="text-gray-800 dark:text-gray-200">
                              {SECTION_LABEL[k] ?? k}
                            </span>
                            <span className="ml-auto font-mono text-gray-300 dark:text-gray-600">—</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <div className={EYEBROW}>What does exist</div>
                      <ul className="mt-1.5 flex flex-col gap-1 text-[12px]">
                        <Exists
                          label="Research on file"
                          value={frame.evidenceCount ? `${frame.evidenceCount}` : null}
                        />
                        <Exists
                          label="Shares held"
                          value={position.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                        />
                        <Exists label="Market value" value={bigMoney(position.marketValue)} />
                        <Exists
                          label="Other books"
                          value={detail?.alsoHeldIn.length ? `${detail.alsoHeldIn.length}` : null}
                        />
                        <Exists
                          label="Open idea"
                          value={frame.liveIdea ? (frame.liveIdea.action ?? 'yes') : null}
                        />
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </DesktopSection>
          </>}

          context={<>
            {/*
              Exposure, without repeating the headline.

              Weight, market value and spot are already in the metric strip
              above; printing them again in a bordered Size module turned the
              Dashboard into the Position page. What stays is what the strip
              cannot show -- where this line sits against the rest of the book,
              and the cost basis behind it.
            */}
            <DesktopSection title="Exposure">
              <WeightBar weightPct={position.weightPct} max={maxWeight} label="Against the largest position" />
              <div className="mt-3 flex flex-col gap-1.5 text-[11px]">
                <Row k="Shares" v={position.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
                {position.avgCost != null && <Row k="Average cost" v={money(position.avgCost)} />}
                {/* Unrealised against average cost, and named as such. This is
                    not portfolio P&L: there is no realised leg, no flows and no
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
                <p className="mt-2 text-[10px] text-gray-500">
                  No average cost on file, so no unrealised figure.
                </p>
              )}
            </DesktopSection>

            {frame.liveIdea && (
              <DesktopSection title="Outstanding idea">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className={clsx(
                    'rounded-full border px-2 py-[3px] text-[10px] font-bold uppercase tracking-wider',
                    // An outstanding decision is work, not a break.
                    TONE_PILL[frame.liveIdea.awaitingDecision ? 'review' : 'neutral'],
                  )}>
                    {frame.liveIdea.action ?? 'idea'}
                  </span>
                  <span className="text-[12px] text-gray-700 dark:text-gray-300">
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
                  className="mt-2.5 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
                >
                  {role === 'pm' && frame.liveIdea.awaitingDecision ? 'Decide in Ideas' : 'Open in Ideas'}
                  <ArrowUpRight className="h-3 w-3" />
                </button>
                {role !== 'pm' && frame.liveIdea.awaitingDecision && (
                  <p className="mt-1 text-[10px] text-gray-500">
                    Only a portfolio manager on this book can record the decision.
                  </p>
                )}
              </DesktopSection>
            )}

            {detail?.alsoHeldIn.length ? (
              <DesktopSection title="Also held in">
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
                <p className="mt-2 text-[10px] text-gray-500">
                  Share counts only. A weight belongs to a book's own market value, so
                  this book's percentage is not shown against another book's name.
                </p>
              </DesktopSection>
            ) : null}
          </>}
        />

        <DeepLinks>
          <DeepLink
            label="Open full asset"
            onClick={() => openAsset({
              assetId: position.assetId,
              symbol: position.symbol,
              companyName: position.companyName,
              focus: 'position',
              portfolioId: position.portfolioId,
              portfolioName,
              issue: { title: GAP_LABEL[gap], detail: whyItMatters(position, frame) },
              origin: 'portfolio',
            })}
          />
          <DeepLink
            label="Open portfolio"
            onClick={() => window.dispatchEvent(new CustomEvent('open-portfolio', {
              detail: { portfolioId: position.portfolioId, name: portfolioName },
            }))}
          />
        </DeepLinks>
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


