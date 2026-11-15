/**
 * How long an answer may be, for the questions a reader actually asks.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Depth was opt-in by VOCABULARY: "deep dive", "comprehensive", "full
 * analysis". That correctly keeps a concise assistant concise, and it missed
 * a whole class of question whose SHAPE needs room no matter which words it
 * uses. Two real messages from the reported LRCX conversation, verbatim:
 *
 *   "Let's analyze LRCX, come up with what the market is thinking about it
 *    and where we are with it in our process."
 *   "What about in general, come up with a bear and bull case for it."
 *
 * Both resolved to `brief`: 700 output tokens and a 600-character target.
 * The first is three questions in one sentence. The second asks for two
 * structured cases, and 600 characters is about ninety words for the pair.
 * The thin answers were the policy doing exactly what it was told.
 *
 * ── The rule added ───────────────────────────────────────────────────────
 *
 * `standard` -- 1,200 tokens -- for two narrow, deterministic shapes: a
 * request that names two opposed deliverables in one breath, and a message
 * carrying three or more distinct asks. Not `deep`: nothing here asked for
 * an essay, and the existing note on why "why" and "how" are not depth
 * requests applies with full force to this change too.
 *
 * No new verbosity, which matters more than it looks. The edge function
 * mirrors a directive per verbosity by hand, and `prompt-drift` fails if one
 * is missing: this change moves which existing tier is chosen, so it needs
 * no function deploy and cannot drift.
 */

import { describe, it, expect } from 'vitest'
import { resolveResponsePolicy } from '../response-policy'

/** The two messages from the reported conversation, byte for byte. */
const LRCX_FIRST =
  "Let's analyze LRCX, come up with what the market is thinking about it and where we are with it in our process."
const LRCX_SECOND =
  'What about in general, come up with a bear and bull case for it.'

describe('the reported LRCX conversation gets room to answer', () => {
  it('does not answer a three-part question in six hundred characters', () => {
    const policy = resolveResponsePolicy({ message: LRCX_FIRST })

    expect(policy.verbosity).toBe('standard')
    expect(policy.maxOutputTokens).toBeGreaterThan(700)
    expect(policy.rationale).toBe('multi-part-request')
  })

  it('gives a bear AND bull case room for both', () => {
    const policy = resolveResponsePolicy({ message: LRCX_SECOND })

    expect(policy.verbosity).toBe('standard')
    expect(policy.rationale).toBe('paired-case-request')
  })

  it('still refuses to write an essay for either', () => {
    /* `standard`, not `deep`. Neither message asked for a write-up, and the
       deep tier is what carries the long `analysis` block. */
    for (const message of [LRCX_FIRST, LRCX_SECOND]) {
      const policy = resolveResponsePolicy({ message })
      expect(policy.allowDeepBlock).toBe(false)
      expect(policy.maxOutputTokens).toBeLessThan(4096)
    }
  })
})

describe('two opposed deliverables in one breath', () => {
  const paired = [
    'Give me a bear and bull case for NVDA',
    'bull and bear on LRCX please',
    'What are the pros and cons of trimming here?',
    'Lay out both sides of the China exposure question',
    'Make the case for and against adding',
    'What is the upside and downside from here?',
    'Walk the risks and opportunities in the services mix',
  ]

  it.each(paired)('reads "%s" as needing room for two', message => {
    expect(resolveResponsePolicy({ message }).verbosity).not.toBe('brief')
  })

  it('is not fooled by a bear with no bull', () => {
    /* One case is one case. The trigger is the PAIR, not the word. */
    expect(resolveResponsePolicy({ message: 'What is the bear case for LRCX?' }).verbosity)
      .toBe('brief')
    expect(resolveResponsePolicy({ message: 'Any risks worth noting?' }).verbosity)
      .toBe('brief')
  })
})

describe('three or more asks in one message', () => {
  it('counts distinct asks, not commas', () => {
    expect(
      resolveResponsePolicy({
        message: 'Summarise the thesis, compare it to consensus, and tell me where we are in the process',
      }).verbosity,
    ).toBe('standard')
  })

  it('leaves a single question brief, however it is phrased', () => {
    const singles = [
      'What is the thesis on AAPL?',
      'Why did LRCX drop today?',
      'How does the services mix affect the case?',
      'Summarise the risks section',
      'Compare AAPL and MSFT on margin',
      'Where are we with LRCX?',
    ]
    for (const message of singles) {
      const policy = resolveResponsePolicy({ message })
      expect(policy.verbosity, message).toBe('brief')
    }
  })

  it('does not escalate on a long single question', () => {
    /* Length is not shape. A rambling one-part question is still one part,
       and this is the case a naive word- or character-count rule fails. */
    const rambling =
      'I was looking at the LRCX position this morning and noticed that the weight has drifted quite a long way from where we set it back in the spring, so what is the current weight?'
    expect(resolveResponsePolicy({ message: rambling }).verbosity).toBe('brief')
  })
})

describe('the rules that already existed still win', () => {
  it('honours an explicit short request over the shape', () => {
    /* A reader who says "yes or no" has told you something the shape cannot
       override. Terse is checked first, deliberately. */
    const policy = resolveResponsePolicy({
      message: 'Yes or no: is the bear and bull case balanced?',
    })
    expect(policy.verbosity).toBe('brief')
    expect(policy.rationale).toBe('terse-request')
  })

  it('honours an explicit depth request over the shape', () => {
    const policy = resolveResponsePolicy({
      message: 'Give me a comprehensive bear and bull case for LRCX',
    })
    expect(policy.verbosity).toBe('deep')
    expect(policy.rationale).toBe('explicit-depth-request')
  })

  it('honours the pane override over everything', () => {
    const policy = resolveResponsePolicy({
      message: 'bear and bull case please',
      override: 'brief',
    })
    expect(policy.rationale).toBe('override:brief')
  })

  it('leaves the non-chat purposes exactly where they were', () => {
    for (const purpose of ['snippet', 'column'] as const) {
      expect(resolveResponsePolicy({ message: 'bear and bull case', purpose }).verbosity)
        .toBe('brief')
    }
    expect(resolveResponsePolicy({ message: 'bear and bull case', purpose: 'analysis' }).verbosity)
      .toBe('standard')
  })
})

describe('the tiers themselves are unchanged', () => {
  it('adds no verbosity, so the edge directive cannot be missing one', () => {
    /*
     * The reason this change needs no function deploy. `prompt-drift` fails
     * when a verbosity has no directive in the edge function, and the only
     * way this change could cause that is by introducing a fourth tier.
     */
    const seen = new Set(
      [
        'What is the price?',
        'bear and bull case',
        'Summarise, compare, and tell me where we are',
        'give me a deep dive',
        'tl;dr',
      ].map(message => resolveResponsePolicy({ message }).verbosity),
    )
    for (const verbosity of seen) {
      expect(['brief', 'standard', 'deep']).toContain(verbosity)
    }
  })
})
