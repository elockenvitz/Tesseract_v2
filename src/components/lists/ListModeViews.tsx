/**
 * The expanded List row's six modes, as composition only.
 *
 * Named `ListModeViews` rather than `ListRowModes` because `listRowModes.ts`
 * already holds the mode vocabulary and the column→mode map, and two files
 * differing only in case resolve to one module on Windows and macOS.
 *
 * ── Why this file holds no hooks ──────────────────────────────────────────
 *
 * Every mode here is a pure function of its props. The container
 * (`ListRowExpansion`) owns the hooks, the writes and the state; this file owns
 * the picture. Two things follow from that, and both are the point:
 *
 *   • it can be rendered in the fixture gallery, so the layout can actually be
 *     LOOKED at — `guard:gallery` walks the gallery's import graph and fails on
 *     anything that reaches Supabase, which is what keeps this file honest;
 *   • the list-scoped cells that do need hooks (assignee, status, tags) arrive
 *     as ReactNode slots rather than imports.
 *
 * ── The shape every mode shares ───────────────────────────────────────────
 *
 * `AssetTableView` gives the expanded row a FIXED height by density, because
 * its virtualiser must know row sizes up front. A fixed budget is the whole
 * design problem: the first version spent it on one centred rectangle with a
 * line chart in it, which is why it read as an inserted card rather than a
 * working surface.
 *
 * So every mode is the same three regions, and each has to earn its space:
 *
 *   main   the thing the reader clicked, at the largest size it can hold
 *   rail   the investment state needed to INTERPRET that thing
 *   footer only the actions that make sense here — not a constant toolbar
 *
 * Hierarchy comes from type, spacing and alignment rather than from borders,
 * pills or colour. The one colour that survives is the direction of a number
 * and the single amber mark that means somebody has not looked yet.
 */
import React, { useState, useEffect } from 'react'
import { ExternalLink, Plus, Pencil, ArrowUpRight, ArrowRight, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Sparkline } from '../signals/Sparkline'
import {
  PriceChart, type PricePoint, type PriceEvent, type PriceLevel,
} from '../charts/PriceChart'
import { RatingPill, CoverageChip } from './ListRowAtoms'
import { SECTION_LABEL } from '../../lib/desktop-research/model'
import { stageLabel } from '../../lib/lists/work-state'
import type { ListRowMode } from './listRowModes'

// ── Shared vocabulary ──────────────────────────────────────────────────

export const money = (n: number) => `$${n.toFixed(2)}`
export const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
/*
 * `toneOf` lived here and is gone with its last caller.
 *
 * It coloured the `Target` / upside figures in the Market, Valuation and
 * Position rails. Those rails restated the verdict line above them and were
 * removed; the verdict colours its own upside clause inline.
 */

/**
 * A label above a value, small-caps.
 *
 * The label is deliberately quieter than anything it describes — at this
 * density a row of equally-weighted label/value pairs reads as a form.
 */
export function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[9.5px] font-semibold uppercase tracking-[0.09em] text-gray-400 dark:text-gray-500">
      {children}
    </div>
  )
}

/**
 * A figure, at one of three sizes.
 *
 * Size IS the hierarchy: `hero` for the thing the mode is about, `md` for the
 * investment state around it, `sm` for supporting context. Renders nothing
 * without a value, so a thin name reads as thin rather than as broken.
 */
