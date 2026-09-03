/**
 * The Dashboard — one experience, five lenses.
 *
 * ── What the Dashboard is ────────────────────────────────────────────────
 *
 * A visual command centre and a jumping-off point. It shows what deserves
 * attention and helps move that specific issue forward. It is not another
 * Asset page, not another Research application, not a second Portfolio tool
 * and not an alert table. The deep product surfaces remain the work system;
 * this sits above them and hands off to them explicitly.
 *
 * ── Why one shell ────────────────────────────────────────────────────────
 *
 * Today, Ideas, Research, Portfolio and Decisions were five entries in the app
 * launcher, each opening its own tab. That reads as five applications. They are
 * five questions about ONE investment process:
 *
 *   Today       what should I do?
 *   Ideas       what do we believe?
 *   Research    where does the case need work?
 *   Portfolio   where does capital or framework need attention?
 *   Decisions   what did we decide, and what happened?
 *
 * ── One shell is not one layout ──────────────────────────────────────────
 *
 * The lenses share page geometry, typography, tile primitives, interaction
 * grammar and semantic colour. They do NOT share composition: Today is finite
 * and editorial, Portfolio leads with a book map, Decisions is chronological,
 * Ideas and Research are ranked fields. A single card grid with different
 * filter values would throw away everything each lens knows.
 *
 * ── Saved sessions ───────────────────────────────────────────────────────
 *
 * The `ideas-v2` / `research-v2` / `portfolio-v2` / `decisions-v2` tab types
 * still exist and still render -- they now mount this shell on the matching
 * lens, so a session saved last week opens exactly where it left off and
 * simply gains the lens bar. Nothing is migrated and nothing is deleted; the
 * irreversible collapse is a later, separate decision.
 */

import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Sun, Lightbulb, Microscope, Scale, Landmark } from 'lucide-react'
import { TodayPage } from '../today/TodayPage'
import { IdeasWorkspace } from '../ideas-v2/IdeasWorkspace'
import { ResearchWorkspace } from '../research-v2/ResearchWorkspace'
import { PortfolioWorkspace } from '../portfolio-v2/PortfolioWorkspace'
import { DecisionsWorkspace } from '../decisions-v2/DecisionsWorkspace'
import {
  subscribeToDashboardFocus,
  type DashboardFocusTarget, type FocusSource, type RailCard,
} from '../../lib/dashboard/focus'
import { WorkDeck } from './WorkDeck'

export type DashboardLens = 'today' | 'ideas' | 'research' | 'portfolio' | 'decisions'

/**
 * The question each lens answers, in the user's words.
 *
 * Shown under the lens bar rather than as a tooltip: the point of naming the
 * question is that a reader can see WHY the five are siblings, and a tooltip
 * is invisible to someone deciding which one to click.
 */
const LENS: { id: DashboardLens; label: string; icon: React.ElementType; question: string }[] = [
  { id: 'today', label: 'Today', icon: Sun, question: 'What should I do?' },
  { id: 'ideas', label: 'Ideas', icon: Lightbulb, question: 'What do we believe?' },
  { id: 'research', label: 'Research', icon: Microscope, question: 'Where does the case need work?' },
  { id: 'portfolio', label: 'Portfolio', icon: Scale, question: 'Where does capital or framework need attention?' },
  { id: 'decisions', label: 'Decisions', icon: Landmark, question: 'What did we decide, and what happened?' },
]

export interface DashboardShellProps {
  /** Which lens to open on. A saved v2 tab supplies its own. */
  initialLens?: DashboardLens
  /** Selection carried in tab data, so a typed arrival lands inside a lens. */
  selectedIdeaId?: string | null
  selectedAssetId?: string | null
  selectedPortfolioId?: string | null
  selectedDecisionId?: string | null
  focus?: string | null
  issue?: string | null
  origin?: string | null
}

