import { useEffect, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, MoreHorizontal } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'

import type { CardContextChip, SignalCard } from '../../lib/signals/contract'
import { PANE_VIEWPORT_MIN_PX, responseBandMinPx } from '../../lib/signals/tile-geometry'
import { KIND_LABEL, SEVERITY_MARK, SURFACE_SKIN, bodyIsPrimaryProse, showsTopRule } from './card-identity'
import { feedbackOptionsFor, type FeedFeedbackOption } from '../../lib/signals/feed-feedback'
import { BottomSheet } from '../mobile/BottomSheet'
import { CardCarousel } from './CardCarousel'
import { judgmentIsDeclaredInline, judgmentPresentationFor } from '../../lib/signals/content-registry'

/**
 * The pane every card names its judgment control. A convention across the
 * eight builders that construct one, made explicit so the presentation rule
 * has something to match on.
 */
export const JUDGMENT_PANE_ID = 'verdict'

/**
 * Tint "Long X" green and "Short Y" red in a headline that has them.
 *
 * Deliberately a render-time concern rather than something the builder emits
 * as markup: the card contract is text, and a builder returning JSX would make
 * every consumer a renderer. Matching on the words is enough — they are the
 * builder's own, not a guess at somebody's prose.
 */
function renderSidedHeadline(headline: string) {
  if (!/(Long|Short)\s/.test(headline)) return headline
  const parts = headline.split(/(Long\s[^,]+|Short\s[^,]+)/g)
  return parts.map((part, i) => {
    if (/^Long\s/.test(part)) {
      return <span key={i} className="text-emerald-600 dark:text-emerald-400">{part}</span>
    }
    if (/^Short\s/.test(part)) {
      return <span key={i} className="text-rose-600 dark:text-rose-400">{part}</span>
    }
    return part
  })
}

