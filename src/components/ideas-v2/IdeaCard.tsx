/**
 * The Ideas browse field.
 *
 * ── Why the previous version still read as a card wall ───────────────────
 *
 * Stage 3G varied column spans and nothing else, so every item remained the
 * same object — white rectangle, label, ticker, claim, footer — at four
 * widths. Worse, the lead and the second shared a grid row, so a sparse second
 * inherited the lead's height and became a large empty rectangle. Variable
 * spans are not a hierarchy.
 *
 * ── A priority field, not a grid of cards ────────────────────────────────
 *
 * The top three now compose ONE editorial region: the lead holds the left,
 * the second and third stack down the right, and the whole thing sits inside a
 * single surface with hairline divisions rather than three floating outlines.
 * Because the right column stacks, a sparse second takes the height it needs
 * and no more — which is the structural fix for the dead space, not a smaller
 * `min-h`.
 *
 * Below it, three graded cells (5 / 4 / 3 of twelve), then an even scan row,
 * then a dense tail. Flattening is allowed — but not until seventh.
 *
 * ── Depth, not just size ─────────────────────────────────────────────────
 *
 * Each rank band carries a different amount of information, not the same card
 * scaled. The lead states the claim, the framework and the context; the tail
 * states a ticker, a line and a book. Rank decides the band; nothing about the
 * idea's contents can move it.
 *
 * ── Not a button ─────────────────────────────────────────────────────────
 *
 * Quick actions live inside each cell, and a button inside a button is invalid
 * and unreachable by keyboard. Every cell is a container with a stretched
 * open-affordance behind its content and the actions above it, so reading
 * order, tab order and rank order are the same order.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { Sparkles } from 'lucide-react'
import { MATURITY_LABEL, type IdeaRow } from '../../lib/desktop-ideas'
import type { ScanFrame } from '../../hooks/useDesktopIdeas'
import { DirectionPill } from './IdeaChrome'

/**
 * Where an idea sits in the field.
 *
 * From rank alone — never from tone, stance, book, claim length, or whether
 * there is a ladder to draw.
 */
export type IdeaSlot = 'lead' | 'second' | 'third' | 'wide' | 'mid' | 'narrow' | 'scan' | 'dense'

export function slotForRank(index: number): IdeaSlot {
  switch (index) {
    case 0: return 'lead'
    case 1: return 'second'
    case 2: return 'third'
    case 3: return 'wide'
    case 4: return 'mid'
    case 5: return 'narrow'
    default: return index <= 9 ? 'scan' : 'dense'
  }
}

/** The second tier is deliberately asymmetric: 5 + 4 + 3 of twelve. */
const TIER2_SPAN: Partial<Record<IdeaSlot, string>> = {
  wide: 'md:col-span-6 xl:col-span-4 2xl:col-span-5',
  mid: 'md:col-span-3 xl:col-span-3 2xl:col-span-4',
  narrow: 'md:col-span-3 xl:col-span-2 2xl:col-span-3',
}

const TICKER: Record<IdeaSlot, string> = {
  lead: 'text-[34px]', second: 'text-[22px]', third: 'text-[19px]',
  wide: 'text-[19px]', mid: 'text-[17px]', narrow: 'text-[16px]',
  scan: 'text-[15px]', dense: 'text-[14px]',
}
const CLAIM: Record<IdeaSlot, string> = {
  lead: 'text-[20px] leading-[1.4] line-clamp-3',
  second: 'text-[14px] leading-[1.45] line-clamp-3',
  third: 'text-[13px] leading-[1.45] line-clamp-2',
  wide: 'text-[13px] leading-[1.5] line-clamp-3',
  mid: 'text-[12px] leading-[1.5] line-clamp-2',
  narrow: 'text-[12px] leading-[1.45] line-clamp-2',
  scan: 'text-[12px] leading-[1.45] line-clamp-2',
  dense: 'text-[11px] leading-[1.4] line-clamp-1',
}
const PAD: Record<IdeaSlot, string> = {
  lead: 'p-6', second: 'p-4', third: 'p-4',
  wide: 'p-4', mid: 'p-3.5', narrow: 'p-3.5', scan: 'p-3', dense: 'px-3 py-2',
}

