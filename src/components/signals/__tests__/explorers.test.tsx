import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, within } from '@testing-library/react'

import { TargetExplorer } from '../TargetExplorer'
import { CaseExplorer } from '../CaseExplorer'
import { SizeExplorer } from '../SizeExplorer'

/**
 * The three explorers are one interaction wearing three sets of labels, so
 * these assert the shared guarantees once per control: which number is which,
 * that dragging never writes, and that typing works where a slider cannot.
 */

const slot = (c: HTMLElement, name: string) => c.querySelector(`[data-slot="${name}"]`) as HTMLElement
const text = (c: HTMLElement, name: string) => slot(c, name)?.textContent ?? ''
/**
 * Drive the real gesture.
 *
 * The track is a pointer-driven element, not an `<input type="range">`, so
 * there is no `value` to set — which is the point: the old control quantised
 * before the reader saw it and did nothing on a tap. jsdom reports a zero-width
 * rect, so the track is given one and the x position is computed from the value
 * exactly as the component does in reverse.
 */
const drag = (c: HTMLElement, to: number) => {
  const track = slot(c, 'slider')
  const min = Number(track.getAttribute('aria-valuemin'))
  const max = Number(track.getAttribute('aria-valuemax'))
  const WIDTH = 300
  track.getBoundingClientRect = () => ({
    left: 0, right: WIDTH, width: WIDTH, top: 0, bottom: 44, height: 44, x: 0, y: 0, toJSON: () => ({}),
  }) as DOMRect
  const clientX = ((to - min) / (max - min)) * WIDTH
  fireEvent.pointerDown(track, { clientX, pointerId: 1 })
  fireEvent.pointerUp(track, { clientX, pointerId: 1 })
}

