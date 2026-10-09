/**
 * The List workspace: hooks, state and writes. The picture lives next door.
 *
 * Composition moved to `ListRowModes`, which is pure and therefore renderable
 * in the fixture gallery — the only way the layout of a virtualised, fixed
 * height, auth-gated row can actually be LOOKED at. Everything that reaches
 * Supabase stays here.
 *
 * ── Why the clicked field decides the mode ────────────────────────────────
 *
 * A reader who clicks Target is asking what the name is worth. One who clicks
 * the Work badge is asking what needs doing. Opening the same summary for both
 * makes them navigate twice to reach what they already pointed at — so the
 * expansion opens on the content the clicked field names, and the mode switch
 * exists to move on from there rather than to be the first decision. The map is
 * in `listRowModes`; the table hands the clicked column in as `entryColumnId`.
 *
 * Modes a security cannot answer are not offered. A switch full of empty tabs
 * is a worse answer than a shorter switch.
 *
 * ── The height contract ───────────────────────────────────────────────────
 *
 * `AssetTableView` gives every expanded row a FIXED height by density, because
 * its virtualiser must know row sizes up front. Nothing here may grow the row:
 * each mode's regions scroll internally, and the entrance animates OPACITY and
 * a small translate — never height, which would fight the virtualiser and move
 * the reader's place in the list.
 *
 * ── Writes ────────────────────────────────────────────────────────────────
 *
 * Every write goes through the path the rest of the product uses:
 *
 *   case text          `useContributions().saveContribution`
 *   rating/conviction  `useAnalystRatings().saveRating`
 *   review verdict     `useRecordThesisReview`  (a `thesis.reviewed` event)
 *   list fields        `useUpdateListItem`
 *   new idea           `onCreateTradeIdea` → `ListTab`'s `AddTradeIdeaModal`
 *
 * Price targets, recommendations and idea stage moves are NOT written here:
 * each needs a scenario, a sizing decision or stage validation that a row
 * cannot honestly collect, so those link into their own workspace.
 */
