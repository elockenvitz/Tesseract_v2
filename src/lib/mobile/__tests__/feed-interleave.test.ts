import { describe, expect, it } from 'vitest'
import { interleaveByKind } from '../feed-interleave'

type Entry = { kind: string; score: number; id: string }

const entry = (kind: string, score: number, id = `${kind}-${score}`): Entry => ({ kind, score, id })

/** Longest run of consecutive entries sharing a kind. */
function longestRun(entries: Entry[]): number {
  let best = 0
  let run = 0
  let prev: string | null = null
  for (const e of entries) {
    run = e.kind === prev ? run + 1 : 1
    prev = e.kind
    if (run > best) best = run
  }
  return best
}

describe('interleaveByKind', () => {
  it('alternates kinds rather than emitting them in blocks', () => {
    const input = [
      ...[5, 4, 3, 2, 1].map(s => entry('idea', s)),
      ...[5, 4, 3].map(s => entry('attention', s)),
    ]
    const out = interleaveByKind(input, { maxRun: 1 })

    expect(out).toHaveLength(8)
    // With both buckets non-empty, no two neighbours share a kind.
    const firstSix = out.slice(0, 6)
    expect(longestRun(firstSix)).toBe(1)
  })

  it('falls back to the remaining kind once others are exhausted', () => {
    const input = [
      ...[9, 8, 7, 6].map(s => entry('idea', s)),
      entry('attention', 5),
    ]
    const out = interleaveByKind(input, { maxRun: 1 })

    expect(out).toHaveLength(5)
    // The tail is unavoidably all ideas — the constraint must relax, not drop.
    expect(out.filter(e => e.kind === 'idea')).toHaveLength(4)
    expect(out.filter(e => e.kind === 'attention')).toHaveLength(1)
  })

  it('preserves relative order within a kind', () => {
    const input = [
      entry('idea', 3, 'a'),
      entry('idea', 2, 'b'),
      entry('idea', 1, 'c'),
      entry('attention', 3, 'x'),
      entry('attention', 2, 'y'),
    ]
    const out = interleaveByKind(input, { maxRun: 1 })
    const ideaOrder = out.filter(e => e.kind === 'idea').map(e => e.id)
    const attentionOrder = out.filter(e => e.kind === 'attention').map(e => e.id)

    expect(ideaOrder).toEqual(['a', 'b', 'c'])
    expect(attentionOrder).toEqual(['x', 'y'])
  })

  it('leads with the requested kind even when another scores higher', () => {
    const input = [entry('idea', 100, 'big-idea'), entry('attention', 1, 'small-attention')]
    const out = interleaveByKind(input, { maxRun: 1, leadWith: 'attention' })

    expect(out[0].id).toBe('small-attention')
  })

  it('loses nothing and is deterministic', () => {
    const input = [
      ...Array.from({ length: 7 }, (_, i) => entry('idea', 7 - i)),
      ...Array.from({ length: 4 }, (_, i) => entry('attention', 4 - i)),
      ...Array.from({ length: 2 }, (_, i) => entry('news', 2 - i)),
    ]
    const first = interleaveByKind(input, { maxRun: 1, leadWith: 'attention' })
    const second = interleaveByKind(input, { maxRun: 1, leadWith: 'attention' })

    expect(first).toHaveLength(input.length)
    expect(first.map(e => e.id)).toEqual(second.map(e => e.id))
  })

  it('handles an empty input and a single kind', () => {
    expect(interleaveByKind<Entry>([], { maxRun: 1 })).toEqual([])
    const only = [entry('idea', 2), entry('idea', 1)]
    expect(interleaveByKind(only, { maxRun: 1 })).toHaveLength(2)
  })
})
