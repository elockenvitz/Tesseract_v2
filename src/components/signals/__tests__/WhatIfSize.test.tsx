import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import { WhatIfSize } from '../WhatIfSize'

/**
 * The rule under test is not "does it stage" — it is "can it stage by
 * accident". Exploration must be free and committing must require sustained
 * intent, so every one of these asserts a write that must NOT happen.
 */
describe('WhatIfSize', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const setup = () => {
    const onStage = vi.fn()
    render(
      <WhatIfSize symbol="NVDA" currentPct={3.75} benchmarkPct={8.14}
        benchmarkNote="SPY proxy · Aug 14" onStage={onStage} />,
    )
    return { onStage }
  }

  it('writes nothing while dragging', () => {
    const { onStage } = setup()
    const slider = screen.getByTestId('what-if-slider')
    fireEvent.change(slider, { target: { value: '6.5' } })
    fireEvent.change(slider, { target: { value: '2.0' } })
    expect(onStage).not.toHaveBeenCalled()
  })

  it('writes nothing on a tap', () => {
    // The commit is onPointerDown/Up, never onClick — a reflex tap on a card
    // in a scrolling feed must not stage a trade.
    const { onStage } = setup()
    fireEvent.change(screen.getByTestId('what-if-slider'), { target: { value: '6.5' } })
    fireEvent.click(screen.getByTestId('what-if-stage'))
    expect(onStage).not.toHaveBeenCalled()
  })

  it('writes nothing when the hold is released early', () => {
    const { onStage } = setup()
    fireEvent.change(screen.getByTestId('what-if-slider'), { target: { value: '6.5' } })
    const btn = screen.getByTestId('what-if-stage')
    fireEvent.pointerDown(btn)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.pointerUp(btn)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onStage).not.toHaveBeenCalled()
  })

  it('writes nothing when the pointer leaves mid-hold', () => {
    // A thumb sliding off the button during a feed scroll is the commonest
    // accidental-commit path on a phone.
    const { onStage } = setup()
    fireEvent.change(screen.getByTestId('what-if-slider'), { target: { value: '6.5' } })
    const btn = screen.getByTestId('what-if-stage')
    fireEvent.pointerDown(btn)
    act(() => { vi.advanceTimersByTime(300) })
    fireEvent.pointerLeave(btn)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onStage).not.toHaveBeenCalled()
  })

  it('cannot stage the value it already has', () => {
    const { onStage } = setup()
    const btn = screen.getByTestId('what-if-stage')
    expect(btn).toBeDisabled()
    fireEvent.pointerDown(btn)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(onStage).not.toHaveBeenCalled()
  })

  it('DOES stage after a sustained hold', async () => {
    // Every other case here asserts a write that must not happen, so all of
    // them would pass if committing were broken outright — the same shape as a
    // gate that reports success while checking nothing. This is the one that
    // proves the control can actually write.
    //
    // Real timers: the hold is driven by requestAnimationFrame, which fake
    // timers do not advance.
    vi.useRealTimers()
    const onStage = vi.fn()
    render(
      <WhatIfSize symbol="NVDA" currentPct={3.75} benchmarkPct={8.14} onStage={onStage} />,
    )
    fireEvent.change(screen.getByTestId('what-if-slider'), { target: { value: '6.5' } })
    fireEvent.pointerDown(screen.getByTestId('what-if-stage'))
    await new Promise(r => setTimeout(r, 1100))
    expect(onStage).toHaveBeenCalledTimes(1)
    expect(onStage).toHaveBeenCalledWith(6.5)
  })

  it('states the number it is about to write, on the control', () => {
    setup()
    fireEvent.change(screen.getByTestId('what-if-slider'), { target: { value: '6.5' } })
    // The proposal has to be legible at the moment of committing, not inferred
    // from a slider position.
    expect(screen.getByText('Hold to stage 6.50%')).toBeTruthy()
  })
})
