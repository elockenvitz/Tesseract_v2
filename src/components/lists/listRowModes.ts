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

/** Which mode a cell means when the reader clicks it. */
export const MODE_FOR_COLUMN: Readonly<Record<string, ListRowMode>> = {
  ticker: 'overview',
  companyName: 'overview',
  price: 'market',
  change: 'market',
  list_spark: 'market',
  list_rating: 'case',
  list_target: 'valuation',
  list_position: 'position',
  list_work: 'work',
  // Who covers it is part of orienting on the name, and Overview is where the
  // covering analysts are shown. Without this, Coverage was the one visible
  // column on the curated line whose cell did nothing when clicked.
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

/** The mode a cell opens, or `overview` for the chevron and the row body. */
export function modeForEntryColumn(columnId?: string): ListRowMode {
  return (columnId && MODE_FOR_COLUMN[columnId]) || 'overview'
}