/** A position size in words a phone has room for. */
function compactUsd(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}bn`
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}m`
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}k`
  return `$${v.toFixed(0)}`
}

/** One labelled figure in the portfolio disclosure. */
function Stat({ label, value, slot }: { label: string; value: string; slot: string }) {
  return (
    <span data-slot={slot} className="text-[12px] tabular-nums text-gray-500 dark:text-gray-400">
      <span className="font-semibold uppercase tracking-wide text-gray-400">{label}</span>{' '}
      <span className="font-bold text-gray-700 dark:text-gray-200">{value}</span>
    </span>
  )
}


/**
 * The only component that renders a signal card.
 *
 * Every type goes through here and there is no per-type branch — seven bespoke
 * card components is what produced three header patterns, four action bars and
 * two cards that were dead ends. If a type cannot render from the contract,
 * the contract changes, not this file.
 *
 * ── On height ─────────────────────────────────────────────────────────────
 *
 * As tall as its content, never taller than one screen.
 *
 * This has been wrong in both directions. The first version was deliberately
 * short, on the reading that full-viewport cards were the defect. They were
 * not: the defect was full-viewport cards that were 60% EMPTY, with the payload
 * crammed into the top 40% and a chart panel rendering nothing. Shrinking cured
 * the emptiness by removing the space rather than using it, so a card carrying
 * a real finding rendered like a table row.
 *
 * The correction was `h-full` — one screen per card, always — and it overshot
 * in the other direction. A two-line workflow card was padded out to 844px, so
 * a feed of eight findings cost eight full swipes and never showed the reader
 * that a ninth existed. The feed read as a stack of full-screen alerts because
 * it was structurally incapable of reading as anything else.
 *
 * The rule that satisfies both: a CEILING, not a fixed height. The scroll
 * conflict the one-screen rule existed to prevent comes from cards taller than
 * the viewport, not shorter — a card that fits has no inner scroller and
 * nothing to arbitrate. So the space still has to be earned, and a card that
 * cannot fill a screen simply does not take one. A case ladder still runs most
 * of the screen because its content genuinely does; a stale-research card is
 * about 380px, and the next card peeks below it.
 */

interface SignalCardViewProps {
  card: SignalCard
  onAction: (actionId: string, card: SignalCard) => void
  /**
   * @deprecated Navigation moved into the actions sheet.
   *
   * The footer no longer renders an `Open TICKER` button, so nothing in this
   * component calls this. Kept on the interface because every call site passes
   * it and because `card.actions.open` — the label and href it used — is still
   * the contract the sheet reads. Remove both together, or neither.
   */
  onOpen?: (card: SignalCard) => void
  /** Rendered in the evidence band — a ladder, a sparkline. Supplied by the
   *  feed so this component never imports a chart. */
  evidence?: React.ReactNode
  /**
   * Detail behind the number, revealed in place.
   *
   * The point of the disclosure: a card saying a name is below its bear case
   * must be able to show the cases themselves without sending anybody to an
   * asset page. Navigation is the failure this surface exists to avoid.
   */
  detail?: React.ReactNode
  /**
   * Everything interactive, as ONE carousel, instead of `evidence` + `detail`.
   *
   * ── Why this replaces the two-region layout ───────────────────────────────
   *
   * The card had an evidence band at a fixed height and, below the question, a
   * second region holding the controls. That lower region was the one with
   * `flex-1`, so it was also the one that gave up space when a card ran out —
   * and the reader could see "Has the investment view changed?" with the
   * buttons that answer it clipped underneath.
   *
   * Reserving height for it fixes the symptom and makes the card rigid: every
   * card then pays for a control whether it has one or not. The better answer
   * is that there is no second region. The chart, the editor and the response
   * are all things you interact with, so they are panes of the same carousel,
   * in the band that already has the height — and the question sits directly
   * above the action bar with nothing between them to squeeze.
   */
  panes?: { id: string; label: string; content: React.ReactNode }[]
  /** Label for the disclosure control, e.g. "See all 3 cases". */
  detailLabel?: string
  /**
   * Whether the detail is worth a hide/show control at all.
   *
   * A disclosure earns its place when the region holds *content* the reader
   * might want out of the way: six cases with reasoning, a full post. It does
   * not when the region holds a single control that is open by default and has
   * nowhere else to go — a "Hide detail" button above a three-button response
   * bar offers to hide the only thing on the card a reader can act on, and its
   * other state ("Show detail") is a step they never wanted.
   *
   * False renders the region plainly, with no toggle and no label.
   */
  detailCollapsible?: boolean
  /** Narrow the feed to this kind. Restores the legacy chip behaviour. */
  onFilterKind?: (type: SignalCard['type']) => void
  /** A context chip carrying an href was tapped, e.g. a portfolio name. */
  onContext?: (chip: CardContextChip) => void
  /**
   * Navigate to a book, from the disclosure rather than from the chip.
   *
   * Deliberately separate from `onContext`: that fires when a plain href chip
   * is tapped, and the whole point of the disclosure is that tapping a label no
   * longer navigates.
   */
  onOpenPortfolio?: (portfolioId: string, name: string) => void
  /**
   * Feedback about the feed itself, offered in the overflow menu.
   *
   * Separate prop from `onAction` because it is a separate loop with a separate
   * store: these go to product telemetry, not to the investment audit trail.
   * Passing them through the card's action grammar would have made that
   * distinction a convention rather than a type.
   */
  onFeedback?: (option: FeedFeedbackOption) => void
  /**
   * Which pane is showing, so a caller can make the footer contextual.
   *
   * Fires with the first pane's id on mount and on every page thereafter.
   */
  onPaneChange?: (paneId: string) => void
  /**
   * Scroll the carousel to a pane, from outside the card.
   *
   * The footer's primary needs this on a card whose action is "go and look at
   * the list you are one swipe away from" — a New Research card with several
   * arrivals, where choosing a note on the reader's behalf is the thing being
   * avoided. `CardCarousel` has always accepted it; nothing passed it.
   */
  focusPaneId?: string | null
  /**
   * Replaces the sticky primary while a pane owns the decision.
   *
   * ── The redundancy this removes ─────────────────────────────────────────
   *
   * The footer is `Actions | Review target` on every `target_expired` card,
   * including while the reader is standing ON the review pane — a button
   * offering to open the thing already filling the screen. Worse, once they
   * have chosen a resolution the generic label is actively wrong: somebody who
   * answered "Replace with cases" is not going to "Review target".
   *
   * So the caller may substitute the primary. `null` (the default) keeps
   * `card.actions.primary`, which is right for the fifteen kinds whose footer
   * is the same wherever you are on the card. The action ID is still what
   * `onAction` receives, so routing and analytics are unchanged — this is a
   * label and a destination, not a new grammar.
   */
  primaryOverride?: {
    id: string
    label: string
    disabled?: boolean
    /**
     * Handled by the pane rather than routed through `onAction`.
     *
     * A pane that owns a multi-step flow needs the footer to advance THAT flow,
     * not to navigate away to the surface the action id names. The id is still
     * reported for analytics and routing parity; `run` is what actually fires.
     */
    run?: () => void
  } | null
}

const METRIC_TONE = {
  good: 'text-emerald-600 dark:text-emerald-400',
  bad: 'text-rose-600 dark:text-rose-400',
  neutral: 'text-gray-900 dark:text-white',
} as const

/**
 * The numeral scales to what it is, rather than shouting every value.
 *
 * ── Two rounds of shrinking, and why ──────────────────────────────────────
 *
 * It began as a fixed 56px, chosen for "+3.1%" and then applied to everything,
 * so "179" under "days since anyone wrote on it" arrived at the same visual
 * weight as a book's largest active bet. That went to a 42px ceiling.
 *
 * It is now 30px, because the problem was never only the type size. The metric
 * lived in a tall tinted well that consumed about 98px of an 844px screen —
 * roughly the height the chart was missing. "6mo / PAST ITS HORIZON" at that
 * scale is a headline restating a fact the headline already made, while the
 * evidence a reader can actually work with was squeezed into a fifth of the
 * card. The number is still the loudest thing on the card; it is no longer the
 * biggest thing on it.
 *
 * Length remains the proxy because it governs the layout: a ten-character value
 * wraps or clips on a 390px card whatever it means.
 */
function metricSize(value: string): string {
  const n = value.length
  if (n <= 5) return 'text-[30px]'
  if (n <= 8) return 'text-[24px]'
  return 'text-[19px]'
}

/**
 * What an action is called in the bar.
 *
 * ── Why this is a function rather than a ternary in one slot ──────────────
 *
 * `capture` was renamed to "Actions" at the point of display, because the
 * sheet behind it holds navigation as well as capture and "Capture" names a
 * subset of what is there. That rename was applied to the QUICK slot only —
 * and `capture` is the PRIMARY on about a dozen card types (every market
 * template, every post, active risk, crowding, both conviction cards). So one
 * action id wore two names depending on which button it happened to land in,
 * and a reader who learned "Actions" on a scenario card met "Capture" on the
 * news card below it and had no way to know they were the same sheet.
 *
 * The id, the handler and every builder's `{ id: 'capture' }` are untouched:
 * this is a display decision, and it now happens in one place so a third slot
 * cannot reintroduce the split.
 */
function barLabel(a: { id: string; label: string }): string {
  return a.id === 'capture' ? 'Actions' : a.label
}

/** "31 Jul" in UTC — the date belongs to the snapshot, not the reader's clock. */
function shortDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

function relative(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return formatDistanceToNow(d, { addSuffix: true })
}

function utcDay(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10)
}

export function SignalCardView({
  card, onAction, evidence, detail, panes, onFilterKind, onContext, onOpenPortfolio, focusPaneId,
  onFeedback, onPaneChange, primaryOverride = null,
}: SignalCardViewProps) {
  const [bodyOpen, setBodyOpen] = useState(false)
  /**
   * Open by default, and it cannot grow the card.
   *
   * Earlier this pushed the card past one screen, which caused the scroll
   * conflict. That is no longer possible: the article is `h-full
   * overflow-hidden` and this region is `flex-1 min-h-0 overflow-y-auto`, so it
   * absorbs exactly the slack and no more. Open, it fills the screen with the
   * analyst's own reasoning; closed, the card is mostly empty.
   */
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on any outside press. Without this the menu stayed open while the
  // feed scrolled under it, which reads as a stuck overlay.
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [menuOpen])

  // Signal-aware: "wrong person" is meaningless on a market move, which was
  // routed to nobody.
  const feedback = onFeedback ? feedbackOptionsFor(card) : []
  const skin = SURFACE_SKIN[card.surface]
  /**
   * One carousel supersedes the two-region layout entirely — see `panes`.
   * `evidence`/`detail` remain for the cards not yet migrated.
   */
  /**
   * Whether the reader has engaged this object.
   *
   * ── browse -> engage -> judge ─────────────────────────────────────────────
   *
   * Nearly every tile used to open with its question — "What best describes
   * this position?", "Does this need a price target?" — so scrolling the feed
   * felt like working through a questionnaire rather than reading one. The
   * questions are valuable and none are removed. What changes is WHEN.
   *
   * In the resting state a card says what happened, why it matters, shows its
   * evidence and its portfolio context, and offers one affordance. The
   * judgment arrives when the reader asks for it.
   *
   * Reset when the card itself changes, because a windowed slot can be reused
   * for a different card and an engaged state must not survive that.
   */
  const [engaged, setEngaged] = useState(false)
  useEffect(() => { setEngaged(false) }, [card.id])

  /**
   * Engaging IS navigating to the judgment pane, and the footer has to hear it.
   *
   * ── The bug this closes ───────────────────────────────────────────────────
   *
   * `onPaneChange` fires from `CardCarousel.onActiveChange`, and an `on_engage`
   * card's judgment pane is FILTERED OUT of the carousel (see `visiblePanes`) —
   * it takes the whole band instead. So the callback was never once called with
   * `verdict` on those cards, and a footer computing its override from "is the
   * reader on the verdict pane" could never become true.
   *
   * Ideas and Pair are `judgment: 'inline'`, so their verdict IS a carousel
   * pane and their footer worked. Research is `on_engage`, so the identical
   * wiring was structurally dead: the reader selected an answer, the pane
   * showed the consequence, and the sticky CTA still said "Review the case".
   *
   * `onPaneChange` means "which pane is the reader looking at". It was telling
   * the truth for one presentation and staying silent for the other. Reporting
   * the engaged state fixes every `on_engage` consumer at once rather than
   * per card type.
   *
   * On disengage it reports the carousel's active pane again, so the footer
   * returns to the card's own action rather than staying on the judgment.
   */
  const activeCarouselPane = useRef<string | null>(null)
  /**
   * The pane on screen, as STATE rather than only as a ref.
   *
   * The ref is enough to restore a pane after disengaging, and not enough to
   * render from: the card has to know it is showing the response in order to
   * get out of its way. See `respondActive`.
   */
  const [activePaneId, setActivePaneId] = useState<string | null>(null)

  /**
   * Resolved from the registry, not from a prop.
   *
   * Every call site would otherwise have to pass the same derivation, and the
   * eight that construct verdict panes are exactly the places most likely to
   * get it subtly different. `judgmentPresentationFor` also folds in severity,
   * so an immaterial scenario gap asks on engagement while a breach on a large
   * position still leads with its question.
   */
  const declaredPresentation = judgmentPresentationFor(card)
  const judgmentPane = panes?.find(p => p.id === JUDGMENT_PANE_ID) ?? null

  /**
   * A card with nothing else to show leads with its question.
   *
   * ── The 500px of nothing this removes ─────────────────────────────────────
   *
   * `browse -> engage -> judge` rests on there being something to browse. The
   * resting state is meant to be "what happened, why it matters, the evidence,
   * the context" with the question one tap away — and `on_engage` withholds the
   * judgment pane from the carousel to make room for exactly that.
   *
   * On the workflow cards there is no such thing. `buildAttentionCard` produces
   * a headline, a day count and two lines of body; the feed's only pane for it
   * is the response, and `attnPrice` exists solely for the minority of items
   * that name an asset with cached history. So `merged` was null, the evidence
   * band collapsed entirely, and every child above it is `shrink-0` — leaving
   * the card's whole middle empty. Measured on the new `awaiting-review`
   * fixture: 504px of dead space between the body and the action bar, on an
   * 844px screen.
   *
   * That is the defect the phone suite's own dead-band rule exists to catch,
   * and its comment is explicit that the answer is not to pad or to exempt: "a
   * fixture that needs accommodating would put real dead space on real cards".
   * The answer is to give the card content, and the content it has is the
   * question. Withholding the only thing on a card is not progressive
   * disclosure, it is an empty screen with a chip on it.
   *
   * Narrow on purpose. It fires only when the judgment is the sole pane, so
   * every card that carries a chart, a ladder, a peer list or a sizing control
   * still browses first and answers second — which is the whole point of the
   * default and is untouched here.
   */
  const judgmentIsTheOnlyPane =
    !!judgmentPane && !!panes && panes.every(p => p.id === JUDGMENT_PANE_ID)
  /**
   * A card that supplies its own shell keeps its own navigation.
   *
   * ── The second architecture this removes ─────────────────────────────────
   *
   * `judgmentPresentationFor` downgrades a declared-inline card to `on_engage`
   * unless it is `critical`. That is right for a card whose judgment is a
   * separate thing to opt into. It is wrong for one that has already composed a
   * multi-pane shell WITH the judgment in it, because the reader then gets two
   * ways to reach the same pane and the footer follows neither.
   *
   * Measured on two real `scenario_gap` cards. AMZN breaches its framework by
   * 48%, so it is `critical`, stays inline, and pages Ladder / Respond / Price
   * / Cases with the footer switching to `Submit response` on Respond. DASH
   * sits at its expected value, so it is `informational`, gets downgraded, and
   * grows a "Your view" button and a "< Evidence" back link — a different
   * navigation model for the same card type, on which the footer kept offering
   * `Review cases` while the reader was looking at the response UI.
   *
   * Severity should change urgency and copy, not the shape of the card. So the
   * downgrade is skipped when the type DECLARES inline and the shell it handed
   * us already contains the judgment among other panes. `judgmentIsTheOnlyPane`
   * below is the same exemption for the opposite case — a card with nothing but
   * its question leads with it — and this is its mirror.
   */
  const judgmentIsInOwnShell =
    !!judgmentPane && !!panes && panes.length > 1 && judgmentIsDeclaredInline(card.type)
  const presentation: typeof declaredPresentation =
    declaredPresentation === 'on_engage' && (judgmentIsTheOnlyPane || judgmentIsInOwnShell)
      ? 'inline'
      : declaredPresentation

  /** The affordance replaces the question only when there IS a question. */
  const offersEngagement = presentation === 'on_engage' && !engaged && !!judgmentPane

  /**
   * Engaging REPLACES the evidence band; it does not add a pane.
   *
   * ── Why the pane approach was wrong ─────────────────────────────────────
   *
   * Tapping "Your view" used to append the judgment to the carousel and page
   * to it. Reported, accurately, as creating "another card that wasn't there
   * originally" — because that is what a new pane in a pager is. Worse, the
   * question then appeared twice: once as the card's prompt and once as the
   * bar's own heading.
   *
   * Answering is not another piece of evidence to page through. It is a
   * different MODE of the same card, so it takes the band it needs and offers
   * a way back. One question, in one place, and the pane count never changes
   * under the reader.
   */
  const judgmentOpen = engaged && !!judgmentPane
  /**
   * The reader is answering, by either route.
   *
   * An ENGAGED judgment takes the whole band; an INLINE one is a carousel
   * page. Both are the same moment for the reader and must behave the same
   * way, which is why this is one flag and not two branches.
   */
  const visiblePanes = panes && panes.length > 0
    /**
     * An INLINE judgment is a pane; an ENGAGED one takes the whole band.
     *
     * The two look like opposite decisions and follow from one rule: the
     * reader should see one thing at a time, and nothing should appear that
     * was not there before.
     *
     * Inline means the card leads with its question, so the response belongs
     * in the band from the first frame — as a page you swipe to, beside the
     * evidence rather than under it. Rendering it below meant the question and
     * the interactive panes were on screen together, competing for a card that
     * has room for one.
     *
     * Engaged means the reader asked for it, so nothing is a surprise — but
     * adding a pane mid-session changes the pane count under them, which is
     * what "creates another card that wasn't there" described. It takes the
     * band instead, and gives it back.
     */
    ? (presentation === 'inline' ? panes : panes.filter(p => p.id !== JUDGMENT_PANE_ID))
    : null
  const merged = visiblePanes && visiblePanes.length > 0 ? visiblePanes : null

  /**
   * Which pane the reader is on, defaulting to the one they opened on.
   *
   * `onActiveChange` only fires when the carousel PAGES, and a card with a
   * single pane never pages — `CardCarousel` returns early for one. So a card
   * whose only pane IS the response reported no active pane at all, and both
   * the body suppression and the footer's commit stayed switched off on
   * exactly the card where the reader is unambiguously answering.
   *
   * Found by screenshotting it. The DOM said `data-respond-active="no"` on a
   * card showing nothing but a response form.
   */
  const currentPaneId = activePaneId ?? merged?.[0]?.id ?? null
  const respondActive = judgmentOpen || currentPaneId === JUDGMENT_PANE_ID

  /**
   * Engaging IS navigating to the judgment pane, and the footer has to hear it.
   *
   * ── The bug this closes ───────────────────────────────────────────────────
   *
   * `onPaneChange` fires from `CardCarousel.onActiveChange`, and an `on_engage`
   * card's judgment pane is FILTERED OUT of the carousel (see `visiblePanes`) —
   * it takes the whole band instead. So the callback was never once called with
   * `verdict` on those cards, and a footer computing its override from "is the
   * reader on the verdict pane" could never become true.
   *
   * Ideas and Pair are `judgment: 'inline'`, so their verdict IS a carousel
   * pane and their footer worked. Research is `on_engage`, so the identical
   * wiring was structurally dead: the reader selected an answer, the pane
   * showed the consequence, and the sticky CTA still said "Review the case".
   *
   * `onPaneChange` means "which pane is the reader looking at". It was telling
   * the truth for one presentation and staying silent for the other.
   *
   * ── The fallback, which a test caught ─────────────────────────────────────
   *
   * On disengage it restores whatever the carousel last reported — and the
   * carousel reports nothing until the reader swipes. A reader who engaged
   * straight away and pressed Back therefore left the footer stuck on the
   * judgment override, still offering to submit an answer they had backed out
   * of. So the fallback is the FIRST visible pane, which is what they are
   * looking at when nothing has moved.
   */
  useEffect(() => {
    if (!onPaneChange) return
    if (engaged) onPaneChange(JUDGMENT_PANE_ID)
    else onPaneChange(activeCarouselPane.current ?? merged?.[0]?.id ?? '')
    // `merged` is rebuilt every render; its FIRST ID is the only part read here
    // and it is stable for a given card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engaged, onPaneChange, card.id, merged?.[0]?.id])
  const hasEvidence = merged
    ? true
    : !!evidence && card.evidence && card.evidence.kind !== 'none'
  /**
   * Whether the body is actually clamped — measured, not guessed at.
   *
   * It was `card.body.length > 150`, which is a proxy for "will this wrap past
   * two lines" and a bad one: the clamp is applied to EVERY body now, so a
   * 130-character body wraps to three lines at card width, shows an ellipsis,
   * and had no tap handler because it did not clear the character threshold.
   * Reported as "when I click on the caption when there is an ... it doesn't
   * always launch the drawer" — it was the ellipsis that lied, not the tap.
   *
   * The DOM knows: a clamped element's scrollHeight exceeds its clientHeight.
   */
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const [bodyIsLong, setBodyIsLong] = useState(false)
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    /**
     * One axis, because both roles now clamp on it.
     *
     * Supporting prose was briefly `truncate` — one line, nowrap — which can
     * only overflow HORIZONTALLY, so this had to branch. It is a two-line
     * clamp again, and a clamped box reports the same way whichever role it
     * is: scrollHeight is the full text, clientHeight is what is shown.
     */
    const measure = () => setBodyIsLong(el.scrollHeight > el.clientHeight + 1)
    measure()
    // Width changes with the carousel and the viewport, and so does the wrap.
    //
    // Feature-detected rather than assumed: jsdom has no ResizeObserver, and
    // an unguarded `new ResizeObserver` threw inside a passive effect and took
    // 25 unit tests down with it. A browser without one still gets the single
    // measurement above, which is right for every card that is not resized.
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [card.body])

  /**
   * The eyebrow says WHEN, never WHERE FROM.
   *
   * It used to print "book 31 Jul", later "holdings 31 Jul", to mark a number
   * as coming off a snapshot rather than a live feed. That distinction is real
   * and the product still enforces it — `vintageOf`, the `snapshot_vs_live`
   * suppression and the freshness gates all depend on it — but it is an
   * ENGINEERING concern, and it was being shown to readers who reasonably
   * assume holdings and prices are current.
   *
   * So the qualifier is gone from the face of the card. What remains is the
   * date itself, which is the part a reader can act on: a weight from three
   * weeks ago is worth knowing whatever table it came from.
   */
  /**
   * And when it is shown, it says what it is.
   *
   * A bare "Jun 18" sat next to "5 months ago" with nothing to distinguish
   * them, so the card printed two unexplained dates and the reader had no way
   * to tell which one the finding belonged to. It is now prefixed.
   *
   * It is also only shown when the number is OLDER than the event, which is
   * the only case where "as of" is the true relationship. A metric whose asOf
   * is in the future is a deadline — an attention item's due date — and its own
   * label already says so ("until due", "overdue"); dating it here would put
   * "as of" in front of something that has not happened.
   */
  /**
   * Which context chip has its books open, by label. Null when none.
   *
   * Keyed by label rather than a boolean so a card carrying two disclosing
   * chips cannot open both and grow past its own ceiling.
   */
  const [booksOpen, setBooksOpen] = useState<string | null>(null)
  const openBooks = card.context.find(c => c.label === booksOpen)?.portfolios ?? null

  const sameDay = !!card.metric && utcDay(card.provenance.occurredAt) === utcDay(card.metric.asOf)
  const showsSecondDate = !!card.metric && !sameDay &&
    new Date(card.metric.asOf).getTime() < new Date(card.provenance.occurredAt).getTime()

  return (
    <article
      data-signal-card={card.type}
      // As tall as its content, and never taller than one screen.
      //
      // ── What the two previous rules each got half right ──────────────────
      //
      // It was `min-h-full` inside an `overflow-y-auto` section, so a card
      // could EXCEED the viewport and scroll vertically inside a vertical snap
      // scroller. Every upward drag was then ambiguous between "scroll this
      // card" and "next card", and the browser resolves that by giving the
      // gesture to the inner scroller, so the feed stopped advancing.
      //
      // The fix was `h-full`: exactly one screen, always. That killed the
      // conflict and introduced the opposite defect — a two-line workflow card
      // padded out to 844px, so a feed of eight findings took eight full swipes
      // and never showed the reader that a next card existed.
      //
      // Both rules were reaching for the same constraint from opposite sides.
      // The conflict comes from cards TALLER than the viewport, not from cards
      // shorter than it: a card that fits has no inner scroller and nothing to
      // arbitrate. So the rule is a ceiling, not a fixed height. A stale-research
      // card is now about 380px and the next card peeks below it; a case ladder
      // still takes most of the screen because its content genuinely does.
      //
      // `max-h-full` keeps the ceiling and `overflow-hidden` keeps the promise:
      // vertical belongs to the feed, and overflow goes horizontal, which is
      // what the carousel is for.
      // ── Phase 8.1: one viewport per card ─────────────────────────────────
      //
      // `max-h-[100dvh]` was a ceiling on a content-sized card, which produced
      // exactly the inconsistency hands-on testing found: a news card at 327px,
      // a scenario card at 844, and several in between. Swiping through it did
      // not feel like advancing through decisions; it felt like a list that
      // could not decide what it was.
      //
      // `h-full` against a `h-[100dvh]` section is one screen per card. The
      // difference from the version this replaces in Phase 1 is that the space
      // is now COMPOSED — chart, evidence, judgment, actions — rather than
      // absorbed by a spacer, which is what made a two-line workflow card 844px
      // of nothing the first time round.
      /**
       * `--card-bar` is the single source of truth for the room the sticky
       * action bar takes, including the bottom safe area.
       *
       * It was previously two independent magic numbers — the bar's own padding
       * and a `pb-[calc(4.75rem+...)]` on the caption overlay that happened to
       * approximate it. Two numbers meaning one thing drift, and the symptom is
       * content tucked under the bar on whichever card gets there first.
       */
      style={{ ['--card-bar' as string]: 'calc(4.25rem + env(safe-area-inset-bottom))' } as React.CSSProperties}
      className="relative flex h-full w-full flex-col overflow-hidden bg-white dark:bg-gray-900"
    >
      {/* Only critical cards get the rule. If everything has one it stops
          meaning anything, which is what the old 4px rail on every card did. */}
      {showsTopRule(card.severity) && (
        <div className={clsx('h-1 w-full shrink-0', skin.topRule)} aria-hidden />
      )}

      {/* `flex-1` is correct in BOTH height regimes, which is why removing it
          was wrong.
          In a content-sized flex column it distributes free space of which
          there is none, so a short card stays short — it was never what
          stretched them; the `min-h-4 flex-1` spacer below was. Once a card
          reaches the `max-h-[100dvh]` ceiling this is what lets the inner
          regions shrink and the detail scroll inside its bounds instead of
          overflowing into the action bar. */}
      <div className="flex min-h-0 flex-1 flex-col px-4 pt-1.5 pb-2">
        {/* Eyebrow. Severity is the colour of the surface word plus a dot. */}
        <div className="flex items-center gap-2 text-[11px] font-semibold">
          {/* The KIND, not the surface. Four surface words across seventeen
              types made every research finding read as the same card; the kind
              is what a reader scans for. Tappable, restoring the filter-by-kind
              affordance the legacy tiles had and the first convergence lost. */}
          <button
            type="button"
            data-slot="kind"
            onClick={() => onFilterKind?.(card.type)}
            className={clsx(
              'shrink-0 rounded-full px-2 py-0.5 uppercase tracking-[0.06em] transition-opacity active:opacity-70 no-touch-target',
              skin.chip,
            )}
          >
            {/* The card may name itself more precisely than its type can —
                see `SignalCard.kindLabel`. The TAP still filters by type,
                because that is the vocabulary Curate speaks. */}
            {card.kindLabel ?? KIND_LABEL[card.type] ?? card.type}
          </button>

          <span className={clsx('shrink-0', SEVERITY_MARK[card.severity])} aria-hidden />

          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-gray-400 dark:text-gray-500">
            <span className="truncate font-medium normal-case tracking-normal">
              {relative(card.provenance.occurredAt)}
            </span>
            {showsSecondDate && (
              <>
                <span aria-hidden className="shrink-0 text-gray-300 dark:text-gray-600">·</span>
                <span className="shrink-0 font-medium normal-case tracking-normal">
                  as of {shortDate(card.metric!.asOf)}
                </span>
              </>
            )}
          </div>

          {/* The overflow menu. This control was wired to a no-op — it looked
              like an affordance and did nothing, which is worse than having
              none. Snooze, dismiss and "why am I seeing this" live here now. */}
          <div className="relative ml-auto shrink-0" ref={menuRef}>
            <button
              type="button"
              data-slot="menu"
              aria-label="More options"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(v => !v)}
              // The box stays inside its parent; only the glyph moves.
              //
              // A negative margin was added here twice for optical alignment —
              // the dots sit ~6px inside a 36px round hit target, so against
              // the container padding the icon looks indented relative to the
              // text below it. Both times it put the button outside the
              // parent's content box and made the eyebrow row scrollable.
              // Translating the icon achieves the same alignment and cannot
              // affect layout, because a transform does not contribute to
              // scrollWidth.
              className="flex items-center justify-center h-11 w-11 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <MoreHorizontal className="h-5 w-5 translate-x-[3px]" />
            </button>
            {menuOpen && (
              <div data-slot="menu-panel" className="absolute right-0 top-12 z-30 w-[264px] max-w-[80vw] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800">
                {/* Why this surfaced.
                    Every builder has written a `provenance.reason` since the
                    contract existed and nothing has ever rendered one, so the
                    answer to "why am I being shown this" lived only in the
                    source. It matters more now that triggers are composite: a
                    card can fire on a combination the reader cannot reconstruct
                    from the headline. Not on the face of the card — it is a
                    question people ask occasionally, and the card is already
                    carrying its claim, its evidence and its question. */}
                <div className="border-b border-gray-200 px-4 pt-2.5 pb-2.5 dark:border-gray-700">
                  <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
                    Why this surfaced
                  </p>
                  <p data-slot="menu-reason" className="mt-1 text-[12px] font-normal normal-case leading-snug tracking-normal text-gray-600 dark:text-gray-300">
                    {card.provenance.reason}
                  </p>
                </div>
                {/* The reason is ABOVE, so the button asking for it is gone.

                    `builders/shared` appends `WHY` to every card's menu, and
                    it has done since before this panel rendered
                    `provenance.reason` — so the menu printed the answer under
                    its own heading and then offered "Why am I seeing this"
                    directly beneath it. Every call site passed a no-op, so it
                    was also a control that did nothing.

                    Filtered here rather than removed from the contract on
                    purpose. A surface that shows the reason some other way —
                    a desktop card, a digest — still wants the action in the
                    grammar, and nine builders and their tests should not churn
                    for a decision this component is the only one making. */}
                {card.actions.menu.filter(a => a.id !== 'why').map(a => (
                  <button
                    key={a.id}
                    type="button"
                    data-slot="menu-item"
                    onClick={() => { setMenuOpen(false); onAction(a.id, card) }}
                    className="block min-h-[44px] w-full px-4 py-3 text-left text-[14px] font-medium normal-case tracking-normal text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60"
                  >
                    {a.label}
                  </button>
                ))}

                {/* Feedback about the FEED, below a rule and under its own
                    heading.
                    The items above answer "what should happen to this card";
                    these answer "should Tesseract have shown it". Same menu,
                    because a reader reaching for one is plausibly reaching for
                    the other — and visibly separate, because they go to
                    different places and mean different things. */}
                {feedback.length > 0 && (
                  <div className="border-t border-gray-200 dark:border-gray-700">
                    <p className="px-4 pt-2.5 pb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                      About this card
                    </p>
                    {feedback.map(f => (
                      <button
                        key={f.key}
                        type="button"
                        data-slot="menu-feedback"
                        data-feedback={f.key}
                        onClick={() => { setMenuOpen(false); onFeedback?.(f) }}
                        className="block min-h-[44px] w-full px-4 py-3 text-left text-[14px] font-medium normal-case tracking-normal text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700/60"
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The claim. Never carries the number — the metric block does. */}
        {/* The claim. Never carries the number — the metric block does.
            Sized by length: 26px is right for "AMZN has reached your target"
            and wrong for a headline that wraps to three lines, where it stops
            being a claim and becomes the card. */}
        <h2 className={clsx(
          // Tight to the eyebrow above it. The kind pill and the claim are one
          // unit — the pill says what sort of thing this is and the headline
          // says what it is — and a gap between them read as two separate rows.
          /**
           * Three lines, and a ceiling that did not exist before.
           *
           * The size already stepped down with length, but nothing bounded the
           * HEIGHT: a 70-character headline at 21px wraps to four lines on a
           * 358px column, and every region below it here is `shrink-0`. So a
           * long headline did not shrink the card's other content, it pushed
           * it past the bottom edge — where the ancestor's `overflow-hidden`
           * cut it off silently. Measured on the New Research card, whose
           * headline names the event and is the longest the family emits.
           *
           * The headline is the highest-priority region and still is: three
           * lines is a generous ceiling that no current copy reaches, and a
           * clamped fourth line is a far smaller loss than the metadata and
           * body it was evicting.
           */
          'mt-1 shrink-0 line-clamp-3 leading-[1.15] font-semibold tracking-[-0.025em] text-gray-900 dark:text-white',
          card.headline.length > 62 ? 'text-[21px]'
            : card.headline.length > 44 ? 'text-[23px]'
            : 'text-[26px]',
        )}>
          {/* Long green, short red — the only place colour is not decorative.
              A pair headline names two sides and the reader has to know which
              is which before anything else on the card means anything. The
              split is on the literal words the builder emits, so a headline
              that is not a pair passes through untouched. */}
          {renderSidedHeadline(card.headline)}
        </h2>

        {/*
          Whose view this is — but only where the headline has not already said.

          ── The gap this closes ──────────────────────────────────────────────

          `provenance.actor` has always been set by the post builders and never
          rendered anywhere on the face of the card. On a single-name idea that
          went unnoticed because the headline opens with the name ("Priya Raman
          wants to buy COIN"). A pair headline states the expression instead, so
          there was no way to tell whose trade it was without opening the menu —
          reported from the phone, and correct.

          An idea in this product is a person's view plus the expression they
          are proposing. The person is part of its identity, not metadata.

          The guard is the headline itself rather than a new contract field: if
          the claim already names the actor, a second line would be the same
          fact twice, which is the duplication this card has been through more
          than once. So every existing card renders exactly as it did.
        */}
        {card.provenance.actor?.name
          && !card.headline.includes(card.provenance.actor.name) && (
          <p
            data-slot="author"
            className="mt-1 shrink-0 truncate text-[13px] font-semibold text-gray-500 dark:text-gray-400"
          >
            {card.provenance.actor.name}
          </p>
        )}

        {card.metric && (
          // One line, not a stacked well.
          //
          // The value and its label sat on separate rows inside 20px of
          // vertical padding, which is how a two-word fact came to occupy the
          // height of a chart. Baseline-aligned on one row they read as a
          // single statement — "6mo past its horizon" — and give the evidence
          // band back about 60px. The tint stays, because the surface hue is
          // what makes a risk number legible as a risk number before it is
          // read at all; it is just no longer wrapped around empty space.
          // shrink-0 is load-bearing.
          //
          // Without it this was the only flexible row above the evidence band,
          // and a flex child defaults to `flex-shrink: 1`. On a tight card the
          // column resolved the overflow by squeezing THIS box — the one with
          // `overflow-hidden` on it — so the number and its label were sliced
          // horizontally and the well read as a banner half-hidden behind the
          // chart below it. Nothing was overlapping; the row had been crushed.
          <div className={clsx(
            'mt-3 -mx-1.5 flex shrink-0 items-baseline gap-2 overflow-hidden rounded-xl px-2 py-1.5',
            skin.metricWell,
          )}>
            <span className={clsx(
              'shrink-0 leading-none font-bold tabular-nums tracking-[-0.035em]',
              metricSize(card.metric.value),
              METRIC_TONE[card.metric.direction ?? 'neutral'],
            )}>
              {card.metric.value}
            </span>
            <span className="min-w-0 truncate text-[11px] font-semibold uppercase tracking-[0.05em] text-gray-400">
              {card.metric.label}
            </span>
          </div>
        )}

        {/* Evidence gets real space now that the card owns the screen. */}
        {/* Fixed band, not flex-1.
            Letting the evidence absorb all the slack passed the dead-space rule
            and moved the emptiness inside the chart: a 500px-tall ladder with
            the axis floating in the middle of nothing. The slack belongs to the
            detail, which is content.

            The chart takes the space the card is not spending on a control.

            It has climbed 164 → 180 → 260, and the first two moves were too
            timid because they took the height from nowhere: each was capped by
            whatever the rest of the card would spare. The metric well paid for
            this one, going from a stacked 98px block to a 40px line.

            Two heights rather than one, because the constraint genuinely
            differs. A card whose disclosure holds a slider and a commit button
            needs ~160px down there or the button lands under the action bar —
            one working control traded for another. A card whose disclosure is
            prose, or which has none, has no such floor and can give the chart
            35% of the screen, which is where a chart stops being a garnish. */}
        {/* The question and the position context sit ABOVE the evidence.
            They were below it, under the interactive band, which put the two
            lines that say what this is about and whether it is your problem
            at the bottom of the card — after the thing they frame. Moving
            them up also stops them competing with the carousel for the slack:
            they are fixed-height rows, so the band gets everything else. */}
        {/* The question, in its own right.
            WHAT HAPPENED is the headline, WHY IT MATTERS is the metric, and
            this is the third thing a reader needs and the only one that had no
            home: it was either the last clause of the body or buried inside a
            response control they had to scroll to before knowing a question
            existed. On a phone, where engagement is decided in about a second,
            that ordering is the whole problem. Set in the surface accent so it
            reads as the card speaking rather than as more body copy. */}
        {/* The question, once the reader has asked for it.
            In the resting state an `on_engage` card shows the affordance below
            instead — the situation without the interrogation. */}
        {/* The card asks only when it asks INLINE. In the engaged state the
            response bar carries the question itself, and printing it in both
            places is how a 390px card ends up saying one thing twice. */}
        {card.prompt && presentation === 'inline' && (
          <p
            data-slot="prompt"
            className={clsx('mt-2 shrink-0 text-[15px] font-semibold leading-snug', skin.accentText)}
          >
            {card.prompt}
          </p>
        )}

        {/* The engagement affordance.
            One control, in the place the question used to occupy, so the card
            keeps its rhythm and the reader keeps the choice. Deliberately NOT
            a tap anywhere on the evidence region: that region holds the chart
            and the sliders, and giving it a second meaning is precisely the
            gesture ambiguity this phase exists to remove. */}
        {/* Context as a legible row, not decorative pills. "Held · 2" at 11px
            inside a grey pill was invisible, and it is the line that says
            whether any of this is your problem. */}
        {/* No context row? The affordance still needs somewhere to live. */}
        {/* No context row? The toggle still needs somewhere to live — and it
            has to be the TOGGLE, not just the way in. This branch used to
            render only the engage button, so a card with no context chips
            could be entered and never left: the back control lived exclusively
            in the context-row branch below. Both branches render the same
            control in both states now, so an escape path cannot go missing
            because of what a card happens to carry. */}
        {card.context.length === 0 && (offersEngagement || judgmentOpen) && (
          <button
            type="button"
            data-slot={judgmentOpen ? 'judgment-back' : 'engage'}
            onClick={() => setEngaged(!judgmentOpen)}
            className={clsx(
              'mt-2 flex shrink-0 items-center gap-0.5 self-start rounded-full border px-2 py-0.5',
              'text-[11px] font-bold transition-colors no-touch-target',
              skin.accentText, 'border-current/40',
            )}
          >
            {judgmentOpen ? (
              <>
                <ChevronDown className="h-3 w-3 rotate-90" aria-hidden />
                Back
              </>
            ) : (
              <>
                {card.prompt ? 'Your view' : 'Review'}
                <ChevronDown className="h-3 w-3" />
              </>
            )}
          </button>
        )}

        {card.context.length > 0 && (
          // One line, not a wrapping block.
          //
          // Naming the books instead of counting them made this row longer —
          // "Core Equity, Large Cap Growth · Conviction high · Book 4mo old"
          // wraps to two lines on a 390px card — and every pixel it takes comes
          // out of the disclosure below, which is where the controls live. This
          // is a supporting row: it should cost one line, and the chips that do
          // not fit should be off the edge rather than pushing a slider under
          // the action bar.
          <div className="mt-2 shrink-0">
            {/* `min-w-0` per chip so a long one shrinks instead of running off
                the edge. Measured: "S&P 500 via SPY (ETF proxy)" overshot the
                card by 33px and was cut mid-word, because `overflow-hidden` on
                the ROW clips without ever making a child narrower. */}
            <div className="flex min-w-0 max-h-[3.4rem] flex-wrap items-center gap-x-2 gap-y-0.5 overflow-hidden text-[13px]">
              {card.context.map((chip, i) => (
                <span key={chip.label} className="flex min-w-0 items-center gap-2">
                  {i > 0 && <span className="text-gray-300 dark:text-gray-600" aria-hidden>·</span>}
                  {/* A chip that has books behind it DISCLOSES; it does not
                      navigate.

                      Tapping "Vision Fund" used to leave the feed immediately,
                      and "In 2 portfolios" was inert text stating a number the
                      reader obviously wanted to open. Both are the same
                      mistake. The answer — which books, and how big — fits in
                      the card, and leaving the feed to find it costs the reader
                      their place in it. Navigation is still available, as an
                      explicit action per row below. */}
                  {chip.portfolios?.length ? (
                    <button
                      type="button"
                      data-slot="context-disclose"
                      aria-expanded={booksOpen === chip.label}
                      onClick={() => setBooksOpen(v => (v === chip.label ? null : chip.label))}
                      className="flex min-w-0 items-center gap-1 font-semibold text-gray-700 underline decoration-dotted decoration-gray-400 underline-offset-2 active:opacity-70 dark:text-gray-200 no-touch-target"
                    >
                      <span className="min-w-0 truncate">{chip.label}</span>
                      <ChevronDown className={clsx('h-3.5 w-3.5 transition-transform', booksOpen === chip.label && 'rotate-180')} />
                    </button>
                  ) : chip.href && onContext ? (
                    <button
                      type="button"
                      data-slot="context-link"
                      onClick={() => onContext(chip)}
                      className="min-w-0 truncate font-semibold text-gray-700 underline decoration-gray-300 underline-offset-2 active:opacity-70 dark:text-gray-200 dark:decoration-gray-600 no-touch-target"
                    >
                      {chip.label}
                    </button>
                  ) : (
                    <span className="min-w-0 truncate font-semibold text-gray-700 dark:text-gray-200">{chip.label}</span>
                  )}
                </span>
              ))}

              {/* The engagement affordance, at the END of the context row.
                  It had a line of its own, which cost a card with exactly one
                  screen about 30px to say two words. The context row already
                  runs the width of the card and is the line a reader scans for
                  "is any of this mine" — the offer to answer belongs at the end
                  of that sentence rather than under it. Sized to the chips
                  beside it, so the row still reads as one line. */}
              {/* Back sits exactly where "Your view" was.
                  The two are the same control in two states — open the
                  question, close it again — so putting the way out anywhere
                  else makes the reader hunt for a button they just pressed.
                  It also keeps the band whole: a back link above the response
                  cost it a line on a card with one screen. */}
              {judgmentOpen && (
                <button
                  type="button"
                  data-slot="judgment-back"
                  onClick={() => setEngaged(false)}
                  className={clsx(
                    'ml-auto flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-0.5',
                    'text-[11px] font-bold transition-colors no-touch-target',
                    skin.accentText, 'border-current/40',
                  )}
                >
                  <ChevronDown className="h-3 w-3 rotate-90" aria-hidden />
                  {/* "Back", not the name of a pane.
                      It was hard-coded to "Evidence", which is the wrong word
                      on every card that has no evidence pane — most of them.
                      Naming the actual previous pane would be correct too, but
                      it changes per card and per framing, and a control whose
                      label moves is a control the reader has to read every
                      time. One word, structurally true everywhere. */}
                  Back
                </button>
              )}

              {offersEngagement && (
                <button
                  type="button"
                  data-slot="engage"
                  onClick={() => setEngaged(true)}
                  className={clsx(
                    'ml-auto flex shrink-0 items-center gap-0.5 rounded-full border px-2 py-0.5',
                    'text-[11px] font-bold transition-colors no-touch-target',
                    skin.accentText, 'border-current/40',
                  )}
                >
                  {card.prompt ? 'Your view' : 'Review'}
                  <ChevronDown className="h-3 w-3" />
                </button>
              )}
            </div>

          </div>
        )}

        {hasEvidence && (
          <div className={clsx(
            'mt-2.5 flex flex-col',
            // Three tiers, because the constraint really is three-way: a chart
            // with a control and a question below it has the least room to
            // give, and the chart is the one element that stays legible when
            // trimmed by 20px.
            /**
             * With one carousel the band takes the slack rather than a fixed
             * height. `flex-1` with a floor means the prose below it — body,
             * question, chips — keeps its natural height and the band gives up
             * whatever is left, so nothing below can be pushed under the action
             * bar. A fixed 300px did exactly that: it claimed its height first
             * and the text ran off the bottom.
             */
            /**
             * `max-h-[46%]` alongside `flex-1`.
             *
             * The band took every spare pixel, so on a card with a short body
             * the chart grew to fill the screen — reported on the overdue
             * tiles as the chart being large where the text needed the room.
             * A floor without a ceiling means the evidence expands to whatever
             * the prose does not claim, which is backwards: the prose is what
             * varies, and the chart is legible at 200px or 400px alike.
             *
             * The cap is a share rather than a pixel count so it holds on a
             * small phone and a large one, and it sits above the 172px floor
             * on every viewport this surface supports.
             */
            /**
             * A floor the prose can push through, because a short chart is
             * legible and clipped text is not.
             *
             * 172px was a hard floor with every sibling `shrink-0`, so once the
             * fixed regions above and below exceeded what was left, nothing
             * yielded — the band held its height and the body ran off the
             * bottom. That is the wrong thing to protect: the content-priority
             * rule puts the headline, the metric, the context rows and one body
             * statement above the evidence band, and a chart at 140px says
             * everything a chart at 172px says.
             *
             * The ceiling is unchanged, so a card with room still gives the
             * band its share rather than stretching the prose.
             */
            /**
             * A SHARE of the card, not whatever the header left over.
             *
             * ── The root cause this fixes ───────────────────────────────────
             *
             * `flex-1` with a pixel floor makes the band a RESIDUAL: it gets
             * what the `shrink-0` siblings above and below do not take. So the
             * chart's size varied inversely with how much chrome a card's
             * header carried — Case vs Price has a compact header and reached
             * the 46% ceiling, while a Trade Idea stacking pill, headline,
             * question, conviction, stage and return squeezed its band toward
             * the floor. Same component, same branch, charts that looked like
             * different products.
             *
             * A percentage FLOOR makes it a contract instead: every carousel
             * card gives its primary visual at least 38% of the card, whatever
             * its header weighs, so a heavy header cannot squeeze the chart to
             * nothing.
             *
             * ── The ceiling, and why it is gone ─────────────────────────────
             *
             * There was a `max-h-[46%]` beside it, for cross-card consistency:
             * a light-header card would otherwise get a bigger band than a
             * heavy-header one. It also stopped the band eating the space the
             * description needed — which stopped mattering the moment the
             * description became a fixed box AFTER this one, since a later
             * sibling with a fixed height cannot be eaten.
             *
             * What it did instead was cap the workspace at roughly 300px on a
             * 737px card, so the panes were compressed while the same card
             * carried 135px of nothing between the pager and the description.
             * Content losing to emptiness inside one card is not a consistency
             * worth having, and the consistency it bought was never the thing
             * a reader notices — an under-filled card is.
             *
             * The workspace now takes everything the header, the description
             * and the footer do not. It varies with header weight, which is
             * unavoidable once it owns the remainder.
             *
             * ── Why the floor is a BASIS, not a `min-height` ────────────────
             *
             * `min-h-[38%]` is absolute: it holds even when the column has
             * less room than the card needs, so on a short phone with a
             * three-line headline the band kept its 38% and the overflow came
             * out of the bottom — measured at a 612px card, the description
             * sat 78px THROUGH the action bar.
             *
             * `basis-[38%]` with grow and shrink is the same 38% as a starting
             * point. Free space is measured from there and handed back, so
             * with room the band still ends up at exactly the remainder; and
             * when there is no room it gives some back instead of pushing the
             * footer off the card. A share the reader gets when it exists,
             * rather than a promise the layout cannot keep.
             *
             * `min-h-0` is what lets it shrink at all: a flex item's automatic
             * minimum is its content size, which would reinstate the overflow
             * through the carousel instead of through the class.
             *
             * ── And why the grow factor is 999 ─────────────────────────────
             *
             * The body spacer also grows, because a card with neither a
             * carousel nor a detail block has nothing else that can, and free
             * space in a flex column otherwise collects BELOW the description.
             * The first attempt gave the spacer a factor of 0.001 — which does
             * not work: when the grow factors sum to less than one, the spec
             * hands out only that fraction of the free space and leaves the
             * rest unused, so 211px still sat under the description.
             *
             * Inverted instead. Both claimants have whole factors, so the sum
             * is never below one and every pixel is distributed; 999 to 1
             * means the workspace takes 99.9% of it wherever a workspace
             * exists, and where none does the spacer is the only claimant and
             * takes all of it. One rule, no branch on card shape.
             */
            merged ? 'grow-[999] shrink basis-[38%]'
              : detail && card.prompt ? 'h-[200px]'
              : detail ? 'h-[236px]'
              : 'h-[264px]',
          )}
          /**
           * A real floor under the pane viewport, not `min-h-0`.
           *
           * `min-h-0` let this band shrink to nothing, and because it is a flex
           * child that shrinks rather than overflows, a card sized too short
           * did not clip visibly — the analytical region silently collapsed and
           * what remained was a headline and a button, while the outer height
           * still matched what the resolver predicted. Every height assertion
           * passed and the card was wrong. That is the defect human review
           * reported as "Target Reached is now extremely short".
           *
           * `PANE_VIEWPORT_MIN_PX` is the shared floor a pane needs to be worth
           * drawing, so the resolver's assumption and the DOM now agree. A band
           * that still cannot fit overflows visibly and measurably instead of
           * disappearing, which the calibration suite can then catch.
           */
          /**
           * A band holding a RESPONSE has a bigger floor than one holding
           * evidence, because a response is not compressible.
           *
           * `PANE_VIEWPORT_MIN_PX` is the least a pane needs to be worth
           * drawing — a chart at 168px is a small chart, and that is a fair
           * trade. A note field at 24px is not a small note field; it is a
           * clipped one. Reported as the note box being cut off on Case vs
           * Price: the pane's content box held 199px inside 179 with
           * `overflow-y: hidden`, so twenty pixels of the field were silently
           * removed rather than shown small.
           *
           * `responseBandMinPx` states what a response occupies, from parts
           * measured in the running app, so the floor and the thing standing
           * on it are the same number.
           *
           * Keyed on the reader BEING in the response, not on the card having
           * one — and this has been both, which is worth recording because the
           * two trade one defect for the other.
           *
           * `judgmentOpen` alone was wrong: that is the engaged route only,
           * and the scenario cards answer inline as a carousel page, so the
           * floor never reached the family it was written for. `respondActive`
           * covers both routes, which is what it exists for.
           *
           * Keying it on merely HAVING a judgment pane was wrong the other
           * way, and worse. It applied the response's floor while the reader
           * was still browsing, so the band ran 243px on a card the resolver
           * had budgeted 176 for — and the 67px came off the bottom, sliding
           * the description underneath the action tray. Reported on Target
           * Reached as the two lines of description being cut off.
           *
           * The model budgets this floor under `workflow: 'active'` and only
           * there, so the DOM has to apply it in the same state or the two
           * disagree by exactly the amount that overflows.
           *
           * The cost is that the band grows when the reader arrives at the
           * response rather than being that size all along. That is a real
           * trade and it was measured both ways: keyed on having the pane, the
           * scenario family overflows its column by 6-8px while merely
           * BROWSING, which is a defect every reader sees. Keyed on being in
           * it, nothing overflows in either state — verified in the running
           * app, where the note fits on arrival with 88px to spare.
           */
          style={merged || judgmentPane
            ? {
                /**
                 * ONE height, for the life of the card.
                 *
                 * This was keyed on the reader being IN the response, which
                 * made the band grow from 207 to 227 the moment they reached
                 * it — the pager and everything under it dropping 20px
                 * mid-card. Reported as the carousel moving down when the
                 * respond pane is selected, and it is the right complaint:
                 * the band is one box that several panes take turns in, so a
                 * height that depends on WHICH pane is showing is not a
                 * height, it is a jump.
                 *
                 * So it is the max of what any pane in this card needs,
                 * computed once. A card with a response reserves the
                 * response's room whether or not the reader has got there
                 * yet; everything else keeps the ordinary pane floor.
                 *
                 * The reason this is affordable now and was not before is
                 * `RESPONSE_PARTS`: the consequence box was reserving 44px for
                 * 30px of text, and the pager 28 for a 24px row. Twelve
                 * pixels of slack were the difference between a constant band
                 * and a jumping one.
                 */
                minHeight: judgmentPane
                  // No pager on a card whose only pane is its answer.
                  ? responseBandMinPx(2, (merged?.length ?? 0) > 1)
                  : PANE_VIEWPORT_MIN_PX,
              }
            : undefined}>
            {judgmentOpen ? (
              <div className="flex h-full min-h-0 flex-col" data-slot="judgment-open">
                {judgmentPane!.content}
              </div>
            ) : merged ? (
              <CardCarousel
                panes={merged}
                focusPaneId={focusPaneId}
                onActiveChange={paneId => {
                  // Remembered so disengaging can restore it — see the effect
                  // above. The carousel does not know the judgment exists.
                  activeCarouselPane.current = paneId
                  setActivePaneId(paneId)
                  onPaneChange?.(paneId)
                }}
              />
            ) : evidence}
          </div>
        )}

        {/* Closed, the body is a clamped teaser and takes no space it does not
            need. Open, it becomes a bounded scroller.

            It used to be `line-clamp-5` in both states and `shrink-0` in both,
            which meant "Show more" on a long body revealed five lines and then
            silently ate the rest: no clamp indicator, no scrollbar, no way to
            reach the end. A control labelled "show more" that cannot show more
            is worse than no control. `flex-1 min-h-0 overflow-y-auto` lets the
            open state absorb the slack the detail is not using and scroll
            within it, so the card still never grows past its screen. */}
        {/* The body IS its own control.
            "Show more" used to be a 22px button row of its own beneath the
            prose. On a card already carrying a chart and a slider that row was
            pure overhead — it cost the disclosure below more height than the
            line of text it revealed. Tapping the paragraph is the same gesture
            with none of the furniture, and the trailing "more"/"less" keeps the
            affordance visible.

            Open, the region becomes a bounded scroller. It used to be
            `line-clamp-5` and `shrink-0` in both states, so "Show more" on a
            long body revealed five lines and silently ate the rest: no
            indicator, no scrollbar, no way to reach the end. */}
        {/* The caption pattern, not a layout push.
            ── Why it overlays instead of expanding in flow ──────────────────
            Expanding in flow meant the body competed with the disclosure for
            the same slack, and the disclosure won because its content is
            taller: "more" fired, the layout barely moved, and the reader got a
            few extra words. Making it a scroller instead — the version this
            replaces — bought room by adding a second vertical scroll owner to a
            feed whose whole gesture contract is that there is one.
            A reel caption solves this without either. It rises over the card,
            takes as much of the tile as it needs, dims what is behind it so the
            text stays legible, and collapses on the next tap. Nothing below it
            moves, so the action bar and the judgment stay exactly where the
            thumb left them. */}
        {/* `relative` is load-bearing, and its absence was a real defect.

            The "more" affordance below is `absolute bottom-0 right-0`, meant
            to sit at the end of the clamped paragraph. With no positioned
            ancestor between it and the `<article>`, it resolved against the
            ARTICLE instead — so it rendered at the bottom-right corner of the
            whole card, underneath the sticky action bar, which paints over it
            because it comes later in the DOM. The affordance was invisible on
            every card with a long body, while the ellipsis said there was more
            to read. */}
        {/* Part of the workspace, not something under the description.
            It used to render AFTER the two-line description, so on a card that
            carries one the description sat mid-card with the detail between it
            and the footer — the description is supposed to be the last thing
            above the bar on every card, not only on the ones the carousel
            happens to serve. Moved, not restyled: it is the same block with
            the same `flex-1`, and on these cards it is what absorbs the height
            the carousel absorbs elsewhere. */}
        {/* Detail in place. A card that must send you elsewhere to be
            understood is a notification. */}
        {!merged && detail && (
          /* No toggle.
             It was a 44px row reading "Show detail" / "Hide detail" above the
             thing it revealed, on a card that has exactly one screen to spend.
             It cost more height than most of what it hid, it made every card
             open in a state where its own control was invisible, and "Hide
             detail" is a label about the interface rather than the investment.
             The detail is part of the card now.

             `min-h-[168px]` is a floor under the judgment: a question line plus
             a 44px answer row plus the confirm control and their spacing — the
             least this region can be and still show what it asks the reader to
             do. Without it the region was free to collapse to nothing, and did,
             because the evidence band above it was `shrink-0`. */
          <div className={clsx(
            // Same 999-to-1 claim on free space as the carousel band: on the
            // cards that have one, the detail IS the workspace.
            'mt-3.5 flex min-h-0 shrink grow-[999] basis-0 flex-col',
          )}>
            {/* Not a scroller. Measured at 390x844 an earlier version hid real
                content on six card types — 311px of it on the six-case ladder —
                and none of it was reachable, because the feed will not hand a
                vertical drag to an inner scroller. Panes that exceed a screen
                page sideways instead. */}
            <div className="min-h-0 flex-1 overflow-hidden" data-testid="card-detail">
              {detail}
            </div>
          </div>
        )}

        {/**
          * Supporting prose has an INVARIANT two-line height.
          *
          * ── The jitter, and the overcorrection ──────────────────────────
          *
          * It was `line-clamp-1`, which is `-webkit-line-clamp` over a box
          * whose height still comes from wrapped content. That height is a
          * function of the available WIDTH, and the width of this column moves
          * whenever anything above it settles — the carousel mounting, a chart
          * resolving, a scrollbar appearing, the `more` affordance mounting
          * after the first measurement pass. Each of those re-wrapped the
          * sentence, the clamp box re-resolved, and the card's whole lower half
          * — chart, pager, footer — moved with it. On the first Case vs Price
          * tile that read as the card twitching while idle.
          *
          * `truncate` stopped it by removing the wrap entirely, and paid for
          * that with a single line, which is not enough of a sentence to be
          * worth putting on the card at all.
          *
          * The fix was never the clamp; it was WHERE THE HEIGHT COMES FROM. A
          * two-line clamp inside a box fixed at `h-[3em]` is both: the text may
          * re-wrap between one line and two as the column resizes, and the box
          * it is in was never sized from the text, so nothing below it moves.
          *
          * Primary prose keeps the same clamp with no fixed box — see
          * `bodyIsPrimaryProse`. It is the finding rather than a description of
          * one, and it is not what was moving.
          */}
        {/* The slack, given somewhere to go.
            ── The dead region under the description ──────────────────────────
            The band above is capped at 46% of the card, so a card with a light
            header finishes its content with room to spare — and free space in
            a flex column collects AFTER the last item, so all of it landed
            BELOW the description. The paragraph sat halfway down the card with
            a hand's width of nothing between it and the footer, which is what
            made the No Core Thesis tile read as unfinished.

            It is the 14px gap the description used to carry as its own top
            margin, moved into a box: as margins, `mt-3.5` and an auto margin
            would have been the same property fighting over precedence.

            ── What it must NOT be ────────────────────────────────────────────
            It was `min-h-[0.875rem] flex-1`, which made it an equal claimant on
            free space with the carousel band — same `flex-grow: 1`, same
            `flex-basis: 0%`. Measured on a 737px card: the band was pinned to
            its 38% floor at 247px and this took the surplus, 135px of nothing
            between the pager and the description, while every pane above was
            compressed. The dead region had not been removed, only moved up the
            card and given a reason to grow.

            A gap is a gap — but it cannot be ONLY a gap, because not every
            card has a flexible region. A card with no carousel and no detail
            has nothing that grows at all, and free space in a flex column
            collects after the last item: measured at 390x844, such a card put
            212px below the description instead of above it. The dead region
            came back on exactly the families this pass was not about.

            So the gap grows — but at 1 against the workspace's 999. Free
            space is shared in proportion to the grow factors, so where a
            workspace exists it takes 99.9% and this stays 14px; where none
            exists this is the only claimant and takes all of it, keeping the
            space above the description rather than below it. One declaration,
            both behaviours, no branch on card shape.

            The factors are 999 and 1 rather than 1 and 0.001 because factors
            summing to less than one distribute only that fraction of the free
            space and leave the rest unused — which left the 211px exactly
            where it was. */}
        <div data-slot="body-spacer" className="h-3.5 shrink-0 grow" />
        {/* Reserved for a description, not for the absence of one.
            Two blank lines above the footer is the same dead region this pass
            removed, just moved down the card. A short sentence still gets the
            full two lines — that is what makes the geometry a contract — but a
            card that carries no prose at all (a trade idea whose headline IS
            the proposal, see `headlineIsThePost`) reserves nothing. */}
        {/**
          * The description does not appear beneath a commit control.
          *
          * ── The ordering this fixes ────────────────────────────────────────
          *
          * The response module ends with its commit, and the card then renders
          * the supporting description and the sticky action bar underneath —
          * so on any family whose commit sits inside the pane the reader met
          * "choose, explain, submit" followed by a sentence about the issue and
          * a second row of buttons. The submit was in the middle of the tile.
          *
          * The sentence is context for a card being READ. While it is being
          * ANSWERED it is the one thing on screen that belongs to a different
          * task, and it is the only thing between the commit and the bar that
          * can be removed without taking a control away.
          *
          * The box is still reserved — `h-[3em]` is a fixed region, so nothing
          * below it moves when the reader opens or closes Respond. Hiding the
          * text without hiding the box is what keeps the footer where their
          * thumb left it.
          */}
        {!!card.body?.trim() && (
        <div
          data-slot="body-region"
          data-respond-active={respondActive ? 'yes' : 'no'}
          data-prose-role={bodyIsPrimaryProse(card.type) ? 'primary' : 'supporting'}
          className={clsx(
            'relative shrink-0 text-[15px] leading-[1.5] text-gray-600 dark:text-gray-300',
            // Exactly two lines, by construction rather than by measurement.
            // The paragraph inside may wrap to one line or to two; the box does
            // not change either way, so nothing below it can move.
            /**
             * Reserved while browsing, surrendered while answering.
             *
             * Two line-heights, whether the reader is browsing or answering.
             *
             * This has been all three states in one week, which is worth
             * recording. It reserved the box and blanked the text, so a reader
             * mid-response saw 48px of nothing where the finding had been.
             * Then it collapsed the box as well, to buy the clipped note above
             * it some room. Then the reader said the quiet part: "i dont see
             * the text at the bottom of the tile for the description or that
             * info. i need to see that."
             *
             * They are right, and the original instinct was the wrong way
             * round. The description is the reason the question is being asked
             * — "No stated upside is left on capital you are still holding" is
             * what makes "has the investment view changed?" answerable. Hiding
             * it at the exact moment the reader is deciding removes the
             * evidence and keeps the prompt.
             *
             * So the box stays, the text stays, and the room the response
             * needs comes from `responseBandMinPx` being budgeted properly
             * rather than from blanking the one line that justifies the ask.
             */
            !bodyIsPrimaryProse(card.type) && 'h-[3em] overflow-hidden',
          )}
        >
          <p
            ref={bodyRef}
            {...(bodyIsLong ? { onClick: () => setBodyOpen(true), 'data-slot': 'body-toggle', role: 'button' } : {})}
            className={clsx(
              bodyIsLong && 'cursor-pointer',
              // Two lines, always.
              //
              // It used to vary by what else the card carried — one line with a
              // chart and a question, three with neither — which meant the
              // card's own height budget leaked into its typography and no two
              // cards agreed on how much prose was normal. Two lines and a
              // "more" is a fixed cost the band above can plan around, and the
              // full text is one tap away in the drawer.
              /**
               * One line for supporting prose, two where the prose is the
               * finding. See `bodyIsPrimaryProse` — the space a supporting
               * description was taking came straight off the chart above it.
               */
              /**
               * Two lines for both roles now, and the jitter is held off by
               * the WRAPPER rather than by the clamp.
               *
               * `line-clamp-1` re-wrapped and moved the card; `truncate` could
               * not re-wrap but bought that with a single line, which is too
               * little of a sentence to be worth reading. A clamp inside a box
               * whose height is fixed independently of it is the combination
               * that gives both: the text may re-wrap between one line and two
               * as the column resizes, and nothing below it moves, because the
               * box was never sized from the text.
               */
              'line-clamp-2',
            )}
          >
            {card.body}
          </p>
          {/* "more" sits ON the second line, not under it.
              As a block below the paragraph it cost a third line — which is
              the opposite of clamping to two — and left the affordance
              detached from the text it belongs to. Absolutely positioned at
              the end of the clamped block instead, over a short fade so it
              never lands on top of a word. */}
          {bodyIsLong && (
            <button
              type="button"
              data-slot="body-more"
              onClick={() => setBodyOpen(true)}
              className="absolute bottom-0 right-0 flex items-end bg-gradient-to-l from-white via-white pl-6 text-[15px] leading-[1.5] font-semibold text-gray-500 dark:from-gray-900 dark:via-gray-900 dark:text-gray-400 no-touch-target"
            >
              more
            </button>
          )}
        </div>
        )}


        {/* The spacer is gone.
            It existed to push the action bar to the bottom of a card that was
            always exactly one screen, which is precisely the mechanism that
            padded a two-line workflow card out to 844px. With the card sized to
            its content there is no slack to absorb, and a short card ends where
            its content ends. */}
      </div>

      {/* The books, in a sheet — the same gesture as the caption.
          ── Why not the inline panel it replaces ───────────────────────────
          Expanding under the chip pushed the card's own content down and cost
          height on a surface that has exactly one screen, so the panel had to
          cap itself at four rows and state a remainder. A sheet has none of
          those constraints: it can show every portfolio, it can scroll because
          it is an overlay rather than part of the snap feed, and the card
          underneath does not move at all.
          It also makes the two disclosures on this card behave alike. "More"
          and a portfolio name are both "show me more about this", and having
          one rise over the card while the other pushed it around was two
          answers to one question. */}
      {openBooks && (
        <BottomSheet
          open
          onClose={() => setBooksOpen(null)}
          title={booksOpen ?? 'Portfolios'}
          snapPoints={[0.5, 0.85]}
          aria-label="Portfolio context"
        >
          <div data-slot="portfolio-disclosure" className="px-4 pb-6 pt-1">
            {openBooks.map(pf => (
              <div key={pf.id ?? pf.name} data-slot="portfolio-row"
                className="flex items-start gap-3 border-b border-gray-100 py-3 last:border-b-0 dark:border-gray-800">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-gray-900 dark:text-white">
                    {pf.name}
                  </p>
                  {/* Labelled figures, not bare numbers.
                      "6.2%" beside "+3.1" asks the reader to work out which is
                      the weight and which is the active weight, and they are
                      different quantities that happen to share a unit. This is
                      the same rule the target and size controls follow: never
                      require somebody to infer what a number represents.
                      Each figure renders only where the card's source actually
                      knows it. A book whose holdings never loaded shows its
                      name and nothing else, which is the honest output — the
                      alternative is a zero standing in for unknown. */}
                  {/*
                    Portfolio, Benchmark, Active — in that order, because that
                    is the order the question is asked in. Value is secondary
                    and last: a PM opening "2 portfolios" wants exposure, and
                    money is the thing they can already infer from it.

                    An em dash is not a zero. `benchmarkPct === null` means the
                    book has NO benchmark file, so its index weight is unknown
                    and Active is undefined with it; a real `0` means the file
                    exists and does not list the name, which makes the whole
                    position active. Rendering the first as "0.0%" would invent
                    a benchmark the desk does not have and overstate every
                    active weight against it.
                  */}
                  <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                    {pf.weightPct != null && (
                      <Stat label="Portfolio" value={`${pf.weightPct.toFixed(1)}%`} slot="pf-weight" />
                    )}
                    {pf.benchmarkPct !== undefined && (
                      <Stat
                        label="Benchmark"
                        value={pf.benchmarkPct === null ? '—' : `${pf.benchmarkPct.toFixed(1)}%`}
                        slot="pf-benchmark"
                      />
                    )}
                    {(pf.activePct != null || pf.benchmarkPct === null) && (
                      <Stat
                        label="Active"
                        value={pf.activePct == null
                          ? '—'
                          : `${pf.activePct >= 0 ? '+' : '−'}${Math.abs(pf.activePct).toFixed(1)}%`}
                        slot="pf-active"
                      />
                    )}
                    {pf.valueUsd != null && (
                      <Stat label="Value" value={compactUsd(pf.valueUsd)} slot="pf-value" />
                    )}
                  </div>
                  {/* Said once per book, quietly, only where it applies. */}
                  {pf.benchmarkPct === null && (
                    <p className="mt-0.5 text-[10px] text-gray-400 dark:text-gray-500"
                       data-slot="pf-no-benchmark">
                      Benchmark data unavailable
                    </p>
                  )}
                </div>
                {/* Navigation per row, to THAT book. A single generic
                    "open portfolio" detached from the row is how a reader ends
                    up in the wrong one. */}
                {pf.id && onOpenPortfolio ? (
                  <button
                    type="button"
                    data-slot="portfolio-open"
                    data-portfolio={pf.id}
                    onClick={() => { setBooksOpen(null); onOpenPortfolio(pf.id!, pf.name) }}
                    className="shrink-0 rounded-lg bg-gray-100 px-3 py-2 text-[13px] font-semibold text-blue-600 dark:bg-gray-800 dark:text-blue-400"
                  >
                    Open →
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </BottomSheet>
      )}

      {/* Commentary in a drawer, not an expansion.
          ── Why the in-card overlay was replaced ──────────────────────────
          Rising over the card was better than pushing the layout, but it was
          still bounded by the card: capped at 70% of a fixed-height tile, so
          long commentary was clipped with no way to reach the rest. The card
          is exactly one viewport and cannot grow, which makes it the wrong
          container for text of unknown length.
          A bottom sheet is the one place a vertical scroller is legitimate —
          it is an overlay, not part of the snap feed, so it owns its own
          gesture without competing with anything. The card underneath does not
          resize, the action bar does not move, and dismissing restores the
          exact previous state because nothing about the card changed. */}
      {/* Mounted only while open.
          `BottomSheet` runs viewport and keyboard listeners from its own hooks
          and portals into the body, and the feed renders many cards at once —
          so leaving one mounted per card meant a listener per card for a sheet
          nobody had opened. */}
      {bodyOpen && (
      <BottomSheet
        open
        onClose={() => setBodyOpen(false)}
        title={card.headline}
        snapPoints={[0.55, 0.9]}
        aria-label="Full commentary"
      >
        <div data-slot="body-drawer" className="px-4 pb-6 pt-1">
          <p className="text-[15px] leading-[1.6] text-gray-700 dark:text-gray-200">
            {card.body}
          </p>
          {/* Source and timing, which the card face has no room for. Not a
              duplicate of the card — the drawer is for what did not fit. */}
          <p className="mt-4 border-t border-gray-100 pt-3 text-[12px] text-gray-500 dark:border-gray-800">
            {card.provenance.reason}
          </p>
          <p className="mt-1.5 text-[11px] text-gray-400">
            {relative(card.provenance.occurredAt)}
          </p>
        </div>
      </BottomSheet>
      )}

      {/* Actions at the end of the card, and pinned while it is taller than the
          viewport so the gesture is in the same place on every card type.

          The bottom inset is not decoration: on iOS the home indicator sits
          over the last ~34px of the viewport, and a 44px button ending flush
          with the card was a button whose bottom third could not be tapped. */}
      <div data-slot="actions" className="sticky bottom-0 flex min-h-[var(--card-bar)] items-center gap-2 border-t border-gray-100 bg-white/95 px-4 pt-3 pb-3 [padding-bottom:calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur dark:border-gray-800 dark:bg-gray-900/95">
        {/* Two buttons, not three.
            ── Why `Open TICKER` left the bar ─────────────────────────────
            Every asset card carried `Capture | <decision> | Open TICKER`, so
            the decision the card exists to prompt got a third of the width and
            sat between two ways of leaving it. Navigation is not a peer of the
            judgement; it is one of several things you might do next, which is
            what the actions sheet is for. `Open` is the first entry there and
            routes exactly where this button did — see `FeedCaptureSheet`.
            `card.actions.open` is untouched in the contract: the sheet reads
            it, and every builder keeps its label and href. */}
        {card.actions.quick.map(a => (
          <button
            key={a.id}
            type="button"
            data-slot="quick"
            onClick={() => onAction(a.id, card)}
            className="h-11 min-w-0 shrink-0 basis-[38%] overflow-hidden text-ellipsis whitespace-nowrap rounded-xl border border-gray-200 text-[15px] font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
          >
            {barLabel(a)}
          </button>
        ))}
        {/* The primary, or whatever the active pane has made more useful.
            See `primaryOverride`: the id is still what routing and analytics
            receive, so substituting one changes what the button says and where
            it goes, not the action grammar underneath it. */}
        <button
          type="button"
          data-slot="primary"
          data-action-id={(primaryOverride ?? card.actions.primary).id}
          data-primary-source={primaryOverride ? 'pane' : 'card'}
          /* A pane may state what the button WOULD do before it can do it —
             "Choose an answer" on a review nobody has answered. Disabled rather
             than absent: the bar keeping its shape is what stops the card
             reflowing under the thumb as the reader pages across it. */
          disabled={primaryOverride?.disabled ?? false}
          onClick={() => {
            if (primaryOverride?.disabled) return
            if (primaryOverride?.run) { primaryOverride.run(); return }
            onAction((primaryOverride ?? card.actions.primary).id, card)
          }}
          className={clsx(
            'h-11 min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap rounded-xl text-[15px] font-bold',
            primaryOverride?.disabled
              ? 'bg-gray-200 text-gray-500 dark:bg-gray-700 dark:text-gray-400'
              : 'bg-gray-900 text-white dark:bg-white dark:text-gray-900',
          )}
        >
          {barLabel(primaryOverride ?? card.actions.primary)}
        </button>
      </div>
    </article>
  )
}
