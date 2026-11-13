/**
 * What the message controls are called.
 *
 * ── The report ───────────────────────────────────────────────────────────
 *
 * Three strings were reported as literal output under an answer:
 *
 *     svg3 sources svg
 *     svgKeep
 *     svgCopy
 *
 * They are the three controls in one message footer, with their decorative
 * icons counted as part of the label. `AiKeep` rendered
 * `<BookmarkPlus/>Keep`, the footer rendered `<Copy/>Copy`, and the evidence
 * toggle rendered `<FileText/><span>N sources</span><ChevronRight/>` -- which
 * is why only that one came out with a trailing `svg`. Nothing in the app
 * ever rendered the text "svg"; the icons were simply inside the name, so
 * anything that reduced the footer to text, a screen reader included, read
 * the elements out along with the words.
 *
 * ── What is asserted, and what that does and does not prove ─────────────
 *
 * Two things: the accessible NAME of each control, and that every glyph
 * inside one is marked decorative.
 *
 * The second is what catches a regression. Removing `aria-hidden` from one
 * icon was injected while writing this, and only the glyph case failed --
 * jsdom's name computation already ignored a bare `<svg>`, so the name cases
 * passed either way. Which also says something about the report: the ARIA
 * name algorithm is not what produced `svgKeep`, so those strings came from
 * some other reduction of the footer to text, one that prints element names.
 * `aria-hidden` is the right marking regardless -- these glyphs ARE
 * decoration, the words beside them are the labels -- and it takes them out
 * of any such reduction. What it is not is a verified account of the capture
 * the strings came from; that needs a browser, which was not available.
 */

import { describe, it, expect } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { AiEvidence } from '../AiEvidence'
import { AiKeep } from '../AiKeep'
import type { AiSourceRef, MessageToolCall } from '../../../lib/ai/presentation'

afterEach(cleanup)

const source = (): AiSourceRef => ({
  kind: 'decision_request',
  id: 'dr1',
  title: 'AAPL PM ruling: pending',
  timestamp: '2026-11-01T00:00:00Z',
})

const call = (over: Partial<MessageToolCall> = {}): MessageToolCall => ({
  name: 'get_decisions',
  input: { symbol: 'AAPL' },
  status: 'ok',
  result_count: 1,
  sources: [source()],
  ...over,
})

const failed = () => call({
  name: 'get_price', status: 'error', sources: [], result_count: 0,
})

describe('a control is called what it says, not what it is drawn with', () => {
  it('names the evidence toggle after its heading alone', () => {
    render(<AiEvidence toolCalls={[call(), call({ name: 'get_asset' })]} />)

    const toggle = screen.getByRole('button')
    const heading = screen.getByTestId('ai-evidence-heading').textContent ?? ''

    expect(heading).not.toBe('')
    /* The reported string was this heading with an `svg` welded to each end,
       so the name has to equal the heading exactly. A looser match would not
       see the extra tokens, which were the whole defect. */
    expect(toggle).toHaveAccessibleName(heading)
  })

  it('names Keep "Keep"', () => {
    render(
      <AiKeep
        message={{ role: 'assistant', content: 'An answer.', streaming: false }}
        conversationTitle="LRCX"
        subject={{ type: 'asset', id: 'a-lrcx', label: 'LRCX' }}
      />,
    )

    expect(screen.getByTestId('ai-keep')).toHaveAccessibleName('Keep')
  })

  it('hides every decorative glyph in the control it draws', () => {
    render(<AiEvidence toolCalls={[call(), failed()]} />)

    const toggle = screen.getByRole('button')
    const glyphs = [...toggle.querySelectorAll('svg')]
    /* Non-vacuity for the loop below: a control that drew no icons at all
       would satisfy "every icon is hidden". */
    expect(glyphs.length).toBeGreaterThan(1)
    for (const glyph of glyphs) {
      expect(glyph.getAttribute('aria-hidden')).toBe('true')
    }
  })

  it('still announces a failed lookup, which is not decoration', () => {
    render(<AiEvidence toolCalls={[call(), failed()]} />)

    /*
     * The red glyph is the whole signal that an answer may be missing
     * something, and it is visible without opening the section by design.
     * Hiding it along with the rest would have traded a misread name for a
     * lost warning, so it is NAMED rather than hidden -- a `title` on a span
     * is a tooltip, not a name.
     */
    expect(screen.getByRole('img', { name: /lookup failed/i })).toBeInTheDocument()
  })

  it('leaves the failed warning out of the toggle name', () => {
    render(<AiEvidence toolCalls={[call(), failed()]} />)

    /* The warning lives inside the button, so naming it put the whole
       sentence into the control's name. The heading is still the name. */
    const heading = screen.getByTestId('ai-evidence-heading').textContent ?? ''
    expect(screen.getByRole('button')).toHaveAccessibleName(heading)
  })
})
