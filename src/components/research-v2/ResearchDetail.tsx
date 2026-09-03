/**
 * Desktop Research — the selected case.
 *
 * The question this page answers, in order: what do we say, what has arrived
 * since we said it, and what did the price do in between.
 *
 * ── Evidence is dated, not judged ─────────────────────────────────────────
 *
 * Nothing here classifies a note as supporting or challenging the thesis. No
 * such classification is stored, and deriving one would be a claim the data
 * cannot back. What IS real is a comparison of two timestamps: whether an item
 * arrived after the case was last written. Items that did are marked "new
 * since review" and sorted first, and the reader draws the conclusion.
 *
 * ── The editor is borrowed, never rebuilt ─────────────────────────────────
 *
 * `ThesisContainer` takes an assetId and presentation flags and nothing else,
 * and it renders exactly the three CORE sections the review anchor is derived
 * from. So Research mounts the real one. Every contribution form, validation
 * rule, draft, version history and mutation stays in `useContributions`; this
 * file owns none of them and forks none of them.
 *
 * A save advances `asset_contributions.updated_at`, which IS the review
 * anchor, and `saveContribution` invalidates the `desktop-research` prefix --
 * so the state, the ordering and the since-review window all recompute from
 * the same write. Nothing here writes to the database.
 */

import { useRef } from 'react'
import {
  DesktopModule, DesktopStat, DesktopSection, DesktopColumns, DeepLinks, DeepLink,
} from '../desktop/DesktopModule'
import { clsx } from 'clsx'
import { ArrowDown, ArrowUpRight, MoreHorizontal, PencilLine } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import { openAsset } from '../../lib/desktop-asset'
import { openIdea, ideasTabFor } from '../../lib/desktop-ideas'

/**
 * Research → Ideas.
 *
 * Offered only when the asset actually carries a live, non-terminal idea. A
 * standing "Go to Ideas" button on every name would be a link, not an action --
 * and on the many names with no open idea it would land nowhere.
 */
function routeToIdea(ideaId: string, issue: string) {
  const request = { ideaId, focus: 'thesis' as const, issue, origin: 'research' }
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: ideasTabFor(request) }))
  openIdea(request)
}
import {
  stateOf, whyItMatters, primaryActionFor, targetFor,
  SECTION_LABEL, ALL_SECTIONS, CORE_SECTIONS, STATE_LABEL,
  type ResearchSubject,
} from '../../lib/desktop-research'
import type { ResearchDetail as Detail } from '../../hooks/useDesktopResearch'
import { stripHtml } from '../../utils/stripHtml'
import { anchoredWindow, PriceSinceReview } from './ResearchVisual'
import type { FocusIntent } from '../../lib/dashboard/focus'

/** Sender names, so the banner cannot credit the wrong surface. */
const ORIGIN_LABEL: Record<string, string> = {
  // 'today' is the internal id; Dashboard is what the user reads.
  today: 'Dashboard',
  portfolio: 'Portfolio',
  ideas: 'Ideas',
  decisions: 'Decisions',
}

