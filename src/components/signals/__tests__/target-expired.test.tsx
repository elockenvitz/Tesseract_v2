import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { TargetExpiredPanes, type TargetResolution } from '../TargetExpiredPanes'
import { ReviseTargetEditor } from '../ReviseTargetEditor'
import { resolvePriceSnapshot } from '../../../lib/signals/price-snapshot'

/**
 * The state machine, not the pixels.
 *
 * The property every test here defends: **entering or abandoning a workflow
 * must never alter an investment view.** The version this replaces recorded the
 * judgment when the reader picked an answer and opened the editor afterwards,
 * so choosing "Keep target" and backing out wrote a `settled` disposition that
 * suppressed the card for ninety days over a still-expired view.
 */

const CLOSES = [
  { date: '2026-08-21', close: 345.02 },
  { date: '2026-08-24', close: 348.06 },
]
const BOOK_MARK = 142.80
const TARGET = 245

const SUBJECT = {
  symbol: 'GOOGL',
  target: TARGET,
  timeframe: '6 months',
  statedAt: '2025-02-14T00:00:00.000Z',
  expiredAt: '2025-08-13T00:00:00.000Z',
}

function renderCard(over: { onCommit?: any; onOpenCases?: any } = {}) {
  const onCommit = over.onCommit ?? vi.fn(async () => true)
  const onOpenCases = over.onOpenCases ?? vi.fn()
  const snapshot = resolvePriceSnapshot({
    closes: CLOSES, holdingsMark: BOOK_MARK, holdingsAsOf: '2026-04-21',
  })
  render(
    <TargetExpiredPanes
      subject={SUBJECT}
      question="What should happen to this target?"
      snapshot={snapshot}
      pricePane={<div data-testid="fixture-chart">{snapshot!.price.toFixed(2)}</div>}
      onCommit={onCommit}
      onOpenCases={onOpenCases}
    >
      {({ panes, primaryOverride, onPaneChange }) => (
        <div>
          <button data-testid="go-review" onClick={() => onPaneChange('verdict')}>review</button>
          <button data-testid="go-price" onClick={() => onPaneChange('price')}>price</button>
          <button
            data-testid="footer-primary"
            disabled={primaryOverride?.disabled}
            onClick={() => primaryOverride?.run?.()}
          >
            {primaryOverride ? primaryOverride.label : 'CARD_DEFAULT'}
          </button>
          <div data-testid="pane-ids">{panes.map(p => p.id).join(',')}</div>
          {panes.map(p => <div key={p.id} data-pane={p.id}>{p.content}</div>)}
        </div>
      )}
    </TargetExpiredPanes>,
  )
  return { onCommit, onOpenCases }
}

const pick = (label: string) => fireEvent.click(screen.getByRole('radio', { name: label }))
const primary = () => screen.getByTestId('footer-primary')

describe('two panes, not three', () => {
  it('is PRICE and REVIEW — the horizon pane is gone', () => {
    renderCard()
    // THEN vs NOW was the considered replacement and the data does not support
    // it: only 20 of 30 fixed targets have a cached close on or before their
    // set date. Two useful panes beat three where one is filler.
    expect(screen.getByTestId('pane-ids').textContent).toBe('price,verdict')
  })
})

describe('selection mutates nothing', () => {
  it('records no judgment when an answer is picked', () => {
    const { onCommit } = renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    for (const label of ['Keep target', 'Revise target', 'Replace with cases', 'Review later']) {
      pick(label)
    }
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('opening the horizon editor is not completing the action', () => {
    const { onCommit } = renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Keep target')
    fireEvent.click(primary())
    expect(screen.getByTestId('target-review-editor')).toBeTruthy()
    // The critical regression: this used to have already written a `settled`
    // disposition, hiding the card for 90 days.
    expect(onCommit).not.toHaveBeenCalled()
  })

  it('cancelling the editor mutates nothing and keeps the answer and note', () => {
    const { onCommit } = renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    fireEvent.change(screen.getByTestId('target-review-note'), { target: { value: 'still holds' } })
    pick('Keep target')
    fireEvent.click(primary())
    fireEvent.click(screen.getByTestId('target-review-back'))

    expect(onCommit).not.toHaveBeenCalled()
    // Selection survives, so the footer still offers the same action.
    expect(primary().textContent).toBe('Refresh horizon')
    expect((screen.getByTestId('target-review-note') as HTMLInputElement).value).toBe('still holds')
  })

  it('opening the case ladder is not resolving it', () => {
    const { onCommit, onOpenCases } = renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Replace with cases')
    fireEvent.click(primary())
    expect(onOpenCases).toHaveBeenCalledTimes(1)
    // The sheet commits on save; opening it writes nothing.
    expect(onCommit).not.toHaveBeenCalled()
  })
})

describe('the footer is the only primary', () => {
  it('offers nothing actionable until an answer is chosen', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    expect(primary().textContent).toBe('Choose an answer')
    expect(primary()).toBeDisabled()
  })

  it('becomes the chosen answer CTA', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    for (const [label, cta] of [
      ['Keep target', 'Refresh horizon'],
      ['Revise target', 'Revise target'],
      ['Replace with cases', 'Review cases'],
      ['Review later', 'Keep open'],
    ] as const) {
      pick(label)
      expect(primary().textContent, label).toBe(cta)
    }
  })

  it('the review body carries no commit button of its own', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Keep target')
    // One primary mechanism. The duplicate inline "Refresh view" is gone.
    const pane = document.querySelector('[data-pane="verdict"]')!
    expect(pane.querySelector('[data-testid="verdict-send"]')).toBeNull()
  })

  it('returns to the card default on the evidence pane', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Keep target')
    fireEvent.click(screen.getByTestId('go-price'))
    expect(primary().textContent).toBe('CARD_DEFAULT')
  })
})

