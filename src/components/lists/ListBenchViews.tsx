/**
 * The engaged security's workbench, as composition only.
 *
 * ── Why this is not an expanded row ───────────────────────────────────────
 *
 * Engaging a security does not insert a panel into the table. The universe
 * RECEDES to a spine — so the reader keeps their place and can still see which
 * other names want them — and the security takes the canvas as a working
 * surface whose composition is chosen by WHY it was engaged.
 *
 * An inserted row cannot do that. `AssetTableView` must know every row's height
 * before it renders one, so an expansion gets a fixed budget of about 350px and
 * the table stays the dominant object on the screen. The bench has the page,
 * which is what lets a decision be stated at the size of a decision.
 *
 * ── Why this file holds no hooks ──────────────────────────────────────────
 *
 * Same contract as `ListModeViews`: the container (`ListWorkbench`) owns the
 * reads, the writes and the state; this file owns the picture, so it can be
 * rendered in the fixture gallery and actually be LOOKED at. `guard:gallery`
 * walks the gallery's import graph and fails on anything that reaches Supabase,
 * which is what keeps that true.
 *
 * ── What is absent, and why ───────────────────────────────────────────────
 *
 * The approved prototype also showed the price on the day the case was written,
 * a sector-relative return, a 52-week range, share and dollar sizing, and a
 * sentence interpreting whether the thesis still held. The first four are not
 * derivable from what we store; the last is an opinion. They are absent rather
 * than approximated — a workbench that invents its own evidence is worse than
 * one that admits a gap.
 */
import React from 'react'
import { ArrowLeft, ArrowRight, Pencil, Plus, Check, ExternalLink } from 'lucide-react'
import { clsx } from 'clsx'
import { formatDistanceToNow } from 'date-fns'
import { Sparkline } from '../signals/Sparkline'
import { CoverageChip } from './ListRowAtoms'
import {
  ViewControl, Figure, Label, SectionHeading, CaseSectionEditor, EvidenceItemView,
  money, pct, type EvidenceLike, type CaseSectionLike,
} from './ListModeViews'
import { SECTION_LABEL } from '../../lib/desktop-research/model'
import { stageLabel } from '../../lib/lists/work-state'
import type { WorkTier } from '../../lib/lists/work-state'
import { modeForEntryColumn } from './listRowModes'

export type BenchMode = 'overview' | 'market' | 'case' | 'work'

export const BENCH_MODE_LABEL: Record<BenchMode, string> = {
  overview: 'Overview', market: 'Market', case: 'Case', work: 'Work',
}
export const BENCH_MODE_ORDER: BenchMode[] = ['overview', 'market', 'case', 'work']

/**
 * The clicked field decides where the bench opens.
 *
 * Derived from `MODE_FOR_COLUMN` rather than restating it, so the two surfaces
 * cannot disagree about what a cell means. The bench has four surfaces where the
 * expansion had six: Valuation and Position each held one or two figures, and
 * those figures now sit in the rail of the surface that needs them — so those
 * two intents fold onto the surface that answers them.
 */
export function benchModeForColumn(columnId?: string): BenchMode {
  const mode = modeForEntryColumn(columnId)
  if (mode === 'valuation') return 'case'
  if (mode === 'position') return 'overview'
  return mode
}

// ── Shared pieces ──────────────────────────────────────────────────────

function Quiet({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-gray-400 dark:text-gray-500 italic">{children}</p>
}

/**
 * The context column.
 *
 * One hairline and alignment, not a card — the rail is the same surface as the
 * bench. 280px at `lg` and gone below it: a 280px column of context on a narrow
 * laptop is the main column squeezed into a gutter.
 */
function Rail({ children }: { children: React.ReactNode }) {
  return (
    <aside className="min-w-0 lg:border-l border-gray-900/[0.07] dark:border-white/10 lg:pl-6 space-y-4">
      {children}
    </aside>
  )
}

const TWO_COL = 'grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,264px)] gap-x-8 gap-y-6'

/** The continuation of the workflow. One per surface, at most. */
function Primary({ children, onClick, icon: Icon }: {
  children: React.ReactNode; onClick?: () => void; icon?: React.ElementType
}) {
  return (
    <button
      onClick={onClick}
      className="group/pa inline-flex items-center gap-2 h-9 pl-3.5 pr-3 rounded-lg bg-gray-900 text-white hover:bg-gray-800 active:bg-gray-950 dark:bg-white dark:text-gray-900 dark:hover:bg-gray-100 text-[13px] font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.22)] transition-colors"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
      <ArrowRight className="h-3.5 w-3.5 opacity-60 transition-transform duration-150 group-hover/pa:translate-x-0.5" />
    </button>
  )
}

function Secondary({ children, onClick, icon: Icon }: {
  children: React.ReactNode; onClick?: () => void; icon?: React.ElementType
}) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-lg border border-gray-900/10 dark:border-white/15 bg-white dark:bg-transparent text-[12.5px] font-medium text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {children}
    </button>
  )
}

