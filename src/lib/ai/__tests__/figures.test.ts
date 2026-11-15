/**
 * Reading a figure, and refusing to read one that is not there.
 *
 * The two failure modes this guards are opposite and both bad: classifying a
 * date or a sentence as numeric (which right-aligns prose and ruins a table),
 * and giving a direction tone to a figure the model never signed (which
 * asserts a change where it stated a level).
 */
import { describe, it, expect } from 'vitest'
import { readFigure, isFigure, figureTone, numericColumns, cellKind, valueColumns } from '../figures'

describe('readFigure', () => {
  it('reads money from a currency prefix', () => {
    expect(readFigure('$276.49')).toEqual({ unit: 'money', signed: false, negative: false })
    expect(readFigure('£1,234')).toEqual({ unit: 'money', signed: false, negative: false })
  })

  it('reads the written unit, never an inferred one', () => {
    expect(readFigure('4.2%')?.unit).toBe('percent')
    expect(readFigure('18x')?.unit).toBe('multiple')
    expect(readFigure('250bps')?.unit).toBe('basis_points')
    expect(readFigure('1.2bn')?.unit).toBe('scaled')
    expect(readFigure('743')?.unit).toBe('plain')
  })

  it('reads the accountant negative', () => {
    expect(readFigure('(1,234)')).toEqual({ unit: 'plain', signed: true, negative: true })
    expect(readFigure('($52.10)')).toEqual({ unit: 'money', signed: true, negative: true })
  })

  it('reads an explicit sign', () => {
    expect(readFigure('+16.61')).toEqual({ unit: 'plain', signed: true, negative: false })
    expect(readFigure('-2.3%')).toEqual({ unit: 'percent', signed: true, negative: true })
  })

  it('refuses anything that is not wholly a figure', () => {
    for (const notAFigure of [
      '', '  ', 'Large Cap Growth', 'Q3 2026 revenue', '2026-11-10', '5 shares',
      '1 to 3', '$', '—', 'n/a', '12%%', '1.2.3',
    ]) {
      expect(readFigure(notAFigure), notAFigure).toBeNull()
    }
  })

  it('reads a bare year, which is harmless to right-align', () => {
    expect(isFigure('2026')).toBe(true)
  })
})

describe('figureTone', () => {
  it('tones a signed change', () => {
    expect(figureTone('+4.2%')).toBe('up')
    expect(figureTone('-4.2%')).toBe('down')
    expect(figureTone('(1,234)')).toBe('down')
  })

  it('leaves a LEVEL untoned, which is the whole point', () => {
    /* 25.3% is a weight, 18x is a multiple, $230.00 is a target. None of them
       is a change, and colouring one green would assert a direction the model
       never stated. */
    expect(figureTone('25.3%')).toBeNull()
    expect(figureTone('18x')).toBeNull()
    expect(figureTone('$230.00')).toBeNull()
    expect(figureTone('743')).toBeNull()
  })

  it('has no tone for a non-figure', () => {
    expect(figureTone('Vision Fund 5K')).toBeNull()
  })
})

describe('numericColumns', () => {
  it('finds the numeric columns of a body', () => {
    const rows = [
      ['AAPL', '$276.49', '+5.00%'],
      ['MSFT', '$412.10', '-1.20%'],
    ]
    expect([...numericColumns(rows)].sort()).toEqual([1, 2])
  })

  it('treats a column carrying a sentence as text', () => {
    /* Conservative on purpose: a left-aligned number column is untidy, a
       right-aligned sentence is unreadable. */
    const rows = [
      ['AAPL', '$276.49'],
      ['MSFT', 'The position was trimmed ahead of earnings.'],
    ]
    expect([...numericColumns(rows)]).toEqual([])
  })

  it('still aligns a column whose non-figures are short status words', () => {
    /*
     * This assertion is the inverse of what it used to be, and the change is
     * deliberate. The old rule sent `3.2% / unknown / reduced` down the prose
     * path, which was the worst available outcome: the figures stopped lining
     * up AND the word still sat exactly where a figure would. The column is a
     * value column; what has to change is how the WORD renders, which is
     * `valueColumns` reporting it as mixed.
     */
    const rows = [
      ['AAPL', '3.2%'],
      ['MSFT', 'unknown'],
      ['NVDA', 'reduced'],
    ]
    expect([...numericColumns(rows)]).toEqual([1])
  })

  it('ignores blanks and placeholders when judging a column', () => {
    const rows = [
      ['AAPL', '$276.49'],
      ['MSFT', '—'],
      ['NVDA', 'n/a'],
      ['AMZN', ''],
    ]
    expect([...numericColumns(rows)]).toEqual([1])
  })

  it('finds nothing in a table of words', () => {
    expect([...numericColumns([['a', 'b'], ['c', 'd']])]).toEqual([])
  })

  it('handles ragged rows without reading past the end', () => {
    expect([...numericColumns([['AAPL', '1.2'], ['MSFT']])]).toEqual([1])
  })

  it('finds nothing in an empty body', () => {
    expect([...numericColumns([])]).toEqual([])
  })
})