export function ResearchDetail({
  subject, detail, arrivedFor, arrivedFrom, intent,
}: {
  subject: ResearchSubject
  detail: Detail | undefined
  arrivedFor?: string | null
  arrivedFrom?: string | null
  /** Which part of the object the reader reached for on the way in. */
  intent?: FocusIntent
}) {
  const target = targetFor(subject)
  const teamable = !!target && canDiscuss(target)
  const window = anchoredWindow(detail?.history, subject.thesisUpdatedAt)
  const why = whyItMatters(subject, window?.reachesAnchor ? window.changePct : null)

  const sections = (detail?.sections ?? [])
    .slice()
    .sort((a, b) => ALL_SECTIONS.indexOf(a.section as any) - ALL_SECTIONS.indexOf(b.section as any))
  const newEvidence = (detail?.evidence ?? []).filter(e => e.isNewSinceReview)
  const priorEvidence = (detail?.evidence ?? []).filter(e => !e.isNewSinceReview)
  const peripheral = sections.filter(
    sec => !(CORE_SECTIONS as readonly string[]).includes(sec.section),
  )

  const root = useRef<HTMLDivElement>(null)
  const state = stateOf(subject)

  /**
   * Authoring belongs to the Asset page, not here.
   *
   * This workspace used to mount the Asset page's own thesis editor. That is
   * the clearest possible case of the Dashboard reproducing the product it
   * sits above: the question this surface exists to answer is "what arrived,
   * and does the case still hold" -- writing the case is the next step, in the
   * place that owns it. The primary action now takes the reader there, with
   * the reason intact.
   */
  const authoring = state === 'no-thesis' || state === 'stale' || state === 'thin'
  const jump =
    state === 'evidence-since-review' ? (newEvidence.length ? 'new-since-review' : 'the-case')
    : 'the-case'

  const scrollTo = (id: string) => {
    const el = root.current?.querySelector(`#${id}`)
    // Guarded: scrolling is a convenience, and a host without smooth scrolling
    // must not turn the primary action into an uncaught exception.
    if (el && typeof (el as HTMLElement).scrollIntoView === 'function') {
      (el as HTMLElement).scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  /** Where the case is written. One hop, carrying why the reader is here. */
  const openInAsset = (focus: 'research' = 'research') => openAsset({
    assetId: subject.assetId,
    symbol: subject.symbol,
    companyName: subject.companyName,
    focus,
    issue: arrivedFor ?? why,
    origin: 'research',
  })

  /**
   * Which panel leads, from what the reader reached for.
   *
   * ── Not five pages ──────────────────────────────────────────────────────
   *
   * The same object-centred surface, re-prioritised. A reader who clicked the
   * price is asking about the price, so the price takes the lead column and
   * the case moves beside it; one who clicked the book gets the position
   * first. Nothing is added, removed or fetched — the panels this workspace
   * already builds are ordered by what was actually asked for.
   *
   * `framework` is deliberately not a case here. The desk's cases live on the
   * Ideas and Asset surfaces, not in Research, so there is no framework panel
   * to foreground; inventing a heading over content that does not exist would
   * be worse than leading with the case. The intent still travels, and routing
   * it to the surface that owns cases is a later stage's work.
   */
  const leadPanel: 'case' | 'price' | 'book' =
    intent === 'price' && window ? 'price'
      : intent === 'book' && detail?.portfolioName ? 'book'
      : 'case'

  const runPrimary = () => {
    // An authoring state's next step is authoring, which happens on the Asset
    // page. Everything else is understood here, so the verb scrolls.
    if (authoring) openInAsset()
    else scrollTo(jump)
  }

  return (
    <div ref={root} data-testid="research-detail" className="pb-12">
      {arrivedFor && (
        <div className="border-b border-blue-200 bg-blue-50 px-6 py-2 text-[12px] text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
          <span className="font-semibold">
            Opened from {ORIGIN_LABEL[arrivedFrom ?? ''] ?? 'another surface'}:
          </span>{' '}
          {arrivedFor}
        </div>
      )}

      {/* header */}
      <div className="border-b border-gray-200 bg-white px-6 pt-5 dark:border-white/10 dark:bg-[#141a25]">
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-baseline gap-2.5">
            <span className="font-black text-[30px] leading-[1.05] tracking-[-0.035em]">
              {subject.symbol ?? '—'}
            </span>
            {subject.companyName && (
              <span className="truncate text-[13px] font-medium text-gray-500">{subject.companyName}</span>
            )}
          </div>
          <div className="ml-auto flex flex-wrap gap-2">
            {subject.daysSinceReview != null && (
              <DesktopStat value={`${subject.daysSinceReview}d`} label="Last review" />
            )}
            <DesktopStat value={String(subject.evidenceCount)} label="Evidence" />
            {subject.newSinceReview > 0 && (
              <DesktopStat value={`+${subject.newSinceReview}`} label="Since review" tone="warn" />
            )}
            {detail?.weightPct != null && (
              <DesktopStat value={`${detail.weightPct.toFixed(1)}%`} label="Weight" />
            )}
          </div>
        </div>

        <p className="mt-3 max-w-[84ch] text-[13px] text-gray-700 dark:text-gray-300">{why}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          <button
            type="button"
            onClick={runPrimary}
            className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
          >
            {primaryActionFor(subject)}
            {authoring
              ? <PencilLine className="h-3.5 w-3.5 opacity-70" />
              : <ArrowDown className="h-3.5 w-3.5 opacity-70" />}
          </button>
          {target && (
            <button
              type="button"
              onClick={() => askAI(target)}
              className="rounded-md px-3 py-2 text-[12px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              Ask AI
            </button>
          )}
          {detail?.liveIdea && (
            <button
              type="button"
              onClick={() => routeToIdea(
                detail.liveIdea!.id,
                `${subject.symbol ?? 'Asset'} — ${STATE_LABEL[state]}`,
              )}
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
            >
              {detail.liveIdea.action
                ? `Open the ${detail.liveIdea.action} idea`
                : 'Open the idea'}
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
          <button type="button" aria-label="More actions"
                  className="ml-auto grid h-8 w-8 place-items-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]">
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/*
        The case, and what arrived against it.

        Side by side rather than stacked, because the reader's question is
        exactly that comparison: here is what we believe, here is what has come
        in since we wrote it. Stacking put the new facts above the belief they
        contradict and pushed the belief off the first screen.
      */}
      <div className="px-6 pb-10 pt-5">
        {/*
          What has changed since the thesis was written.

          A stale-thesis card asks exactly one question and the workspace used
          to restate the alert instead of answering it. These are four facts
          the surface already holds -- the price move over the anchored window,
          what research has arrived, what the book holds, and whether spot is
          still inside the framework -- and each one says "nothing" honestly
          rather than being omitted or invented.
        */}
        {subject.thesisUpdatedAt && (
          <SinceReview
            days={subject.daysSinceReview}
            window={window}
            arrivals={newEvidence.length}
            weightPct={detail?.weightPct ?? subject.weightPct ?? null}
          />
        )}

        {/*
          The lead column answers whatever the reader reached for.

          Price and the position are promoted out of the context column rather
          than duplicated into it, so each panel still appears exactly once and
          the surface stays one page. Everything not leading keeps its usual
          order beside it.
        */}
        <DesktopColumns
          lead={<>
            {leadPanel === 'price' && (
              <DesktopSection id="price" title="Price since the last review" lead>
                <PriceSinceReview w={window!} />
              </DesktopSection>
            )}
            {leadPanel === 'book' && (
              <DesktopSection id="book" title="The position" lead>
                <p className="text-[13px] text-gray-700 dark:text-gray-300">
                  {detail!.portfolioName}
                  {detail!.weightPct != null && ` · ${detail!.weightPct.toFixed(1)}% of the book`}
                </p>
              </DesktopSection>
            )}
        <DesktopSection
          id="the-case"
          title="The case"
          lead={leadPanel === 'case'}
          meta={subject.daysSinceReview != null ? `reviewed ${subject.daysSinceReview}d ago` : undefined}
          action={
            <button
              type="button"
              onClick={() => openInAsset()}
              className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              <PencilLine className="h-3 w-3" />
              {sections.length ? 'Edit on the asset' : 'Write on the asset'}
              <ArrowUpRight className="h-3 w-3 opacity-70" />
            </button>
          }
        >
          {sections.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {sections.map(sec => (
                <div key={sec.section}>
                  <div className="text-[9px] font-bold uppercase tracking-widest text-gray-500">
                    {SECTION_LABEL[sec.section] ?? sec.section}
                    {!(CORE_SECTIONS as readonly string[]).includes(sec.section) && (
                      <span className="ml-1.5 font-medium normal-case tracking-normal text-gray-400">
                        supporting
                      </span>
                    )}
                  </div>
                  <p className="mt-1 max-w-[84ch] whitespace-pre-line text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">
                    {sec.content || <span className="italic text-gray-500">Empty.</span>}
                  </p>
                  {sec.supportingDetail && (
                    <p className="mt-1 max-w-[84ch] text-[12px] leading-relaxed text-gray-600 dark:text-gray-400">
                      {sec.supportingDetail}
                    </p>
                  )}
                  <div className="mt-1 text-[10px] text-gray-500">
                    {sec.authorName ? `${sec.authorName} · ` : ''}
                    {new Date(sec.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12px] text-gray-600 dark:text-gray-400">
              No thesis on file for {subject.symbol ?? 'this name'} yet.
              {subject.evidenceCount > 0 && ` ${subject.evidenceCount} research item${subject.evidenceCount === 1 ? '' : 's'} exist${subject.evidenceCount === 1 ? 's' : ''} against it.`}
            </p>
          )}

          {/* There is no reviewed_at on asset_contributions and no review
              event anywhere in the schema, so the only thing that advances the
              review date is a content save. Said plainly rather than papered
              over with a fake "mark reviewed" button. */}
          {/* The product has no "reviewed, unchanged" record, and it is honest
              to say so -- but as a footnote beside the action, not as an amber
              panel that outranks the case. Implementation debt should not be
              the loudest thing in an investment workspace. */}
          {state === 'stale' && (
            <p className="mt-3 text-[10px] text-gray-500">
              Saving a section is what moves the review date; there is no
              separate &ldquo;reviewed, no change&rdquo; record.
            </p>
          )}
          {peripheral.length > 0 && (
            <p className="mt-3 text-[11px] text-gray-500">
              {peripheral.length} supporting section{peripheral.length === 1 ? '' : 's'} sit
              outside the core case and do not move the review date.
            </p>
          )}
        </DesktopSection>
          </>}

          context={<>
            {/* New evidence keeps its box: it is a distinct state, and the box
                is what makes it read as arriving from outside the case rather
                than as part of it. */}
            {newEvidence.length > 0 && (
              <DesktopModule
                id="new-since-review"
                title="New since review"
                meta={`${newEvidence.length} item${newEvidence.length === 1 ? '' : 's'}`}
              >
                <div className="flex flex-col gap-2">
                  {newEvidence.map(e => <EvidenceRow key={e.id} item={e} isNew />)}
                </div>
                <p className="mt-2.5 text-[10px] text-gray-500">
                  Dated after the case was last written. Whether each supports or
                  challenges it is not recorded — that is the review.
                </p>
              </DesktopModule>
            )}

            {window && leadPanel !== 'price' && (
              <DesktopModule title="Price">
                <PriceSinceReview w={window} />
              </DesktopModule>
            )}

            {/* A list of titles and dates. It never needed chrome. */}
            {priorEvidence.length > 0 && (
              <DesktopSection
                id="evidence"
                title="Evidence on record"
                meta={`${priorEvidence.length}`}
              >
                <div className="flex flex-col gap-2">
                  {priorEvidence.slice(0, 8).map(e => <EvidenceRow key={e.id} item={e} />)}
                </div>
              </DesktopSection>
            )}

            {/* Team is an action, and it already sits in the header. A module
                explaining how threads work is not investment context. */}
            {detail?.portfolioName && leadPanel !== 'book' && (
              <DesktopSection title="Held in">
                <p className="text-[12px] text-gray-700 dark:text-gray-300">
                  {detail.portfolioName}
                  {detail.weightPct != null && ` · ${detail.weightPct.toFixed(1)}% of the book`}
                </p>
              </DesktopSection>
            )}
          </>}
        />

        <DeepLinks>
          <DeepLink label="Open full asset" onClick={() => openInAsset()} />
          {detail?.liveIdea && (
            <DeepLink
              label="Open idea"
              onClick={() => routeToIdea(detail.liveIdea!.id, why)}
            />
          )}
        </DeepLinks>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ pieces */

function EvidenceRow({ item, isNew }: { item: { title: string | null; content: string | null; createdAt: string; authorName: string | null }; isNew?: boolean }) {
  return (
    <div className={clsx(
      'rounded-lg border px-3 py-2',
      isNew
        ? 'border-amber-200 bg-amber-50/50 dark:border-amber-900/40 dark:bg-amber-950/20'
        : 'border-gray-200 dark:border-white/10',
    )}>
      <div className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-gray-900 dark:text-gray-100">
          {item.title || 'Untitled note'}
        </span>
        <span className="font-mono text-[10px] text-gray-500">
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
      </div>
      {/* Notes are stored as rich text; the shared stripper is what every
          other preview in the app uses, so this reads the same everywhere. */}
      {stripHtml(item.content ?? '') && (
        <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-gray-600 dark:text-gray-400">
          {stripHtml(item.content ?? '')}
        </p>
      )}
      {item.authorName && (
        <div className="mt-1 text-[10px] text-gray-500">{item.authorName}</div>
      )}
    </div>
  )
}


/**
 * Since the thesis was written.
 *
 * Four facts, each of which can honestly say "nothing". The price move only
 * appears when the series actually reaches the anchor -- `anchoredWindow`
 * refuses to claim a since-review number it cannot support, and that refusal
 * is more useful than a figure covering the wrong window.
 */
function SinceReview({
  days, window: w, arrivals, weightPct,
}: {
  days: number | null
  window: { changePct: number; reachesAnchor: boolean } | null
  arrivals: number
  weightPct: number | null
}) {
  const move = w?.reachesAnchor ? w.changePct : null
  return (
    <section
      data-testid="since-review"
      className="mb-6 border-b border-gray-200 pb-5 dark:border-white/10"
    >
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        Since the thesis was written
      </h3>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-10 gap-y-4">
        {days != null && (
          <Fact value={`${days}d`} label="since review" lead />
        )}
        <Fact
          value={move != null ? `${move >= 0 ? '+' : ''}${move.toFixed(1)}%` : '—'}
          label={move != null ? 'price' : 'no price history'}
        />
        <Fact
          value={arrivals > 0 ? String(arrivals) : 'None'}
          label={arrivals === 1 ? 'new note' : 'new research'}
          tone={arrivals > 0 ? 'review' : undefined}
        />
        {weightPct != null && (
          <Fact value={`${weightPct.toFixed(1)}%`} label="held" />
        )}
      </div>
      {arrivals === 0 && (
        <p className="mt-3 text-[12px] text-gray-500">
          No new research since the last review. The thesis is simply due a look.
        </p>
      )}
    </section>
  )
}

function Fact({
  value, label, lead, tone,
}: { value: string; label: string; lead?: boolean; tone?: 'review' }) {
  return (
    <div>
      <div className={clsx(
        'font-semibold leading-none tabular-nums tracking-tight',
        lead ? 'text-[26px]' : 'text-[18px]',
        tone === 'review' ? 'text-amber-700 dark:text-amber-400' : 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </div>
      <div className="mt-1.5 text-[10px] uppercase tracking-wider text-gray-500">{label}</div>
    </div>
  )
}
