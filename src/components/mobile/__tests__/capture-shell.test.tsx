/**
 * Four capture types, one shell.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The phone's capture sheet handled a thought and a trade idea inside itself,
 * and let a recommendation and a prompt break out into their own full-screen
 * modals. The reason given was that nesting a modal inside a drag-dismissable
 * panel would be wrong — which it would be, except both had supported an
 * `embedded` mode since the desktop pane started rendering them inline, and
 * embedded they draw no overlay at all.
 *
 * So two of the four arrived with different chrome, a different way to dismiss,
 * and none of the sheet's keyboard handling. That is most of what made the
 * system read as four unrelated forms rather than one.
 *
 * These render the real sheet with the four capture components stubbed: the
 * claim is about which shell they appear in and what the shell tells them, not
 * about what any of them saves.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const seen: Record<string, any> = {}

vi.mock('../../thoughts/QuickThoughtCapture', () => ({
  QuickThoughtCapture: (p: any) => { seen.thought = p; return <div data-testid="form-thought" /> },
}))
vi.mock('../../thoughts/QuickTradeIdeaCapture', () => ({
  QuickTradeIdeaCapture: (p: any) => { seen.trade = p; return <div data-testid="form-trade" /> },
}))
vi.mock('../../thoughts/RecommendationQuickModal', () => ({
  RecommendationQuickModal: (p: any) => { seen.rec = p; return <div data-testid="form-rec" /> },
}))
vi.mock('../../thoughts/PromptModal', () => ({
  PromptModal: (p: any) => { seen.prompt = p; return <div data-testid="form-prompt" /> },
}))
vi.mock('../CaptureFilePicker', () => ({
  CaptureFilePicker: () => <div data-testid="form-file" />,
}))

import { FeedCaptureSheet } from '../FeedCaptureSheet'
import { WRITE_CAPTURE_TYPES, captureType } from '../../../lib/capture/capture-types'

afterEach(cleanup)

function open() {
  // React owns these nodes; clearing innerHTML by hand leaves it unmounting
  // children it can no longer find.
  cleanup()
  for (const k of Object.keys(seen)) delete seen[k]
  return render(
    <FeedCaptureSheet
      open
      onClose={() => {}}
      assetId="a1"
      assetSymbol="AMZN"
      assetName="Amazon.com Inc"
    />,
  )
}

/** The sheet the shell draws. Everything must be inside it. */
const sheet = () => document.querySelector('[role="dialog"], .fixed.inset-0') as HTMLElement

describe('the picker offers one coherent set', () => {
  it('lists every writable capture type', () => {
    open()

    for (const t of WRITE_CAPTURE_TYPES) {
      expect(screen.getByText(t.label)).toBeTruthy()
    }
  })

  it('says what each one is for without spending a line on it', () => {
    // The hint was a visible second line under every option, which made each
    // row 60px and pushed the four writing choices past the fold of a
    // half-height sheet. It is the row's accessible description now, so the
    // information survives and the height does not.
    open()

    for (const t of WRITE_CAPTURE_TYPES) {
      expect(screen.queryByText(t.hint)).toBeNull()
      expect(screen.getByLabelText(`${t.label}. ${t.hint}`)).toBeTruthy()
    }
  })

  it('gives every choice one compact row, so all four are visible at once', () => {
    open()

    for (const t of WRITE_CAPTURE_TYPES) {
      const row = screen.getByLabelText(`${t.label}. ${t.hint}`)
      expect(row.className).toContain('h-12')
      expect(row.className).not.toContain('min-h-[60px]')
    }
  })

  it('rules off where writing ends and filing begins', () => {
    // Different gestures. Six undifferentiated names make "Add to a list" look
    // like a sixth thing to compose.
    open()
    // The sheet portals to body, so the rule is not under `container`.
    expect(sheet().querySelectorAll('.border-t').length).toBeGreaterThan(0)
  })
})

describe('every type opens inside the same shell', () => {
  const CASES: [string, string][] = [
    ['Quick thought', 'form-thought'],
    ['Trade idea', 'form-trade'],
    ['Recommendation', 'form-rec'],
    ['Prompt', 'form-prompt'],
  ]

  it.each(CASES)('%s renders in the sheet', (label, testid) => {
    open()
    fireEvent.click(screen.getByText(label))

    const form = screen.getByTestId(testid)
    expect(form).toBeTruthy()
    // Inside the shell, not floating over it as its own overlay.
    expect(sheet().contains(form)).toBe(true)
  })

  it.each(CASES)('%s keeps the way back to the picker', label => {
    open()
    fireEvent.click(screen.getByText(label))

    expect(screen.getByLabelText('Back to capture options')).toBeTruthy()
  })

  it.each(CASES)('%s is named and explained once open', (label, _t) => {
    open()
    fireEvent.click(screen.getByText(label))

    const type = WRITE_CAPTURE_TYPES.find(t => t.label === label)!
    expect(screen.getByText(type.guidance)).toBeTruthy()
  })
})