export interface ReviewControl {
  isDone: boolean
  isPending: boolean
  onRecord: (outcome: 'holds' | 'changed' | 'needs_work') => void
}

/**
 * The three verdicts, in `ResearchDetail`'s wording and order.
 *
 * Same three everywhere, or the stale clock means something different depending
 * on where it was cleared.
 */
const REVIEW_CHOICES = [
  { outcome: 'holds' as const, label: 'Still holds' },
  { outcome: 'changed' as const, label: 'Changed' },
  { outcome: 'needs_work' as const, label: 'Needs work' },
]

function ReviewVerdict({ review }: { review: ReviewControl }) {
  if (review.isDone) {
    return (
      <span className="inline-flex items-center gap-1.5 h-9 text-[12.5px] font-semibold text-emerald-700 dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" /> Review recorded
      </span>
    )
  }
  return (
    <>
      {REVIEW_CHOICES.map(({ outcome, label }) => (
        <button
          key={outcome}
          onClick={() => review.onRecord(outcome)}
          disabled={review.isPending}
          className={clsx(
            'h-9 px-3.5 rounded-lg text-[12.5px] font-semibold transition-colors',
            outcome === 'holds'
              ? 'bg-gray-900 text-white hover:bg-gray-800 dark:bg-white dark:text-gray-900'
              : 'border border-gray-900/10 dark:border-white/15 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800',
            review.isPending && 'opacity-50 cursor-wait',
          )}
        >
          {label}
        </button>
      ))}
    </>
  )
}

/** The row of actions that closes a surface. One hairline above it. */
function ActionBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-6 pt-4 border-t border-gray-900/[0.07] dark:border-white/10 flex items-center gap-2.5 flex-wrap">
      {children}
    </div>
  )
}

// ── The spine ──────────────────────────────────────────────────────────

export interface SpineEntry {
  assetId: string
  symbol: string
  /** Decides the attention mark. Nothing is drawn for `clear`. */
  tier: WorkTier
}

/**
 * The universe, receded.
 *
 * Narrow on purpose: it exists so the reader keeps their place and can move to
 * the next name that wants them, not to stay fully readable. 150px at laptop
 * width, 178px once there is room — a ticker and one attention mark fit in both,
 * and the bench keeps the canvas.
 */
export function BenchSpine({
  entries, activeAssetId, onSelect,
}: {
  entries: SpineEntry[]
  activeAssetId: string
  onSelect: (assetId: string) => void
}) {
  return (
    <aside
      data-testid="bench-spine"
      className="w-[150px] xl:w-[178px] flex-none bg-gray-50/80 dark:bg-gray-900/40 border-r border-gray-900/[0.07] dark:border-white/10 overflow-y-auto py-2"
    >
      <div className="px-3.5 pb-1.5 text-[9.5px] font-semibold uppercase tracking-[0.085em] text-gray-400 dark:text-gray-500">
        Universe
      </div>
      {entries.map(e => {
        const on = e.assetId === activeAssetId
        return (
          <button
            key={e.assetId}
            onClick={() => onSelect(e.assetId)}
            aria-current={on ? 'true' : undefined}
            className={clsx(
              'w-full flex items-center gap-2 px-3.5 py-[7px] text-left transition-colors',
              on
                // A solid ground plus an inset bar, not a tint: at this width a
                // background tint alone is indistinguishable from hover.
                ? 'bg-white dark:bg-gray-800 shadow-[inset_2px_0_0_0_rgb(15,23,42)] dark:shadow-[inset_2px_0_0_0_rgb(241,245,249)]'
                : 'hover:bg-white/70 dark:hover:bg-gray-800/50',
            )}
          >
            <span className={clsx(
              'h-[5px] w-[5px] rounded-full flex-none',
              e.tier === 'decision' ? 'bg-primary-600 dark:bg-primary-400'
                : e.tier === 'clear' ? 'bg-transparent'
                  : 'bg-amber-500',
            )} />
            <span className={clsx(
              'text-[12.5px] tracking-[-0.01em] truncate tabular-nums',
              on
                ? 'font-bold text-gray-900 dark:text-gray-50'
                : 'font-medium text-gray-500 dark:text-gray-400',
            )}>
              {e.symbol}
            </span>
          </button>
        )
      })}
    </aside>
  )
}

// ── The header ─────────────────────────────────────────────────────────

/**
 * Identity, why the reader is here, and where they can go.
 *
 * The "why" chip is a stored state — a decision awaiting someone, or the
 * research lifecycle's own label. It is never a conclusion about the thesis.
 */
