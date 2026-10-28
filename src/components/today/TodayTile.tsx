/**
 * Today — one surfaced item.
 *
 * The approved grammar, in production: a tinted chrome band carrying identity
 * and state, the claim, a metric strip, the visual that explains why it
 * surfaced, why-now as a sentence, then one dominant primary action with
 * Ask AI and Discuss as quieter text affordances.
 *
 * Ask AI and Discuss go through the D1 seam, so the pane opens with the object
 * AND the triggering issue already bound. Discuss renders only when
 * `canDiscuss` says the object can actually hold a thread — never routed to AI.
 */

import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowRight, MoreHorizontal } from 'lucide-react'
import { askAI, canDiscuss, discuss } from '../../lib/engagement'
import { supportsSharedDefer, SNOOZE_PRESETS } from '../../lib/attention-state'
import { TodayVisual } from './TodayVisual'

/* The keys enrichment actually draws a window for. Imported rather than
   restated so the room a tile reserves and the picture it later gets cannot
   disagree about which findings have one. */
import { DRAWS_WINDOW as ENRICHMENT_DRAWS, VISUAL_SLOT } from '../../lib/today'
import type { TodayItem } from '../../lib/today'
import { withIntent } from '../../lib/today/engagement-intent'
import { CreateMenu } from '../dashboard/CreateMenu'
import type { FocusIntent, FocusSource } from '../../lib/dashboard/focus'
import { TONE_INK, type SemanticTone } from '../../lib/semantic-tone'

/**
 * State colour by MEANING, not by engine severity alone.
 *
 * The real screenshot rendered four stale theses in red, which told the reader
 * that four routine reviews were four emergencies. Severity is the evaluator's
 * measure of how bad a finding is relative to others of its own kind -- a
 * 210-day thesis is "red" among theses -- and reading it as a global alarm
 * level is what flattened the surface.
 *
 * So the tone comes from what the finding IS. Red is reserved for capital
 * actually at risk; review and waiting are amber; informational is blue.
 *
 * The palette itself now lives in `lib/semantic-tone`, because Portfolio made
 * the same mistake independently while the vocabulary was still private to
 * this file. Which finding maps to which tone stays here -- that is Today's
 * knowledge, not the palette's.
 */
const TONE_BY_KEY: Record<string, SemanticTone> = {
  EXECUTION_NOT_CONFIRMED: 'critical',
  PROPOSAL_AWAITING_DECISION: 'review',
  THESIS_STALE: 'review',
  RATING_NO_FOLLOWUP: 'review',
  IDEA_NOT_SIMULATED: 'info',
  OVERDUE_DELIVERABLE: 'review',
  HIGH_EV_NO_IDEA: 'info',
}

/**
 * A secondary affordance: present, and quiet until the reader approaches.
 *
 * Opacity rather than `display`, and inside the primary's row rather than a
 * row of its own, so revealing it changes NO geometry -- a field of four
 * tiles must not shuffle as the pointer crosses it.
 *
 * `group-focus-within` is the keyboard path: tabbing into the tile reveals
 * the same controls hovering does. Never `pointer-events-none`, so a reader
 * who knows where a control lives can still hit it blind.
 */
const QUIET_REVEAL =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100'

/** The quiet affordances' own shape, so the three of them cannot drift. */
const QUIET = `rounded-md px-2.5 py-2 text-[12px] ${QUIET_REVEAL}`

/** For a control that brings its own styling, such as `CreateMenu`. */
const QUIET_WRAP = QUIET_REVEAL

export function toneFor(item: TodayItem): SemanticTone {
  const key = item.source.titleKey
  if (key && TONE_BY_KEY[key]) return TONE_BY_KEY[key]
  // Unmapped: fall back to severity, but only red truly means red.
  return item.severity === 'red' ? 'critical' : item.severity === 'blue' ? 'info' : 'neutral'
}

/** The DOM handle for a surfaced item. One definition, used by node and seam. */
export function focusSourceId(item: TodayItem): string {
  return `today-tile-${item.id}`
}