describe('the two that used to break out no longer do', () => {
  it('renders the recommendation embedded, so it draws no overlay of its own', () => {
    open()
    fireEvent.click(screen.getByText('Recommendation'))

    expect(seen.rec.embedded).toBe(true)
  })

  it('renders the prompt embedded too', () => {
    open()
    fireEvent.click(screen.getByText('Prompt'))

    expect(seen.prompt.embedded).toBe(true)
  })

  it('leaves the picker reachable from both, which the modals never did', () => {
    for (const label of ['Recommendation', 'Prompt']) {
      open()
      fireEvent.click(screen.getByText(label))
      fireEvent.click(screen.getByLabelText('Back to capture options'))

      expect(screen.getByText('Quick thought')).toBeTruthy()
    }
  })
})

describe('context still reaches every form', () => {
  it('attaches the tile asset to the thought', () => {
    open()
    fireEvent.click(screen.getByText('Quick thought'))

    expect(seen.thought.initialAssetId).toBe('a1')
  })

  it('attaches it to the trade idea by symbol and name too', () => {
    open()
    fireEvent.click(screen.getByText('Trade idea'))

    expect(seen.trade.assetId).toBe('a1')
    expect(seen.trade.assetSymbol).toBe('AMZN')
  })

  it('gives the recommendation and the prompt a context object', () => {
    open()
    fireEvent.click(screen.getByText('Recommendation'))
    expect(seen.rec.context).toBeTruthy()

    open()
    fireEvent.click(screen.getByText('Prompt'))
    expect(seen.prompt.context).toBeTruthy()
  })

  it('does NOT open the keyboard, so the whole surface is the reader is', () => {
    /*
      Reversed by manual QA, and deliberately.

      A capture sheet that opens with the keyboard already up hands the phone
      half a screen and a decision nobody asked to make yet. The reader taps
      the writing area when they are ready. This test previously asserted the
      opposite; it is inverted rather than deleted so the old behaviour cannot
      return quietly.
    */
    open()
    fireEvent.click(screen.getByText('Quick thought'))

    expect(seen.thought.autoFocus).toBeFalsy()
  })

  it('does not autofocus the trade idea either', () => {
    open()
    fireEvent.click(screen.getByText('Trade idea'))

    expect(seen.trade.autoFocus).toBeFalsy()
  })
})

describe('the shell makes no desktop-width assumption', () => {
  it('sizes nothing with a fixed pixel width', () => {
    open()

    expect(sheet().innerHTML).not.toMatch(/w-\[\d{3,}px\]/)
  })

  it('sizes nothing against the invisible part of the viewport', () => {
    open()

    // A bare vh class is measured against a viewport that includes the strip
    // behind the URL bar. See `viewport-sizing.test`.
    expect(sheet().innerHTML).not.toMatch(/\bh-\[\d+vh\]/)
  })
})

describe('the registry is what both surfaces read', () => {
  it('gives the sheet its labels rather than a second hand-written list', () => {
    open()

    // If the sheet ever forks its own copy, one of these stops matching.
    expect(captureType('thought')!.label).toBe('Quick thought')
    expect(screen.getByText(captureType('thought')!.label)).toBeTruthy()
    const prompt = captureType('prompt')!
    expect(screen.getByLabelText(`${prompt.label}. ${prompt.hint}`)).toBeTruthy()
  })
})


describe('sheet height follows the task', () => {
  const sheetSource = readFileSync(
    resolve(__dirname, '../FeedCaptureSheet.tsx'), 'utf8',
  )

  it('gives the picker half a screen, because it is a short list', () => {
    expect(sheetSource).toContain('kind === null ? [0.5]')
  })

  it('gives a writing form the whole sheet, not 92% of it', () => {
    // `1` is the sheet's own maximum, not the screen's: BottomSheet caps every
    // snap at `available - TOP_PEEK`, so 24px of backdrop stays visible. The
    // old `0.92` was an arbitrary gap on top of that cap, which is what made a
    // writing workspace feel half-open.
    expect(sheetSource).toContain(': [1]')
    expect(sheetSource).not.toContain(': [0.92]')
  })

  it('still caps at the sheet maximum rather than covering the screen', () => {
    const bottomSheet = readFileSync(
      resolve(__dirname, '../BottomSheet.tsx'), 'utf8',
    )
    expect(bottomSheet).toContain('available - TOP_PEEK')
  })

  it('does not give filing a screen it has no use for', () => {
    expect(sheetSource).toContain('isFiling(kind) ? [0.7]')
  })

  it('decides from the registry group rather than a hardcoded list of kinds', () => {
    expect(sheetSource).toContain("captureType(kind)?.group === 'file'")
  })
})

