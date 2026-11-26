/**
 * The codec the Charting page actually uses.
 *
 * `lib/charting/__tests__/workspace-durability.test.ts` proves the durable
 * store works with a codec. This proves the REAL one does -- it exercises
 * `CHARTING_WORKSPACE_CODEC` itself, so a correct store paired with a broken
 * codec cannot read green.
 *
 * The case that matters is the `Date`. `CustomDateRange.startDate` and
 * `.endDate` are real Dates; `JSON.parse(JSON.stringify(d))` returns a
 * string, and a string reaching `ProChart` where a Date belongs throws on
 * `.getTime()`. Without revival, the fix for lost chart state would itself
 * have shipped a broken chart for anyone whose last view used a custom
 * frequency.
 */
import { describe, it, expect } from 'vitest'
import { CHARTING_WORKSPACE_CODEC as codec } from '../../lib/charting/workspace-codec'

/** What the store does between a write and a read. */
const roundTrip = (state: unknown) => codec.fromJSON(JSON.parse(JSON.stringify(codec.toJSON(state as never))))

const panel = {
  id: '1',
  symbol: 'AAPL',
  companyName: 'Apple Inc.',
  chartType: 'candlestick',
  timeFrame: '1Y',
  indicators: ['sma'],
  metric: 'price',
  annotations: [],
  compareSymbols: [],
  displayMode: 'absolute',
}

const workspace = { panels: [panel], activePanel: '1', viewMode: 'single' }

describe('a round trip through storage', () => {
  it('keeps the instrument, timeframe, chart type and indicators', () => {
    const back = roundTrip(workspace)!
    expect(back.panels[0].symbol).toBe('AAPL')
    expect(back.panels[0].timeFrame).toBe('1Y')
    expect(back.panels[0].chartType).toBe('candlestick')
    expect(back.panels[0].indicators).toEqual(['sma'])
    expect(back.activePanel).toBe('1')
  })

  it('keeps drawings, with their anchors intact', () => {
    const drawn = {
      ...workspace,
      panels: [{
        ...panel,
        annotations: [{
          id: 'a1',
          type: 'trend-line',
          startTime: 1_700_000_000,
          startPrice: 180.5,
          endTime: 1_760_000_000,
          endPrice: 352.4,
          style: { color: '#2563eb', lineWidth: 1.5, lineStyle: 'solid' },
        }],
      }],
    }
    const back = roundTrip(drawn)!
    const line = back.panels[0].annotations[0] as { startPrice: number; endTime: number }
    expect(line.startPrice).toBe(180.5)
    expect(line.endTime).toBe(1_760_000_000)
  })

  it('brings a custom range back as Dates the chart can call getTime on', () => {
    const custom = {
      ...workspace,
      panels: [{
        ...panel,
        timeFrame: 'CUSTOM',
        customRange: {
          startDate: new Date('2024-01-02T00:00:00Z'),
          endDate: new Date('2024-06-28T00:00:00Z'),
          interval: '1d',
        },
      }],
    }

    const range = roundTrip(custom)!.panels[0].customRange!
    expect(range.startDate).toBeInstanceOf(Date)
    expect(range.endDate).toBeInstanceOf(Date)
    expect(range.startDate.getTime()).toBe(Date.parse('2024-01-02T00:00:00Z'))
    expect(range.interval).toBe('1d')
    // What ProChart does with it. A string here is the crash.
    expect(() => range.endDate.getTime()).not.toThrow()
  })

  it('drops a custom range it cannot read AND the timeframe that needed it', () => {
    // 'CUSTOM' with no range leaves the page asking for a window it has not got.
    const back = codec.fromJSON({
      panels: [{ ...panel, timeFrame: 'CUSTOM', customRange: { startDate: 'rubbish', endDate: 'rubbish', interval: '1d' } }],
      activePanel: '1',
      viewMode: 'single',
    })!
    expect(back.panels[0].customRange).toBeUndefined()
    expect(back.panels[0].timeFrame).toBe('1M')
  })

  it('drops a custom range with no interval, which the fetch path requires', () => {
    const back = codec.fromJSON({
      panels: [{ ...panel, timeFrame: 'CUSTOM', customRange: { startDate: '2024-01-02T00:00:00Z', endDate: '2024-06-28T00:00:00Z' } }],
      activePanel: '1',
      viewMode: 'single',
    })!
    expect(back.panels[0].customRange).toBeUndefined()
  })
})

describe('what the codec refuses', () => {
  it('rejects anything that is not a workspace', () => {
    for (const bad of [null, undefined, 'string', 42, [], {}, { panels: [] }, { panels: [{}] }]) {
      expect(codec.fromJSON(bad), `accepted ${JSON.stringify(bad)}`).toBeNull()
    }
  })

  it('rejects a workspace whose active panel is not one of its panels', () => {
    // Otherwise the toolbar controls a panel that does not exist.
    expect(codec.fromJSON({ panels: [panel], activePanel: 'gone', viewMode: 'single' })).toBeNull()
  })

  it('falls back on a layout this build has no branch for', () => {
    /* A 'grid-4' stored by a future build must not reach the renderer as a
       layout it cannot draw. */
    expect(codec.fromJSON({ ...workspace, viewMode: 'grid-4' })!.viewMode).toBe('single')
    expect(codec.fromJSON({ ...workspace, viewMode: 'grid' })!.viewMode).toBe('grid')
  })

  it('repairs a panel whose arrays went missing rather than rejecting it', () => {
    /* An older build's panel may not carry `indicators` or `annotations` at
       all. The page maps over both unconditionally, so a missing one is a
       crash -- but the symbol and timeframe are still worth restoring. */
    const back = codec.fromJSON({
      panels: [{ id: '1', symbol: 'MSFT', timeFrame: '6M' }],
      activePanel: '1',
      viewMode: 'single',
    })!
    expect(back.panels[0].symbol).toBe('MSFT')
    expect(back.panels[0].indicators).toEqual([])
    expect(back.panels[0].annotations).toEqual([])
  })
})