describe('the note is stable and travels with the action', () => {
  it('keeps its position and changes only its prompt', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    const field = () => screen.getByTestId('target-review-note') as HTMLInputElement
    pick('Keep target')
    expect(field().placeholder).toMatch(/why does the view still hold/i)
    pick('Revise target')
    expect(field().placeholder).toMatch(/what changed/i)
    pick('Review later')
    expect(field().placeholder).toMatch(/what still needs work/i)
  })

  it('is submitted with the judgment, not as a separate record', async () => {
    const { onCommit } = renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    fireEvent.change(screen.getByTestId('target-review-note'), { target: { value: 'revisit in Q4' } })
    pick('Review later')
    fireEvent.click(primary())
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const r = onCommit.mock.calls[0][0] as TargetResolution
    expect(r.note).toBe('revisit in Q4')
    expect(r.choice.key).toBe('target_needs_review')
    // Review later touches no number.
    expect(r.value).toBeUndefined()
  })
})

describe('save semantics', () => {
  it('commits the target and horizon together on a successful save', async () => {
    const { onCommit } = renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Revise target')
    fireEvent.click(primary())
    fireEvent.change(screen.getByTestId('revise-target-input'), { target: { value: '400' } })
    fireEvent.click(document.querySelector('[data-revise-horizon="12 months"]')!)
    fireEvent.click(screen.getByTestId('revise-save'))

    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
    const r = onCommit.mock.calls[0][0] as TargetResolution
    expect(r.choice.key).toBe('target_revise')
    expect(r.value).toEqual({ target: 400, horizon: '12 months' })
  })

  it('keeps the editor open with values intact when the save fails', async () => {
    const onCommit = vi.fn(async () => false)
    renderCard({ onCommit })
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Revise target')
    fireEvent.click(primary())
    fireEvent.change(screen.getByTestId('revise-target-input'), { target: { value: '400' } })
    fireEvent.click(document.querySelector('[data-revise-horizon="12 months"]')!)
    fireEvent.click(screen.getByTestId('revise-save'))

    await waitFor(() => expect(screen.getByTestId('revise-error')).toBeTruthy())
    // Still open, still holding what was typed, signal still unresolved.
    expect(screen.getByTestId('target-review-editor')).toBeTruthy()
    expect((screen.getByTestId('revise-target-input') as HTMLInputElement).value).toBe('400')
  })

  it('fires one mutation on a double tap', async () => {
    let resolve: (v: boolean) => void = () => {}
    const onCommit = vi.fn(() => new Promise<boolean>(r => { resolve = r }))
    renderCard({ onCommit })
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Review later')
    fireEvent.click(primary())
    fireEvent.click(primary())
    fireEvent.click(primary())
    expect(onCommit).toHaveBeenCalledTimes(1)
    resolve(true)
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1))
  })

  it('will not save a revision without a fresh horizon', () => {
    const onSave = vi.fn()
    render(
      <ReviseTargetEditor
        symbol="GOOGL" snapshot={resolvePriceSnapshot({ closes: CLOSES })}
        recordedTarget={TARGET} expiredHorizon="6 months" onSave={onSave}
      />,
    )
    fireEvent.change(screen.getByTestId('revise-target-input'), { target: { value: '400' } })
    fireEvent.click(screen.getByTestId('revise-save'))
    // A new number under a dead clock changes none of the signal's inputs.
    expect(onSave).not.toHaveBeenCalled()
  })

  it('keeps the number read-only when the answer is keep target', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Keep target')
    fireEvent.click(primary())
    expect(screen.getByTestId('target-review-editor').getAttribute('data-surface'))
      .toBe('refresh_horizon')
    expect(screen.queryByTestId('revise-target-input')).toBeNull()
    expect(screen.getByTestId('revise-horizons')).toBeTruthy()
  })
})

describe('one canonical price', () => {
  it('the editor shows the chart price, not the holdings mark', () => {
    renderCard()
    expect(screen.getByTestId('fixture-chart').textContent).toBe('348.06')
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Revise target')
    fireEvent.click(primary())
    const shown = screen.getByTestId('revise-current-price')
    expect(shown.textContent).toBe('$348.06')
    expect(shown.textContent).not.toContain(String(BOOK_MARK))
    expect(shown.getAttribute('data-price-source')).toBe('close')
  })

  it('derives the deviation from that same price', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('go-review'))
    pick('Revise target')
    fireEvent.click(primary())
    const expected = ((TARGET - 348.06) / 348.06) * 100
    expect(screen.getByTestId('revise-deviation').textContent).toContain(`${expected.toFixed(1)}%`)
  })

  it('names a holdings fallback as a book mark, never as current', () => {
    render(
      <ReviseTargetEditor
        symbol="GOOGL"
        snapshot={resolvePriceSnapshot({ closes: [], holdingsMark: BOOK_MARK, holdingsAsOf: '2026-04-21' })}
        recordedTarget={TARGET} expiredHorizon="6 months" onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('revise-current-price').getAttribute('data-price-source')).toBe('holdings')
    expect(screen.queryByText(/^current price$/i)).toBeNull()
  })
})