/**
 * The chosen form is not clipped, and not inside a second scroller.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * Reported as "Actions → Prompt → content at the TOP of the sheet is
 * clipped/cut off". Nothing in `PromptModal` caused it.
 *
 * The chosen-kind branch was `<div class="flex flex-col min-h-0">` wrapping a
 * `<div class="flex-1 min-h-0 overflow-y-auto">` that held the form. The wrapper
 * has no height of its own, so it sizes to its content — and a `flex: 1 1 0%`
 * child whose automatic minimum has been zeroed contributes nothing to that
 * measurement. Its hypothetical main size is its flex-basis, which is zero, and
 * `min-h-0` removes the content-based clamp that would have pushed it back up.
 * The form was laid out in a box collapsed to near nothing with
 * `overflow-y-auto` cutting off the overflow — from the top, because that is
 * where the box begins.
 *
 * It was also a scroller nested inside `BottomSheet`'s own scroller, so a drag
 * in the form moved the inner box while the sheet stood still.
 *
 * ── Why the structure is asserted rather than the clipping ─────────────────
 *
 * jsdom computes no layout, so the collapsed height cannot be observed here.
 * What is assertable is that the shape which caused it is gone, that the form
 * is in normal flow, and that the header control which used to scroll away with
 * the form is now outside the scrolling region.
 */
describe('the chosen form is laid out in normal flow', () => {
  const sheetSource = readFileSync(
    resolve(__dirname, '../FeedCaptureSheet.tsx'), 'utf8',
  ).replace(/\r\n/g, '\n')

  it('no longer wraps the form in a zero-basis flex item', () => {
    expect(sheetSource).not.toContain('flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-4')
    expect(sheetSource).not.toContain('<div className="flex flex-col min-h-0">')
  })

  it('leaves the sheet as the only scroller', () => {
    // BottomSheet's body is `flex-1 min-h-0 overflow-y-auto` against a definite
    // height. A second one inside it is the nested scroll trap. Class names
    // only — the prose above the branch names the rule it removed.
    const scrollingClasses = [...sheetSource.matchAll(/className="([^"]*)"/g)]
      .map(m => m[1])
      .filter(c => c.includes('overflow-y-auto'))

    expect(scrollingClasses).toEqual([])
  })

  it('puts the form in a plain padded block', () => {
    const at = sheetSource.indexOf('One scroll owner, and no collapsed flex item.')
    expect(at).toBeGreaterThan(0)
    expect(sheetSource.slice(at, at + 2200)).toContain('<div className="px-3 pb-4">')
  })

  it.each([
    ['Quick thought', 'form-thought'],
    ['Trade idea', 'form-trade'],
    ['Recommendation', 'form-rec'],
    ['Prompt', 'form-prompt'],
  ])('%s renders with nothing scrollable between it and the sheet', (label, testid) => {
    open()
    fireEvent.click(screen.getByText(label))

    // Walk from the form up to the dialog; exactly one region may scroll, and
    // it is the sheet's own body.
    let node: HTMLElement | null = screen.getByTestId(testid)
    const scrollers: string[] = []
    while (node && node !== sheet()) {
      if (node.className.includes('overflow-y-auto')) scrollers.push(node.className)
      node = node.parentElement
    }

    expect(scrollers).toHaveLength(1)
    expect(scrollers[0]).toContain('flex-1 min-h-0 overflow-y-auto')
  })
})

describe('the way back does not scroll away with the form', () => {
  it('lives in the sheet header, outside the scrolling body', () => {
    open()
    fireEvent.click(screen.getByText('Prompt'))

    const back = screen.getByLabelText('Back to capture options')
    const body = sheet().querySelector('.flex-1.min-h-0.overflow-y-auto')

    expect(body).toBeTruthy()
    expect(body!.contains(back)).toBe(false)
  })

  it('still names what is being written', () => {
    open()
    fireEvent.click(screen.getByText('Prompt'))

    expect(screen.getByText(captureType('prompt')!.label)).toBeTruthy()
  })

  it('is a button, so the header drag row does not swallow its tap', () => {
    // `BottomSheet` captures the pointer on this row for drag-to-dismiss, and
    // capture retargets `pointerup`, which suppresses `click`. The row exempts
    // anything inside a `button`, which is what makes this work here.
    open()
    fireEvent.click(screen.getByText('Prompt'))

    expect(screen.getByLabelText('Back to capture options').tagName).toBe('BUTTON')
  })
})
