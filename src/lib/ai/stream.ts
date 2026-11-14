/**
 * AI System V2 — reading the stream.
 *
 * Three pieces, all pure or nearly so, all testable without a network:
 *
 *   parseSseChunks       bytes → typed events
 *   createFenceFilter    raw model text → the part a reader should see
 *   consumeAiStream      the two above, wired to a Response, with timing marks
 *
 * ── Why the fence filter lives here and not on the server ─────────────────
 *
 * The model writes prose and then a fenced `tesseract-actions` block. Streamed
 * verbatim, the reader watches raw JSON type itself out at the end of the
 * answer. Something has to hold it back.
 *
 * Doing that server-side would have been fewer moving parts, and it is the
 * wrong place: the edge function is Deno, cannot import this package, and
 * cannot be run by any test in this repo. The suppression rule is a
 * character-level state machine with real edge cases — a marker split across
 * two network chunks, a ```js fence in ordinary prose that must NOT trigger
 * it — and code like that belongs where it can be tested. The server forwards
 * text verbatim; the client decides what to show.
 */

import {
  toStreamEvent,
  type AiStreamEvent,
  type AiStreamFinalEvent,
} from './stream-protocol'
import { ENVELOPE_FENCE } from './envelope'

// ---------------------------------------------------------------------------
// SSE decoding
// ---------------------------------------------------------------------------

/** The opening fence, exactly. A bare ``` in prose must not match this. */
export const FENCE_MARKER = '```' + ENVELOPE_FENCE

/**
 * Incremental SSE decoder.
 *
 * Server-sent events are separated by a blank line and a single event may
 * arrive across several network chunks, so the decoder has to hold a buffer.
 * Only the `data:` lines are read — the `event:` line is redundant here
 * because every payload carries its own `type`, and trusting one field rather
 * than two removes a way for them to disagree.
 */
export function createSseDecoder() {
  let buffer = ''

  return {
    /** Feed one chunk; returns whatever complete events it completed. */
    push(chunk: string): AiStreamEvent[] {
      buffer += chunk
      const events: AiStreamEvent[] = []

      // Normalise CRLF so a proxy that rewrites line endings cannot stall
      // the decoder waiting for a delimiter that will never match.
      buffer = buffer.replace(/\r\n/g, '\n')

      let boundary = buffer.indexOf('\n\n')
      while (boundary !== -1) {
        const block = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + 2)

        const data = block
          .split('\n')
          .filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart())
          .join('\n')

        if (data && data !== '[DONE]') {
          try {
            const event = toStreamEvent(JSON.parse(data))
            if (event) events.push(event)
          } catch {
            // A malformed frame is skipped, not fatal. The stream may still
            // deliver a valid `final`; killing it here would throw away an
            // answer over one bad line.
          }
        }
        boundary = buffer.indexOf('\n\n')
      }
      return events
    },

    /** Whatever is left unterminated. Diagnostic only. */
    remainder(): string {
      return buffer
    },
  }
}

// ---------------------------------------------------------------------------
// Fence filtering
// ---------------------------------------------------------------------------

/**
 * Longest suffix of `text` that is a proper prefix of `marker`.
 *
 * This is the whole trick behind not leaking a partial fence. When the model
 * has emitted "…answer.\n\n``" we cannot yet know whether the next chunk makes
 * it the action block or a code sample, so those two backticks are held back
 * until it becomes decidable.
 */
function heldBackLength(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1)
  for (let n = max; n > 0; n--) {
    if (text.endsWith(marker.slice(0, n))) return n
  }
  return 0
}

/**
 * The envelope's own field names, as the model is told to emit them.
 *
 * Mirrors `ENVELOPE_KEYS` in `envelope.ts`. Deliberately a copy rather than
 * an import of a shared constant: this one answers a different question --
 * "could this fence be the envelope, from its first key alone" -- while the
 * parser's answers "is this whole object the envelope". A drift test keeps
 * them honest; see `stream.test.ts`.
 */
const ENVELOPE_FIRST_KEYS = ['evidence', 'actions', 'analysis', 'version', 'rejected']

/** How much of a fence body is needed before its first key is readable. */
const FENCE_LOOKAHEAD = 64

/**
 * Decide what an opening fence at `at` begins, from as little as possible.
 *
 * Returns `unknown` when too little has arrived to tell, which the caller
 * treats as "hold back" rather than as "not the envelope". That distinction
 * is the whole point: guessing "not the envelope" early is what let JSON
 * stream into view.
 */
