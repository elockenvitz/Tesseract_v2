/**
 * Unsent text belonging to a requirement.
 *
 * The rule worth pinning is the one that caused the bug: a draft and the
 * saved text are different things. An empty draft is no draft, a saved note
 * clears its draft, and nothing here may throw when the store is
 * unavailable — a lost draft must not take the requirement surface down.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { draftKey, readDraft, writeDraft, clearDraft } from '../requirement-drafts'

const KEY = draftKey('item_abc', 'notes')

describe('keying', () => {
  it('keys on the requirement and the field', () => {
    expect(draftKey('item_abc', 'notes')).toBe('tesseract:requirement-draft:item_abc:notes')
    expect(draftKey('item_abc', 'comment')).toBe('tesseract:requirement-draft:item_abc:comment')
  })

  it('keeps two requirements apart', () => {
    expect(draftKey('a', 'notes')).not.toBe(draftKey('b', 'notes'))
  })

  it('has no key for an item with no identity yet', () => {
    expect(draftKey(null, 'notes')).toBeNull()
    expect(draftKey(undefined, 'notes')).toBeNull()
    // And the accessors are no-ops rather than throwing on it.
    expect(readDraft(null)).toBeNull()
    expect(() => writeDraft(null, 'x')).not.toThrow()
    expect(() => clearDraft(null)).not.toThrow()
  })
})

describe('a draft outlives its card', () => {
  beforeEach(() => sessionStorage.clear())

  it('round-trips typed text', () => {
    writeDraft(KEY, 'half a thought')
    expect(readDraft(KEY)).toBe('half a thought')
  })

  it('reads null when nothing was typed', () => {
    expect(readDraft(KEY)).toBeNull()
  })

  it('treats empty and whitespace-only text as no draft', () => {
    writeDraft(KEY, 'something')
    writeDraft(KEY, '   \n ')
    // Otherwise an editor emptied and left would reopen itself next visit
    // and claim unsaved work.
    expect(readDraft(KEY)).toBeNull()
  })

  it('keeps leading and trailing space inside a real draft', () => {
    writeDraft(KEY, '  mid-sentence ')
    expect(readDraft(KEY)).toBe('  mid-sentence ')
  })

  it('clears on save', () => {
    writeDraft(KEY, 'about to be saved')
    clearDraft(KEY)
    expect(readDraft(KEY)).toBeNull()
  })
})

describe('an unavailable store is not an error', () => {
  const realGet = Storage.prototype.getItem
  const realSet = Storage.prototype.setItem
  const realRemove = Storage.prototype.removeItem

  beforeEach(() => {
    // What a private window or blocked site data does.
    const boom = () => { throw new DOMException('denied', 'SecurityError') }
    Storage.prototype.getItem = vi.fn(boom)
    Storage.prototype.setItem = vi.fn(boom)
    Storage.prototype.removeItem = vi.fn(boom)
  })
  afterEach(() => {
    Storage.prototype.getItem = realGet
    Storage.prototype.setItem = realSet
    Storage.prototype.removeItem = realRemove
  })

  it('reads null, writes nothing and clears nothing, without throwing', () => {
    expect(readDraft(KEY)).toBeNull()
    expect(() => writeDraft(KEY, 'text')).not.toThrow()
    expect(() => clearDraft(KEY)).not.toThrow()
  })
})
