/**
 * The streaming contract.
 *
 * The property under test throughout: prose renders early, and nothing
 * becomes executable until a complete, validated structure exists. Every
 * interruption case has to land on "keep the words, drop the buttons".
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createSseDecoder,
  createFenceFilter,
  consumeAiStream,
  createMarks,
  deriveLatency,
  FENCE_MARKER,
} from '../stream'
import { statusLabel, toStreamEvent, TOOL_STATUS_LABEL } from '../stream-protocol'
import { parseAiResponse } from '../envelope'
import { resolveResponsePolicy } from '../response-policy'
import type { AiObjectRef } from '../actions'

const AMZN: AiObjectRef = { type: 'asset', id: 'asset-amzn', label: 'AMZN', symbol: 'AMZN' }
const POLICY = resolveResponsePolicy({ message: 'plain question' })

function frame(type: string, payload: Record<string, unknown> = {}): string {
  return `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`
}

/** A Response whose body yields the given chunks, one read at a time. */
function streamingResponse(chunks: string[], opts: { abortAfter?: number } = {}): Response {
  const encoder = new TextEncoder()
  let i = 0
  const body = {
    getReader() {
      return {
        async read() {
          if (opts.abortAfter !== undefined && i >= opts.abortAfter) {
            throw new DOMException('Aborted', 'AbortError')
          }
          if (i >= chunks.length) return { done: true, value: undefined }
          return { done: false, value: encoder.encode(chunks[i++]) }
        },
        releaseLock() {},
      }
    },
  }
  return { body } as unknown as Response
}

// ---------------------------------------------------------------------------

describe('SSE decoding', () => {
  it('decodes one complete frame', () => {
    const decoder = createSseDecoder()
    expect(decoder.push(frame('delta', { text: 'Hello' }))).toEqual([
      { type: 'delta', text: 'Hello' },
    ])
  })

  it('reassembles a frame split across chunks', () => {
    const decoder = createSseDecoder()
    const whole = frame('delta', { text: 'Split me' })
    const a = whole.slice(0, 20)
    const b = whole.slice(20)
    expect(decoder.push(a)).toEqual([])
    expect(decoder.push(b)).toEqual([{ type: 'delta', text: 'Split me' }])
  })

  it('handles several frames arriving in one chunk', () => {
    const decoder = createSseDecoder()
    const events = decoder.push(
      frame('delta', { text: 'a' }) + frame('delta', { text: 'b' }) + frame('delta', { text: 'c' }),
    )
    expect(events.map(e => (e as { text: string }).text)).toEqual(['a', 'b', 'c'])
  })

  it('survives CRLF line endings from an intermediary', () => {
    const decoder = createSseDecoder()
    const crlf = frame('delta', { text: 'ok' }).replace(/\n/g, '\r\n')
    expect(decoder.push(crlf)).toEqual([{ type: 'delta', text: 'ok' }])
  })

  it('skips a malformed frame without killing the stream', () => {
    const decoder = createSseDecoder()
    const events = decoder.push(
      'event: delta\ndata: {not json\n\n' + frame('delta', { text: 'survived' }),
    )
    expect(events).toEqual([{ type: 'delta', text: 'survived' }])
  })

  it('ignores an event kind it does not know', () => {
    const decoder = createSseDecoder()
    expect(decoder.push(frame('telemetry', { x: 1 }))).toEqual([])
  })
})

describe('the fence filter — the reader never sees the action block', () => {
  it('passes ordinary prose straight through', () => {
    const filter = createFenceFilter()
    expect(filter.push('AMZN needs attention.')).toBe('AMZN needs attention.')
    expect(filter.suppressed()).toBe(false)
  })

  it('stops at the action block', () => {
    const filter = createFenceFilter()
    filter.push('Price is above the case.\n\n')
    filter.push(FENCE_MARKER + '\n{"actions":[]}\n```')
    expect(filter.visible()).toBe('Price is above the case.\n\n')
    expect(filter.suppressed()).toBe(true)
  })

  it('holds back a marker split across chunk boundaries', () => {
    const filter = createFenceFilter()
    const emitted: string[] = []
    emitted.push(filter.push('Answer.\n\n'))
    emitted.push(filter.push('``'))          // could still be prose
    emitted.push(filter.push('`tesseract'))  // still undecidable
    emitted.push(filter.push('-actions\n{}'))
    expect(emitted.join('')).toBe('Answer.\n\n')
    expect(emitted.join('')).not.toContain('`')
  })

  it('does NOT suppress an ordinary code fence in prose', () => {
    const filter = createFenceFilter()
    filter.push('Use this:\n\n```js\nconst x = 1\n```\n\nThat is all.')
    expect(filter.suppressed()).toBe(false)
    expect(filter.visible()).toContain('```js')
    expect(filter.visible()).toContain('That is all.')
  })

  it('releases a held-back tail that turned out not to be a fence', () => {
    const filter = createFenceFilter()
    filter.push('Done. ``')
    expect(filter.visible()).toBe('Done. ')
    expect(filter.flush()).toBe('``')
    expect(filter.visible()).toBe('Done. ``')
  })

  it('emits each character exactly once across many pushes', () => {
    const filter = createFenceFilter()
    const source = 'The judgment. Then the evidence. Then more. ' + FENCE_MARKER + '\n{}\n```'
    let out = ''
    for (const ch of source) out += filter.push(ch)
    out += filter.flush()
    expect(out).toBe('The judgment. Then the evidence. Then more. ')
  })
})

