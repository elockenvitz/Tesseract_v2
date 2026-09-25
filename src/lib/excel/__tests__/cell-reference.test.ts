/**
 * The Excel reference grammar, shared by the desktop grid and a phone.
 *
 * `FieldMapping.cell` is one flat string with the sheet embedded in it, so
 * this grammar IS the contract between the two clients. What is pinned here
 * is the round trip — parse ∘ format is identity — plus the leniency the
 * desktop parser has always had, because callers rely on a half-typed
 * reference not throwing.
 */
import { describe, it, expect } from 'vitest'
import {
  parseCellReference,
  formatCellReference,
  isValidCellReference,
  isValidRangeReference,
  parseRangeReference,
  formatRangeReference,
  sheetNamesIn,
} from '../cell-reference'

describe('parseCellReference — moved verbatim, so behaviour is pinned', () => {
  it('splits a sheet-qualified reference', () => {
    expect(parseCellReference('Summary!B5')).toEqual({ sheet: 'Summary', cell: 'B5' })
  })

  it('returns a null sheet for a bare reference', () => {
    expect(parseCellReference('B5')).toEqual({ sheet: null, cell: 'B5' })
  })

  it('upper-cases the cell but leaves the sheet name alone', () => {
    // Sheet names are matched case-insensitively downstream but displayed as
    // typed, so changing their case here would alter what the user sees.
    expect(parseCellReference('summary!b5')).toEqual({ sheet: 'summary', cell: 'B5' })
  })

  it('keeps spaces inside a sheet name', () => {
    expect(parseCellReference('Model Sheet!B12')).toEqual({ sheet: 'Model Sheet', cell: 'B12' })
  })

  it('is lenient rather than throwing on nonsense', () => {
    // Form state holds half-typed references. Throwing here would make the
    // editor explode between keystrokes.
    expect(parseCellReference('not a ref')).toEqual({ sheet: null, cell: 'not a ref' })
    expect(parseCellReference('')).toEqual({ sheet: null, cell: '' })
    expect(parseCellReference('   ')).toEqual({ sheet: null, cell: '' })
  })

  it('does NOT strip surrounding quotes, matching the desktop', () => {
    // Recorded deliberately: nothing in the product writes quoted sheet
    // names, and a quoted one would miss the lookup and silently resolve
    // against the first sheet. Pinning it stops a "helpful" fix that would
    // make the phone accept a string the desktop cannot resolve.
    expect(parseCellReference("'Model Sheet'!B12").sheet).toBe("'Model Sheet'")
  })
})

describe('formatCellReference — the inverse, and the desktop string shape', () => {
  it('qualifies when a sheet is given', () => {
    expect(formatCellReference('Summary', 'B5')).toBe('Summary!B5')
  })

  it('writes a bare reference when the sheet is absent, blank or whitespace', () => {
    // These three are how a phone says "single-sheet workbook", reproducing
    // what the desktop writes when SheetNames.length === 1.
    expect(formatCellReference(null, 'B5')).toBe('B5')
    expect(formatCellReference(undefined, 'B5')).toBe('B5')
    expect(formatCellReference('   ', 'B5')).toBe('B5')
  })

  it('does not quote a sheet name containing spaces', () => {
    // The desktop writes `${activeSheet}!${cellRef}` raw. Quoting here would
    // produce a string parseCellReference cannot resolve.
    expect(formatCellReference('Model Sheet', 'B12')).toBe('Model Sheet!B12')
  })

  it('normalises the cell to upper case', () => {
    expect(formatCellReference('Summary', 'b5')).toBe('Summary!B5')
  })

  it('round-trips with the parser in both shapes', () => {
    // Already-canonical references must come back byte-identical: this is
    // what lets an editor parse a stored mapping, show it, and write it back
    // without rewriting rows the user never touched.
    for (const ref of ['Summary!B5', 'B5', 'Model Sheet!AA120']) {
      const { sheet, cell } = parseCellReference(ref)
      expect(formatCellReference(sheet, cell)).toBe(ref)
    }
  })

  it('canonicalises a non-canonical reference exactly once', () => {
    // A lower-case cell is rewritten on the first pass and then stable, so
    // repeated opens do not keep producing "changes".
    const first = parseCellReference('summary!b5')
    const once = formatCellReference(first.sheet, first.cell)
    expect(once).toBe('summary!B5')

    const second = parseCellReference(once)
    expect(formatCellReference(second.sheet, second.cell)).toBe(once)
  })
})

describe('validation — which a phone needs and the desktop never had', () => {
  it('accepts well-formed cells, qualified or not', () => {
    expect(isValidCellReference('B5')).toBe(true)
    expect(isValidCellReference('Summary!B5')).toBe(true)
    expect(isValidCellReference('AA120')).toBe(true)
    expect(isValidCellReference('b5')).toBe(true)
  })

  it('rejects what would only fail later, against a real workbook', () => {
    expect(isValidCellReference('')).toBe(false)
    expect(isValidCellReference('B')).toBe(false)
    expect(isValidCellReference('5')).toBe(false)
    expect(isValidCellReference('5B')).toBe(false)
    expect(isValidCellReference('not a ref')).toBe(false)
    // A range is not a cell: FieldMapping addresses exactly one cell.
    expect(isValidCellReference('B5:C9')).toBe(false)
  })

  it('accepts ranges only in the snapshot_ranges shape', () => {
    expect(isValidRangeReference('A1:H30')).toBe(true)
    expect(isValidRangeReference('Summary!A1:H30')).toBe(true)
    expect(isValidRangeReference('A1')).toBe(false)
    expect(isValidRangeReference('A1:B2:C3')).toBe(false)
    expect(isValidRangeReference('A1:')).toBe(false)
    expect(isValidRangeReference('')).toBe(false)
  })
})

describe('ranges round-trip the way snapshot_ranges stores them', () => {
  it('splits a qualified range', () => {
    expect(parseRangeReference('Summary!A1:H30')).toEqual({
      sheet: 'Summary', start: 'A1', end: 'H30',
    })
  })

  it('splits a bare range', () => {
    expect(parseRangeReference('A1:H30')).toEqual({ sheet: null, start: 'A1', end: 'H30' })
  })

  it('formats back to the stored string', () => {
    expect(formatRangeReference('Summary', 'a1', 'h30')).toBe('Summary!A1:H30')
    expect(formatRangeReference(null, 'A1', 'H30')).toBe('A1:H30')
  })

  it('round-trips', () => {
    for (const ref of ['Summary!A1:H30', 'A1:H30']) {
      const { sheet, start, end } = parseRangeReference(ref)
      expect(formatRangeReference(sheet, start, end)).toBe(ref)
    }
  })
})

describe('sheetNamesIn — how a phone offers sheets without the workbook', () => {
  it('collects distinct sheet names in first-seen order', () => {
    expect(sheetNamesIn(['Model!B5', 'Summary!A1', 'Model!C9'])).toEqual(['Model', 'Summary'])
  })

  it('reads ranges as well as cells', () => {
    expect(sheetNamesIn(['Summary!A1:H30', 'Model!B5'])).toEqual(['Summary', 'Model'])
  })

  it('returns nothing when every reference is bare', () => {
    // The honest answer: a template whose references are all bare belongs to
    // a single-sheet workbook, and a new bare reference will match it.
    expect(sheetNamesIn(['B5', 'C9'])).toEqual([])
    expect(sheetNamesIn([])).toEqual([])
  })

  it('ignores malformed entries rather than offering them as sheets', () => {
    expect(sheetNamesIn(['not a ref', 'Model!B5'])).toEqual(['Model'])
  })
})