describe('target: current, recorded and proposed are never ambiguous', () => {
  const setup = (recorded: number | null = 210) => {
    const onSave = vi.fn()
    const r = render(
      <TargetExplorer symbol="AAPL" currentPrice={182.4} recordedTarget={recorded} onSave={onSave} />,
    )
    return { ...r, onSave }
  }

  it('labels the market price and the saved target separately', () => {
    const { container } = setup()
    expect(text(container, 'reference')).toContain('Current')
    expect(text(container, 'reference')).toContain('182.40')
    expect(text(container, 'recorded')).toContain('Recorded target')
    expect(text(container, 'recorded')).toContain('210.00')
  })

  it('shows no proposal until one exists', () => {
    /**
     * The Proposed slot is always present now — it IS the editor, and the
     * three values belong on one line. What says whether anything is being
     * explored is its consequence line and the commit controls, both of which
     * exist only once there is a proposal.
     */
    const { container } = setup()
    expect(slot(container, 'proposed-secondary')).toBeNull()
    expect(slot(container, 'save')).toBeNull()
    drag(container, 225)
    expect(text(container, 'proposed')).toContain('Proposed')
    // The VALUE lives on the editable control — one number, in the one place
    // you change it. Two places showing it was the reported confusion.
    expect(text(container, 'value-tap')).toContain('225')
  })

  it('states upside against the current price', () => {
    const { container } = setup()
    expect(text(container, 'recorded-secondary')).toContain('%')
    expect(text(container, 'recorded-secondary')).toContain('vs current')
  })

  it('says nothing about upside when there is no price', () => {
    /**
     * 68 of 912 assets have a current price. Claiming the upside is flat is a
     * number somebody could act on.
     */
    const { container } = render(
      <TargetExplorer symbol="X" currentPrice={null} recordedTarget={210} onSave={vi.fn()} />,
    )
    expect(slot(container, 'recorded-secondary')).toBeNull()
  })

  it('does not save on a drag', () => {
    // Exploration must be distinguishable from committed state, and dragging
    // a slider is not a decision.
    const { container, onSave } = setup()
    drag(container, 300)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('saves only what was proposed, and only when asked', () => {
    const { container, onSave } = setup()
    drag(container, 240)
    fireEvent.click(slot(container, 'save'))
    expect(onSave).toHaveBeenCalledWith(240)
  })

  it('offers no save or cancel until something has changed', () => {
    const { container } = setup()
    expect(slot(container, 'save')).toBeNull()
    expect(slot(container, 'cancel')).toBeNull()
  })

  it('cancels back to the recorded value', () => {
    const { container } = setup()
    drag(container, 300)
    fireEvent.click(slot(container, 'cancel'))
    expect(slot(container, 'proposed-secondary')).toBeNull()
    expect(text(container, 'recorded')).toContain('210')
  })

  it('resets an untargeted name to the current price rather than to zero', () => {
    // Through Cancel. There used to be a `reset` button beside it calling the
    // identical handler on the identical condition — two labels for one action,
    // on a row too tight to hold the figures that belong there.
    const { container } = setup(null)
    expect(text(container, 'recorded')).toContain('None set')
    drag(container, 300)
    fireEvent.click(slot(container, 'cancel'))
    expect(slot(container, 'proposed-secondary')).toBeNull()
  })

  it('offers one way to undo, not two', () => {
    const { container } = setup(null)
    drag(container, 300)
    expect(slot(container, 'cancel')).toBeTruthy()
    expect(slot(container, 'reset')).toBeNull()
  })

  it('accepts an exact number typed in', () => {
    // A slider on a phone is 300px wide and a dollar is a pixel; it cannot
    // express "two hundred and ten exactly" and never will.
    const { container } = setup()
    fireEvent.click(slot(container, 'value-tap'))
    fireEvent.change(slot(container, 'value-input'), { target: { value: '$233.75' } })
    fireEvent.keyDown(slot(container, 'value-input'), { key: 'Enter' })
    expect(text(container, 'value-tap')).toContain('233.75')
  })

  it('leaves the value alone when the entry is nonsense', () => {
    const { container } = setup()
    fireEvent.click(slot(container, 'value-tap'))
    fireEvent.change(slot(container, 'value-input'), { target: { value: 'abc' } })
    fireEvent.keyDown(slot(container, 'value-input'), { key: 'Enter' })
    expect(slot(container, 'proposed-secondary')).toBeNull()
  })
})

describe('cases: switchable without going through a target', () => {
  const CASES = [
    { id: 'bear', name: 'Bear', price: 140 },
    { id: 'base', name: 'Base', price: 210 },
    { id: 'bull', name: 'Bull', price: 300 },
  ]
  const setup = () => {
    const onSave = vi.fn()
    const r = render(
      <CaseExplorer symbol="AAPL" cases={CASES} currentPrice={182.4} onSave={onSave} />,
    )
    return { ...r, onSave }
  }

  it('offers every case as a single tap', () => {
    const { container } = setup()
    const tabs = container.querySelectorAll('[data-slot="case-tab"]')
    expect([...tabs].map(t => t.textContent)).toEqual(['Bear', 'Base', 'Bull'])
  })

  it('edits the selected case with no Set a target step anywhere', () => {
    /**
     * The hard rule. Targets and scenarios are different concepts, and routing
     * an analyst who works in cases through a target number they do not use is
     * what made case editing feel like indirection.
     */
    const { container } = setup()
    expect(container.textContent).not.toMatch(/set a target/i)
    expect(slot(container, 'case-value')).toBeTruthy()
  })

  it('switches which case is being edited', () => {
    const { container } = setup()
    expect(text(container, 'recorded')).toContain('Bear')
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    expect(text(container, 'recorded')).toContain('Bull')
    expect(text(container, 'recorded')).toContain('300')
  })

  it('saves against the case the reader is actually looking at', () => {
    const { container, onSave } = setup()
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    drag(container, 320)
    fireEvent.click(slot(container, 'save'))
    expect(onSave).toHaveBeenCalledWith('bull', 320)
  })

  it('keeps an unsaved draft when the reader flips to another case', () => {
    /**
     * Comparing cases is the entire point of having three, so flipping between
     * them has to be free. Prompting on every switch would make the comparison
     * the expensive operation; discarding silently would lose work.
     */
    const { container } = setup()
    drag(container, 155)
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    expect(slot(container, 'proposed-secondary')).toBeNull()
    fireEvent.click(container.querySelector('[data-case-id="bear"]')!)
    expect(text(container, 'value-tap')).toContain('155')
  })

  it('marks a case that has unsaved work on it', () => {
    // Otherwise a draft on a tab you are not looking at is invisible.
    const { container } = setup()
    drag(container, 155)
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    const bear = container.querySelector('[data-case-id="bear"]') as HTMLElement
    expect(within(bear).queryByLabelText('unsaved')).toBeTruthy()
  })

  it('does not carry a half-typed value across a switch', () => {
    const { container } = setup()
    fireEvent.click(slot(container, 'value-tap'))
    fireEvent.change(slot(container, 'value-input'), { target: { value: '99' } })
    fireEvent.click(container.querySelector('[data-case-id="bull"]')!)
    expect(slot(container, 'value-input')).toBeNull()
  })
})

describe('size: current, proposed and the change between them', () => {
  const setup = (benchmark: number | null = 3.1) => {
    const onStage = vi.fn()
    const r = render(
      <SizeExplorer symbol="NVDA" currentPct={7.2} benchmarkPct={benchmark} onStage={onStage} />,
    )
    return { ...r, onStage }
  }

  it('runs the track from 0 to 100, whatever the position weighs', () => {
    // A weight is bounded by arithmetic. The track used to derive its ends from
    // the numbers on the card, so the same finger travel meant a different
    // number on every card.
    const rail = (c: HTMLElement) => c.querySelector('[role="slider"]')!
    const { container } = setup()
    expect(rail(container).getAttribute('aria-valuemin')).toBe('0')
    expect(rail(container).getAttribute('aria-valuemax')).toBe('100')

    // Including at the top of the scale. `sliderRange` pads a quarter above the
    // highest known value, so a 100% position produced a rail running to 125%
    // — the padding exists so a TARGET can be explored past what is recorded,
    // and it is not evidence that a weight above 100% is reachable.
    const { container: full } = render(
      <SizeExplorer symbol="CASH" currentPct={100} benchmarkPct={null} onStage={vi.fn()} />,
    )
    expect(rail(full).getAttribute('aria-valuemax')).toBe('100')
  })

  it('still widens for a weight that is genuinely out of range', () => {
    // A position reading 120% is a data problem, and a control that quietly
    // refused to show it would hide the evidence. That is a fact on the card,
    // not a margin around one.
    const { container } = render(
      <SizeExplorer symbol="BAD" currentPct={120} benchmarkPct={null} onStage={vi.fn()} />,
    )
    expect(Number(container.querySelector('[role="slider"]')!.getAttribute('aria-valuemax')))
      .toBeGreaterThanOrEqual(120)
  })

  it('caps Double at the size of the book', () => {
    const { container } = render(
      <SizeExplorer symbol="BIG" currentPct={60} benchmarkPct={null} onStage={vi.fn()} />,
    )
    fireEvent.click([...container.querySelectorAll('[data-slot="preset"]')]
      .find(b => b.textContent === 'Double')!)
    expect(text(container, 'value-tap')).toContain('100.0')
  })

  it('names the book when it has no benchmark to be active against', () => {
    // Measured: 7 of the active portfolios in production carry a benchmark file
    // and the rest carry none, and the largest overweight positions sit in
    // books that do not. The row rendered nothing at all on exactly those
    // cards, and the reasonable conclusion was that the feature was broken.
    const { container } = render(
      <SizeExplorer symbol="AAPL" currentPct={25.3} benchmarkPct={null}
        portfolioName="Large Cap Growth" onStage={vi.fn()} />,
    )
    expect(text(container, 'size-no-bench')).toContain('Large Cap Growth')
    expect(slot(container, 'size-change')).toBeNull()
  })

  it('shows the change in points rather than as a percent of a percent', () => {
    // 7.2% to 5.0% is 2.2 points. "-30%" would be the classic sizing lie.
    //
    // It reads from `trailing` because Change now sits in the values row beside
    // the two numbers it is the difference of. In a row of its own beneath the
    // commit buttons it put the pane 0.8px over its measured 172px budget, and
    // it was the wrong reading order besides: the consequence of a proposal
    // belongs above the button that commits it.
    const { container } = setup()
    drag(container, 5.0)
    expect(text(container, 'trailing')).toContain('2.2')
    expect(text(container, 'trailing')).toContain('pts')
  })

  it('drops the staged column when nothing is staged', () => {
    // The conviction branch stages nothing, so a third of the values row read
    // "None set" while the number the reader wanted sat below the buttons.
    const { container } = setup()
    expect(slot(container, 'recorded')).toBeNull()
    expect(slot(container, 'trailing')).toBeNull() // nothing proposed yet
  })

  it('shows no change figure before anything is proposed', () => {
    const { container } = setup()
    expect(slot(container, 'trailing')).toBeNull()
  })

  it('states the active weight at rest, before anything is proposed', () => {
    // What it IS, not only what it would become. The row used to appear only
    // once there was a proposal, so the reader was told their active weight
    // would be +1.9 pts with nothing on screen saying what it is today — on a
    // card whose whole subject is that a position is too big. The distance
    // travelled IS the decision.
    const { container } = setup()
    expect(text(container, 'size-active-now')).toContain('4.1')
    expect(slot(container, 'size-active-next')).toBeNull()
  })

  it('shows both the current active weight and the proposed one', () => {
    const { container } = setup()
    drag(container, 5.0)
    expect(text(container, 'size-active-now')).toContain('4.1')
    expect(text(container, 'size-active-next')).toContain('1.9')
  })

  it('offers sizes somebody would propose, not increments', () => {
    // Plus/minus buttons moved a weight by a tenth of a point — too small to
    // matter, and two more controls on a row that was already clipping.
    const { container } = setup()
    const labels = [...container.querySelectorAll('[data-slot="preset"]')].map(b => b.textContent)
    expect(labels).toContain('Double')
    expect(labels).toContain('Exit')
  })

  it('derives active weight only where a benchmark exists', () => {
    // A subtraction we can actually do. Anything needing a risk model is
    // deliberately absent.
    const { container } = setup()
    drag(container, 5.0)
    expect(text(container, 'size-active-next')).toContain('1.9')

    // No benchmark file for the book means "active" has no meaning here — not
    // that it is zero. Reading an empty table as a number is the same defect as
    // reading a null quote as a zero price.
    const { container: c2 } = setup(null)
    drag(c2, 5.0)
    expect(slot(c2, 'size-change')).toBeNull()
  })

  it('offers quick weights the existing numbers support', () => {
    const { container } = setup()
    const labels = [...container.querySelectorAll('[data-slot="preset"]')].map(b => b.textContent)
    expect(labels).toContain('Half')
    expect(labels).toContain('Neutral')
  })

  it('half means half of the current weight', () => {
    const { container } = setup()
    fireEvent.click([...container.querySelectorAll('[data-slot="preset"]')]
      .find(b => b.textContent === 'Half')!)
    expect(text(container, 'value-tap')).toContain('3.6')
  })

  it('names the artefact it creates, on the button itself', () => {
    /**
     * "Hold to record" left a reader on an oversized position unable to tell
     * whether the control was about to trim it. The button names what it makes.
     *
     * A reassuring line beneath ("no trade is placed") was removed rather than
     * reworded: on a pane already at its height budget it pushed the change
     * figures into the commit buttons, so the reassurance arrived as an
     * overlap. The button says it in the place somebody is actually looking
     * before they press it.
     */
    const { container } = setup()
    drag(container, 5.0)
    expect(slot(container, 'save').textContent).toMatch(/idea/i)
  })

  it('stages rather than trades', () => {
    const { container, onStage } = setup()
    drag(container, 5.0)
    fireEvent.click(slot(container, 'save'))
    expect(onStage).toHaveBeenCalledWith(5)
  })
})
