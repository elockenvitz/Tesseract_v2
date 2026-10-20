/**
 * Audience reachability.
 *
 * The assertions that matter most are the ones about a SAVED audience: the
 * picker must never be the reason a stored target disappears. A node the
 * author can no longer pick, or that nobody is a member of any more, still has
 * to appear and stay selected, because confirming a list that omits it is
 * exactly how an audience changes without anyone deciding to change it.
 */

import { describe, it, expect } from 'vitest'
import {
  buildAudienceOptions,
  isLevelSelectable,
  unreachableReason,
  emptyLevelReason,
  type AudienceNode,
} from '../audience-reach'

const node = (id: string, name: string, type = 'team'): AudienceNode =>
  ({ id, name, node_type: type, parent_id: null })

const counts = (o: Record<string, number>) => new Map(Object.entries(o))

describe('reachability reflects DIRECT membership only', () => {
  it('marks a node with direct members reachable', () => {
    const [opt] = buildAudienceOptions({
      candidates: [node('t1', 'Alpha')],
      storedTargetIds: [],
      memberCounts: counts({ t1: 3 }),
    })
    expect(opt.reachable).toBe(true)
    expect(opt.memberCount).toBe(3)
    expect(unreachableReason(opt)).toBeNull()
  })

  it('marks a node with no direct members unreachable, whatever sits beneath it', () => {
    // The division in the fixture hierarchy: real descendants, no direct members.
    const [opt] = buildAudienceOptions({
      candidates: [node('div', 'Equity', 'division')],
      storedTargetIds: [],
      memberCounts: counts({ team_under_div: 9 }),
    })
    expect(opt.reachable).toBe(false)
    expect(opt.memberCount).toBe(0)
    expect(unreachableReason(opt)).toMatch(/direct member/i)
    expect(unreachableReason(opt)).toMatch(/beneath it are not included/i)
  })

  it('treats an absent count as zero rather than unknown', () => {
    const [opt] = buildAudienceOptions({
      candidates: [node('t1', 'Alpha')],
      storedTargetIds: [],
      memberCounts: counts({}),
    })
    expect(opt.reachable).toBe(false)
  })
})

describe('a saved audience is never dropped by the picker', () => {
  it('includes a stored target the author could not pick today', () => {
    const opts = buildAudienceOptions({
      candidates: [node('t1', 'Alpha')],
      storedTargetIds: ['gone'],
      memberCounts: counts({ t1: 2, gone: 4 }),
      storedNodes: [node('gone', 'Team The Author Left')],
    })
    const stored = opts.find(o => o.id === 'gone')
    expect(stored).toBeDefined()
    expect(stored!.selected).toBe(true)
    expect(stored!.storedOnly).toBe(true)
    expect(stored!.name).toBe('Team The Author Left')
  })

  it('still includes a stored target nothing can name', () => {
    const opts = buildAudienceOptions({
      candidates: [],
      storedTargetIds: ['orphan'],
      memberCounts: counts({}),
    })
    expect(opts).toHaveLength(1)
    expect(opts[0].selected).toBe(true)
    expect(opts[0].name).toBe('Unknown group')
  })

  it('keeps a stored target selected even when it is unreachable', () => {
    const opts = buildAudienceOptions({
      candidates: [node('dept', 'Research', 'department')],
      storedTargetIds: ['dept'],
      memberCounts: counts({ dept: 0 }),
    })
    expect(opts[0].selected).toBe(true)
    expect(opts[0].reachable).toBe(false)
    // Flagged for explanation — never silently deselected.
    expect(unreachableReason(opts[0])).toMatch(/Already shared with Research/)
  })

  it('does not invent, remove or reorder the stored ids themselves', () => {
    const opts = buildAudienceOptions({
      candidates: [node('a', 'A'), node('b', 'B')],
      storedTargetIds: ['a', 'b'],
      memberCounts: counts({ a: 1, b: 1 }),
    })
    expect(opts.filter(o => o.selected).map(o => o.id).sort()).toEqual(['a', 'b'])
  })
})

describe('ordering puts the current audience first', () => {
  it('sorts selected, then reachable, then by name', () => {
    const opts = buildAudienceOptions({
      candidates: [
        node('z', 'Zeta'),        // reachable, not selected
        node('u', 'Unreachable'), // not reachable, not selected
        node('s', 'Selected'),    // selected
        node('a', 'Alpha'),       // reachable, not selected
      ],
      storedTargetIds: ['s'],
      memberCounts: counts({ z: 1, s: 1, a: 1, u: 0 }),
    })
    expect(opts.map(o => o.id)).toEqual(['s', 'a', 'z', 'u'])
  })
})

describe('a level is offered only when it can do something', () => {
  it('is selectable when at least one node is reachable', () => {
    expect(isLevelSelectable(buildAudienceOptions({
      candidates: [node('a', 'A'), node('b', 'B')],
      storedTargetIds: [],
      memberCounts: counts({ a: 0, b: 2 }),
    }))).toBe(true)
  })

  it('is NOT selectable when nothing is reachable and nothing is shared', () => {
    expect(isLevelSelectable(buildAudienceOptions({
      candidates: [node('a', 'A'), node('b', 'B')],
      storedTargetIds: [],
      memberCounts: counts({ a: 0, b: 0 }),
    }))).toBe(false)
  })

  it('STAYS selectable when unreachable but already in use', () => {
    // Otherwise the author could not see or edit an audience that exists.
    expect(isLevelSelectable(buildAudienceOptions({
      candidates: [node('a', 'A')],
      storedTargetIds: ['a'],
      memberCounts: counts({ a: 0 }),
    }))).toBe(true)
  })

  it('is not selectable when there are no options at all', () => {
    expect(isLevelSelectable([])).toBe(false)
  })
})

describe('the explanation names the mechanism, not just the outcome', () => {
  it('tells the author descent is not included', () => {
    expect(emptyLevelReason('division')).toMatch(/direct member/i)
    expect(emptyLevelReason('division')).toMatch(/beneath a division are not included/i)
  })
})
