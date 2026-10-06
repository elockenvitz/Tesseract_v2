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
import { MODE_FOR_COLUMN, LIST_EXPANSION_ENTRY_COLUMNS, modeForEntryColumn } from '../listRowModes'

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
    const calls = TABLE.match(/openRowFromCell\(asset\.id,\s*col\.id\)/g) ?? []
    expect(calls.length).toBe(2)
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
    const passes = TABLE.match(/entryColumnFor\(asset\.id\)/g) ?? []
    expect(passes.length).toBe(2)
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

describe('the map covers what the curated line actually shows', () => {
  it('maps every field the brief names', () => {
    expect(MODE_FOR_COLUMN).toMatchObject({
      ticker: 'overview',
      companyName: 'overview',
      price: 'market',
      change: 'market',
      list_spark: 'market',
      list_rating: 'case',
      list_target: 'valuation',
      list_position: 'position',
      list_work: 'work',
    })
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
