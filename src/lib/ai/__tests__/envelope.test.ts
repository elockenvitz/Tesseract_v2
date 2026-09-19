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
