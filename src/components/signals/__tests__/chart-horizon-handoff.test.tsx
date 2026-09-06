import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PriceContext, type PricePoint, type RangeKey } from '../PriceContext'
import { FullscreenChart } from '../FullscreenChart'

/**
 * The window survives the expand.
 *
 * ── The gesture this repairs ──────────────────────────────────────────────
 *
 * `onExpand` took nothing, so every expansion opened on the default window. A
 * reader who narrowed to 1M to look at something specific and then tapped
 * expand to see it larger got a year back — the one gesture whose entire
 * purpose is "show me THIS, bigger" was the gesture that discarded what "this"
 * was.
 *
 * These assert the handoff in both directions: that the range travels, and
 * that a caller which does not pass one behaves exactly as it did before.
 */

/** Two years of daily closes, so every range in the list is offered. */
const LONG: PricePoint[] = Array.from({ length: 500 }, (_, i) => ({
  date: new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10),
  close: 100 + Math.sin(i / 12) * 10 + i / 40,
}))
const NOW = new Date(LONG[LONG.length - 1].date + 'T00:00:00.000Z')

const rangeOf = () => screen.getByTestId('price-window').closest('[data-range]')?.getAttribute('data-range')
  ?? document.querySelector('[data-range]')?.getAttribute('data-range')

describe('PriceContext reports the window it is showing', () => {
  it('hands the reader’s chosen range to the expand callback', () => {
    const onExpand = vi.fn()
    render(<PriceContext symbol="MSFT" series={LONG} now={NOW} onExpand={onExpand} />)
    fireEvent.click(screen.getByText('1M'))
    fireEvent.click(screen.getByLabelText('Expand MSFT chart'))
    expect(onExpand).toHaveBeenCalledWith('1M')
  })

  it('reports each range the reader picks, not a remembered first one', () => {
    const onExpand = vi.fn()
    render(<PriceContext symbol="MSFT" series={LONG} now={NOW} onExpand={onExpand} />)
    fireEvent.click(screen.getByText('1M'))
    fireEvent.click(screen.getByLabelText('Expand MSFT chart'))
    fireEvent.click(screen.getByText('3M'))
    fireEvent.click(screen.getByLabelText('Expand MSFT chart'))
    expect(onExpand).toHaveBeenNthCalledWith(1, '1M')
    expect(onExpand).toHaveBeenNthCalledWith(2, '3M')
  })

  /**
   * Choosing the default and never choosing at all are different facts, and
   * only the second may be overridden by a future default change.
   */
  it('reports null when the reader never chose a window', () => {
    const onExpand = vi.fn()
    render(<PriceContext symbol="MSFT" series={LONG} now={NOW} onExpand={onExpand} />)
    fireEvent.click(screen.getByLabelText('Expand MSFT chart'))
    expect(onExpand).toHaveBeenCalledWith(null)
  })

  it('still offers no expand control when the caller supplies no handler', () => {
    render(<PriceContext symbol="MSFT" series={LONG} now={NOW} />)
    expect(screen.queryByLabelText('Expand MSFT chart')).toBeNull()
  })

  /** The inline selection is this component's own and is not disturbed. */
  it('keeps its selected range after an expand', () => {
    render(<PriceContext symbol="MSFT" series={LONG} now={NOW} onExpand={() => {}} />)
    fireEvent.click(screen.getByText('1M'))
    const before = rangeOf()
    fireEvent.click(screen.getByLabelText('Expand MSFT chart'))
    expect(rangeOf()).toBe(before)
    expect(before).toBe('1M')
  })
})

describe('FullscreenChart opens on the window it was given', () => {
  const open = (initialRange?: RangeKey | null) =>
    render(
      <FullscreenChart
        open
        onClose={() => {}}
        symbol="MSFT"
        series={LONG}
        initialRange={initialRange}
      />,
    )

  it('starts on the range the card handed it', () => {
    open('1M')
    expect(document.querySelector('[data-range]')?.getAttribute('data-range')).toBe('1M')
  })

  it('starts on a different range when handed a different one', () => {
    open('3M')
    expect(document.querySelector('[data-range]')?.getAttribute('data-range')).toBe('3M')
  })

  /**
   * The additive half. Every caller that has not been taught to pass a range
   * must render exactly as it did before this change.
   */
  it('falls back to the shared default when given nothing', () => {
    open(undefined)
    expect(document.querySelector('[data-range]')?.getAttribute('data-range')).toBe('6M')
  })

  it('treats an explicit null as "never chose", i.e. the default', () => {
    open(null)
    expect(document.querySelector('[data-range]')?.getAttribute('data-range')).toBe('6M')
  })

  it('still lets the reader change the window once expanded', () => {
    open('1M')
    fireEvent.click(screen.getByText('1Y'))
    expect(document.querySelector('[data-range]')?.getAttribute('data-range')).toBe('1Y')
  })
})

/**
 * There is ONE list of ranges and it lives in `PriceContext`. If a second one
 * were ever introduced, the inline chart and the expanded chart would offer
 * different windows for the same series — which is precisely the drift the
 * Trade Idea price pane hit when it was handed a pre-sliced series.
 */
describe('one horizon list, not two', () => {
  it('offers the same windows inline and expanded for the same series', () => {
    const { unmount } = render(<PriceContext symbol="MSFT" series={LONG} now={NOW} />)
    const inline = [...document.querySelectorAll('[data-testid="price-ranges"] button')]
      .map(b => b.textContent).filter(Boolean)
    unmount()

    render(<FullscreenChart open onClose={() => {}} symbol="MSFT" series={LONG} />)
    const expanded = [...document.querySelectorAll('[data-testid="price-ranges"] button')]
      .map(b => b.textContent).filter(Boolean)

    expect(expanded).toEqual(inline)
  })
})
