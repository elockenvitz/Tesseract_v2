/**
 * The seam that makes a clicked field open the matching mode.
 *
 * Four parts have to agree, and if any one drifts the feature degrades SILENTLY
 * — every row simply opens on Overview, which is a plausible-looking result that
 * no behavioural test on either side would catch:
 *
 *   1. a cell click calls `openRowFromCell(asset.id, col.id)`     AssetTableView
 *   2. the slot is invoked with the entry column as a 4th argument AssetTableView
 *   3. `ListTableView` forwards that argument to the expansion      ListTableView
 *   4. the expansion derives its initial mode from it            ListRowExpansion
 *
 * `ListRowExpansion` is tested behaviourally for step 4 elsewhere. Steps 1-3 run
 * inside a 5900-line virtualised component that a unit test cannot mount
 * affordably, so they are asserted against the source — which is why every
 * assertion here runs on COMMENT-STRIPPED text. Without that, a prose mention of
 * `entryColumnId` in a doc comment would satisfy the gate, and this file would
 * be decoration that guards a feature it cannot see.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  MODE_FOR_COLUMN, LIST_EXPANSION_ENTRY_COLUMNS, modeForEntryColumn, MODE_ORDER,
  ENTRY_TOKENS, expandedRowHeightFor,
} from '../listRowModes'

const SRC = resolve(__dirname, '../../..')

/** Strip `//` line and `/* *\/` block comments, so prose cannot pass. */
const codeOf = (s: string) =>
  s.split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n').replace(/\/\*[\s\S]*?\*\//g, '')

const TABLE = codeOf(readFileSync(resolve(SRC, 'components/table/AssetTableView.tsx'), 'utf8'))
const LIST = codeOf(readFileSync(resolve(SRC, 'components/lists/ListTableView.tsx'), 'utf8'))

describe('the table reports which cell was clicked', () => {
  it('opens the row from a cell in both renderers', () => {
    // Ungrouped and grouped. The grouped one was the asymmetric case: a cell
    // click there navigates away, so the entry-column branch has to come first
    // and return.
    const calls = TABLE.match(/openRowFromCell\(asset\.id,\s*entryFrom\(e,\s*col\.id\)\)/g) ?? []
    expect(calls.length).toBe(2)
  })

  it('prefers the sub-element the reader hit over the column around it', () => {
    /*
     * A conceptual cell can hold two questions — Investment View carries both
     * the rating and the target — so the datum states its own entry and the
     * nearest one wins. Without this the target opens Case, which is a
     * near-miss: plausible, wrong, and invisible in review.
     */
    expect(TABLE).toMatch(/closest<HTMLElement>\('\[data-entry\]'\)/)
    expect(TABLE).toMatch(/hit\?\.dataset\.entry \|\| columnId/)
  })

  it('gates it on the surface opting the column in', () => {
    const guards = TABLE.match(/expansionEntryColumns\?\.has\(col\.id\)/g) ?? []
    // Two click handlers plus two cursor-affordance checks.
    expect(guards.length).toBeGreaterThanOrEqual(4)
  })

  it('lets a real control inside an entry cell win the click', () => {
    // The chevron lives in the ticker cell, which IS an entry column.
    const escapes = TABLE.match(/closest\('button,a,input,select,textarea,\[role="button"\]'\)/g) ?? []
    expect(escapes.length).toBe(2)
  })

  it('opens rather than toggles, so a second field does not slam the row shut', () => {
    expect(TABLE).toMatch(/const openRowFromCell[\s\S]{0,200}setExpandedRowId\(assetId\)/)
    // Specifically NOT the toggling setter, which is what `toggleRowExpansion`
    // uses and would close a row the reader is still reading.
    const body = TABLE.split('const openRowFromCell')[1]?.slice(0, 300) ?? ''
    expect(body).not.toMatch(/prev === assetId \? null/)
  })

  it('hands the entry column to the slot at both call sites', () => {
    // Twice for the slot, plus once more to stamp `data-open-entry` on the
    // expanded row so the clicked datum keeps its ring.
    const passes = TABLE.match(/entryColumnFor\(asset\.id\)/g) ?? []
    expect(passes.length).toBe(3)
    expect(TABLE).toMatch(/data-open-entry=\{isExpanded \? entryColumnFor\(asset\.id\) : undefined\}/)
    // And narrows before reading, which optional chaining in the test does not.
    expect(TABLE).toMatch(/held && held\.assetId === assetId \? held\.columnId : undefined/)
  })
})

