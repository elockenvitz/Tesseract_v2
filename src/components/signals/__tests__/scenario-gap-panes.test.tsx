import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

import { ScenarioGapPanes } from '../ScenarioGapPanes'
import {
  SCENARIO_REVIEW_CHOICES,
  SCENARIO_NOTE_MAX,
  type ScenarioReviewChoice,
} from '../../../lib/signals/scenario-review'

/**
 * Typed, so `mock.calls[0][0].key` is checkable rather than `any`.
 *
 * `vi.fn(async () => true)` infers a zero-argument mock, and indexing its call
 * tuple is then a type error — which is the compiler correctly pointing out
 * that the test was asserting against something it had not described.
 */
const submitMock = (impl?: (c: ScenarioReviewChoice, note: string) => Promise<boolean>) =>
  vi.fn<(c: ScenarioReviewChoice, note: string) => Promise<boolean>>(
    impl ?? (async () => true),
  )

/**
 * The state machine and the footer contract, not the pixels.
 *
 * Two properties every test here defends.
 *
 * **Selection mutates nothing.** Choosing an answer changes what the sticky
 * footer offers and does nothing else. The write happens on `Submit response`
 * and only a successful one records anything — so a failed save leaves the
 * answer selected, the note intact and the signal unresolved.
 *
 * **There is one action bar and it is the shared one.** `Actions` on the left
 * on every pane; on the right the card's own `Review cases` everywhere except
 * RESPOND, where the thing to do is submit. The substitution is
 * `primaryOverride`, which this component produces and `SignalCardView`
 * renders — the same seam `TargetExpiredPanes` uses.
 */

const QUESTION = 'Has the investment view changed?'

type Override = { id: string; label: string; disabled?: boolean; run?: () => void } | null

function renderPanes(over: { onSubmit?: any; pricePane?: React.ReactNode | null } = {}) {
  const onSubmit = over.onSubmit ?? submitMock()
  /** The last composition the children callback was given. */
  const seen: {
    panes: { id: string; label: string }[]
    onPaneChange: (id: string) => void
    primaryOverride: Override
  } = { panes: [], onPaneChange: () => {}, primaryOverride: null }

  render(
    <ScenarioGapPanes
      question={QUESTION}
      ladderPane={<div data-testid="fixture-ladder">ladder</div>}
      pricePane={over.pricePane === undefined ? <div data-testid="fixture-price">price</div> : over.pricePane}
      casesPane={<div data-testid="fixture-cases">cases</div>}
      onSubmit={onSubmit}
    >
      {({ panes, onPaneChange, primaryOverride }) => {
        seen.panes = panes.map(p => ({ id: p.id, label: p.label }))
        seen.onPaneChange = onPaneChange
        seen.primaryOverride = primaryOverride
        // Every pane at once: the carousel is not under test here, and mounting
        // them all is what lets a test drive the response without a scroller.
        return <div>{panes.map(p => <div key={p.id}>{p.content}</div>)}</div>
      }}
    </ScenarioGapPanes>,
  )
  return { onSubmit, seen }
}

const pick = (key: string) => fireEvent.click(screen.getByTestId('scenario-respond')
  .querySelector(`[data-verdict="${key}"]`)!)

describe('the four panes, in ship order', () => {
  it('composes LADDER, RESPOND, PRICE, CASES and nothing else', () => {
    const { seen } = renderPanes()
    expect(seen.panes.map(p => p.id)).toEqual(['ladder', 'verdict', 'price', 'cases'])
    expect(seen.panes.map(p => p.label)).toEqual(['Ladder', 'Respond', 'Price', 'Cases'])
  })

  /**
   * `Conviction` and `Reweight` are gone, and their absence is the point.
   *
   * They rendered only when a ladder carried usable probabilities — measured,
   * four of ten laddered symbols — so the card's PANE COUNT changed with the
   * data, and the two extra pages sat between the decision and its evidence.
   */
  it('never grows a fifth pane, whatever the data', () => {
    const { seen } = renderPanes()
    expect(seen.panes).toHaveLength(4)
    expect(seen.panes.map(p => p.id)).not.toContain('weight')
    expect(seen.panes.map(p => p.id)).not.toContain('reweight')
  })

  /**
   * A name with nothing cached loses the PANE, not just the chart.
   *
   * `PricePane` states "Price history unavailable" when it has no series, and a
   * carousel page whose whole content is that sentence is a page the reader
   * swipes to in order to learn nothing.
   */
  it('omits the price pane rather than paging to an empty one', () => {
    const { seen } = renderPanes({ pricePane: null })
    expect(seen.panes.map(p => p.id)).toEqual(['ladder', 'verdict', 'cases'])
  })
})