import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { ExternalLink, Flag, ArrowUpRight, Plus, Pencil, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { format, parseISO } from 'date-fns'
import { ListAssigneeCell } from './ListAssigneeCell'
import { ListStatusCell } from './ListStatusCell'
import { ListTagsCell } from './ListTagsCell'
import {
  OverviewMode, MarketMode, ResearchMode, PositionMode, WorkMode,
  ModeSkeleton, ModeLayout, ExpansionShell, Label, PrimaryButton, QuietButton,
  VerdictBand,
  type WorkShape, type LadderRung,
} from './ListModeViews'
import {
  MODE_ORDER, MODE_LABEL, modeForEntryColumn, entryTokenFor, type ListRowMode,
} from './listRowModes'
import { useUpdateListItem } from '../../hooks/lists/useUpdateListItem'
import { useAssetWorkspace } from '../../hooks/useAssetWorkspace'
import {
  useAnalystRatings, useRatingScales,
  type ConvictionLevel,
} from '../../hooks/useAnalystRatings'
import { useRecordThesisReview, type ThesisReviewOutcome } from '../../hooks/useThesisReview'
import { useContributions } from '../../hooks/useContributions'
import { CORE_SECTIONS, STATE_LABEL } from '../../lib/desktop-research/model'
import { windowReturn } from '../../lib/lists/price-metrics'
import type { ListRowSignal } from '../../hooks/lists/useListRowSignals'

export interface ListRowCoverage {
  analyst: string
  team: string
  isLead: boolean
}

interface ListRowExpansionProps {
  listId: string
  rowId: string
  asset: any
  canEdit: boolean
  /** Resolved by the table for the whole page. Absent on mobile, which is fine. */
  coverage?: ListRowCoverage[]
  /**
   * The live quote the table already resolved for this row.
   *
   * The authority for the price and today's move, ahead of anything this
   * component can reach on its own — see `displaySpot`.
   */
  quote?: { price?: number | null; changePercent?: number | null } | null
  /** The column the row was opened from. Decides the initial mode. */
  entryColumnId?: string
  /**
   * Tell the table which mode is showing, so the row is sized for it.
   *
   * The table sizes an expanded row from its ENTRY and never hears about the
   * tab switcher inside, so opening on a rating and moving to the chart left
   * a chart in a rating-sized row. The mode names and the entry tokens are
   * the same six strings, so echoing the active mode is exactly the entry
   * that would have opened it — and `modeForEntryColumn` maps it straight
   * back, which is what makes the handshake stable.
   */
  onEntryChange?: (entryColumnId: string) => void
  /** Batched for the whole list by `useListRowSignals`. */
  signal?: ListRowSignal
  onOpenAsset?: () => void
  /**
   * Opens the page-level `AddTradeIdeaModal` with this asset preselected.
   *
   * Raised to the page deliberately: `ListTab` already owns that modal, and a
   * modal rendered from inside a virtualised row would be unmounted by a
   * scroll.
   */
  onCreateTradeIdea?: (assetId: string) => void
  /**
   * The maximize handshake, owned by `ListTableView`.
   *
   * This component renders identically in the row and in the full-viewport
   * overlay — same modes, same data, same canonical actions — because it IS
   * the same mounted component, portalled. It only needs to know which state
   * it is in so the control reads "Maximize" or "Restore".
   */
  maximized?: boolean
  onToggleMaximize?: () => void
  /**
   * The tab-switcher override, when the caller wants to own it.
   *
   * Supplied together with `onModeOverride` or not at all. See the override
   * block in the body for why maximizing needs it hoisted.
   */
  modeOverride?: ModeOverride | null
  onModeOverride?: (next: ModeOverride | null) => void
}

/**
 * A mode the reader chose, stamped with the field they chose it against.
 *
 * The stamp is what makes it safe: point at a different field and the
 * override is stale by construction and ignored, so there is never a second
 * source of truth racing the entry column.
 */
export interface ModeOverride {
  entry?: string
  mode: ListRowMode
}

/**
 * The three verdicts a review can reach, in `ResearchDetail`'s wording.
 *
 * Same list, same order, same labels — a reader who reviews from a list row and
 * one who reviews from the research surface must be recording the same three
 * things, or the stale clock means two different things depending on where it
 * was cleared.
 */
const REVIEW_CHOICES: ReadonlyArray<{ outcome: ThesisReviewOutcome; label: string }> = [
  { outcome: 'holds', label: 'Still holds' },
  { outcome: 'changed', label: 'Changed' },
  { outcome: 'needs_work', label: 'Needs work' },
]

export function ListRowExpansion({
  listId,
  rowId,
  asset,
  canEdit,
  coverage,
  quote,
  entryColumnId,
  onEntryChange,
  signal,
  onOpenAsset,
  onCreateTradeIdea,
  maximized,
  onToggleMaximize,
  modeOverride,
  onModeOverride,
}: ListRowExpansionProps) {
  const status = asset._status ?? null
  const assignee = asset._assignee ?? null
  const tags = asset._tags ?? []
  const dueDate: string | null = asset._dueDate ?? null
  const isFlagged: boolean = !!asset._isFlagged
  const listNote: string = asset._listNotes ?? ''

  const updateItem = useUpdateListItem(listId)

  // `useAssetWorkspace` returns `{ data, isLoading, error }` and `data` is never
  // undefined — it falls back to an EMPTY shape — so the fields below can be
  // read without guarding every one.
  const { data: workspace, isLoading: workspaceLoading } =
    // Overview by focus, but it draws a real chart — so it needs the real
    // history, not the twelve-day floor a chartless focus gets.
    useAssetWorkspace(asset?.id ?? null, asset?.symbol ?? null, 'overview', { deepHistory: true })
  const { ratings, saveRating } = useAnalystRatings({ assetId: asset?.id })
  const { scales } = useRatingScales()
  const { saveContribution } = useContributions({ assetId: asset?.id })
  /*
   * Recording a review already has a canonical writer: `useRecordThesisReview`
   * inserts a `thesis.reviewed` memory event, idempotent on a per-submit request
   * id, which `useDesktopResearch` folds back in as `lastReviewedAt` and
   * `stateOf` reads. So "reviewed, nothing changed" clears the clock here
   * exactly as it does on the research surface.
   */
  const review = useRecordThesisReview(asset?.id ?? null)

  const {
    spot, target, positions, liveIdeas, decisions, sections, evidence, caseWrittenAt, ladder,
    // `{ date, close }[]`, already the shape `PriceContext` wants.
    history,
  } = workspace

  // ── Derived investment state ─────────────────────────────────────────

  /**
   * One rating, chosen the way the rest of the product chooses it: the
   * organisation's official rating if there is one, else the most recently
   * updated. A row has space for one answer.
   */
  const rating = useMemo(() => {
    const rows = ratings ?? []
    if (rows.length === 0) return null
    const official = rows.find((r: any) => r.is_official)
    if (official) return official
    return [...rows].sort((a: any, b: any) =>
      Date.parse(b.updated_at ?? '') - Date.parse(a.updated_at ?? ''))[0]
  }, [ratings])

  /*
   * The scale this row writes against: the one the existing rating already uses,
   * else the organisation's default. Never a scale invented here — a rating
   * recorded against the wrong scale produces a value string that matches no
   * configured value, and it then drops silently out of every colour and
   * consensus read.
   */
  const activeScale = useMemo(() => {
    const all = scales ?? []
    if (rating) {
      const own = all.find((s: any) => s.id === rating.rating_scale_id)
      if (own) return own
    }
    return all.find((s: any) => s.is_default) ?? all[0] ?? null
  }, [rating, scales])

  const ratingColor = useMemo(() => {
    if (!rating) return null
    const scale = (scales ?? []).find((s: any) => s.id === rating.rating_scale_id)
    return scale?.values?.find((v: any) => v.value === rating.rating_value)?.color ?? null
  }, [rating, scales])

  /** The book this list reader most plausibly means: the largest weight. */
  const primaryPosition = useMemo(() => {
    const withWeight = (positions ?? []).filter(p => p.weightPct != null)
    if (withWeight.length === 0) return (positions ?? [])[0] ?? null
    return [...withWeight].sort((a, b) => (b.weightPct ?? 0) - (a.weightPct ?? 0))[0]
  }, [positions])

  /**
   * The price the inspector quotes, and everything computed from it.
   *
   * The table's live quote leads, because it is what the collapsed row is
   * displaying one line above. This panel used to start from
   * `workspace.spot` — the last close in `price_history_cache` — and so LLY
   * read 1169.60 in the row and 1,149.85 in the inspector opened from it. Two
   * prices for one name, both sourced, neither wrong on its own, and no way
   * for a reader to tell which one the desk acts on.
   *
   * After the quote, in order of how well each matches what is on screen:
   *
   *   1. the live quote the table resolved;
   *   2. the workspace's own spot;
   *   3. the LAST CLOSE of the series the chart is drawing, so the figure and
   *      the line can never disagree;
   *   4. the asset's stored `current_price`.
   *
   * ── The value and its provenance are resolved TOGETHER ────────────────
   *
   * They have to be. The chart used to print the word `live` beside this
   * figure whenever one was supplied, which was true of source 1 and false of
   * the other three — and in this deployment the quote provider is refused by
   * the page's own CSP, so source 1 never fires and the chart stamped `live`
   * over an eight-day-old close on every row. Returning the label from the
   * same branch that chose the number is the only arrangement in which they
   * cannot drift apart. Sources 3 and 4 carry no date, so they make no claim.
   */
  const { displaySpot, displaySpotLabel } = useMemo(() => {
    const live = quote?.price == null ? NaN : Number(quote.price)
    if (Number.isFinite(live) && live > 0) {
      /*
       * The price is used; the word "live" has to be earned separately.
       *
       * This deployment's quote layer hands back a zero-FILLED object when
       * its providers fail — a real-looking `price` with `changePercent: 0`
       * — which is why `ListRowCells` refuses to render a zero change from
       * any source. The same evidence has to govern the same claim here: a
       * quote that cannot produce a day's move has not demonstrated it came
       * from a tape, so the figure is shown — it is what the row shows, and
       * the two must agree — and is named `undated` rather than `live`.
       *
       * `undated`, not blank. Leaving the slot empty was the first attempt
       * and it is a quieter version of the same problem: a price with no
       * stamp beside a chart whose other states all carry one reads as
       * current. Naming the absence is the only honest option, since the
       * alternative — falling back to the dated cached close — would put a
       * different number in the panel from the one in the row above it, which
       * is the defect that made LLY read 1169.60 and 1,149.85 at once.
       *
       * Keep this in step with `changePct` in `ListRowCells`.
       */
      const move = quote?.changePercent == null ? NaN : Number(quote.changePercent)
      const corroborated = Number.isFinite(move) && move !== 0
      return { displaySpot: live, displaySpotLabel: corroborated ? 'live' : 'undated' }
    }
    if (spot != null) {
      const last = history?.length ? history[history.length - 1] : null
      return {
        displaySpot: spot,
        displaySpotLabel: last?.date ? `Close of ${last.date}` : null,
      }
    }
    // Sources 3 and 4 carry no date either — the flat `closes` array has none
    // and `assets.current_price` has none in the schema — so they say so.
    const closes = signal?.closes
    if (closes && closes.length > 0) {
      const last = closes[closes.length - 1]
      if (Number.isFinite(last)) return { displaySpot: last, displaySpotLabel: 'undated' }
    }
    const stored = asset?.current_price == null ? NaN : Number(asset.current_price)
    return {
      displaySpot: Number.isFinite(stored) ? stored : null,
      displaySpotLabel: Number.isFinite(stored) ? 'undated' : null,
    }
  }, [quote?.price, quote?.changePercent, spot, history, signal?.closes, asset?.current_price])

  const upsidePct = displaySpot != null && displaySpot > 0 && target != null
    ? ((target - displaySpot) / displaySpot) * 100
    : null

  /**
   * The dated events, as markers on the price line.
   *
   * Same three kinds the caption strip used to list — when the case was
   * written, when research arrived, when the idea was raised — but positioned
   * against the price instead of against each other. All canonical: the
   * workspace's own `caseWrittenAt`, `evidence[].createdAt` and the scan's
   * idea date. Nothing is synthesised and nothing is dated by guess.
   */
  const chartMarkers = useMemo(() => {
    const out: Array<{ date: string; label: string; kind: 'case' | 'research' | 'idea' }> = []
    if (caseWrittenAt) out.push({ date: caseWrittenAt, label: 'Case written', kind: 'case' })
    for (const c of (evidence ?? []).slice(0, 4)) {
      out.push({ date: c.createdAt, label: c.title || 'Research', kind: 'research' })
    }
    const raised = signal?.idea?.createdAt
    if (raised) {
      const dir = (signal?.idea?.direction ?? '').toUpperCase()
      out.push({ date: raised, label: dir ? `${dir} raised` : 'Idea raised', kind: 'idea' })
    }
    return out
  }, [caseWrittenAt, evidence, signal?.idea?.createdAt, signal?.idea?.direction])

  /**
   * The month, from the same table the collapsed row and the chart use.
   *
   * It read `signal.closes`, which comes from the `yahoo-chart-proxy` edge
   * function — dead in this deployment, and a DIFFERENT series from the one
   * the row draws. Overview said "+4.0% over 1M" directly under a row
   * reading "-0.6% 1M" for the same name and the same window.
   *
   * `workspace.history` is `price_history_cache`, which is what
   * `useListPriceHistory` batches for the row, so the two cannot disagree.
   * `windowReturn` also refuses the figure outright when the series is too
   * short to support a month — see `price-metrics`.
   */
  const oneMonthPct = useMemo(
    () => windowReturn(history ?? null, '1M').pct,
    [history],
  )

  /**
   * Today's move. Never computed from a guess, and never a default dressed as
   * a reading.
   *
   * A live quote is authoritative including a genuine `0` — a flat tape is a
   * fact. A STORED `change_percent` of exactly zero is not: every asset in the
   * corpus carries one, so the List rendered a green `+0.0%` against all
   * twenty-one names at once. That is a column-wide default being painted as
   * twenty-one measurements. Zero from storage is treated as absent, which
   * costs us the rare genuinely-flat stored day and buys back a column that
   * means something.
   */
  const changePct = useMemo(() => {
    const live = quote?.changePercent == null ? NaN : Number(quote.changePercent)
    if (Number.isFinite(live) && live !== 0) return live
    const raw = asset?.change_percent ?? asset?.changePercent ?? null
    const n = raw == null ? null : Number(raw)
    if (n == null || !Number.isFinite(n) || n === 0) return null
    return n
  }, [quote, asset])

  /**
   * The case, core sections in the product's own order.
   *
   * Derived from `CORE_SECTIONS` rather than a second hardcoded list, so a core
   * section added to the product appears here too.
   */
  const caseSections = useMemo(
    () => CORE_SECTIONS.map(key => ({
      key,
      row: (sections ?? []).find(s => s.section === key) ?? null,
    })),
    [sections],
  )
  const writtenCaseSections = useMemo(
    () => caseSections.filter(s => !!(s.row?.content ?? '').trim()),
    [caseSections],
  )
  const leadCase = useMemo(() => {
    const first = writtenCaseSections[0]
    return first ? { key: first.key, content: first.row!.content as string } : null
  }, [writtenCaseSections])

  /** Newest first, and whatever arrived after the case was written leads. */
  const changes = useMemo(() => {
    const items = [...(evidence ?? [])]
    items.sort((a, b) => {
      if (a.isNewSinceReview !== b.isNewSinceReview) return a.isNewSinceReview ? -1 : 1
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
    return items
  }, [evidence])

  const newSinceReview = (evidence ?? []).filter(e => e.isNewSinceReview).length
  const activeIdea = (liveIdeas ?? [])[0] ?? null
  const latestDecision = (decisions ?? [])[0] ?? null

  /*
   * The ladder's own rungs, under the scenario names the desk configured — not a
   * Bear/Base/Bull guess. `selectCurrentLadders` already picked the winning row
   * per scenario, and a ladder is only `valid` with two distinct rungs.
   */
  const rungs: LadderRung[] = useMemo(() => {
    const cases = ladder?.cases ?? []
    return [...cases]
      .filter(c => Number.isFinite(c.price) && c.price > 0)
      .sort((a, b) => a.price - b.price)
      .map(c => ({
        id: c.id, name: c.name, price: c.price,
        probability: c.probability, reasoning: c.reasoning,
      }))
  }, [ladder])

  const weightPct = primaryPosition?.weightPct ?? signal?.weightPct ?? null
  /*
   * The open recommendation, in words rather than in column values.
   *
   * `stage` is a database enum and was being concatenated straight onto the
   * action, so the panel read `BUY · ready_for_decision` — the storage format
   * shown to a portfolio manager. Underscores to spaces, first letter up:
   * no mapping table, so a stage added to the enum reads correctly here
   * without this file being edited, which a lookup would not.
   */
  const ideaLabel = activeIdea
    ? [
      (activeIdea.action ?? 'idea').toUpperCase(),
      activeIdea.stage
        ? String(activeIdea.stage).replace(/_/g, ' ').replace(/^./, c => c.toUpperCase())
        : null,
    ].filter(Boolean).join(' · ')
    : null

  // ── Modes ────────────────────────────────────────────────────────────

  /*
   * Availability is answered from the LIST-WIDE signal first, not only from the
   * per-row workspace. The signal is already in memory when the row opens; the
   * workspace is still fetching. Deriving availability from the workspace alone
   * made the Position and Price tabs pop into the switch a moment after
   * opening, which moves the tab the reader is aiming at.
   */
  const hasPosition = (positions ?? []).length > 0 || signal?.weightPct != null
  /*
   * PRICE is offered for history OR a valuation — the union of what used to
   * gate Market and Valuation separately. A name with a target and no history
   * still has something to draw (the fallback axis); a name with history and
   * no target still has the line.
   */
  const hasPrice = (signal?.closes?.length ?? 0) > 1
    || spot != null
    || target != null
    || signal?.targetPrice != null

  const availableModes = useMemo(
    () => MODE_ORDER.filter(m => {
      if (m === 'market') return hasPrice
      if (m === 'position') return hasPosition
      return true
    }),
    [hasPrice, hasPosition],
  )

  /*
   * The mode is DERIVED during render, never synced in an effect.
   *
   * ── The loop this replaces ────────────────────────────────────────────
   *
   * `mode` was state, pushed by `useEffect(..., [entryColumnId])`. An effect
   * runs after the render that caused it, so on the frame where the entry
   * changed, `activeMode` still held the PREVIOUS mode — and the echo below
   * published that stale value to the table, which handed it straight back
   * as the next entry. Two derived values chasing each other one frame
   * apart, which is not a glitch but a fixed cycle:
   *
   *   entry=list_view  mode=price (stale) -> echoes 'price'
   *   entry=price      mode=case          -> echoes 'case'
   *   entry=case       mode=price         -> echoes 'price'  ... forever
   *
   * Pressing Enter on the sparkline cell and then on the investment-case
   * cell put the inspector into exactly that cycle, flashing between the
   * chart and the written case until the row was closed. Clicking a tab did
   * not, because that sets the mode in the same commit as the event — which
   * is why it survived the tests.
   *
   * So the entry is the single source of truth, and the tab switcher is an
   * OVERRIDE stamped with the entry it was chosen against. Point at a
   * different field and the override is stale by construction and ignored;
   * there is no second state to fall behind.
   */
  /*
   * ── Why the override may be owned from outside ────────────────────────
   *
   * Maximizing moves this panel into a full-viewport overlay, which is a
   * different DOM parent at a different depth — and React remounts across a
   * depth change, whatever a portal does about the DOM. A local override
   * would therefore be discarded exactly when the reader asked for more room
   * to keep looking at the same thing: switch to Position, maximize, and the
   * workspace opens on the chart.
   *
   * So `ListTableView` may hold it (it outlives the maximize transition) and
   * pass it back. The shape and the rules are identical either way — it is
   * still `{entry, mode}`, still invalidated by a change of entry — so there
   * is one set of semantics, not two. Callers with no overlay (mobile, the
   * fixture gallery, the tests) pass nothing and keep the local state.
   */
  const [localOverride, setLocalOverride] = useState<ModeOverride | null>(null)
  const override = modeOverride !== undefined ? modeOverride : localOverride
  const setOverride = onModeOverride ?? setLocalOverride

  const entryMode = modeForEntryColumn(entryColumnId)
  const chosen = override && override.entry === entryColumnId ? override.mode : entryMode

  /** A mode that stopped being available must not leave a blank canvas. */
  const activeMode = availableModes.includes(chosen) ? chosen : 'overview'

  /** The tab switcher. Scoped to the field the reader is currently on. */
  const setMode = useCallback(
    (next: ListRowMode) => setOverride({ entry: entryColumnId, mode: next }),
    [entryColumnId, setOverride],
  )

  /*
   * Keep the ring on the collapsed row in step with what is showing.
   *
   * The ring ONLY. This echo used to drive the row's height too, which meant
   * switching tabs resized the panel the reader was working in — see
   * `expandedHeightFor` in `ListTableView`, now one fixed frame. What is left
   * is cosmetic and cannot move the layout, which is the point: a feedback
   * loop across two components is survivable when it paints a highlight and
   * is not when it re-measures a virtualised row.
   *
   * The echo is a TOKEN, not the mode. When the clicked field already resolves
   * to the mode on screen, the field wins: MARKET and the target both open
   * PRICE, and echoing `price` over `valuation` moved the ring off the cell
   * the reader had just clicked and onto the price. Only a mode the reader
   * reached some other way — the tab switcher, or a mode that fell back
   * because it was unavailable — echoes its own name.
   *
   * `modeForEntryColumn` maps every token back to one mode, so this
   * round-trips to a fixed point: the table stores the token, hands it back
   * as `entryColumnId`, and the effect above resolves it to the same mode.
   * `renderWithTable` in the tests drives both halves and asserts it settles.
   */
  const echoEntry = modeForEntryColumn(entryColumnId) === activeMode
    ? entryTokenFor(entryColumnId, activeMode)
    : activeMode
  useEffect(() => { onEntryChange?.(echoEntry) }, [echoEntry, onEntryChange])

  // ── Writes ───────────────────────────────────────────────────────────

  const [dueDraft, setDueDraft] = useState(dueDate ?? '')
  const [noteDraft, setNoteDraft] = useState(listNote)
  useEffect(() => { setDueDraft(dueDate ?? '') }, [dueDate])
  useEffect(() => { setNoteDraft(listNote) }, [listNote])

  const commitDue = () => {
    if ((dueDraft || null) !== dueDate) {
      updateItem.mutate({ itemId: rowId, updates: { due_date: dueDraft || null } })
    }
  }
  const commitNote = () => {
    if (noteDraft !== listNote) {
      updateItem.mutate({ itemId: rowId, updates: { notes: noteDraft } })
    }
  }
  const toggleFlag = () => {
    updateItem.mutate({ itemId: rowId, updates: { is_flagged: !isFlagged } })
  }

  /**
   * Set the rating, or its conviction, through the canonical writer.
   *
   * Not gated on `canEdit`: that is permission to curate THIS list row, and a
   * rating is the reader's own org-level judgement on the security —
   * `saveRating` writes the current user's rating, keyed on (asset, user, org).
   */
  const commitRating = (next: { value?: string; conviction?: ConvictionLevel | null }) => {
    const ratingValue = next.value ?? rating?.rating_value
    if (!activeScale || !ratingValue) return
    saveRating.mutate({
      ratingValue,
      ratingScaleId: activeScale.id,
      conviction: next.conviction !== undefined ? next.conviction : rating?.conviction ?? null,
    })
  }

  /**
   * Save one case section.
   *
   * `saveContribution` resolves the user and org itself and invalidates
   * `contributions` AND `desktop-research` — so a save made here moves the
   * review anchor that `newSinceReview` is measured against. That is the whole
   * reason editing the case from a list row is worth having: it is the only
   * honest way to clear "3 new".
   */
  const commitSection = useCallback(async (sectionKey: string, content: string) => {
    await saveContribution.mutateAsync({ content, sectionKey })
  }, [saveContribution])

  // ── Footers, per mode ────────────────────────────────────────────────

  const reviewGroup = review.isDone ? (
    <span className="inline-flex items-center gap-1.5 px-2 py-1 text-[11.5px] font-semibold text-emerald-700 dark:text-emerald-300">
      <Check className="h-3 w-3" />
      Review recorded
    </span>
  ) : (
    <div className="flex items-center gap-1.5 min-w-0">
      {REVIEW_CHOICES.map(({ outcome, label }) => (
        <button
          key={outcome}
          onClick={() => review.record(outcome)}
          disabled={review.isPending}
          className={clsx(
            'px-2 py-1 text-[11.5px] font-semibold rounded-md transition-colors flex-shrink-0',
            outcome === 'holds'
              ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900'
              : 'text-gray-600 bg-gray-100 hover:bg-gray-200 dark:text-gray-300 dark:bg-gray-800 dark:hover:bg-gray-700',
            review.isPending && 'opacity-50 cursor-wait',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )

  const openFullCase = onOpenAsset ? (
    <QuietButton onClick={onOpenAsset} icon={ExternalLink}>Open full case</QuietButton>
  ) : null

  const flagButton = (
    <button
      onClick={canEdit ? toggleFlag : undefined}
      disabled={!canEdit}
      className={clsx(
        'inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11.5px] font-medium transition-colors',
        isFlagged
          ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 dark:text-amber-300 dark:bg-amber-900/30'
          : 'text-gray-500 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-100 dark:hover:bg-gray-800',
        !canEdit && 'cursor-default',
      )}
    >
      <Flag className={clsx('h-3 w-3', isFlagged && 'fill-current')} />
      {isFlagged ? 'Flagged' : 'Flag'}
    </button>
  )

  /**
   * The verdict, offered wherever the reader is — except Work, which shows it
   * beside the evidence it is about.
   */
  const reviewPrompt = newSinceReview > 0 && !!asset?.id && !workspaceLoading ? (
    <>
      <span className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400 flex-shrink-0">
        {newSinceReview} new · does the case hold?
      </span>
      {reviewGroup}
    </>
  ) : null

  /**
   * Only what belongs here.
   *
   * A constant toolbar made every mode end the same way and taught the reader
   * to stop looking at the footer. Each mode states what it can do, and nothing
   * is proposed from data that has not loaded.
   */
  const footerFor = (m: ListRowMode): React.ReactNode => {
    if (workspaceLoading) return openFullCase
    const common = <>{flagButton}{openFullCase}</>

    if (m === 'work') return <>{workFooter()}{common}</>
    if (m === 'research') {
      return <>{reviewPrompt}{common}</>
    }
    /*
     * PRICE, with no target on file: the chart has a line and no levels, so
     * the thing to do is give it some. With a target it falls through to the
     * state-chosen move below, same as Overview.
     */
    if (m === 'market' && target == null) {
      return (
        <>
          {onOpenAsset && (
            <QuietButton onClick={onOpenAsset} icon={ExternalLink}>Set a target in the case</QuietButton>
          )}
          {common}
        </>
      )
    }
    if (m === 'position') return common
    // Overview and Price: the state-chosen next move.
    return (
      <>
        {reviewPrompt}
        {!reviewPrompt && activeIdea && onOpenAsset && (
          <PrimaryButton onClick={onOpenAsset} icon={ArrowUpRight}>Open active idea</PrimaryButton>
        )}
        {!reviewPrompt && !activeIdea && writtenCaseSections.length === 0 && (
          <PrimaryButton onClick={() => setMode('research')} icon={Pencil}>Write the case</PrimaryButton>
        )}
        {!reviewPrompt && !activeIdea && writtenCaseSections.length > 0 && onCreateTradeIdea && (
          <PrimaryButton onClick={() => onCreateTradeIdea(asset.id)} icon={Plus}>Start an idea</PrimaryButton>
        )}
        {common}
      </>
    )
  }

  const workShape: WorkShape =
    newSinceReview > 0 ? 'unread'
      : writtenCaseSections.length === 0 ? 'no-case'
        : activeIdea ? 'idea'
          : (signal?.state === 'stale' || signal?.state === 'thin' || signal?.state === 'incomplete-thesis')
            ? 'revisit'
            : 'clear'

  function workFooter(): React.ReactNode {
    /*
     * An owed decision outranks every other work state.
     *
     * Checked before the shape branches because `workShape` resolves
     * `no-case` and `unread` first — so a name with a decision outstanding
     * AND no written case offered "Write the case" and said nothing about
     * the decision. Writing the case is good advice; it is not the thing
     * somebody is waiting on.
     *
     * ── Why this hands off rather than deciding ──────────────────────────
     *
     * A decision is one answer per (idea, PORTFOLIO) track — `useIdeaDecision`
     * is explicit — so a row-level Approve would silently decide for every
     * other book holding the name. Authorisation is per portfolio too:
     * `canMakeDecision` is PM-only and async, and a button rendered before it
     * resolves offers an action the reader may not have.
     *
     * Both are solvable only by reproducing the inbox's portfolio picker, its
     * permission gate and its fan-in to `resolveIdeaAfterDecision` — which IS
     * the duplicate decision engine this must not become. So the row routes to
     * the canonical surface and the reader decides there with every track in
     * front of them. `decision-engine-action` / `trade-queue` is the existing
     * navigation the rest of the product uses for this; see `DecisionDetail`.
     */
    if (signal?.work.tier === 'decision') {
      return (
        <PrimaryButton
          icon={ArrowUpRight}
          onClick={() => window.dispatchEvent(new CustomEvent('decision-engine-action', {
            detail: { id: 'trade-queue', title: 'Pipeline', type: 'trade-queue', data: null },
          }))}
        >
          Decide in Pipeline
        </PrimaryButton>
      )
    }
    if (workShape === 'unread') {
      return (
        <>
          <span className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400">
            Does the case still hold?
          </span>
          {reviewGroup}
          <QuietButton onClick={() => setMode('research')} icon={Pencil}>Update the case</QuietButton>
        </>
      )
    }
    if (workShape === 'no-case') {
      return <PrimaryButton onClick={() => setMode('research')} icon={Pencil}>Write the case</PrimaryButton>
    }
    if (workShape === 'idea') {
      return onOpenAsset
        ? <PrimaryButton onClick={onOpenAsset} icon={ArrowUpRight}>Continue the idea</PrimaryButton>
        : null
    }
    if (workShape === 'revisit') {
      return (
        <>
          {reviewGroup}
          <QuietButton onClick={() => setMode('research')} icon={Pencil}>Update the case</QuietButton>
        </>
      )
    }
    return onCreateTradeIdea
      ? <PrimaryButton onClick={() => onCreateTradeIdea(asset.id)} icon={Plus}>Start an idea</PrimaryButton>
      : null
  }

  // The list-scoped editors, which own hooks and so cannot live in the pure
  // composition file. Passed down as a slot.
  /*
   * The list's own fields, deliberately compressed.
   *
   * Status, owner and tags are three editors on one line rather than three
   * stacked blocks with labels, and the due date and note are only offered when
   * they exist or the reader can set them. They answer a question about this
   * list, not about the security, and they used to take a third of the rail.
   */
  const listFieldsSlot = (
    <div>
      <Label>On this list</Label>
      <div className="mt-1 flex items-center gap-1.5 flex-wrap">
        <ListStatusCell rowId={rowId} listId={listId} status={status} canEdit={canEdit} />
        <ListAssigneeCell rowId={rowId} listId={listId} assignee={assignee} canEdit={canEdit} />
        <ListTagsCell rowId={rowId} listId={listId} tags={tags} canEdit={canEdit} />
      </div>
      {(canEdit || dueDate) && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <span className="text-[10px] text-gray-400 dark:text-gray-500 flex-shrink-0">Due</span>
          {canEdit ? (
            <input
              type="date"
              value={dueDraft}
              onChange={e => setDueDraft(e.target.value)}
              onBlur={commitDue}
              className="min-w-0 flex-1 text-[11px] px-1 py-0.5 rounded bg-transparent ring-1 ring-gray-900/10 dark:ring-gray-100/15 focus:outline-none focus:ring-gray-900/30"
            />
          ) : (
            <span className="text-[11px] text-gray-600 dark:text-gray-300">
              {format(parseISO(dueDate!), 'MMM d, yyyy')}
            </span>
          )}
        </div>
      )}
      {(canEdit || listNote) && (
        canEdit ? (
          <input
            value={noteDraft}
            onChange={e => setNoteDraft(e.target.value)}
            onBlur={commitNote}
            placeholder="Why this name is here…"
            className="mt-1.5 w-full text-[11px] px-1 py-0.5 rounded bg-transparent ring-1 ring-gray-900/10 dark:ring-gray-100/15 focus:outline-none focus:ring-gray-900/30"
          />
        ) : (
          <p className="mt-1.5 text-[11px] text-gray-500 dark:text-gray-400 leading-snug line-clamp-2">
            {listNote}
          </p>
        )
      )}
    </div>
  )

  const scaleValues = activeScale?.values as Array<{ value: string; label?: string }> | undefined

  return (
    /*
     * A surface, not a card. The expansion sits on a faintly recessed ground so
     * it reads as belonging to the row above it; the first version was white on
     * white inside a border, which is what made it look inserted.
     *
     * `animate-in` is the entrance: opacity and a 2px lift, 150ms, matching the
     * chevron's rotate. No height transition — see the height contract.
     */
    <div
      data-testid="list-row-expansion"
      data-mode={activeMode}
      data-maximized={maximized ? 'true' : undefined}
      className={clsx(
        'h-full max-sm:h-auto',
        // The entrance belongs to the row. Replaying a slide-in every time the
        // reader maximizes or restores would animate a resize, not an arrival.
        !maximized && 'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-150',
      )}
    >
      <ExpansionShell
        symbol={asset.symbol}
        companyName={asset.company_name}
        // Work states the same thing as its own heading, so the chip would be
        // a second copy of it.
        state={signal?.state && signal.state !== 'current' && activeMode !== 'work'
          ? STATE_LABEL[signal.state]
          : null}
        modes={availableModes.map(m => ({ id: m, label: MODE_LABEL[m] }))}
        activeMode={activeMode}
        onModeChange={m => setMode(m as ListRowMode)}
        maximized={maximized}
        onToggleMaximize={onToggleMaximize}
        /*
         * The desk's stance, stated once above every mode.
         *
         * Identical in all six — the view does not change because the reader
         * clicked a tab — which is what lets each mode below be evidence
         * rather than another arrangement of the same five figures.
         */
        lead={
          <VerdictBand
            ratingValue={rating?.rating_value ?? null}
            ratingColor={ratingColor}
            conviction={rating?.conviction ?? null}
            target={target}
            upsidePct={upsidePct}
            weightPct={weightPct}
            shares={primaryPosition?.shares ?? null}
            bookName={primaryPosition?.portfolioName ?? signal?.bookName}
            bookCount={signal?.bookCount ?? (positions?.length ?? null)}
            workLabel={signal?.work.tier === 'clear' ? null : signal?.work.label || null}
            workSince={signal?.idea?.createdAt ?? null}
            awaitingDecision={signal?.work.tier === 'decision'}
            ideaLabel={ideaLabel}
            caseWrittenAt={caseWrittenAt}
          />
        }
      >
      <div className="h-full min-h-0">
        {workspaceLoading ? (
          // The skeleton keeps the layout AND the footer: "Open full case" is
          // true regardless of what loads, so removing it made the row briefly
          // offer no way out at all.
          <ModeLayout main={<ModeSkeleton mode={activeMode} />} footer={openFullCase} />
        ) : (
          <>
            {activeMode === 'overview' && (
              <OverviewMode
                spot={displaySpot} changePct={changePct} target={target} upsidePct={upsidePct}
                oneMonthPct={oneMonthPct}
                closes={signal?.closes ?? null}
                // Overview's thumbnail is the door to the real chart.
                onOpenMarket={() => setMode('market')}
                weightPct={weightPct} shares={primaryPosition?.shares ?? null}
                bookName={primaryPosition?.portfolioName ?? signal?.bookName}
                proposedWeightPct={signal?.idea?.proposedWeight ?? null}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                ideaLabel={ideaLabel}
                workLabel={signal?.work.tier === 'clear' ? null : signal?.work.label || null}
                workSecondary={signal?.work.secondary}
                awaitingDecision={signal?.work.tier === 'decision'}
                writtenCaseSections={writtenCaseSections}
                changes={changes} caseWrittenAt={caseWrittenAt}
                coverage={coverage}
                listFieldsSlot={listFieldsSlot}
                footer={footerFor('overview')}
              />
            )}
            {activeMode === 'market' && (
              <MarketMode
                symbol={asset.symbol}
                /*
                 * `displaySpot`, not the series' last close. It leads with the
                 * table's live quote, which is what the collapsed row one line
                 * above is showing — `PriceChart` states it as the headline
                 * figure so the two cannot disagree.
                 */
                spot={displaySpot}
                /* What that number IS. Never "live" unless a live quote
                   actually produced it — see `displaySpotLabel`. */
                spotLabel={displaySpotLabel}
                target={target} upsidePct={upsidePct}
                rungs={rungs}
                /*
                 * The real series, so PRICE gets the interactive chart rather
                 * than an enlarged sparkline. `workspace.history` is already
                 * `{date, close}[]` — exactly `PricePoint` — and is read by the
                 * same `useAssetWorkspace` call this mode already makes.
                 */
                series={history?.length ? history : null}
                chartEvents={chartMarkers}
                footer={footerFor('market')}
              />
            )}
            {activeMode === 'research' && (
              <ResearchMode
                symbol={asset.symbol}
                caseSections={caseSections} caseWrittenAt={caseWrittenAt}
                changes={changes} newSinceReview={newSinceReview}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                scaleValues={scaleValues}
                onRate={v => commitRating({ value: v })}
                onConviction={c => commitRating({ conviction: c })}
                busy={saveRating.isPending}
                onSaveSection={commitSection}
                coverage={coverage}
                target={target} upsidePct={upsidePct}
                footer={footerFor('research')}
              />
            )}
            {activeMode === 'position' && (
              <PositionMode
                positions={positions ?? []} spot={displaySpot} target={target} upsidePct={upsidePct}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null} ideaLabel={ideaLabel}
                /*
                 * What we are considering doing. `proposedWeight` is a stored
                 * field on the idea, so "current → proposed" is two facts rather
                 * than one fact and an inference.
                 */
                proposedWeightPct={signal?.idea?.proposedWeight ?? null}
                ideaDirection={signal?.idea?.direction ?? activeIdea?.action ?? null}
                ideaStage={signal?.idea?.stage ?? activeIdea?.stage ?? null}
                footer={footerFor('position')}
              />
            )}
            {activeMode === 'work' && (
              <WorkMode
                shape={workShape}
                changes={changes} newSinceReview={newSinceReview}
                caseWrittenAt={caseWrittenAt}
                stateLabel={signal?.state ? STATE_LABEL[signal.state] : null}
                leadCase={leadCase}
                /*
                 * The list-wide scan's idea, not the workspace's.
                 *
                 * `useIdeaScan` already carries the proposed weight, the author
                 * and the raise date; `AssetWorkspaceData.liveIdeas` carries
                 * none of those. Same rows, more of them, and no second read.
                 * Falls back to the workspace's so a name outside the scan's
                 * window still states its idea.
                 */
                idea={signal?.idea
                  ? {
                      action: signal.idea.direction,
                      stage: signal.idea.stage,
                      portfolioName: signal.idea.portfolioName,
                      conviction: signal.idea.conviction,
                      rationale: signal.idea.rationale,
                      proposedWeight: signal.idea.proposedWeight,
                      authorName: signal.idea.authorName,
                      createdAt: signal.idea.createdAt,
                    }
                  : activeIdea}
                awaitingDecision={signal?.work.tier === 'decision'}
                decisionLabel={latestDecision
                  ? latestDecision.status
                  : null}
                ratingValue={rating?.rating_value ?? null} ratingColor={ratingColor}
                conviction={rating?.conviction ?? null}
                weightPct={weightPct}
                target={target} upsidePct={upsidePct}
                coverage={coverage}
                footer={footerFor('work')}
              />
            )}
          </>
        )}
      </div>
      </ExpansionShell>

      {review.error && (
        <div className="px-6 pb-2 text-[11px] text-rose-600 dark:text-rose-400">
          Review not saved
        </div>
      )}
    </div>
  )
}
