/**
 * The List workspace's modes, and which cell means which.
 *
 * Its own module so the column definitions and the expansion can both read it
 * without importing each other.
 *
 * ── Why a clicked field carries intent ────────────────────────────────────
 *
 * A reader who clicks Target is asking what it is worth; one who clicks the
 * Work badge is asking what needs doing. Opening the same summary for both
 * makes them navigate twice. So the expansion opens on the content the clicked
 * field names, and the mode switch is there to move on from it — not to be the
 * first decision.
 *
 * The non-list table already works this way: `COLUMN_PANEL_MAP` /
 * `pickRelevantPanels` in `AssetDetailCarousel`. This is the same contract for
 * the List workspace, which replaced that panel on list surfaces.
 */

/*
 * ── Why Market and Valuation are one mode ─────────────────────────────────
 *
 * They drew the same chart. Market plotted the history with the target as a
 * level; Valuation plotted the same history with the target AND the scenario
 * rungs as levels. The second is the first plus more information, so a reader
 * comparing the two tabs was comparing a chart against itself with some lines
 * missing — and the switcher spent two of its six slots asking them to.
 *
 * One PRICE mode draws it once, with everything the desk decided on the
 * scale. `market` and `valuation` survive as ENTRY tokens because the
 * collapsed row still stamps them on two different cells, and which cell was
 * clicked is still real intent; they just resolve to the same place now.
 */
export type ListRowMode =
  | 'overview'
  | 'market'
  | 'research'
  | 'position'
  | 'work'

/** Tab order. Stable — a switch whose items move is a switch you re-read. */
export const MODE_ORDER: readonly ListRowMode[] = [
  'overview', 'market', 'research', 'position', 'work',
]

export const MODE_LABEL: Record<ListRowMode, string> = {
  overview: 'Overview',
  market: 'Market',
  research: 'Research',
  position: 'Position',
  work: 'Work',
}

/**
 * Which mode a cell means when the reader clicks it.
 *
 * The six conceptual columns map one-to-one onto the six modes, because they are
 * the same six questions: the column states the answer in one line and the mode
 * is where that answer is interrogated. That correspondence is the reason the
 * collapsed line is composed into conceptual groups at all — see
 * `LIST_SIGNAL_COLUMNS`.
 */
export const MODE_FOR_COLUMN: Readonly<Record<string, ListRowMode>> = {
  // SECURITY — who is this. The table's own identity cell, plus the company
  // column for anyone who splits it back out.
  ticker: 'overview',
  companyName: 'overview',
  list_market: 'market',
  list_exposure: 'position',
  list_view: 'research',
  list_valuation: 'market',
  list_work: 'work',
  // The Research preset's own columns all interrogate the written case.
  list_case: 'research',
  list_evidence: 'research',
  list_changed: 'research',
  // The Decide preset's columns are all about the outstanding recommendation.
  list_owner: 'work',
  list_stage: 'work',
  list_age: 'work',
  list_sizing: 'position',
  /*
   * The scalar columns, still mapped.
   *
   * Price, Change and Coverage are hidden from the default line now that MARKET
   * composes the first two, but a reader can turn any of them back on in the
   * picker — and a visible column whose cell does nothing when clicked is the
   * defect this map exists to prevent.
   */
  price: 'market',
  change: 'market',
  coverage: 'overview',
}

/**
 * Cells that open the row.
 *
 * Exactly the mapped columns, and every one is inert text today — no editor,
 * popover or button competes for the click. Assignee, Status, Tags, Processes,
 * My Priority, the select box and the note editors are deliberately absent:
 * they already do something, and a table where every click expands a row
 * cannot be navigated.
 */
export const LIST_EXPANSION_ENTRY_COLUMNS: ReadonlySet<string> =
  new Set(Object.keys(MODE_FOR_COLUMN))

/**
 * Entry points finer than a column.
 *
 * A conceptual column can hold two questions. Investment View carries the
 * rating AND the target: the rating asks what we believe, the target asks what
 * it is worth, and they open different modes. A column-level map cannot say
 * that, and showing a reader the rating because they clicked the target is the
 * kind of near-miss that teaches them the surface is guessing.
 *
 * So each datum stamps `data-entry` with one of these, `AssetTableView` reads
 * the nearest one on click, and the column id is only the fallback for a cell
 * that has not been broken into parts.
 */
export const ENTRY_TOKENS = [
  'overview', 'market', 'valuation', 'case', 'research', 'position', 'work',
] as const
export type EntryToken = typeof ENTRY_TOKENS[number]