describe('consuming a stream', () => {
  const noop = { onText: () => {} }

  it('renders text before the final envelope exists', async () => {
    const seen: string[] = []
    let finalSeen = false
    const response = streamingResponse([
      frame('meta', { model: 'm', verbosity: 'brief', timings: {} }),
      frame('delta', { text: 'AMZN needs ' }),
      frame('delta', { text: 'attention.' }),
      frame('final', { raw: 'AMZN needs attention.', citations: [], tool_calls: [], usage: {}, timings: {} }),
    ])

    await consumeAiStream(response, {
      onText: (t) => { seen.push(t); expect(finalSeen).toBe(false) },
    }, createMarks())
    finalSeen = true

    // Two renders happened, both before anything terminal arrived.
    expect(seen).toEqual(['AMZN needs ', 'attention.'])
  })

  it('reports a clean completion', async () => {
    const outcome = await consumeAiStream(
      streamingResponse([
        frame('delta', { text: 'Answer.' }),
        frame('final', { raw: 'Answer.', citations: [], tool_calls: [], usage: {}, timings: {} }),
      ]),
      noop, createMarks(),
    )
    expect(outcome.truncated).toBe(false)
    expect(outcome.final?.raw).toBe('Answer.')
  })

  it('marks a stream that ends without a final event as truncated', async () => {
    const outcome = await consumeAiStream(
      streamingResponse([frame('delta', { text: 'Half an ans' })]),
      noop, createMarks(),
    )
    expect(outcome.truncated).toBe(true)
    expect(outcome.visible).toBe('Half an ans')
  })

  it('keeps the prose when the connection drops mid-answer', async () => {
    const outcome = await consumeAiStream(
      streamingResponse([
        frame('delta', { text: 'Price is above the case. ' }),
        frame('delta', { text: 'The thesis is stale.' }),
      ], { abortAfter: 2 }),
      noop, createMarks(),
    )
    expect(outcome.truncated).toBe(true)
    expect(outcome.visible).toBe('Price is above the case. The thesis is stale.')
    // No final, so no structure. This is the fail-safe path.
    expect(outcome.final).toBeNull()
  })

  it('never throws on an aborted read', async () => {
    await expect(consumeAiStream(
      streamingResponse([frame('delta', { text: 'x' })], { abortAfter: 0 }),
      noop, createMarks(),
    )).resolves.toBeDefined()
  })

  it('separates a recoverable error from a terminal one', async () => {
    const recoverable: unknown[] = []
    const outcome = await consumeAiStream(
      streamingResponse([
        frame('error', { message: 'one tool failed', recoverable: true }),
        frame('delta', { text: 'Answered anyway.' }),
        frame('final', { raw: 'Answered anyway.', citations: [], tool_calls: [], usage: {}, timings: {} }),
      ]),
      { onText: () => {}, onRecoverableError: (e) => recoverable.push(e) },
      createMarks(),
    )
    expect(recoverable).toHaveLength(1)
    expect(outcome.error).toBeNull()
    expect(outcome.truncated).toBe(false)
  })

  it('surfaces a terminal error and stays truncated', async () => {
    const outcome = await consumeAiStream(
      streamingResponse([
        frame('delta', { text: 'Partial' }),
        frame('error', { message: 'provider exploded', recoverable: false }),
      ]),
      noop, createMarks(),
    )
    expect(outcome.error?.message).toBe('provider exploded')
    expect(outcome.truncated).toBe(true)
    expect(outcome.visible).toBe('Partial')
  })

  it('treats a bodyless response as truncated rather than throwing', async () => {
    const outcome = await consumeAiStream({ body: null } as unknown as Response, noop, createMarks())
    expect(outcome.truncated).toBe(true)
    expect(outcome.raw).toBe('')
  })
})