describe('the footer belongs to the card except on RESPOND', () => {
  /**
   * Paged AWAY from Respond as well as onto it.
   *
   * Reading the initial value would pass for the wrong reason — the override
   * starts null — so each pane is reached from the one before it, which is what
   * a reader swiping actually does.
   */
  it('offers no override on the evidence panes, so the card keeps Review cases', async () => {
    const { seen } = renderPanes()
    for (const pane of ['verdict', 'ladder', 'verdict', 'price', 'verdict', 'cases']) {
      seen.onPaneChange(pane)
      if (pane === 'verdict') {
        await waitFor(() => expect(seen.primaryOverride).not.toBeNull())
      } else {
        await waitFor(() => expect(seen.primaryOverride, pane).toBeNull())
      }
    }
  })

  it('substitutes Submit response on RESPOND, disabled until something is chosen', async () => {
    const { seen } = renderPanes()
    seen.onPaneChange('verdict')
    await waitFor(() => expect(seen.primaryOverride).toMatchObject({
      id: 'submit_response', label: 'Submit response', disabled: true,
    }))
  })

  it('enables it once an answer is selected', async () => {
    const { seen } = renderPanes()
    seen.onPaneChange('verdict')
    pick('scenario_cases_outdated')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    expect(seen.primaryOverride?.label).toBe('Submit response')
  })

  /** A second tap on the chosen answer clears it, and the footer follows. */
  it('disables again when the answer is toggled off', async () => {
    const { seen } = renderPanes()
    seen.onPaneChange('verdict')
    pick('scenario_thesis_intact')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    pick('scenario_thesis_intact')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(true))
  })
})

