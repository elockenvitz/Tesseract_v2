/**
 * The Ideas browse card.
 *
 * ── Why Ideas stopped sharing the generic tile ───────────────────────────
 *
 * The shared four-band tile got Ideas as far as "one hero, then a field", and
 * no further. Ideas has its own question -- what do we believe, and which
 * belief is closest to a decision -- and answering it visually needs a slot map
 * of its own rather than one card resized four ways.
 *
 * ── Scan, inspect, engage ────────────────────────────────────────────────
 *
 * SCAN     the default. Ticker, stance, maturity, the claim and one real
 *          relationship, with no interaction at all. A dashboard that needs
 *          hovering to be useful is not a dashboard.
 * INSPECT  hover or keyboard focus. One more line of context and at most two
 *          actions, inside the card's own bounds, at fixed height.
 * ENGAGE   clicking the body opens the existing work deck. Unchanged.
 *
 * ── Height is earned, width is given ─────────────────────────────────────
 *
 * The old hero was twice as tall as its content, with a claim at the top, a
 * hairline framework at the bottom and several hundred pixels of nothing in
 * between. Importance is carried by WIDTH, position and typographic scale;
 * height only grows where there is something to put in it.
 *
 * ── Not a button ─────────────────────────────────────────────────────────
 *
 * Quick actions live inside the card, and a button inside a button is invalid
 * and unreachable by keyboard. The card is a container with a stretched
 * open-affordance behind its content, and the actions sit above it. Everything
 * reachable by mouse is reachable by Tab.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { Sparkles } from 'lucide-react'
import { MATURITY_LABEL, type IdeaRow } from '../../lib/desktop-ideas'
import type { ScanFrame } from '../../hooks/useDesktopIdeas'
import { DirectionPill } from './IdeaChrome'

/**
 * Where an idea sits on the page.
 *
 * Chosen from rank alone -- never from tone, stance, book, how much text the
 * claim happens to be, or whether a ladder exists to draw. A sparse rank #1 is
 * still the lead; it simply composes differently.
 */
export type IdeaSlot = 'lead' | 'second' | 'mid' | 'scan'

export function slotForRank(index: number): IdeaSlot {
  if (index === 0) return 'lead'
  if (index === 1) return 'second'
  if (index <= 5) return 'mid'
  return 'scan'
}

/*
  Deterministic, and every row closes.

    2xl (12)  lead 7 | second 5 | mid 3 | scan 3
              -> row 1  lead + second
                 row 2  four mids
                 row 3+ four scans

    xl (9)    lead 5 | second 4 | mid 3 | scan 3
    md (6)    lead 6 | second 6 | mid 3 | scan 3

  Minimum heights differ by band so the page steps down visibly, but nothing
  is tall for its own sake: the lead and the second share a row and settle to
  whichever has more to say.
*/
const SLOT: Record<IdeaSlot, string> = {
  lead: 'md:col-span-6 xl:col-span-5 2xl:col-span-7 min-h-[236px]',
  second: 'md:col-span-6 xl:col-span-4 2xl:col-span-5 min-h-[236px]',
  mid: 'md:col-span-3 xl:col-span-3 2xl:col-span-3 min-h-[164px]',
  scan: 'md:col-span-3 xl:col-span-3 2xl:col-span-3 min-h-[112px]',
}

/** Identity scales with the slot, on the application's own steps. */
const TICKER: Record<IdeaSlot, string> = {
  lead: 'text-[30px]', second: 'text-[24px]', mid: 'text-[19px]', scan: 'text-[17px]',
}
const CLAIM: Record<IdeaSlot, string> = {
  lead: 'text-[19px] leading-[1.4] line-clamp-4',
  second: 'text-[16px] leading-[1.45] line-clamp-4',
  mid: 'text-[13px] leading-[1.5] line-clamp-3',
  scan: 'text-[12px] leading-[1.45] line-clamp-2',
}

export interface IdeaCardProps {
  idea: IdeaRow
  slot: IdeaSlot
  frame?: ScanFrame
  weightPct?: number
  /** Open the work deck. The body click, and nothing else. */
  onOpen: () => void
  /** Ask AI about this idea, without expanding it first. */
  onAskAI: () => void
}

