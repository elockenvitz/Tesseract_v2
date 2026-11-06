/**
 * What the card has to get right for the history panel.
 *
 * Two things, and they are a pair: it must tell the panel whether it is the
 * visible face (otherwise the gate added to `CaseHistory` is never closed),
 * and it must tell the panel when a save has produced a new history row
 * (otherwise removing the 500ms poll loses freshness). The panel is stubbed
 * here so that the prop and the invalidation are what is observed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const panel = vi.hoisted(() => ({ activeStates: [] as boolean[] }))

vi.mock('../CaseHistory', () => ({
  CaseHistory: ({ active }: { active: boolean }) => {
    panel.activeStates.push(active)
    return <div data-testid="case-history" />
  },
}))

/** Stubbed so a save is one click, not a trip through an editing affordance. */
vi.mock('../EditableField', () => ({
  EditableField: ({ onSave, placeholder }: { onSave: (v: string) => void; placeholder?: string }) => (
    <button data-testid={`save-${placeholder}`} onClick={() => onSave('42')}>save</button>
  ),
}))

vi.mock('../TimeHorizonSelector', () => ({
  TimeHorizonSelector: ({ onSave }: { onSave: (v: string) => void }) => (
    <button data-testid="save-timeframe" onClick={() => onSave('12m')}>save</button>
  ),
}))

import { CaseCard } from '../CaseCard'

const PT = { id: 'price-target-1', price: '100', timeframe: '6m', reasoning: 'because' }

function mount(onPriceTargetSave = vi.fn().mockResolvedValue(undefined)) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
  const view = render(
    <QueryClientProvider client={queryClient}>
      <CaseCard caseType="bull" priceTarget={PT} onPriceTargetSave={onPriceTargetSave} />
    </QueryClientProvider>
  )
  return { ...view, invalidate, onPriceTargetSave }
}

beforeEach(() => {
  panel.activeStates.length = 0
})

describe('the card tells the panel whether it is showing', () => {
  it('starts the panel inactive', () => {
    mount()
    /* The panel is mounted from the first render, off screen behind a
       transform. If this were ever true by default the gate would do nothing. */
    expect(panel.activeStates[0]).toBe(false)
  })

  it('activates the panel when the history button is used', async () => {
    const { getByTitle } = mount()
    await act(async () => {
      getByTitle('View bull case history').click()
    })
    expect(panel.activeStates.at(-1)).toBe(true)
  })

  it('deactivates it again on the way back', async () => {
    const { getByTitle } = mount()
    await act(async () => {
      getByTitle('View bull case history').click()
    })
    await act(async () => {
      getByTitle('Back to price target').click()
    })
    expect(panel.activeStates.at(-1)).toBe(false)
  })
})

describe('a save refreshes the history instead of a timer noticing', () => {
  it('invalidates the exact history key after the save resolves', async () => {
    const { getByTestId, invalidate } = mount()
    await act(async () => {
      getByTestId('save-Set price').click()
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['case-history', 'price-target-1', 'bull'],
    })
  })

  it('still performs the save itself, with the original arguments', async () => {
    const { getByTestId, onPriceTargetSave } = mount()
    await act(async () => {
      getByTestId('save-Set price').click()
    })
    expect(onPriceTargetSave).toHaveBeenCalledWith('bull', 'price', '42')
  })

  it('refreshes after a timeframe save too', async () => {
    const { getByTestId, invalidate, onPriceTargetSave } = mount()
    await act(async () => {
      getByTestId('save-timeframe').click()
    })
    expect(onPriceTargetSave).toHaveBeenCalledWith('bull', 'timeframe', '12m')
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['case-history', 'price-target-1', 'bull'],
    })
  })

  it('refreshes after a reasoning save too', async () => {
    const { getByTestId, invalidate } = mount()
    await act(async () => {
      getByTestId('save-Add reasoning...').click()
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['case-history', 'price-target-1', 'bull'],
    })
  })

  it('does not invalidate before the save has resolved', async () => {
    /* The history row is written by a trigger on `price_targets`, so
       invalidating first would refetch the rows as they were and then stop. */
    let release: () => void = () => {}
    const pending = new Promise<void>(resolve => { release = resolve })
    const save = vi.fn().mockReturnValue(pending)
    const { getByTestId, invalidate } = mount(save)

    await act(async () => {
      getByTestId('save-Set price').click()
    })
    expect(invalidate).not.toHaveBeenCalled()

    await act(async () => {
      release()
      await pending
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['case-history', 'price-target-1', 'bull'],
    })
  })
})