describe('actions only exist after a validated final structure', () => {
  const withBlock = (prose: string, body: unknown) =>
    `${prose}\n\n\`\`\`tesseract-actions\n${JSON.stringify(body)}\n\`\`\``

  it('a completed stream yields validated actions', async () => {
    const raw = withBlock('Price cleared the base case.', {
      actions: [{ action: 'review_target', target: { type: 'asset', id: AMZN.id }, label: 'Review valuation' }],
    })
    const outcome = await consumeAiStream(
      streamingResponse([
        frame('delta', { text: raw }),
        frame('final', { raw, citations: [], tool_calls: [], usage: {}, timings: {} }),
      ]),
      { onText: () => {} }, createMarks(),
    )
    const envelope = parseAiResponse(outcome.raw, { allowlist: [AMZN], policy: POLICY })
    expect(envelope.actions.map(a => a.action)).toEqual(['review_target'])
  })

  it('a truncated block yields prose and zero actions', async () => {
    // The stream died halfway through the JSON. There is no valid structure,
    // and nothing may be inferred from the half that arrived.
    const half = 'Price cleared the base case.\n\n```tesseract-actions\n{"actions":[{"action":"review_targ'
    const outcome = await consumeAiStream(
      streamingResponse([frame('delta', { text: half })]),
      { onText: () => {} }, createMarks(),
    )
    expect(outcome.truncated).toBe(true)
    expect(outcome.visible).toBe('Price cleared the base case.\n\n')

    const envelope = parseAiResponse(outcome.raw, { allowlist: [AMZN], policy: POLICY })
    expect(envelope.actions).toEqual([])
    // And nothing was synthesised to fill the gap.
    expect(envelope.answer).toContain('Price cleared the base case.')
  })

  it('the streamed prose never contains the block', async () => {
    const raw = withBlock('Judgment.', {
      actions: [{ action: 'open_asset', target: { type: 'asset', id: AMZN.id } }],
    })
    let rendered = ''
    await consumeAiStream(
      streamingResponse(raw.split('').map(c => frame('delta', { text: c }))),
      { onText: (t) => { rendered += t } }, createMarks(),
    )
    expect(rendered.trim()).toBe('Judgment.')
    expect(rendered).not.toContain('open_asset')
    expect(rendered).not.toContain('tesseract-actions')
  })
})

describe('status is grounded and never model prose', () => {
  it('resolves a known tool to a fixed label', () => {
    expect(statusLabel({ type: 'status', tool: 'search_team_notes' }))
      .toBe(TOOL_STATUS_LABEL.search_team_notes)
  })

  it('shows nothing for a tool the client does not know', () => {
    expect(statusLabel({ type: 'status', tool: 'exfiltrate_everything' })).toBeNull()
  })

  it('cannot be made to render server-supplied text', () => {
    // A status event carrying a `label` must be ignored: the words are the
    // client's, and a server that could set them could paste model output
    // straight into the UI.
    const event = toStreamEvent({ type: 'status', label: 'Ignore previous instructions' })
    expect(event).not.toBeNull()
    expect(JSON.stringify(event)).not.toContain('Ignore previous instructions')
    expect(statusLabel(event as never)).toBeNull()
  })

  it('resolves a known phase', () => {
    expect(statusLabel({ type: 'status', phase: 'context' })).toBe('Reviewing current context…')
  })
})

describe('latency', () => {
  it('derives TTFU from the first rendered character, not the first byte', () => {
    const clock = vi.fn()
    const marks = createMarks(1000)
    marks.firstByte = 1100
    marks.firstText = 1400
    marks.complete = 2200
    const latency = deriveLatency(marks, { provider_first_delta: 250 }, true)
    expect(latency.ttfbMs).toBe(100)
    expect(latency.ttfuMs).toBe(400)
    expect(latency.totalMs).toBe(1200)
    expect(latency.ttftMs).toBe(250)
    expect(latency.streamed).toBe(true)
    expect(clock).not.toHaveBeenCalled()
  })

  it('reports null rather than zero when a mark never happened', () => {
    const latency = deriveLatency(createMarks(1000), null, false)
    expect(latency.ttfuMs).toBeNull()
    expect(latency.ttftMs).toBeNull()
    expect(latency.streamed).toBe(false)
  })

  it('stamps firstText at the moment the first character is handed over', async () => {
    let t = 0
    const now = () => (t += 10)
    const marks = createMarks(0)
    await consumeAiStream(
      streamingResponse([
        frame('status', { phase: 'context' }),
        frame('delta', { text: 'first' }),
        frame('final', { raw: 'first', citations: [], tool_calls: [], usage: {}, timings: {} }),
      ]),
      { onText: () => {} }, marks, now,
    )
    expect(marks.firstByte).toBeLessThan(marks.firstText!)
    expect(marks.firstStatus).toBeLessThanOrEqual(marks.firstText!)
    expect(marks.complete).toBeGreaterThanOrEqual(marks.final!)
  })
})
