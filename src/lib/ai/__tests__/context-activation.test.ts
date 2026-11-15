/**
 * Clearing active context must not erase what the conversation was about.
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * `ai_conversation_tags` was answering two questions with one row set:
 * "what does the next request carry" and "what is this thread about". The
 * second is how a thread is found again -- `useAssetConversations` inner-joins
 * that table -- so deleting a row to change the request destroyed the
 * discovery record with it. Twenty messages about AAPL, one press of Clear
 * all, and the thread was gone from AAPL's conversation list for good.
 */
import { describe, it, expect } from 'vitest'
import {
  activeTags, activationKey, activationStorageKey, detachAction,
  readDeactivated, writeDeactivated,
} from '../context-activation'

const AAPL = { type: 'asset', id: 'a1', label: 'AAPL' }
const GROWTH = { type: 'portfolio', id: 'p1', label: 'Growth Composite' }

/** A store that behaves, so the happy path is tested without a browser. */
function memoryStore(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed))
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v) },
    removeItem: (k: string) => { map.delete(k) },
    get size() { return map.size },
    raw: map,
  }
}

describe('what the next request carries', () => {
  it('is the association minus what the reader turned off', () => {
    expect(activeTags([AAPL, GROWTH], new Set(['asset:a1'])))
      .toEqual([GROWTH])
  })

  it('is the whole association when nothing is off', () => {
    expect(activeTags([AAPL, GROWTH], new Set())).toHaveLength(2)
    expect(activeTags([AAPL, GROWTH], null)).toHaveLength(2)
  })

  it('is empty when everything is off, while the association is not', () => {
    /* The split, in one assertion: nothing is sent, and both rows remain. */
    const association = [AAPL, GROWTH]
    const off = new Set(['asset:a1', 'portfolio:p1'])

    expect(activeTags(association, off)).toEqual([])
    expect(association).toHaveLength(2)
  })

  it('keeps the association order, so a chip does not move when its neighbour goes', () => {
    const three = [AAPL, GROWTH, { type: 'theme', id: 't1' }]
    expect(activeTags(three, new Set(['portfolio:p1'])).map(t => t.id))
      .toEqual(['a1', 't1'])
  })

  it('drops a malformed entry rather than drawing a chip with no identity', () => {
    expect(activeTags([AAPL, { type: 'asset', id: '' }] as never, new Set()))
      .toEqual([AAPL])
  })
})

describe('detaching: deactivate or delete', () => {
  it('deactivates an object that has reached a request', () => {
    /* The conversation really was conducted with it, so the row -- and the
       discoverability it carries -- has to survive. */
    expect(detachAction(true)).toBe('deactivate')
  })

  it('deletes an object that never reached one', () => {
    /* Attached by mistake and removed before asking anything. Keeping the row
       would file the thread under an object it never discussed, which is the
       mirror of the defect this module exists for. */
    expect(detachAction(false)).toBe('delete')
  })
})

describe('the activation store', () => {
  it('round-trips a deactivated set for one conversation', () => {
    const store = memoryStore()
    writeDeactivated('c1', new Set(['asset:a1']), store)

    expect(readDeactivated('c1', store)).toEqual(new Set(['asset:a1']))
  })

  it('keeps conversations apart', () => {
    const store = memoryStore()
    writeDeactivated('c1', new Set(['asset:a1']), store)

    expect(readDeactivated('c2', store).size).toBe(0)
  })

  it('removes the entry rather than storing an empty list', () => {
    /* The entries never expire, so a reader who clears and then restores
       context would otherwise leave a key behind for every thread they
       ever touched. */
    const store = memoryStore()
    writeDeactivated('c1', new Set(['asset:a1']), store)
    writeDeactivated('c1', new Set(), store)

    expect(store.size).toBe(0)
    expect(store.raw.has(activationStorageKey('c1'))).toBe(false)
  })

  it('reads nothing for an unsaved conversation, and writes nothing', () => {
    const store = memoryStore()
    expect(readDeactivated(null, store).size).toBe(0)
    writeDeactivated(null, new Set(['asset:a1']), store)
    expect(store.size).toBe(0)
  })

  it('treats a corrupt value as nothing deactivated', () => {
    /* The safe failure is a fully active association -- the behaviour this
       had before activation existed -- not a thrown JSON.parse taking the
       pane down. */
    const store = memoryStore({ [activationStorageKey('c1')]: '{not json' })
    expect(readDeactivated('c1', store).size).toBe(0)
  })

  it('treats a value of the wrong shape as nothing deactivated', () => {
    const store = memoryStore({ [activationStorageKey('c1')]: '{"a":1}' })
    expect(readDeactivated('c1', store).size).toBe(0)
  })

  it('ignores non-string members rather than putting them in the set', () => {
    const store = memoryStore({ [activationStorageKey('c1')]: '["asset:a1",7,null]' })
    expect(readDeactivated('c1', store)).toEqual(new Set(['asset:a1']))
  })

  it('survives a store that throws on every access', () => {
    /* Private windows, blocked site data, and some embedded webviews. */
    const hostile = {
      getItem: () => { throw new Error('denied') },
      setItem: () => { throw new Error('denied') },
      removeItem: () => { throw new Error('denied') },
    }
    expect(() => readDeactivated('c1', hostile)).not.toThrow()
    expect(readDeactivated('c1', hostile).size).toBe(0)
    expect(() => writeDeactivated('c1', new Set(['asset:a1']), hostile)).not.toThrow()
  })

  it('survives an absent store', () => {
    expect(readDeactivated('c1', null).size).toBe(0)
    expect(() => writeDeactivated('c1', new Set(['x']), null)).not.toThrow()
  })
})

describe('activationKey', () => {
  it('matches the key the rest of the AI code builds', () => {
    expect(activationKey(AAPL)).toBe('asset:a1')
  })
})