function classifyFence(text: string, at: number): 'envelope' | 'code' | 'unknown' {
  const nl = text.indexOf('\n', at)
  /* The language tag is still arriving. */
  if (nl === -1) return text.length - at > FENCE_LOOKAHEAD ? 'code' : 'unknown'

  const body = text.slice(nl + 1)
  const head = body.replace(/^[\s]*/, '')
  if (head === '') {
    return body.length > FENCE_LOOKAHEAD ? 'code' : 'unknown'
  }
  /* The envelope is always a JSON object. Anything else is code. */
  if (head[0] !== '{') return 'code'

  const afterBrace = head.slice(1).replace(/^[\s]*/, '')
  if (afterBrace === '') {
    return head.length > FENCE_LOOKAHEAD ? 'code' : 'unknown'
  }
  if (afterBrace[0] === '}') return 'code'
  if (afterBrace[0] !== '"') return 'code'

  const closing = afterBrace.indexOf('"', 1)
  if (closing === -1) {
    /* The first key is still arriving. */
    return afterBrace.length > FENCE_LOOKAHEAD ? 'code' : 'unknown'
  }
  const firstKey = afterBrace.slice(1, closing)
  return ENVELOPE_FIRST_KEYS.includes(firstKey) ? 'envelope' : 'code'
}

export interface FenceFilter {
  /** Feed raw model text; returns the newly-displayable text, possibly ''. */
  push(text: string): string
  /** Everything received so far, fence block included. */
  raw(): string
  /** Everything displayed so far. */
  visible(): string
  /** True once the action block has started. */
  suppressed(): boolean
  /** Flush any held-back tail that turned out not to be a fence. */
  flush(): string
}

/**
 * Hold back the structured block so the reader never sees it.
 *
 * Once the marker appears, suppression is permanent for this message: text
 * after the closing fence is rare, and the final `answer` from
 * `parseAiResponse` replaces the streamed text at completion anyway, so a
 * trailing sentence is recovered rather than lost.
 */
