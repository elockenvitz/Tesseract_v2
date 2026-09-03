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

import {
  DesktopModule, DesktopStat, DesktopSection, DesktopColumns, DeepLinks, DeepLink,
} from '../desktop/DesktopModule'
import { ArrowRight, ArrowUpRight, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openAsset } from '../../lib/desktop-asset'
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
function routeToResearch(assetId: string, symbol: string | null, issue: string) {
  // Straight to the asset, which is where the evidence lives. Routing through
  // the Research lens first would put the reader in a gallery they did not
  // ask for, only to forward them to this same destination.
  openAsset({ assetId, symbol, focus: 'research', issue, origin: 'ideas' })
}
import {
  MATURITY_LABEL,
  primaryActionFor, targetFor, issueFor,
  type IdeaEnrichment, type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { openAnchor } from './IdeaCard'
import { RangeChart, SinceOpen } from './IdeaVisuals'
import { DecisionModule } from './DecisionModule'
import { dispatchDecisionAction } from '../../engine/decisionEngine/dispatchDecisionAction'
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
  const target = targetFor(idea, detail)
  const hasResearch = useHasResearch(idea.assetId)
  // Whether a decision can actually be completed here is a fact about the
  // portfolio tracks, so the verb is decided by the data, not by the stage.
  const { canDecide, pending } = useIdeaDecision(idea.id)
  const primary = primaryActionFor(idea, detail, canDecide)
  const issue = issueFor(idea, detail)
  const teamable = !!target && canDiscuss(target)

  /**
   * The framework, in the shape the card's own primitive takes.
   *
   * Same three rungs, same requirement that all of them plus a recent price
   * exist -- so the workspace can never draw a band the card would have
   * refused to draw.
   */
  const rung = (n: string) => detail?.ladder?.cases.find(c => c.name === n)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull'), base = rung('Base')
  const range = bear != null && bull != null && detail?.spot != null
    ? { bear, bull, base, spot: detail.spot }
    : null

  /**
   * The price the idea was written at.
   *
   * `openAnchor` is the card's rule, imported rather than restated: an
   * explicit snapshot, else the last close the author could have seen, else a
   * close just after it marked approximate, else nothing. A performance panel
   * measured from a different origin than the card's would be two answers to
   * one question.
   */
  const anchor = openAnchor(idea.createdAt, detail?.history)

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
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              {primary}
              <ArrowRight className="h-3.5 w-3.5 opacity-70" />
            </button>
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
          {/* A belief is worth checking against the evidence behind it -- but
              only where there IS evidence. `useHasResearch` reads the same
              population the Research workspace renders, so the action can
              never promise a case that does not exist. Withheld entirely while
              that population is still loading. */}
          {hasResearch === true && idea.assetId && (
            <button
              type="button"
              onClick={() => routeToResearch(idea.assetId!, idea.symbol, `${idea.symbol ?? 'Idea'} — ${MATURITY_LABEL[idea.maturity]}`)}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
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
                className="rounded-md px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
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

      {/*
        The analytical region.

        Belief and framework lead, because the reader came to judge a claim.
        The decision, the exposure and the people sit beside it as the context
        that claim is judged in -- not stacked underneath it, which is what
        left half this page empty on a wide screen.
      */}
      <div className="px-6 pb-10 pt-5">
        <DesktopColumns
          lead={<>
            {/* Prose does not want a box. This is the object itself, so it
                gets the page's lead type and the room to be read. */}
            <DesktopSection
              id="the-claim"
              title="The claim"
              meta={idea.stage ?? undefined}
              lead
              focused={focus === 'thesis'}
            >
              {idea.thesis ? (
                <p className="max-w-[74ch] text-[15px] leading-[1.6] text-gray-900 dark:text-gray-100">
                  {idea.thesis}
                </p>
              ) : (
                <p className="max-w-[70ch] text-[13px] italic text-gray-500">
                  No claim written yet — that is what this idea is waiting on.
                </p>
              )}
              <div className="mt-4 max-w-md">
                <EvolutionStrip idea={idea} />
              </div>
            </DesktopSection>

            {/*
              Framework and performance are two questions, so they are two
              sections.

              `familyFor` picks ONE family, richest first, which is right for a
              card that has a single visual slot. Applied here it meant an idea
              with a ladder was `scenario` and never showed its price at all —
              so entering through the price chart foregrounded the framework,
              and the performance intent had nothing of its own to land on.
              Each panel now renders when its OWN data exists, the way the card
              chooses its primitives.

              Both draw the CARD's primitives at workspace scale rather than a
              second chart implementation. `RangeChart` here is the same
              component the card uses — same band, same rose out-of-range
              zones, same spot chip, the same hoverable Bear/Base/Bull — so the
              framework a reader inspected on the card is literally the
              framework they arrive at, larger. The chart this replaces drew a
              red-to-green gradient, which also broke the colour rule the cards
              hold to: green is not "good", and a price is not a grade.

              Unboxed, like the claim above them. A hairline and a heading are
              the enclosure; the accent on the section a reader asked for is
              what makes it findable.
            */}
            {range && (
              <DesktopSection
                id="framework"
                title="Framework"
                meta={`${detail!.ladder!.cases.length} cases`}
                focused={focus === 'framework'}
              >
                <div className="max-w-[720px]">
                  <RangeChart range={range} size="lg" />
                </div>
              </DesktopSection>
            )}

            {anchor && detail?.spot != null && (
              <DesktopSection
                id="performance"
                title="Performance"
                meta={`since raised${anchor.approximate ? ' · approx' : ''}`}
                focused={focus === 'performance'}
              >
                <div className="max-w-[720px]">
                  <SinceOpen
                    series={detail.history ?? []}
                    anchor={anchor}
                    spot={detail.spot}
                    size="lg"
                  />
                </div>
              </DesktopSection>
            )}
          </>}

          context={<>
            {/* The decision is a bounded interaction with real consequences,
                so it keeps its chrome even in the context column. */}
            {canDecide && (
              <DesktopModule
                title="Decision"
                meta={`${pending.length} awaiting`}
                focused={focus === 'decision'}
                moduleKey="decision"
              >
                <DecisionModule ideaId={idea.id} assetId={idea.assetId} />
              </DesktopModule>
            )}

            {/*
              A user sent here to decide, on an idea with no portfolio track,
              needs to be told why they cannot -- silence reads as a broken
              button. `trade_idea_portfolios` is populated by the Trade Lab
              flow, so ideas that reached `deciding` another way carry no track
              and no production service can decide them.
            */}
            {!canDecide && (idea.maturity === 'deciding' || idea.maturity === 'decision_ready') && (
              <DesktopSection id="decision" title="Decision">
                {/* What the reader can DO, not why the schema says no. The
                    old copy explained portfolio decision tracks to a portfolio
                    manager, which is a database describing itself. */}
                <p className="text-[13px] text-gray-800 dark:text-gray-200">
                  Add this idea to a portfolio before recording a decision.
                </p>
                <DeepLink
                  label="Open idea"
                  onClick={() => window.dispatchEvent(new CustomEvent('decision-engine-action', {
                    detail: { id: 'trade-queue', title: 'Pipeline', type: 'trade-queue', data: null },
                  }))}
                />
              </DesktopSection>
            )}

            {/*
              What is actually being proposed.

              A decision workspace has to state the trade before it can help
              anyone judge it: which way, in which book, at what size, against
              what is already held. This was spread across a header pill, a
              metadata module and the reader's memory.
            */}
            <DesktopSection title="Proposal">
              <div className="flex flex-wrap items-baseline gap-x-8 gap-y-3">
                <Kv
                  label="Direction"
                  value={idea.direction ? idea.direction.toUpperCase() : 'Not stated'}
                />
                <Kv label="Book" value={idea.portfolioName ?? 'Not assigned'} />
                <Kv
                  label="Proposed size"
                  value={idea.proposedWeight != null ? `${idea.proposedWeight.toFixed(1)}%` : '—'}
                />
                <Kv
                  label="Held today"
                  value={detail?.weightPct != null ? `${detail.weightPct.toFixed(1)}%` : '—'}
                />
              </div>
              {idea.proposedWeight != null && detail?.weightPct != null && (
                <p className="mt-2.5 text-[12px] text-gray-600 dark:text-gray-400">
                  {idea.proposedWeight > detail.weightPct
                    ? `Adds ${(idea.proposedWeight - detail.weightPct).toFixed(1)}% to the book.`
                    : idea.proposedWeight < detail.weightPct
                      ? `Reduces the book by ${(detail.weightPct - idea.proposedWeight).toFixed(1)}%.`
                      : 'Holds the position where it is.'}
                </p>
              )}

              {/*
                A proposal with no size is a question, not a statement.

                This block reported "Proposed size —, Held today —" and left it
                there. Neither dash is a fact about the investment; both mean
                nobody has sized this yet, and sizing happens in Trade Lab. The
                route is the product's own, carrying the asset, so nothing is
                invented — the panel now names what is missing and offers the
                place it gets filled in.
              */}
              {idea.proposedWeight == null && idea.assetId && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className="text-[12px] text-gray-500">
                    No size proposed yet.
                  </p>
                  <button
                    type="button"
                    data-testid="proposal-size"
                    onClick={() => dispatchDecisionAction(
                      'OPEN_TRADE_LAB_SIMULATION', { assetId: idea.assetId },
                    )}
                    className="rounded-md border border-gray-300 px-2.5 py-1 text-[12px] font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:border-white/15 dark:text-gray-200 dark:hover:bg-white/5"
                  >
                    Size it in Trade Lab
                  </button>
                </div>
              )}
            </DesktopSection>

            {detail?.weightPct != null && (
              <DesktopSection title="Position today">
                <div className="flex flex-wrap gap-x-7 gap-y-3">
                  <Kv label="Weight" value={`${detail.weightPct.toFixed(1)}%`} />
                  {detail.marketValue != null && (
                    <Kv label="Value" value={`$${(detail.marketValue / 1e6).toFixed(2)}m`} />
                  )}
                  {idea.proposedWeight != null && (
                    <Kv label="Proposed" value={`${idea.proposedWeight.toFixed(1)}%`} />
                  )}
                </div>
                <p className="mt-2.5 text-[10px] text-gray-500">
                  {idea.portfolioName ? `${idea.portfolioName}. ` : ''}
                  No policy limit is recorded for this position.
                </p>
              </DesktopSection>
            )}

            {/* One number and one sentence. It was a bordered card. */}
            {detail?.researchCount ? (
              <DesktopSection title="Research">
                <p className="text-[12px] text-gray-700 dark:text-gray-300">
                  <span className="font-mono text-[15px] font-semibold">{detail.researchCount}</span>
                  {' '}linked document{detail.researchCount === 1 ? '' : 's'} on this name.
                </p>
              </DesktopSection>
            ) : null}

            {/*
              Provenance, compressed to one line.

              This was a module: four key-values plus a paragraph explaining
              how Team works. None of it helps a reader decide whether to sell
              DASH, and it was taking the canvas the decision needed. Team is
              an action and lives in the header.
            */}
            <p className="text-[11px] text-gray-500">
              Raised by {idea.authorName ?? 'unknown'}
              {idea.stage && ` · ${idea.stage}`}
              {idea.urgency && ` · ${idea.urgency}`}
              {idea.decisionOutcome && ` · ${idea.decisionOutcome}`}
            </p>
          </>}
        />

        <DeepLinks>
          {idea.assetId && (
            <DeepLink
              label="Open full asset"
              onClick={() => routeToResearch(idea.assetId!, idea.symbol, `${idea.symbol ?? 'Idea'} — ${MATURITY_LABEL[idea.maturity]}`)}
            />
          )}
          <DeepLink
            label="Open idea"
            onClick={() => window.dispatchEvent(new CustomEvent('decision-engine-action', {
              detail: { id: 'trade-queue', title: 'Pipeline', type: 'trade-queue', data: null },
            }))}
          />
        </DeepLinks>
      </div>
    </div>
  )
}

/* ----------------------------------------------------------------- pieces */



function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-widest text-gray-500">{label}</div>
      <div className="mt-0.5 font-mono text-[14px] font-semibold tabular-nums">{value}</div>
    </div>
  )
}
