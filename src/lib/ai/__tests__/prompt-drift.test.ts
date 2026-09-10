/**
 * The edge function and this contract must not drift apart.
 *
 * `supabase/functions/ai-chat/index.ts` is Deno and cannot import from `src`,
 * so the action vocabulary and the verbosity directives are mirrored there by
 * hand. That is a normal arrangement and a well-known way to end up with a
 * prompt that promises the model an action the client then silently discards,
 * or a verbosity the server has no directive for and quietly ignores.
 *
 * These tests read the function source and fail on exactly that.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { AI_ACTION_IDS } from '../actions'
import { AI_VERBOSITIES } from '../response-policy'
import { ENVELOPE_FENCE } from '../envelope'
import { AI_STREAM_EVENT_TYPES, TOOL_STATUS_LABEL } from '../stream-protocol'

const SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/functions/ai-chat/index.ts'),
  'utf8',
)

function vocabularyBlock(): string {
  const match = SOURCE.match(/const ACTION_VOCABULARY = `([\s\S]*?)`;/)
  expect(match, 'ACTION_VOCABULARY not found in the edge function').toBeTruthy()
  return match![1]
}

describe('the action vocabulary the model is taught', () => {
  it('lists exactly the ids the client enforces', () => {
    const listed = [...vocabularyBlock().matchAll(/^- ([a-z_]+) \(target:/gm)]
      .map(m => m[1])
      .sort()
    expect(listed).toEqual([...AI_ACTION_IDS])
  })

  it('states a target for every action', () => {
    for (const line of vocabularyBlock().split('\n').filter(l => l.startsWith('- '))) {
      expect(line).toMatch(/\(target: [a-z|]+\)/)
    }
  })
})

describe('the verbosity contract', () => {
  it('the edge function has a directive for every verbosity the client can send', () => {
    const block = SOURCE.match(/const VERBOSITY_DIRECTIVE: Record<Verbosity, string> = \{([\s\S]*?)\n\};/)
    expect(block, 'VERBOSITY_DIRECTIVE not found').toBeTruthy()
    for (const verbosity of AI_VERBOSITIES) {
      expect(block![1]).toContain(`${verbosity}: \``)
    }
  })

  it('the edge function has a token ceiling for every verbosity', () => {
    const block = SOURCE.match(/const VERBOSITY_MAX_TOKENS: Record<Verbosity, number> = \{([\s\S]*?)\};/)
    expect(block).toBeTruthy()
    for (const verbosity of AI_VERBOSITIES) {
      expect(block![1]).toMatch(new RegExp(`${verbosity}:\\s*\\d+`))
    }
  })

  it('the server union matches the client union', () => {
    const union = SOURCE.match(/type Verbosity = ([^;]+);/)
    expect(union).toBeTruthy()
    const serverValues = [...union![1].matchAll(/'([a-z]+)'/g)].map(m => m[1]).sort()
    expect(serverValues).toEqual([...AI_VERBOSITIES])
  })

  it('brief is the server default, matching the client default', () => {
    expect(SOURCE).toMatch(/const DEFAULT_VERBOSITY: Verbosity = 'brief'/)
  })
})

describe('the envelope contract', () => {
  it('the fence the server asks for is the fence the client parses', () => {
    // The directive is built inside a template literal, so its backticks are
    // escaped in the source. Strip the escapes before comparing.
    expect(SOURCE.replace(/\\`/g, '`')).toContain('```' + ENVELOPE_FENCE)
  })

  it('the server tells the model ids must come from its context', () => {
    // This instruction is what makes the allowlist rejection rare rather than
    // routine. The enforcement is client-side either way, but a model that is
    // never told the rule wastes output on actions that are always discarded.
    expect(SOURCE).toContain('must be an object id that appeared in the context')
  })
})

describe('latency instrumentation', () => {
  it('the model call is inside a timed phase', () => {
    expect(SOURCE).toMatch(/phase\("model"/)
  })

  it('every phase that costs a network hop is measured', () => {
    for (const name of ['auth', 'attribution', 'preflight', 'context', 'model']) {
      expect(SOURCE, `phase "${name}" is not timed`).toContain(`phase("${name}"`)
    }
  })

  it('the pre-flight reads fan out instead of running in series', () => {
    // Twelve serial database round-trips stood between the request arriving
    // and the model being called. None of the first eight depended on each
    // other's answer. This asserts the fan-out is still there — a later edit
    // that re-serialises one of them would otherwise be invisible until
    // someone timed a request by hand.
    for (const fn of [
      /async function resolveAttribution[\s\S]*?await Promise\.all\(\[/,
      /async function getEffectiveAIConfig[\s\S]*?await Promise\.all\(\[/,
      /async function getCurrentUsage[\s\S]*?await Promise\.all\(\[/,
      /async function buildContextDocuments[\s\S]*?await Promise\.all\(\[/,
    ]) {
      expect(SOURCE).toMatch(fn)
    }
  })

  it('the per-tag context reads fan out too', () => {
    expect(SOURCE).toMatch(/await Promise\.all\(tags\.map/)
  })

  it('the document path has a total context ceiling', () => {
    // MAX_CONTEXT_CHARS used to apply only to buildContextPrompt, which is the
    // branch the default provider does not take.
    expect(SOURCE).toContain('function capDocuments')
    expect(SOURCE).toMatch(/documents = trimmed\.documents/)
  })
})

describe('the streaming seam', () => {
  it('streaming is opt-in per request', () => {
    expect(SOURCE).toMatch(/const wantsStream: boolean = body\.stream === true/)
  })

  it('rate limits and config errors stay HTTP status codes, not stream frames', () => {
    // A 429 buried in an SSE frame would look to every existing caller like a
    // successful empty answer. The gate must precede the stream branch.
    const gate = SOURCE.indexOf('code: \'rate_limit_exceeded\'')
    const branch = SOURCE.indexOf('if (wantsStream)')
    expect(gate).toBeGreaterThan(-1)
    expect(branch).toBeGreaterThan(gate)
  })

  it('emits only the event kinds the client can decode', () => {
    const emitted = new Set(
      [...SOURCE.matchAll(/\bsend\("([a-z]+)"/g)].map(m => m[1]),
    )
    for (const kind of emitted) {
      expect(AI_STREAM_EVENT_TYPES as readonly string[]).toContain(kind)
    }
    // And the ones the reader depends on are actually sent.
    for (const kind of ['meta', 'status', 'delta', 'final', 'error']) {
      expect(emitted.has(kind), `never sends "${kind}"`).toBe(true)
    }
  })

  it('status carries a tool name, never a label the server wrote', () => {
    expect(SOURCE).toMatch(/send\("status", \{ tool: name/)
    expect(SOURCE).not.toMatch(/send\("status", \{ label/)
  })

  it('every tool it can report is one the client has words for', () => {
    const block = SOURCE.match(/const RESEARCH_TOOLS = \[([\s\S]*?)\n\] as const;/)
    expect(block).toBeTruthy()
    const names = [...block![1].matchAll(/name: "([a-z_]+)"/g)].map(m => m[1]).sort()
    expect(names).toEqual(Object.keys(TOOL_STATUS_LABEL).sort())
  })

  it('asks Anthropic for a stream and parses the documented event set', () => {
    expect(SOURCE).toMatch(/stream: true/)
    for (const event of [
      'message_start', 'content_block_start', 'content_block_delta',
      'content_block_stop', 'message_delta',
    ]) {
      expect(SOURCE, `does not handle ${event}`).toContain(`"${event}"`)
    }
    for (const delta of ['text_delta', 'input_json_delta', 'citations_delta']) {
      expect(SOURCE, `does not handle ${delta}`).toContain(`"${delta}"`)
    }
  })

  it('a provider that cannot stream still delivers the whole answer', () => {
    expect(SOURCE).toMatch(/if \(!canStream && result\.response\)/)
  })

  it('a terminal error sends no final event after it', () => {
    // The client's fail-safe depends on `final` being absent when the answer
    // is incomplete. An error path that also sent `final` would hand it a
    // structure to parse out of a half-written answer.
    const streamBlock = SOURCE.slice(SOURCE.indexOf('if (wantsStream)'))
    const errorSend = streamBlock.indexOf('send("error"')
    const finalSend = streamBlock.indexOf('send("final"')
    expect(finalSend).toBeGreaterThan(-1)
    expect(errorSend).toBeGreaterThan(finalSend)
  })
})

describe('legacy caller routing', () => {
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

  it('the inline editor routes as a snippet and no longer sends a dead model field', () => {
    const source = read('src/components/rich-text-editor/RichTextEditor.tsx')
    const body = source.slice(source.indexOf('handleAISubmit'), source.indexOf('const editor = useEditor'))
    expect(body).toMatch(/purpose: 'snippet'/)
    expect(body).not.toMatch(/model: model \|\| 'claude'/)
  })

  it('the smart-input prompt modal routes as a snippet', () => {
    const source = read('src/components/smart-input/AIPromptModal.tsx')
    expect(source).toMatch(/purpose: 'snippet'/)
  })

  it('no chat caller relies on a hand-written length instruction', () => {
    // Length is the response policy's job. A rule pasted into the user's own
    // message is a rule the next sentence can argue with.
    const source = read('src/hooks/useSmartInput.ts')
    // The instruction is gone from the request; only the comment explaining
    // its removal mentions it.
    expect(source).not.toMatch(/message: `[^`]*2-3 sentences max/)
    expect(source).toMatch(/verbosity: snippetPolicy\.verbosity/)
  })

  it('every ai-chat caller in the repo declares a purpose', () => {
    // A caller with no purpose falls through to the full chat model, which is
    // how the inline editor ran the most expensive route for the shortest
    // output in the product.
    const callers = [
      'src/hooks/useAI.ts',
      'src/hooks/useGenerateAIColumn.ts',
      'src/hooks/useSmartInput.ts',
      'src/hooks/useContributions.ts',
      'src/components/rich-text-editor/RichTextEditor.tsx',
      'src/components/smart-input/AIPromptModal.tsx',
    ]
    for (const file of callers) {
      const source = read(file)
      const bodies = [...source.matchAll(/body: JSON\.stringify\(\{([\s\S]{0,900}?)\}\),/g)]
        .map(m => m[1])
        .filter(b => b.includes('message:'))
      expect(bodies.length, `no ai-chat body found in ${file}`).toBeGreaterThan(0)
      for (const body of bodies) {
        expect(body, `a request in ${file} sends no purpose`).toMatch(/purpose:/)
      }
    }
  })
})

describe('the existing AI path is preserved', () => {
  it('structured output stays opt-in per request', () => {
    // The column generator, the inline editor and the smart input all post to
    // this function without a `structured` flag and must keep getting plain
    // prose with no fenced block appended.
    expect(SOURCE).toMatch(/const structured: boolean = body\.structured === true/)
  })

  it('the old single-`context` request shape is still accepted', () => {
    expect(SOURCE).toContain('body.context && body.context.type && body.context.id')
  })

  it('the response still carries the fields existing clients read', () => {
    for (const field of ['response:', 'usage:', 'model:', 'citations:', 'tool_calls:']) {
      expect(SOURCE).toContain(field)
    }
  })
})