export function BenchHeader({
  symbol, companyName, why, mode, onModeChange, onClose,
}: {
  symbol: string
  companyName?: string | null
  why?: { tone: 'decide' | 'warn'; text: string } | null
  mode: BenchMode
  onModeChange: (m: BenchMode) => void
  onClose: () => void
}) {
  return (
    <header className="flex-none flex items-center gap-3 px-5 py-2.5 border-b border-gray-900/[0.07] dark:border-white/10">
      <button
        onClick={onClose}
        aria-label="Back to the universe"
        className="p-1 -ml-1 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-100 dark:hover:text-gray-100 dark:hover:bg-gray-800 flex-none"
      >
        <ArrowLeft className="h-4 w-4" />
      </button>
      <span className="text-[18px] font-bold tracking-[-0.022em] text-gray-900 dark:text-white tabular-nums flex-none">
        {symbol}
      </span>
      {companyName && (
        <span className="text-[13px] text-gray-400 dark:text-gray-500 truncate min-w-0 max-sm:hidden">
          {companyName}
        </span>
      )}
      {why && (
        <span className={clsx(
          'text-[11.5px] font-semibold px-2 py-0.5 rounded-full flex-none whitespace-nowrap',
          why.tone === 'decide'
            ? 'bg-primary-50 text-primary-800 dark:bg-primary-900/40 dark:text-primary-200'
            : 'bg-amber-50 text-amber-800 dark:bg-amber-900/30 dark:text-amber-200',
        )}>
          {why.text}
        </span>
      )}

      <nav
        role="tablist"
        className="ml-auto flex items-center gap-0.5 p-[3px] rounded-lg bg-gray-900/[0.06] dark:bg-black/30 flex-none"
      >
        {BENCH_MODE_ORDER.map(m => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            onClick={() => onModeChange(m)}
            className={clsx(
              'px-2.5 py-[3px] rounded-[6px] text-[11.5px] transition-colors whitespace-nowrap',
              mode === m
                ? 'bg-white text-gray-900 font-semibold shadow-[0_1px_2px_rgba(15,23,42,0.10)] dark:bg-gray-700 dark:text-white'
                : 'font-medium text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100',
            )}
          >
            {BENCH_MODE_LABEL[m]}
          </button>
        ))}
      </nav>
    </header>
  )
}

// ── Work ───────────────────────────────────────────────────────────────

export interface BenchIdea {
  direction: string | null
  stage: string | null
  portfolioName: string | null
  proposedWeight: number | null
  rationale: string | null
  authorName: string | null
  createdAt: string | null
  conviction: string | null
}

export interface WorkSurfaceProps {
  /** The live idea, where there is one. Work is not a decision surface without it. */
  idea: BenchIdea | null
  tier: WorkTier
  /** The research lifecycle's own words, where it has something to say. */
  stateLabel: string | null
  /** The hygiene fact that outranks nothing but is worth knowing first. */
  secondary: string | null
  changes: EvidenceLike[]
  caseWrittenAt: string | null
  leadCase: CaseSectionLike | null
  weightPct: number | null
  target: number | null
  upsidePct: number | null
  coverage?: Array<{ analyst: string; team: string; isLead: boolean }>
  review: ReviewControl
  onOpenAsset?: () => void
  onGoToCase: () => void
  onCreateIdea?: () => void
}

/**
 * Work reorganises around what is actually open on this name.
 *
 * Deliberately not "the decision surface": most names in a list have no pending
 * recommendation, and a decision layout rendered for them is four empty figures
 * and a disabled button. The branch order is the order the work is urgent in —
 * a live idea first, then evidence the written case has not answered, then a
 * case that does not exist, then one merely due a look.
 */
