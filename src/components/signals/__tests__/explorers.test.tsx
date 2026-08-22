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
const drag = (c: HTMLElement, to: number) =>
  fireEvent.change(slot(c, 'slider'), { target: { value: String(to) } })

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
    // The row itself says whether anything is being explored.
    const { container } = setup()
    expect(slot(container, 'proposed')).toBeNull()
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
    expect(slot(container, 'proposed')).toBeNull()
    expect(text(container, 'recorded')).toContain('210')
  })

  it('resets an untargeted name to the current price rather than to zero', () => {
    const { container } = setup(null)
    expect(text(container, 'recorded')).toContain('None set')
    drag(container, 300)
    fireEvent.click(slot(container, 'reset'))
    expect(slot(container, 'proposed')).toBeNull()
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
    expect(slot(container, 'proposed')).toBeNull()
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
    expect(slot(container, 'proposed')).toBeNull()
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

  it('shows the change in points rather than as a percent of a percent', () => {
    // 7.2% to 5.0% is 2.2 points. "-30%" would be the classic sizing lie.
    const { container } = setup()
    drag(container, 5.0)
    expect(text(container, 'size-change')).toContain('2.2')
    expect(text(container, 'size-change')).toContain('pts')
  })

  it('shows no change figure before anything is proposed', () => {
    const { container } = setup()
    expect(slot(container, 'size-change')).toBeNull()
  })

  it('derives active weight only where a benchmark exists', () => {
    // A subtraction we can actually do. Anything needing a risk model is
    // deliberately absent.
    const { container } = setup()
    drag(container, 5.0)
    expect(text(container, 'size-active')).toContain('1.9')

    const { container: c2 } = setup(null)
    drag(c2, 5.0)
    expect(slot(c2, 'size-active')).toBeNull()
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

  it('names the artefact it creates, and rules out the one it does not', () => {
    /**
     * "Hold to record" left a reader on an oversized position unable to tell
     * whether the control was about to trim it. The button names what it makes
     * — an idea — and the line beneath says what does NOT happen, because
     * "this is not a trade" alone still leaves the reader wondering what it is.
     */
    const { container } = setup()
    drag(container, 5.0)
    expect(slot(container, 'save').textContent).toMatch(/idea/i)
    expect(container.textContent).toMatch(/no trade is placed/i)
  })

  it('stages rather than trades', () => {
    const { container, onStage } = setup()
    drag(container, 5.0)
    fireEvent.click(slot(container, 'save'))
    expect(onStage).toHaveBeenCalledWith(5)
  })
})
