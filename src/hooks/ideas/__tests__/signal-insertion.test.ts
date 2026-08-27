import { describe, expect, it } from 'vitest'

import { insertSignalsIntoFeed } from '../useSignalCards'

/**
 * The desktop Ideas feed's editorial pacing, and the feed it silently emptied.
 *
 * Pacing exists so machine-generated cards do not crowd out a busy feed. On a
 * sparse one there is nothing to crowd — and a new workspace, where the signals
 * are the only thing to read, was exactly where none of them appeared.
 */

const signal = (id: string, priority: number) => ({
  id,
  type: 'signal' as const,
  signalType: 'attention_cluster' as const,
  headline: id,
  body: id,
  relatedAssets: [],
  createdAt: '2026-08-26T00:00:00.000Z',
  priority,
})

const post = (id: string) => ({ id, type: 'quick_thought', content: id })

const idsOf = (feed: any[]) => feed.map(x => x.id)

describe('insertSignalsIntoFeed', () => {
  it('shows a signal even when there is only one post to pace against', () => {
    /**
     * The defect. The first insert point is 2 and the counter only ever reaches
     * `feedItems.length`, so a workspace with one post rendered ZERO signal
     * cards — not fewer, none — with the signals computed and sitting unread in
     * the array.
     */
    const out = insertSignalsIntoFeed([post('a')], [signal('s1', 0.9)])
    expect(idsOf(out)).toEqual(['a', 's1'])
  })

  it('drops nothing at the tail when the insert points run out', () => {
    const posts = Array.from({ length: 4 }, (_, i) => post(`p${i}`))
    const signals = [signal('s1', 0.9), signal('s2', 0.8), signal('s3', 0.7)]
    const out = insertSignalsIntoFeed(posts, signals)

    for (const s of signals) expect(idsOf(out)).toContain(s.id)
  })

  it('still paces the ones it can place, highest priority first', () => {
    const posts = Array.from({ length: 8 }, (_, i) => post(`p${i}`))
    const out = idsOf(insertSignalsIntoFeed(posts, [signal('low', 0.2), signal('high', 0.9)]))

    // First signal after two posts, and the stronger one leads.
    expect(out[2]).toBe('high')
    expect(out.indexOf('high')).toBeLessThan(out.indexOf('low'))
    // Human content still anchors the opening.
    expect(out.slice(0, 2)).toEqual(['p0', 'p1'])
  })

  it('appends the overflow after the content it was meant to follow', () => {
    const out = idsOf(insertSignalsIntoFeed([post('a'), post('b')], [signal('s1', 0.9)]))
    expect(out.indexOf('s1')).toBeGreaterThan(out.indexOf('b'))
  })

  it('leaves a feed with no signals exactly as it was', () => {
    const posts = [post('a'), post('b')]
    expect(insertSignalsIntoFeed(posts, [])).toBe(posts)
  })

  it('shows signals on a feed with no posts at all', () => {
    const out = insertSignalsIntoFeed([], [signal('s1', 0.9), signal('s2', 0.5)])
    expect(idsOf(out)).toEqual(['s1', 's2'])
  })
})
