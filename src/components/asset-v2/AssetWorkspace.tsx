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

import { useEffect, useMemo } from 'react'
import { clsx } from 'clsx'
import { ArrowUpRight, PencilLine, X } from 'lucide-react'
import { askAI, discuss, canDiscuss, type EngagementTarget } from '../../lib/engagement'
import {
  useAssetWorkspace, primaryPosition, otherPositions,
  type AssetPosition, type AssetDecisionRow, type AssetLiveIdea,
} from '../../hooks/useAssetWorkspace'
import {
  type AssetFocus, openAsset,
} from '../../lib/desktop-asset'
import { ideasTabFor } from '../../lib/desktop-ideas'
import {
  CORE_SECTIONS, SECTION_LABEL, STATE_LABEL, stateOf, primaryActionFor,
  type ResearchSubject,
} from '../../lib/desktop-research'
import { toneForGap, GAP_LABEL, type GapState } from '../../lib/desktop-portfolio/model'
import { TONE_PILL, type SemanticTone } from '../../lib/semantic-tone'
import {
  DesktopModule, DesktopSection, DesktopStat, EYEBROW,
} from '../desktop/DesktopModule'
import { ThesisVerdictBar } from '../desktop/ThesisVerdictBar'
import { FrameworkScale, WeightBar, money, bigMoney } from '../portfolio-v2/PortfolioVisual'
import { anchoredWindow, PriceSinceReview } from '../research-v2/ResearchVisual'
/*
 * The same review map the Research lens joins in.
 *
 * Not a second read of the same truth in a different shape: `useThesisReviews`
 * is one org-scoped query with its own cache key, so the tile and the page
 * share a cache entry as well as a rule. `useDesktopResearch` calls exactly
 * this hook, and the "latest valid holds" filtering happens inside it.
 */
import { useThesisReviews } from '../../hooks/useThesisReview'
import { ThesisContainer } from '../contributions'
import { useState } from 'react'
import { EntryOrientation, type OrientationPageFacts } from './EntryOrientation'
import {
  contextAppliesTo, type WorkspaceEntryContext, type LadderRung,
} from '../../lib/asset-workspace/entry-context'

export interface AssetWorkspaceProps {
  asset: { id: string; symbol?: string | null; company_name?: string | null } & Record<string, any>
  focus?: AssetFocus | null
  portfolioId?: string | null
  portfolioName?: string | null
  issue?: any
  origin?: string | null
  /** Quiet escape to the 4,300-line legacy page, for what V1 has not absorbed. */
  onOpenLegacy?: () => void
  /**
   * Why the reader was sent here, for the header's question mark.
   *
   * Passed down from `IdeasWorkPane`, which used to draw it as a band of its
   * own above this surface. A header that already states the ticker is the
   * right owner for "and here is why you are looking at it".
   */
  why?: { headline: string; reason: string | null } | null
  /**
   * What the reader was looking at when they opened this name.
   *
   * The typed contract, not a string: which event, which numbers, stated
   * when, in which organisation. `EntryOrientation` composes the band at the
   * top of the page out of it, and the page's own canonical figures fill in
   * everything the event does not carry.
   *
   * Absent for a cold open, which is the general workspace and unchanged.
   */
  entryContext?: WorkspaceEntryContext | null
  /**
   * The reader's current organisation, for the staleness check only.
   *
   * The context carries the organisation it was BUILT in; this is the one the
   * reader is in NOW. A mismatch discards the context rather than drawing one
   * organisation's event over another's data, which is why the check needs
   * both and why neither is ever used to widen a query.
   */
  organizationId?: string | null
}

/**
 * Where a request waiting on a human is answered.
 *
 * Shared by the decision band and by the entry orientation above it. Two
 * copies of "which object answers this request" is how two surfaces on one
 * page start sending the same reader to different places; the hop is written
 * once. It hands off, and it never decides.
 */
function decisionHandoff(
  data: { liveIdeas: AssetLiveIdea[] },
  symbol: string | null,
  action: string | null,
  onOpenLegacy?: () => void,
): () => void {
  return () => {
    // The asset's live idea if one exists, else the legacy asset page.
    const idea = data.liveIdeas[0]
    if (idea) routeToIdea(idea.id, `${symbol ?? 'Asset'} — decide: ${action ?? 'request'}`)
    else onOpenLegacy?.()
  }
}

/** Ideas is a separate object; this is the typed hop, not an embedded workspace. */
function routeToIdea(ideaId: string, issue: string) {
  window.dispatchEvent(new CustomEvent('decision-engine-action', {
    detail: ideasTabFor({ ideaId, issue }),
  }))
}

