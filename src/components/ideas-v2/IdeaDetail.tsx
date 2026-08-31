/**
 * Desktop Ideas — the selected Idea's workspace.
 *
 * Somewhere an investor could spend twenty minutes. Meaningfully richer than
 * the scan tile, using width for evidence rather than for whitespace.
 *
 * ── Modules appear because there is something to say ──────────────────────
 *
 * Every module below is conditional on its own real data. A prototype-shaped
 * grid of empty cards would look complete and tell the reader nothing, so an
 * Idea with no ladder shows no framework module, an Idea with no linked notes
 * shows no research module, and an Idea with neither is a thesis and a header —
 * which is an honest picture of an early Idea.
 *
 * ── What is deliberately NOT here ─────────────────────────────────────────
 *
 * No activity timeline. There is not yet one durable record spanning human
 * comments, AI analysis, structured changes and decisions, and inventing a
 * second one inside Ideas is exactly what the pane audit warned against. The
 * evolution strip shows what `updated_at` can prove and stops there.
 */

import { clsx } from 'clsx'
import { ArrowRight, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import {
  familyFor, primaryActionFor, targetFor, issueFor,
  type IdeaEnrichment, type IdeaRow,
} from '../../lib/desktop-ideas'
import { IdeaVisual } from './IdeaVisual'
import {
  DirectionPill, MaturityPill, ConvictionPill, IdeaIdentity, EvolutionStrip,
} from './IdeaChrome'

export function IdeaDetail({ idea, detail }: { idea: IdeaRow; detail: IdeaEnrichment | undefined }) {
  const family = familyFor(idea, detail)
  const target = targetFor(idea, detail)
  const primary = primaryActionFor(idea, detail)
  const issue = issueFor(idea, detail)
  const teamable = !!target && canDiscuss(target)

  const hasVisual = family === 'scenario' || family === 'target' || family === 'performance'

  return (
    <div data-testid="idea-detail" className="pb-12">
      {/* header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5 dark:border-white/10 dark:bg-[#141a25]">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <IdeaIdentity symbol={idea.symbol} company={idea.companyName} size="lg" />
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <DirectionPill direction={idea.direction} />
            <MaturityPill maturity={idea.maturity} />
            <ConvictionPill conviction={idea.conviction} />
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {detail?.spot != null && <Stat value={detail.spot.toFixed(2)} label="Spot" />}
            {detail?.target != null && <Stat value={detail.target.toFixed(2)} label="Target" />}
            {detail?.weightPct != null && (
              <Stat value={`${detail.weightPct.toFixed(1)}%`} label="Weight" />
            )}
            {idea.proposedWeight != null && (
              <Stat value={`${idea.proposedWeight.toFixed(1)}%`} label="Proposed" />
            )}
          </div>
        </div>

        {/* why now */}
        <p className="mt-3 max-w-[80ch] text-[13px] text-gray-700 dark:text-gray-300">
          <span className="font-semibold">{issue}.</span>{' '}
          {idea.authorName && <span className="text-gray-500">Raised by {idea.authorName}. </span>}
          {idea.portfolioName && <span className="text-gray-500">{idea.portfolioName}.</span>}
        </p>

        {/* actions */}
        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          {primary && (
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              {primary}
              <ArrowRight className="h-3.5 w-3.5 opacity-70" />
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
          <button
            type="button"
            aria-label="More actions"
            className="ml-auto grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* modules */}
      <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 xl:grid-cols-2">
        <Module title="Thesis" meta={idea.stage ?? undefined} span>
          {idea.thesis ? (
            <p className="max-w-[80ch] text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">
              {idea.thesis}
            </p>
          ) : (
            <p className="text-[12.5px] italic text-gray-500">
              No thesis has been written yet. That is the work this idea is waiting on.
            </p>
          )}
          <div className="mt-3 max-w-md">
            <EvolutionStrip idea={idea} />
          </div>
        </Module>

        {hasVisual && (
          <Module
            title={family === 'scenario' ? 'Framework' : family === 'target' ? 'Target' : 'Performance'}
          >
            <IdeaVisual idea={idea} detail={detail} family={family} height={80} />
          </Module>
        )}

        {detail?.weightPct != null && (
          <Module title="Portfolio">
            <div className="flex flex-wrap gap-x-7 gap-y-3">
              <Kv label="Weight" value={`${detail.weightPct.toFixed(1)}%`} />
              {detail.marketValue != null && (
                <Kv label="Value" value={`$${(detail.marketValue / 1e6).toFixed(2)}m`} />
              )}
              {idea.proposedWeight != null && (
                <Kv label="Proposed" value={`${idea.proposedWeight.toFixed(1)}%`} />
              )}
              {idea.portfolioName && <Kv label="Portfolio" value={idea.portfolioName} />}
            </div>
            <p className="mt-2.5 text-[10.5px] text-gray-500">
              No policy limit is recorded for this position.
            </p>
          </Module>
        )}

        {detail?.researchCount ? (
          <Module title="Research">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[19px] font-semibold">{detail.researchCount}</span>
              <span className="text-[12px] text-gray-500">
                linked document{detail.researchCount === 1 ? '' : 's'} on this name
              </span>
            </div>
          </Module>
        ) : null}

        <Module title="Team">
          <div className="flex flex-wrap gap-x-7 gap-y-3">
            <Kv label="Raised by" value={idea.authorName ?? 'unknown'} />
            <Kv label="Stage" value={idea.stage ?? '—'} />
            {idea.urgency && <Kv label="Urgency" value={idea.urgency} />}
            {idea.decisionOutcome && <Kv label="Outcome" value={idea.decisionOutcome} />}
          </div>
          <p className="mt-2.5 text-[10.5px] text-gray-500">
            {teamable
              ? 'Team opens a thread attached to this idea, so anyone joining later sees what prompted it.'
              : 'This object cannot hold a thread yet.'}
          </p>
        </Module>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- pieces */

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <span className="block font-mono text-[16px] font-semibold tabular-nums tracking-tight">{value}</span>
      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.07em] text-gray-500">
        {label}
      </span>
    </div>
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

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
