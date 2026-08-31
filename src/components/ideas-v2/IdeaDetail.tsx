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

import { DesktopModule, DesktopStat } from '../desktop/DesktopModule'
import { clsx } from 'clsx'
import { ArrowRight, ArrowUpRight, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openResearch, researchTabFor } from '../../lib/desktop-research'
import { useHasResearch } from '../../hooks/useDesktopResearch'

/**
 * Ideas → Research.
 *
 * Belief and evidence are two halves of one question, and until now there was
 * no way to cross between them: a reader looking at a thesis-forming idea had
 * to leave the workspace to see what the firm actually knows about the name.
 *
 * Same untimed two-dispatch pattern Today, Portfolio and Decisions use -- the
 * tab descriptor opens or focuses the one fixed Research tab, the typed event
 * re-selects inside a tab already mounted, and whichever applies the other is a
 * no-op.
 */
function routeToResearch(assetId: string, issue: string) {
  const request = { assetId, focus: 'evidence' as const, issue, origin: 'ideas' }
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: researchTabFor(request) }))
  openResearch(request)
}
import {
  MATURITY_LABEL,
  familyFor, primaryActionFor, targetFor, issueFor,
  type IdeaEnrichment, type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { IdeaVisual } from './IdeaVisual'
import { DecisionModule } from './DecisionModule'
import { useIdeaDecision } from '../../hooks/useIdeaDecision'
import {
  DirectionPill, MaturityPill, ConvictionPill, IdeaIdentity, EvolutionStrip,
} from './IdeaChrome'

export function IdeaDetail({
  idea, detail, focus, arrivedFor,
}: {
  idea: IdeaRow
  detail: IdeaEnrichment | undefined
  /** Which module the caller wanted attention on. */
  focus?: IdeaFocus | null
  /** The issue that sent the user here, preserved so it is not lost in transit. */
  arrivedFor?: string | null
}) {
  const family = familyFor(idea, detail)
  const target = targetFor(idea, detail)
  const hasResearch = useHasResearch(idea.assetId)
  // Whether a decision can actually be completed here is a fact about the
  // portfolio tracks, so the verb is decided by the data, not by the stage.
  const { canDecide, pending } = useIdeaDecision(idea.id)
  const primary = primaryActionFor(idea, detail, canDecide)
  const issue = issueFor(idea, detail)
  const teamable = !!target && canDiscuss(target)

  const hasVisual = family === 'scenario' || family === 'target' || family === 'performance'

  return (
    <div data-testid="idea-detail" className="pb-12">
      {/*
        Why the user was sent here.
        Today is a jumping-off surface, so the triggering issue has to survive
        the jump — landing on the right object with no memory of why is the
        rediscovery this rule exists to prevent.
      */}
      {arrivedFor && (
        <div className="border-b border-blue-200 bg-blue-50 px-6 py-2 text-[12px] text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
          <span className="font-semibold">Opened from Today:</span> {arrivedFor}
        </div>
      )}

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
            {detail?.spot != null && <DesktopStat value={detail.spot.toFixed(2)} label="Spot" />}
            {detail?.target != null && <DesktopStat value={detail.target.toFixed(2)} label="Target" />}
            {detail?.weightPct != null && (
              <DesktopStat value={`${detail.weightPct.toFixed(1)}%`} label="Weight" />
            )}
            {idea.proposedWeight != null && (
              <DesktopStat value={`${idea.proposedWeight.toFixed(1)}%`} label="Proposed" />
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
              onClick={() => {
                if (canDecide) {
                  document.querySelector('[data-module="decision"]')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              }}
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
              className="rounded-md px-3 py-2 text-[12.5px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              Ask AI
            </button>
          )}
          {/* A belief is worth checking against the evidence behind it -- but
              only where there IS evidence. `useHasResearch` reads the same
              population the Research workspace renders, so the action can
              never promise a case that does not exist. Withheld entirely while
              that population is still loading. */}
          {hasResearch === true && idea.assetId && (
            <button
              type="button"
              onClick={() => routeToResearch(idea.assetId!, `${idea.symbol ?? 'Idea'} — ${MATURITY_LABEL[idea.maturity]}`)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              Check the evidence
              <ArrowUpRight className="h-3 w-3 opacity-70" />
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
        {/* The decision leads when there is one to make — it is the work. */}
        {canDecide && (
          <DesktopModule
            title="Decision"
            meta={`${pending.length} awaiting`}
            span
            focused={focus === 'decision'}
            moduleKey="decision"
          >
            <DecisionModule ideaId={idea.id} />
          </DesktopModule>
        )}

        <DesktopModule title="Thesis" meta={idea.stage ?? undefined} span focused={focus === 'thesis'}>
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
        </DesktopModule>

        {hasVisual && (
          <DesktopModule
            title={family === 'scenario' ? 'Framework' : family === 'target' ? 'Target' : 'Performance'}
            focused={focus === 'framework' || focus === 'performance'}
          >
            <IdeaVisual idea={idea} detail={detail} family={family} height={80} />
          </DesktopModule>
        )}

        {detail?.weightPct != null && (
          <DesktopModule title="Portfolio" focused={focus === 'portfolio'}>
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
          </DesktopModule>
        )}

        {detail?.researchCount ? (
          <DesktopModule title="Research" focused={focus === 'research'}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-[19px] font-semibold">{detail.researchCount}</span>
              <span className="text-[12px] text-gray-500">
                linked document{detail.researchCount === 1 ? '' : 's'} on this name
              </span>
            </div>
          </DesktopModule>
        ) : null}

        {/*
          A user sent here to decide, on an idea with no portfolio track, needs
          to be told why they cannot -- silence reads as a broken button.
          `trade_idea_portfolios` is populated by the Trade Lab flow, so ideas
          that reached `deciding` another way carry no track and no production
          service can decide them.
        */}
        {!canDecide && (idea.maturity === 'deciding' || idea.maturity === 'decision_ready') && (
          <DesktopModule title="Decision" span focused={focus === 'decision'} moduleKey="decision">
            <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
              This idea has no portfolio decision track, so a decision cannot be
              recorded from here. Decisions attach to a portfolio, and this idea
              reached its stage without one being created.
            </p>
            <p className="mt-1.5 text-[11px] text-gray-500">
              The Idea Pipeline remains the place to resolve it.
            </p>
          </DesktopModule>
        )}

        <DesktopModule title="Team" focused={focus === 'team'}>
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
        </DesktopModule>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- pieces */



function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-[0.08em] text-gray-500">{label}</div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
