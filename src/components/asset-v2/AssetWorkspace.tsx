/**
 * PARKED / EXPERIMENTAL — not reachable, and not the canonical Asset page.
 *
 * ── Status ───────────────────────────────────────────────────────────────
 *
 * This was briefly the default renderer for every desktop asset tab. That was
 * the wrong product call: the existing Asset page is the canonical deep asset
 * workspace, and convergence was only ever about stopping Research and
 * Portfolio growing DUPLICATE deep surfaces beside it -- not about replacing a
 * page that already holds workflow, lists, estimates, consensus, projects and
 * activity with a reduced one.
 *
 * Nothing renders this today, and a convergence test keeps it that way. It is
 * kept because several pieces are worth moving INTO the Asset page later: the
 * new-since-the-case module, the anchored price visual, the corrected position
 * context, the framework-gap semantics and the Ask AI context construction.
 * Do not wire it back in as a page.
 *
 * ── Why it was written this way ──────────────────────────────────────────
 *
 * Stage 2D0 found the case, the evidence, the framework and the position
 * implemented three times over: on the Asset page, in Research detail and in
 * Portfolio position detail. Research detail even mounted the Asset page's own
 * thesis editor, which is as close to a proof of duplication as code gets.
 *
 * Research and Portfolio remain lenses -- they find an asset worth working on.
 * This is where the work happens, and it is one page, not four.
 *
 * ── One page that adapts, never a sub-navigation ─────────────────────────
 *
 * The legacy Asset page has a Research / Workflow / Decisions / Lists tab bar
 * inside a tab. Reproducing that would rebuild the problem. `focus` reorders
 * this page and decides what is worth fetching; it never hides a section
 * behind a tab the reader has to find.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * No ranking across assets -- that is what the lenses are for, and a page
 * about one object has no business ordering the others. No decision-making:
 * the Decision Inbox decides, Decision Memory remembers, and this shows what
 * happened and hands off. No idea workspace: an idea is its own object.
 */

import { useMemo } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, MoreHorizontal, PencilLine, X } from 'lucide-react'
import { askAI, discuss, canDiscuss, type EngagementTarget } from '../../lib/engagement'
import {
  useAssetWorkspace, primaryPosition, otherPositions,
  type AssetPosition,
} from '../../hooks/useAssetWorkspace'
import {
  type AssetFocus, ORIGIN_NAME, issueTitle, issueDetail,
} from '../../lib/desktop-asset'
import { ideasTabFor } from '../../lib/desktop-ideas'
import {
  CORE_SECTIONS, SECTION_LABEL, STATE_LABEL, stateOf,
  type ResearchSubject,
} from '../../lib/desktop-research'
import { toneForGap, GAP_LABEL, type GapState } from '../../lib/desktop-portfolio/model'
import { TONE_PILL, type SemanticTone } from '../../lib/semantic-tone'
import {
  DesktopModule, DesktopSection, DesktopColumns, DesktopStat, EYEBROW,
} from '../desktop/DesktopModule'
import { FrameworkScale, WeightBar, money, bigMoney } from '../portfolio-v2/PortfolioVisual'
import { anchoredWindow, PriceSinceReview } from '../research-v2/ResearchVisual'
import { ThesisContainer } from '../contributions'
import { useState } from 'react'

export interface AssetWorkspaceProps {
  asset: { id: string; symbol?: string | null; company_name?: string | null } & Record<string, any>
  focus?: AssetFocus | null
  portfolioId?: string | null
  portfolioName?: string | null
  issue?: any
  origin?: string | null
  /** Quiet escape to the 4,300-line legacy page, for what V1 has not absorbed. */
  onOpenLegacy?: () => void
}

/** Ideas is a separate object; this is the typed hop, not an embedded workspace. */
function routeToIdea(ideaId: string, issue: string) {
  window.dispatchEvent(new CustomEvent('decision-engine-action', {
    detail: ideasTabFor({ ideaId, issue }),
  }))
}

