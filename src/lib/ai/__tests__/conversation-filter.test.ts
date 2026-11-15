/**
 * The rules both conversation lists obey.
 *
 * ── The defect these pin ──────────────────────────────────────────────────
 *
 * Archiving was reversible only if you could still find the thread. The
 * sidebar's search box, folder rail and reference chips filtered the live
 * list and nothing else, so a thread you archived and then searched for by
 * name was simply absent -- the box was filtering the list it had left. A
 * folder holding four archived threads read as empty while the archive
 * below it listed every archived thread in the account.
 */
import { describe, it, expect } from 'vitest'
import {
  matchesFilter, filterConversations, groupConversations,
  archiveEmptyReason, isFiltering, conversationTagKey,
} from '../conversation-filter'
import { UNFILED } from '../folders'

const T = (type: string, id: string) => ({ type, id })

const THREADS = [
  { id: 'c1', title: 'AAPL target review', folder_id: 'f-earnings', is_pinned: true, tags: [T('asset', 'a-aapl')] },
  { id: 'c2', title: 'Apple suppliers', folder_id: 'f-earnings', is_pinned: false, tags: [T('theme', 't-supply')] },
  { id: 'c3', title: 'Core Equity rebalance', folder_id: null, is_pinned: false, tags: [T('portfolio', 'p-core')] },
  { id: 'c4', title: 'IC prep', folder_id: 'f-ic', is_pinned: false, tags: [] },
]

const ids = (rows: readonly { id: string }[]) => rows.map(r => r.id)

