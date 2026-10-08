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

export type ListRowMode =
  | 'overview'
  | 'market'
  | 'case'
  | 'valuation'
  | 'position'
  | 'work'

/** Tab order. Stable — a switch whose items move is a switch you re-read. */
export const MODE_ORDER: readonly ListRowMode[] = [
  'overview', 'market', 'case', 'valuation', 'position', 'work',
]

export const MODE_LABEL: Record<ListRowMode, string> = {
  overview: 'Overview',
  market: 'Market',
  case: 'Case',
  valuation: 'Valuation',
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
  list_view: 'case',
  list_valuation: 'valuation',
  list_work: 'work',
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
  'overview', 'market', 'case', 'valuation', 'position', 'work',
] as const
export type EntryToken = typeof ENTRY_TOKENS[number]

const ENTRY_MODE: Readonly<Record<EntryToken, ListRowMode>> = {
  overview: 'overview',
  market: 'market',
  case: 'case',
  valuation: 'valuation',
  position: 'position',
  work: 'work',
}

/** True for a string the table may treat as a sub-element entry point. */
export function isEntryToken(v?: string | null): v is EntryToken {
  return !!v && (ENTRY_TOKENS as readonly string[]).includes(v)
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