export function AssetWorkspacePane({
  asset, focus, portfolioId, portfolioName, issue, origin, onOpenLegacy,
}: AssetWorkspaceProps) {
  const activeFocus: AssetFocus = focus ?? 'overview'
  const symbol = asset.symbol ?? null
  const { data, isLoading } = useAssetWorkspace(asset.id, symbol, activeFocus)
  const [editing, setEditing] = useState(false)

  const core = data.sections.filter(s => (CORE_SECTIONS as readonly string[]).includes(s.section))
  const peripheral = data.sections.filter(s => !(CORE_SECTIONS as readonly string[]).includes(s.section))
  const newEvidence = data.evidence.filter(e => e.isNewSinceReview)
  const priorEvidence = data.evidence.filter(e => !e.isNewSinceReview)

  const position = primaryPosition(data.positions, portfolioId ?? null)
  const others = otherPositions(data.positions, position)
  const maxWeight = data.positions.reduce((m, p) => Math.max(m, p.weightPct ?? 0), 0)

  // The review clocks, on the same model Research's lens uses, so the tile a
  // reader clicked and the page they land on cannot disagree.
  const subject = useMemo<ResearchSubject>(() => ({
    assetId: asset.id,
    symbol,
    companyName: asset.company_name ?? null,
    thesisUpdatedAt: data.caseWrittenAt,
    daysSinceReview: data.caseWrittenAt ? daysSince(data.caseWrittenAt) : null,
    sectionCount: data.sections.length,
    coreSectionCount: core.length,
    coreSections: data.coreSections,
    evidenceCount: data.evidence.length,
    newestEvidenceAt: data.evidence[0]?.createdAt ?? null,
    newSinceReview: newEvidence.length,
    weightPct: position?.weightPct ?? undefined,
  }), [asset.id, symbol, asset.company_name, data, core.length, newEvidence.length, position])

  const state = stateOf(subject)
  const gap = gapFor(data, position)
  const window = anchoredWindow(data.history, data.caseWrittenAt)

  const target = buildTarget({
    asset, symbol, focus: activeFocus, position, portfolioName, issue, origin, state, gap,
    newSince: newEvidence.length, spot: data.spot,
  })
  const teamable = canDiscuss(target)

  if (isLoading) return <Skeleton />

  /* ------------------------------------------------------------- sections */

  const theCase = (
    <DesktopSection
      key="case"
      id="the-case"
      title="The case"
      lead
      meta={subject.daysSinceReview != null ? `written ${subject.daysSinceReview}d ago` : 'never written'}
      action={
        <button
          type="button"
          onClick={() => setEditing(v => !v)}
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold',
            editing
              ? 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]'
              : 'text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30',
          )}
        >
          {editing
            ? <><X className="h-3 w-3" />Done editing</>
            : <><PencilLine className="h-3 w-3" />{core.length ? 'Edit' : 'Write the case'}</>}
        </button>
      }
    >
      {editing ? (
        <>
          {/* The canonical contribution editor, mounted -- not reimplemented.
              There is one thesis data model and one mutation path, and this
              workspace uses them rather than growing a second. */}
          <ThesisContainer assetId={asset.id} />
          {peripheral.length > 0 && (
            <div className="mt-4 border-t border-gray-200 pt-3 dark:border-white/10">
              <div className={EYEBROW}>Also on record</div>
              {peripheral.map(sec => (
                <p key={sec.section} className="mt-1.5 text-[12px] text-gray-600 dark:text-gray-400">
                  <span className="font-semibold">{SECTION_LABEL[sec.section] ?? sec.section}:</span>{' '}
                  {sec.content}
                </p>
              ))}
              <p className="mt-1.5 text-[10.5px] text-gray-500">
                Supporting sections sit outside the core case and do not move the review date.
              </p>
            </div>
          )}
        </>
      ) : core.length > 0 ? (
        <div className="flex flex-col gap-4">
          {core.map(sec => (
            <div key={sec.section}>
              <div className={EYEBROW}>{SECTION_LABEL[sec.section] ?? sec.section}</div>
              <p className="mt-1 max-w-[74ch] whitespace-pre-line text-[14px] leading-[1.65] text-gray-900 dark:text-gray-100">
                {sec.content || <span className="italic text-gray-500">Empty.</span>}
              </p>
              {sec.supportingDetail && (
                <p className="mt-1.5 max-w-[74ch] text-[12.5px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {sec.supportingDetail}
                </p>
              )}
              <div className="mt-1 text-[10.5px] text-gray-500">
                {sec.authorName ? `${sec.authorName} · ` : ''}
                {new Date(sec.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
          {peripheral.length > 0 && (
            <p className="text-[11px] text-gray-500">
              {peripheral.length} supporting section{peripheral.length === 1 ? '' : 's'} also on record.
            </p>
          )}
        </div>
      ) : (
        /* The absence IS the finding, and it is stated at the size of one.
           A bordered empty card made "nothing is written" look like content. */
        <div className="max-w-[70ch]">
          <p className="text-[15px] leading-relaxed text-gray-900 dark:text-gray-100">
            No core investment case has been written for {symbol ?? 'this name'}.
          </p>
          <p className="mt-1.5 text-[12.5px] text-gray-600 dark:text-gray-400">
            {data.evidence.length > 0
              ? `${data.evidence.length} research item${data.evidence.length === 1 ? '' : 's'} exist${data.evidence.length === 1 ? 's' : ''} against it`
              : 'No research is on record either'}
            {peripheral.length > 0 && `, and ${peripheral.length} supporting section${peripheral.length === 1 ? '' : 's'} ${peripheral.length === 1 ? 'is' : 'are'} written`}
            {position?.weightPct != null && `, and the book holds ${position.weightPct.toFixed(1)}% of its value in it`}.
          </p>
        </div>
      )}
    </DesktopSection>
  )

  const framework = data.ladder?.valid && data.spot != null ? (
    <DesktopModule key="framework" title="Framework" meta="the ladder, against today">
      <FrameworkScale ladder={data.ladder} spot={data.spot} />
    </DesktopModule>
  ) : null

  const arrival = newEvidence.length > 0 ? (
    <DesktopModule
      key="arrival"
      id="new-since-review"
      title="New since the case was written"
      meta={`${newEvidence.length} item${newEvidence.length === 1 ? '' : 's'}`}
    >
      <div className="flex flex-col gap-2">
        {newEvidence.slice(0, 8).map(e => <EvidenceRow key={e.id} item={e} isNew />)}
      </div>
      <p className="mt-2.5 text-[10.5px] text-gray-500">
        Dated after the case was last written. Whether each supports or
        challenges it is not recorded — that is the review.
      </p>
    </DesktopModule>
  ) : null

  const priceSince = window ? (
    <DesktopModule key="price" title="Price">
      <PriceSinceReview w={window} />
    </DesktopModule>
  ) : null

  const positionModule = position ? (
    <DesktopModule
      key="position"
      title={portfolioId ? `Position · ${position.portfolioName}` : 'Largest position'}
      meta={position.asOf ? `as of ${new Date(position.asOf).toLocaleDateString()}` : undefined}
    >
      {position.weightPct != null ? (
        <WeightBar weightPct={position.weightPct} max={maxWeight} label={`Weight in ${position.portfolioName}`} />
      ) : (
        <p className="text-[11.5px] text-gray-500">
          This book&apos;s market value could not be derived, so no weight is shown.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-1.5 text-[11.5px]">
        <Row k="Shares" v={position.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} />
        <Row k="Market value" v={bigMoney(position.marketValue)} />
        {position.avgCost != null && <Row k="Average cost" v={money(position.avgCost)} />}
        {position.unrealisedGain != null && (
          <Row
            k="Unrealised"
            v={`${position.unrealisedGain >= 0 ? '+' : ''}${bigMoney(position.unrealisedGain)} (${position.unrealisedPct! >= 0 ? '+' : ''}${position.unrealisedPct!.toFixed(1)}%)`}
            tone={position.unrealisedGain >= 0 ? 'up' : 'down'}
          />
        )}
      </div>
      {position.avgCost == null && (
        <p className="mt-2 text-[10.5px] text-gray-500">
          No average cost on record, so no unrealised figure is shown.
        </p>
      )}
    </DesktopModule>
  ) : null

  const alsoHeld = others.length > 0 ? (
    <DesktopSection key="also" title="Also held in">
      <div className="flex flex-col gap-1">
        {others.map(o => (
          <div key={o.portfolioId} className="flex items-baseline gap-2 text-[12px]">
            <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{o.portfolioName}</span>
            {/* Each book's weight is against its OWN market value. Showing one
                book's percentage beside another book's name is the confusion a
                name held at 25% in one fund and 4% in another produces. */}
            <span className="font-mono text-[11px] text-gray-500">
              {o.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} sh
            </span>
            <span className="w-14 text-right font-mono text-[11px] font-semibold tabular-nums">
              {o.weightPct != null ? `${o.weightPct.toFixed(1)}%` : '—'}
            </span>
          </div>
        ))}
      </div>
    </DesktopSection>
  ) : null

  const researchState = (
    <DesktopSection key="research-state" title="Research status">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={clsx(
          'rounded-full border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.05em]',
          TONE_PILL[RESEARCH_TONE[state] ?? 'neutral'],
        )}>
          {STATE_LABEL[state]}
        </span>
        <span className="text-[12px] text-gray-600 dark:text-gray-400">
          {data.evidence.length} research item{data.evidence.length === 1 ? '' : 's'}
          {priorEvidence.length !== data.evidence.length && `, ${newEvidence.length} since the case`}
        </span>
      </div>
      {/* There is no reviewed_at column and no review event anywhere in the
          schema, so "reviewed, unchanged" cannot be recorded. Said plainly
          rather than papered over with a button that would fake it. */}
      <p className="mt-2 text-[10.5px] leading-snug text-gray-500">
        Saving a core section is the only thing that moves this date — there is
        no separate &ldquo;reviewed, no change&rdquo; record.
      </p>
    </DesktopSection>
  )

  const evidenceOnRecord = priorEvidence.length > 0 ? (
    <DesktopSection key="evidence" id="evidence" title="Evidence on record" meta={`${priorEvidence.length}`}>
      <div className="flex flex-col gap-2">
        {priorEvidence.slice(0, 8).map(e => <EvidenceRow key={e.id} item={e} />)}
      </div>
    </DesktopSection>
  ) : null

  const ideas = data.liveIdeas.length > 0 ? (
    <DesktopSection key="ideas" title="Live ideas">
      <div className="flex flex-col gap-2">
        {data.liveIdeas.slice(0, 4).map(i => (
          <button
            key={i.id}
            type="button"
            onClick={() => routeToIdea(i.id, `${symbol ?? 'Asset'} — open idea`)}
            className="group flex items-baseline gap-2 rounded-md px-1 py-0.5 text-left hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <span className="font-mono text-[10px] font-bold uppercase tracking-[0.06em] text-gray-500">
              {i.action ?? 'idea'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-gray-800 dark:text-gray-200">
              {i.rationale || i.portfolioName || 'No claim written'}
            </span>
            <ArrowUpRight className="h-3 w-3 shrink-0 text-blue-600 opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-gray-500">
        An idea is its own object. Opening one leaves this page.
      </p>
    </DesktopSection>
  ) : null

  const decisions = data.decisions.length > 0 ? (
    <DesktopSection key="decisions" title="Recent decisions" meta={`${data.decisions.length}`}>
      <div className="flex flex-col gap-1.5">
        {data.decisions.slice(0, 5).map(d => (
          <div key={d.id} className="flex items-baseline gap-2 text-[12px]">
            <span className="w-[68px] shrink-0 font-mono text-[10px] uppercase tracking-[0.05em] text-gray-500">
              {d.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
              {d.action ?? 'decision'}{d.portfolioName ? ` · ${d.portfolioName}` : ''}
            </span>
            <span className="shrink-0 font-mono text-[10.5px] text-gray-500">
              {d.decidedAt ? new Date(d.decidedAt).toLocaleDateString() : '—'}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10.5px] text-gray-500">
        What was decided and why is kept in Decisions.
      </p>
    </DesktopSection>
  ) : null

  /* ------------------------------------------------------- composition */

  // Focus reorders one page. It never hides a section behind a tab.
  const lead: React.ReactNode[] = []
  const context: React.ReactNode[] = []

  if (activeFocus === 'position' || activeFocus === 'framework') {
    // The framework is the only thing here that can say the position is wrong,
    // so it leads; the case is what a reader checks it against.
    if (framework) lead.push(framework)
    lead.push(theCase)
    if (positionModule) context.push(positionModule)
    if (alsoHeld) context.push(alsoHeld)
    if (arrival) context.push(arrival)
    if (ideas) context.push(ideas)
    if (decisions) context.push(decisions)
    context.push(researchState)
  } else if (activeFocus === 'research') {
    // Belief first, then what has arrived against it -- side by side, because
    // that comparison is the whole question.
    lead.push(theCase)
    if (framework) lead.push(framework)
    if (arrival) context.push(arrival)
    if (priceSince) context.push(priceSince)
    context.push(researchState)
    if (evidenceOnRecord) context.push(evidenceOnRecord)
    if (positionModule) context.push(positionModule)
    if (ideas) context.push(ideas)
  } else if (activeFocus === 'decisions') {
    lead.push(theCase)
    if (decisions) context.push(decisions)
    if (ideas) context.push(ideas)
    if (positionModule) context.push(positionModule)
    context.push(researchState)
  } else {
    // Overview: calm, and in the order someone reads an unfamiliar name.
    lead.push(theCase)
    if (framework) lead.push(framework)
    if (positionModule) context.push(positionModule)
    if (alsoHeld) context.push(alsoHeld)
    context.push(researchState)
    if (arrival) context.push(arrival)
    if (ideas) context.push(ideas)
    if (decisions) context.push(decisions)
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 dark:bg-[#0b0f16]" data-testid="asset-workspace"
         data-focus={activeFocus} data-asset={asset.id}>
      <AssetHeader
        symbol={symbol}
        companyName={asset.company_name ?? null}
        spot={data.spot}
        position={position}
        showBook={!!portfolioId}
        state={state}
        gap={gap}
        daysSinceWritten={subject.daysSinceReview}
        issue={issue}
        origin={origin ?? null}
        target={target}
        teamable={teamable}
        onOpenLegacy={onOpenLegacy}
      />
      <div className="px-6 pb-12 pt-5">
        <DesktopColumns lead={<>{lead}</>} context={context.length ? <>{context}</> : undefined} />
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- header */

/**
 * Identity first, at a size that says which object you are working on.
 *
 * The context line is one line and only carries what is true: the book the
 * reader arrived from with its weight, the research clock, and the state that
 * brought them here. It is not a second navigation bar.
 */
function AssetHeader({
  symbol, companyName, spot, position, showBook, state, gap, daysSinceWritten,
  issue, origin, target, teamable, onOpenLegacy,
}: {
  symbol: string | null
  companyName: string | null
  spot: number | null
  position: AssetPosition | null
  showBook: boolean
  state: string
  gap: GapState | null
  daysSinceWritten: number | null
  issue: any
  origin: string | null
  target: EngagementTarget
  teamable: boolean
  onOpenLegacy?: () => void
}) {
  const title = issueTitle(issue)
  const detail = issueDetail(issue)
  const tone: SemanticTone = gap ? toneForGap(gap) : 'neutral'

  return (
    <div className="border-b border-gray-200 bg-white px-6 pt-5 dark:border-white/10 dark:bg-[#141a25]">
      {origin && (
        <p className="mb-2 text-[11px] text-gray-500">
          Opened from {ORIGIN_NAME[origin] ?? origin}
          {title && <> · {title}</>}
        </p>
      )}

      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="font-black text-[32px] leading-[1.02] tracking-[-0.035em]">
            {symbol ?? '—'}
          </span>
          {companyName && (
            <span className="min-w-0 truncate text-[14px] font-medium text-gray-500">{companyName}</span>
          )}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {spot != null && <DesktopStat value={money(spot)} label="Spot" />}
          {showBook && position?.weightPct != null && (
            <DesktopStat value={`${position.weightPct.toFixed(1)}%`} label="Weight" />
          )}
          {position && <DesktopStat value={bigMoney(position.marketValue)} label="Market value" />}
          {daysSinceWritten != null && (
            <DesktopStat value={`${daysSinceWritten}d`} label="Case written" />
          )}
        </div>
      </div>

      {/* One line of context, not a bar of chips. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5 text-[12px]">
        {gap && (
          <span className={clsx(
            'rounded-full border px-2 py-[2px] text-[10px] font-bold uppercase tracking-[0.05em]',
            TONE_PILL[tone],
          )}>
            {GAP_LABEL[gap]}
          </span>
        )}
        {showBook && position && (
          <span className="text-gray-700 dark:text-gray-300">{position.portfolioName}</span>
        )}
        <span className="text-gray-500">{STATE_LABEL[state as keyof typeof STATE_LABEL] ?? state}</span>
      </div>

      {detail && (
        <p className="mt-2 max-w-[80ch] text-[12.5px] text-gray-600 dark:text-gray-400">{detail}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
        {/* The D1 seam, which the legacy Asset page never had: the pane is
            mounted once in Layout and binds to whatever object is passed. */}
        <button
          type="button"
          onClick={() => askAI(target)}
          className="rounded-md px-3 py-2 text-[12.5px] font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
        >
          Ask AI
        </button>
        {teamable && (
          <>
            <span className="text-[11px] text-gray-300 dark:text-gray-700">·</span>
            <button
              type="button"
              onClick={() => discuss(target)}
              className="rounded-md px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              Team
            </button>
          </>
        )}
        {onOpenLegacy && (
          <>
            <span className="text-[11px] text-gray-300 dark:text-gray-700">·</span>
            {/* Quiet, because it is a fallback and not a destination: workflow,
                lists, widgets and analyst estimates still live there. */}
            <button
              type="button"
              onClick={onOpenLegacy}
              className="inline-flex items-center gap-1 rounded-md px-3 py-2 text-[12px] text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
            >
              Full asset page
              <ArrowUpRight className="h-3 w-3 opacity-70" />
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
  )
}

/* -------------------------------------------------------------- pieces */

function EvidenceRow({ item, isNew }: { item: any; isNew?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      {isNew && <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-gray-900 dark:text-gray-100">
        {item.title || item.content?.slice(0, 90) || 'Untitled'}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-gray-500">
        {new Date(item.createdAt).toLocaleDateString()}
      </span>
    </div>
  )
}

function Row({ k, v, tone }: { k: string; v: string; tone?: 'up' | 'down' }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-[104px] shrink-0 text-gray-500">{k}</span>
      <span className={clsx(
        'font-mono tabular-nums',
        tone === 'up' ? 'text-emerald-600 dark:text-emerald-400'
          : tone === 'down' ? 'text-rose-600 dark:text-rose-400'
          : 'text-gray-900 dark:text-gray-100',
      )}>{v}</span>
    </div>
  )
}

function Skeleton() {
  return (
    <div className="h-full overflow-y-auto bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
      <div className="h-9 w-48 animate-pulse rounded bg-gray-200 dark:bg-white/10" />
      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.62fr)_minmax(300px,1fr)]">
        <div className="h-72 animate-pulse rounded-xl bg-gray-200/70 dark:bg-white/[0.06]" />
        <div className="h-48 animate-pulse rounded-xl bg-gray-200/70 dark:bg-white/[0.06]" />
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- logic */

const RESEARCH_TONE: Record<string, SemanticTone> = {
  'evidence-since-review': 'review',
  'no-thesis': 'review',
  stale: 'review',
  thin: 'neutral',
  current: 'neutral',
}

function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000))
}

/**
 * Where the position sits against the case, on the shared Portfolio semantics.
 *
 * Only computed where there IS a position: an asset nobody owns cannot have a
 * framework gap, and painting one would be a claim about a book that holds
 * nothing.
 */
function gapFor(
  data: { ladder: any; spot: number | null; caseWrittenAt: string | null },
  position: AssetPosition | null,
): GapState | null {
  if (!position) return null
  if (!data.caseWrittenAt) return 'no-framework'
  const rungs = data.ladder?.valid ? data.ladder.cases : null
  const spot = data.spot
  if (rungs && spot != null) {
    const bull = rungs.find((c: any) => c.name === 'Bull')?.price
    const bear = rungs.find((c: any) => c.name === 'Bear')?.price
    if (bull != null && spot > bull) return 'above-bull'
    if (bear != null && spot < bear) return 'below-bear'
  }
  return 'aligned'
}

/**
 * The engagement target, carrying everything the sender knew.
 *
 * Structured context, not a hand-written prompt: the pane composes what it
 * needs from the object, its focus, the book and the issue.
 */
function buildTarget({
  asset, symbol, focus, position, portfolioName, issue, origin, state, gap, newSince, spot,
}: any): EngagementTarget {
  const chips: { label: string; value: string }[] = []
  if (spot != null) chips.push({ label: 'Spot', value: money(spot) })
  if (position?.weightPct != null) {
    chips.push({ label: 'Weight', value: `${position.weightPct.toFixed(1)}% of ${position.portfolioName}` })
  }
  if (newSince) chips.push({ label: 'New since the case', value: String(newSince) })
  if (gap) chips.push({ label: 'Framework', value: GAP_LABEL[gap as GapState] })

  return {
    objectType: 'asset',
    objectId: asset.id,
    label: asset.company_name ? `${symbol} — ${asset.company_name}` : (symbol ?? 'Asset'),
    symbol: symbol ?? undefined,
    assetId: asset.id,
    portfolioId: position?.portfolioId,
    portfolioName: position?.portfolioName ?? portfolioName ?? undefined,
    origin: { itemId: asset.id, surface: origin ?? 'asset' },
    issue: issue
      ? (typeof issue === 'string'
          ? { title: issue, reason: `asset:${focus}` }
          : issue)
      : { title: STATE_LABEL[state as keyof typeof STATE_LABEL] ?? 'Asset', reason: `asset:${focus}` },
    contextChips: chips,
  }
}