describe('the body carries no commit control of its own', () => {
  it('shows the note field directly, with no + Note affordance to open it', () => {
    renderPanes()
    expect(screen.getByTestId('scenario-respond-note')).toBeTruthy()
    expect(screen.queryByTestId('verdict-add-note')).toBeNull()
    expect(screen.queryByTestId('verdict-send')).toBeNull()
  })

  /**
   * The answers cannot be squeezed, and that was the overlap.
   *
   * The grid was `min-h-0`, which in a flex column says it MAY shrink below
   * its content. The content is two rows of 44px touch targets — a floor, not
   * a preference — so on a short band the box shrank, the buttons did not, and
   * they painted over the line beneath them. Reported from the phone as the
   * helper text colliding with the answers; the helper had not moved.
   */
  it('never lets the answer grid shrink below its touch targets', () => {
    renderPanes()
    expect(screen.getByTestId('scenario-respond-options').className)
      .toContain('shrink-0')
    expect(screen.getByTestId('scenario-respond-options').className)
      .not.toContain('min-h-0')
  })

  /**
   * And the generic sentence is gone.
   *
   * "Your answer changes what this feed shows you next." was true of every
   * answer on every card of every type. It described the mechanism rather than
   * the consequence, and it occupied the one line that exists to say what THIS
   * answer does.
   */
  it('says nothing about the choice until one is made', () => {
    renderPanes()
    expect(screen.queryByText(/changes what this feed shows you next/i)).toBeNull()
    expect(screen.getByTestId('scenario-respond-consequence').textContent).toBe('')
  })

  it('states the consequence of the chosen answer, in normal flow', () => {
    renderPanes()
    pick('scenario_cases_outdated')
    const line = screen.getByTestId('scenario-respond-consequence')
    expect(line.textContent).toContain('framework is stale')
    // Reserved height, so choosing cannot push the note field under the thumb.
    expect(line.className).toContain('min-h-[30px]')
    expect(line.className).toContain('shrink-0')
    // Nothing is lifted out of flow over a control.
    expect(line.className).not.toContain('absolute')
  })

  /** The reserved line does not move between states. */
  it('keeps the same space whether or not an answer is chosen', () => {
    renderPanes()
    const empty = screen.getByTestId('scenario-respond-consequence').className
    pick('scenario_thesis_intact')
    expect(screen.getByTestId('scenario-respond-consequence').className).toBe(empty)
  })

  /**
   * The one control that used to be here, gone.
   *
   * `VerdictBar` renders its own filled commit button reading "Apply" or "Write
   * it down". On a card whose sticky footer already offers a primary that put
   * two commit-shaped controls about 150px apart with nothing to say which was
   * authoritative.
   */
  it('renders no Apply or Write it down anywhere in the panes', () => {
    renderPanes()
    expect(screen.queryByText('Apply')).toBeNull()
    expect(screen.queryByText('Write it down')).toBeNull()
  })

  it('caps the note at the length the quick thought it becomes will hold', () => {
    renderPanes()
    expect(screen.getByTestId('scenario-respond-note').getAttribute('maxLength'))
      .toBe(String(SCENARIO_NOTE_MAX))
  })

  /**
   * And it WRAPS that length, rather than scrolling it off the left edge.
   *
   * It was an `<input>`. `index.css` forces 16px on every input and textarea
   * to stop iOS zooming on focus, so the field held about 40 of its 300
   * permitted characters and the browser scrolled the rest out of view to keep
   * the caret visible — measured at `scrollLeft` 190 in a 352px field, with the
   * note starting mid-word at the left border while it was still being typed.
   *
   * A textarea is the fix, and the element is the thing to assert: no amount of
   * padding makes a single-line field show a paragraph.
   */
  it('gives the note a field that wraps, not one that scrolls sideways', () => {
    renderPanes()
    const note = screen.getByTestId('scenario-respond-note')
    expect(note.tagName).toBe('TEXTAREA')
    /**
     * TWO rows, not three.
     *
     * Three showed ~120 of the 300 permitted characters and cost 86px of a
     * band that has to survive a software keyboard taking 40% of the screen.
     * The job is "easy to enter a short investment note", not "display 300
     * characters at once" — so two rows is the window and a longer note
     * scrolls vertically, which still keeps the line being typed whole.
     */
    expect(note.getAttribute('rows')).toBe('2')
    // And it may be squeezed by a shorter band, but never below a touch target.
    expect(note.className).toContain('min-h-[44px]')
    // No drag handle: the card is a fixed band and the indicator row is
    // directly beneath this corner.
    expect(note.className).toContain('resize-none')
  })
})