export function Figure({
  label, value, size = 'md', tone = 'flat', title, sub,
}: {
  label: string
  value: React.ReactNode
  size?: 'hero' | 'md' | 'sm'
  tone?: 'up' | 'down' | 'flat'
  title?: string
  sub?: React.ReactNode
}) {
  if (value === null || value === undefined || value === '') return null
  /*
   * Tabular figures only for actual figures.
   *
   * `tabular-nums` forces every glyph to the width of a digit, which is what
   * makes a column of prices line up — and what spaced "BUY · ready to
   * recommend" out like a ransom note. A value with no digit in it is a word.
   */
  const numeric = typeof value !== 'string' || /\d/.test(value)
  return (
    <div className="min-w-0" title={title}>
      <Label>{label}</Label>
      <div className={clsx(
        'leading-none truncate mt-1',
        numeric && 'tabular-nums',
        size === 'hero' && 'text-[26px] font-semibold tracking-tight',
        size === 'md' && 'text-[15px] font-semibold',
        size === 'sm' && 'text-[12.5px] font-medium',
        tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'down' && 'text-rose-600 dark:text-rose-400',
        tone === 'flat' && 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </div>
      {sub && (
        <div className="text-[10.5px] text-gray-400 dark:text-gray-500 mt-0.5 truncate">{sub}</div>
      )}
    </div>
  )
}

/**
 * A label and a value on ONE line.
 *
 * `Figure` stacks its label above its value and gives the value its own
 * leading, which is right for the thing a mode is about and wasteful for the
 * four supporting facts beside it — four `Figure`s cost eight lines to say
 * four things. This costs one line each, and the baseline is shared so a
 * stack of them reads as a table of facts rather than as four small cards.
 */
export function StatRow({
  label, value, tone = 'flat',
}: {
  label: string
  value: React.ReactNode
  tone?: 'up' | 'down' | 'flat'
}) {
  if (value === null || value === undefined || value === '') return null
  return (
    <div className="flex items-baseline justify-between gap-3 min-w-0">
      <span className="text-[10.5px] font-medium text-gray-400 dark:text-gray-500 flex-shrink-0">
        {label}
      </span>
      <span className={clsx(
        'text-[12.5px] font-semibold tabular-nums truncate',
        tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
        tone === 'down' && 'text-rose-600 dark:text-rose-400',
        tone === 'flat' && 'text-gray-900 dark:text-gray-100',
      )}>
        {value}
      </span>
    </div>
  )
}

/**
 * The investment verdict, as a sentence.
 *
 * ── Why a sentence and not more figures ───────────────────────────────────
 *
 * Every mode used to open with a row of labelled figures, and a labelled
 * figure is a field: it states a value and leaves the reader to assemble the
 * position. Six modes of that is a form with six tabs, which is what made the
 * inspector feel like a database row rather than an opinion.
 *
 * What a reader actually wants on opening a name is the desk's current stance
 * in one breath — what we believe, what we think it is worth, what we own,
 * and what is outstanding. That is a sentence, so it is written as one. The
 * numbers inside it stay tabular and heavy so the line is still scannable;
 * the connective tissue is quiet so it reads rather than tabulates.
 *
 * Every clause is a stored field and a clause with nothing behind it is not
 * written. A name with no rating and no position produces "Not yet rated.",
 * which is the honest verdict rather than a row of em-dashes.
 *
 * It sits above the mode body in `ExpansionShell`, identical in all six
 * modes: the stance does not change because the reader clicked a tab, and
 * repeating it is what lets each mode below be pure evidence.
 */
export function VerdictBand(p: {
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  target: number | null
  upsidePct: number | null
  weightPct: number | null
  shares?: number | null
  bookName?: string | null
  bookCount?: number | null
  /** `workStateFor`'s own words — the row and the verdict say the same thing. */
  workLabel?: string | null
  workSince?: string | null
  awaitingDecision?: boolean
  /** The open recommendation, for a caller with no work signal to hand. */
  ideaLabel?: string | null
  caseWrittenAt?: string | null
}) {
  const num = 'font-semibold tabular-nums text-gray-900 dark:text-gray-50'
  const quiet = 'text-gray-500 dark:text-gray-400'

  const position = p.weightPct != null
    ? `${p.weightPct.toFixed(2)}%`
    : p.shares != null ? `${p.shares.toLocaleString()} sh` : null
  const book = p.bookName
    ? (p.bookCount && p.bookCount > 1 ? `${p.bookName} +${p.bookCount - 1}` : p.bookName)
    : null

  const clauses: React.ReactNode[] = []

  if (p.ratingValue || p.conviction) {
    clauses.push(
      <span key="view" className="inline-flex items-baseline gap-1.5">
        {p.ratingValue && <RatingPill value={p.ratingValue} color={p.ratingColor} />}
        {p.conviction && (
          <span className={quiet}>
            {p.ratingValue ? 'at ' : ''}<span className="font-semibold text-gray-700 dark:text-gray-200">{p.conviction}</span> conviction
          </span>
        )}
      </span>,
    )
  }

  if (p.target != null) {
    clauses.push(
      <span key="tgt" className={quiet}>
        worth <span className={num}>{money(p.target)}</span>
        {p.upsidePct != null && (
          <>
            {', '}
            <span className={clsx(
              'font-semibold tabular-nums',
              p.upsidePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}>{pct(p.upsidePct)}</span>
            {' from here'}
          </>
        )}
      </span>,
    )
  }

  /*
   * "not held" is a clause, not a verdict.
   *
   * It only earns a place in the sentence when there is a sentence: a name
   * with no rating, no target, no position and no open work should fall
   * through to the empty state below rather than produce a two-word line
   * reading "not held", which states the least interesting of the four
   * absences and implies the other three were checked and omitted.
   */
  const stated = clauses.length > 0
  if (position) {
    clauses.push(
      <span key="pos" className={quiet}>
        <span className={num}>{position}</span>{book ? <> of {book}</> : ' held'}
      </span>,
    )
  } else if (stated) {
    clauses.push(<span key="pos" className={quiet}>not held</span>)
  }

  if (p.awaitingDecision) {
    clauses.push(
      <span key="work" className="font-semibold text-primary-700 dark:text-primary-300">
        awaiting a decision
        {p.workSince && (
          <span className="font-normal text-primary-600/80 dark:text-primary-400/80">
            {' '}since {formatDistanceToNow(new Date(p.workSince))} ago
          </span>
        )}
      </span>,
    )
  } else if (p.workLabel) {
    clauses.push(<span key="work" className="font-medium text-amber-700 dark:text-amber-300">{p.workLabel}</span>)
  } else if (p.ideaLabel) {
    // An open recommendation is part of the stance even where no work signal
    // reached this caller — mobile, and the fixture gallery.
    clauses.push(<span key="work" className="font-medium text-gray-700 dark:text-gray-200">{p.ideaLabel}</span>)
  }

  if (!clauses.length) {
    return (
      <p className="text-[13.5px] italic text-gray-400 dark:text-gray-500" data-testid="verdict-band">
        Not yet rated, and not held. Nothing has been decided about this name.
      </p>
    )
  }

  return (
    <p
      className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[13.5px] leading-relaxed"
      data-testid="verdict-band"
    >
      {clauses.map((c, i) => (
        <React.Fragment key={i}>
          {i > 0 && <span className="text-gray-300 dark:text-gray-600" aria-hidden>·</span>}
          {c}
        </React.Fragment>
      ))}
      {p.caseWrittenAt && (
        <span className="ml-1 text-[11.5px] text-gray-400 dark:text-gray-500">
          case written {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
        </span>
      )}
    </p>
  )
}

/**
 * A band heading inside a mode.
 *
 * Heavier and darker than `Label`, and not uppercase: these name the three
 * questions Overview answers, and 9px uppercase grey made them read as field
 * labels floating in the canvas rather than as the structure of the page.
 */
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[11.5px] font-semibold tracking-[-0.005em] text-gray-900 dark:text-gray-100 flex-shrink-0">
      {children}
    </h3>
  )
}

/** A titled block in the context rail. Quiet by construction. */
export function RailBlock({
  label, children, className,
}: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx('min-w-0', className)}>
      <Label>{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  )
}

/**
 * Rating and conviction as ONE object.
 *
 * They were a pill beside a separate meter, which read as two facts. A view is
 * one fact with a strength, so the meter sits inside the same group and shares
 * its baseline. Editable when `onRate` is given; identical to look at either
 * way, because a control that only appears on hover is a control nobody finds.
 */
export function ViewControl({
  value, color, conviction, scaleValues, onRate, onConviction, busy, symbol, size = 'md',
}: {
  value: string | null
  color: string | null
  conviction: 'low' | 'medium' | 'high' | null
  scaleValues?: Array<{ value: string; label?: string }>
  onRate?: (v: string) => void
  onConviction?: (c: 'low' | 'medium' | 'high') => void
  busy?: boolean
  symbol?: string
  size?: 'md' | 'lg'
}) {
  const levels: Array<'low' | 'medium' | 'high'> = ['low', 'medium', 'high']
  const filledTo = conviction ? levels.indexOf(conviction) : -1
  return (
    <div className="inline-flex items-center gap-2 min-w-0">
      <span className="relative inline-flex items-center">
        <span data-testid="row-rating-display">
          {value ? (
            <RatingPill value={value} color={color} />
          ) : (
            <span className="text-[11px] font-semibold text-gray-400 dark:text-gray-500 px-1.5 py-0.5 rounded border border-dashed border-gray-300 dark:border-gray-600">
              Rate
            </span>
          )}
        </span>
        {scaleValues && onRate && (
          // Transparent native select over the pill: a finance surface keeps
          // its look and the control stays a real keyboard-accessible select.
          <select
            aria-label={`Rating for ${symbol ?? 'this security'}`}
            value={value ?? ''}
            onChange={e => onRate(e.target.value)}
            disabled={busy}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          >
            <option value="" disabled>Set rating…</option>
            {scaleValues.map(v => (
              <option key={v.value} value={v.value}>{v.label ?? v.value}</option>
            ))}
          </select>
        )}
      </span>

      {/* The meter and the picker are the same glyph, not a display beside a
          control. Three bars of rising height; each is its own target.
          Interactive only once a rating exists: there is nothing to be
          convinced about before then. */}
      <span
        className="inline-flex items-end gap-[2px]"
        title={conviction ? `${conviction} conviction` : 'Conviction not set'}
      >
        {levels.map((level, i) => {
          const lit = i <= filledTo
          const h = size === 'lg'
            ? ['h-[7px]', 'h-[11px]', 'h-[15px]'][i]
            : ['h-[5px]', 'h-[8px]', 'h-[11px]'][i]
          const common = clsx(
            size === 'lg' ? 'w-[6px]' : 'w-[5px]', h, 'rounded-sm transition-colors',
            lit ? 'bg-gray-800 dark:bg-gray-100' : 'bg-gray-200 dark:bg-gray-700',
          )
          return onConviction && value ? (
            <button
              key={level}
              onClick={() => onConviction(level)}
              disabled={busy}
              aria-label={`Set ${level} conviction`}
              aria-pressed={conviction === level}
              className={clsx(common, !lit && 'hover:bg-gray-400 dark:hover:bg-gray-500')}
            />
          ) : (
            <span key={level} className={common} />
          )
        })}
      </span>
    </div>
  )
}

/**
 * The three regions, and the rules about them.
 *
 * The rail collapses below `sm` rather than shrinking: a 220px column of
 * context on a phone is two columns of three words each.
 */
export function ModeLayout({
  main, rail, footer, railWidth = 'md',
}: {
  main: React.ReactNode
  rail?: React.ReactNode
  footer?: React.ReactNode
  /**
   * How much room the context deserves.
   *
   * `sm` when the main column is the whole point (Work's evidence, Case's
   * thesis); `md` when the rail carries real investment state the reader is
   * comparing against; `lg` for the chart modes, where the main column is a
   * plot with width to spare and the narrower rail just made the chart wider
   * without making it taller.
   */
  railWidth?: 'sm' | 'md' | 'lg'
}) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className={clsx(
        'flex-1 min-h-0 grid gap-x-7',
        rail
          ? railWidth === 'sm'
            ? 'grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,196px)]'
            : railWidth === 'lg'
              ? 'grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,320px)]'
              : 'grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,236px)]'
          : 'grid-cols-1',
      )}>
        {/*
          * `overflow-hidden`, never `auto`.
          *
          * An inspector is a fixed-height region inside a virtualised row, so
          * overflowing content used to grow a scrollbar — which put a second
          * scroll surface inside the one the reader is already scrolling, and
          * meant a mode could silently hide half its content behind a
          * 4px-wide bar nobody looks for.
          *
          * The honest alternative is to CLAMP: every mode states as much as
          * fits and links to the workspace for the rest. So the containers
          * clip, and each mode is responsible for not overrunning its budget
          * (see the `line-clamp` rules and the per-mode heights in
          * `ListTableView`). A clipped line is a bug to fix in the mode, not
          * a scrollbar to add here.
          */}
        <div className="min-w-0 min-h-0 overflow-hidden sm:pr-1">{main}</div>
        {rail && (
          // One hairline, not a card. The rail is the same surface as the
          // workspace; it is separated by alignment, not by a container.
          <aside className="min-w-0 min-h-0 overflow-hidden sm:border-l border-gray-900/[0.07] dark:border-white/10 sm:pl-6 space-y-3.5">
            {rail}
          </aside>
        )}
      </div>
      {footer && (
        <div className="flex-shrink-0 flex items-center gap-2 flex-wrap pt-3 mt-3 border-t border-gray-900/[0.07] dark:border-white/10">
          {footer}
        </div>
      )}
    </div>
  )
}

