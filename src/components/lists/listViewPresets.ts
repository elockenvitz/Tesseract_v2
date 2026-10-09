import type { ColumnConfig } from '../table/AssetTableView'

/**
 * Three readings of one list.
 *
 * ── What a preset is, and what it is not ──────────────────────────────────
 *
 * It is a column ORDER and a visibility set over the same rows, the same
 * query and the same signals. There is no second dataset, no second table and
 * no per-view fetch: `useListRowSignals` and `useListPriceHistory` already
 * carry everything all three views render, so switching is a re-layout and
 * nothing more. That is why it is instant, and why it cannot change what the
 * list contains — which is the property that makes it safe to leave the
 * reader's scroll position and selection alone across a switch.
 *
 * ── Why each view exists ──────────────────────────────────────────────────
 *
 * MONITOR answers "what moved". It leads with the market and keeps the
 * investment view beside it, because a price move only matters against what
 * the desk believes.
 *
 * RESEARCH answers "what do we think, and is it still true". Rating and
 * conviction lead; the target and its upside follow; then the age of the
 * written case, the weight of evidence behind it, and what has landed since
 * anyone last confirmed it. The last of those is the column the surface
 * exists for — a case nobody has revisited while the facts moved is the
 * failure this product is meant to catch.
 *
 * DECIDE answers "what is owed, by whom, and how big". It is ordered by the
 * work tier, so the names with a decision outstanding are at the top without
 * the reader sorting anything.
 *
 * ── Storage ───────────────────────────────────────────────────────────────
 *
 * Each view persists its own column layout, because a width that suits a
 * thesis column is wrong for a price one and a reader who tunes Research
 * should not find Monitor rearranged. Monitor deliberately keeps the
 * ORIGINAL, unsuffixed key so customisations made before presets existed
 * survive on the default view rather than being silently discarded.
 */

export type ListView = 'monitor' | 'research' | 'decide'

export const LIST_VIEWS: ReadonlyArray<{ id: ListView; label: string; hint: string }> = [
  { id: 'monitor', label: 'Monitor', hint: 'what moved' },
  { id: 'research', label: 'Research', hint: 'what we think' },
  { id: 'decide', label: 'Decide', hint: 'what is owed' },
]

export const DEFAULT_LIST_VIEW: ListView = 'monitor'

/**
 * The reading order per view. Columns absent from a view are hidden, never
 * removed — every one stays a click away in the picker, and a reader who
 * turns one back on keeps it (saved state layers over this baseline).
 */
const VIEW_ORDER: Record<ListView, string[]> = {
  monitor: [
    'select', 'ticker',
    'list_market',
    'list_view',
    'list_exposure',
    'list_work',
  ],
  research: [
    'select', 'ticker',
    'list_view',
    'list_valuation',
    'list_case',
    'list_evidence',
    'list_changed',
    'list_market',
    'list_owner',
  ],
  decide: [
    'select', 'ticker',
    'list_work',
    'list_stage',
    'list_owner',
    'list_age',
    'list_sizing',
    'list_valuation',
    'list_exposure',
  ],
}

/** Every list-owned column, so anything off a view can be hidden explicitly. */
const ALL_LIST_COLUMNS = [
  'list_market', 'list_view', 'list_exposure', 'list_work', 'list_valuation',
  'list_case', 'list_evidence', 'list_changed', 'list_owner',
  'list_stage', 'list_age', 'list_sizing',
]

/**
 * Columns from the generic table that no List view wants on its default line.
 *
 * Carried over from the five-zone preset: the conceptual columns above state
 * these already, and a default line that scrolls horizontally is a line
 * nobody reads.
 */
const ALWAYS_HIDDEN = new Set([
  'priority', 'workflows', 'updated', 'list_assignee', 'list_tags',
  /*
   * Company is not dropped — it moves INTO the ticker cell as a second line.
   * `AssetTableView` composes it there whenever this column is hidden, so the
   * identity reads as one object instead of two columns of equal weight, and
   * the width it was using goes to the investment state.
   */
  'companyName',
  // The list's own process state. Real, but it answers a question about this
  // list rather than about the security, and the inspector's Overview shows it.
  'list_status',
  /*
   * Absorbed into MARKET, which carries price, the move and the month as one
   * answer. Still in the picker for anyone who wants the scalar back.
   */
  'price', 'change',
  /*
   * Off every default line: empty for almost every name in practice, and a
   * 112px column of em-dashes is the clearest possible signal that a table is
   * a database grid. One click away in the picker.
   */
  'coverage',
])

