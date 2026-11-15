/**
 * The one authoritative context model.
 *
 * Every assertion here is about a claim the pane makes to the reader, and the
 * reason the module exists is that the pane used to make three of them from
 * three sources. The important ones are negative: that nothing but `tags` can
 * put an object in the list, and that an event is never one.
 */
import { describe, it, expect } from 'vitest'
import { activeContext, describeActiveContext, contextKey } from '../active-context'

const AAPL = { type: 'asset', id: 'a1', label: 'AAPL' }
const GROWTH = { type: 'portfolio', id: 'p1', label: 'Growth Composite' }

const BREACH = {
  objectType: 'asset',
  objectId: 'a1',
  issue: {
    title: 'CEG is trading below every case you modelled',
    detail: 'Spot cleared the bear case on 24 August.',
  },
  seedPrompt: 'Which assumptions would need to change to justify $233?',
}

describe('the objects are the tags, and only the tags', () => {
  it('lists every tag, inherited and attached alike', () => {
    const c = activeContext({ tags: [AAPL, GROWTH], inheritedKeys: ['asset:a1'] })

    expect(c.objects.map(o => o.key)).toEqual(['asset:a1', 'portfolio:p1'])
    expect(c.objects.map(o => o.origin)).toEqual(['inherited', 'attached'])
    expect(c.inheritedCount).toBe(1)
  })

  it('is empty when the tags are, however much the entry point supplied', () => {
    /*
     * The whole defect, in one assertion.
     *
     * A reader who detaches the asset has an empty tag set. The engagement
     * target still describes a valuation breach on that asset, because
     * nothing ever clears it — and the two bands that read it went on
     * announcing the asset as supplied context. There is no parameter here
     * that could put it back.
     */
    const c = activeContext({
      tags: [],
      inheritedKeys: ['asset:a1'],
      target: BREACH,
      currentSubject: { type: 'asset', id: 'a1' },
    })

    expect(c.objects).toEqual([])
    expect(c.isEmpty).toBe(true)
    /* The orientation survives, because it is not an object. */
    expect(c.event?.title).toContain('below every case')
  })

  it('counts an object once when the entry point and the reader both named it', () => {
    const c = activeContext({
      tags: [AAPL, { type: 'asset', id: 'a1', label: 'AAPL - Apple Inc.' }],
      inheritedKeys: ['asset:a1'],
    })

    expect(c.objects).toHaveLength(1)
    expect(c.objects[0].origin).toBe('inherited')
  })

  it('skips a malformed tag rather than rendering a chip with no identity', () => {
    const c = activeContext({
      tags: [AAPL, { type: 'asset', id: '' }, { type: '', id: 'x' }] as never,
    })

    expect(c.objects.map(o => o.key)).toEqual(['asset:a1'])
  })

  it('treats an absent tag list as nothing attached, not as a crash', () => {
    expect(activeContext({ tags: null }).objects).toEqual([])
    expect(activeContext({ tags: undefined }).isEmpty).toBe(true)
  })
})

describe('the event is an orientation, not an attachment', () => {
  it('carries the surface words and the suggested question', () => {
    const c = activeContext({ tags: [AAPL], target: BREACH })

    expect(c.event).toEqual({
      title: 'CEG is trading below every case you modelled',
      detail: 'Spot cleared the bear case on 24 August.',
      seedPrompt: 'Which assumptions would need to change to justify $233?',
    })
  })

  it('is absent for a plain open, so the composer stays empty', () => {
    /*
     * Part III A. "Ask ACT AI" from an asset names no event, so there is
     * nothing to seed — and `WorkspaceActions` sends a `seedPrompt` with no
     * issue, which is exactly the case that was typing a three-clause
     * question into the box of a reader who had asked for a blank one.
     */
    const c = activeContext({
      tags: [AAPL],
      target: { objectType: 'asset', objectId: 'a1', seedPrompt: 'What is our current view of AAPL?' },
    })

    expect(c.event).toBeNull()
  })

  it('goes quiet once the reader has walked to another object', () => {
    const c = activeContext({
      tags: [AAPL],
      target: BREACH,
      currentSubject: { type: 'asset', id: 'msft' },
    })

    expect(c.event).toBeNull()
  })

  it('goes quiet when the reader dismisses it, without detaching anything', () => {
    const c = activeContext({ tags: [AAPL], target: BREACH, eventDismissed: true })

    expect(c.event).toBeNull()
    expect(c.objects).toHaveLength(1)
  })

  it('never surfaces the producer key that was rendered as "Raised by"', () => {
    const c = activeContext({
      tags: [],
      target: { ...BREACH, issue: { ...BREACH.issue, reason: 'valuationBreach' } } as never,
    })

    expect(JSON.stringify(c.event)).not.toContain('valuationBreach')
  })

  it('drops an issue whose title is only whitespace', () => {
    const c = activeContext({
      tags: [],
      target: { objectType: 'asset', objectId: 'a1', issue: { title: '   ' } },
    })

    expect(c.event).toBeNull()
  })
})

describe('the sentence form', () => {
  it('names what the next message will carry', () => {
    const c = activeContext({ tags: [AAPL, GROWTH] })

    expect(describeActiveContext(c)).toBe('ACT AI can use AAPL and Growth Composite.')
  })

  it('says so plainly when nothing is attached', () => {
    expect(describeActiveContext(activeContext({ tags: [] })))
      .toBe('No context attached. ACT AI answers from this conversation alone.')
  })

  it('leaves the event out, because the event is not sent as an object', () => {
    const c = activeContext({ tags: [AAPL], target: BREACH })

    expect(describeActiveContext(c)).toBe('ACT AI can use AAPL.')
  })
})

describe('contextKey', () => {
  it('matches the key the rest of the AI code builds', () => {
    expect(contextKey(AAPL)).toBe('asset:a1')
  })
})
