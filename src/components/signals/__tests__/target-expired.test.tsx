import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'

import { TargetExpiredPanes } from '../TargetExpiredPanes'
import { ReviseTargetEditor } from '../ReviseTargetEditor'
import { resolvePriceSnapshot } from '../../../lib/signals/price-snapshot'
import type { VerdictOption } from '../VerdictBar'

/**
 * The card, composed exactly as the feed and the gallery compose it.
 *
 * `TargetExpiredPanes` is the shared core — the fetch is the only part either
 * caller supplies — so asserting against it is asserting against what ships,
 * not against a fixture assembled for the test.
 */

const CLOSES = [
  { date: '2026-08-20', close: 341.10 },
  { date: '2026-08-21', close: 345.02 },
  { date: '2026-08-24', close: 348.06 },
]
/** The holdings mark that used to be shown as "current". */
const BOOK_MARK = 142.80
const TARGET = 245

const SUBJECT = {
  symbol: 'GOOGL',
  target: TARGET,
  timeframe: '6 months',
  statedAt: '2025-02-14T00:00:00.000Z',
  expiredAt: '2025-08-13T00:00:00.000Z',
}

function renderCard(over: Partial<Parameters<typeof TargetExpiredPanes>[0]> = {}) {
  const handlers = {
    onRespond: vi.fn(() => true),
    onSaveTarget: vi.fn(),
    onOpenCases: vi.fn(),
    onAddNote: vi.fn(),
  }
  const snapshot = resolvePriceSnapshot({
    closes: CLOSES, holdingsMark: BOOK_MARK, holdingsAsOf: '2026-04-21',
  })
  const seen: { panes: string[]; primary: unknown }[] = []
  render(
    <TargetExpiredPanes
      subject={SUBJECT}
      question="Is this target still your view?"
      snapshot={snapshot}
      pricePane={<div data-testid="fixture-chart">{snapshot!.price.toFixed(2)}</div>}
      {...handlers}
      {...over}
    >
      {({ panes, primaryOverride, onPaneChange }) => {
        seen.push({ panes: panes.map(p => p.id), primary: primaryOverride })
        return (
          <div>
            <button data-testid="go-review" onClick={() => onPaneChange('verdict')}>review</button>
            <button data-testid="go-price" onClick={() => onPaneChange('price')}>price</button>
            <div data-testid="footer-primary">
              {primaryOverride ? primaryOverride.label : 'CARD_DEFAULT'}
            </div>
            <div data-testid="footer-disabled">{String(primaryOverride?.disabled ?? false)}</div>
            {panes.map(p => <div key={p.id} data-pane={p.id}>{p.content}</div>)}
          </div>
        )
      }}
    </TargetExpiredPanes>,
  )
  return { ...handlers, seen, snapshot }
}

describe('three panes, not four', () => {
  it('is PRICE, HORIZON, REVIEW — with no standing target editor', () => {
    const { seen } = renderCard()
    expect(seen[0].panes).toEqual(['price', 'horizon', 'verdict'])
    // The editor is behind the choice that asks for it, not a peer of the chart.
    expect(screen.queryByTestId('revise-target')).toBeNull()
  })
})

describe('one price, everywhere on the card', () => {
  it('shows the chart price in the editor, not the holdings mark', async () => {
    const { onRespond } = renderCard()
    expect(screen.getByTestId('fixture-chart').textContent).toBe('348.06')

    fireEvent.click(screen.getByRole('radio', { name: 'Revise target' }))
    fireEvent.click(screen.getByTestId('verdict-send'))
    await waitFor(() => expect(onRespond).toHaveBeenCalled())

    const shown = await screen.findByTestId('revise-current-price')
    // The whole defect, as one assertion: the editor read $142.80 under a chart
    // ending at $348.06, and called it CURRENT PRICE.
    expect(shown.textContent).toBe('$348.06')
    expect(shown.textContent).not.toContain(String(BOOK_MARK))
    expect(shown.getAttribute('data-price-source')).toBe('close')
  })

  it('derives the deviation from that same price', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Revise target' }))
    fireEvent.click(screen.getByTestId('verdict-send'))
    await screen.findByTestId('revise-deviation')

    const expected = ((TARGET - 348.06) / 348.06) * 100
    expect(screen.getByTestId('revise-deviation').textContent)
      .toContain(`${expected.toFixed(1)}%`)
    // Against the book mark this read "+71.6%", and the card showed both.
    expect(screen.getByTestId('revise-deviation').textContent).not.toContain('71.6')
  })

  it('labels a holdings fallback as a book mark, never as current', () => {
    const snapshot = resolvePriceSnapshot({
      closes: [], holdingsMark: BOOK_MARK, holdingsAsOf: '2026-04-21',
    })
    render(
      <ReviseTargetEditor
        symbol="GOOGL" snapshot={snapshot} recordedTarget={TARGET}
        expiredHorizon="6 months" onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('revise-current-price').getAttribute('data-price-source'))
      .toBe('holdings')
    // Named in the row heading AND in the deviation line, so both places the
    // reader could mistake it for a live quote say what it is.
    expect(screen.getAllByText(/book mark/i).length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/^current price$/i)).toBeNull()
  })
})

