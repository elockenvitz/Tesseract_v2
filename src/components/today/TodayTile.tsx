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
import { VisualPager } from '../desktop/VisualPager'
import { askAI, canDiscuss, discuss } from '../../lib/engagement'
import { SNOOZE_PRESETS } from '../../lib/attention-state'
import { TodayVisual } from './TodayVisual'

/* The keys enrichment actually draws a window for. Imported rather than
   restated so the room a tile reserves and the picture it later gets cannot
   disagree about which findings have one. */
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
 * `:focus-visible`, not `:focus-within`, is the keyboard path.
 *
 * ── The bug this fixes ───────────────────────────────────────────────────
 *
 * `:focus-within` matches a button focused by a MOUSE CLICK, and a clicked
 * button keeps focus until something else takes it. So clicking anything
 * inside a tile -- a pager tab, Ask AI, the overflow trigger -- pinned that
 * tile's action row open, and it stayed open with the pointer on the far
 * side of the page. Reported as "the buttons on hover are staying showing",
 * and the "sometimes" was exactly this: only after a click.
 *
 * `group-has-[:focus-visible]` reveals the row for a reader who TABBED in,
 * which is who the keyboard path is for, and ignores click focus. The one
 * case that still needs the row up without hover or keyboard focus is an
 * open overflow menu, and the tile already has state for that, so it is
 * stated explicitly rather than inferred from where focus happens to be.
 *
 * Never `pointer-events-none`, so a reader who knows where a control lives
 * can still hit it blind.
 */
const QUIET_REVEAL =
  'opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-has-[:focus-visible]:opacity-100'

/**
 * The quiet affordances' own shape, so the three of them cannot drift.
 *
 * No reveal classes here: the whole row fades as one overlay, and fading each
 * control inside a fading parent multiplies two opacities for no gain.
 */
const QUIET = 'rounded-md px-2.5 py-2 text-[12px]'

/**
 * What each panel is called on the pager.
 *
 * One word, and the reader's word rather than the engine's: the archetype
 * names are internal ("review-window", "expected-return") and the captions
 * are whole sentences. The tab only has to say which question the next panel
 * answers, because the caption inside the panel then says it in full.
 */
const PANEL_LABEL: Record<string, string> = {
  'review-window': 'Price',
  scenario: 'Cases',
  aging: 'Age',
  transition: 'Change',
  'expected-return': 'Upside',
  exposure: 'Weight',
  metrics: '—',
}

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
  onPrimary: (item: TodayItem, source?: FocusSource) => void
  onDismiss: (item: TodayItem) => void
  onSnooze: (item: TodayItem, hours: number) => void
}

