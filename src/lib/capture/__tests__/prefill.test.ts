/**
 * The capture channel's parser.
 *
 * ── Why this is a parser and not a type ───────────────────────────────────
 *
 * `openThoughtsCapture` is a global `CustomEvent`. Anything on the page can
 * dispatch one, including a surface that has not been updated in two years,
 * so the detail is validated once here and the hosts work with the result.
 *
 * The property that matters most is the one about which forms get a prefill:
 * only the quick-thought form accepts initial values, so a prefill aimed at
 * the prompt, trade-idea or recommendation form is DROPPED here rather than
 * passed on and silently ignored at the far end. A caller that believes it
 * filled a form which then opens empty is the defect this module exists to
 * prevent, and the dropping is what makes "prefilled" true wherever it is
 * claimed.
 */
import { describe, it, expect } from 'vitest'
import {
  readCaptureOpen,
  capturePrefillProps,
  SOURCE_TITLE_MAX,
} from '../prefill'

const draft = {
  text: 'Margins held at 44% through the quarter.',
  ideaType: 'research_idea',
  sourceTitle: 'ACT AI answer, AAPL decisions',
}

describe('what opens', () => {
  it('reads a form request', () => {
    expect(readCaptureOpen({ captureType: 'prompt' })?.captureType).toBe('prompt')
  })

  it('opens the picker rather than a form it does not recognise', () => {
    /* A caller naming a form that does not exist still gets the sidebar. The
       alternative is a press that does nothing at all. */
    expect(readCaptureOpen({ captureType: 'thesis_builder' })?.captureType).toBeNull()
    expect(readCaptureOpen({})?.captureType).toBeNull()
  })

  it('has nothing to do with a detail that is not an object', () => {
    for (const junk of [null, undefined, 'idea', 7, []]) {
      expect(readCaptureOpen(junk)).toBeNull()
    }
  })

  it('carries the context, dropping blanks rather than passing empty strings', () => {
    const request = readCaptureOpen({
      captureType: 'idea', contextType: 'asset', contextId: 'a1', contextTitle: '   ',
    })!
    expect(request.contextType).toBe('asset')
    expect(request.contextId).toBe('a1')
    expect('contextTitle' in request).toBe(false)
  })
})

describe('the draft', () => {
  it('reaches the one form that can show it', () => {
    const request = readCaptureOpen({ captureType: 'idea', prefill: draft })!
    expect(request.prefill).toEqual({
      text: draft.text,
      ideaType: 'research_idea',
      sourceTitle: draft.sourceTitle,
    })
  })

  it('is dropped for a form that takes no initial values', () => {
    /* Not an oversight being documented: a prompt or a recommendation form
       opening empty after a dialog promised a draft is worse than the
       dialog never offering it. */
    for (const captureType of ['prompt', 'proposal', 'trade_idea', null]) {
      const request = readCaptureOpen({ captureType, prefill: draft })!
      expect(request.prefill).toBeUndefined()
    }
  })

  it('keeps the words exactly, apart from the blank space around them', () => {
    const body = 'Line one.\n\n  Line two, indented.\n- a list item'
    const request = readCaptureOpen({
      captureType: 'idea', prefill: { ...draft, text: `\n\n${body}\n  \n` },
    })!
    /* The reader approved what they saw. A draft that differs from the answer
       it came from is a third version of the text. */
    expect(request.prefill!.text).toBe(body)
  })

  it('refuses a draft with nothing in it', () => {
    for (const text of ['', '   \n ', 42, null, undefined]) {
      const request = readCaptureOpen({ captureType: 'idea', prefill: { ...draft, text } })!
      expect(request.prefill).toBeUndefined()
      // Still opens the form. An empty capture is recoverable; no capture is not.
      expect(request.captureType).toBe('idea')
    }
  })

  it('refuses a draft that cannot say where it came from', () => {
    /* Provenance is enforced in this codebase. Text arriving in a form from
       somewhere else with no source is how a model's sentence becomes an
       analyst's note with no trace. */
    for (const sourceTitle of ['', '  ', null, undefined, 12]) {
      const request = readCaptureOpen({ captureType: 'idea', prefill: { ...draft, sourceTitle } })!
      expect(request.prefill).toBeUndefined()
    }
  })

  it('shortens a source line to what the field holds', () => {
    const long = 'ACT AI answer, ' + 'x'.repeat(SOURCE_TITLE_MAX)
    const request = readCaptureOpen({ captureType: 'idea', prefill: { ...draft, sourceTitle: long } })!
    expect(request.prefill!.sourceTitle.length).toBe(SOURCE_TITLE_MAX)
    expect(request.prefill!.sourceTitle.endsWith('…')).toBe(true)
    // The body is never shortened. Only the one-line provenance field is.
    expect(request.prefill!.text).toBe(draft.text)
  })

  it('falls back to a plain thought rather than an idea type the column lacks', () => {
    const request = readCaptureOpen({
      captureType: 'idea', prefill: { ...draft, ideaType: 'recommendation' },
    })!
    expect(request.prefill!.ideaType).toBe('thought')
  })

  it('binds to an asset when it was given one', () => {
    const request = readCaptureOpen({
      captureType: 'idea', prefill: { ...draft, assetId: 'a-aapl' },
    })!
    expect(request.prefill!.assetId).toBe('a-aapl')
  })
})

describe('the form props', () => {
  it('maps a draft onto the four the form accepts', () => {
    expect(capturePrefillProps({ ...draft, ideaType: 'thesis', assetId: 'a1' } as never)).toEqual({
      initialContent: draft.text,
      initialIdeaType: 'thesis',
      initialSourceTitle: draft.sourceTitle,
      initialAssetId: 'a1',
    })
  })

  it('is nothing at all without a draft, so a hand-opened form starts empty', () => {
    expect(capturePrefillProps(null)).toEqual({})
    expect(capturePrefillProps(undefined)).toEqual({})
  })
})