export interface IdeaCardProps {
  idea: IdeaRow
  slot: IdeaSlot
  frame?: ScanFrame
  weightPct?: number
  onOpen: () => void
  onAskAI: () => void
}

export function IdeaCard(props: IdeaCardProps) {
  const { slot } = props
  // The cluster cells sit inside one shared surface, so they carry no border
  // or radius of their own. Everything below is its own card.
  const inCluster = slot === 'lead' || slot === 'second' || slot === 'third'
  return (
    <Cell
      {...props}
      className={clsx(
        !inCluster && 'rounded-lg border border-gray-200/90 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03)] dark:border-white/[0.07] dark:bg-[#141a25]',
        !inCluster && 'transition-[border-color,box-shadow] duration-150 hover:border-gray-300 hover:shadow-md focus-within:border-gray-300 focus-within:shadow-md',
        TIER2_SPAN[slot],
      )}
    />
  )
}

function Cell({
  idea, slot, frame, weightPct, onOpen, onAskAI, className,
}: IdeaCardProps & { className?: string }) {
  const [inspecting, setInspecting] = useState(false)

  const rung = (n: string) => frame?.ladder?.find(c => c.name === n)?.price ?? null
  const bear = rung('Bear'), bull = rung('Bull'), base = rung('Base')
  const spot = frame?.spot ?? null
  const hasLadder = bear != null && bull != null && spot != null

  const deciding = idea.maturity === 'deciding' || idea.maturity === 'decision_ready'
  const next = deciding ? 'Assess decision'
    : idea.maturity === 'thesis_forming' ? 'Develop the thesis'
    : 'Continue research'

  /** Why this is worth attention now — from what the scan already knows. */
  const whyNow = [
    MATURITY_LABEL[idea.maturity],
    idea.portfolioName ? `in ${idea.portfolioName}` : 'no book assigned',
    weightPct != null ? `${weightPct.toFixed(1)}% held today` : null,
    idea.proposedWeight != null ? `${idea.proposedWeight.toFixed(1)}% proposed` : null,
  ].filter(Boolean).join(' · ')

  const context = [
    idea.portfolioName,
    idea.conviction === 'high' ? 'High conviction' : null,
    weightPct != null ? `${weightPct.toFixed(1)}% held` : null,
  ].filter(Boolean).join(' · ')

  return (
    <div
      data-testid="idea-tile"
      data-slot={slot}
      data-maturity={idea.maturity}
      onMouseEnter={() => setInspecting(true)}
      onMouseLeave={() => setInspecting(false)}
      onFocus={() => setInspecting(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setInspecting(false) }}
      className={clsx('group relative flex min-w-0 flex-col overflow-hidden', className)}
    >
      <button
        type="button"
        onClick={onOpen}
        className="absolute inset-0 z-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600"
      >
        <span className="sr-only">Open {idea.symbol ?? 'idea'}</span>
      </button>

      <div className={clsx('pointer-events-none relative z-[1] flex min-h-0 flex-1 flex-col', PAD[slot])}>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <DirectionPill direction={idea.direction} />
          <span className={clsx(
            'text-[10px] font-semibold uppercase tracking-wider',
            deciding ? 'text-amber-700 dark:text-amber-500' : 'text-gray-500',
          )}>
            {MATURITY_LABEL[idea.maturity]}
          </span>
        </div>

        <div className={clsx('flex min-w-0 items-baseline gap-2', slot === 'lead' ? 'mt-3' : 'mt-2')}>
          <span className={clsx('font-black leading-none tracking-[-0.035em]', TICKER[slot])}>
            {idea.symbol ?? '—'}
          </span>
          {(slot === 'lead' || slot === 'second') && idea.companyName && (
            <span className="min-w-0 truncate text-[12px] font-medium text-gray-500">
              {idea.companyName}
            </span>
          )}
        </div>

        {idea.thesis ? (
          <p className={clsx('mt-2 text-gray-900 dark:text-gray-100', CLAIM[slot])}>{idea.thesis}</p>
        ) : (
          <p className="mt-2 text-[12px] italic text-gray-500">No claim written yet.</p>
        )}

        {/* The lead's framework is part of the idea, below a rule, with room. */}
        {slot === 'lead' && hasLadder && (
          <div className="mt-5 border-t border-gray-200/80 pt-4 dark:border-white/10">
            <ScenarioBand bear={bear!} bull={bull!} base={base} spot={spot!} />
          </div>
        )}
        {slot !== 'lead' && slot !== 'dense' && hasLadder && (
          <div className="mt-3"><MiniBand bear={bear!} bull={bull!} spot={spot!} /></div>
        )}
        {slot !== 'lead' && slot !== 'dense' && !hasLadder && frame?.target != null && spot != null && (
          <p className="mt-3 font-mono text-[12px] tabular-nums text-gray-600 dark:text-gray-400">
            {spot.toFixed(2)} → {frame.target.toFixed(2)}
            <span className="ml-1.5 font-sans text-[11px] text-gray-500">target</span>
          </p>
        )}

        <div className="mt-auto" />

        {/*
          One reserved strip, two layers.

          Scan shows the context and, on the top three, a quiet next-step hint.
          Inspect replaces it with why this is here now and up to two actions.
          Both are absolutely positioned inside a fixed height, so revealing
          depth cannot move a neighbour or shift the grid — and it only ever
          covers metadata, never the ticker, the claim or the framework.
        */}
        <div className={clsx('relative shrink-0', slot === 'dense' ? 'mt-1.5 h-[18px]' : 'mt-3 h-[38px]')}>
          <div className={clsx(
            'absolute inset-0 flex flex-col justify-center gap-1 overflow-hidden transition-opacity duration-150',
            inspecting ? 'opacity-0' : 'opacity-100',
          )}>
            <p className="truncate text-[11px] text-gray-500">{context || '—'}</p>
            {(slot === 'lead' || slot === 'second' || slot === 'third') && (
              <p className="truncate text-[10px] uppercase tracking-wider text-gray-400">
                Next · {next}
              </p>
            )}
          </div>

          <div className={clsx(
            'absolute inset-x-0 bottom-0 flex flex-col justify-end transition-opacity duration-150',
            inspecting ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}>
            {slot !== 'dense' && (
              <>
                <span className="text-[9px] font-semibold uppercase tracking-widest text-gray-400">
                  Why now
                </span>
                <p className="truncate text-[11px] text-gray-700 dark:text-gray-300">{whyNow}</p>
              </>
            )}
            <div className="pointer-events-auto mt-1 flex items-center gap-1">
              <button
                type="button"
                data-testid="idea-quick-open"
                onClick={e => { e.stopPropagation(); onOpen() }}
                className="relative z-[2] rounded-md px-1.5 py-0.5 text-[11px] font-semibold text-blue-700 hover:bg-blue-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-blue-400 dark:hover:bg-blue-950/30"
              >
                {deciding ? 'Assess decision' : 'Open idea'}
              </button>
              <button
                type="button"
                data-testid="idea-quick-ai"
                onClick={e => { e.stopPropagation(); onAskAI() }}
                className="relative z-[2] inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-amber-800 hover:bg-amber-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:text-amber-400 dark:hover:bg-amber-950/30"
              >
                <Sparkles className="h-3 w-3" />
                Ask AI
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/**
 * Spot against the desk's own ladder.
 *
 * Four named, priced columns and one marker line — readable in about a second,
 * which a hairline with micro-labels was not. Condition colours the marker and
 * the sentence beneath it; nothing else is coloured, because a stance is not a
 * severity and a price is not a verdict.
 */
function ScenarioBand({
  bear, bull, base, spot,
}: { bear: number; bull: number; base: number | null; spot: number }) {
  const outside = spot > bull || spot < bear
  const lo = Math.min(bear, spot), hi = Math.max(bull, spot)
  const pad = (hi - lo) * 0.14 || hi * 0.05
  const at = (v: number) => ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100
  const gap = spot < bear ? ((bear - spot) / bear) * 100
    : spot > bull ? ((spot - bull) / bull) * 100
    : null

  const rungs = [
    { label: 'Bear', value: bear },
    ...(base != null ? [{ label: 'Base', value: base }] : []),
    { label: 'Spot', value: spot, live: true },
    { label: 'Bull', value: bull },
  ].sort((a, b) => a.value - b.value)

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        {rungs.map(r => (
          <div key={r.label} className={clsx('min-w-0', r.live && 'text-blue-700 dark:text-blue-400')}>
            <div className={clsx(
              'text-[10px] font-semibold uppercase tracking-wider',
              r.live ? (outside ? 'text-rose-700 dark:text-rose-400' : 'text-blue-700 dark:text-blue-400') : 'text-gray-400',
            )}>
              {r.label}
            </div>
            <div className={clsx(
              'mt-0.5 font-mono tabular-nums',
              r.live ? 'text-[21px] font-semibold' : 'text-[15px] text-gray-600 dark:text-gray-400',
              r.live && outside && 'text-rose-700 dark:text-rose-400',
            )}>
              {r.value.toFixed(2)}
            </div>
          </div>
        ))}
      </div>

      <div className="relative mt-3 h-[14px]">
        <div className="absolute top-[5px] h-[4px] w-full rounded-full bg-gray-100 dark:bg-white/10" />
        <div
          className="absolute top-[5px] h-[4px] rounded-full bg-gray-300 dark:bg-white/25"
          style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }}
        />
        {base != null && (
          <i className="absolute top-[2px] h-[10px] w-px bg-gray-400" style={{ left: `${at(base)}%` }} />
        )}
        <i
          className={clsx('absolute top-0 h-[14px] w-[3px] rounded', outside ? 'bg-rose-600' : 'bg-blue-600')}
          style={{ left: `${at(spot)}%` }}
        />
      </div>

      <p className={clsx('mt-2 text-[12px]', outside ? 'text-rose-700 dark:text-rose-400' : 'text-gray-500')}>
        {gap != null
          ? `${gap.toFixed(1)}% ${spot < bear ? 'below the bear case' : 'above the bull case'}`
          : 'Inside the current range'}
      </p>
    </div>
  )
}

