/**
 * A response belongs to the request that asked for it.
 *
 * The scenario every test here is really about: a reader asks about AMZN,
 * opens MSFT while it runs, and the answer lands. Nothing about MSFT may
 * change, and AMZN's answer may not be re-interpreted against MSFT's context.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  createRequestContext,
  createInFlight,
  cancelInFlight,
  shouldApplyToView,
  __resetRequestCounter,
} from '../request-context'
import { resolveResponsePolicy } from '../response-policy'
import { parseAiActions, type AiObjectRef } from '../actions'

const AMZN: AiObjectRef = { type: 'asset', id: 'asset-amzn', label: 'AMZN' }
const MSFT: AiObjectRef = { type: 'asset', id: 'asset-msft', label: 'MSFT' }
const POLICY = resolveResponsePolicy({ message: 'plain' })

function contextFor(overrides: Partial<Parameters<typeof createRequestContext>[0]> = {}) {
  return createRequestContext({
    conversationId: null,
    tags: [{ type: 'asset', id: AMZN.id }],
    allowlist: [AMZN],
    policy: POLICY,
    message: 'Is AMZN still a buy?',
    ...overrides,
  })
}

beforeEach(() => __resetRequestCounter())

describe('the snapshot is frozen', () => {
  it('gives every request a distinct id', () => {
    expect(contextFor().requestId).not.toBe(contextFor().requestId)
  })

  it('cannot be mutated after creation', () => {
    const context = contextFor()
    expect(() => { (context as { message: string }).message = 'something else' }).toThrow()
    expect(Object.isFrozen(context.allowlist)).toBe(true)
    expect(Object.isFrozen(context.allowlist[0])).toBe(true)
    expect(Object.isFrozen(context.tags[0])).toBe(true)
  })

  it('copies the arrays it was handed rather than aliasing them', () => {
    const tags = [{ type: 'asset' as const, id: AMZN.id }]
    const context = createRequestContext({
      conversationId: null, tags, allowlist: [AMZN], policy: POLICY, message: 'q',
    })
    tags.push({ type: 'asset' as const, id: MSFT.id })
    expect(context.tags).toHaveLength(1)
  })
})

describe('the request context cannot change underneath a response', () => {
  it('an answer is validated against its own allowlist, not the current one', () => {
    const context = contextFor()

    // The reader has since navigated to MSFT. If validation read live state,
    // this would produce a live button pointing at the wrong company.
    const { actions, rejected } = parseAiActions(
      [{ action: 'open_asset', target: { type: 'asset', id: MSFT.id }, label: 'Open' }],
      { allowlist: context.allowlist },
    )
    expect(actions).toEqual([])
    expect(rejected[0].code).toBe('target_not_in_context')
  })

  it('the original object stays actionable', () => {
    const context = contextFor()
    const { actions } = parseAiActions(
      [{ action: 'open_asset', target: { type: 'asset', id: AMZN.id }, label: 'Open' }],
      { allowlist: context.allowlist },
    )
    expect(actions).toHaveLength(1)
    expect(actions[0].target?.id).toBe(AMZN.id)
  })
})

describe('shouldApplyToView', () => {
  it('applies when the reader is still on the same thread', () => {
    const context = contextFor({ conversationId: 'conv-1' })
    expect(shouldApplyToView(context, { conversationId: 'conv-1', tags: [] })).toBe(true)
  })

  it('does not apply when the reader opened a different thread', () => {
    const context = contextFor({ conversationId: 'conv-1' })
    expect(shouldApplyToView(context, { conversationId: 'conv-2', tags: [] })).toBe(false)
  })

  it('does not apply when the reader started a brand new thread', () => {
    const context = contextFor({ conversationId: 'conv-1' })
    expect(shouldApplyToView(context, { conversationId: null, tags: [] })).toBe(false)
  })

  it('uses the tag set before a thread has an id', () => {
    const context = contextFor()
    expect(shouldApplyToView(context, {
      conversationId: null, tags: [{ type: 'asset', id: AMZN.id }],
    })).toBe(true)
  })

  it('AMZN’s first answer does not land in the MSFT pane', () => {
    const context = contextFor()
    expect(shouldApplyToView(context, {
      conversationId: null, tags: [{ type: 'asset', id: MSFT.id }],
    })).toBe(false)
  })

  it('ignores tag order', () => {
    const context = createRequestContext({
      conversationId: null,
      tags: [{ type: 'asset', id: AMZN.id }, { type: 'portfolio', id: 'pf-1' }],
      allowlist: [AMZN], policy: POLICY, message: 'q',
    })
    expect(shouldApplyToView(context, {
      conversationId: null,
      tags: [{ type: 'portfolio', id: 'pf-1' }, { type: 'asset', id: AMZN.id }],
    })).toBe(true)
  })

  it('a changed tag set is a different view even with the same count', () => {
    const context = contextFor()
    expect(shouldApplyToView(context, {
      conversationId: null, tags: [{ type: 'asset', id: MSFT.id }],
    })).toBe(false)
  })
})

describe('cancellation', () => {
  it('aborts a running request and reports that it did', () => {
    const request = createInFlight(contextFor())
    expect(request.controller.signal.aborted).toBe(false)
    expect(cancelInFlight(request)).toBe(true)
    expect(request.controller.signal.aborted).toBe(true)
    expect(request.status).toBe('cancelled')
  })

  it('does not claim to cancel a request that already finished', () => {
    const request = createInFlight(contextFor())
    request.status = 'done'
    expect(cancelInFlight(request)).toBe(false)
    expect(request.controller.signal.aborted).toBe(false)
  })

  it('is idempotent', () => {
    const request = createInFlight(contextFor())
    expect(cancelInFlight(request)).toBe(true)
    expect(cancelInFlight(request)).toBe(false)
  })

  it('tolerates being handed nothing', () => {
    expect(cancelInFlight(null)).toBe(false)
  })

  it('a superseded request is cancelled before the next one starts', () => {
    // What the hook does when a second question arrives.
    const first = createInFlight(contextFor())
    cancelInFlight(first)
    const second = createInFlight(contextFor())
    expect(first.controller.signal.aborted).toBe(true)
    expect(second.controller.signal.aborted).toBe(false)
    expect(first.context.requestId).not.toBe(second.context.requestId)
  })
})
