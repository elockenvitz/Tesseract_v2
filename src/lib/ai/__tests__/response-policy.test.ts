import { describe, it, expect } from 'vitest'
import { resolveResponsePolicy, AI_VERBOSITIES } from '../response-policy'

describe('the default is brief and bounded', () => {
  it('an ordinary question gets the brief policy', () => {
    const policy = resolveResponsePolicy({ message: 'Is AMZN still a buy here?' })
    expect(policy.verbosity).toBe('brief')
    expect(policy.rationale).toBe('default')
  })

  it('brief is genuinely bounded, not merely advised', () => {
    const policy = resolveResponsePolicy({ message: 'What changed on AMZN?' })
    // 4096 was the old ceiling for every request. The point of the policy is
    // that the default costs a fraction of that.
    expect(policy.maxOutputTokens).toBeLessThanOrEqual(700)
    expect(policy.targetAnswerChars).toBeLessThanOrEqual(600)
    expect(policy.allowDeepBlock).toBe(false)
  })

  it('never returns an unbounded or absurd budget for any input', () => {
    const inputs = [
      '', 'hi', 'x'.repeat(5000),
      'deep dive on everything comprehensive thorough full analysis',
      'one line tl;dr deep dive',
    ]
    for (const message of inputs) {
      const p = resolveResponsePolicy({ message })
      expect(p.maxOutputTokens).toBeGreaterThan(0)
      expect(p.maxOutputTokens).toBeLessThanOrEqual(4096)
      expect(p.maxActions).toBeLessThanOrEqual(3)
    }
  })
})

describe('depth is opt-in, in the user\'s own words', () => {
  const deepAsks = [
    'Give me a deep dive on the AMZN thesis',
    'Walk me through the case in full detail',
    'I want a comprehensive review of the risks',
    'Write me a memo on this position',
    'Explain it fully',
    'Can you do a detailed breakdown',
  ]

  it.each(deepAsks)('%s → deep', (message) => {
    const policy = resolveResponsePolicy({ message })
    expect(policy.verbosity).toBe('deep')
    expect(policy.allowDeepBlock).toBe(true)
  })

  const notDeep = [
    'Why is AMZN down?',
    'How does the thesis handle margin compression?',
    'What is the bear case?',
    'Explain the catalyst',
    'Should I trim this?',
  ]

  it.each(notDeep)('%s stays brief', (message) => {
    // "why" and "how" are the most common ordinary questions. Treating them
    // as depth requests is exactly how a concise assistant regresses.
    expect(resolveResponsePolicy({ message }).verbosity).toBe('brief')
  })
})

describe('terseness is honoured', () => {
  it.each([
    'One line: is this still a buy?',
    'tl;dr on the quarter',
    'Yes or no — do we still own the thesis?',
    'Just the answer please',
  ])('%s gets a tighter budget than the default', (message) => {
    const policy = resolveResponsePolicy({ message })
    expect(policy.verbosity).toBe('brief')
    expect(policy.rationale).toBe('terse-request')
    expect(policy.maxOutputTokens).toBeLessThan(resolveResponsePolicy({ message: 'plain' }).maxOutputTokens)
  })

  it('a terse ask beats a depth phrase in the same message', () => {
    // The user contradicted themselves. Erring short is recoverable in one
    // follow-up; erring long has already cost them the wait and the tokens.
    expect(resolveResponsePolicy({ message: 'tl;dr of your comprehensive view' }).rationale)
      .toBe('terse-request')
  })
})

describe('non-chat callers get fixed policies', () => {
  it('a table column is always brief regardless of its prompt', () => {
    const policy = resolveResponsePolicy({
      message: 'Give a comprehensive deep dive on the competitive position',
      purpose: 'column',
    })
    expect(policy.verbosity).toBe('brief')
    expect(policy.rationale).toBe('purpose:column')
  })

  it('a snippet is brief', () => {
    expect(resolveResponsePolicy({ message: 'anything', purpose: 'snippet' }).verbosity).toBe('brief')
  })

  it('a structured analysis gets standard, not deep', () => {
    expect(resolveResponsePolicy({ message: 'anything', purpose: 'analysis' }).verbosity).toBe('standard')
  })
})

describe('determinism', () => {
  it('the same message always resolves identically', () => {
    const message = 'Should we add to the position given the print?'
    const first = resolveResponsePolicy({ message })
    for (let i = 0; i < 20; i++) {
      expect(resolveResponsePolicy({ message })).toEqual(first)
    }
  })

  it('an explicit override always wins', () => {
    for (const verbosity of AI_VERBOSITIES) {
      const policy = resolveResponsePolicy({ message: 'tl;dr', override: verbosity })
      expect(policy.verbosity).toBe(verbosity)
      expect(policy.rationale).toBe(`override:${verbosity}`)
    }
  })

  it('a non-string message does not throw', () => {
    expect(() => resolveResponsePolicy({ message: undefined as never })).not.toThrow()
    expect(resolveResponsePolicy({ message: null as never }).verbosity).toBe('brief')
  })
})