export function WorkSurface(p: WorkSurfaceProps) {
  const unread = p.changes.filter(c => c.isNewSinceReview)

  const rail = (
    <Rail>
      {p.secondary && (
        <div>
          <Label>Before you act</Label>
          <div className="mt-1.5 flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-50/70 dark:bg-amber-900/20">
            <span className="mt-[5px] h-1.5 w-1.5 rounded-full bg-amber-500 flex-none" />
            <span className="text-[12.5px] font-semibold text-amber-800 dark:text-amber-200">
              {p.secondary}
            </span>
          </div>
        </div>
      )}
      {/* The case being worked AGAINST, clamped. Context for the main column,
          not a second copy of Case. */}
      {p.leadCase && (
        <div>
          <Label>{SECTION_LABEL[p.leadCase.key] ?? 'The case'}</Label>
          <p className="mt-1.5 text-[12.5px] text-gray-500 dark:text-gray-400 leading-relaxed line-clamp-5">
            {p.leadCase.row?.content}
          </p>
          <div className="mt-1 text-[10.5px] text-gray-400 dark:text-gray-500">
            {p.leadCase.row?.authorName ? `${p.leadCase.row.authorName}` : ''}
            {p.caseWrittenAt
              ? `${p.leadCase.row?.authorName ? ' · ' : ''}${formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}`
              : ''}
          </div>
        </div>
      )}
      <Figure
        label="Target" size="md"
        value={p.target != null ? money(p.target) : null}
        tone={p.upsidePct == null ? 'flat' : p.upsidePct >= 0 ? 'up' : 'down'}
        sub={p.upsidePct != null ? `${pct(p.upsidePct)} from the stored price` : null}
      />
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
    </Rail>
  )

  // ── A live idea: what we are doing, and what it would change ──
  if (p.idea) {
    const dir = (p.idea.direction ?? '').toUpperCase()
    const isBuy = dir === 'BUY'
    const proposed = p.idea.proposedWeight
    const cur = p.weightPct
    /*
     * The bar's scale: headroom past whichever weight is larger.
     *
     * Full width for the proposed weight would say a 3% position fills the
     * book. Half again the larger of the two keeps both marks comparable and
     * leaves the change visible as a change.
     */
    const scaleMax = Math.max(proposed ?? 0, cur ?? 0) * 1.5 || 1
    const at = (n: number | null) => n == null ? 0 : Math.min(100, (n / scaleMax) * 100)

    return (
      <div className={TWO_COL} data-testid="bench-work-idea">
        <div className="min-w-0">
          <div className="flex items-baseline gap-3 flex-wrap">
            {dir && (
              <span className={clsx(
                'text-[26px] font-extrabold tracking-wide tabular-nums leading-none',
                isBuy ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>{dir}</span>
            )}
            <span className="text-[26px] font-semibold tracking-[-0.028em] text-gray-900 dark:text-gray-50 leading-none">
              {/* The desk's words. `ready_to_recommend` is a database value. */}
              {stageLabel(p.idea.stage)}
            </span>
          </div>
          <div className="mt-2 flex items-baseline gap-2 flex-wrap text-[13px] text-gray-500 dark:text-gray-400">
            {p.idea.portfolioName && (
              <span className="font-semibold text-gray-700 dark:text-gray-200">{p.idea.portfolioName}</span>
            )}
            {p.idea.authorName && <><span className="text-gray-300 dark:text-gray-600">·</span><span>{p.idea.authorName}</span></>}
            {p.idea.createdAt && <><span className="text-gray-300 dark:text-gray-600">·</span>
              <span>{formatDistanceToNow(new Date(p.idea.createdAt), { addSuffix: true })}</span></>}
            {p.idea.conviction && <><span className="text-gray-300 dark:text-gray-600">·</span>
              <span>{p.idea.conviction} conviction</span></>}
          </div>

          {/*
            * Current → proposed, as a change rather than two facts.
            *
            * Both numbers are stored: the current weight from holdings, the
            * proposed from the idea itself. The prototype also showed shares and
            * a dollar amount — deriving either needs the book's own value, which
            * this surface does not read, so only the weights are shown.
            */}
          {(cur != null || proposed != null) && (
            <div className="mt-5 p-4 rounded-xl bg-gray-50 dark:bg-gray-800/50">
              <div className="flex items-end gap-6 flex-wrap">
                <div>
                  <Label>Current</Label>
                  <div className="mt-1 text-[21px] font-semibold tracking-[-0.024em] tabular-nums text-gray-900 dark:text-gray-50 leading-none">
                    {cur != null ? `${cur.toFixed(2)}%` : '—'}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400 mb-1.5" />
                <div>
                  <Label>Proposed</Label>
                  <div className={clsx(
                    'mt-1 text-[21px] font-semibold tracking-[-0.024em] tabular-nums leading-none',
                    proposed != null
                      ? isBuy ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                      : 'text-gray-400 dark:text-gray-500 text-[15px]',
                  )}>
                    {proposed != null ? `${proposed.toFixed(2)}%` : 'not sized'}
                  </div>
                </div>
                {cur != null && proposed != null && (
                  <div className="mb-1 text-[13px] font-semibold text-gray-600 dark:text-gray-300 tabular-nums">
                    {proposed >= cur ? '+' : ''}{Math.round((proposed - cur) * 100)} bps
                  </div>
                )}
              </div>
              {proposed != null && (
                <div className="mt-3 h-[7px] rounded-full bg-gray-200 dark:bg-gray-700 relative overflow-hidden">
                  <span className="absolute inset-y-0 left-0 bg-gray-800 dark:bg-gray-200 rounded-full"
                    style={{ width: `${at(cur)}%` }} />
                  {cur != null && proposed > cur && (
                    <span className="absolute inset-y-0 bg-emerald-500/60"
                      style={{ left: `${at(cur)}%`, width: `${at(proposed) - at(cur)}%` }} />
                  )}
                </div>
              )}
            </div>
          )}

          {p.idea.rationale && (
            <div className="mt-5">
              <SectionHeading>Rationale</SectionHeading>
              <p className="mt-1.5 text-[13.5px] text-gray-700 dark:text-gray-300 leading-[1.55] whitespace-pre-wrap">
                {p.idea.rationale}
              </p>
            </div>
          )}

          {/*
            * The decision is not taken here.
            *
            * Accepting a recommendation needs a parsed sizing input, a fan-in
            * whose partial failure has to be surfaced, and PM authority —
            * `acceptFromInbox` is the only correct path. A second, weaker writer
            * on a list surface is exactly what we were told not to build, so
            * this opens the place where the decision is actually made.
            */}
          <ActionBar>
            {p.onOpenAsset && (
              <Primary onClick={p.onOpenAsset} icon={ExternalLink}>
                {p.tier === 'decision' ? 'Review the recommendation' : 'Continue the idea'}
              </Primary>
            )}
            <Secondary onClick={p.onGoToCase} icon={Pencil}>Update the case</Secondary>
          </ActionBar>
        </div>
        {rail}
      </div>
    )
  }

  // ── Evidence the written case has not answered ──
  if (unread.length > 0) {
    return (
      <div className={TWO_COL} data-testid="bench-work-unread">
        <div className="min-w-0">
          <h3 className="text-[17px] font-semibold tracking-[-0.018em] text-gray-900 dark:text-gray-50">
            {unread.length} new since the case was written
          </h3>
          {p.caseWrittenAt && (
            <div className="mt-1 text-[12px] text-gray-400 dark:text-gray-500">
              written {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
            </div>
          )}
          <div className="mt-4 space-y-3.5">
            {unread.slice(0, 6).map(c => <EvidenceItemView key={c.id} item={c} prominent />)}
          </div>
          <ActionBar>
            <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mr-1">
              Does the case still hold?
            </span>
            <ReviewVerdict review={p.review} />
            <Secondary onClick={p.onGoToCase} icon={Pencil}>Update the case</Secondary>
          </ActionBar>
        </div>
        {rail}
      </div>
    )
  }

  // ── Nothing to review against ──
  if (!p.leadCase) {
    return (
      <div className="max-w-xl" data-testid="bench-work-no-case">
        <h3 className="text-[19px] font-semibold tracking-[-0.02em] text-gray-900 dark:text-gray-50">
          No thesis on file
        </h3>
        <p className="mt-2 text-[13.5px] text-gray-500 dark:text-gray-400 leading-relaxed">
          Nothing here says what we believe about this name, so there is nothing to review
          against and no anchor for new research.
        </p>
        <ActionBar>
          <Primary onClick={p.onGoToCase} icon={Pencil}>Write the case</Primary>
        </ActionBar>
      </div>
    )
  }

  // ── A case that is current, or merely due a look ──
  const settled = p.tier === 'clear'
  return (
    <div className={TWO_COL} data-testid={settled ? 'bench-work-clear' : 'bench-work-revisit'}>
      <div className="min-w-0">
        <h3 className="text-[17px] font-semibold tracking-[-0.018em] text-gray-900 dark:text-gray-50">
          {settled ? 'Nothing outstanding' : p.stateLabel ?? 'Review due'}
        </h3>
        <div className="mt-1 text-[12px] text-gray-400 dark:text-gray-500">
          {p.caseWrittenAt
            ? `case written ${formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}`
            : 'nothing records when this case was written'}
        </div>
        <p className="mt-4 text-[13.5px] text-gray-700 dark:text-gray-300 leading-[1.55] whitespace-pre-wrap line-clamp-[8]">
          {p.leadCase.row?.content}
        </p>
        <ActionBar>
          {!settled && (
            <>
              <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mr-1">
                Does the case still hold?
              </span>
              <ReviewVerdict review={p.review} />
            </>
          )}
          {settled && p.onCreateIdea && (
            <Primary onClick={p.onCreateIdea} icon={Plus}>Start an idea</Primary>
          )}
          <Secondary onClick={p.onGoToCase} icon={Pencil}>Update the case</Secondary>
        </ActionBar>
      </div>
      {rail}
    </div>
  )
}

// ── Market ─────────────────────────────────────────────────────────────

export interface MarketSurfaceProps {
  closes: number[] | null
  spot: number | null
  target: number | null
  upsidePct: number | null
  weightPct: number | null
  bookName?: string | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  changes: EvidenceLike[]
  caseWrittenAt: string | null
  idea: BenchIdea | null
}

/**
 * What happened, and the dated record around it.
 *
 * The chart is the hero, but a month of movement is what the collapsed
 * sparkline already said. What makes it an investment answer is what we wrote
 * while it was happening — so the events sit under the chart on the same time
 * axis in words, and the rail holds what we own and what we think it is worth.
 *
 * The prototype put a price against each event. We store no price history deep
 * enough to read one, so the dates stand alone rather than carrying a number
 * nothing supports.
 */
export function MarketSurface(p: MarketSurfaceProps) {
  const oneMonth = p.closes && p.closes.length > 1 && p.closes[0]
    ? ((p.closes[p.closes.length - 1] - p.closes[0]) / p.closes[0]) * 100
    : null
  const lo = p.closes?.length ? Math.min(...p.closes) : null
  const hi = p.closes?.length ? Math.max(...p.closes) : null

  const timeline: Array<{ k: string; at: string; head: string; body: string | null }> = []
  if (p.caseWrittenAt) {
    timeline.push({ k: 'case', at: p.caseWrittenAt, head: 'Case written', body: null })
  }
  for (const c of p.changes.slice(0, 3)) {
    timeline.push({
      k: c.id, at: c.createdAt, head: c.title || 'Research note',
      body: c.isNewSinceReview ? 'Not yet reflected in the case' : c.authorName ?? null,
    })
  }
  if (p.idea?.createdAt) {
    timeline.push({
      k: 'idea', at: p.idea.createdAt,
      head: `${(p.idea.direction ?? '').toUpperCase()} ${stageLabel(p.idea.stage)}`.trim(),
      body: p.idea.portfolioName,
    })
  }
  timeline.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))

  return (
    <div className="space-y-5" data-testid="bench-market">
      <div className="flex items-end gap-9 flex-wrap">
        <div>
          <Label>Last</Label>
          <div className="mt-1 text-[28px] font-semibold tracking-[-0.03em] tabular-nums text-gray-900 dark:text-gray-50 leading-none">
            {p.spot != null ? money(p.spot) : '—'}
          </div>
        </div>
        {oneMonth != null && (
          <div>
            <Label>1 month</Label>
            <div className={clsx(
              'mt-1 text-[28px] font-semibold tracking-[-0.03em] tabular-nums leading-none',
              oneMonth >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
            )}>{pct(oneMonth)}</div>
          </div>
        )}
        {lo != null && hi != null && (
          <div>
            <Label>1 month range</Label>
            <div className="mt-1 text-[17px] font-semibold tabular-nums text-gray-700 dark:text-gray-200 leading-none">
              {lo.toFixed(2)} – {hi.toFixed(2)}
            </div>
          </div>
        )}
        {p.target != null && (
          <div className="sm:ml-auto sm:text-right">
            <Label>Our target</Label>
            <div className="mt-1 text-[17px] font-semibold tabular-nums text-gray-900 dark:text-gray-50 leading-none">
              {money(p.target)}
            </div>
            {p.upsidePct != null && (
              <div className={clsx(
                'mt-1 text-[12px] font-semibold tabular-nums',
                p.upsidePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
              )}>{pct(p.upsidePct)} from here</div>
            )}
          </div>
        )}
      </div>

      {p.closes && p.closes.length > 1 ? (
        // The target joins the chart's SCALE, so the distance to it is visible
        // rather than implied. See `Sparkline`.
        <div className="h-[136px]">
          <Sparkline points={p.closes} reference={p.target} />
        </div>
      ) : (
        <Quiet>No price history on file.</Quiet>
      )}

      <div className={clsx(TWO_COL, 'pt-4 border-t border-gray-900/[0.07] dark:border-white/10')}>
        <div className="min-w-0">
          <SectionHeading>What happened around it</SectionHeading>
          {timeline.length > 0 ? (
            <div className="mt-2.5 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
              {timeline.slice(0, 4).map(e => (
                <div key={e.k} className="min-w-0">
                  <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                    {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                  </div>
                  <div className="mt-0.5 text-[13px] font-semibold tracking-[-0.008em] text-gray-900 dark:text-gray-50 truncate">
                    {e.head}
                  </div>
                  {e.body && (
                    <div className="mt-0.5 text-[12px] text-gray-500 dark:text-gray-400 leading-snug truncate">
                      {e.body}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : <Quiet>Nothing recorded against this name yet.</Quiet>}
        </div>

        <Rail>
          <Figure label="Position" size="md"
            value={p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : null} sub={p.bookName} />
          {(p.ratingValue || p.conviction) && (
            <div>
              <Label>View</Label>
              <div className="mt-1.5">
                <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} />
              </div>
            </div>
          )}
          {p.idea && (
            <Figure label="Open idea" size="md"
              value={`${(p.idea.direction ?? '').toUpperCase()} · ${stageLabel(p.idea.stage)}`.trim()}
              sub={p.idea.portfolioName} />
          )}
        </Rail>
      </div>
    </div>
  )
}

// ── Case ───────────────────────────────────────────────────────────────

export interface CaseSurfaceProps {
  symbol: string
  caseSections: CaseSectionLike[]
  caseWrittenAt: string | null
  changes: EvidenceLike[]
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  scaleValues?: Array<{ value: string; label?: string }>
  onRate?: (v: string) => void
  onConviction?: (c: 'low' | 'medium' | 'high') => void
  busy?: boolean
  onSaveSection?: (sectionKey: string, content: string) => Promise<void>
  target: number | null
  upsidePct: number | null
  weightPct: number | null
  bookName?: string | null
  proposedWeight: number | null
  review: ReviewControl
}

/**
 * What we believe, with what changed since beside it.
 *
 * The case gets the wider column and real line height — it is prose somebody
 * has to read, and the previous version's two-up grid of 12.5px sections read
 * as a form. The conclusion (rating, conviction, target) sits above it, because
 * that is the order the argument is made in.
 */
export function CaseSurface(p: CaseSurfaceProps) {
  const [lead, ...rest] = p.caseSections
  const unread = p.changes.filter(c => c.isNewSinceReview)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] gap-x-10 gap-y-6" data-testid="bench-case">
      <div className="min-w-0">
        <div className="flex items-center gap-4 flex-wrap pb-3 border-b border-gray-900/[0.07] dark:border-white/10">
          <ViewControl
            value={p.ratingValue} color={p.ratingColor} conviction={p.conviction}
            scaleValues={p.scaleValues} onRate={p.onRate} onConviction={p.onConviction}
            busy={p.busy} symbol={p.symbol} size="lg"
          />
          {p.target != null && (
            <span className="flex items-baseline gap-1.5 tabular-nums">
              <span className="text-[15px] font-semibold text-gray-900 dark:text-gray-50">{money(p.target)}</span>
              {p.upsidePct != null && (
                <span className={clsx(
                  'text-[12px] font-semibold',
                  p.upsidePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                )}>{pct(p.upsidePct)}</span>
              )}
            </span>
          )}
          <span className="ml-auto text-[11.5px] text-gray-400 dark:text-gray-500">
            {p.caseWrittenAt
              ? `written ${formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}`
              : 'never written'}
          </span>
        </div>

        {lead && (
          <div className="mt-4">
            <CaseSectionEditor
              hero
              sectionKey={lead.key}
              label={SECTION_LABEL[lead.key] ?? lead.key}
              content={lead.row?.content ?? ''}
              authorName={lead.row?.authorName}
              onSave={p.onSaveSection}
            />
          </div>
        )}
        <div className="mt-5 space-y-5">
          {rest.map(s => (
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

        <ActionBar>
          <span className="text-[12.5px] font-semibold text-gray-600 dark:text-gray-300 mr-1">
            Does this case still hold?
          </span>
          <ReviewVerdict review={p.review} />
        </ActionBar>
      </div>

      <Rail>
        {/* Unreviewed evidence is marked by the one amber rule on the surface.
            A reader editing the case needs to see what it has not answered. */}
        <div className={clsx(unread.length > 0 && 'border-l-2 border-amber-500 pl-3.5')}>
          <Label>{unread.length > 0 ? `${unread.length} new since review` : 'Since review'}</Label>
          <div className="mt-2 space-y-2.5">
            {p.changes.length > 0
              ? p.changes.slice(0, 5).map(c => <EvidenceItemView key={c.id} item={c} />)
              : <Quiet>Nothing new on file.</Quiet>}
          </div>
        </div>
        <Figure
          label="Position" size="md"
          value={p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : null}
          sub={p.proposedWeight != null
            ? `${p.bookName ?? 'book'} · ${p.proposedWeight.toFixed(2)}% proposed`
            : p.bookName}
        />
      </Rail>
    </div>
  )
}

// ── Overview ───────────────────────────────────────────────────────────

export interface OverviewSurfaceProps {
  spot: number | null
  target: number | null
  upsidePct: number | null
  weightPct: number | null
  bookName?: string | null
  ratingValue: string | null
  ratingColor: string | null
  conviction: 'low' | 'medium' | 'high' | null
  leadCase: CaseSectionLike | null
  changes: EvidenceLike[]
  caseWrittenAt: string | null
  idea: BenchIdea | null
  /** `workStateFor`'s label, so Overview names the work in the same words. */
  workLabel: string | null
  coverage?: Array<{ analyst: string; team: string; isLead: boolean }>
  onGo: (m: BenchMode) => void
}

/** Three questions, in this order: what we believe, what's happening, what we're doing. */
export function OverviewSurface(p: OverviewSurfaceProps) {
  return (
    <div className={TWO_COL} data-testid="bench-overview">
      <div className="min-w-0">
        <section className="pb-4 border-b border-gray-900/[0.06] dark:border-white/[0.07]">
          <div className="flex items-center gap-3.5 flex-wrap">
            <SectionHeading>What we believe</SectionHeading>
            {(p.ratingValue || p.conviction) && (
              <ViewControl value={p.ratingValue} color={p.ratingColor} conviction={p.conviction} size="lg" />
            )}
            {p.target != null && (
              <span className="flex items-baseline gap-1.5 tabular-nums">
                <span className="text-[15px] font-semibold text-gray-900 dark:text-gray-50">{money(p.target)}</span>
                {p.upsidePct != null && (
                  <span className={clsx(
                    'text-[12px] font-semibold',
                    p.upsidePct >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
                  )}>{pct(p.upsidePct)}</span>
                )}
              </span>
            )}
            {p.leadCase?.row?.authorName && (
              <span className="text-[10.5px] text-gray-400 dark:text-gray-500 truncate">
                {p.leadCase.row.authorName}
              </span>
            )}
          </div>
          {p.leadCase ? (
            <p className="mt-2 text-[13.5px] text-gray-700 dark:text-gray-300 leading-[1.55] whitespace-pre-wrap line-clamp-3">
              {p.leadCase.row?.content}
            </p>
          ) : (
            <button
              onClick={() => p.onGo('case')}
              className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-gray-400 dark:text-gray-500 italic hover:text-gray-700 dark:hover:text-gray-200"
            >
              <Pencil className="h-3 w-3" /> No case written yet — write it
            </button>
          )}
        </section>

        <section className="pt-4">
          <div className="flex items-baseline gap-2.5 flex-wrap">
            <SectionHeading>What's happening</SectionHeading>
            {p.caseWrittenAt && (
              <span className="text-[10.5px] text-gray-400 dark:text-gray-500">
                case written {formatDistanceToNow(new Date(p.caseWrittenAt), { addSuffix: true })}
              </span>
            )}
          </div>
          <div className="mt-2.5 space-y-2.5">
            {p.changes.length > 0
              ? p.changes.slice(0, 4).map(c => <EvidenceItemView key={c.id} item={c} />)
              : <Quiet>Nothing new since the case was written.</Quiet>}
          </div>
        </section>
      </div>

      <Rail>
        <div>
          <SectionHeading>What we're doing</SectionHeading>
          <div className="mt-2.5 space-y-3">
            <Figure label="Position" size="md"
              value={p.weightPct != null ? `${p.weightPct.toFixed(2)}%` : null} sub={p.bookName} />
            <Figure label="Price" size="md" value={p.spot != null ? money(p.spot) : null} />
            {p.idea ? (
              <button onClick={() => p.onGo('work')} className="block text-left w-full">
                <Figure label="Open idea" size="md"
                  value={`${(p.idea.direction ?? '').toUpperCase()} · ${stageLabel(p.idea.stage)}`.trim()}
                  sub={p.idea.portfolioName} />
              </button>
            ) : p.workLabel ? (
              <button onClick={() => p.onGo('work')} className="block text-left w-full">
                <Figure label="Needs" size="md" value={p.workLabel} />
              </button>
            ) : null}
          </div>
        </div>
        {p.coverage && p.coverage.length > 0 && (
          <div className="pt-3 border-t border-gray-900/[0.06] dark:border-white/[0.07]">
            <Label>Covered by</Label>
            <div className="mt-1 space-y-0.5">
              {p.coverage.slice(0, 2).map((c, i) => (
                <CoverageChip key={`${c.analyst}-${i}`} analyst={c.analyst} team={c.team} isLead={c.isLead} />
              ))}
            </div>
          </div>
        )}
      </Rail>
    </div>
  )
}

// ── Loading ────────────────────────────────────────────────────────────

/** The shape that is coming, with no claims in it. */
export function BenchSkeleton() {
  const bar = 'rounded bg-gray-150 dark:bg-gray-800 motion-safe:animate-pulse'
  return (
    <div className={TWO_COL} aria-busy="true" data-testid="bench-skeleton">
      <div className="space-y-4 min-w-0">
        <div className={clsx(bar, 'h-7 w-72 max-w-full')} />
        <div className={clsx(bar, 'h-20 w-full')} />
        <div className="space-y-2">
          {[0, 1, 2].map(i => <div key={i} className={clsx(bar, 'h-3', i === 2 ? 'w-3/5' : 'w-full')} />)}
        </div>
      </div>
      <div className="space-y-3 lg:border-l border-gray-900/[0.07] dark:border-white/10 lg:pl-6">
        {[0, 1, 2].map(i => (
          <div key={i} className="space-y-1.5">
            <div className={clsx(bar, 'h-2 w-16')} />
            <div className={clsx(bar, 'h-3 w-full')} />
          </div>
        ))}
      </div>
    </div>
  )
}