describe('finding a thread by title', () => {
  it('matches on part of the title, whatever the case', () => {
    expect(ids(filterConversations(THREADS, { query: 'aapl' }))).toEqual(['c1'])
    expect(ids(filterConversations(THREADS, { query: 'APPLE' }))).toEqual(['c2'])
  })

  it('ignores surrounding space, so a pasted name still matches', () => {
    expect(ids(filterConversations(THREADS, { query: '  IC prep  ' }))).toEqual(['c4'])
  })

  it('leaves the list alone when the box is empty', () => {
    expect(ids(filterConversations(THREADS, { query: '   ' }))).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('finds nothing rather than everything when nothing matches', () => {
    expect(filterConversations(THREADS, { query: 'zzz' })).toEqual([])
  })

  it('does not crash on a thread with no title', () => {
    expect(filterConversations([{ id: 'x', title: null }], { query: 'a' })).toEqual([])
  })
})

describe('the folder axis', () => {
  it('shows one shelf', () => {
    expect(ids(filterConversations(THREADS, { folder: 'f-earnings' }))).toEqual(['c1', 'c2'])
  })

  it('shows the unfiled ones', () => {
    expect(ids(filterConversations(THREADS, { folder: UNFILED }))).toEqual(['c3'])
  })

  it('shows everything when no shelf is chosen', () => {
    expect(ids(filterConversations(THREADS, { folder: null })).length).toBe(4)
  })

  it('matches nothing for a folder from another organisation', () => {
    /*
     * The honest isolation claim available here. `ai_conversations` has no
     * `organization_id` -- the live table's own shape -- so ownership is the
     * boundary the database enforces and the FOLDER is the org-aware axis:
     * folders are per reader per organization. A selection naming a folder
     * from the other firm must therefore yield nothing, NOT fall back to
     * every thread, which is what an unchecked `folder_id === undefined`
     * comparison would do.
     */
    expect(filterConversations(THREADS, { folder: 'f-from-another-org' })).toEqual([])
  })

  it('excludes a row whose folder is absent, not just one whose folder is null', () => {
    /*
     * The dangerous shape. Every row from the sidebar query carries
     * `folder_id` explicitly, so a fixture of those rows cannot catch a
     * comparison that treats ABSENT as "no opinion" and lets the row
     * through -- and an absent key is exactly what a partial select, an
     * optimistic insert or a cached older row gives you. A thread of
     * unknown filing must not appear on a shelf.
     */
    const unknownFiling = [{ id: 'x', title: 'Filed somewhere' }]
    expect(filterConversations(unknownFiling, { folder: 'f-ic' })).toEqual([])
    expect(ids(filterConversations(unknownFiling, { folder: UNFILED }))).toEqual(['x'])
  })

  it('is ignored entirely on a surface with no folder rail', () => {
    /* "This surface has no folders" is not "no folder is selected". A stale
       selection must not narrow a list that cannot show the rail. */
    expect(ids(filterConversations(THREADS, { folder: 'f-ic', foldersEnabled: false })).length).toBe(4)
  })
})

describe('the reference axis', () => {
  it('shows the threads carrying one reference', () => {
    expect(ids(filterConversations(THREADS, { tag: 'asset:a-aapl' }))).toEqual(['c1'])
    expect(ids(filterConversations(THREADS, { tag: 'portfolio:p-core' }))).toEqual(['c3'])
  })

  it('excludes a thread with no references at all', () => {
    expect(ids(filterConversations(THREADS, { tag: 'theme:t-supply' }))).toEqual(['c2'])
  })

  it('builds the key the chips are keyed on', () => {
    expect(conversationTagKey({ type: 'asset', id: 'a-aapl' })).toBe('asset:a-aapl')
  })
})

describe('the three criteria together', () => {
  it('narrows by all of them at once', () => {
    expect(ids(filterConversations(THREADS, {
      query: 'apple', folder: 'f-earnings', tag: 'theme:t-supply',
    }))).toEqual(['c2'])
  })

  it('refuses a thread that satisfies two of three', () => {
    expect(filterConversations(THREADS, {
      query: 'apple', folder: 'f-ic', tag: 'theme:t-supply',
    })).toEqual([])
  })

  it('reports one thread the same way the lists do', () => {
    expect(matchesFilter(THREADS[0]!, { query: 'target', folder: 'f-earnings' })).toBe(true)
    expect(matchesFilter(THREADS[0]!, { query: 'target', folder: 'f-ic' })).toBe(false)
  })
})

describe('pinned and the rest', () => {
  it('separates them in the live list', () => {
    const g = groupConversations(THREADS, {})
    expect(ids(g.pinned)).toEqual(['c1'])
    expect(ids(g.rest)).toEqual(['c2', 'c3', 'c4'])
  })

  it('applies the filter before the split', () => {
    const g = groupConversations(THREADS, { folder: 'f-ic' })
    expect(g.pinned).toEqual([])
    expect(ids(g.rest)).toEqual(['c4'])
  })
})

describe('what the archive says when nothing matches', () => {
  it('says it is empty only when it really is', () => {
    expect(archiveEmptyReason(0, {})).toBe('Nothing is archived.')
  })

  it('names the search, so the reader knows a filter is on', () => {
    expect(archiveEmptyReason(7, { query: 'Tesla' })).toBe('No archived conversation matches Tesla.')
  })

  it('names the folder', () => {
    expect(archiveEmptyReason(7, { folder: 'f-ic' })).toBe('No archived conversation is in this folder.')
  })

  it('names the unfiled shelf separately from a folder', () => {
    expect(archiveEmptyReason(7, { folder: UNFILED })).toBe('No archived conversation is unfiled.')
  })

  it('names the reference', () => {
    expect(archiveEmptyReason(7, { tag: 'asset:a-aapl' }))
      .toBe('No archived conversation carries that reference.')
  })

  it('reports an archive with rows and no filters as empty, because the list shows them', () => {
    expect(archiveEmptyReason(7, {})).toBe('Nothing is archived.')
  })
})

describe('whether anything is narrowing the list', () => {
  it('is false with nothing set', () => {
    expect(isFiltering({})).toBe(false)
    expect(isFiltering({ query: '  ' })).toBe(false)
  })

  it('is true for each criterion on its own', () => {
    expect(isFiltering({ query: 'a' })).toBe(true)
    expect(isFiltering({ folder: UNFILED })).toBe(true)
    expect(isFiltering({ tag: 'asset:a' })).toBe(true)
  })
})
