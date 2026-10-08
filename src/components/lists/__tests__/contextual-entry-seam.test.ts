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

describe('the map covers what the curated line actually shows', () => {
  it('maps each of the six conceptual columns onto the mode that answers it', () => {
    expect(MODE_FOR_COLUMN).toMatchObject({
      // SECURITY
      ticker: 'overview',
      companyName: 'overview',
      list_market: 'market',
      list_exposure: 'position',
      list_view: 'case',
      list_valuation: 'valuation',
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
