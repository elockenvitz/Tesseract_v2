import { describe, it, expect } from 'vitest'
import { parseAiResponse, describeEnvelopeContract, ENVELOPE_FENCE } from '../envelope'
import { resolveResponsePolicy } from '../response-policy'
import type { AiObjectRef } from '../actions'

const AMZN: AiObjectRef = { type: 'asset', id: 'asset-amzn', label: 'AMZN', symbol: 'AMZN' }
const OPTS = { allowlist: [AMZN], policy: resolveResponsePolicy({ message: 'plain question' }) }

function withBlock(prose: string, body: unknown): string {
  return `${prose}\n\n\`\`\`${ENVELOPE_FENCE}\n${JSON.stringify(body, null, 2)}\n\`\`\``
}

describe('the answer always survives', () => {
  it('plain prose with no block parses as prose', () => {
    const envelope = parseAiResponse('AMZN needs attention.', OPTS)
    expect(envelope.answer).toBe('AMZN needs attention.')
    expect(envelope.actions).toEqual([])
    expect(envelope.structured).toBe(false)
  })

  it('null, undefined and empty input produce an empty answer, not a throw', () => {
    for (const raw of [null, undefined, '', '   ']) {
      expect(() => parseAiResponse(raw, OPTS)).not.toThrow()
      expect(parseAiResponse(raw, OPTS).answer).toBe('')
    }
  })

  it('a malformed block costs the buttons, never the answer', () => {
    const raw = 'AMZN needs attention.\n\n```' + ENVELOPE_FENCE + '\n{ "actions": [ this is not json\n```'
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.answer).toBe('AMZN needs attention.')
    expect(envelope.actions).toEqual([])
    // And the reader is never shown the broken JSON.
    expect(envelope.answer).not.toContain('not json')
  })

  it('a block that is an array rather than an object degrades to prose', () => {
    const envelope = parseAiResponse(withBlock('Judgment.', [1, 2, 3]), OPTS)
    expect(envelope.answer).toBe('Judgment.')
    expect(envelope.actions).toEqual([])
  })

  it('strips the block from the prose the user reads', () => {
    const raw = withBlock('Price is above the case.', {
      actions: [{ action: 'review_target', target: { type: 'asset', id: AMZN.id }, label: 'Review valuation' }],
    })
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.answer).toBe('Price is above the case.')
    expect(envelope.answer).not.toContain(ENVELOPE_FENCE)
    expect(envelope.answer).not.toContain('review_target')
  })
})

describe('the UI never has to read the prose', () => {
  it('extracts actions and evidence structurally', () => {
    const raw = withBlock('AMZN needs attention.', {
      evidence: [{ label: 'Price is 12% above base case', source: 'AMZN — Price targets' }],
      actions: [
        { action: 'review_target', target: { type: 'asset', id: AMZN.id }, label: 'Review valuation', reason: 'Price cleared the base case' },
        { action: 'update_thesis', target: { type: 'asset', id: AMZN.id }, label: 'Update thesis' },
      ],
    })
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.structured).toBe(true)
    expect(envelope.actions.map(a => a.action)).toEqual(['review_target', 'update_thesis'])
    expect(envelope.evidence[0]).toEqual({
      label: 'Price is 12% above base case',
      source: 'AMZN — Price targets',
    })
  })

  it('an unsupported action inside a well-formed block still produces no button', () => {
    const raw = withBlock('Judgment.', {
      actions: [
        { action: 'execute_trade', target: { type: 'asset', id: AMZN.id }, label: 'Buy it' },
        { action: 'open_asset', target: { type: 'asset', id: 'asset-unknown' }, label: 'Open' },
      ],
    })
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.actions).toEqual([])
    expect(envelope.rejected.map(r => r.code)).toEqual(['unknown_action', 'target_not_in_context'])
  })

  it('honours the policy caps rather than the model\'s ambition', () => {
    const raw = withBlock('Judgment.', {
      evidence: Array.from({ length: 20 }, (_, i) => ({ label: `fact ${i}` })),
      actions: [
        { action: 'open_asset', target: { type: 'asset', id: AMZN.id } },
        { action: 'open_research', target: { type: 'asset', id: AMZN.id } },
        { action: 'open_chart', target: { type: 'asset', id: AMZN.id } },
        { action: 'discuss', target: { type: 'asset', id: AMZN.id } },
      ],
    })
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.actions.length).toBeLessThanOrEqual(OPTS.policy.maxActions)
    expect(envelope.evidence.length).toBeLessThanOrEqual(OPTS.policy.maxEvidence)
  })
})

describe('depth is gated by the policy, not by the model', () => {
  const deepBlock = withBlock('Short judgment.', { analysis: 'Six paragraphs of detail.' })

  it('a brief request discards an analysis block the model sent anyway', () => {
    expect(parseAiResponse(deepBlock, OPTS).analysis).toBeUndefined()
  })

  it('a deep request keeps it', () => {
    const policy = resolveResponsePolicy({ message: 'Give me a deep dive' })
    expect(parseAiResponse(deepBlock, { allowlist: [AMZN], policy }).analysis)
      .toBe('Six paragraphs of detail.')
  })
})