export function createFenceFilter(marker: string = FENCE_MARKER): FenceFilter {
  let rawText = ''
  let emitted = 0
  let isSuppressed = false
  /** How far we have already cleared as "not the envelope". */
  let cleared = 0

  const displayableLength = (): number => {
    if (isSuppressed) return emitted

    const index = rawText.indexOf(marker)
    if (index !== -1) {
      isSuppressed = true
      return index
    }

    /*
     * ── The mislabelled block, mid-stream ────────────────────────────────
     *
     * The marker above is the exact `
     * ```tesseract-actions` opening. A model that tags the block ```json
     * instead sails straight past it, so the envelope's JSON streamed into
     * view as ordinary prose and was only removed at completion, when
     * `parseAiResponse` replaced the text. The reader saw a block of
     * machine-readable arrays appear and then vanish.
     *
     * So: any opening fence is held back until its first key can be read.
     * If the body opens as a JSON object whose first key belongs to the
     * envelope, suppress from the fence. Otherwise clear past it and let it
     * stream as the code block it is.
     *
     * Holding back is the safe direction. A fence held one chunk too long
     * costs a few hundred milliseconds of a code block appearing, and the
     * final answer restores it in full either way. A fence released too
     * early cannot be taken back, because `emitted` has already advanced.
     */
    let scan = cleared
    for (;;) {
      const fence = rawText.indexOf('```', scan)
      if (fence === -1) break

      const verdict = classifyFence(rawText, fence)
      if (verdict === 'envelope') {
        isSuppressed = true
        return fence
      }
      if (verdict === 'unknown') {
        /* Not enough has arrived to tell. Show everything before it. */
        return fence
      }
      /* Ordinary code. Never reconsidered, so a `
       * ```json` body that happens to contain the word "actions" later
       * cannot retroactively suppress what has already been shown. */
      scan = fence + 3
      cleared = scan
    }

    return rawText.length - heldBackLength(rawText, marker)
  }

  return {
    push(text: string): string {
      if (!text) return ''
      rawText += text
      const target = displayableLength()
      if (target <= emitted) return ''
      const delta = rawText.slice(emitted, target)
      emitted = target
      return delta
    },
    raw: () => rawText,
    visible: () => rawText.slice(0, emitted),
    suppressed: () => isSuppressed,
    flush(): string {
      // At end of stream a held-back tail was never a fence after all. The
      // exception is a truncated stream that cut off mid-marker — emitting a
      // few stray backticks is better than losing a sentence, and the final
      // reconciliation removes them when a `final` event does arrive.
      if (isSuppressed) return ''
      const delta = rawText.slice(emitted)
      emitted = rawText.length
      return delta
    },
  }
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * The marks behind the only latency number that describes the product.
 *
 * TTFU — submit to first rendered assistant character — is what a reader
 * experiences. TTFT and total are diagnostics that explain it.
 */
export interface AiStreamMarks {
  /** User pressed send. */
  submit: number
  /** First byte of any kind back from the edge function. */
  firstByte?: number
  /** First status event. Not useful output, but the end of dead silence. */
  firstStatus?: number
  /** First character actually handed to the renderer. This defines TTFU. */
  firstText?: number
  /** Terminal `final` event received. */
  final?: number
  /** Stream fully drained and reconciled. */
  complete?: number
}

export interface AiLatency {
  /** Submit → first rendered assistant character. The product metric. */
  ttfuMs: number | null
  /** Submit → first byte from the function. Transport + pre-model work. */
  ttfbMs: number | null
  /** Submit → complete. */
  totalMs: number | null
  /** Provider request start → first model text, from the server's own marks. */
  ttftMs: number | null
  /** Whether the answer actually streamed, or arrived in one piece. */
  streamed: boolean
}

export function createMarks(now: number = Date.now()): AiStreamMarks {
  return { submit: now }
}

export function deriveLatency(
  marks: AiStreamMarks,
  serverTimings: Record<string, number> | null,
  streamed: boolean,
): AiLatency {
  const since = (mark?: number) => (typeof mark === 'number' ? mark - marks.submit : null)
  const ttft = serverTimings && typeof serverTimings.provider_first_delta === 'number'
    ? serverTimings.provider_first_delta
    : null
  return {
    ttfuMs: since(marks.firstText),
    ttfbMs: since(marks.firstByte),
    totalMs: since(marks.complete ?? marks.final),
    ttftMs: ttft,
    streamed,
  }
}

// ---------------------------------------------------------------------------
// Consuming a response
// ---------------------------------------------------------------------------

export interface AiStreamHandlers {
  /** Displayable prose arrived. Called many times; append, do not replace. */
  onText(delta: string): void
  /** A grounded activity status. The caller resolves it to words. */
  onStatus?(event: Extract<AiStreamEvent, { type: 'status' }>): void
  onMeta?(event: Extract<AiStreamEvent, { type: 'meta' }>): void
  /** A recoverable error. The stream continues. */
  onRecoverableError?(event: Extract<AiStreamEvent, { type: 'error' }>): void
}

export interface AiStreamOutcome {
  /** The complete model output, or as much of it as arrived. */
  raw: string
  /** What was actually shown, fence-filtered. */
  visible: string
  /** Present only on a clean terminal completion. */
  final: AiStreamFinalEvent | null
  /**
   * True when the stream ended without a `final` event — a dropped
   * connection, a killed function, an abort. The caller keeps the prose and
   * must not derive actions from `raw`.
   */
  truncated: boolean
  marks: AiStreamMarks
  /** A terminal error the server reported, if any. */
  error: Extract<AiStreamEvent, { type: 'error' }> | null
}

/**
 * Drive one streamed response to completion.
 *
 * Never throws on stream content. An abort, a dropped socket or a malformed
 * frame all resolve to an outcome carrying whatever arrived, flagged
 * `truncated`. The caller decides what that means; nothing here invents a
 * result to make the shape look complete.
 */
export async function consumeAiStream(
  response: Response,
  handlers: AiStreamHandlers,
  marks: AiStreamMarks,
  now: () => number = Date.now,
): Promise<AiStreamOutcome> {
  const filter = createFenceFilter()
  const decoder = createSseDecoder()
  // Held on an object rather than in `let` bindings: these are written inside
  // the event closure below, and TypeScript's control-flow analysis narrows a
  // closure-assigned local back to its initial `null` at the return site.
  const settled: {
    final: AiStreamFinalEvent | null
    error: Extract<AiStreamEvent, { type: 'error' }> | null
  } = { final: null, error: null }

  const emit = (text: string) => {
    if (!text) return
    if (marks.firstText === undefined) marks.firstText = now()
    handlers.onText(text)
  }

  const handle = (event: AiStreamEvent) => {
    switch (event.type) {
      case 'meta':
        handlers.onMeta?.(event)
        break
      case 'status':
        if (marks.firstStatus === undefined) marks.firstStatus = now()
        handlers.onStatus?.(event)
        break
      case 'delta':
        emit(filter.push(event.text))
        break
      case 'final':
        marks.final = now()
        settled.final = event
        break
      case 'error':
        if (event.recoverable) handlers.onRecoverableError?.(event)
        else settled.error = event
        break
    }
  }

  const body = response.body
  if (!body) {
    // No readable stream. Not an error condition on its own — it is what a
    // non-streaming fallback response looks like — so hand back a truncated
    // outcome and let the caller fall through to its JSON path.
    return { raw: '', visible: '', final: null, truncated: true, marks, error: null }
  }

  const reader = body.getReader()
  const textDecoder = new TextDecoder()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (marks.firstByte === undefined) marks.firstByte = now()
      for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
        handle(event)
      }
    }
  } catch {
    // Abort or network failure. Everything received so far stands.
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }

  emit(filter.flush())
  marks.complete = now()

  return {
    raw: settled.final?.raw || filter.raw(),
    visible: filter.visible(),
    final: settled.final,
    truncated: settled.final === null,
    marks,
    error: settled.error,
  }
}
