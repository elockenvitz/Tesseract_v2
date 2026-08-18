import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { CaseEditor, type EditableCase } from '../CaseEditor'

/**
 * Two rules carry these tests.
 *
 * Ownership, because the database enforces it SILENTLY — an update to another
 * analyst's row matches zero rows and returns success, so a UI that offered
 * the control would confirm a write that never landed.
 *
 * And that the arithmetic is visible before anything is saved, because
 * reweighting cases to sum to 100 is the work; the write is the afterthought.
 */

const CASES: EditableCase[] = [
  { id: 'bull', name: 'Bull', price: 300, probability: 50, mine: true },
  { id: 'base', name: 'Base', price: 200, probability: 40, mine: true },
  { id: 'bear', name: 'Bear', price: 100, probability: 35, mine: false, authorName: 'Priya Raman' },
]

const setup = (cases = CASES) => {
  const onSaveDraft = vi.fn()
  render(<CaseEditor symbol="PLTR" cases={cases} onSaveDraft={onSaveDraft} />)
  return { onSaveDraft }
}

const rowFor = (name: string) =>
  screen.getAllByTestId('case-row').find(r => within(r).queryByText(name))!

describe('CaseEditor', () => {
  it('offers no control on a case somebody else wrote', () => {
    setup()
    const bear = rowFor('Bear')
    expect(within(bear).queryByTestId('case-prob-up')).toBeNull()
    expect(within(bear).getByTestId('case-readonly').textContent).toMatch(/Priya Raman/)
  })

  it('cannot change another analyst probability by any tap', () => {
    // The silent-RLS case. There is no button, and the sum must not move.
    setup()
    const before = screen.getByTestId('case-editor-sum').textContent
    fireEvent.click(rowFor('Bull').querySelector('[data-testid="case-prob-up"]')!)
    fireEvent.click(rowFor('Bull').querySelector('[data-testid="case-prob-down"]')!)
    expect(screen.getByTestId('case-editor-sum').textContent).toBe(before)
  })

  it('never sends another analyst case in a save', () => {
    const { onSaveDraft } = setup()
    fireEvent.click(within(rowFor('Base')).getByTestId('case-prob-up'))
    fireEvent.click(screen.getByTestId('case-editor-save'))
    const sent = onSaveDraft.mock.calls[0][0] as { id: string }[]
    expect(sent.map(s => s.id)).toEqual(['base'])
  })

  it('recomputes the sum as you tap, before anything is written', () => {
    const { onSaveDraft } = setup()
    // 50 + 40 + 35 = 125, the real AAPL problem.
    expect(screen.getByTestId('case-editor-sum').textContent).toBe('125%')
    fireEvent.click(within(rowFor('Bull')).getByTestId('case-prob-down'))
    expect(screen.getByTestId('case-editor-sum').textContent).toBe('120%')
    expect(onSaveDraft).not.toHaveBeenCalled()
  })

  it('says the expectation is normalised until the probabilities sum to 100', () => {
    setup()
    expect(screen.getByTestId('case-editor-unbalanced').textContent)
      .toMatch(/Sums to 125% — EV is normalised, not stated/)
  })

  it('drops the warning once the cases balance', () => {
    // 50 -> 25 on Bull leaves 25 + 40 + 35 = 100.
    setup()
    const down = within(rowFor('Bull')).getByTestId('case-prob-down')
    for (let i = 0; i < 5; i++) fireEvent.click(down)
    expect(screen.getByTestId('case-editor-sum').textContent).toBe('100%')
    expect(screen.queryByTestId('case-editor-unbalanced')).toBeNull()
  })

  it('moves the expected value with the weights', () => {
    setup()
    const before = screen.getByTestId('case-editor-expected').textContent
    // Shifting weight toward the 300 case must raise it.
    for (let i = 0; i < 4; i++) fireEvent.click(within(rowFor('Bull')).getByTestId('case-prob-up'))
    const after = screen.getByTestId('case-editor-expected').textContent
    expect(Number(after!.replace(/\D/g, ''))).toBeGreaterThan(Number(before!.replace(/\D/g, '')))
  })

  it('cannot save until something actually changed', () => {
    const { onSaveDraft } = setup()
    const save = screen.getByTestId('case-editor-save')
    expect(save).toBeDisabled()
    fireEvent.click(save)
    expect(onSaveDraft).not.toHaveBeenCalled()
  })

  it('will not drive a probability outside 0-100', () => {
    setup([{ id: 'a', name: 'Bull', price: 300, probability: 95, mine: true }])
    const up = screen.getByTestId('case-prob-up')
    for (let i = 0; i < 5; i++) fireEvent.click(up)
    expect(screen.getByTestId('case-prob').textContent).toBe('100%')

    const down = screen.getByTestId('case-prob-down')
    for (let i = 0; i < 30; i++) fireEvent.click(down)
    expect(screen.getByTestId('case-prob').textContent).toBe('0%')
  })

  it('offers nothing to save when no case belongs to the reader', () => {
    setup([
      { id: 'x', name: 'Bull', price: 300, probability: 60, mine: false, authorName: 'Sam' },
      { id: 'y', name: 'Bear', price: 100, probability: 40, mine: false, authorName: 'Sam' },
    ])
    expect(screen.getByTestId('case-editor-save')).toBeDisabled()
    expect(screen.getByTestId('case-editor-save').textContent).toMatch(/Adjust your own cases/)
  })
})
