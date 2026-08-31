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
 * ── No thesis editor ──────────────────────────────────────────────────────
 *
 * The case is rendered read-only. Editing currently runs through the Asset
 * page's own flow, which Today reaches by a setTimeout race; rebuilding an
 * editor here without auditing that flow would fork the mutation. Reported
 * rather than reimplemented.
 */

import { useRef } from 'react'
import { clsx } from 'clsx'
import { ArrowDown, MoreHorizontal } from 'lucide-react'
import { askAI, discuss, canDiscuss } from '../../lib/engagement'
import {
  stateOf, whyItMatters, primaryActionFor, targetFor, SECTION_LABEL, ALL_SECTIONS,
  type ResearchSubject, type ResearchFocus,
} from '../../lib/desktop-research'
import type { ResearchDetail as Detail } from '../../hooks/useDesktopResearch'
import { stripHtml } from '../../utils/stripHtml'
import { anchoredWindow, PriceSinceReview } from './ResearchVisual'

export function ResearchDetail({
  subject, detail, focus, arrivedFor,
}: {
  subject: ResearchSubject
  detail: Detail | undefined
  focus?: ResearchFocus | null
  arrivedFor?: string | null
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

  // The header verb only gets a button when this workspace can actually honor
  // it here. Reading is something Research owns; authoring is not.
  const root = useRef<HTMLDivElement>(null)
  const state = stateOf(subject)
  const jump =
    state === 'evidence-since-review' ? (newEvidence.length ? 'new-since-review' : null)
    : state === 'stale' || state === 'current' ? (sections.length ? 'the-case' : null)
    : null
  const scrollTo = (id: string) =>
    root.current?.querySelector(`#${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div ref={root} data-testid="research-detail" className="pb-12">
      {arrivedFor && (
        <div className="border-b border-blue-200 bg-blue-50 px-6 py-2 text-[12px] text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/30 dark:text-blue-200">
          <span className="font-semibold">Opened from Today:</span> {arrivedFor}
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
              <Stat value={`${subject.daysSinceReview}d`} label="Last review" />
            )}
            <Stat value={String(subject.evidenceCount)} label="Evidence" />
            {subject.newSinceReview > 0 && (
              <Stat value={`+${subject.newSinceReview}`} label="Since review" tone="warn" />
            )}
            {detail?.weightPct != null && (
              <Stat value={`${detail.weightPct.toFixed(1)}%`} label="Weight" />
            )}
          </div>
        </div>

        <p className="mt-3 max-w-[84ch] text-[13px] text-gray-700 dark:text-gray-300">{why}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1 pb-3">
          {jump ? (
            <button
              type="button"
              onClick={() => scrollTo(jump)}
              className="inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 px-4 py-2.5 text-[13.5px] font-semibold text-white hover:border-blue-800 hover:bg-blue-800"
            >
              {primaryActionFor(subject)}
              <ArrowDown className="h-3.5 w-3.5 opacity-70" />
            </button>
          ) : (
            // 'Write the case' and 'Add evidence' need the authoring flow, which
            // lives on the Asset page. Saying so beats a button that scrolls to
            // an empty module and calls it writing.
            <span className="inline-flex items-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-2.5 text-[13px] text-gray-600 dark:border-white/20 dark:text-gray-400">
              <strong className="font-semibold text-gray-800 dark:text-gray-200">{primaryActionFor(subject)}</strong>
              <span className="text-[11.5px]">— authored on the Asset page</span>
            </span>
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

      <div className="grid grid-cols-1 gap-3.5 px-6 pt-4 xl:grid-cols-2">
        {/* new evidence leads — it is the reason the subject surfaced */}
        {newEvidence.length > 0 && (
          <Module id="new-since-review" title="New since review" meta={`${newEvidence.length} item${newEvidence.length === 1 ? '' : 's'}`}
                  span focused={focus === 'evidence'}>
            <div className="flex flex-col gap-2">
              {newEvidence.map(e => <EvidenceRow key={e.id} item={e} isNew />)}
            </div>
            <p className="mt-2.5 text-[10.5px] text-gray-500">
              Dated after the case was last written. Whether each supports or
              challenges it is not recorded — that is the review.
            </p>
          </Module>
        )}

        {sections.length > 0 ? (
          <Module id="the-case" title="The case" meta={subject.daysSinceReview != null ? `reviewed ${subject.daysSinceReview}d ago` : undefined}
                  span focused={focus === 'thesis'}>
            <div className="flex flex-col gap-3.5">
              {sections.map(sec => (
                <div key={sec.section}>
                  <div className="text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">
                    {SECTION_LABEL[sec.section] ?? sec.section}
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
          </Module>
        ) : (
          <Module id="the-case" title="The case" span focused={focus === 'thesis'}>
            <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
              No investment case has been written for {subject.symbol ?? 'this name'} yet.
              {subject.evidenceCount > 0 && ` ${subject.evidenceCount} research item${subject.evidenceCount === 1 ? '' : 's'} exist${subject.evidenceCount === 1 ? 's' : ''} against it.`}
            </p>
          </Module>
        )}

        {window && (
          <Module title="Price" focused={focus === 'price'}>
            <PriceSinceReview w={window} />
          </Module>
        )}

        {priorEvidence.length > 0 && (
          <Module id="evidence" title="Evidence on record" meta={`${priorEvidence.length}`} focused={focus === 'evidence'}>
            <div className="flex flex-col gap-2">
              {priorEvidence.slice(0, 8).map(e => <EvidenceRow key={e.id} item={e} />)}
            </div>
          </Module>
        )}

        <Module title="Team" focused={focus === 'team'}>
          <p className="text-[12.5px] text-gray-600 dark:text-gray-400">
            {teamable
              ? 'Team opens a thread attached to this name, so anyone joining later sees which case it concerns.'
              : 'This object cannot hold a thread yet.'}
          </p>
          {detail?.portfolioName && (
            <p className="mt-1.5 text-[11px] text-gray-500">Held in {detail.portfolioName}.</p>
          )}
        </Module>
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

function Stat({ value, label, tone }: { value: string; label: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 shadow-sm dark:border-white/10 dark:bg-white/[0.03]">
      <span className={clsx(
        'block font-mono text-[16px] font-semibold tabular-nums tracking-tight',
        tone === 'warn' && 'text-amber-700 dark:text-amber-400',
      )}>{value}</span>
      <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.07em] text-gray-500">
        {label}
      </span>
    </div>
  )
}

function Module({
  id, title, meta, span, focused, children,
}: { id?: string; title: string; meta?: string; span?: boolean; focused?: boolean; children: React.ReactNode }) {
  return (
    <section id={id} className={clsx(
      'overflow-hidden rounded-xl border bg-white shadow-sm dark:bg-[#141a25]',
      span && 'xl:col-span-2',
      focused
        ? 'border-blue-400 ring-2 ring-blue-200 dark:border-blue-600 dark:ring-blue-900/50'
        : 'border-gray-200 dark:border-white/[0.08]',
    )}>
      <div className="flex items-center gap-2 border-b border-gray-200/80 bg-gray-50/80 px-4 py-2 dark:border-white/10 dark:bg-white/[0.03]">
        <h3 className="text-[10px] font-semibold uppercase tracking-[0.1em] text-gray-500">{title}</h3>
        {meta && <span className="ml-auto text-[10.5px] text-gray-500">{meta}</span>}
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  )
}