describe('submitting', () => {
  it('sends the chosen judgment and the note together, once', async () => {
    const onSubmit = submitMock()
    const { seen } = renderPanes({ onSubmit })
    seen.onPaneChange('verdict')
    pick('scenario_thesis_weaker')
    fireEvent.change(screen.getByTestId('scenario-respond-note'), {
      target: { value: '  consensus caught up  ' },
    })
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    seen.primaryOverride!.run!()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
    expect(onSubmit.mock.calls[0][0].key).toBe('scenario_thesis_weaker')
    // Trimmed, because a note of whitespace is not a note.
    expect(onSubmit.mock.calls[0][1]).toBe('consensus caught up')
  })

  it('writes nothing on selection alone', async () => {
    const onSubmit = submitMock()
    const { seen } = renderPanes({ onSubmit })
    seen.onPaneChange('verdict')
    pick('scenario_thesis_intact')
    fireEvent.change(screen.getByTestId('scenario-respond-note'), { target: { value: 'x' } })
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  /**
   * A double tap must not become two judgments and two audit rows.
   *
   * The guard is a ref rather than the disabled flag: the second call can
   * arrive before React has re-rendered the first.
   */
  it('cannot be fired twice', async () => {
    let release: (v: boolean) => void = () => {}
    const onSubmit = submitMock(() => new Promise<boolean>(r => { release = r }))
    const { seen } = renderPanes({ onSubmit })
    seen.onPaneChange('verdict')
    pick('scenario_needs_review')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    seen.primaryOverride!.run!()
    seen.primaryOverride!.run!()
    release(true)
    await waitFor(() => expect(screen.getByTestId('scenario-respond-saved')).toBeTruthy())
    expect(onSubmit).toHaveBeenCalledTimes(1)
  })

  it('reads as busy while it is in flight', async () => {
    let release: (v: boolean) => void = () => {}
    const onSubmit = submitMock(() => new Promise<boolean>(r => { release = r }))
    const { seen } = renderPanes({ onSubmit })
    seen.onPaneChange('verdict')
    pick('scenario_needs_review')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    seen.primaryOverride!.run!()
    await waitFor(() => expect(seen.primaryOverride?.label).toBe('Saving…'))
    expect(seen.primaryOverride?.disabled).toBe(true)
    release(true)
  })
})

describe('a failed submit loses nothing', () => {
  for (const [name, onSubmit] of [
    ['a refusal', submitMock(async () => false)],
    ['a throw', submitMock(async () => { throw new Error('offline') })],
  ] as const) {
    it(`keeps the answer and the note after ${name}`, async () => {
      const { seen } = renderPanes({ onSubmit })
      seen.onPaneChange('verdict')
      pick('scenario_cases_outdated')
      fireEvent.change(screen.getByTestId('scenario-respond-note'), {
        target: { value: 'the ladder predates the guide raise' },
      })
      await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
      seen.primaryOverride!.run!()

      await waitFor(() => expect(screen.getByTestId('scenario-respond-error')).toBeTruthy())
      // The selection survives, so the reader retries rather than re-deciding.
      expect(screen.getByTestId('scenario-respond')
        .querySelector('[data-verdict="scenario_cases_outdated"]')!
        .getAttribute('aria-checked')).toBe('true')
      expect((screen.getByTestId('scenario-respond-note') as HTMLTextAreaElement).value)
        .toBe('the ladder predates the guide raise')
      // And the footer can still be pressed again.
      expect(seen.primaryOverride?.disabled).toBe(false)
      // Nothing is claimed to have been recorded.
      expect(screen.queryByTestId('scenario-respond-saved')).toBeNull()
    })
  }
})

describe('a successful submit', () => {
  it('confirms the answer and hands the footer back to the card', async () => {
    const { seen } = renderPanes()
    seen.onPaneChange('verdict')
    pick('scenario_thesis_intact')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    seen.primaryOverride!.run!()

    await waitFor(() => expect(screen.getByTestId('scenario-respond-saved')).toBeTruthy())
    expect(screen.getByTestId('scenario-respond-saved').textContent).toContain('Thesis intact')
    /**
     * The override lifts, so the bar returns to `Review cases`.
     *
     * A disabled "Submitted" would be a dead end on the one pane the reader has
     * finished with, and reviewing the cases is what three of the four answers
     * point at next.
     */
    expect(seen.primaryOverride).toBeNull()
  })

  it('lets a mis-tap be corrected, which writes a new judgment', async () => {
    const onSubmit = submitMock()
    const { seen } = renderPanes({ onSubmit })
    seen.onPaneChange('verdict')
    pick('scenario_thesis_intact')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    seen.primaryOverride!.run!()
    await waitFor(() => expect(screen.getByTestId('scenario-respond-saved')).toBeTruthy())

    fireEvent.click(screen.getByTestId('scenario-respond-change'))
    await waitFor(() => expect(screen.getByTestId('scenario-respond')).toBeTruthy())
    pick('scenario_thesis_weaker')
    await waitFor(() => expect(seen.primaryOverride?.disabled).toBe(false))
    seen.primaryOverride!.run!()
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(2))
    expect(onSubmit.mock.calls[1][0].key).toBe('scenario_thesis_weaker')
  })
})

describe('the answers themselves', () => {
  it('renders exactly the four the vocabulary declares, in order', () => {
    renderPanes()
    const keys = [...screen.getByTestId('scenario-respond-options')
      .querySelectorAll('[data-verdict]')].map(n => n.getAttribute('data-verdict'))
    expect(keys).toEqual(SCENARIO_REVIEW_CHOICES.map(c => c.key))
  })

  /** Every answer is a real target on a coarse pointer. */
  it('gives each answer a 44px floor', () => {
    renderPanes()
    for (const n of screen.getByTestId('scenario-respond-options').querySelectorAll('button')) {
      expect(n.className).toContain('min-h-[44px]')
      expect(n.className).not.toContain('no-touch-target')
    }
  })
})