/**
 * What the tile knows about itself at the moment it is clicked.
 *
 * Read from the real node rather than remembered, so the geometry is the
 * geometry the reader actually saw — after wrapping, after enrichment changed
 * the tile's height, after any layout the composition applied.
 */
function sourceOf(
  el: HTMLElement | null, item: TodayItem, role: FocusSource['role'],
  intent: FocusIntent = 'overview',
): FocusSource {
  const tile = el?.closest('[data-focus-source]') as HTMLElement | null
  const r = tile?.getBoundingClientRect()
  return {
    elementId: focusSourceId(item),
    role,
    intent,
    rect: r
      ? { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height) }
      : null,
  }
}

interface TodayTileProps {
  item: TodayItem
  rank: number
  featured?: boolean
  /**
   * Set when the page gives this tile half the field or more.
   *
   * Only the page knows how many columns a tile got, and the composition is
   * what decides whether a chart has 450px to live in or 900. Passing it is
   * what stops the tile from having to guess, or from measuring itself.
   */
  wide?: boolean
  /**
   * The page's enrichment query has not settled yet.
   *
   * Only the page knows: the query is keyed on the whole surfaced set, so a
   * tile asking for itself would fan out four requests for one. See
   * `awaitingVisual`.
   */
  enriching?: boolean
  onPrimary: (item: TodayItem, source?: FocusSource) => void
  onDismiss: (item: TodayItem) => void
  onSnooze: (item: TodayItem, hours: number) => void
}