/**
 * The same claim at cell width.
 *
 * The marker is clamped inside the track: a spot far outside the range used to
 * position an element past the container edge and clip.
 */
function MiniBand({ bear, bull, spot }: { bear: number; bull: number; spot: number }) {
  const outside = spot > bull || spot < bear
  const lo = Math.min(bear, spot), hi = Math.max(bull, spot)
  const pad = (hi - lo) * 0.1 || hi * 0.05
  const at = (v: number) => Math.min(98, Math.max(1, ((v - (lo - pad)) / ((hi + pad) - (lo - pad))) * 100))
  return (
    <div>
      <div className="relative h-[10px] overflow-hidden">
        <div className="absolute top-[3px] h-[4px] rounded-full bg-gray-200 dark:bg-white/15"
             style={{ left: `${at(bear)}%`, width: `${Math.max(0, at(bull) - at(bear))}%` }} />
        <i className={clsx('absolute top-0 h-[10px] w-[2px] rounded', outside ? 'bg-rose-600' : 'bg-blue-600')}
           style={{ left: `${at(spot)}%` }} />
      </div>
      <p className="mt-1 font-mono text-[11px] tabular-nums text-gray-500">
        {spot.toFixed(2)}
        <span className={clsx('ml-1.5 font-sans', outside && 'text-rose-700 dark:text-rose-400')}>
          {outside ? 'outside the range' : 'inside the range'}
        </span>
      </p>
    </div>
  )
}