export function IdeaCard({ idea, slot, frame, weightPct, onOpen, onAskAI }: IdeaCardProps) {
  const [inspecting, setInspecting] = useState(false)

  const rung = (n: string) => frame?.ladder?.find(c => c.name === n)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull'), base = rung('Base')
  const spot = frame?.spot ?? null
  const hasLadder = bear != null && bull != null && spot != null

  const deciding = idea.maturity === 'deciding' || idea.maturity === 'decision_ready'
  const big = slot === 'lead' || slot === 'second'

  /** One line of context, and never the same fact twice. */
  const context = [
    idea.portfolioName,
    idea.conviction === 'high' ? 'High conviction' : null,
    weightPct != null ? `${weightPct.toFixed(1)}% held` : null,
    idea.proposedWeight != null ? `${idea.proposedWeight.toFixed(1)}% proposed` : null,
  ].filter(Boolean)

  return (
    <div
      data-testid="idea-tile"
      data-slot={slot}
      data-maturity={idea.maturity}
      onMouseEnter={() => setInspecting(true)}
      onMouseLeave={() => setInspecting(false)}
      onFocus={() => setInspecting(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setInspecting(false)
      }}
      className={clsx(
        SLOT[slot],
        'group relative flex flex-col overflow-hidden rounded-xl border bg-white',
        'transition-[border-color,box-shadow] duration-150',
        'border-gray-200/90 shadow-[0_1px_2px_rgba(0,0,0,0.03)]',
        'hover:border-gray-300 hover:shadow-md focus-within:border-gray-300 focus-within:shadow-md',
        'dark:border-white/[0.07] dark:bg-[#141a25] dark:hover:border-white/20',
      )}
    >
      {/*
        The open affordance, stretched behind the content. A real button, so it
        takes Tab, Enter and Space and announces itself -- and the quick
        actions above it are siblings rather than nested children.
      */}
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 rounded-xl text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
      >
        <span className="sr-only">Open {idea.symbol ?? 'idea'}</span>
      </button>

      <div className={clsx(
        'pointer-events-none relative z-[1] flex min-h-0 flex-1 flex-col',
        slot === 'lead' ? 'gap-3 p-5' : slot === 'second' ? 'gap-3 p-4' : slot === 'mid' ? 'gap-2 p-3.5' : 'gap-1.5 p-3',
      )}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DirectionPill direction={idea.direction} />
          <span className={clsx(
            'text-[10px] font-semibold uppercase tracking-wider',
            deciding ? 'text-amber-700 dark:text-amber-500' : 'text-gray-500',
          )}>
            {MATURITY_LABEL[idea.maturity]}
          </span>
        </div>

        <div className="flex min-w-0 items-baseline gap-2">
          <span className={clsx('font-black leading-none tracking-[-0.03em]', TICKER[slot])}>
            {idea.symbol ?? '—'}
          </span>
          {big && idea.companyName && (
            <span className="min-w-0 truncate text-[12px] font-medium text-gray-500">
              {idea.companyName}
            </span>
          )}
        </div>

        {/* The belief. After identity, this is the most important text here --
            never outranked by who raised it or which stage it sits in. */}
        {idea.thesis ? (
          <p className={clsx('text-gray-900 dark:text-gray-100', CLAIM[slot])}>{idea.thesis}</p>
        ) : (
          <p className="text-[12px] italic text-gray-500">No claim written yet.</p>
        )}

        {/* The framework, where the desk has written one. On the lead it is
            part of the composition rather than a hairline at the bottom. */}
        {slot === 'lead' && hasLadder ? (
          <div className="mt-auto pt-2">
            <ScenarioBand bear={bear!} bull={bull!} base={base} spot={spot!} />
          </div>
        ) : big && hasLadder ? (
          <div className="mt-auto pt-2">
            <MiniBand bear={bear!} bull={bull!} spot={spot!} />
          </div>
        ) : slot === 'mid' && hasLadder ? (
          <div className="mt-auto pt-1.5">
            <MiniBand bear={bear!} bull={bull!} spot={spot!} />
          </div>
        ) : frame?.target != null && spot != null && slot !== 'scan' ? (
          <p className="mt-auto pt-1.5 font-mono text-[12px] tabular-nums text-gray-600 dark:text-gray-400">
            {spot.toFixed(2)} → {frame.target.toFixed(2)}
            <span className="ml-1.5 font-sans text-[11px] text-gray-500">target</span>
          </p>
        ) : <div className="mt-auto" />}

        {/*
          The footer holds context OR actions, in one fixed-height region.

          Both layers are absolutely positioned inside a reserved strip, so
          revealing the actions cannot change the card's height, move a
          neighbour or shift the grid.
        */}
        <div className="relative h-[26px] shrink-0">
          <div className={clsx(
            'absolute inset-0 flex items-center gap-x-2 overflow-hidden text-[11px] text-gray-500 transition-opacity duration-150',
            inspecting ? 'opacity-0' : 'opacity-100',
          )}>
            {context.map((c, i) => (
              <span key={i} className={i === 0 ? 'truncate font-medium text-gray-600 dark:text-gray-400' : 'shrink-0'}>
                {c}
              </span>
            ))}
          </div>

          <div className={clsx(
            'pointer-events-auto absolute inset-0 flex items-center gap-1 transition-opacity duration-150',
            inspecting ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}>
            <button
              type="button"
              data-testid="idea-quick-open"
              onClick={e => { e.stopPropagation(); onOpen() }}
              className="relative z-[2] rounded-md px-2 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
            >
              {deciding ? 'Assess decision' : 'Open idea'}
            </button>
            <button
              type="button"
              data-testid="idea-quick-ai"
              onClick={e => { e.stopPropagation(); onAskAI() }}
              className="relative z-[2] inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-amber-800 hover:bg-amber-50 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
            >
              <Sparkles className="h-3 w-3" />
              Ask AI
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Spot against the desk's own ladder, at lead scale.
 *
 * Rungs are named and priced, and the marker states the distance when spot has
 * left the range -- so nobody is asked to compute the break from three
 * unlabelled ticks. Condition colours the marker only; a stance is not a
 * severity, so nothing here is coloured by buy versus sell.
 */
function ScenarioBand({
  bear, bull, base, spot,
}: { bear: number; bull: number; base: number | null; spot: number }) {
  const outside = spot > bull || spot < bear
  const lo = Math.min(bear, spot), hi = Math.max(bull, spot)
  const pad = (hi - lo) * 0.12 || hi * 0.05
  const at = (v: number) => ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100
  const gap = spot < bear ? ((bear - spot) / bear) * 100
    : spot > bull ? ((spot - bull) / bull) * 100
    : null

  return (
    <div>
      <div className="flex items-baseline justify-between font-mono text-[11px] tabular-nums text-gray-500">
        <span>{bear.toFixed(0)}</span>
        {base != null && <span className="text-gray-400">{base.toFixed(0)}</span>}
        <span>{bull.toFixed(0)}</span>
      </div>
      <div className="relative mt-1.5 h-[26px]">
        <div className="absolute top-[11px] h-[4px] w-full rounded-full bg-gray-100 dark:bg-white/10" />
        <div
          className="absolute top-[11px] h-[4px] rounded-full bg-gray-300 dark:bg-white/25"
          style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
        />
        {base != null && (
          <i className="absolute top-[7px] h-[12px] w-px bg-gray-400" style={{ left: `${at(base)}%` }} />
        )}
        <i
          className={clsx('absolute top-[3px] h-[22px] w-[3px] rounded', outside ? 'bg-rose-600' : 'bg-blue-600')}
          style={{ left: `${at(spot)}%` }}
        />
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-[10px] uppercase tracking-wider text-gray-400">Bear · Base · Bull</span>
        <span className={clsx('text-[11px]', outside ? 'text-rose-700 dark:text-rose-400' : 'text-gray-500')}>
          <span className="font-mono font-semibold tabular-nums">{spot.toFixed(2)}</span>
          {gap != null
            ? ` · ${gap.toFixed(1)}% ${spot < bear ? 'below bear' : 'above bull'}`
            : ' · inside the range'}
        </span>
      </div>
    </div>
  )
}

/** The same claim, at the width a mid card actually has. */
function MiniBand({ bear, bull, spot }: { bear: number; bull: number; spot: number }) {
  const outside = spot > bull || spot < bear
  const lo = Math.min(bear, spot), hi = Math.max(bull, spot)
  const pad = (hi - lo) * 0.1 || hi * 0.05
  const at = (v: number) => ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100
  return (
    <div>
      <div className="relative h-[10px]">
        <div className="absolute top-[3px] h-[4px] rounded-full bg-gray-200 dark:bg-white/15"
             style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }} />
        <i className={clsx('absolute top-0 h-[10px] w-[2px] rounded', outside ? 'bg-rose-600' : 'bg-blue-600')}
           style={{ left: `${at(spot)}%` }} />
      </div>
      <p className="mt-1 font-mono text-[11px] tabular-nums text-gray-500">
        {spot.toFixed(2)}
        <span className={clsx('ml-1.5 font-sans', outside && 'text-rose-700 dark:text-rose-400')}>
          {outside ? 'outside the case' : 'inside the case'}
        </span>
      </p>
    </div>
  )
}