/*
 * Seven tokens, five modes.
 *
 * `market` and `valuation` are the two cells that both ask what it is worth
 * against what it costs, and they now open the same PRICE mode. They stay
 * distinct here rather than being collapsed in `ListRowCells`, because the
 * ring that highlights the clicked datum is keyed on the token: merging them
 * would light the Target cell when the reader clicked the price.
 *
 * `price` is the token the mode reports back through `onEntryChange`, so the
 * table can re-measure the row. See `MODE_ORDER`.
 */
const ENTRY_MODE: Readonly<Record<EntryToken, ListRowMode>> = {
  overview: 'overview',
  // Price and the target both ask what it is worth against what it costs,
  // and both open the one chart that draws them together.
  market: 'market',
  valuation: 'market',
  // The rating cell and the Research preset's case columns both interrogate
  // the written case. `case` is the token the cells stamp; `research` is the
  // mode, and the token the mode echoes back for the ring.
  case: 'research',
  research: 'research',
  position: 'position',
  work: 'work',
}

/**
 * The inspector's frame: one height per density, the same for every mode.
 *
 * Each mode used to claim a share of the row — PRICE 2.1, POSITION 1.35,
 * WORK 0.8 — so switching tabs inside an open row resized the row. Chart to
 * the written view halved it from 672px to 320px, every row below jumped
 * 352px up the screen, and the scroll position lurched under the cursor
 * mid-click. A workspace does not change size because the reader looked at a
 * different part of it.
 *
 * ── Why it is not taller ──────────────────────────────────────────────
 *
 * The first attempt at a single frame was 608px at compact, derived from
 * what a full-table-width chart needs to stay under `PriceChart`'s 4:1
 * aspect cap: shell + a 360px plot. The arithmetic was right and the result
 * was wrong — an expanded row that eats two thirds of a laptop viewport
 * stops being a row and becomes a page, and the reader loses the list they
 * opened it from.
 *
 * The list has to stay visible around the thing it opened. ~470px at compact
 * leaves roughly half the viewport showing other names. The chart gives up
 * the difference in WIDTH rather than height: `MAX_ASPECT` holds its
 * proportions and centres it, so it reads as a well-proportioned plot with
 * margins instead of a horizon stretched across the table.
 *
 * A pure function in this module, not a closure inside `ListTableView`, so
 * "the frame does not move" is a property a test can assert directly.
 */
const EXPANDED_HEIGHT: Readonly<Record<string, number>> = {
  comfortable: 500, compact: 472, ultra: 440, micro: 400,
}

export function expandedRowHeightForDensity(density: string): number {
  return EXPANDED_HEIGHT[density] ?? EXPANDED_HEIGHT.compact
}

/** True for a string the table may treat as a sub-element entry point. */
export function isEntryToken(v?: string | null): v is EntryToken {
  return !!v && (ENTRY_TOKENS as readonly string[]).includes(v)
}

/**
 * The datum a column id names, for the ring on the collapsed row.
 *
 * Distinct from `modeForEntryColumn`, and the distinction matters now that two
 * cells open one mode: MARKET and the target both open PRICE, so a mode name
 * can no longer say which cell the reader clicked. The expansion echoes its
 * state back to the table for re-measurement, and echoing the MODE overwrote
 * that — click the target on a row already open on the chart and the ring
 * stayed on the price cell, pointing at a field nobody had touched.
 *
 * So the echo carries a TOKEN. `modeForEntryColumn` maps every token back to
 * the same mode, which is what keeps the handshake from oscillating.
 */
const COLUMN_ENTRY: Readonly<Record<string, EntryToken>> = {
  ticker: 'overview',
  companyName: 'overview',
  coverage: 'overview',
  list_market: 'market',
  price: 'market',
  change: 'market',
  list_valuation: 'valuation',
  list_exposure: 'position',
  list_view: 'case',
  list_work: 'work',
  list_case: 'case',
  list_evidence: 'case',
  list_changed: 'case',
  list_owner: 'work',
  list_stage: 'work',
  list_age: 'work',
  list_sizing: 'position',
}

export function entryTokenFor(entry: string | undefined, fallback: EntryToken): EntryToken {
  if (isEntryToken(entry)) return entry
  return (entry && COLUMN_ENTRY[entry]) || fallback
}

/**
 * The mode an entry opens.
 *
 * Accepts either a `data-entry` token or a column id, because the table hands
 * over whichever it found: the token when the reader hit a specific datum, the
 * column id when they hit the cell around it or the chevron. Unknown input
 * falls back to Overview — no particular intent stated.
 */
export function modeForEntryColumn(entry?: string): ListRowMode {
  if (isEntryToken(entry)) return ENTRY_MODE[entry]
  return (entry && MODE_FOR_COLUMN[entry]) || 'overview'
}