describe('the percentage chips say what they are relative to', () => {
  it('names the reference above them, and computes off it', () => {
    render(
      <ReviseTargetEditor
        symbol="GOOGL"
        snapshot={resolvePriceSnapshot({ closes: CLOSES })}
        recordedTarget={TARGET} expiredHorizon="6 months" onSave={vi.fn()}
      />,
    )
    // "−20% −10% +10% +20% +50%" with no stated reference is three plausible
    // meanings and no way to tell which.
    expect(screen.getByText(/from current price/i)).toBeTruthy()

    fireEvent.click(screen.getByTestId('revise-chips').querySelector('[data-revise-chip="20"]')!)
    expect((screen.getByTestId('revise-target-input') as HTMLInputElement).value)
      .toBe((348.06 * 1.2).toFixed(2))
  })
})

describe('a revision must carry a fresh horizon', () => {
  it('will not save a new price against the expired clock', () => {
    const onSave = vi.fn()
    render(
      <ReviseTargetEditor
        symbol="GOOGL" snapshot={resolvePriceSnapshot({ closes: CLOSES })}
        recordedTarget={TARGET} expiredHorizon="6 months" onSave={onSave}
      />,
    )
    fireEvent.change(screen.getByTestId('revise-target-input'), { target: { value: '400' } })
    fireEvent.click(screen.getByTestId('revise-save'))
    // Saving the price alone changes none of the signal's inputs, so the card
    // would return saying exactly what it said before.
    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByTestId('revise-horizon-required')).toBeTruthy()
  })

  it('saves price and horizon together once one is chosen', () => {
    const onSave = vi.fn()
    render(
      <ReviseTargetEditor
        symbol="GOOGL" snapshot={resolvePriceSnapshot({ closes: CLOSES })}
        recordedTarget={TARGET} expiredHorizon="6 months" onSave={onSave}
      />,
    )
    fireEvent.change(screen.getByTestId('revise-target-input'), { target: { value: '400' } })
    fireEvent.click(screen.getByTestId('revise-horizons').querySelector('[data-revise-horizon="12 months"]')!)
    fireEvent.click(screen.getByTestId('revise-save'))
    expect(onSave).toHaveBeenCalledWith({ target: 400, horizon: '12 months' })
  })
})

