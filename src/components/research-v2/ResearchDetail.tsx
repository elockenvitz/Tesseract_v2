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

import { useEffect, useRef, useState } from 'react'
import { DesktopModule, DesktopStat } from '../desktop/DesktopModule'
import { clsx } from 'clsx'
import { ArrowDown, ArrowUpRight, MoreHorizontal, PencilLine, X } from 'lucide-react'
import { ThesisContainer } from '../contributions'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
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
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
import type { ResearchDetail as Detail } from '../../hooks/useDesktopResearch'
import { stripHtml } from '../../utils/stripHtml'
import { anchoredWindow, PriceSinceReview } from './ResearchVisual'

/** Sender names, so the banner cannot credit the wrong surface. */
const ORIGIN_LABEL: Record<string, string> = {
  // 'today' is the internal id; Dashboard is what the user reads.
  today: 'Dashboard',
  portfolio: 'Portfolio',
  ideas: 'Ideas',
  decisions: 'Decisions',
}

export function ResearchDetail({
  subject, detail, focus, arrivedFor, arrivedFrom,
}: {
  subject: ResearchSubject
  detail: Detail | undefined
  focus?: ResearchFocus | null
  arrivedFor?: string | null
  arrivedFrom?: string | null
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

  // Every verb now resolves to something this workspace performs: the two
  // authoring states open the real editor in place, the rest jump to the
  // module that answers them.
  const [editing, setEditing] = useState(false)
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

  // Editing follows the subject, never the other way round -- selecting a
  // different name in the navigator must not leave you in someone else's
  // editor.
  useEffect(() => { setEditing(false) }, [subject.assetId])

  // Arriving with focus:'thesis' means the sender wanted the case worked on,
  // which is the whole point of the Today handoff.
  useEffect(() => {
    if (focus === 'thesis' && authoring) setEditing(true)
  }, [focus, authoring, subject.assetId])

  const runPrimary = () => {
    if (authoring) { setEditing(true); requestAnimationFrame(() => scrollTo('the-case')) }
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
            className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
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
              className="rounded-md px-3 py-2 text-[12.5px] text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
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
              className="inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-[12.5px] text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-white/[0.06]"
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
        {/* new evidence leads — it is the reason the subject surfaced */}
        {newEvidence.length > 0 && (
          <DesktopModule id="new-since-review" title="New since review" meta={`${newEvidence.length} item${newEvidence.length === 1 ? '' : 's'}`}
                  span focused={focus === 'evidence'}>
            <div className="flex flex-col gap-2">
              {newEvidence.map(e => <EvidenceRow key={e.id} item={e} isNew />)}
            </div>
            <p className="mt-2.5 text-[10.5px] text-gray-500">
              Dated after the case was last written. Whether each supports or
              challenges it is not recorded — that is the review.
            </p>
          </DesktopModule>
        )}

        <DesktopModule
          id="the-case"
          title="The case"
          span
          focused={focus === 'thesis'}
          meta={subject.daysSinceReview != null ? `reviewed ${subject.daysSinceReview}d ago` : undefined}
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
                : <><PencilLine className="h-3 w-3" />{sections.length ? 'Edit' : 'Write'}</>}
            </button>
          }
        >
          {editing ? (
            <>
              {/* The Asset page's own editor, mounted unchanged. It renders the
                  three CORE sections -- thesis, where we differ, risks -- which
                  is exactly the set the review anchor is derived from. */}
              <ThesisContainer assetId={subject.assetId} />
              {peripheral.length > 0 && (
                <div className="mt-4 border-t border-gray-200 pt-3 dark:border-white/10">
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
                    Also on record
                  </div>
                  {peripheral.map(sec => (
                    <p key={sec.section} className="mt-1.5 text-[12px] text-gray-600 dark:text-gray-400">
                      <span className="font-semibold">{SECTION_LABEL[sec.section] ?? sec.section}:</span>{' '}
                      {sec.content}
                    </p>
                  ))}
                  {/* These sections sit outside the core case, so they are not
                      part of the review anchor and are not edited here. */}
                  <p className="mt-1.5 text-[10.5px] text-gray-500">
                    Supporting sections do not move the review date. They are edited on the Asset page.
                  </p>
                </div>
              )}
            </>
          ) : sections.length > 0 ? (
            <div className="flex flex-col gap-3.5">
              {sections.map(sec => (
                <div key={sec.section}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
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
                  <div className="mt-1 text-[10.5px] text-gray-500">
                    {sec.authorName ? `${sec.authorName} · ` : ''}
                    {new Date(sec.updatedAt).toLocaleDateString()}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
              No core thesis has been written for {subject.symbol ?? 'this name'} yet.
              {subject.evidenceCount > 0 && ` ${subject.evidenceCount} research item${subject.evidenceCount === 1 ? '' : 's'} exist${subject.evidenceCount === 1 ? 's' : ''} against it.`}
            </p>
          )}

          {/* There is no reviewed_at on asset_contributions and no review
              event anywhere in the schema, so the only thing that advances the
              review date is a content save. Said plainly rather than papered
              over with a fake "mark reviewed" button. */}
          {editing && state === 'stale' && (
            <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-[11.5px] text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              Saving a section is currently the only thing that moves the review
              date — there is no separate "reviewed, no change" record. If the
              case still stands as written, leaving it untouched keeps it
              showing as unreviewed.
            </p>
          )}
        </DesktopModule>

        {window && (
          <DesktopModule title="Price" focused={focus === 'price'}>
            <PriceSinceReview w={window} />
          </DesktopModule>
        )}

        {priorEvidence.length > 0 && (
          <DesktopModule id="evidence" title="Evidence on record" meta={`${priorEvidence.length}`} focused={focus === 'evidence'}>
            <div className="flex flex-col gap-2">
              {priorEvidence.slice(0, 8).map(e => <EvidenceRow key={e.id} item={e} />)}
            </div>
          </DesktopModule>
        )}

        <DesktopModule title="Team" focused={focus === 'team'}>
          <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
            {teamable
              ? 'Team opens a thread attached to this name, so anyone joining later sees which case it concerns.'
              : 'This object cannot hold a thread yet.'}
          </p>
          {detail?.portfolioName && (
            <p className="mt-1.5 text-[11px] text-gray-500">Held in {detail.portfolioName}.</p>
          )}
        </DesktopModule>
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
        <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-gray-900 dark:text-gray-100">
          {item.title || 'Untitled note'}
        </span>
        <span className="font-mono text-[10px] text-gray-500">
          {new Date(item.createdAt).toLocaleDateString()}
        </span>
      </div>
      {/* Notes are stored as rich text; the shared stripper is what every
          other preview in the app uses, so this reads the same everywhere. */}
      {stripHtml(item.content ?? '') && (
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug text-gray-600 dark:text-gray-400">
          {stripHtml(item.content ?? '')}
        </p>
      )}
      {item.authorName && (
        <div className="mt-1 text-[10px] text-gray-500">{item.authorName}</div>
      )}
    </div>
  )
}