export function AssetWorkspacePane({
  asset, focus, portfolioId, portfolioName, issue, origin, onOpenLegacy, why,
  entryContext, organizationId,
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

  /*
   * The review clocks, on the same model AND the same facts Research uses.
   *
   * ── The disagreement this closes ────────────────────────────────────────
   *
   * The comment below used to say the tile and the page "cannot disagree",
   * and it was false. `stateOf` decides staleness from the LATER of when the
   * thesis was written and when it was last confirmed still to hold, so that
   * recording "Reviewed — no change" clears the flag without anyone editing a
   * document that did not need editing. Research joins that confirmation in
   * (`useDesktopResearch`: `lastReviewedAt: reviews.get(s.assetId)`). This
   * subject never set the field at all, so it was permanently undefined here
   * and the age fell back to the written date alone.
   *
   * The result: a reader records "Reviewed — no change", the Research tile
   * reads Current, they click it, and the page they land on reads Review due
   * — the one thing the original comment promised could not happen.
   *
   * Fed from the same hook rather than recomputed. `useThesisReviews` counts
   * only `holds`, so the durable `changed` and `needs_work` conclusions stay
   * on the record without falsely validating a thesis nobody has fixed.
   */
  const reviews = useThesisReviews()
  const subject = useMemo<ResearchSubject>(() => ({
    assetId: asset.id,
    symbol,
    companyName: asset.company_name ?? null,
    thesisUpdatedAt: data.caseWrittenAt,
    lastReviewedAt: reviews.get(asset.id) ?? null,
    /* Unchanged, and deliberately: this is the date the page DISPLAYS — when
       the case was written — which is a different question from the clock
       that decides whether it needs attention. */
    daysSinceReview: data.caseWrittenAt ? daysSince(data.caseWrittenAt) : null,
    sectionCount: data.sections.length,
    coreSectionCount: core.length,
    coreSections: data.coreSections,
    evidenceCount: data.evidence.length,
    newestEvidenceAt: data.evidence[0]?.createdAt ?? null,
    newSinceReview: newEvidence.length,
    weightPct: position?.weightPct ?? undefined,
  }), [asset.id, symbol, asset.company_name, data, core.length, newEvidence.length, position, reviews])

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
            'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[13px] font-semibold',
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
                <p key={sec.section} className="mt-1.5 text-[13px] text-gray-600 dark:text-gray-400">
                  <span className="font-semibold">{SECTION_LABEL[sec.section] ?? sec.section}:</span>{' '}
                  {sec.content}
                </p>
              ))}
              <p className="mt-1.5 text-[11px] text-gray-500">
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
              <p className="mt-1 max-w-[74ch] whitespace-pre-line text-[15px] leading-[1.7] text-gray-900 dark:text-gray-100">
                {sec.content || <span className="italic text-gray-500">Empty.</span>}
              </p>
              {sec.supportingDetail && (
                <p className="mt-1.5 max-w-[74ch] text-[13px] leading-relaxed text-gray-600 dark:text-gray-400">
                  {sec.supportingDetail}
                </p>
              )}
              <div className="mt-1 text-[11px] text-gray-500">
                {sec.authorName ? `${sec.authorName} · ` : ''}
                {new Date(sec.updatedAt).toLocaleDateString()}
              </div>
            </div>
          ))}
          {peripheral.length > 0 && (
            <p className="text-[13px] text-gray-500">
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
          <p className="mt-1.5 text-[13px] text-gray-600 dark:text-gray-400">
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

  /* `id` on this one and on `price`: they were the only panels on the page
     with no handle at all -- no `id`, no `moduleKey` -- so nothing could
     scroll to them and nothing could name them. Every sibling had one. */
  const framework = data.ladder?.valid && data.spot != null ? (
    <DesktopModule key="framework" id="framework" title="Framework" meta="the ladder, against today">
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
      <p className="mt-2.5 text-[11px] text-gray-500">
        Dated after the case was last written. Whether each supports or
        challenges it is not recorded — that is the review.
      </p>
    </DesktopModule>
  ) : null

  const priceSince = window ? (
    <DesktopModule key="price" id="price" title="Price">
      <PriceSinceReview w={window} since="written" />
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
        <p className="text-[13px] text-gray-500">
          This book&apos;s market value could not be derived, so no weight is shown.
        </p>
      )}
      <div className="mt-3 flex flex-col gap-1.5 text-[13px]">
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
        <p className="mt-2 text-[11px] text-gray-500">
          No average cost on record, so no unrealised figure is shown.
        </p>
      )}
    </DesktopModule>
  ) : null

  const alsoHeld = others.length > 0 ? (
    <DesktopSection key="also" title="Also held in">
      <div className="flex flex-col gap-1">
        {others.map(o => (
          <div key={o.portfolioId} className="flex items-baseline gap-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">{o.portfolioName}</span>
            {/* Each book's weight is against its OWN market value. Showing one
                book's percentage beside another book's name is the confusion a
                name held at 25% in one fund and 4% in another produces. */}
            <span className="font-mono text-[13px] text-gray-500">
              {o.shares.toLocaleString(undefined, { maximumFractionDigits: 0 })} sh
            </span>
            <span className="w-16 text-right font-mono text-[13px] font-semibold tabular-nums">
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
          'rounded-full border px-2 py-[2px] text-[11px] font-semibold uppercase tracking-wider',
          TONE_PILL[RESEARCH_TONE[state] ?? 'neutral'],
        )}>
          {STATE_LABEL[state]}
        </span>
        <span className="text-[13px] text-gray-600 dark:text-gray-400">
          {data.evidence.length} research item{data.evidence.length === 1 ? '' : 's'}
          {priorEvidence.length !== data.evidence.length && `, ${newEvidence.length} since the case`}
        </span>
      </div>
      {/* There is no reviewed_at column and no review event anywhere in the
          schema, so "reviewed, unchanged" cannot be recorded. Said plainly
          rather than papered over with a button that would fake it. */}
      <p className="mt-2 text-[11px] leading-snug text-gray-500">
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
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {i.action ?? 'idea'}
            </span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-gray-800 dark:text-gray-200">
              {i.rationale || i.portfolioName || 'No claim written'}
            </span>
            <ArrowUpRight className="h-3 w-3 shrink-0 text-blue-600 opacity-0 group-hover:opacity-100" />
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        An idea is its own object. Opening one leaves this page.
      </p>
    </DesktopSection>
  ) : null

  const decisions = data.decisions.length > 0 ? (
    <DesktopSection key="decisions" title="Recent decisions" meta={`${data.decisions.length}`}>
      <div className="flex flex-col gap-1.5">
        {data.decisions.slice(0, 5).map(d => (
          <div key={d.id} className="flex items-baseline gap-2 text-[13px]">
            <span className="w-[74px] shrink-0 font-mono text-[11px] uppercase tracking-wider text-gray-500">
              {d.status}
            </span>
            <span className="min-w-0 flex-1 truncate text-gray-800 dark:text-gray-200">
              {d.action ?? 'decision'}{d.portfolioName ? ` · ${d.portfolioName}` : ''}
            </span>
            <span className="shrink-0 font-mono text-[11px] text-gray-500">
              {d.decidedAt ? new Date(d.decidedAt).toLocaleDateString() : '—'}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-gray-500">
        What was decided and why is kept in Decisions.
      </p>
    </DesktopSection>
  ) : null

  /* ------------------------------------------------------- composition */

  /**
   * The one thing to do next, and WHERE IN THE APPLICATION it is done.
   *
   * ── It used to scroll, which is not an action ───────────────────────────
   *
   * The primary moved the page: `scrollIntoView` to a section of this very
   * pane, three hundred pixels below the button. On a surface the reader can
   * already see end to end that is not a step, it is a nudge -- and it
   * explains the reading that "Review thesis" is pointless. The verb says
   * review the thesis; the button put the thesis slightly higher up.
   *
   * It now opens the Asset tab, which is where every one of these verbs is
   * actually carried out -- the full page with the editor, the workflow, the
   * lists and the estimates on it. `openAsset` is the shared seam the lens
   * panes already use, and `focus` lands the reader on the part the verb
   * names rather than at the top.
   *
   * ── The in-pane editor is not lost ──────────────────────────────────────
   *
   * `setEditing` is no longer called from here, and the case section keeps
   * its own "Write the case" / "Edit" control, so authoring in place is still
   * one press away for a reader who wants to stay. What changes is that the
   * HEADER's verb now leaves, consistently, whatever the verb is.
   */
  /*
   * `research` for every verb, and that is not a placeholder.
   *
   * All seven verbs `primaryActionFor` can return -- review it, write it,
   * revisit it, finish it, read it, review the new evidence, add evidence --
   * are things done to the CASE, and the Asset page's research focus is
   * where the case and the evidence under it both live. A per-verb map here
   * would be a table with one value repeated seven times, which is a thing
   * to keep in step rather than a distinction.
   */
  const primaryFocus: AssetFocus = 'research'
  const runPrimary = () => {
    openAsset({
      assetId: asset.id,
      symbol,
      companyName: asset.company_name ?? null,
      focus: primaryFocus,
      portfolioId: portfolioId ?? null,
      portfolioName: portfolioName ?? null,
      issue: issue ?? null,
      origin: origin ?? null,
    })
  }

  /* ------------------------------------------------ why you are here */

  /*
   * The context, only if it still describes what is on screen.
   *
   * `contextAppliesTo` is identity, not a heuristic: a context built for
   * another name, or in another organisation, applies to nothing and the page
   * renders exactly as it would have with nothing carried. Both defects it
   * guards against have shipped in this app before.
   */
  const entry = contextAppliesTo(entryContext, {
    assetId: asset.id, organizationId: organizationId ?? null,
  }) ? entryContext! : null

  const pendingRequest = data.decisions.find(d => (d.status ?? '').toLowerCase() === 'pending') ?? null

  const orientation = entry?.event ? (() => {
    /* The canonical figures, from this page's own org-scoped reads. The event
       carries what the Dashboard item knew; everything below is what the
       record says now, which is how the band can report a divergence between
       the two rather than silently preferring one. */
    const facts: OrientationPageFacts = {
      ladder: (data.ladder?.cases ?? []).map<LadderRung>(c => ({
        id: c.id, name: c.name, price: c.price,
      })),
      officialTarget: data.target,
      spot: data.spot,
      spotAsOf: data.history.length ? data.history[data.history.length - 1].date : null,
      caseWrittenAt: data.caseWrittenAt ?? null,
      position: position
        ? {
          portfolioName: position.portfolioName,
          weightPct: position.weightPct,
          valueUsd: position.marketValue ?? null,
        }
        : null,
      alsoHeldIn: others.map(p => p.portfolioName),
      pending: pendingRequest
        ? {
          label: pendingRequest.action ?? 'Decision request',
          note: pendingRequest.decisionNote ?? null,
          portfolioName: pendingRequest.portfolioName ?? null,
        }
        : null,
    }

    return (
      <EntryOrientation
        context={entry}
        facts={facts}
        actions={{
          /* The page's own editor, in place. The case section keeps its own
             control; this is the same one, reached from the orientation. */
          reviewCase: () => setEditing(true),
          /* The canonical asset page at its scenarios, which is where a
             target is actually edited. The event travels with the hop so the
             reader does not have to restate why they went. */
          openScenarios: () => openAsset({
            assetId: asset.id,
            symbol,
            companyName: asset.company_name ?? null,
            focus: 'framework',
            portfolioId: entry.portfolioId ?? portfolioId ?? null,
            portfolioName: entry.portfolioName ?? portfolioName ?? null,
            issue: entry.why?.headline ?? issue ?? null,
            origin: entry.sourceItem?.family ?? origin ?? null,
          }),
          openFullWorkspace: onOpenLegacy,
          /* Only where a request is actually waiting. An action with nothing
             behind it is the inert card this work exists to avoid. */
          openPending: pendingRequest
            ? decisionHandoff(data, symbol, pendingRequest.action ?? null, onOpenLegacy)
            : undefined,
          ask: (question: string) => askAI({
            ...target,
            origin: { itemId: asset.id, surface: 'asset-entry-orientation' },
            issue: entry.why
              ? { title: entry.why.headline, reason: `entry:${entry.intent}` }
              : target.issue,
            seedPrompt: question,
          }),
        }}
      />
    )
  })() : null

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
    /*
     * ── Neither `h-full` nor `overflow-y-auto`, and both were load-bearing
     *    the wrong way ───────────────────────────────────────────────────
     *
     * Reported: the top header bar scrolls away. It has been
     * `sticky top-0 z-20` the whole time (see `AssetHeader`), and it never
     * stuck, for two reasons that both lived on this one line.
     *
     * MEASURED live at 1920 with a name open in the work pane:
     *
     *     this element      scrollHeight 1169 === clientHeight 1169
     *     its parent        726px, `min-h-0 flex-1 overflow-y-auto`
     *
     * `overflow-y-auto` made this the header's nearest scroll container, so
     * sticky was scoped to a box that DOES NOT SCROLL -- the real scrollport
     * is `IdeasWorkPane`'s, one level up. A sticky element pinned to a
     * scrollport that never moves simply travels with the page.
     *
     * And `h-full` would have broken it a second time if the first were
     * fixed: sticky cannot leave its containing block, so a 726px box around
     * 1169px of content releases the header a third of the way down.
     *
     * So the pane is content-sized and the pane above it owns the scrolling,
     * which is what was already true in fact. Both call sites are inside that
     * scroller (`IdeasWorkPane`, two of them, and there are no others), so
     * nothing loses its scrollbar -- and nothing gains a second one, which a
     * nested scrollport would have been.
     *
     * `min-h-full` rather than nothing: the ground has to reach the bottom of
     * the scrollport for a short name, and a MINIMUM height lets the box grow
     * past it, so the header's containing block is still the whole page.
     */
    <div className="min-h-full bg-gray-50/60 dark:bg-[#0b0f16]" data-testid="asset-workspace"
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
        target={target}
        teamable={teamable}
        onOpenLegacy={onOpenLegacy}
        primary={{ label: primaryActionFor(subject), run: runPrimary }}
        assetId={subject.assetId}
        caseWrittenAt={data.caseWrittenAt ?? null}
        why={why ?? null}
      />
      {/*
        ── One vertical read, not a mosaic ────────────────────────────────────

        This was `DesktopColumns` -- a 1.62fr lead beside a 300px-minimum
        context gutter. MEASURED live at a 1440px pane: the grid resolved to
        `831px 513px`, and the six sections split across it so that The case
        and Framework sat at x=472 while Price, Research status, Evidence on
        record and Largest position sat at x=1336. Reading the page meant
        going down one column and back up the other, and nothing on the page
        said which order the two halves were in.

        The previous pass went TO two columns for a recorded reason, quoted in
        `convergence.test.ts`: half-width modules auto-placed into a grid
        "stack down the left and leave the right empty whenever the data is
        sparse, which is what left these pages using a quarter of the canvas".
        That reason is about CANVAS USE. This is a different question, and the
        trade is deliberate: an asset workspace is read the way an answer is
        read, top to bottom at a fixed measure, and spending canvas to get
        that is the choice being made. The four lens detail panes are
        unchanged and stay on two columns, which is why that guard still
        iterates `DETAILS` and this file is not in it.

        The focus ordering above is untouched. It produced a lead list and a
        context list; here they concatenate, so what led still leads and what
        was context still follows it.
      */}
      {/*
        ── The measure, and why it is 140ch rather than 100 ─────────────────

        At 1920 the pane is 1504px wide and a 100ch column is 863px, so 313px
        of nothing sat on EACH side of the content -- measured. That is not a
        reading measure, it is a letterbox: more of the pane was margin than
        the sidebar beside it is wide.

        140ch is still a cap and still centred, so the column stops growing
        and prose never runs the full width of a 4K display. But it binds only
        above ~1250px of pane, which means at the window widths this is
        actually used at the gutters are the 16px below and nothing more.

        The honest cost: on a very wide display a line of prose is now longer
        than the typographic ideal of 60-80 characters. That is the trade
        being made deliberately -- the panels, charts and tables in this
        column outnumber the paragraphs, and they were the things being
        starved.
      */}
      <div className="px-4 pb-12 pt-5" data-asset-body>
        <div className="mx-auto flex w-full max-w-[140ch] flex-col gap-6">
          {/*
            The event the reader pressed, above everything.

            Above `DecisionBand` deliberately. A pending recommendation is a
            real claim on the reader's attention and keeps its own band, but
            it is not what they selected: leading with it would answer a
            question they did not ask, which is the behaviour reported against
            the target-reached card.
          */}
          {orientation}
          <DecisionBand data={data} position={position} symbol={symbol} onOpenLegacy={onOpenLegacy} />
          {lead}
          {context}
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------- understand → decide */

/**
 * Direction A's decision band: the one place the page turns understanding into
 * an action. It appears ONLY when a request is waiting on the reader (the hero
 * collapses to nothing otherwise), frames the request against our view and
 * against the book, and hands off to where the decision is actually made — this
 * page shows and hands off, it never decides inline.
 *
 * Reward-to-risk is shown only when the ladder and spot that derive it are both
 * present, and it states its own inputs so the ratio is traceable. It is never
 * invented from a partial ladder.
 */
export function DecisionBand({
  data, position, symbol, onOpenLegacy,
}: {
  data: { decisions: AssetDecisionRow[]; liveIdeas: AssetLiveIdea[]; target: number | null; spot: number | null; ladder: any }
  position: AssetPosition | null
  symbol: string | null
  onOpenLegacy?: () => void
}) {
  const pending = data.decisions.find(d => (d.status ?? '').toLowerCase() === 'pending')
  if (!pending) return null // no request waiting: the hero is absent, not an empty box

  const spot = data.spot
  const toSpot = data.target != null && spot != null && spot > 0
    ? ((data.target - spot) / spot) * 100 : null

  // Reward-to-risk strictly from the ladder's own bear/bull and spot. Any gap → omitted.
  const bear = data.ladder?.cases?.find((c: any) => /bear/i.test(c.name))?.price ?? null
  const bull = data.ladder?.cases?.find((c: any) => /bull/i.test(c.name))?.price ?? null
  const rr = (bear != null && bull != null && spot != null && bull > spot && spot > bear)
    ? { ratio: (bull - spot) / (spot - bear), bear, bull, spot } : null

  const decide = decisionHandoff(data, symbol, pending.action ?? null, onOpenLegacy)

  return (
    <div data-testid="decision-band"
         className="mb-5 rounded-lg border border-amber-300/70 bg-amber-50/60 px-5 py-4 dark:border-amber-400/30 dark:bg-amber-500/[0.06]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={EYEBROW}>Waiting on you</p>
          <p className="mt-0.5 text-[15px] font-semibold text-gray-900 dark:text-gray-100">
            {pending.action ?? 'Decision request'}{pending.portfolioName ? ` · ${pending.portfolioName}` : ''}
          </p>
          {pending.decisionNote && (
            <p className="mt-0.5 max-w-[70ch] text-[13px] text-gray-600 dark:text-gray-400">“{pending.decisionNote}”</p>
          )}
        </div>
        {/* Elevated: the one primary action on the page, beside the request it acts on. */}
        <button type="button" onClick={decide} data-testid="decision-cta"
                className="shrink-0 rounded-md bg-gray-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-200">
          Decide
        </button>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div data-testid="against-view">
          <p className={EYEBROW}>Against our view</p>
          <p className="mt-0.5 text-[13px] text-gray-700 dark:text-gray-300">
            {toSpot != null
              ? `Target ${money(data.target!)} · ${toSpot >= 0 ? '+' : ''}${toSpot.toFixed(1)}% to spot`
              : 'No target on record to weigh the request against.'}
            {rr && (
              <span className="text-gray-500">
                {' · '}reward-to-risk {rr.ratio.toFixed(1)}:1
                <span className="text-gray-400"> (bear {money(rr.bear)} / spot {money(rr.spot)} / bull {money(rr.bull)})</span>
              </span>
            )}
          </p>
        </div>
        <div data-testid="against-book">
          <p className={EYEBROW}>Against the book</p>
          <p className="mt-0.5 text-[13px] text-gray-700 dark:text-gray-300">
            {position && position.weightPct != null
              ? `${position.portfolioName} carries ${position.weightPct.toFixed(2)}% against it.`
              : 'Not held in the book this request is for.'}
          </p>
        </div>
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
  target, teamable, onOpenLegacy, primary, assetId, caseWrittenAt, why,
}: {
  symbol: string | null
  companyName: string | null
  /** The subject of the verdict. Null on a row with no asset behind it. */
  assetId: string | null
  /**
   * When the case was written, as the gate on the verdict controls.
   *
   * The same gate `ResearchDetail` applies, and for the same reason: there is
   * nothing to conclude about a thesis nobody has written yet. A name with no
   * case gets the primary action ("Write the case") and no verdict.
   */
  caseWrittenAt: string | null
  spot: number | null
  position: AssetPosition | null
  showBook: boolean
  state: string
  gap: GapState | null
  daysSinceWritten: number | null
  /*
   * `issue` and `origin` no longer reach this header. They drew the
   * "Opened from <lens> · <finding>" line and the detail paragraph, both of
   * which said what the question mark now holds. The PANE still reads them,
   * to stamp the navigation the primary performs.
   */
  target: EngagementTarget
  teamable: boolean
  onOpenLegacy?: () => void
  /**
   * The one thing to do next, in the lens panes' own grammar.
   *
   * ── What this header had instead ────────────────────────────────────────
   *
   * Nothing. `IdeaDetail`, `ResearchDetail` and `PositionDetail` each open
   * their action row with a solid primary -- the same blue button, the same
   * trailing chevron -- and this row opened with "Ask AI", an amber quiet
   * control, followed by Team and Full asset page. Three quiet controls and
   * no answer to "what am I meant to do with this". A reader arrives here
   * FROM a finding, and the surface named the finding in its caption and
   * then offered nothing that acts on it.
   *
   * The verb comes from `primaryActionFor`, which is the desk's existing
   * research vocabulary and the same function `ResearchDetail` calls, so the
   * two surfaces cannot drift into two verb lists. Passed in rather than
   * derived here because running it needs the pane's own editing state and
   * its knowledge of which sections actually rendered.
   */
  primary: { label: string; run: () => void }
  /**
   * Why the reader is here, for the question mark beside the ticker.
   *
   * Carried from the candidate they pressed. It used to be a band of its own
   * ABOVE this header -- a ticker, a headline and a reason with a bottom
   * border, stacked on a header that draws its own ticker -- so the surface
   * opened with two top panes. Absent when nothing sent them, which is a
   * direct open rather than an arrival from a finding.
   */
  why?: { headline: string; reason: string | null } | null
}) {
  const tone: SemanticTone = gap ? toneForGap(gap) : 'neutral'

  return (
    /*
      ── Anchored, because this is the part you navigate BY ────────────────

      The ticker, the price, the weight and the verb all scrolled away with
      the first panel, so the further a reader got into a long page the less
      of it said which name they were reading. Sticky to the top of the work
      pane's scrollport, which is the element that actually scrolls here.

      `px-6 pt-4 pb-0` and a tighter stack below: the band was reported as a
      lot of wasted space, and it was -- a provenance line, a 32px ticker
      row, a chip row, a detail paragraph and an action row, five bands deep
      before the page began.
    */
    <div className="sticky top-0 z-20 border-b border-gray-200 bg-white px-6 pt-4 dark:border-white/10 dark:bg-[#141a25]">
      {/*
        ── "Opened from Ideas · <the finding>" is gone ─────────────────────

        It had a line of its own at the top of the band, and it was the SAME
        sentence the work pane's question mark already holds -- that control
        exists precisely to keep the explanation off the page until it is
        asked for. Printing it here as well meant the reader got the thing
        the collapse was supposed to collapse, one band higher.

        The question mark moves INTO this header instead, beside the ticker,
        so there is one top pane rather than a thin band stacked on a thick
        one. `why` carries the headline and reason it reveals.
      */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 basis-[11rem] items-baseline gap-2.5">
          <span className="font-extrabold text-[32px] leading-[1.02] tracking-[-0.03em]">
            {symbol ?? '—'}
          </span>
          {companyName && (
            <span className="min-w-0 truncate text-[15px] font-medium text-gray-500">{companyName}</span>
          )}
          {why && <WhyHere why={why} />}
        </div>

        {/*
          ── The verdict moved up here, centred ───────────────────────────

          It had the third band of the header to itself, under the ticker
          row and under the context line, which put the one question this
          surface asks below two rows of description and cost a whole band
          of height on a sticky element. Reported as: centre it in the top
          banner and raise it, to preserve space.

          Centred by the two groups beside it, not by `mx-auto`: both carry
          `flex-1` with the same basis, so the free space splits evenly and
          the bar sits on the header's midline whatever the ticker and the
          stats happen to measure. `flex-wrap` and a basis below the rail
          width mean a narrow column stacks the three rather than crushing
          them.

          Gated on a case existing, the same gate `ResearchDetail` uses.
          There is nothing to conclude about a thesis nobody has written.
        */}
        {caseWrittenAt && assetId && (
          <ThesisVerdictBar assetId={assetId} compact />
        )}

        <div className="flex flex-1 basis-[11rem] flex-wrap justify-end gap-2">
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

      {/*
        One line of context, not a bar of chips -- and the tools ride it.

        The tools had a band of their own below this one. Three stacked
        bands on a sticky header is three bands of the page a reader never
        gets back, and the context line was a 21px row with most of its
        width empty. The chips keep the left, the tools take the right, and
        the header loses a band.
      */}
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 pb-3 text-[13px]">
        {gap && (
          <span className={clsx(
            'rounded-full border px-2 py-[2px] text-[11px] font-semibold uppercase tracking-wider',
            TONE_PILL[tone],
          )}>
            {GAP_LABEL[gap]}
          </span>
        )}
        {showBook && position && (
          <span className="text-gray-700 dark:text-gray-300">{position.portfolioName}</span>
        )}
        <span className="text-gray-500">{STATE_LABEL[state as keyof typeof STATE_LABEL] ?? state}</span>

        {/*
          ── The issue's own sentence, dropped ──────────────────────────────

          `issueDetail` is the long form of the finding that sent the reader
          here -- the same thing the question mark above now holds, at more
          length. It had a paragraph to itself in the middle of the band,
          which is a third place for one sentence.
        */}

        {/*
          ── The verb and the tools, right-aligned as one set ───────────────

          The verb led a band of its own below this line, matching the lens
          panes. On this surface that put the single loudest control directly
          under a 32px ticker and above a page of reading, so the band opened
          with an instruction before it had finished saying which name it was
          about.

          The band is gone now and the set rides the context line, which is
          also where a reader's hand already is for Ask AI and the full page.
          `flex-1 justify-end` rather than `ml-auto`: it is what holds the
          set against the right edge whether or not the chips beside it
          render, and the case below pins it.

          `compact` on the verdict above, because its row shares its width
          with the stats block: the standing sentence is a fixed 19rem slot,
          and the filled button already says what the record holds.
        */}
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1">
          {/* The D1 seam, which the legacy Asset page never had: the pane is
              mounted once in Layout and binds to whatever object is passed. */}
          <button
            type="button"
            onClick={() => askAI(target)}
            className="rounded-md px-2.5 py-1.5 text-[13px] font-medium text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
          >
            Ask AI
          </button>
          {teamable && (
            <button
              type="button"
              onClick={() => discuss(target)}
              className="rounded-md px-2.5 py-1.5 text-[13px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              Team
            </button>
          )}
          {/*
            ── The verb, last in the row and smaller again ─────────────────

            It was already down from a 42px block to 32px and was still
            reported as too large; the thing that makes it the primary is
            that it is the only filled control on the band, not its size.

            It used to be a hair SMALLER than the quiet controls beside it
            (`text-[11px]` against their 12px) to say that. 11px is now the
            floor of the scale, where labels and captions live, so a verb
            set there reads as a caption rather than as quiet. It takes the
            same 13px as its neighbours and stays primary on fill alone.

            `ArrowUpRight`, not `ArrowDown`. The arrow was pointing down
            because the button used to scroll down this page. It now opens
            the Asset tab, and the icon has to say that or it is telling the
            reader the wrong thing about where they are going.
          */}
          <button
            type="button"
            onClick={primary.run}
            data-slot="asset-primary"
            className="ml-1 inline-flex items-center gap-1.5 rounded-md border border-blue-600 bg-blue-600 px-3 py-1.5 text-[13px] font-semibold text-white hover:border-blue-700 hover:bg-blue-700"
          >
            {primary.label}
            <ArrowUpRight className="h-3 w-3 opacity-80" />
          </button>
          {onOpenLegacy && (
            /*
              ── Now that the verb opens the Asset page, this is a duplicate ─

              It read "Full asset page" and opened the same tab the primary
              beside it opens, differing only in landing at the overview
              rather than at research. Two controls, one destination, one of
              them unlabelled about what it does differently.
            */
            <button
              type="button"
              onClick={onOpenLegacy}
              className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-[13px] text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
            >
              Overview
              <ArrowUpRight className="h-3 w-3 opacity-70" />
            </button>
          )}
        </span>
        {/*
          No overflow control. Same dead button as the other lens panes had:
          no onClick, no menu state, no popover, announced to assistive tech
          as "More actions" and doing nothing when pressed. ResearchDetail
          carries the full reasoning; it is removed rather than filled because
          there was no action waiting to go in it.
        */}
      </div>
    </div>
  )
}

/**
 * Why you are here, behind a question mark, in the header that owns it.
 *
 * ── Why a popover and not a row ───────────────────────────────────────────
 *
 * The previous version expanded in place, which pushed the whole page down
 * by the height of the headline and reason -- a band appearing above the
 * thing the reader was reading, which is the behaviour the collapse existed
 * to stop. Absolutely positioned, it covers rather than displaces.
 *
 * Closes on the next press anywhere, because a panel with no way out except
 * the control that opened it is the thing readers leave open by accident.
 */
function WhyHere({ why }: { why: { headline: string; reason: string | null } }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    // `capture`, so a press on the toggle itself is seen here FIRST and the
    // toggle's own handler then reopens it -- without that the two race and
    // the panel never closes on its own control.
    const close = () => setOpen(false)
    document.addEventListener('pointerdown', close, { capture: true })
    return () => document.removeEventListener('pointerdown', close, { capture: true })
  }, [open])

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setOpen(o => !o) }}
        aria-expanded={open}
        aria-label="Why you are here"
        data-slot="work-why-toggle"
        className="inline-flex h-5 w-5 items-center justify-center self-center rounded-full border border-gray-300 text-[11px] font-bold text-gray-400 hover:border-gray-500 hover:text-gray-600 dark:border-gray-600 dark:hover:border-gray-400"
      >
        ?
      </button>
      {open && (
        <span
          data-slot="work-why-body"
          className="absolute left-0 top-6 z-30 w-[34ch] rounded-lg border border-gray-200 bg-white p-3 shadow-lg dark:border-white/10 dark:bg-[#1b2230]"
        >
          <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">
            {why.headline}
          </span>
          {why.reason && (
            <span className="mt-1 block text-[13px] text-gray-500 dark:text-gray-400">
              {why.reason}
            </span>
          )}
        </span>
      )}
    </span>
  )
}

/* -------------------------------------------------------------- pieces */

function EvidenceRow({ item, isNew }: { item: any; isNew?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      {isNew && <span className="mt-[3px] h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />}
      <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-gray-900 dark:text-gray-100">
        {item.title || item.content?.slice(0, 90) || 'Untitled'}
      </span>
      <span className="shrink-0 font-mono text-[11px] text-gray-500">
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
    /*
     * Same ground as the loaded page, and for the same reason.
     *
     * This carried `h-full overflow-y-auto`, which is what broke the real
     * page's sticky header: it declares a scrollport on a box that does not
     * scroll, and the pane's actual scroller is `IdeasWorkPane`'s one level
     * up. Here it had no header to strand, so nothing looked wrong -- but a
     * second scrollport inside the real one means that while the skeleton is
     * up the reader's wheel can land on the wrong box, and the loaded page
     * then replaces a scrolled inner element with an unscrolled outer one.
     *
     * `min-h-full` for the loaded page's reason too: the ground reaches the
     * bottom of the scrollport while the box may grow past it.
     */
    <div className="min-h-full bg-gray-50/60 px-6 pt-6 dark:bg-[#0b0f16]">
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
