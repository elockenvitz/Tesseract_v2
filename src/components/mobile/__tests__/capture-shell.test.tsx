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

  it('opens the first useful field itself, rather than waiting for a tap', () => {
    open()
    fireEvent.click(screen.getByText('Quick thought'))

    expect(seen.thought.autoFocus).toBe(true)
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

  it('gives a writing form the phone', () => {
    // At 0.5 an open keyboard reduces Recommendation or Prompt to a strip a
    // few lines tall.
    expect(sheetSource).toContain(': [0.92]')
  })

  it('does not give filing a screen it has no use for', () => {
    expect(sheetSource).toContain('isFiling(kind) ? [0.7]')
  })

  it('decides from the registry group rather than a hardcoded list of kinds', () => {
    expect(sheetSource).toContain("captureType(kind)?.group === 'file'")
  })
})