/**
 * The reported defect: `3.2%`, `unknown` and `reduced` in one weight column,
 * rendered identically, inviting a reader to compare three things of which
 * only one is a weight.
 */
describe('cellKind', () => {
  it('calls a figure a figure', () => {
    expect(cellKind('3.2%')).toBe('figure')
    expect(cellKind('($52.10)')).toBe('figure')
  })

  it('calls a status word a token, so it can be rendered as a label', () => {
    for (const word of ['unknown', 'reduced', 'exited', 'not held', 'no position']) {
      expect(cellKind(word)).toBe('token')
    }
  })

  it('calls a placeholder a token rather than a value', () => {
    expect(cellKind('—')).toBe('token')
    expect(cellKind('n/a')).toBe('token')
  })

  it('calls a sentence text, whatever its length', () => {
    /* The full stop is the test, not the word count: a short sentence is
       still prose and must not be right-aligned among figures. */
    expect(cellKind('Not held.')).toBe('text')
    expect(cellKind('The position was trimmed ahead of the print')).toBe('text')
  })

  it('calls a long phrase text even without a full stop', () => {
    expect(cellKind('awaiting the PM ruling on sizing')).toBe('text')
  })

  it('reports an empty cell as blank rather than guessing', () => {
    expect(cellKind('')).toBe('blank')
    expect(cellKind('   ')).toBe('blank')
  })
})

describe('valueColumns', () => {
  it('reports a clean column of numbers as figures', () => {
    const rows = [['AAPL', '3.2%'], ['MSFT', '1.1%']]
    expect(valueColumns(rows).get(1)).toBe('figures')
  })

  it('reports a column of numbers and status words as mixed', () => {
    /* The distinction the renderer needs: a mixed column still lines up, but
       its words are marked as not-numbers. */
    const rows = [['AAPL', '3.2%'], ['MSFT', 'unknown'], ['NVDA', 'reduced']]
    expect(valueColumns(rows).get(1)).toBe('mixed')
  })

  it('does not call a column mixed on placeholders alone', () => {
    /* An em dash is an absence, not a status. A column of numbers with gaps
       in it is still a column of numbers. */
    const rows = [['AAPL', '3.2%'], ['MSFT', '—'], ['NVDA', 'n/a'], ['AMZN', '']]
    expect(valueColumns(rows).get(1)).toBe('figures')
  })

  it('abandons a column entirely once one cell is prose', () => {
    const rows = [['AAPL', '3.2%'], ['MSFT', 'unknown'], ['NVDA', 'Trimmed ahead of earnings.']]
    expect(valueColumns(rows).has(1)).toBe(false)
  })

  it('is not a value column without a single figure in it', () => {
    /* Otherwise a column of words -- a column of ratings, say -- would be
       right-aligned as though it held numbers. */
    const rows = [['AAPL', 'unknown'], ['MSFT', 'reduced']]
    expect(valueColumns(rows).has(1)).toBe(false)
  })

  it('judges each column on its own cells', () => {
    const rows = [
      ['AAPL', '3.2%', '$276.49'],
      ['MSFT', 'unknown', '$412.10'],
    ]
    const shapes = valueColumns(rows)
    expect(shapes.get(1)).toBe('mixed')
    expect(shapes.get(2)).toBe('figures')
    expect(shapes.has(0)).toBe(false)
  })
})