const WIDTH: Record<string, number> = {
  ticker: 206,
  list_market: 168,
  list_view: 150,
  list_exposure: 150,
  list_work: 210,
  list_valuation: 118,
  list_case: 124,
  list_evidence: 84,
  list_changed: 230,
  list_owner: 104,
  /*
   * 160, because the longest desk stage label is "Recommendation ready" and
   * truncating it to "Recommendation…" loses the half that says what is
   * owed. The width taken back comes off Work and Owner on the same line,
   * so the Decide preset still fits a laptop pane — `list-view-presets`
   * asserts that total.
   */
  list_stage: 160,
  /* One line. "8 mo" wrapped at 64. */
  list_age: 72,
  list_sizing: 162,
}

/*
 * Who takes the slack on a wide pane.
 *
 * Every column on a view's line takes some: a line that grows only two of
 * them leaves the rest stranded at their floor beside a gap, which is the
 * sparse-spreadsheet look the preset exists to remove. Identity and the
 * columns carrying WORDS take the most; a figure needs only its digits.
 */
const GROW: Record<string, number> = {
  ticker: 3,
  list_work: 3,
  list_changed: 3,
  list_market: 2,
  list_view: 1.5,
  list_exposure: 1.5,
  list_sizing: 1.5,
  list_case: 1,
  list_owner: 1,
  list_stage: 1,
  list_valuation: 1,
  list_evidence: 0.5,
  list_age: 0.5,
}

/*
 * Nothing is right-aligned, deliberately.
 *
 * Every conceptual cell leads with a figure that carries no column label of
 * its own, so the figure IS the heading — and a right-aligned numeric band is
 * what made the old line read as a spreadsheet rather than a watchlist.
 * `list-row-cells.test.tsx` pins this for `list_valuation` specifically.
 */
const RIGHT: ReadonlySet<string> = new Set<string>()

const LABEL: Record<string, string> = {
  ticker: 'Security',
  list_market: 'Market',
  list_view: 'View',
  list_exposure: 'Exposure',
  list_work: 'Attention',
  list_valuation: 'Target',
  list_case: 'Case',
  list_evidence: 'Evidence',
  list_changed: 'Changed since review',
  list_owner: 'Owner',
  list_stage: 'Stage',
  list_age: 'Age',
  list_sizing: 'Sizing change',
}

/** Attention reads better than Work on Monitor; Recommendation on Decide. */
const LABEL_BY_VIEW: Partial<Record<ListView, Record<string, string>>> = {
  decide: { list_work: 'Recommendation' },
}

export function presetFor(view: ListView) {
  const order = VIEW_ORDER[view]
  const rank = new Map(order.map((id, i) => [id, i]))
  const shown = new Set(order)
  const labels = { ...LABEL, ...(LABEL_BY_VIEW[view] ?? {}) }

  return function listViewPreset(base: ColumnConfig[]): ColumnConfig[] {
    const adjusted = base.map(col => {
      const width = WIDTH[col.id] ?? col.width
      const align = RIGHT.has(col.id) ? ('right' as const) : col.align
      const grow = GROW[col.id] ?? col.grow
      const label = labels[col.id] ?? col.label
      const hidden = ALWAYS_HIDDEN.has(col.id)
        || (ALL_LIST_COLUMNS.includes(col.id) && !shown.has(col.id))
      if (hidden) return { ...col, visible: false, width, align, grow, label }
      // Everything the view names is visible, including a column a previous
      // view had hidden — otherwise switching to Decide would show no Stage.
      return { ...col, visible: shown.has(col.id) ? true : col.visible, width, align, grow, label }
    })
    // Stable: equal ranks (everything off the order) keep their incoming order.
    return adjusted
      .map((col, i) => ({ col, i }))
      .sort((a, b) => {
        const ra = rank.get(a.col.id) ?? order.length + a.i
        const rb = rank.get(b.col.id) ?? order.length + b.i
        return ra - rb
      })
      .map(x => x.col)
  }
}

/**
 * Bumped whenever an order, width or hidden set above changes.
 *
 * `mergeSavedColumns` uses this to tell "the reader moved this" from "the
 * product moved this", so a stale token silently keeps an old layout. See
 * `columnPersistence.ts`.
 */
export const LIST_COLUMN_PRESET_VERSION = 'lists-v2-presets-2026-10-09'

/**
 * One saved layout per view.
 *
 * Monitor keeps the unsuffixed key on purpose: it is the default view and the
 * key customisations were written under before presets existed, so they carry
 * over instead of being dropped.
 */
export function storageKeyFor(base: string | undefined, view: ListView): string | undefined {
  if (!base) return base
  return view === 'monitor' ? base : `${base}_${view}`
}