export function TodayTile({
  item, rank, featured, wide, enriching, onPrimary, onDismiss, onSnooze,
}: TodayTileProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const sharedDefer = item.target ? supportsSharedDefer(item.target) : false

  /**
   * How this tile is being presented — not what it is about.
   *
   * Travels with the focus request so a later transition can expand a lead
   * differently from a compact one. `data-focus-source` on the article is the
   * matching DOM handle, and both are derived here so they cannot disagree.
   */
  const role: FocusSource['role'] = featured ? 'lead' : wide ? 'standard' : 'compact'

  /**
   * Whether this tile has a real explanatory graphic.
   *
   * Drives the layout, and only the layout: enrichment availability must never
   * influence WHICH item leads. #1 is the highest-priority object whether or
   * not its history happens to be cached; what adapts is how its tile is
   * composed, so a featured item with nothing to draw does not reserve half
   * its width for an empty column.
   */
  const hasVisual = item.visual.archetype !== 'metrics'

  /**
   * A picture is coming, and the tile holds its room rather than growing
   * into it.
   *
   * `archetype: 'metrics'` means "nothing to draw", and that is also what a
   * tile reads while `useTodayEnrichment` is still fetching -- the two
   * states were indistinguishable here. Measured on a cold load at
   * 1920x889: the tiles painted, sat still for 6.3 seconds, then re-arranged
   * twice as the query answered, the aging track and the plot appearing at
   * once. CLS 0.0748, both shifts almost seven seconds in, which is what
   * makes it read as a hitch rather than as loading -- and the amber run of
   * the aging track arriving at that moment is the yellow line.
   *
   * Reserved only where the finding is one the enrichment actually draws for
   * (`DRAWS_WINDOW` in `lib/today/enrich`), so a tile that was never going
   * to have a picture reserves nothing and stays short. `pending` goes false
   * when the query settles either way, so a failed fetch collapses the room
   * instead of holding it forever.
   */
  /*
   * Not "no visual yet" -- "not the FINAL visual yet".
   *
   * The first version of this checked `!hasVisual`, and never once fired: a
   * stale-thesis tile already draws an `aging` track from `createdAt` alone,
   * with no enrichment at all. What arrives at t≈6.6s replaces that track
   * with a price plot. So the condition is about the key being one that
   * enrichment REDRAWS, regardless of what is on screen now.
   */
  const awaitingVisual = !!enriching && !!item.source.context.assetId
    && ENRICHMENT_DRAWS.has(item.source.titleKey ?? '')
  /**
   * Where this card's visual leads.
   *
   * Derived from what it actually draws. A scenario band is the desk's own
   * framework; everything else the Today visuals draw is a price path or a
   * quantity measured against one, so it leads to price work.
   */
  const visualIntent: FocusIntent = item.visual.archetype === 'scenario' ? 'framework' : 'price'

  /*
   * What Ask AI and Discuss are about, from what the reader last reached for.
   *
   * Asking about a card whose framework you were just inspecting is a question
   * about that framework. The tray is one row of controls for the whole card,
   * so rather than duplicating it under every part, it remembers the last part
   * engaged and asks about that. Nothing was engaged yet means the object
   * itself, which is what the target already says.
   */
  const [engageIntent, setEngageIntent] = useState<FocusIntent>('overview')
  /*
   * Two columns whenever the tile is wide enough for two, not only when it is
   * the lead.
   *
   * Splitting on `featured` alone was right while the lead was the only wide
   * tile on the page. Once the field gives a supporting tile six columns, a
   * single-column body stretches its chart across ~880px, and a sparkline that
   * wide flattens into a line: NVDA's +21.2% move became visually
   * indistinguishable from no move at all. The size of a drawing should follow
   * the measure it is drawn into, which is the rule the Ideas field already
   * uses for the same reason.
   */
  /* The reserved room takes the same column the picture will, or the tile
     re-flows from one column to two when it arrives -- which is the larger
     half of the shift this reservation exists to stop. */
  const split = !!(featured || wide) && (hasVisual || awaitingVisual)

  /*
   * The card is the entrance to the object.
   *
   * ── Arbitration, by event semantics rather than geometry ────────────────
   *
   * Every meaningful child here is a real control, so a click that originated
   * inside one is that control's click and never the card's. `closest` on the
   * event target is the whole test: no coordinate maths, no hit rectangles,
   * nothing that breaks when the layout changes. A reader dragging across the
   * price plot is also excluded -- a scrub that ends inside the card is an
   * inspection, not a decision to leave it.
   *
   * The card is not itself a <button>. It contains buttons, and a button
   * inside a button is invalid markup and unreachable by keyboard; the Ideas
   * field settled this two stages ago with the same reasoning. Keyboard
   * readers get the portal through the card's own Enter/Space, and the
   * controls inside stay independently tabbable.
   */
  const openObject = (el: HTMLElement | null, intent: FocusIntent) =>
    onPrimary(item, sourceOf(el, item, role, intent))

  const portalClick = (e: React.MouseEvent<HTMLElement>) => {
    const t = e.target as HTMLElement
    if (t.closest('button,a,input,select,textarea,[role="button"],[data-no-portal]')) return
    if (window.getSelection()?.toString()) return
    openObject(e.currentTarget as HTMLElement, 'overview')
  }

  return (
    <article
      data-testid="today-tile"
      data-rank={rank}
      data-tier={item.tier}
      data-focus-source={focusSourceId(item)}
      onClick={portalClick}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return
        if (e.key !== 'Enter' && e.key !== ' ') return
        e.preventDefault()
        openObject(e.currentTarget, 'overview')
      }}
      aria-label={`${item.ticker ?? item.objectLabel}, ${item.state}. Open workbench.`}
      /*
       * Focusable only on purpose, never by tabbing.
       *
       * -1 keeps the tile out of the tab order — its buttons are the things a
       * reader tabs to — while letting the shell put focus back here when the
       * work deck closes, so returning lands on the tile the reader opened
       * rather than at the top of the page.
       */
      tabIndex={-1}
      className={clsx(
        // The Ideas card: hairline, small radius, no shadow. A drop shadow
        // under every tile makes a feed read as a stack of floating panels
        // rather than one instrument, and a large radius reads friendly where
        // this is meant to read precise.
        /* `group`, so the quiet affordances below can wait for the pointer.
           They are addressed as `group-hover`/`group-focus-within` rather
           than with state, which keeps them out of the render path -- four
           tiles re-rendering on mouseover is a worse surface than a static
           one. */
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-[3px] border bg-white',
        'transition-colors duration-100 dark:bg-[#141a25]',
        toneFor(item) === 'critical'
          ? 'border-rose-200/80 dark:border-rose-900/40'
          : 'border-gray-200 dark:border-white/[0.08]',
      )}
    >
      {/*
        The eyebrow sits ON the card, not in a band above it.

        This was a tinted strip with its own rule, borrowed from the mobile
        tile header where a small screen genuinely needs the separation. On a
        desktop field of four it read as a filed record with a title bar,
        which is most of why this lens looked like a different product from
        Ideas one tab away. Same words, same ground as the ticker below them.
      */}
      <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
        {/*
          Rank and state as ink, not as filled chips.

          Two rounded, filled pills sat above every ticker -- the treatment
          Ideas spent a pass removing, because a field of them reads as a
          queue of tagged records rather than a set of investment objects.
          The rank keeps its mono figure and the state keeps its tone; both
          now sit on the card's own ground with a hairline between them, which
          is exactly how Ideas draws `SELL | DECIDING`.
        */}
        <span className={clsx(
          'font-mono text-[10px] font-semibold tracking-wider',
          rank === 1 ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400',
        )}>
          #{rank}
        </span>
        <span aria-hidden className="text-gray-300 dark:text-white/20">|</span>
        <span className={clsx(
          'text-[10px] font-medium uppercase tracking-[0.08em]',
          TONE_INK[toneFor(item)],
        )}>
          {item.state}
        </span>
        {/*
          The tier phrase is deliberately not on the tile.

          Every tile carried three layers of process labelling before a reader
          reached any investment content: a #rank pill, a STATE pill, and the
          tier phrase. On the real surface #3 and #4 both read "THESIS MAY BE
          STALE" and both read "framework gap" — two labels, four words, and
          nothing that tells apart the two tiles a reader most needs to tell
          apart. It is the engine's internal grouping, not a fact about the
          investment.

          Rank and state are the tile's own and stay. The tier still ranks the
          surface and is still reported under Also watching; it no longer
          spends a line of every card naming the evaluator's bucket.

          What takes the space is the book the object sits in, which is a fact
          about the position and the one piece of context a reader needs to
          know whether a finding is theirs.
        */}
        {item.source.context.portfolioName && (
          <span className="ml-auto truncate text-right text-[10px] leading-tight text-gray-500 dark:text-gray-500">
            {item.source.context.portfolioName}
          </span>
        )}
      </div>

      {/* identity — the object leads, at mobile's weight.
          Mobile sets its headline at 30px font-black with -0.035em tracking;
          a 15px semibold ticker was the single biggest reason this did not
          read as the same product. */}
      <div className="flex items-baseline gap-2.5 px-3.5 pt-2.5">
        <span
          className={clsx(
            'font-black leading-[1.05] tracking-[-0.035em]',
            featured ? 'text-[30px]' : 'text-[22px]',
          )}
        >
          {item.ticker ?? item.objectLabel}
        </span>
        {item.ticker && item.objectLabel !== item.ticker && (
          <span className="min-w-0 truncate text-[12px] font-medium text-gray-500 dark:text-gray-400">
            {item.objectLabel}
          </span>
        )}
      </div>

      {/*
        Body geometry, from presentation role and what there is to draw.

        Three states, and the same finding type can be in any of them on
        different mornings — which is the point. Geometry follows the data, not
        the evaluator that produced it:

          two columns   wide or featured AND a visual worth drawing
          one column    a visual, but not the width to sit beside it
          measure-capped  wide, and nothing honest to draw

        The third is the one that was missing. A lead tile with no visual is
        not rare — enrichment fails, an overdue project has no asset, an age
        the strip already states now draws nothing — and it used to run its
        claim and metric strip across the full 1,243px of the lead column.
        Capping the measure is what makes that state read as a deliberately
        short tile rather than a broken wide one, and it reserves no empty
        column to do it.
      */}
      <div
        data-body={split ? 'split' : wide || featured ? 'capped' : 'single'}
        className={clsx(
          'flex-1 px-3.5 pt-1.5',
          split
            ? 'grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]'
            : 'flex flex-col gap-2',
          // No visual, but a wide column: stop at a readable measure instead of
          // setting a claim 150 characters to the line.
          !split && (wide || featured) && 'lg:max-w-[86ch]',
        )}
      >
        <div className={clsx('flex min-w-0 flex-col', split ? 'gap-2.5' : 'gap-2')}>
          {/*
            The claim is a portal to the claim, not to the object generally.

            A reader who reaches for the written case wants the case. It is a
            <button> so the keyboard reaches it independently of the card, and
            it is styled as text: a hover underline and a pointer are the whole
            affordance. Making it look like a link would put a blue sentence in
            the middle of every card and turn the surface into a web page.
          */}
          <button
            type="button"
            data-testid="claim-portal"
            onClick={e => { e.stopPropagation(); openObject(e.currentTarget, 'claim') }}
            onPointerEnter={() => setEngageIntent('claim')}
            className={clsx(
              'rounded-sm text-left leading-snug text-gray-600 decoration-gray-400 underline-offset-2',
              'hover:text-gray-900 hover:underline focus-visible:outline focus-visible:outline-2',
              'focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:text-gray-400 dark:hover:text-gray-100',
              featured ? 'text-[13px]' : 'text-[12px]',
            )}
          >
            {item.claim}
          </button>

          {item.metrics.length > 0 && (
            /*
              Figures on the surface, not in a tray.

              This was a filled, rounded panel with a vertical rule between
              every cell -- a widget nested inside the card, which is the same
              chrome the visual below it just shed and the last thing on this
              tile reading as an infographic. Ideas removed the identical
              treatment: a row of measurements in the figure-over-label rhythm
              needs a gap between them, not a box around them.

              The measure cap survives the box. BABA's single "324d since
              review" was filling a 900px panel, and a lone figure floating in
              the middle of a wide tile is no better than a lone figure
              floating in a wide box.
            */
            <div className={clsx(
              'flex flex-wrap items-baseline gap-x-8 gap-y-3',
              !split && item.metrics.length <= 2 && 'lg:max-w-[520px]',
            )}>
              {item.metrics.map(m => (
                <div key={m.label} className="min-w-0">
                  <span
                    className={clsx(
                      'block truncate font-mono text-[17px] font-semibold leading-none tabular-nums tracking-[-0.01em]',
                      m.tone === 'down' && 'text-rose-600 dark:text-rose-400',
                      m.tone === 'up' && 'text-emerald-600 dark:text-emerald-400',
                      m.tone === 'warn' && 'text-amber-700 dark:text-amber-400',
                    )}
                  >
                    {m.value}
                  </span>
                  <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.08em] text-gray-400">
                    {m.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {hasVisual && !awaitingVisual && (
          /*
            The visual is a portal to the thing it draws.
            
            A framework chart leads to framework work and a price path to price
            work, so the intent follows the archetype rather than being one
            generic "open". The wrapper carries `data-no-portal` because the
            plot inside is scrubbed with the pointer: a drag that ends on the
            chart is an inspection, and the card must not treat it as a
            decision to leave. The explicit control below it is how a reader
            asks to go there.
          */
          <div
            className="min-w-0"
            data-no-portal
            onPointerEnter={() => setEngageIntent(visualIntent)}
          >
            <TodayVisual visual={item.visual} compact={!featured} />
            <button
              type="button"
              data-testid="visual-portal"
              onClick={e => { e.stopPropagation(); openObject(e.currentTarget, visualIntent) }}
              className="mt-1 rounded-sm text-[10px] font-semibold uppercase tracking-widest text-gray-400 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:text-blue-400"
            >
              {visualIntent === 'framework' ? 'Open framework' : 'Open price history'}
            </button>
          </div>
        )}

        {awaitingVisual && (
          /*
            The room, held open and saying nothing.

            Not a shimmer: four pulsing rectangles on a priority surface read
            as four more things happening. The hairline is the one the
            visual's own container draws, so when the picture lands it lands
            in the frame already on screen rather than adding one.

            The height is VISUAL_SLOT -- the SAME constant the real zone uses,
            not a number copied from it. A reservation that can drift from
            what arrives moves the page twice instead of once.
          */
          <div className="min-w-0" data-testid="visual-reserved" aria-hidden>
            <div
              className={clsx(
                'border-t border-gray-200/80 dark:border-white/[0.08]',
                featured ? 'mt-3 pt-3' : 'mt-2 pt-2',
              )}
              style={{ height: featured ? VISUAL_SLOT.featured : VISUAL_SLOT.compact }}
            />
            {/* The portal label below the real zone is 15px on a 4px margin.
                Leaving it out made the reservation 19px short, which is a
                smaller jump than before but still a jump. */}
            <div className="mt-1 h-[15px]" />
          </div>
        )}
      </div>

      {/*
        Action row — one verb at rest, the rest on approach.

        ── What was here ──────────────────────────────────────────────────
        A "NEXT" eyebrow on its own line, then Review thesis, Ask AI,
        Discuss, Create and an overflow button, all drawn at full strength on
        every tile. Measured at 1920x889 on the lead: 62px of a 386px tile,
        16% of it, before the row's own padding -- and four tiles of it
        meant twenty controls competing with the four findings they belong
        to.

        The eyebrow is gone outright: it labelled a button that already says
        what it does, and "NEXT / Review thesis" is the same word twice.

        The quiet affordances stay in the primary's row rather than moving to
        a row of their own, so revealing them changes no geometry -- the tile
        is the same height whether the pointer is on it or not, which is what
        stops a field of four from shuffling as the mouse crosses it. They
        are hidden by OPACITY, not by `display`, for the same reason.

        `group-focus-within` is what keeps them reachable without a pointer:
        tabbing into the tile reveals them, so the keyboard path is the hover
        path. They are never `pointer-events-none`, so a reader who clicks
        where they know a control lives still hits it.
      */}
      <div className="flex flex-wrap items-center gap-1 px-3.5 pb-2.5 pt-2">
        {item.primary ? (
          <button
            type="button"
            onClick={e => onPrimary(item, sourceOf(e.currentTarget, item, role))}
            className={clsx(
              'inline-flex items-center gap-2 rounded-lg border border-blue-700 bg-blue-700 font-semibold text-white',
              'hover:bg-blue-800 hover:border-blue-800',
              featured ? 'px-4 py-2.5 text-[13px]' : 'px-3.5 py-2 text-[12px]',
            )}
          >
            {item.primary.label}
            <ArrowRight className="h-3.5 w-3.5 opacity-70" />
          </button>
        ) : (
          <span className="rounded-lg border border-dashed border-gray-300 px-3 py-2 text-[11px] text-gray-500 dark:border-white/15 dark:text-gray-500">
            No structured action yet
          </span>
        )}

        {item.target && (
          <button
            type="button"
            onClick={() => askAI(withIntent(item.target!, engageIntent))}
            className={clsx(QUIET, 'text-amber-800 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30')}
          >
            Ask AI
          </button>
        )}

        {/*
          Discuss, on the same seam as Ask AI.

          It was withheld here on the reasoning that scattering Discuss
          affordances before the communication-pane review would lock that
          answer in by accident. That reasoning has been overtaken: the Ideas
          field carries Respond / Ask AI / Discuss, so the question of where
          contextual team discussion lives is already answered in the product,
          and Today withholding it is now the inconsistency rather than the
          caution. A finding could be raised with the team only by opening it
          first.

          No new architecture: `discuss()` raises an EngagementRequest with the
          object and its triggering issue already bound, and the existing
          CommunicationPane answers it. `canDiscuss` gates it, so an object the
          seam says cannot hold a thread shows no button rather than one that
          would fail.
        */}
        {item.target && canDiscuss(item.target) && (
          <button
            type="button"
            data-testid="today-discuss"
            onClick={() => discuss(withIntent(item.target!, engageIntent))}
            className={clsx(QUIET, 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]')}
          >
            Discuss
          </button>
        )}

        {/* Create sits with the other engagements, before the overflow. */}
        <span className={QUIET_WRAP}>
          <CreateMenu
            compact
            intent={engageIntent}
            context={{
              assetId: item.source.context.assetId ?? null,
              symbol: item.ticker,
            }}
          />
        </span>

        <div className={clsx('relative ml-auto', !menuOpen && QUIET_WRAP)}>
          <button
            type="button"
            aria-label="More actions"
            onClick={() => setMenuOpen(o => !o)}
            className="grid h-7 w-7 place-items-center rounded-md text-gray-500 hover:bg-gray-100 dark:hover:bg-white/[0.06]"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {menuOpen && (
            <div
              className="absolute right-0 z-40 mt-1 w-72 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-lg dark:border-white/15 dark:bg-[#171e2b]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              <MenuGroup label="Personal — only affects your view" />
              <MenuItem
                label="Dismiss for me"
                hint="Hidden for you on every device. Changes no shared state."
                onClick={() => { onDismiss(item); setMenuOpen(false) }}
              />
              {SNOOZE_PRESETS.map(p => (
                <MenuItem
                  key={p.hours}
                  label={`Snooze ${p.label}`}
                  hint="Comes back on its own when the snooze expires."
                  onClick={() => { onSnooze(item, p.hours); setMenuOpen(false) }}
                />
              ))}

              <MenuGroup label="Shared — changes the workflow for everyone" />
              {/*
                No shared action is offered from Today yet, and none is rendered.

                A control that looks like a shared mutation and performs none is
                worse than no control: the user believes their team's revisit
                date moved. So the two cases are stated rather than drawn.

                The object-type case is permanent-ish: an asset simply has no
                revisit date. The trade-queue case is Today's own gap — the
                mutation exists (`deferTradeIdeaMutation`), but the id Today
                carries is not unambiguously a `trade_queue_items.id`: pair
                trades surface under a synthetic `pair-<id>`, and a proposal
                expanded across portfolios surfaces once per portfolio while
                sharing one underlying row. Deferring from either would either
                miss, or move the date for every portfolio's copy. Resolving
                that is a workflow question, not a UI one.
              */}
              <div className="px-3 pb-2.5 pt-1 text-[10px] leading-snug text-gray-500 dark:text-gray-500">
                {sharedDefer
                  ? 'This item has a shared revisit date, but Today cannot move it yet — defer it from the trade queue, where the row it belongs to is unambiguous.'
                  : 'This object has no shared revisit date to move, so there is no shared Defer for it. Snooze is the personal equivalent.'}
              </div>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

function MenuGroup({ label }: { label: string }) {
  return (
    <div className="border-t border-gray-200 px-3 pb-1 pt-2.5 text-[9px] font-bold uppercase tracking-widest text-gray-500 first:border-t-0 dark:border-white/10 dark:text-gray-500">
      {label}
    </div>
  )
}

function MenuItem({
  label, hint, onClick, shared,
}: { label: string; hint: string; onClick: () => void; shared?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-1.5 text-left hover:bg-blue-50 dark:hover:bg-blue-950/30"
    >
      <span className="block text-[12px] text-gray-900 dark:text-gray-100">{label}</span>
      <span className={clsx('mt-0.5 block text-[10px]', shared ? 'text-amber-700 dark:text-amber-400' : 'text-gray-500 dark:text-gray-500')}>
        {hint}
      </span>
    </button>
  )
}