/**
 * The shell every mode sits in.
 *
 * One identity, one state line, one navigation, one action — established once so
 * the modes differ in CONTENT rather than in furniture. It also carries the
 * surface itself: the expansion bleeds to the edges of the slot
 * `AssetTableView` gives it and paints its own ground, which is what makes an
 * opened row read as a workbench attached to the row rather than a div dropped
 * into a table.
 */
export function ExpansionShell({
  symbol, companyName, state, lead, modes, activeMode, onModeChange, action, children,
}: {
  symbol: string
  companyName?: string | null
  /** The one-line attention state, where there is one. */
  state?: string | null
  /** The headline investment fact — direction and stage, price, whatever leads. */
  lead?: React.ReactNode
  modes: Array<{ id: string; label: string }>
  activeMode: string
  onModeChange: (id: string) => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="h-full min-h-0 flex flex-col px-6 pt-3.5 pb-3.5">
      {/* ── Identity, state, navigation ──────────────────────────────── */}
      <header className="flex-shrink-0 flex items-start justify-between gap-6 pb-3">
        <div className="min-w-0 flex items-baseline gap-2.5">
          <span className="text-[19px] font-semibold tracking-[-0.02em] text-gray-900 dark:text-white tabular-nums">
            {symbol}
          </span>
          {companyName && (
            <span className="text-[12.5px] text-gray-400 dark:text-gray-500 truncate max-w-[260px]">
              {companyName}
            </span>
          )}
          {state && (
            <span className="text-[11.5px] font-semibold text-amber-700 dark:text-amber-300 flex-shrink-0">
              {state}
            </span>
          )}
        </div>

        {/*
          * A segmented control, not text links in a corner.
          *
          * The modes are workspace navigation — the main thing a reader does
          * inside an open row — so they read as a control with a body, and the
          * active one is a solid chip rather than a slightly darker word.
          */}
        <nav
          role="tablist"
          className="flex-shrink-0 flex items-center gap-0.5 p-[3px] rounded-lg bg-gray-900/[0.07] dark:bg-black/30 ring-1 ring-inset ring-gray-900/[0.04] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {modes.map(m => (
            <button
              key={m.id}
              role="tab"
              aria-selected={activeMode === m.id}
              onClick={() => onModeChange(m.id)}
              className={clsx(
                'px-2.5 py-[3px] rounded-[6px] text-[11.5px] font-medium whitespace-nowrap transition-all duration-100',
                activeMode === m.id
                  ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(15,23,42,0.10)] dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
              )}
            >
              {m.label}
            </button>
          ))}
        </nav>
      </header>

      {/*
        * ── The verdict, above every mode ──────────────────────────────
        *
        * Identical in all six: the desk's stance does not change because
        * the reader clicked a tab. Carrying it here is what lets each mode
        * below be evidence rather than another arrangement of the same
        * figures — Market is a chart, Case is the writing, Position is the
        * books, and none of them has to re-answer "so what do we think".
        */}
      {lead && (
        <div className="flex-shrink-0 border-b border-gray-900/[0.07] pb-2.5 dark:border-white/10">
          {lead}
        </div>
      )}
      {lead && <div className="h-3 flex-shrink-0" />}

      <div className="flex-1 min-h-0">{children}</div>

      {action && <div className="flex-shrink-0 pt-3">{action}</div>}
    </div>
  )
}

/** The one filled button a mode may have. */
export function PrimaryButton({
  children, onClick, icon: Icon,
}: { children: React.ReactNode; onClick?: () => void; icon?: React.ElementType }) {
  /*
   * The continuation of the workflow, sized to say so.
   *
   * It was an 11.5px chip indistinguishable from the Flag button beside it; the
   * one action the mode exists to offer should not be the same weight as a
   * utility. Still a button, not a banner — the arrow carries the direction.
   */
  return (
    <button
      onClick={onClick}
      className="group/pa inline-flex items-center gap-2 pl-3 pr-2.5 py-1.5 text-[12.5px] font-semibold rounded-lg bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-950 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 transition-colors flex-shrink-0 shadow-[0_1px_2px_rgba(15,23,42,0.18)]"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
      <ArrowRight className="h-3.5 w-3.5 opacity-60 transition-transform duration-150 group-hover/pa:translate-x-0.5" />
    </button>
  )
}

/** Everything else. Text with a hit area, not a second filled button. */
export function QuietButton({
  children, onClick, icon: Icon,
}: { children: React.ReactNode; onClick?: () => void; icon?: React.ElementType }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1 px-2 py-1 text-[11.5px] font-medium text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800 rounded-md transition-colors flex-shrink-0"
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </button>
  )
}

function Quiet({ children }: { children: React.ReactNode }) {
  return <div className="text-[11.5px] text-gray-400 dark:text-gray-500">{children}</div>
}

// ── Evidence ───────────────────────────────────────────────────────────

export interface EvidenceLike {
  id: string
  title?: string | null
  content?: string | null
  authorName?: string | null
  createdAt: string
  isNewSinceReview?: boolean
}

/**
 * A research note.
 *
 * `prominent` is the Work-mode treatment: the notes ARE the content there, so
 * they get the excerpt and real line height. Elsewhere they are a rail list and
 * one line is the right size. Unreviewed is marked by a single amber dot and a
 * heavier title — not by a pill, a border or a tinted row.
 */
