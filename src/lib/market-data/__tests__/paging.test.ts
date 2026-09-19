import { describe, it, expect } from 'vitest'

import {
  DEFAULT_PAGE_SIZE,
  POSTGREST_MAX_ROWS,
  TruncatedReadError,
  assertComplete,
  fetchAllRows,
  type PageFetcher,
} from '../paging'

/**
 * A server that behaves like PostgREST with `max_rows: 1000`: it honours a
 * range, and it caps the response whatever the client asks for.
 */
function server(totalRows: number, maxRows = POSTGREST_MAX_ROWS) {
  const calls: Array<[number, number]> = []
  const fetchPage: PageFetcher<number> = async (from, to) => {
    calls.push([from, to])
    const width = Math.min(to - from + 1, maxRows)
    const data: number[] = []
    for (let i = from; i < Math.min(from + width, totalRows); i++) data.push(i)
    return { data, error: null }
  }
  return { fetchPage, calls }
}

describe('the cap this exists for', () => {
  it('is 1000, which every unpaged read in the app currently assumes away', () => {
    expect(POSTGREST_MAX_ROWS).toBe(1000)
  })

  it('pages a universe past the cap and returns every row', () => {
    // The size this lane exists to reach. A single request returns 1000 of
    // these and a 200, which is the silent wrong answer.
    return fetchAllRows(server(5000).fetchPage, { label: 'assets' }).then(rows => {
      expect(rows.length).toBe(5000)
      expect(rows[0]).toBe(0)
      expect(rows[4999]).toBe(4999)
    })
  })

  it('stops on the first short page rather than probing past the end', async () => {
    const s = server(1500)
    await fetchAllRows(s.fetchPage, { label: 'assets' })
    // 999 + 501. Two requests, and no third to discover emptiness.
    expect(s.calls.length).toBe(2)
    expect(s.calls[0]).toEqual([0, 998])
    expect(s.calls[1]).toEqual([999, 1997])
  })

  it('makes exactly one request for a universe smaller than a page', async () => {
    const s = server(911)
    const rows = await fetchAllRows(s.fetchPage, { label: 'assets' })
    expect(rows.length).toBe(911)
    expect(s.calls.length).toBe(1)
  })

  it('handles an empty table without looping', async () => {
    const s = server(0)
    expect(await fetchAllRows(s.fetchPage)).toEqual([])
    expect(s.calls.length).toBe(1)
  })

  it('terminates when the total is an exact multiple of the page size', async () => {
    // The classic off-by-one: a full final page looks like more data, so the
    // loop must ask once more and get nothing rather than returning early or
    // spinning.
    const s = server(DEFAULT_PAGE_SIZE * 2)
    const rows = await fetchAllRows(s.fetchPage)
    expect(rows.length).toBe(DEFAULT_PAGE_SIZE * 2)
    expect(s.calls.length).toBe(3)
  })

  it('never asks for more per page than the server will return', async () => {
    const s = server(3000)
    await fetchAllRows(s.fetchPage, { pageSize: 100_000 })
    const [from, to] = s.calls[0]
    expect(to - from + 1).toBeLessThanOrEqual(POSTGREST_MAX_ROWS)
  })
})

describe('refusing to truncate', () => {
  it('throws rather than returning a prefix at the ceiling', async () => {
    await expect(fetchAllRows(server(200_000).fetchPage, { maxRows: 2000, label: 'assets' }))
      .rejects.toThrow(TruncatedReadError)
  })

  it('names the read and both numbers, so the message says where to look', async () => {
    let caught: unknown
    try {
      await fetchAllRows(server(200_000).fetchPage, { maxRows: 2000, label: 'assets' })
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(TruncatedReadError)
    const err = caught as TruncatedReadError
    expect(err.label).toBe('assets')
    expect(err.maxRows).toBe(2000)
    expect(err.message).toMatch(/silently incomplete/)
  })

  it('surfaces a server error instead of returning the rows read so far', async () => {
    const fetchPage: PageFetcher<number> = async () => ({ data: null, error: { message: 'permission denied' } })
    await expect(fetchAllRows(fetchPage, { label: 'assets' })).rejects.toThrow(/permission denied/)
  })
})

describe('assertComplete', () => {
  it('rejects a single-request read that came back exactly at the cap', () => {
    // A response of exactly 1000 rows is indistinguishable from a clipped one,
    // so it is treated as clipped. The alternative is finding out from a user
    // that a sector disappeared from a filter menu.
    const rows = Array.from({ length: POSTGREST_MAX_ROWS }, (_, i) => i)
    expect(() => assertComplete(rows, 'assets')).toThrow(TruncatedReadError)
  })

  it('passes the current universe through unchanged', () => {
    const rows = Array.from({ length: 911 }, (_, i) => i)
    expect(assertComplete(rows, 'assets')).toBe(rows)
  })
})
