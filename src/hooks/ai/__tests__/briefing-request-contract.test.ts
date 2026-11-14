/**
 * The briefing's request and response contract against `ai-chat`.
 *
 * ── Why this test exists ────────────────────────────────────────────────
 *
 * `useAssetBriefing` talks to the edge function over raw `fetch`, by hand. The
 * component tests mock the hook, and the hook cannot be exercised against the
 * real function from a unit test, so every field name in that exchange is
 * currently checked by nothing at all.
 *
 * The failure mode is specific and silent. Rename `response` to `answer` in
 * `ai-chat`, or stop accepting `tags`, and every briefing in the product
 * returns an empty answer -- which the hook correctly reports as a failure, so
 * the reader sees "Retry" forever while the type checker, the unit suites and
 * the edge function's own tests all stay green. Nothing in the repo connects
 * the two halves.
 *
 * ── Why it reads source text, which is normally the wrong thing ─────────
 *
 * The rule in this codebase is to assert behaviour and not source text. This
 * is the documented exception: an edge function runs on Deno and cannot be
 * imported into a Vitest process, so there is no behaviour to call. The same
 * pattern already guards the presentation contract in
 * `src/lib/ai/__tests__/answer-format.test.ts`.
 *
 * What that buys and what it does not: this proves the two sides agree on the
 * NAMES. It cannot prove the function returns a useful answer. That needs a
 * real session against a deployed function, which is browser work.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')

const HOOK = read('src/hooks/ai/useAssetBriefing.ts')
const EDGE = read('supabase/functions/ai-chat/index.ts')

/**
 * Every `{...}` that follows `marker`, brace-matched rather than regexed.
 *
 * A lazy regex cannot do this: `JSON.stringify({[\s\S]*?})` either stops at
 * the first inner brace or, with a looser terminator, swallows the next three
 * payloads and reports them as one. Counting braces from the opening one is
 * the only way to get the actual object.
 *
 * Counting is safe here only because these payloads are flat field lists. A
 * template literal containing a brace would break it, which is why each
 * extracted span is short and the caller asserts on its content.
 */
function objectLiteralsAfter(src: string, marker: string): string[] {
  const out: string[] = []
  for (let i = src.indexOf(marker); i >= 0; i = src.indexOf(marker, i + 1)) {
    const open = src.indexOf('{', i + marker.length - 1)
    if (open < 0 || open > i + marker.length + 2) continue
    let depth = 0
    for (let j = open; j < src.length; j++) {
      if (src[j] === '{') depth++
      else if (src[j] === '}') {
        depth--
        if (depth === 0) { out.push(src.slice(open, j + 1)); break }
      }
    }
  }
  return out
}

/**
 * The non-streaming JSON payload, narrowed to just that object literal.
 *
 * This narrowing is the whole test. A first version of it searched the entire
 * edge file for `response:` and so passed against a deliberately renamed
 * field, because `response:` also appears in a type declaration, in an
 * internal result object and in the provider adapter. Searching a 3,500-line
 * file for a field name proves only that the name occurs somewhere in it.
 */
const RESPONSE_PAYLOAD = (() => {
  /*
   * Selected by CONTENT, not by position, and asserted unique.
   *
   * Positional selection failed twice here, which is why it is written this
   * way. Taking the first such payload picks the streaming branch; taking the
   * last picks the error payload in the catch block, whose formatting is
   * identical. Both read as a passing test of nothing.
   *
   * `usage` and `citations` appear together in exactly one payload: the
   * non-streaming success response. If that ever stops being true, the
   * uniqueness check below fails rather than the selection quietly drifting.
   */
  const payloads = objectLiteralsAfter(EDGE, 'JSON.stringify(')
    .filter(p => p.includes('usage:') && p.includes('citations:'))
  if (payloads.length !== 1) {
    throw new Error(
      `expected exactly one ai-chat success payload, found ${payloads.length}`,
    )
  }
  return payloads[0]
})()