describe('the four review paths', () => {
  it('"Still valid" refreshes the horizon and keeps the number', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Still valid' }))
    expect(screen.getByTestId('verdict-consequence').textContent).toMatch(/pick a new one/i)
    expect(screen.getByTestId('verdict-send').textContent).toBe('Refresh view')

    fireEvent.click(screen.getByTestId('verdict-send'))
    expect((await screen.findByTestId('target-review-editor')).getAttribute('data-surface'))
      .toBe('refresh_horizon')
    // The price view is kept as it is: only the clock is being restated.
    expect(screen.queryByTestId('revise-target-input')).toBeNull()
    expect(screen.getByTestId('revise-horizons')).toBeTruthy()
  })

  it('"Revise target" opens the compact editor with all four fields', async () => {
    renderCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Revise target' }))
    expect(screen.getByTestId('verdict-send').textContent).toBe('Edit target')
    fireEvent.click(screen.getByTestId('verdict-send'))

    expect(await screen.findByTestId('revise-current-price')).toBeTruthy()
    expect(screen.getByTestId('revise-old-target').textContent).toContain('$245.00')
    expect(screen.getByTestId('revise-target-input')).toBeTruthy()
    expect(screen.getByTestId('revise-horizons')).toBeTruthy()
  })

  it('"Replace with cases" opens the existing scenario editor', async () => {
    const { onOpenCases } = renderCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Replace with cases' }))
    expect(screen.getByTestId('verdict-send').textContent).toBe('Build cases')
    fireEvent.click(screen.getByTestId('verdict-send'))
    await waitFor(() => expect(onOpenCases).toHaveBeenCalledTimes(1))
    // Not an inline editor: the Bull / Base / Bear ladder already exists.
    expect(screen.queryByTestId('target-review-editor')).toBeNull()
  })

  it('"Needs review" opens a note and keeps the signal', async () => {
    const { onAddNote, onRespond } = renderCard()
    fireEvent.click(screen.getByRole('radio', { name: 'Needs review' }))
    expect(screen.getByTestId('verdict-send').textContent).toBe('Add review note')
    expect(screen.getByTestId('verdict-send').textContent).not.toBe('Write it down')
    fireEvent.click(screen.getByTestId('verdict-send'))

    await waitFor(() => expect(onAddNote).toHaveBeenCalledTimes(1))
    const recorded = (onRespond as ReturnType<typeof vi.fn>).mock.calls[0][0] as VerdictOption
    // `flagged` is never suppressed, so the card stays.
    expect(recorded.disposition).toBe('flagged')
  })

  it('gives each path its own sentence', () => {
    renderCard()
    const seen = new Set<string>()
    for (const label of ['Still valid', 'Revise target', 'Replace with cases', 'Needs review']) {
      fireEvent.click(screen.getByRole('radio', { name: label }))
      const copy = screen.getByTestId('verdict-consequence')
      expect(copy.getAttribute('data-consequence-source')).toBe('option')
      seen.add(copy.textContent!)
    }
    expect(seen.size).toBe(4)
  })
})

describe('the sticky footer is contextual', () => {
  it('leaves the card default on the evidence panes', () => {
    renderCard()
    expect(screen.getByTestId('footer-primary').textContent).toBe('CARD_DEFAULT')
  })

  it('stops offering "Review target" once the reader is on REVIEW', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    expect(screen.getByTestId('footer-primary').textContent).not.toMatch(/review target/i)
    // Nothing chosen yet: it says what is needed and does nothing.
    expect(screen.getByTestId('footer-disabled').textContent).toBe('true')
  })

  it('becomes the selected resolution\'s own action', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    fireEvent.click(screen.getByRole('radio', { name: 'Replace with cases' }))
    expect(screen.getByTestId('footer-primary').textContent).toBe('Build cases')
    expect(screen.getByTestId('footer-disabled').textContent).toBe('false')

    fireEvent.click(screen.getByRole('radio', { name: 'Needs review' }))
    expect(screen.getByTestId('footer-primary').textContent).toBe('Add review note')
  })

  it('goes back to the card default when the reader returns to the evidence', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    fireEvent.click(screen.getByTestId('go-price'))
    expect(screen.getByTestId('footer-primary').textContent).toBe('CARD_DEFAULT')
  })
})

describe('the horizon pane', () => {
  it('keeps set, due and today, and the two durations', () => {
    renderCard()
    const pane = document.querySelector('[data-pane="horizon"]')!
    expect(within(pane as HTMLElement).getByText(/^set /)).toBeTruthy()
    expect(within(pane as HTMLElement).getByText(/^due /)).toBeTruthy()
    expect(within(pane as HTMLElement).getByText('today')).toBeTruthy()
    expect(pane.querySelector('[data-horizon-segment="honoured"]')!.textContent).toBe('6 months')
    expect(pane.querySelector('[data-horizon-segment="overdue"]')!.textContent).toMatch(/^\+/)
  })

  it('reads "6-month view", and gives no tap instructions', () => {
    renderCard()
    const readout = document.querySelector('[data-pane="horizon"] [data-testid="horizon-readout"]')!
    expect(readout.textContent).toContain('A 6-month view')
    expect(readout.textContent).not.toContain('6 months view')
    expect(readout.textContent).not.toMatch(/tap either block/i)
  })
})