describe('the contract the model is given', () => {
  it('states the caps the parser actually enforces', () => {
    const policy = resolveResponsePolicy({ message: 'plain' })
    const contract = describeEnvelopeContract(policy)
    expect(contract).toContain(`At most ${policy.maxActions} actions`)
    expect(contract).toContain(`${policy.maxEvidence} evidence items`)
    expect(contract).toContain(ENVELOPE_FENCE)
  })

  it('does not promise an analysis block when the policy forbids one', () => {
    expect(describeEnvelopeContract(resolveResponsePolicy({ message: 'plain' })))
      .not.toContain('"analysis"')
    expect(describeEnvelopeContract(resolveResponsePolicy({ message: 'deep dive please' })))
      .toContain('"analysis"')
  })
})

/*
 * ── The block when the model labels it wrong ─────────────────────────────
 *
 * Reported from a real AAPL decision-analysis response: the answer ended in a
 * large dark code block full of machine-readable `evidence` and `actions`
 * arrays. The parser was running; the model had simply tagged the fence
 * ```json instead of ```tesseract-actions, so the fence regex missed it and
 * the whole block stayed in the prose.
 *
 * The envelope is now recognised by SHAPE as well as by tag: a trailing
 * fenced block that parses to a plain object whose every key belongs to the
 * envelope's own vocabulary. The second describe block below is the one that
 * matters more -- it pins the content a reader asked for that must NOT be
 * taken away by that recognition.
 */
describe('the block does not leak just because the model mislabelled it', () => {
  const BODY = {
    evidence: [{ label: 'Thesis last written 7 months ago', source: 'AAPL investment case' }],
    actions: [{ action: 'review_target', target: { type: 'asset', id: 'asset-amzn' }, label: 'Review valuation', reason: 'stale' }],
  }
  const tagged = (tag: string) =>
    `Our team approved a trim in Core Growth.\n\n\`\`\`${tag}\n${JSON.stringify(BODY, null, 2)}\n\`\`\``

  for (const tag of ['json', 'JSON', '', 'javascript', 'tesseract_actions']) {
    it(`strips the block tagged \`${tag || '(none)'}\` and keeps the answer`, () => {
      const envelope = parseAiResponse(tagged(tag), OPTS)
      expect(envelope.answer).toBe('Our team approved a trim in Core Growth.')
      /* The specific thing the reader saw. */
      expect(envelope.answer).not.toContain('evidence')
      expect(envelope.answer).not.toContain('"actions"')
      expect(envelope.answer).not.toContain('```')
    })
  }

  it('still derives the buttons and the attribution from a mislabelled block', () => {
    /* Recognising it is only half the job. Dropping its contents would be
       "silently discard source attribution", which is its own defect. */
    const envelope = parseAiResponse(tagged('json'), OPTS)
    expect(envelope.structured).toBe(true)
    expect(envelope.evidence).toHaveLength(1)
    expect(envelope.evidence[0].source).toBe('AAPL investment case')
    expect(envelope.actions).toHaveLength(1)
  })

  it('prefers a correctly tagged block over a trailing JSON one', () => {
    /* Both present. The tagged one is the envelope; the other is content. */
    const raw =
      'Here is the payload shape you asked about:\n\n```json\n{"ticker":"AAPL","weight":2.1}\n```\n\n'
      + `\`\`\`${ENVELOPE_FENCE}\n${JSON.stringify(BODY)}\n\`\`\``
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.actions).toHaveLength(1)
    expect(envelope.answer).toContain('"ticker"')
    expect(envelope.answer).toContain('```json')
  })
})

describe('it never takes away a code block the reader asked for', () => {
  const keep = (tag: string, body: string) => `As requested:\n\n\`\`\`${tag}\n${body}\n\`\`\``

  it('keeps JSON whose keys are the reader s own', () => {
    /*
     * The load-bearing case. "Every key must be an envelope key" is what
     * separates this from stripping arbitrary trailing JSON: one foreign key
     * disqualifies the entire block.
     */
    const raw = keep('json', '{\n  "evidence": "see note",\n  "ticker": "AAPL"\n}')
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.answer).toContain('"ticker"')
    expect(envelope.structured).toBe(false)
  })

  it('keeps an object that merely mentions one envelope word', () => {
    const raw = keep('json', '{ "actions": ["buy"], "portfolio": "Core Growth" }')
    expect(parseAiResponse(raw, OPTS).answer).toContain('portfolio')
  })

  it('keeps code that is not JSON at all', () => {
    const raw = keep('ts', 'const actions = []\nconst evidence = []')
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.answer).toContain('const actions')
    expect(envelope.structured).toBe(false)
  })

  it('keeps a JSON array, even one of evidence-shaped rows', () => {
    const raw = keep('json', '[{ "label": "a" }, { "label": "b" }]')
    expect(parseAiResponse(raw, OPTS).answer).toContain('"label"')
  })

  it('keeps a bare JSON object with no envelope keys at all', () => {
    const raw = keep('json', '{ "symbol": "AAPL", "weight": 2.1 }')
    expect(parseAiResponse(raw, OPTS).answer).toContain('"weight"')
  })

  it('keeps an empty object, which claims nothing', () => {
    expect(parseAiResponse(keep('json', '{}'), OPTS).answer).toContain('{}')
  })

  it('leaves a mid-answer JSON sample alone and reads only the last block', () => {
    /* The contract is "append one block after your answer". A sample inside
       an explanation is part of the explanation. */
    const raw =
      'The shape is:\n\n```json\n{"evidence":[],"actions":[]}\n```\n\nand that is all for now.'
    const envelope = parseAiResponse(raw, OPTS)
    expect(envelope.answer).toContain('"evidence"')
    expect(envelope.answer).toContain('that is all for now')
  })
})
