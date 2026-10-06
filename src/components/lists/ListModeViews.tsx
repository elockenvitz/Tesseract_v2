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
import { ExternalLink, Plus, Pencil, ArrowUpRight, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Sparkline } from '../signals/Sparkline'
import { RatingPill, CoverageChip } from './ListRowAtoms'
import { SECTION_LABEL } from '../../lib/desktop-research/model'
import type { ListRowMode } from './listRowModes'

// ── Shared vocabulary ──────────────────────────────────────────────────

export const money = (n: number) => `$${n.toFixed(2)}`
export const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(1)}%`
const toneOf = (n: number | null | undefined) =>
  n == null ? 'flat' : n >= 0 ? 'up' : 'down'

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
  main, rail, footer,
}: { main: React.ReactNode; rail?: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      <div className={clsx(
        'flex-1 min-h-0 grid gap-x-6 gap-y-4',
        rail ? 'grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,212px)]' : 'grid-cols-1',
      )}>
        <div className="min-w-0 min-h-0 sm:overflow-y-auto sm:pr-1">{main}</div>
        {rail && (
          // One hairline, not a card. The rail is the same surface as the
          // workspace; it is separated by alignment, not by a container.
          <aside className="min-w-0 min-h-0 sm:overflow-y-auto sm:border-l border-gray-200/70 dark:border-gray-700/60 sm:pl-5 space-y-3">
            {rail}
          </aside>
        )}
      </div>
      {footer && (
        <div className="flex-shrink-0 flex items-center gap-2 flex-wrap pt-2.5 border-t border-gray-200/70 dark:border-gray-700/60">
          {footer}
        </div>
      )}
    </div>
  )
}

/** The one filled button a mode may have. */
export function PrimaryButton({
  children, onClick, icon: Icon,
}: { children: React.ReactNode; onClick?: () => void; icon?: React.ElementType }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11.5px] font-semibold rounded-md bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white transition-colors flex-shrink-0"
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
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
  const lead = p.writtenCaseSections[0]
  const unread = p.changes.filter(c => c.isNewSinceReview)
  const positionValue = p.weightPct != null
    ? `${p.weightPct.toFixed(2)}%`
    // A weight we cannot derive is not an absent position. Shares are the
    // honest fallback; nothing at all is the honest empty.
    : p.shares != null ? `${p.shares.toLocaleString()} sh` : null

  return (
    <ModeLayout
      footer={p.footer}
      main={
        <div className="h-full flex flex-col gap-3.5">
          {/* ── What we believe ──────────────────────────────────────── */}
          <section className="min-w-0">
            <div className="flex items-baseline gap-4 flex-wrap">
              <Label>What we believe</Label>
              {(p.ratingValue || p.conviction) && (
                <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} />
              )}
              {p.target != null && (
                <span className="text-[11.5px] tabular-nums text-gray-500 dark:text-gray-400">
                  target <span className="font-semibold text-gray-900 dark:text-gray-100">{money(p.target)}</span>
                  {p.upsidePct != null && (
                    <span className={clsx(
                      'ml-1 font-semibold',
                      p.upsidePct >= 0
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-rose-600 dark:text-rose-400',
                    )}>{pct(p.upsidePct)}</span>
                  )}
                </span>
              )}
              {lead?.row?.authorName && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500 truncate">
                  {lead.row.authorName}
                </span>
              )}
            </div>
            {lead ? (
              <p className="mt-1.5 text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-4">
                {lead.row?.content}
              </p>
            ) : (
              <p className="mt-1.5"><Quiet>No case written yet.</Quiet></p>
            )}
          </section>

          {/* ── What's happening ─────────────────────────────────────── */}
          <section className="min-w-0 flex-1 min-h-0">
            <div className="flex items-baseline gap-3">
              <Label>What's happening</Label>
              {p.caseWrittenAt && (
                <span className="text-[10px] text-gray-400 dark:text-gray-500">
                  case written {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
                </span>
              )}
            </div>
            <div className="mt-1.5 space-y-1.5">
              {p.changes.length > 0 ? (
                // Unreviewed first — `changes` is already ordered that way.
                p.changes.slice(0, 3).map(c => <EvidenceItemView key={c.id} item={c} />)
              ) : (
                <Quiet>Nothing new since the case was written.</Quiet>
              )}
            </div>
          </section>
        </div>
      }
      rail={
        <>
          {/* ── What we're doing ─────────────────────────────────────── */}
          <div>
            <Label>What we're doing</Label>
            <div className="mt-1.5 space-y-2.5">
              <Figure label="Price" value={p.spot != null ? money(p.spot) : null} size="md"
                tone={toneOf(p.changePct)}
                sub={p.changePct != null ? `${pct(p.changePct)} today` : null} />
              <Figure label="Position" value={positionValue} size="md" sub={p.bookName} />
              {p.ideaLabel && <Figure label="Open idea" value={p.ideaLabel} size="md" />}
              {unread.length > 0 && !p.ideaLabel && (
                <Figure label="Needs" size="md"
                  value={`${unread.length} to review`} />
              )}
            </div>
          </div>

          {/* The list's own fields, as one quiet line. They answer a question
              about this list rather than about the security, and used to take
              a third of the rail. */}
          {(p.coverage?.length || p.listFieldsSlot) && (
            <div className="pt-2.5 border-t border-gray-200/70 dark:border-gray-700/60 space-y-2">
              {p.coverage && p.coverage.length > 0 && (
                <div>
                  <Label>Covered by</Label>
                  <div className="mt-1 space-y-0.5">
                    {p.coverage.slice(0, 2).map((c, i) => (
                      <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
                    ))}
                  </div>
                </div>
              )}
              {p.listFieldsSlot}
            </div>
          )}
        </>
      }
    />
  )
}

// ── Market ─────────────────────────────────────────────────────────────

/**
 * What happened, and whether it matters to this investment.
 *
 * The chart is the hero but not the canvas: a month of movement on its own is
 * what the collapsed sparkline already said. What makes it an investment answer
 * is the rail beside it — what we own, what we think it is worth, and whether
 * anything was written about it recently.
 */
export function MarketMode(p: {
  symbol?: string
  spot: number | null
  changePct: number | null
  closes: number[] | null
  target: number | null
  upsidePct: number | null
  weightPct: number | null
  bookName?: string | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  changes: EvidenceLike[]
  ideaLabel?: string | null
  footer?: React.ReactNode
}) {
  const oneMonthPct = p.closes && p.closes.length > 1 && p.closes[0]
    ? ((p.closes[p.closes.length - 1] - p.closes[0]) / p.closes[0]) * 100
    : null
  const lo = p.closes?.length ? Math.min(...p.closes) : null
  const hi = p.closes?.length ? Math.max(...p.closes) : null

  return (
    <ModeLayout
      footer={p.footer}
      main={
        <div className="flex flex-col h-full min-h-0 gap-3">
          <div className="flex items-start gap-7 flex-shrink-0">
            <Figure label="Last" value={p.spot != null ? money(p.spot) : null} size="hero"
              tone={toneOf(p.changePct)}
              sub={p.changePct != null ? `${pct(p.changePct)} today` : null} />
            <Figure label="1 month" value={oneMonthPct != null ? pct(oneMonthPct) : null}
              size="hero" tone={toneOf(oneMonthPct)} />
            {/* No "1 month" caption: the figure beside it already says so. */}
            <Figure label="Range" size="sm"
              value={lo != null && hi != null ? `${lo.toFixed(2)} – ${hi.toFixed(2)}` : null} />
          </div>
          {p.closes && p.closes.length > 1 ? (
            /*
             * The target joins the chart's SCALE, so the distance to it is
             * visible rather than implied. See `Sparkline`.
             *
             * Capped rather than `flex-1`: left to fill, the chart took the
             * whole canvas on a name with no other context, which is the
             * sparkline again at four times the size.
             */
            <div className="min-h-[72px] max-h-[136px] flex-1">
              <Sparkline points={p.closes} reference={p.target} />
            </div>
          ) : (
            <Quiet>No price history on file.</Quiet>
          )}
        </div>
      }
      rail={
        <>
          {/* No wrapper heading: the rail IS the answer to "does it matter
              here", and a label over a label costs a line the budget does not
              have. Each figure renders only with a value — an empty labelled
              section is worse than a shorter rail. */}
          <Figure label="Position" size="md" sub={p.bookName}
            value={p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : null} />
          <Figure label="Target" size="md"
            value={p.target != null ? money(p.target) : null}
            tone={toneOf(p.upsidePct)}
            sub={p.upsidePct != null ? `${pct(p.upsidePct)} upside` : null} />
          {(p.ratingValue || p.conviction) && (
            <div>
              <Label>View</Label>
              <div className="mt-1.5">
                <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} />
              </div>
            </div>
          )}
          {p.ideaLabel && <Figure label="Open idea" size="sm" value={p.ideaLabel} />}
          {/* One note, not three. The rail has a budget, and the question this
              mode answers is whether the move matters — for which "somebody
              wrote something two days ago" is the signal, and the rest is the
              Case tab's job. */}
          {p.changes.length > 0 && (
            <RailBlock label="Written recently">
              <EvidenceItemView item={p.changes[0]} />
            </RailBlock>
          )}
        </>
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

export function CaseMode(p: {
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
  footer?: React.ReactNode
}) {
  const [leadKey, ...restKeys] = p.caseSections
  return (
    <ModeLayout
      footer={p.footer}
      main={
        <div className="space-y-4">
          {leadKey && (
            <CaseSectionEditor
              hero
              sectionKey={leadKey.key}
              label={SECTION_LABEL[leadKey.key] ?? leadKey.key}
              content={leadKey.row?.content ?? ''}
              authorName={leadKey.row?.authorName}
              onSave={p.onSaveSection}
            />
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
            {restKeys.map(s => (
              <CaseSectionEditor
                key={s.key}
                sectionKey={s.key}
                label={SECTION_LABEL[s.key] ?? s.key}
                content={s.row?.content ?? ''}
                authorName={s.row?.authorName}
                onSave={p.onSaveSection}
              />
            ))}
          </div>
        </div>
      }
      rail={
        <>
          <RailBlock label="How strongly">
            <ViewControl
              value={p.ratingValue} color={p.ratingColor} conviction={p.conviction}
              scaleValues={p.scaleValues} onRate={p.onRate} onConviction={p.onConviction}
              busy={p.busy} symbol={p.symbol} size="lg"
            />
            <div className="mt-2 text-[10.5px] text-gray-400 dark:text-gray-500">
              {p.caseWrittenAt
                ? `Written ${formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}`
                : 'Never written'}
            </div>
          </RailBlock>

          <RailBlock label={p.newSinceReview > 0 ? `${p.newSinceReview} new since review` : 'Since review'}>
            {p.changes.length > 0 ? (
              <div className="space-y-2">
                {p.changes.slice(0, 4).map(c => <EvidenceItemView key={c.id} item={c} />)}
              </div>
            ) : <Quiet>Nothing new on file.</Quiet>}
          </RailBlock>

          {p.coverage && p.coverage.length > 0 && (
            <RailBlock label="Covered by">
              <div className="space-y-0.5">
                {p.coverage.slice(0, 3).map((c, i) => (
                  <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
                ))}
              </div>
            </RailBlock>
          )}
        </>
      }
    />
  )
}

// ── Valuation ──────────────────────────────────────────────────────────

export interface LadderRung {
  id: string
  name: string
  price: number
  probability?: number | null
  reasoning?: string | null
}

/**
 * What it is worth, and against what.
 *
 * The rungs are drawn on a shared scale rather than listed, because the useful
 * fact is the SHAPE of the range and where today's price sits inside it — which
 * a column of numbers states but does not show.
 */
export function ValuationMode(p: {
  spot: number | null
  target: number | null
  upsidePct: number | null
  rungs: LadderRung[]
  weightPct: number | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  footer?: React.ReactNode
}) {
  const prices = [...p.rungs.map(r => r.price), p.spot, p.target]
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
  const lo = prices.length ? Math.min(...prices) : null
  const hi = prices.length ? Math.max(...prices) : null
  const span = lo != null && hi != null ? (hi - lo) || 1 : 1
  const at = (n: number) => lo == null ? 0 : ((n - lo) / span) * 100

  return (
    <ModeLayout
      footer={p.footer}
      main={
        <div className="space-y-5">
          <div className="flex items-start gap-7 flex-wrap">
            <Figure label="Target" value={p.target != null ? money(p.target) : null} size="hero"
              tone={toneOf(p.upsidePct)}
              sub={p.upsidePct != null ? `${pct(p.upsidePct)} from here` : null} />
            <Figure label="Price" value={p.spot != null ? money(p.spot) : null} size="hero" />
          </div>

          {p.rungs.length > 0 && lo != null ? (
            <div>
              <Label>Scenarios</Label>

              {/*
                * One axis, not a bar per rung.
                *
                * Three bars growing from a common left edge read as progress
                * meters — three quantities being filled — when the fact is
                * where each case sits on ONE price scale and where today sits
                * among them. A single line with ticks says that; it is also the
                * only way the distance between rungs is visible at all.
                */}
              <div className="mt-6 mb-5 relative" style={{ height: 26 }}>
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

              {/* Cheapest rung first, so the column reads in the same order as
                  the axis above it. */}
              <div className="divide-y divide-gray-150 dark:divide-gray-800">
                {p.rungs.map(r => {
                  const up = p.spot != null && p.spot > 0
                    ? ((r.price - p.spot) / p.spot) * 100
                    : null
                  return (
                    <div key={r.id}
                      className="grid grid-cols-[minmax(0,1fr)_84px_72px_48px] gap-x-3 py-1.5 items-baseline"
                      title={r.reasoning ?? undefined}>
                      <span className="text-[12.5px] text-gray-700 dark:text-gray-300 truncate">{r.name}</span>
                      <span className="text-right text-[12.5px] tabular-nums font-semibold text-gray-900 dark:text-gray-100">
                        {money(r.price)}
                      </span>
                      <span className={clsx(
                        'text-right text-[11.5px] tabular-nums font-semibold',
                        up == null ? 'text-gray-400'
                          : up >= 0 ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400',
                      )}>
                        {up != null ? pct(up) : '—'}
                      </span>
                      <span className="text-right text-[11px] tabular-nums text-gray-400 dark:text-gray-500">
                        {r.probability != null ? `${Math.round(r.probability * 100)}%` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          ) : (
            <Quiet>No scenario targets on file.</Quiet>
          )}
        </div>
      }
      rail={
        <>
          <Figure label="Position" size="md"
            value={p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : null} />
          {(p.ratingValue || p.conviction) && (
            <div>
              <Label>View</Label>
              <div className="mt-1.5">
                <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} />
              </div>
            </div>
          )}
        </>
      }
    />
  )
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

export function PositionMode(p: {
  positions: PositionLike[]
  spot: number | null
  target: number | null
  upsidePct: number | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  ideaLabel?: string | null
  footer?: React.ReactNode
}) {
  const rows = [...p.positions].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))
  const total = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0)
  const largest = rows[0]

  return (
    <ModeLayout
      footer={p.footer}
      main={
        rows.length === 0 ? <Quiet>Not held in any book.</Quiet> : (
          <div className="space-y-4">
            <div className="flex items-start gap-7 flex-wrap">
              <Figure label="Largest weight"
                value={largest?.weightPct != null ? `${largest.weightPct.toFixed(2)}%` : null}
                size="hero" sub={largest?.portfolioName} />
              <Figure label="Market value" size="hero"
                value={total > 0 ? `$${Math.round(total).toLocaleString()}` : null}
                sub={`${rows.length} book${rows.length === 1 ? '' : 's'}`} />
            </div>

            {/* No table chrome. Alignment carries the columns. */}
            <div>
              <div className="grid grid-cols-[minmax(0,1fr)_72px_72px_84px] gap-x-3 pb-1">
                {['Book', 'Shares', 'Weight', 'Unrealised'].map((h, i) => (
                  <div key={h} className={i === 0 ? '' : 'text-right'}><Label>{h}</Label></div>
                ))}
              </div>
              <div className="divide-y divide-gray-150 dark:divide-gray-800">
                {rows.map((r, i) => (
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
            </div>
          </div>
        )
      }
      rail={
        <>
          <Figure label="Price" value={p.spot != null ? money(p.spot) : null} size="md" />
          <Figure label="Target" value={p.target != null ? money(p.target) : null} size="md"
            tone={toneOf(p.upsidePct)}
            sub={p.upsidePct != null ? `${pct(p.upsidePct)} upside` : null} />
          {(p.ratingValue || p.conviction) && (
            <div>
              <Label>View</Label>
              <div className="mt-1.5">
                <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} />
              </div>
            </div>
          )}
          {p.ideaLabel && <Figure label="Open idea" size="sm" value={p.ideaLabel} />}
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
  } | null
  decisionLabel?: string | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  weightPct: number | null
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
    return (
      <ModeLayout
        footer={p.footer}
        rail={stateRail}
        main={
          <div className="space-y-4">
            <div className="flex items-start gap-7 flex-wrap">
              <Figure label="Idea" size="hero"
                value={(p.idea.action ?? 'idea').toUpperCase()}
                sub={p.idea.portfolioName} />
              <Figure label="Stage" size="md" value={p.idea.stage ?? null} />
              <Figure label="Conviction" size="md" value={p.idea.conviction ?? null} />
            </div>
            {p.idea.rationale && (
              <div>
                <Label>Rationale</Label>
                <p className="mt-1 text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">
                  {p.idea.rationale}
                </p>
              </div>
            )}
            {p.decisionLabel && (
              <div className="text-[11.5px] text-gray-500 dark:text-gray-400">
                Decision: {p.decisionLabel}
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
            {p.leadCase ? (
              <p className="text-[13px] text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap line-clamp-[8]">
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
        {mode === 'market' ? (
          <div className={clsx(bar, 'h-24 w-full')} />
        ) : (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={clsx(bar, 'h-3', i === 3 ? 'w-3/5' : 'w-full')} />
            ))}
          </div>
        )}
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