export function TodayTile({
  item, rank, featured, wide, onPrimary, onDismiss, onSnooze,
}: TodayTileProps) {
  const [menuOpen, setMenuOpen] = useState(false)

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
  /*
   * EVERY picture this finding can draw, and which one is showing.
   *
   * `item.visual` is still the finding's own choice and still leads, so the
   * default card is byte-for-byte what it was. What changes is that the
   * alternatives enrichment built are now reachable: a tile about an idea
   * nobody has sized led with its open-for bar and offered no way to ask what
   * the price had done, even though the history was already in hand.
   *
   * The strip is only drawn when there is more than one panel -- it is never a
   * single dead tab -- and the index is clamped rather than reset, so a panel
   * list that shortens between renders cannot blank the slot.
   */
  const panels = (item.visuals?.length ? item.visuals : [item.visual])
    .filter(v => v.archetype !== 'metrics')
  const [panelIndex, setPanelIndex] = useState(0)
  const active = Math.min(panelIndex, Math.max(0, panels.length - 1))
  const panel = panels[active] ?? item.visual
  /* Wrapping arrows moved into `VisualPager` with the rest of the control, so
     Today and the Ideas field cannot disagree about what paging does. */

  const hasVisual = panels.length > 0

  /**
   * Where this card's visual leads.
   *
   * Derived from what it actually draws — the panel ON SCREEN, not the
   * finding's default, so paging to the price path makes the portal open the
   * chart rather than the cases.
   */
  const visualIntent: FocusIntent = panel.archetype === 'scenario' ? 'framework' : 'price'

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
  const split = !!(featured || wide) && hasVisual

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
           They are addressed as `group-hover`/`group-has-[:focus-visible]` rather
           than with state, which keeps them out of the render path -- four
           tiles re-rendering on mouseover is a worse surface than a static
           one. */
        /* NOT `overflow-hidden`. The overflow menu is a 288px panel opened
           from inside this box, and clipping it to the card cut the dropdown
           off -- the snooze presets were unreachable on every tile. The
           analysis slot does its own clipping, so nothing else needed it. */
        /* The card's edge is a real line now, not a suggestion of one.
           gray-200 against a gray-50/60 page was a ~3% step, which is inside
           the range a cheap monitor renders as nothing at all; the page is
           gray-100 and the hairline gray-300, so the boundary survives both
           a bad screen and a bright room. Critical keeps its rose edge and
           gains the same weight. */
        'group relative flex h-full min-w-0 flex-col rounded-[3px] border bg-white',
        'transition-colors duration-100 dark:bg-[#161d2a]',
        toneFor(item) === 'critical'
          ? 'border-rose-300 dark:border-rose-900/60'
          : 'border-gray-300 dark:border-white/[0.12]',
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
          // `pb-3`: the action overlay is out of flow, so this is the only
          // thing keeping it off the last line of content on a tile with no
          // slack. It is margin, not a reserved row -- a tile with room to
          // spare spends it on the content, not on a band of empty chrome.
          'flex-1 px-3.5 pb-3 pt-1.5',
          split && 'grid grid-cols-1 gap-4',
          !split && 'flex flex-col gap-2',
          /*
            The lead gives the chart the wider half, the rest keep the text
            wider. On a 1233px lead, 1fr/0.9fr put ~650px under a 115-character
            claim -- one short line across a very long measure, which is both
            a bad line length and the reason the text column could not fill
            its own height. Flipping the ratio sets the claim at a readable
            measure (it wraps, and the column grows into the slack) and hands
            the ~70px saved to the chart, which is where it does the most good.
          */
          split && (featured
            ? 'lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]'
            : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]'),
          // No visual, but a wide column: stop at a readable measure instead of
          // setting a claim 150 characters to the line.
          !split && (wide || featured) && 'lg:max-w-[86ch]',
        )}
      >
        {/*
          The prose column fills its box instead of ending halfway up it.

          Measured at 1920x889: the lead tile is 326px, its chart column runs
          to 288px and its claim-and-figures column stopped at 175px -- 151px
          of nothing under the most important finding on the page. The column
          is stretched to the row either way; the only question is whether the
          slack sits in one hole at the bottom or as air between two things
          that belong apart.

          So the claim holds the top and the figures drop to the foot of the
          column, landing near the chart's own baseline. `pb-11` is the band
          the action row fades into, kept clear so approaching the tile never
          covers the figures -- the same reason the row stops short of the
          chart column.
        */}
        <div className={clsx(
          'flex min-w-0 flex-col',
          split ? 'gap-2.5' : 'gap-2',
          // No bottom reservation any more: the action row moved to the
          // eyebrow, so the foot of this column is the column's own again.
          split && 'justify-between',
        )}>
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
              // The lead is set at the lead's weight. It had the same 13px
              // sentence as a quarter-width tile and 140px of white under it:
              // the most important finding on the page, typeset as the least.
              // 17px over a ~460px measure sets it at three lines, which is
              // both the right line length and ~40px of the hole it sat in.
              featured ? 'text-[17px] leading-relaxed' : 'text-[12px]',
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
              !split && item.metrics.length <= 2 && 'lg:max-w-[520px]',
              /*
                On the lead, the figures are a BLOCK, not a strip.

                Measured at 1920x889: the lead's text column ran 85px to 363px
                and held 81px of content -- a 41px claim at the top, a 40px
                row of figures at the foot, and 197px of nothing between them.
                `justify-between` was dividing emptiness, not laying anything
                out, because the tile's height is set by the chart beside it
                and the text had no way to reach it.

                Four figures in two rows at the lead's own weight close most
                of that with the item's real content. Nothing is invented: it
                is the same four numbers, set the way the lead's claim is
                already set -- the biggest tile on the page should not typeset
                its evidence at the size a quarter-width tile uses.
              */
              featured
                ? 'grid grid-cols-2 gap-x-8 gap-y-7'
                : 'flex flex-wrap items-baseline gap-x-8 gap-y-3',
            )}>
              {item.metrics.map(m => (
                <div key={m.label} className="min-w-0">
                  <span
                    className={clsx(
                      'block truncate font-mono font-semibold leading-none tabular-nums tracking-[-0.01em]',
                      featured ? 'text-[26px]' : 'text-[17px]',
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

        {hasVisual && (
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
            className="flex min-w-0 flex-col justify-center"
            data-no-portal
            onPointerEnter={() => setEngageIntent(visualIntent)}
          >
            <TodayVisual visual={panel} compact={!featured} />
            {/*
              The pager and the portal share one row, so paging costs no
              height inside the fixed visual slot -- the slot is what holds
              Today at zero layout shift, and a strip above the chart would
              have eaten into the plot on every tile to serve the tiles that
              have a second panel.
            */}
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                data-testid="visual-portal"
                onClick={e => { e.stopPropagation(); openObject(e.currentTarget, visualIntent) }}
                className="rounded-sm text-[10px] font-semibold uppercase tracking-widest text-gray-400 hover:text-blue-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:text-blue-400"
              >
                {/*
                  It names the OBJECT, not the archive.

                  "Open price history" sounded like a log of past prices -- a
                  record you look things up in -- when what it opens is this
                  name's research page with the full chart on it. The framework
                  half had the same fault at a lower volume: "framework" is the
                  engine's word for the desk's own bear/base/bull cases.
                */}
                {visualIntent === 'framework' ? 'See the price cases' : 'See the full chart'}
              </button>
              {panels.length > 1 && (
                /*
                  A CONTROL, not a caption.

                  The first version of this was three words in 10px letter-
                  spaced uppercase, the same type the captions and axis
                  labels use. It worked, and it was reported as "no carousels
                  still" -- because on a surface where every small uppercase
                  string is a label, one more small uppercase string is a
                  label. Nothing about it said "press me".

                  A segmented control says it: a filled track, a raised white
                  thumb on the selection, sentence case at a readable size,
                  and arrows either side so the gesture is obvious even if the
                  segments are not. It still costs no height, because it still
                  shares the portal's row.
                */
                /* The control itself is shared with the Ideas gallery -- see
                   desktop/VisualPager. Two surfaces, one gesture. */
                <VisualPager
                  className="ml-auto"
                  labels={panels.map(v => PANEL_LABEL[v.archetype])}
                  keys={panels.map(v => v.archetype)}
                  index={active}
                  onChange={setPanelIndex}
                />
              )}
            </div>
          </div>
        )}

        {/*
          No "room held for a loading chart" block.

          There was one, briefly. It is gone because TodayPage no longer
          renders a tile until the engine, the coverage scan AND enrichment
          have all settled, so a tile is never built from half its data. A
          placeholder for a state that cannot occur is dead weight, and it
          only ever addressed one of the three phases anyway.
        */}
      </div>

      {/*
        Action row — nothing at rest, everything on approach.

        ── What was here ──────────────────────────────────────────────────
        A "NEXT" eyebrow on its own line, then Review thesis, Ask AI,
        Discuss, Create and an overflow button, all drawn at full strength on
        every tile. Measured at 1920x889 on the lead: 62px of a 386px tile,
        16% of it -- and four tiles of it meant twenty controls competing
        with the four findings they belong to.

        Fading the three secondary verbs was not enough: "Review thesis" and
        "Simulate idea" are the loudest things on the surface, and the row
        went on reserving 60px whether or not anything in it was visible, so
        the space was spent either way.

        So the row LEAVES THE LAYOUT. It is an overlay pinned to the tile's
        bottom edge, out of flow: at rest the tile's own content runs to the
        bottom of the card, and the actions cost nothing. On approach the row
        fades up over that edge behind a scrim that is opaque where the
        controls sit and clear above them, so whatever it covers fades out
        rather than being chopped.

        It is hidden by OPACITY, not `display`, and it is out of flow, so the
        tile's height is identical hovered and not -- which is what stops a
        field of four from shuffling as the pointer crosses it. The body
        carries bottom padding equal to the row, so on a tile with no slack
        the overlay lands on margin rather than on a sentence.

        `group-has-[:focus-visible]` keeps the whole row reachable without a
        pointer: tabbing into the tile reveals it, so the keyboard path is
        the hover path. It is deliberately NOT `:focus-within`, which also
        matches a button focused by a mouse click and therefore pinned the
        row open on any tile whose controls had been clicked. Nothing here is
        `pointer-events-none`, so a reader who clicks where they know a
        control lives still hits it. An open overflow menu keeps the row up
        through `menuOpen`, stated rather than inferred from focus.
      */}
      <div
        data-testid="today-actions"
        className={clsx(
          /*
            TOP RIGHT, not the bottom edge.

            It sat at the bottom and kept landing on the one control it shared
            the card with. Full width it covered the chart; stopped at 48% it
            still covered "See the full chart" on every tile whose body stacks
            instead of splitting -- the link was under the scrim and could not
            be clicked at all. ANY band pinned to the bottom of a card whose
            content also ends at the bottom will do this; the position was the
            defect, not its width.

            The eyebrow row is the one strip of a tile that is reliably empty:
            a rank, a state, and on most tiles nothing else across the rest of
            the width. The row lives there now, right-aligned, fading down
            over its own seam. Nothing a reader goes to a tile FOR is up
            there, and the chart, its read-out and its portal are untouched.
          */
          'absolute right-0 top-0 z-10 flex flex-wrap items-center justify-end gap-1 px-3 pb-5 pt-2',
          'bg-gradient-to-b from-white via-white via-70% to-transparent',
          /* Must track the card fill exactly, or the scrim shows as a band. */
          'dark:from-[#161d2a] dark:via-[#161d2a]',
          QUIET_REVEAL,
          /* The menu is opened from inside this row and extends below it.
             Letting the row fade while its own menu is on screen would strand
             the panel over the tile with nothing holding it. */
          menuOpen && 'opacity-100',
        )}
      >
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
        <span>
          <CreateMenu
            compact
            intent={engageIntent}
            context={{
              assetId: item.source.context.assetId ?? null,
              symbol: item.ticker,
            }}
          />
        </span>

        <div className="relative ml-auto">
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
              /* Downward again: the trigger moved to the tile's top edge, so
                 a menu opening upward would hang above the card. */
              className="absolute right-0 top-full z-40 mt-1 w-56 overflow-hidden rounded-lg border border-gray-300 bg-white shadow-lg dark:border-white/15 dark:bg-[#171e2b]"
              onMouseLeave={() => setMenuOpen(false)}
            >
              {/*
                THREE CHOICES, NO BRIEFING.

                It was a two-section menu: a "Personal — only affects your
                view" header, four items each carrying its own explanatory
                hint, a "Shared — changes the workflow for everyone" header,
                and then a forty-word paragraph explaining why there are no
                shared actions. Six lines of prose to put something off until
                next week.

                Every one of those sentences was TRUE, which is how it got
                there. None of it is a decision the reader is making: they
                want this off the page, now or for a while. The distinction
                the headers drew is real and is carried by the words instead
                -- "Hide this for me" says whose view it leaves.

                Three snooze presets became two. "3 days" sat between a day
                and a week answering no question either of them did not.
              */}
              <MenuItem label="Hide this for me" onClick={() => { onDismiss(item); setMenuOpen(false) }} />
              {SNOOZE_PRESETS.filter(p => p.hours !== 72).map(p => (
                <MenuItem
                  key={p.hours}
                  label={`Remind me in ${p.label}`}
                  onClick={() => { onSnooze(item, p.hours); setMenuOpen(false) }}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

/*
 * `MenuGroup` is gone with the headers it drew, and `supportsSharedDefer`
 * with the paragraph that branched on it. Today still offers no shared
 * action -- the reason is recorded in the menu's own comment -- it simply no
 * longer writes an essay about the absence above a three-item list.
 */

/** One line, one verb. The explanatory second line is gone with the briefing. */
function MenuItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full px-3 py-2 text-left text-[13px] text-gray-900 hover:bg-blue-50 dark:text-gray-100 dark:hover:bg-blue-950/30"
    >
      {label}
    </button>
  )
}
