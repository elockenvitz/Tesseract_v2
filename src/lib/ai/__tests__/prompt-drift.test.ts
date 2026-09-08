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