describe('what the briefing sends', () => {
  it('sends every field the function reads off the body, under that name', () => {
    /*
     * Asserted in this direction on purpose. The function reading a field the
     * briefing never sends is fine -- most of its callers send more than this
     * one does. The briefing sending a field under a name the function does
     * not read is the bug, because it looks like it was sent.
     */
    for (const field of ['message', 'purpose', 'conversationHistory', 'tags']) {
      expect(HOOK, `the briefing does not send \`${field}\``).toContain(`${field}:`)
      expect(EDGE, `\`ai-chat\` does not read \`body.${field}\``).toContain(`body.${field}`)
    }
  })

  it('sends a purpose the function actually branches on', () => {
    /* An unrecognised purpose does not error. It silently falls through to
       whatever the default branch is, which for a briefing means the wrong
       verbosity and the wrong tool budget. */
    const purpose = HOOK.match(/purpose:\s*'([a-z_]+)'/)?.[1]
    expect(purpose, 'the briefing sends no literal purpose').toBeTruthy()
    expect(EDGE).toMatch(new RegExp(`purpose === ['"]${purpose}['"]`))
  })

  it('tags the asset with the type the function dispatches on', () => {
    /* `ai-chat` switches on `context.type === "asset"` to decide what to
       retrieve. A tag typed anything else reaches the model with no asset
       context at all, and the model then answers from the question alone --
       fluently, and about nothing. */
    const type = HOOK.match(/type:\s*'([a-z_]+)'\s*,\s*id:/)?.[1]
    expect(type, 'the briefing sends no literal tag type').toBe('asset')
    expect(EDGE).toMatch(/context\.type === ["']asset["']/)
  })

  it('authorizes as the reader, never as the service role', () => {
    /*
     * The whole permission story depends on this one header. `ai-chat` builds
     * its Supabase client from the forwarded Authorization header, so the
     * reader's own RLS applies to every lookup the briefing triggers. A
     * service-role key here would silently brief one reader on another firm's
     * records.
     */
    expect(HOOK).toMatch(/Authorization:\s*`Bearer \$\{[^}]*access_token\}`/)
    expect(HOOK).not.toMatch(/SERVICE_ROLE|service_role/)
    expect(EDGE).toContain('Authorization: authHeader')
  })
})

describe('what the briefing reads back', () => {
  it('reads the fields the function emits, under those names', () => {
    for (const field of ['response', 'tool_calls']) {
      expect(HOOK, `the briefing does not read \`${field}\``).toContain(`body?.${field}`)
      expect(
        RESPONSE_PAYLOAD,
        `\`ai-chat\`'s success payload has no \`${field}\` field:\n${RESPONSE_PAYLOAD}`,
      ).toMatch(new RegExp(`\\b${field}:`))
    }
  })

  it('finds a payload to check at all, rather than silently checking nothing', () => {
    /* The slice above is derived by string search. If `ai-chat` is reformatted
       so the search misses, every assertion against it would pass against an
       empty string. This is the assertion that notices. */
    expect(RESPONSE_PAYLOAD.length).toBeGreaterThan(80)
    expect(RESPONSE_PAYLOAD.startsWith('{')).toBe(true)
    expect(RESPONSE_PAYLOAD.endsWith('}')).toBe(true)
    /* And it is the success payload, not the error one from the catch block --
       the mistake this selector made on its first two attempts. */
    expect(RESPONSE_PAYLOAD).not.toContain('An error occurred')
    /* One object, not several run together, which is how the lazy-regex
       version of this selector failed. */
    expect(RESPONSE_PAYLOAD.match(/\}\),/g)).toBeNull()
  })

  it('treats an empty answer as a failure rather than rendering a blank card', () => {
    /* A briefing that renders nothing looks like a briefing that found
       nothing, which is the one conclusion this feature may not imply by
       accident. */
    expect(HOOK).toMatch(/throw new Error\([^)]*\)/)
    expect(HOOK).toMatch(/text\.trim\(\)|!text/)
  })

  it('does not ask for a stream, which it is not built to read', () => {
    /* `stream: true` changes the response from JSON to SSE. This hook parses
       `res.json()`, so asking for a stream would fail on the first chunk. */
    expect(HOOK).not.toMatch(/stream:\s*true/)
  })
})
