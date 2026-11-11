/**
 * Reading a figure, and refusing to read one that is not there.
 *
 * The two failure modes this guards are opposite and both bad: classifying a
 * date or a sentence as numeric (which right-aligns prose and ruins a table),
 * and giving a direction tone to a figure the model never signed (which
 * asserts a change where it stated a level).
 */
import { describe, it, expect } from 'vitest'
import { readFigure, isFigure, figureTone, numericColumns } from '../figures'

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

  it('treats a column with one stray word as text', () => {
    /* Conservative on purpose: a left-aligned number column is untidy, a
       right-aligned sentence is unreadable. */
    const rows = [
      ['AAPL', '$276.49'],
      ['MSFT', 'not held'],
    ]
    expect([...numericColumns(rows)]).toEqual([])
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