export function DashboardShell({
  initialLens = 'today',
  selectedIdeaId, selectedAssetId, selectedPortfolioId, selectedDecisionId,
  focus, issue, origin,
}: DashboardShellProps = {}) {
  const [lens, setLens] = useState<DashboardLens>(initialLens)

  /**
   * The expanded card, and the deck it came out of.
   *
   * `originLens` is where Back goes and which deck stays alive underneath.
   * `active` is the card currently expanded, and it changes on every rotation.
   * Stage 3B carried one `lens` doing both jobs, which is why a card opened
   * from Today offered "All research" as the way back.
   */
  const [deck, setDeck] = useState<DeckState | null>(null)

  useEffect(() => subscribeToDashboardFocus(req => {
    setLens(req.target.originLens)
    setDeck({ ...req, active: req.target })
  }), [])

  /**
   * Where a keyboard reader is, across the expand and the return.
   *
   * ── The measured problem ─────────────────────────────────────────────────
   *
   * Activating a tile's action left `document.activeElement` on `<body>`: the
   * button that was focused is still in the DOM but inside the deck, which is
   * now `aria-hidden` and `pointer-events-none`. Nothing was trapped and
   * nothing was broken, but the reader's place was gone — the next Tab landed
   * back on the lens bar, above a workspace they had just opened.
   *
   * ── Continuity, for the reader who cannot see the animation ──────────────
   *
   * Forward, focus moves to the work surface, so the next Tab is inside the
   * thing that just opened. Back, it returns to the exact tile it came out of,
   * found by the `elementId` the focus request carried. That id is the whole
   * reason the seam exists: a query on ticker or label would land on the wrong
   * tile the moment two findings concern one name.
   *
   * This is the same continuity the motion expresses, for someone who has
   * turned the motion off — and it is the part that still has to be correct
   * when the animation does not run at all.
   */
  const focusRegion = useRef<HTMLDivElement | null>(null)
  const returnTo = useRef<string | null>(null)

  useEffect(() => {
    if (deck) {
      returnTo.current = deck.target.source?.elementId ?? null
      focusRegion.current?.focus({ preventScroll: true })
      return
    }
    const id = returnTo.current
    returnTo.current = null
    if (!id) return
    // The deck is visible again on this frame, so the tile is focusable.
    // `CSS.escape` is not in every test environment; the ids are generated
    // from engine ids and contain nothing that needs escaping, so a plain
    // attribute match is the correct fallback rather than a failure.
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(id) : id
    const tile = document.querySelector<HTMLElement>(`[data-focus-source="${escaped}"]`)
    tile?.focus({ preventScroll: true })
  }, [deck])

  /**
   * Rotating never redefines where Back goes.
   *
   * Today -> TGT -> AMZN -> WMT still returns to the Today deck it started
   * from. The origin belongs to the act of pulling a card out of a deck, not
   * to whichever card is currently open.
   */
  const rotate = (card: RailCard) => setDeck(d => d && ({
    ...d,
    active: {
      ...d.target,
      workspaceLens: card.workspaceLens,
      objectType: card.objectType,
      objectId: card.id,
      symbol: card.symbol,
      portfolioId: card.portfolioId ?? d.target.portfolioId ?? null,
      portfolioName: card.portfolioName ?? d.target.portfolioName ?? null,
      issue: card.issue ?? null,
    },
  }))

  /** Choosing a lens by hand is navigation: it leaves the deck. */
  const chooseLens = (id: DashboardLens) => {
    setLens(id)
    setDeck(null)
  }

  const browseLens = deck?.target.originLens ?? lens
  const workLens = deck?.active.workspaceLens ?? null
  const activeId = deck?.active.objectId ?? null

  /**
   * The browse deck stays mounted while a card is expanded.
   *
   * Unmounting it would throw away the book selection, the filter and -- most
   * visibly -- the scroll position, and Back would land the reader at the top
   * of a deck they had scrolled halfway down. It is made invisible rather than
   * removed from layout, because `display: none` resets `scrollTop` in every
   * browser that matters and a saved-offset dance would be a measurement loop
   * for something CSS can just keep.
   */
  const renderLens = (l: DashboardLens, focusObjectId: string | null) => {
    if (l === 'today') return <TodayPage />
    if (l === 'ideas') return (
      <IdeasWorkspace
        selectedIdeaId={selectedIdeaId ?? null}
        focus={(focus as any) ?? null}
        issue={deck?.active.issue ?? issue ?? null}
        focusObjectId={focusObjectId}
      />
    )
    if (l === 'research') return (
      <ResearchWorkspace
        selectedAssetId={selectedAssetId ?? null}
        issue={deck?.active.issue ?? issue ?? null}
        origin={deck?.active.origin ?? origin ?? null}
        focusObjectId={focusObjectId}
        intent={deck?.target.source?.intent}
      />
    )
    if (l === 'portfolio') return (
      <PortfolioWorkspace
        selectedPortfolioId={deck?.active.portfolioId ?? selectedPortfolioId ?? null}
        selectedAssetId={selectedAssetId ?? null}
        focusObjectId={focusObjectId}
      />
    )
    return (
      <DecisionsWorkspace
        selectedPortfolioId={selectedPortfolioId ?? null}
        selectedDecisionId={selectedDecisionId ?? null}
        focusObjectId={focusObjectId}
      />
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-gray-50/60 dark:bg-[#0b0f16]">
      <nav
        data-testid="dashboard-lenses"
        aria-label="Dashboard lenses"
        className={clsx(
          'shrink-0 border-b border-gray-200 bg-white px-6 pt-3 dark:border-white/10 dark:bg-[#141a25]',
          // Subordinate while a card is expanded: the work deck is the
          // interaction, and the lens bar is how you leave it.
          deck && 'opacity-70 transition-opacity hover:opacity-100 focus-within:opacity-100',
        )}
      >
        <div className="flex flex-wrap items-center gap-1">
          {LENS.map(l => {
            const active = l.id === browseLens
            return (
              <button
                key={l.id}
                type="button"
                aria-current={active ? 'page' : undefined}
                data-lens={l.id}
                onClick={() => chooseLens(l.id)}
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-t-lg px-3 py-2 text-[13px] font-medium transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-blue-600',
                  active
                    ? 'bg-gray-50 text-gray-900 shadow-[inset_0_-2px_0_0] shadow-blue-600 dark:bg-white/[0.06] dark:text-gray-100'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-800 dark:hover:bg-white/[0.05] dark:hover:text-gray-200',
                )}
              >
                <l.icon className="h-4 w-4" />
                {l.label}
              </button>
            )
          })}
          {!deck && (
            <span className="ml-3 hidden text-[11px] text-gray-400 xl:inline dark:text-gray-500">
              {LENS.find(l => l.id === browseLens)?.question}
            </span>
          )}
        </div>
      </nav>

      <div
        className="relative min-h-0 flex-1"
        data-testid="dashboard-lens-body"
        data-lens={browseLens}
        data-focus={activeId ?? undefined}
      >
        {/* The deck. Kept laid out so its scroll survives, and made inert so a
            reader cannot tab into a surface they cannot see. */}
        <div
          className={clsx(
            'absolute inset-0',
            deck && 'invisible pointer-events-none',
          )}
          aria-hidden={deck ? true : undefined}
          data-testid="dashboard-browse"
        >
          {renderLens(browseLens, null)}
        </div>

        {deck && workLens && (
          <div
            className="absolute inset-0 z-10 bg-gray-50/60 motion-safe:animate-[deck-expand_200ms_ease-out] dark:bg-[#0b0f16]"
            data-testid="dashboard-focus"
            ref={focusRegion}
            tabIndex={-1}
            role="region"
            aria-label={`${deck.active.symbol ?? deck.active.label ?? 'Selected object'}${deck.active.issue ? `, ${deck.active.issue}` : ''}`}
            /*
             * Grow out of the card that was clicked.
             *
             * The rect was captured on the tile at click time and travels in
             * the focus request, so this costs one string and no measurement:
             * nothing is read from the DOM here, during the animation or
             * after it. When a surface raises a focus without a source — a
             * typed arrival, a rotation — the origin falls back to the centre
             * and the motion is the plain expand it always was.
             */
            style={originOf(deck.target.source)}
          >
            <WorkDeck
              backLabel={deck.backLabel}
              onBack={() => setDeck(null)}
              rail={deck.rail}
              activeId={activeId}
              onRotate={rotate}
              intent={deck.target.source?.intent}
            >
              {renderLens(workLens, activeId)}
            </WorkDeck>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Where the expanding surface should grow from.
 *
 * Expressed as `transform-origin` rather than as a scaled-and-translated clone
 * of the tile: a clone would have to be positioned, kept in sync, and torn
 * down, and a mis-timed teardown leaves an invisible element over the surface
 * swallowing clicks. An origin is one CSS property on an element that already
 * exists, it cannot outlive the animation, and it intercepts nothing.
 *
 * The rect is viewport-relative and the focus layer fills the viewport below
 * the lens bar, so the percentages are close enough to read as "it opened from
 * there" without any second measurement. Precision beyond that would be spent
 * on 200ms of motion nobody inspects frame by frame.
 */
function originOf(source: FocusSource | null | undefined): React.CSSProperties | undefined {
  const r = source?.rect
  if (!r || typeof window === 'undefined') return undefined
  const x = ((r.left + r.width / 2) / Math.max(1, window.innerWidth)) * 100
  const y = ((r.top + r.height / 2) / Math.max(1, window.innerHeight)) * 100
  return { transformOrigin: `${x.toFixed(1)}% ${y.toFixed(1)}%` }
}

/** What the shell holds while a card is expanded. */
interface DeckState {
  /** The card that was clicked. Its `originLens` never changes. */
  target: DashboardFocusTarget
  /** The card currently expanded. Changes on every rotation. */
  active: DashboardFocusTarget
  backLabel: string
  rail: RailCard[]
}

/** Which lens a legacy v2 tab type belongs to. */
export const LENS_FOR_TAB: Record<string, DashboardLens> = {
  today: 'today',
  'ideas-v2': 'ideas',
  'research-v2': 'research',
  'portfolio-v2': 'portfolio',
  'decisions-v2': 'decisions',
}