export function EvidenceItemView({
  item, prominent,
}: { item: EvidenceLike; prominent?: boolean }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span
        className={clsx(
          'rounded-full flex-shrink-0',
          prominent ? 'mt-[7px] h-[5px] w-[5px]' : 'mt-[6px] h-1.5 w-1.5',
          item.isNewSinceReview ? 'bg-amber-500' : 'bg-gray-300 dark:bg-gray-600',
        )}
      />
      <div className="min-w-0 flex-1">
        <div className={clsx(
          'min-w-0',
          prominent ? 'text-[13px] leading-snug' : 'text-[11.5px] leading-snug truncate',
          item.isNewSinceReview
            ? 'font-semibold text-gray-900 dark:text-gray-50'
            : 'font-medium text-gray-600 dark:text-gray-300',
        )}>
          {item.title || 'Untitled note'}
        </div>
        {prominent && item.content && (
          <p className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-2">
            {item.content}
          </p>
        )}
        <div className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500 truncate">
          {item.authorName ? `${item.authorName} · ` : ''}
          {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
        </div>
      </div>
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────────────

export interface CaseSectionLike { key: string; row: { content?: string | null; authorName?: string | null } | null }

/**
 * Overview answers three questions, in this order.
 *
 * It used to be a fact strip, a thesis, and a 212px rail of list metadata —
 * which spent most of the canvas on prose and gave owner/status/due/note more
 * weight than the position and the open idea. The questions are the structure
 * now, and the list's own fields are a single quiet line at the bottom.
 *
 * Nothing here is summarised or generated: each band renders existing fields,
 * and a band with nothing to say does not render.
 */
export function OverviewMode(p: {
  spot: number | null
  changePct: number | null
  target: number | null
  upsidePct: number | null
  weightPct: number | null
  /** Shown when a book's weight cannot be derived — the position still exists. */
  shares?: number | null
  bookName?: string | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  ideaLabel?: string | null
  oneMonthPct?: number | null
  closes?: number[] | null
  /**
   * Switch to Market mode.
   *
   * Overview's price thumbnail is too small to be interrogated, so it is the
   * entry to the mode that can be. Absent on callers with no mode switcher.
   */
  onOpenMarket?: () => void
  /** The live idea's proposed weight, where one exists. A stored field. */
  proposedWeightPct?: number | null
  /** `workStateFor`'s own words, so Overview names the work as the row does. */
  workLabel?: string | null
  workSecondary?: string | null
  awaitingDecision?: boolean
  writtenCaseSections: CaseSectionLike[]
  changes: EvidenceLike[]
  caseWrittenAt: string | null
  coverage?: Array<{ analyst: string; team: string; isLead: boolean }>
  /**
   * The list-scoped fields (status, owner, tags, due, note).
   *
   * A slot rather than imports: those cells own hooks that reach Supabase, and
   * this file has to stay reachable from the fixture gallery. The container
   * passes the real editors; the gallery passes static stand-ins.
   */
  listFieldsSlot?: React.ReactNode
  footer?: React.ReactNode
}) {
  const unread = p.changes.filter(c => c.isNewSinceReview)


  /*
   * Overview is the ARGUMENT, not the dashboard.
   *
   * It used to be five bands — Market, Investment view, Position, The case,
   * Work — which was a readable arrangement of the same five numbers the
   * collapsed row already shows, one row above. Opening a security to be told
   * again what its price and weight are is not interrogation; it is the row,
   * larger.
   *
   * Those five facts are now the verdict sentence that stands above every
   * mode, stated once. What is left for Overview is the thing the row cannot
   * carry and the reason the desk holds a view at all: the written case —
   * thesis, where we differ, risks — beside what has changed since anyone
   * last looked at it. Three columns of somebody's reasoning, not three
   * columns of fields.
   *
   * An unwritten section still gets its column and says so. A case with a
   * thesis and no risks is a real and important state, and collapsing the
   * column hides exactly the gap worth seeing.
   */
  /* Overview quotes ONE section — the thesis if there is one, else whatever
     was written first. The full case is Research's job; repeating three
     columns of it here is what made the two modes indistinguishable. */
  const lead = p.writtenCaseSections[0] ?? null

  return (
    <ModeLayout
      footer={p.footer}
      railWidth="md"
      main={
        /*
         * Three questions, three columns.
         *
         * ── Why Overview is not a short Research ──────────────────────
         *
         * It used to be the written case in up to three columns, which is
         * what RESEARCH is for — so opening a row from the ticker and
         * opening it from the rating showed the same thing at different
         * lengths, and the switch between them did nothing a reader could
         * name. Overview is the only mode asked for before the reader knows
         * what they want, so it answers the three things that decide where
         * they go next: what the desk believes, what has happened to the
         * name, and what is owed on it. Each column is a door to the mode
         * that owns it.
         */
        <div data-testid="overview-bands" className="h-full min-h-0 grid grid-cols-3 gap-x-7">
          <div className="min-w-0">
            <SectionHeading>What we believe</SectionHeading>
            {lead ? (
              <>
                <p className="mt-2 text-[12.5px] leading-[1.5] text-gray-700 line-clamp-[6] dark:text-gray-300">
                  {lead.row?.content}
                </p>
                {lead.row?.authorName && (
                  <div className="mt-2 truncate text-[10.5px] text-gray-400 dark:text-gray-500">
                    {lead.row.authorName}
                    {p.caseWrittenAt && ` · ${formatDistanceToNow(new Date(p.caseWrittenAt))} ago`}
                  </div>
                )}
              </>
            ) : (
              /* An unwritten case is the most actionable state a list row
                 has, so it is stated rather than left blank. The footer
                 carries the button that writes one. */
              <p className="mt-2 text-[12.5px] leading-[1.5] text-gray-500 dark:text-gray-400">
                No case written. Nothing records why the desk holds this view,
                what it disagrees with, or what would break it.
              </p>
            )}
          </div>

          <div className="min-w-0">
            <SectionHeading>What has happened</SectionHeading>
            <div className="mt-2 flex flex-col gap-1.5">
              {p.oneMonthPct != null && (
                <div className="flex items-baseline gap-2 text-[12px]">
                  <span className="text-gray-600 dark:text-gray-300">Price</span>
                  <span className={clsx(
                    'font-semibold tabular-nums',
                    p.oneMonthPct >= 0
                      ? 'text-emerald-600 dark:text-emerald-400'
                      : 'text-rose-600 dark:text-rose-400',
                  )}>{pct(p.oneMonthPct)}</span>
                  <span className="text-gray-400 dark:text-gray-500">over 1M</span>
                </div>
              )}
              {p.changes.length > 0
                ? p.changes.slice(0, 3).map(c => (
                  <div key={c.id} className="flex items-baseline justify-between gap-2 min-w-0 text-[12px]">
                    <span className={clsx(
                      'truncate',
                      c.isNewSinceReview
                        ? 'font-semibold text-gray-900 dark:text-gray-50'
                        : 'text-gray-600 dark:text-gray-300',
                    )}>{c.title || 'Research note'}</span>
                    <span className="flex-shrink-0 text-[10.5px] tabular-nums text-gray-400 dark:text-gray-500">
                      {formatDistanceToNow(new Date(c.createdAt))}
                    </span>
                  </div>
                ))
                : <Quiet>Nothing filed since the case was written.</Quiet>}
            </div>
          </div>

          <div className="min-w-0">
            <SectionHeading>What is owed</SectionHeading>
            <div className="mt-2 flex flex-col gap-1.5 text-[12px]">
              {p.awaitingDecision ? (
                <span className="font-semibold text-amber-700 dark:text-amber-400">
                  A decision is outstanding{p.ideaLabel ? ` — ${p.ideaLabel}` : ''}
                </span>
              ) : p.workLabel ? (
                <span className="font-medium text-gray-700 dark:text-gray-200">{p.workLabel}</span>
              ) : p.ideaLabel ? (
                <span className="font-medium text-gray-700 dark:text-gray-200">{p.ideaLabel}</span>
              ) : (
                <Quiet>Nothing outstanding.</Quiet>
              )}
              {p.workSecondary && (
                <span className="text-gray-500 dark:text-gray-400">{p.workSecondary}</span>
              )}
              {unread.length > 0 && (
                <span className="text-amber-700 dark:text-amber-400">
                  {unread.length} {unread.length === 1 ? 'note' : 'notes'} unreviewed
                </span>
              )}
            </div>
          </div>
        </div>
      }
      rail={
        <>
          {/*
            * What changed, and who owns it.
            *
            * The rail is the only part of Overview that is not the case, and
            * both things in it answer "is what I just read still current".
            */}
          <div>
            <Label>{unread.length > 0 ? 'Changed since review' : 'Latest research'}</Label>
            <div className="mt-1.5 space-y-2">
              {p.changes.length > 0
                ? p.changes.slice(0, 3).map(c => <EvidenceItemView key={c.id} item={c} />)
                : <Quiet>Nothing filed since the case was written.</Quiet>}
            </div>
          </div>

          {p.coverage && p.coverage.length > 0 && (
            <div>
              <Label>Covered by</Label>
              <div className="mt-1 space-y-0.5">
                {p.coverage.slice(0, 3).map((c, i) => (
                  <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
                ))}
              </div>
            </div>
          )}

          {/*
            * The list's own fields, kept but demoted.
            *
            * Status, owner and tags are not investment state — but Overview
            * is the ONLY place they can be edited now that their columns are
            * off the default line, and silently removing the write path would
            * be a regression dressed as a simplification. The foot of the
            * rail, never a heading of its own.
            */}
          {p.listFieldsSlot && (
            <div className={clsx(
              'border-t border-gray-900/[0.05] pt-2.5 dark:border-white/[0.06]',
              /*
               * Subordinate by construction, not by discipline.
               *
               * Scaled down and dimmed until touched: these are facts about
               * THIS LIST, not about the investment. They come back to full
               * presence on hover and on keyboard focus, so the demotion
               * costs nothing to anyone actually using them.
               */
              'origin-top-left scale-[0.92] opacity-60',
              'transition-opacity hover:opacity-100 focus-within:opacity-100',
            )}>
              {p.listFieldsSlot}
            </div>
          )}
        </>
      }
    />
  )
}

// ── Price ──────────────────────────────────────────────────────────────

/**
 * Where it has traded, against everything the desk decided about it.
 *
 * ── Why there is no rail ──────────────────────────────────────────────
 *
 * There was one, 320px of it, and every figure in it was already in the
 * verdict line directly above: rating, conviction, target, upside, position,
 * book, the open idea. The reader was being told the same seven facts twice,
 * forty pixels apart, and the second telling cost the chart a fifth of the
 * panel's width — which it spent going flatter, not taller. A column that
 * restates the line above it is not context, it is an echo.
 *
 * What the rail held that the verdict does not — `1 month` and the window's
 * high/low — the chart answers better: the range chips set the window and
 * the move is now labelled with it, and the high and low are the y-axis.
 *
 * So the panel is the chart, the scenario prices beneath it, and the dated
 * record beneath that. Everything that is not the chart is one line tall.
 *
 * ── Why this is one mode and not two ──────────────────────────────────
 *
 * It was Market and Valuation. Both drew this chart from the same series;
 * Valuation added the scenario rungs as levels. One mode that always draws
 * them is strictly more informative than two that disagree about whether to,
 * and it gives the switcher back a slot. See `listRowModes`.
 */
export function MarketMode(p: {
  symbol?: string
  /**
   * The price the rest of the surface is quoting.
   *
   * Handed to the chart so its headline figure cannot disagree with the
   * collapsed row that opened this panel — see `spot` on `PriceChart`.
   */
  spot: number | null
  closes: number[] | null
  target: number | null
  upsidePct: number | null
  /** The scenario ladder, drawn as levels on the chart and priced beneath it. */
  rungs: LadderRung[]
  /**
   * Dated closes, for the interactive chart.
   *
   * `closes` is the flat array the collapsed sparkline uses; this is the same
   * history with its dates, which is what makes scrubbing, ranges and dated
   * markers possible. Absent on callers that only have the flat array (mobile),
   * which fall back to the sparkline.
   */
  series?: PricePoint[] | null
  /** Case written, research arrived, idea raised — drawn on the line. */
  chartEvents?: PriceEvent[]
  footer?: React.ReactNode
}) {
  /*
   * Every price the desk committed to, on the scale the stock trades on.
   *
   * A target is the claim we are accountable for and is drawn in the accent;
   * a scenario rung is one of several and is drawn quiet. The target is
   * usually also a rung, so it is matched out — one band per level, not two
   * stacked on the same pixel with two labels fighting for it.
   */
  const bands: PriceLevel[] = []
  if (p.target != null) bands.push({ label: 'Target', price: p.target, kind: 'target' })
  for (const r of p.rungs) {
    if (p.target != null && Math.abs(r.price - p.target) < 0.005) continue
    bands.push({ label: r.name, price: r.price, kind: 'case' })
  }

  /** The fallback axis's scale, for a name with no price history on file. */
  const axisPrices = [...p.rungs.map(r => r.price), p.spot, p.target]
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
  const axisLo = axisPrices.length ? Math.min(...axisPrices) : null
  const axisHi = axisPrices.length ? Math.max(...axisPrices) : null
  const axisSpan = axisLo != null && axisHi != null ? (axisHi - axisLo) || 1 : 1
  const at = (n: number) => axisLo == null ? 0 : ((n - axisLo) / axisSpan) * 100

  /*
   * The dated events are drawn ON the line, by `chartEvents`.
   *
   * This used to also assemble them into a list rendered beneath the chart.
   * `ListRowExpansion.chartMarkers` builds the same three kinds from the same
   * canonical fields, so the panel stated them twice — and the second copy
   * cost about forty pixels of a frame the plot was already short of.
   */

  return (
    <ModeLayout
      footer={p.footer}
      main={
        <div className="flex flex-col h-full min-h-0 gap-3">
          {/*
            * The chart takes the panel. Nothing stands above it and nothing
            * stands beside it.
            *
            * Both of those have been tried. Three hero figures above it left
            * a 1,100 × 90 plot, the aspect ratio of a progress bar. A 320px
            * rail beside it left 1,439 × 230 — better than 6:1 — where a 6%
            * quarter is drawn as a jagged horizon. Width was never the
            * constraint; height was, and both arrangements spent height to
            * restate facts the chart or the verdict line already carried.
            *
            * `1Y` by default: the levels drawn on this scale are a target and
            * a set of scenarios, and a quarter of history is not enough
            * context to judge either. `PriceChart` caps its own aspect, so
            * the extra panel height cannot be converted back into flatness.
            */}
          {p.series && p.series.length > 1 ? (
            <div className="flex-1 min-h-0">
              <PriceChart
                symbol={p.symbol ?? ''}
                series={p.series}
                levels={bands}
                events={p.chartEvents ?? []}
                spot={p.spot}
                initialRange="1Y"
              />
            </div>
          ) : p.closes && p.closes.length > 1 ? (
            // No dated series, but we do have closes — the flat path is all
            // that can honestly be drawn without dates to scrub against.
            <div className="flex-1 min-h-0">
              <Sparkline points={p.closes} reference={p.target} />
            </div>
          ) : p.rungs.length > 0 && axisLo != null ? (
            /*
             * The fallback axis, for a name with no price history at all.
             *
             * One axis, not a bar per rung: three bars growing from a common
             * left edge read as progress meters — three quantities being
             * filled — when the fact is where each case sits on ONE price
             * scale and where today sits among them.
             */
            <div className="flex-1 min-h-0 flex flex-col justify-center">
              <div className="relative" style={{ height: 26 }}>
                <div className="absolute inset-x-0 top-[11px] h-px bg-gray-200 dark:bg-gray-700" />
                {p.rungs.map(r => (
                  <span key={r.id}
                    className="absolute top-[7px] -translate-x-1/2 h-2.5 w-[3px] rounded-full bg-gray-400 dark:bg-gray-500"
                    style={{ left: `${at(r.price)}%` }}
                    title={`${r.name} · ${money(r.price)}`}
                  />
                ))}
                {p.spot != null && (
                  <span
                    className="absolute -translate-x-1/2 flex flex-col items-center"
                    style={{ left: `${at(p.spot)}%`, top: 0 }}
                  >
                    <span className="h-5 w-[2px] rounded-full bg-gray-900 dark:bg-gray-100" />
                    <span className="mt-0.5 text-[9.5px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 whitespace-nowrap">
                      today
                    </span>
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex items-center">
              <Quiet>No price history on file.</Quiet>
            </div>
          )}

          {/*
            * The scenarios as one strip, not one row each.
            *
            * A four-column table of five scenarios is five lines, and in a
            * fixed-height panel those five lines come out of the chart. The
            * same facts fit on one line across the width the panel has: name,
            * probability, price, move from here — grouped so each scenario is
            * one object, separated by alignment rather than by a box. The
            * chart above carries the shape; this carries the numbers.
            */}
          {p.rungs.length > 0 && (
            <div className="flex-shrink-0 flex items-stretch flex-wrap gap-x-6 gap-y-2 pt-2.5 border-t border-gray-900/[0.06] dark:border-white/[0.07]">
              {p.rungs.map(r => {
                const up = p.spot != null && p.spot > 0
                  ? ((r.price - p.spot) / p.spot) * 100
                  : null
                return (
                  <div key={r.id} className="min-w-0 max-w-[190px]" title={r.reasoning ?? undefined}>
                    <div className="text-[9.5px] font-semibold uppercase tracking-[0.07em] text-gray-400 dark:text-gray-500 truncate">
                      {r.name}
                      {r.probability != null && (
                        <span className="ml-1.5 font-medium normal-case tracking-normal tabular-nums">
                          {Math.round(r.probability * 100)}%
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-baseline gap-1.5 tabular-nums">
                      <span className="text-[14px] font-semibold text-gray-900 dark:text-gray-100">
                        {money(r.price)}
                      </span>
                      {up != null && (
                        <span className={clsx(
                          'text-[11px] font-semibold',
                          up >= 0 ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400',
                        )}>{pct(up)}</span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/*
            * The dated record is NOT repeated here.
            *
            * It was a strip under the chart listing case-written, research
            * and idea dates — the same events `chartEvents` already draws as
            * markers on the line, at the position where they happened. Two
            * renderings of one set of facts, and the strip cost ~40px of a
            * frame the chart was already short of.
            *
            * The markers win because they answer the question the dates are
            * asked for: what the price did AROUND the event. A list of dates
            * underneath cannot say that, and the full record is in the case.
            */}
        </div>
      }
    />
  )
}

// ── Case ───────────────────────────────────────────────────────────────

/**
 * One section, read until clicked.
 *
 * Read mode is text, not a form field: three permanently-open textareas read as
 * a CRUD screen and lose the thing being written to. Save is on blur and only
 * when the text actually changed, so a stray focus cannot create a revision.
 */
export function CaseSectionEditor({
  sectionKey, label, content, authorName, onSave, hero,
}: {
  sectionKey: string
  label: string
  content: string
  authorName?: string | null
  onSave?: (sectionKey: string, content: string) => Promise<void>
  hero?: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(content) }, [content])

  const commit = async () => {
    setEditing(false)
    if (!onSave || draft.trim() === content.trim()) return
    setSaving(true)
    try { await onSave(sectionKey, draft) } finally { setSaving(false) }
  }

  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-2 mb-1">
        <Label>{label}</Label>
        {authorName && !editing && (
          <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">{authorName}</span>
        )}
        {saving && <span className="text-[10px] text-gray-400">saving…</span>}
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          rows={hero ? 6 : 3}
          className="w-full text-[13px] px-2 py-1.5 rounded bg-white dark:bg-gray-900 ring-1 ring-gray-900/15 dark:ring-gray-100/20 focus:outline-none focus:ring-gray-900/40 resize-none leading-relaxed"
        />
      ) : (
        <button
          onClick={onSave ? () => setEditing(true) : undefined}
          className="w-full text-left group/sec"
          aria-label={`Edit ${label}`}
        >
          {content.trim() ? (
            <p className={clsx(
              'whitespace-pre-wrap leading-relaxed',
              hero
                ? 'text-[13.5px] text-gray-800 dark:text-gray-200'
                : 'text-[12.5px] text-gray-600 dark:text-gray-400',
            )}>
              {content}
            </p>
          ) : (
            <span className="inline-flex items-center gap-1 text-[12px] text-gray-400 dark:text-gray-500 italic group-hover/sec:text-gray-700 dark:group-hover/sec:text-gray-200">
              <Pencil className="h-3 w-3" />
              Write {label.toLowerCase()}
            </span>
          )}
        </button>
      )}
    </div>
  )
}

export function ResearchMode(p: {
  symbol?: string
  caseSections: Array<{ key: string; row: any }>
  caseWrittenAt: string | null
  changes: EvidenceLike[]
  newSinceReview: number
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  scaleValues?: Array<{ value: string; label?: string }>
  onRate?: (v: string) => void
  onConviction?: (c: 'low' | 'medium' | 'high') => void
  busy?: boolean
  onSaveSection?: (sectionKey: string, content: string) => Promise<void>
  coverage?: Array<{ analyst: string; team: string; isLead: boolean }>
  /** The price the view implies. Part of the conclusion, so it sits with it. */
  target?: number | null
  upsidePct?: number | null
  footer?: React.ReactNode
}) {
  /*
   * The whole argument as one strip: VIEW | THESIS | WHERE WE DIFFER | RISKS |
   * CHANGED SINCE.
   *
   * It was a hero paragraph over a two-up grid with the evidence in a rail,
   * which meant the three parts of the case were read in three different
   * places and at two different sizes. They are one argument. Side by side at
   * one size, a reader takes the position in seconds and sees immediately
   * which part is missing — and an unwritten `risks` column is the single most
   * useful thing this mode can show a reviewer.
   */
  const [thesis, differ, risks] = p.caseSections
  const unread = p.changes.filter(c => c.isNewSinceReview)
  const band = 'min-w-0 border-l border-gray-900/[0.06] dark:border-white/[0.07] pl-4 first:border-0 first:pl-0'

  return (
    <ModeLayout
      footer={p.footer}
      main={
        <div className="grid grid-cols-[150px_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,0.78fr)_minmax(0,0.95fr)] gap-x-4">

          {/* ── View: the conclusion the argument reaches ───────── */}
          <div className={band}>
            <Label>View</Label>
            <div className="mt-2">
              <ViewControl
                value={p.ratingValue} color={p.ratingColor} conviction={p.conviction}
                scaleValues={p.scaleValues} onRate={p.onRate} onConviction={p.onConviction}
                busy={p.busy} symbol={p.symbol} size="lg"
              />
            </div>
            {p.conviction && (
              <div className="mt-1.5 text-[10.5px] text-gray-400 dark:text-gray-500">
                {p.conviction} conviction
              </div>
            )}
            {p.target != null && (
              <div className="mt-3 flex items-baseline gap-2 tabular-nums">
                <span className="text-[15px] font-semibold text-gray-900 dark:text-gray-50">{money(p.target)}</span>
                {p.upsidePct != null && (
                  <span className={clsx(
                    'text-[12px] font-semibold',
                    p.upsidePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                  )}>{pct(p.upsidePct)}</span>
                )}
              </div>
            )}
            <div className="mt-2 text-[10.5px] text-gray-400 dark:text-gray-500 leading-snug">
              {thesis?.row?.authorName && <>{thesis.row.authorName}<br /></>}
              {p.caseWrittenAt
                ? `written ${formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}`
                : 'never written'}
            </div>
          </div>

          {/* ── The three sections, side by side and at one size ── */}
          {[thesis, differ, risks].map((s, i) => s && (
            <div key={s.key} className={band}>
              <CaseSectionEditor
                sectionKey={s.key}
                label={SECTION_LABEL[s.key] ?? s.key}
                content={s.row?.content ?? ''}
                authorName={i === 0 ? null : s.row?.authorName}
                onSave={p.onSaveSection}
              />
              {/* The gap a reviewer reaches for first, named as a gap. */}
              {s.key === 'risks_to_thesis' && !(s.row?.content ?? '').trim() && (
                <div className="mt-2 text-[10.5px] text-gray-400 dark:text-gray-500 leading-snug">
                  The one section a reviewer would reach for first.
                </div>
              )}
            </div>
          ))}

          {/* ── What has happened to the argument since ─────────── */}
          <div className={band}>
            <Label>
              {unread.length > 0 ? `Changed since review · ${unread.length}` : 'Since review'}
            </Label>
            <div className="mt-2 space-y-2">
              {p.changes.length > 0
                ? p.changes.slice(0, 3).map(c => <EvidenceItemView key={c.id} item={c} />)
                : <Quiet>Nothing new on file.</Quiet>}
            </div>
            {p.coverage && p.coverage.length > 0 && (
              <div className="mt-3">
                <Label>Covered by</Label>
                <div className="mt-1 space-y-0.5">
                  {p.coverage.slice(0, 2).map((c, i) => (
                    <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      }
    />
  )
}

// ── The scenario ladder ────────────────────────────────────────────────

/*
 * `ValuationMode` used to live here.
 *
 * It drew `PriceMode`'s chart from the same series with the rungs added as
 * levels, which made it that mode plus information — so the rungs moved
 * there and this became one type. See the second half of `PriceMode`'s
 * docblock.
 */
export interface LadderRung {
  id: string
  name: string
  price: number
  probability?: number | null
  reasoning?: string | null
}

// ── Position ───────────────────────────────────────────────────────────

export interface PositionLike {
  portfolioId?: string | null
  portfolioName?: string | null
  shares?: number | null
  weightPct?: number | null
  marketValue?: number | null
  unrealisedPct?: number | null
}

/**
 * Current exposure against proposed exposure, as a change.
 *
 * ── Why this is a bar and not two figures ─────────────────────────────────
 *
 * "1.20%" beside "3.20%" is two numbers a reader has to subtract. The question
 * Position answers is "what are we considering DOING", and a change is a shape:
 * the filled part is what we hold, the extension is what the recommendation
 * would add, and the arrow between the two figures says which way it goes.
 *
 * Both numbers are stored facts — the current weight from `portfolio_holdings`
 * via the book's own NAV, the proposed from `trade_queue_items.proposed_weight`.
 * Shares and a dollar amount are deliberately absent: deriving either needs the
 * book's value, which this surface does not read.
 */
function ExposureDelta({
  currentPct, proposedPct, direction,
}: {
  currentPct: number | null
  proposedPct: number | null
  direction?: string | null
}) {
  if (currentPct == null && proposedPct == null) return null
  const isSell = (direction ?? '').toUpperCase() === 'SELL'
  /*
   * Headroom past whichever weight is larger, so both marks are comparable.
   * Full width for the proposed weight would say a 3% position fills the book.
   */
  const scaleMax = Math.max(proposedPct ?? 0, currentPct ?? 0) * 1.5 || 1
  const at = (n: number | null) => n == null ? 0 : Math.min(100, (n / scaleMax) * 100)
  const bps = currentPct != null && proposedPct != null
    ? Math.round((proposedPct - currentPct) * 100)
    : null

  return (
    <div className="min-w-0" data-testid="exposure-delta">
      <div className="flex items-end gap-3 flex-wrap">
        <Figure label="Current" size="hero"
          value={currentPct != null ? `${currentPct.toFixed(2)}%` : '—'} />
        {proposedPct != null && (
          <>
            <ArrowRight className="h-3.5 w-3.5 text-gray-400 mb-2 flex-shrink-0" />
            <Figure label="Proposed" size="hero"
              value={`${proposedPct.toFixed(2)}%`}
              tone={isSell ? 'down' : 'up'} />
            {bps != null && (
              <span className="mb-1.5 text-[12px] font-semibold tabular-nums text-gray-600 dark:text-gray-300">
                {bps >= 0 ? '+' : ''}{bps} bps
              </span>
            )}
          </>
        )}
      </div>
      {proposedPct != null && (
        <div className="mt-2.5 h-[6px] rounded-full bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
          <span className="absolute inset-y-0 left-0 bg-gray-800 dark:bg-gray-200 rounded-full"
            style={{ width: `${at(currentPct)}%` }} />
          {currentPct != null && proposedPct > currentPct && (
            <span className="absolute inset-y-0 bg-emerald-500/60"
              style={{ left: `${at(currentPct)}%`, width: `${at(proposedPct) - at(currentPct)}%` }} />
          )}
          {currentPct != null && proposedPct < currentPct && (
            // A reduction: the part being given up, hatched out of the held bar.
            <span className="absolute inset-y-0 bg-rose-500/50"
              style={{ left: `${at(proposedPct)}%`, width: `${at(currentPct) - at(proposedPct)}%` }} />
          )}
        </div>
      )}
    </div>
  )
}

export function PositionMode(p: {
  positions: PositionLike[]
  spot: number | null
  target: number | null
  upsidePct: number | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  ideaLabel?: string | null
  /** The live idea's proposed weight, where one exists. A stored field. */
  proposedWeightPct?: number | null
  ideaDirection?: string | null
  ideaStage?: string | null
  footer?: React.ReactNode
}) {
  const rows = [...p.positions].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
  const total = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0)
  const largest = rows[0]
  const proposing = p.proposedWeightPct != null

  /*
   * The books list is clamped, because its length is the DATA's.
   *
   * The panel is a fixed-height region inside a virtualised row and
   * `ModeLayout` clips rather than scrolls — so an unbounded list does not
   * grow the panel, it gets cut. A name in two books overflowed by 46px and
   * the second book was sliced through the middle of its own row: half a
   * number, with no scrollbar and nothing to say more existed.
   *
   * Three is what the budget holds beside the heroes. The rest are counted,
   * not hidden — and the full set is one click away in the case.
   */
  const BOOKS_SHOWN = 3
  const shownRows = rows.slice(0, BOOKS_SHOWN)
  const hiddenCount = rows.length - shownRows.length

  // Nothing held and nothing proposed is the only true empty. A recommendation
  // to open a position is the most important thing Position can say.
  if (rows.length === 0 && !proposing) {
    return <ModeLayout footer={p.footer} main={<Quiet>Not held in any book.</Quiet>} />
  }

  return (
    <ModeLayout
      footer={p.footer}
      railWidth="sm"
      main={
          // `h-full min-h-0 flex flex-col`, so the list below can be the part
          // that gives: a plain `space-y-4` block has no height of its own and
          // simply overran the clip.
          <div className="h-full min-h-0 flex flex-col gap-4">
            {/*
              * When a recommendation is live, the CHANGE leads — that is what the
              * reader is being asked about. Otherwise the holding does.
              */}
            {proposing ? (
              <ExposureDelta
                currentPct={largest?.weightPct ?? null}
                proposedPct={p.proposedWeightPct ?? null}
                direction={p.ideaDirection}
              />
            ) : (
            <div className="flex items-start gap-7 flex-wrap">
              <Figure label="Largest weight"
                value={largest?.weightPct != null ? `${largest.weightPct.toFixed(2)}%` : null}
                size="hero" sub={largest?.portfolioName} />
              <Figure label="Market value" size="hero"
                value={total > 0 ? `$${Math.round(total).toLocaleString()}` : null}
                sub={`${rows.length} book${rows.length === 1 ? '' : 's'}`} />
            </div>
            )}

            {/* No table chrome. Alignment carries the columns. Hidden entirely
                when there is nothing held — a recommendation to OPEN a position
                would otherwise render a header over no rows. */}
            {rows.length > 0 && (
            <div className="min-h-0">
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_84px] gap-x-3 pb-1">
                {['Book', 'Shares', 'Weight', 'Unrealised'].map((h, i) => (
                  <div key={h} className={i === 0 ? '' : 'text-right'}><Label>{h}</Label></div>
                ))}
              </div>
              <div className="divide-y divide-gray-150 dark:divide-gray-800">
                {shownRows.map((r, i) => (
                  <div key={r.portfolioId ?? i}
                    className="grid grid-cols-[minmax(0,1fr)_72px_72px_84px] gap-x-3 py-1.5 text-[12.5px] tabular-nums">
                    <span className="truncate text-gray-700 dark:text-gray-300">
                      {r.portfolioName ?? 'Unnamed book'}
                    </span>
                    <span className="text-right text-gray-500 dark:text-gray-400">
                      {r.shares?.toLocaleString() ?? '—'}
                    </span>
                    <span className="text-right font-semibold text-gray-900 dark:text-gray-100">
                      {r.weightPct != null ? `${r.weightPct.toFixed(2)}%` : '—'}
                    </span>
                    <span className={clsx(
                      'text-right font-semibold',
                      r.unrealisedPct == null ? 'text-gray-400'
                        : r.unrealisedPct >= 0
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-rose-600 dark:text-rose-400',
                    )}>
                      {r.unrealisedPct != null ? pct(r.unrealisedPct) : '—'}
                    </span>
                  </div>
                ))}
              </div>
              {/* Counted, not dropped. A list that silently ends at three is
                  a list that misreports the book count above it. */}
              {hiddenCount > 0 && (
                <p className="pt-1.5 text-[11.5px] text-gray-400 dark:text-gray-500">
                  +{hiddenCount} more {hiddenCount === 1 ? 'book' : 'books'} — open the full case
                </p>
              )}
            </div>
            )}
          </div>
      }
      rail={
        <>
          {/*
            * Only what the verdict line above does not already say.
            *
            * It stated Target, the upside and the rating a second time, forty
            * pixels under a sentence that reads "BUY at medium conviction ·
            * worth $212, +18.4% from here · 18.40% of Large Cap Value". The
            * price is the one market fact the verdict has no clause for.
            */}
          {proposing && p.ideaLabel && (
            <Figure label="Recommendation" size="md" value={p.ideaLabel} />
          )}
          <Figure label="Price" value={p.spot != null ? money(p.spot) : null} size="md" />
        </>
      }
    />
  )
}

// ── Work ───────────────────────────────────────────────────────────────

export type WorkShape = 'unread' | 'no-case' | 'idea' | 'revisit' | 'clear'

/**
 * Work reorganises around WHY the row was opened.
 *
 * Not one card with buttons around it: when three notes are unanswered, the
 * three notes are the content; when an idea is live, the idea is. The branch
 * order is the order the work is urgent in — unreviewed evidence first, because
 * it is the one state where the written case may already be wrong.
 */
export function WorkMode(p: {
  shape: WorkShape
  changes: EvidenceLike[]
  newSinceReview: number
  caseWrittenAt: string | null
  stateLabel?: string | null
  leadCase?: { key: string; content: string } | null
  idea?: {
    action?: string | null
    stage?: string | null
    portfolioName?: string | null
    conviction?: string | null
    rationale?: string | null
    /** Stored on the idea. Lets Work show what the decision would change. */
    proposedWeight?: number | null
    authorName?: string | null
    createdAt?: string | null
  } | null
  decisionLabel?: string | null
  /** True when the idea is at the final stage — somebody owes a decision. */
  awaitingDecision?: boolean
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  weightPct: number | null
  target?: number | null
  upsidePct?: number | null
  coverage?: Array<{ analyst: string; team: string; isLead: boolean }>
  footer?: React.ReactNode
}) {
  const stateRail = (
    <>
      {(p.ratingValue || p.conviction) && (
        <div>
          <Label>View</Label>
          <div className="mt-1.5">
            <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} />
          </div>
        </div>
      )}
      <Figure label="Position" size="md"
        value={p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : null} />
      {/* What the work is aiming at. On a decision this is the number the
          reader is being asked to agree with, so it belongs beside it. */}
      <Figure label="Target" size="md"
        value={p.target != null ? money(p.target) : null}
        tone={p.upsidePct == null ? 'flat' : p.upsidePct >= 0 ? 'up' : 'down'}
        sub={p.upsidePct != null ? `${pct(p.upsidePct)} upside` : null} />
      {/* The case being reviewed AGAINST, clamped. It is context for the work
          in the main column, not a second copy of Case mode. */}
      {p.leadCase && (
        <RailBlock label={SECTION_LABEL[p.leadCase.key] ?? 'The case'}>
          <p className="text-[11.5px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-4">
            {p.leadCase.content}
          </p>
        </RailBlock>
      )}
    </>
  )

  if (p.shape === 'unread') {
    const unread = p.changes.filter(c => c.isNewSinceReview)
    return (
      <ModeLayout
        footer={p.footer}
        rail={stateRail}
        main={
          <div className="space-y-3">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                {p.newSinceReview} new since the case was written
              </h3>
              {p.caseWrittenAt && (
                <span className="text-[10.5px] text-gray-400 dark:text-gray-500">
                  {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
                </span>
              )}
            </div>
            <div className="space-y-3">
              {unread.slice(0, 5).map(c => (
                <EvidenceItemView key={c.id} item={c} prominent />
              ))}
            </div>
          </div>
        }
      />
    )
  }

  if (p.shape === 'no-case') {
    return (
      <ModeLayout
        footer={p.footer}
        rail={p.changes.length > 0 ? (
          <RailBlock label="Evidence on file">
            <div className="space-y-2">
              {p.changes.slice(0, 5).map(c => <EvidenceItemView key={c.id} item={c} />)}
            </div>
          </RailBlock>
        ) : stateRail}
        main={
          <div className="h-full flex flex-col justify-center gap-2 max-w-md">
            <h3 className="text-[17px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
              No thesis on file
            </h3>
            <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
              Nothing here says what we believe about this name, so there is nothing to
              review against and no anchor for new research.
            </p>
          </div>
        }
      />
    )
  }

  if (p.shape === 'idea' && p.idea) {
    const dir = (p.idea.action ?? '').toUpperCase()
    const isBuy = dir === 'BUY'
    const proposed = p.idea.proposedWeight
    return (
      <ModeLayout
        footer={p.footer}
        rail={stateRail}
        railWidth="sm"
        main={
          <div className="h-full flex flex-col gap-2.5 min-h-0">
            {/*
              * The lifecycle state, at a size that matches its importance.
              *
              * Direction and stage are the headline — what we are doing and how
              * far along it is — with the book and the author on the line
              * beneath. Six small labelled figures made the most decisive fact
              * on the surface look like metadata.
              *
              * When a decision is actually owed, that is said in words rather
              * than implied by the stage: "ready to recommend" is a lifecycle
              * value, "Awaiting a decision" is what it means to the reader.
              */}
            <div className="flex-shrink-0 flex items-baseline gap-2.5 flex-wrap">
              {dir && (
                <span className={clsx(
                  'text-[17px] font-bold tracking-wide tabular-nums',
                  isBuy
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400',
                )}>
                  {dir}
                </span>
              )}
              <span className="text-[17px] font-semibold tracking-[-0.015em] text-gray-900 dark:text-gray-50">
                {/* The desk's words. `ready_to_recommend` is a database value. */}
                {p.awaitingDecision ? 'Awaiting a decision' : stageLabel(p.idea.stage)}
              </span>
              {p.awaitingDecision && (
                <span className="text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {stageLabel(p.idea.stage)}
                </span>
              )}
            </div>

            <div className="flex-shrink-0 flex items-baseline gap-2 text-[12px] text-gray-500 dark:text-gray-400 flex-wrap">
              {p.idea.portfolioName && (
                <span className="text-gray-700 dark:text-gray-300 font-medium">{p.idea.portfolioName}</span>
              )}
              {p.idea.authorName && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span>{p.idea.authorName}</span>
                </>
              )}
              {p.idea.createdAt && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span>{formatDistanceToNow(new Date(p.idea.createdAt), { addSuffix: true })}</span>
                </>
              )}
              {p.idea.conviction && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">·</span>
                  <span>{p.idea.conviction} conviction</span>
                </>
              )}
            </div>

            {/*
              * What the decision would actually change.
              *
              * The most concrete thing Work can show about a recommendation is
              * the exposure it asks for against the exposure we hold. Both are
              * stored; neither is inferred. Rendered compactly here because the
              * rationale below is the argument and this is the ask.
              */}
            {proposed != null && (
              <div className="flex-shrink-0 flex items-baseline gap-2 text-[12.5px] tabular-nums pt-0.5">
                <span className="text-gray-400 dark:text-gray-500">Exposure</span>
                <span className="font-semibold text-gray-700 dark:text-gray-200">
                  {p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : '—'}
                </span>
                <ArrowRight className="h-3 w-3 text-gray-400 flex-shrink-0" />
                <span className={clsx(
                  'font-semibold',
                  isBuy ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}>
                  {proposed.toFixed(2)}%
                </span>
                {p.weightPct != null && (
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    ({proposed >= p.weightPct ? '+' : ''}{Math.round((proposed - p.weightPct) * 100)} bps)
                  </span>
                )}
              </div>
            )}

            {p.idea.rationale && (
              <div className="flex-1 min-h-0 overflow-hidden pt-0.5">
                <SectionHeading>Rationale</SectionHeading>
                {/* Clamped, not scrolled. The whole rationale is one click
                    away in the idea workspace; a scrollbar here would hide
                    the rest behind a bar nobody looks for. */}
                <p className="mt-1.5 text-[13.5px] text-gray-700 dark:text-gray-300 leading-[1.55] whitespace-pre-wrap line-clamp-4">
                  {p.idea.rationale}
                </p>
              </div>
            )}
          </div>
        }
      />
    )
  }

  if (p.shape === 'revisit') {
    return (
      <ModeLayout
        footer={p.footer}
        rail={p.changes.length > 0 ? (
          <RailBlock label="Evidence on file">
            <div className="space-y-2">
              {p.changes.slice(0, 5).map(c => <EvidenceItemView key={c.id} item={c} />)}
            </div>
          </RailBlock>
        ) : stateRail}
        main={
          <div className="space-y-3 max-w-xl">
            <div className="flex items-baseline gap-2">
              <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
                {p.stateLabel ?? 'Review due'}
              </h3>
              {p.caseWrittenAt && (
                <span className="text-[10.5px] text-gray-400 dark:text-gray-500">
                  written {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
                </span>
              )}
            </div>
            {/* `line-clamp-[14]`: see the Overview columns — the frame is
                fixed and taller than it was, so the clamp grew with it. */}
            {p.leadCase ? (
              <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-[14]">
                {p.leadCase.content}
              </p>
            ) : (
              <Quiet>Nothing records when this case was last confirmed.</Quiet>
            )}
          </div>
        }
      />
    )
  }

  return (
    <ModeLayout
      footer={p.footer}
      rail={stateRail}
      main={
        <div className="h-full flex flex-col justify-center gap-2 max-w-md">
          <h3 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-gray-50">
            Nothing outstanding
          </h3>
          <p className="text-[13px] text-gray-500 dark:text-gray-400 leading-relaxed">
            The case is written and current, and no idea is live on this name.
          </p>
        </div>
      }
    />
  )
}

// ── Loading ────────────────────────────────────────────────────────────

/**
 * The shape of the mode that is coming, with no claims in it.
 *
 * Shaped per mode so the canvas does not jump when content lands. `aria-busy`
 * rather than a visible word: a row announcing "Loading…" for 200ms is noisier
 * than one that simply firms up.
 */
export function ModeSkeleton({ mode }: { mode: ListRowMode }) {
  const bar = 'rounded bg-gray-150 dark:bg-gray-800 motion-safe:animate-pulse'

  /*
   * PRICE has no rail, so its skeleton must not draw one.
   *
   * A skeleton exists to hold the shape the content will take; one that
   * promises a 212px sidebar and then resolves to a full-width chart is the
   * jump it was added to prevent.
   */
  if (mode === 'market') {
    return (
      <div className="h-full flex flex-col gap-3" aria-busy="true" data-testid="mode-skeleton">
        <div className="flex items-baseline gap-2.5">
          <div className={clsx(bar, 'h-5 w-24')} />
          <div className={clsx(bar, 'h-3 w-12')} />
          <div className={clsx(bar, 'ml-auto h-4 w-40')} />
        </div>
        <div className={clsx(bar, 'flex-1 min-h-0 w-full')} />
        <div className="flex gap-6">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-1.5">
              <div className={clsx(bar, 'h-2 w-14')} />
              <div className={clsx(bar, 'h-4 w-16')} />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="h-full grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,212px)] gap-x-6"
      aria-busy="true" data-testid="mode-skeleton">
      <div className="space-y-4 min-w-0">
        <div className="flex gap-7">
          {[0, 1, 2].map(i => (
            <div key={i} className="space-y-1.5">
              <div className={clsx(bar, 'h-2 w-10')} />
              <div className={clsx(bar, 'h-6 w-20')} />
            </div>
          ))}
        </div>
        <div className="space-y-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={clsx(bar, 'h-3', i === 3 ? 'w-3/5' : 'w-full')} />
          ))}
        </div>
      </div>
      <div className="hidden sm:block space-y-3 sm:border-l border-gray-200/70 dark:border-gray-700/60 sm:pl-5">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-1.5">
            <div className={clsx(bar, 'h-2 w-12')} />
            <div className={clsx(bar, 'h-3 w-full')} />
          </div>
        ))}
      </div>
    </div>
  )
}

export { ExternalLink, Plus, Pencil, ArrowUpRight, Check }