describe('the list forwards it to the expansion', () => {
  it('accepts a fourth slot argument and passes it on', () => {
    expect(LIST).toMatch(/entryColumnId\?: string/)
    expect(LIST).toMatch(/entryColumnId=\{entryColumnId\}/)
  })

  it('opts its own columns in', () => {
    expect(LIST).toMatch(/expansionEntryColumns=\{LIST_EXPANSION_ENTRY_COLUMNS\}/)
  })
})

/**
 * The table stays mounted. There is no engagement path.
 *
 * A full-screen workbench was built and rejected: losing the surrounding
 * securities, the columns and the reader's place defeats the whole loop —
 * SCAN → NOTICE → INTERROGATE → ACT → COLLAPSE → CONTINUE SCANNING. These
 * assertions exist so it cannot come back by accident, because the regression
 * looks like a feature.
 */
describe('interrogating a security never unmounts the table', () => {
  it('neither open path delegates engagement away from the expansion', () => {
    expect(TABLE).not.toMatch(/onEngageRow/)
    expect(LIST).not.toMatch(/onEngageRow/)
  })

  it('both open paths set the inline expansion directly', () => {
    for (const fn of ['openRowFromCell', 'toggleRowExpansion']) {
      const body = TABLE.split(`const ${fn}`)[1]?.slice(0, 300) ?? ''
      expect(body, `${fn} must expand in place`).toMatch(/setExpandedRowId/)
    }
  })

  it('the list renders the table unconditionally, not behind a mode switch', () => {
    // A ternary around `<AssetTableView` is how the rejected model worked: the
    // table became one branch of a choice rather than the surface itself.
    expect(LIST).not.toMatch(/\?\s*\(\s*<List\w+Workbench/)
    expect(LIST).toMatch(/<AssetTableView/)
    expect(LIST).toMatch(/expandedRowSlot=\{expandedRowSlot\}/)
  })

  it('every entry column still lands on a mode the expansion actually has', () => {
    for (const id of LIST_EXPANSION_ENTRY_COLUMNS) {
      expect(MODE_ORDER, `${id} must map to a real mode`)
        .toContain(modeForEntryColumn(id))
    }
  })
})

/**
 * Arriving from Lists home, pointed at one security.
 *
 * An attention row on Lists home opens the universe ON that security, in the
 * inspector its reason names. Four parts have to agree and the failure is
 * silent in the same way the cell seam is — the list simply opens unexpanded,
 * which looks like a working link:
 *
 *   1. the page attaches `_focus` to the tab data        ListsPage
 *   2. `ListTab` forwards it as `focus`                  ListTab
 *   3. `ListTableView` hands it on as `initialExpanded`  ListTableView
 *   4. the table honours it once                         AssetTableView
 */
describe('a security clicked on Lists home opens inside the table', () => {
  const TAB = codeOf(readFileSync(resolve(SRC, 'components/tabs/ListTab.tsx'), 'utf8'))

  /*
   * Lists home no longer emits a focus.
   *
   * Attention there is secondary intelligence — a count and a breakdown, not a
   * work queue — so a row opens the universe and nothing else. The plumbing
   * below is kept and still asserted: it is a general capability of the table,
   * and the surface that next wants to point at one security uses it unchanged.
   */

  it('the tab forwards it and the list hands it to the table', () => {
    expect(TAB).toMatch(/focus=\{list\?\._focus\}/)
    expect(LIST).toMatch(/initialExpanded=\{focus\?\.assetId/)
  })

  it('the table honours it once, not on every render', () => {
    // Re-applying would spring the row back open each time the reader closed it.
    expect(TABLE).toMatch(/honouredFocus/)
    expect(TABLE).toMatch(/if \(honouredFocus\.current === key\) return/)
    expect(TABLE).toMatch(/setExpandedRowId\(initialExpanded\.assetId\)/)
  })

  it('still expands in place — arriving never replaces the table', () => {
    expect(TABLE).not.toMatch(/onEngageRow/)
    expect(LIST).toMatch(/<AssetTableView/)
  })
})

/**
 * The inspector's frame does not move.
 *
 * Per-mode heights meant switching tabs inside an open row resized the row:
 * chart to the written view halved it from 672px to 320px, every row below
 * jumped, and the scroll position lurched under the reader's cursor. This is
 * asserted on the pure function rather than through the virtualised table,
 * because it is a property of the number, not of the render.
 */
describe('the expanded row is one fixed frame', () => {
  /*
   * Asserted against the SOURCE, like the rest of this file.
   *
   * Feeding entries to `expandedRowHeightForDensity` would prove nothing —
   * it does not take one, so a test that loops over tokens and collects one
   * distinct height is asserting its own loop. The thing that can regress is
   * `ListTableView` reintroducing a per-mode branch in the callback it hands
   * the table, so that is what is pinned.
   */
  /*
   * Each mode gets the height ITS content needs.
   *
   * This reverses an earlier fixed-frame rule. The frame was introduced to
   * stop the row resizing on a tab switch, but the defect that motivated it
   * was an infinite render loop between the panel and the table, not the
   * resize — and the loop is fixed independently (the mode is derived during
   * render, never synced in an effect). What the single frame cost was a
   * panel sized for the chart on every mode, so Position and Work sat in
   * hundreds of pixels of nothing.
   */
  it('gives each mode the height its content needs', () => {
    const h = (m: Parameters<typeof expandedRowHeightFor>[0]) => expandedRowHeightFor(m, 'compact')
    // The chart is the tallest; the two compact modes are well under it.
    expect(h('market')).toBeGreaterThan(h('overview'))
    expect(h('market')).toBeGreaterThan(h('position'))
    // And the difference is worth having — a few pixels would not be.
    expect(h('market') - h('position')).toBeGreaterThan(60)
  })

  it('keeps every mode inside a usable band', () => {
    for (const m of MODE_ORDER) {
      const v = expandedRowHeightFor(m, 'compact')
      expect(v, `${m} too short`).toBeGreaterThan(200)
      // Half a 900px laptop viewport plus a margin: a row taller than this
      // is a page, and a list you cannot see around is not a list.
      expect(v, `${m} too tall`).toBeLessThan(520)
    }
  })

  it('scales with density rather than ignoring it', () => {
    expect(expandedRowHeightFor('market', 'comfortable'))
      .toBeGreaterThan(expandedRowHeightFor('market', 'micro'))
  })

  it('still differs BETWEEN densities, or the control does nothing', () => {
    const byDensity = ['comfortable', 'compact', 'ultra', 'micro']
      .map(d => expandedRowHeightFor('market', d))
    expect(new Set(byDensity).size).toBe(4)
    // Monotonic: a tighter density is never taller than a looser one.
    expect([...byDensity].sort((a, b) => b - a)).toEqual(byDensity)
  })

  /*
   * Both ends of the tradeoff, pinned.
   *
   * The first single frame was 608px — derived from the height a chart needs
   * to stay under `PriceChart`'s 4:1 cap at full table width. The arithmetic
   * was right and the row was unusable: it ate two thirds of a laptop
   * viewport, so the reader lost the list they had opened it from.
   *
   * The chart now gives up WIDTH instead (it centres itself at the cap), and
   * the frame answers to the viewport. These two assertions are the floor and
   * the ceiling; a change that breaks either is a change that re-opens the
   * argument rather than a tuning tweak.
   */
  const SHELL = 164 // padding + header + verdict + footer

  /*
   * The floor moved from 240 to 180, deliberately.
   *
   * 240 came from the single-frame era, when Market's budget was the whole
   * 472px panel. The per-mode budget is ~360, which is what the approved
   * design asks of the chart mode — so the plot is shorter, and the cost is
   * paid in WIDTH instead: `PriceChart`'s `MAX_ASPECT` centres the plot
   * rather than stretching it flat. Below 180 that trade stops working and
   * the chart gutters itself to a strip, which is the regression this
   * guards.
   */
  it('leaves a plot tall enough to read a trend in', () => {
    expect(expandedRowHeightFor('market', 'compact') - SHELL).toBeGreaterThan(180)
  })

  it('leaves the list visible around the row it opened', () => {
    // Half of a 900px laptop viewport, the common case. A row taller than
    // this is a page, and a list you cannot see is not a list.
    expect(expandedRowHeightFor('market', 'comfortable')).toBeLessThan(900 / 2 + 60)
  })
})

describe('the map covers what the curated line actually shows', () => {
  it('maps each conceptual column onto the mode that answers it', () => {
    expect(MODE_FOR_COLUMN).toMatchObject({
      // SECURITY
      ticker: 'overview',
      companyName: 'overview',
      // MARKET and the target both ask what it is worth against what it
      // costs, and both now open PRICE — one chart with the target and the
      // scenarios drawn on it. See `listRowModes`.
      list_market: 'market',
      list_valuation: 'market',
      list_exposure: 'position',
      list_view: 'research',
      list_work: 'work',
    })
  })

  it('maps every conceptual column, and every mode is reachable from one', () => {
    const conceptual = ['list_market', 'list_exposure', 'list_view', 'list_valuation', 'list_work']
    for (const id of conceptual) {
      expect(MODE_FOR_COLUMN[id], `${id} must open a mode`).toBeTruthy()
    }
    // Every mode must be the destination of some cell, or that mode is only
    // reachable through the switch and the clicked field cannot express it.
    const reached = new Set(Object.values(MODE_FOR_COLUMN))
    for (const mode of MODE_ORDER) {
      expect(reached, `no cell opens ${mode}`).toContain(mode)
    }
  })

  it('still maps the scalar columns a reader can re-enable', () => {
    // Hidden from the default line, not deleted — a visible column whose cell
    // does nothing when clicked is the defect this map prevents.
    expect(MODE_FOR_COLUMN.price).toBe('market')
    expect(MODE_FOR_COLUMN.change).toBe('market')
    expect(MODE_FOR_COLUMN.coverage).toBe('overview')
  })

  it('opts in exactly the mapped columns, and nothing with its own behaviour', () => {
    expect([...LIST_EXPANSION_ENTRY_COLUMNS].sort()).toEqual(Object.keys(MODE_FOR_COLUMN).sort())
    // Each of these already does something on click — an editor, a popover, a
    // checkbox. A table where every click expands a row cannot be navigated.
    for (const id of [
      'select', 'workflows', 'priority', 'notes', 'listNote', 'actions',
      'list_assignee', 'list_status', 'list_tags',
    ]) {
      expect(LIST_EXPANSION_ENTRY_COLUMNS.has(id), `${id} must not open the row`).toBe(false)
    }
  })

  it('falls back to Overview for the chevron and the row body', () => {
    // No entry column means no particular intent.
    expect(modeForEntryColumn(undefined)).toBe('overview')
    expect(modeForEntryColumn('a_column_that_does_not_exist')).toBe('overview')
  })
})
