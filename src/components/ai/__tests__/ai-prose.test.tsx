/**
 * The renderer, against the two faults it was written to fix.
 *
 * The inline-code case is the important one. It was broken for as long as the
 * project has been on react-markdown 9 or later and nothing caught it, because
 * a dead branch does not throw: the code just silently took the block path and
 * the styling quietly disappeared. So the assertion is on the OUTCOME the
 * reader sees — an inline span that is not inside a <pre> and carries its own
 * background — not on the shape of the component tree.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiProse } from '../AiProse'

describe('inline code', () => {
  it('renders inline code as a pill, not as a block', () => {
    const { container } = render(<AiProse content="Set `byok_enabled` to true." />)

    const code = container.querySelector('code')
    expect(code).not.toBeNull()
    expect(code!.textContent).toBe('byok_enabled')
    /* The fault: it used to land inside the block styling. */
    expect(code!.closest('pre')).toBeNull()
    expect(code!.className).toMatch(/bg-gray-200/)
    expect(code!.className).toMatch(/rounded/)
  })

  it('still renders a fenced block as a block', () => {
    const { container } = render(<AiProse content={'```\nselect 1;\n```'} />)

    const pre = container.querySelector('pre')
    expect(pre).not.toBeNull()
    expect(pre!.textContent).toContain('select 1;')
    /* The block's own <code> is inside the <pre>, where the pill must not be. */
    const inner = pre!.querySelector('code')
    expect(inner).not.toBeNull()
    expect(inner!.className).not.toMatch(/bg-gray-200/)
  })

  it('keeps a fenced block with a language a block', () => {
    const { container } = render(<AiProse content={'```sql\nselect 1;\n```'} />)
    expect(container.querySelector('pre')?.textContent).toContain('select 1;')
  })
})

describe('financial tables', () => {
  const TABLE = [
    '| Book | Weight | Change |',
    '| --- | --- | --- |',
    '| Large Cap Growth | 25.3% | +5.00% |',
    '| Vision Fund 5K | 4.0% | -1.20% |',
  ].join('\n')

  it('right-aligns a numeric column and its header', () => {
    const { container } = render(<AiProse content={TABLE} />)

    const headers = [...container.querySelectorAll('th')]
    expect(headers.map(h => h.textContent)).toEqual(['Book', 'Weight', 'Change'])
    /* The header takes its alignment from the column's DATA: "Change" is a
       word, but the column under it is numbers. */
    expect(headers[0].className).toMatch(/text-left/)
    expect(headers[1].className).toMatch(/text-right/)
    expect(headers[2].className).toMatch(/text-right/)
  })

  it('gives numeric cells tabular figures so a column can be compared', () => {
    const { container } = render(<AiProse content={TABLE} />)
    const row = container.querySelectorAll('tbody tr')[0]
    const cells = [...row.querySelectorAll('td')]

    expect(cells[0].className).not.toMatch(/tabular-nums/)
    expect(cells[1].className).toMatch(/tabular-nums/)
    expect(cells[2].className).toMatch(/tabular-nums/)
  })

  it('tones a signed change and leaves a level alone', () => {
    const { container } = render(<AiProse content={TABLE} />)
    const rows = container.querySelectorAll('tbody tr')
    const up = [...rows[0].querySelectorAll('td')][2]
    const down = [...rows[1].querySelectorAll('td')][2]
    const level = [...rows[0].querySelectorAll('td')][1]

    expect(up.className).toMatch(/emerald/)
    expect(down.className).toMatch(/text-red/)
    /* 25.3% is a weight, not a change. Nothing may colour it. */
    expect(level.className).not.toMatch(/emerald/)
    expect(level.className).not.toMatch(/text-red/)
  })

  describe('a word in a weight column is not a weight', () => {
    /*
     * The reported defect, verbatim in shape: one column holding `3.2%`,
     * `unknown` and `reduced`, with nothing to tell a reader that only the
     * first of those is a weight.
     */
    const MIXED = [
      '| Book | Weight |',
      '| --- | --- |',
      '| Large Cap Growth | 3.2% |',
      '| Vision Fund | unknown |',
      '| Global Equity | reduced |',
    ].join('\n')

    const cells = (content: string) =>
      [...render(<AiProse content={content} />).container.querySelectorAll('tbody tr')]
        .map(r => [...r.querySelectorAll('td')][1])

    it('still lines the column up, so the figures can be compared', () => {
      /* The old behaviour sent the whole column down the prose path, which
         lost the alignment AND left the word sitting where a number goes. */
      for (const c of cells(MIXED)) expect(c.className).toMatch(/text-right/)
    })

    it('gives tabular figures to the number and not to the words', () => {
      const [figure, unknown, reduced] = cells(MIXED)
      expect(figure.className).toMatch(/tabular-nums/)
      expect(unknown.className).not.toMatch(/tabular-nums/)
      expect(reduced.className).not.toMatch(/tabular-nums/)
    })

    it('renders the words as quieter labels than the figure', () => {
      const [figure, unknown] = cells(MIXED)
      expect(unknown.getAttribute('data-cell')).toBe('token')
      expect(figure.getAttribute('data-cell')).toBe('figure')
      expect(unknown.className).toMatch(/text-gray-500/)
      expect(figure.className).not.toMatch(/text-gray-500/)
    })

    it('never tones a status word, however much it sounds like a direction', () => {
      /* "reduced" is the trap: colouring it red would assert a change the
         model put no sign on, which is the discipline figures.ts applies to
         numbers and must apply to words too. */
      const reduced = cells(MIXED)[2]
      expect(reduced.className).not.toMatch(/text-red/)
      expect(reduced.className).not.toMatch(/emerald/)
    })

    it('keeps the model s own word, never a substitute for it', () => {
      /* Provenance. "unknown" may be the only true answer available, and the
         renderer is not entitled to turn it into a dash. */
      expect(cells(MIXED)[1].textContent).toBe('unknown')
    })

    it('falls back to prose for a column carrying a sentence', () => {
      const withProse = [
        '| Book | Weight |',
        '| --- | --- |',
        '| Large Cap Growth | 3.2% |',
        '| Vision Fund | The position was trimmed ahead of earnings. |',
      ].join('\n')
      for (const c of cells(withProse)) expect(c.className).not.toMatch(/text-right/)
    })
  })

  it('leaves a column of words left-aligned', () => {
    const { container } = render(<AiProse content={[
      '| Book | Owner |',
      '| --- | --- |',
      '| Large Cap Growth | Eric |',
    ].join('\n')} />)

    for (const th of container.querySelectorAll('th')) {
      expect(th.className).toMatch(/text-left/)
    }
  })
})

describe('ticker pills', () => {
  it('calls back with the symbol', async () => {
    const onTickerClick = vi.fn()
    render(<AiProse content="We are long $AAPL." onTickerClick={onTickerClick} />)

    await userEvent.click(screen.getByRole('button', { name: '$AAPL' }))
    expect(onTickerClick).toHaveBeenCalledWith('AAPL')
  })

  it('renders a label, not a dead button, with no handler', () => {
    render(<AiProse content="We are long $AAPL." />)
    expect(screen.queryByRole('button', { name: '$AAPL' })).toBeNull()
    expect(screen.getByText('$AAPL')).toBeTruthy()
  })

  it('leaves a ticker inside a code span alone', () => {
    const { container } = render(<AiProse content="The column is `$AAPL`." />)
    expect(container.querySelectorAll('button').length).toBe(0)
  })
})
