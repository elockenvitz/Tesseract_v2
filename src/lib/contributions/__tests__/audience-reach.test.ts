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
  effectiveMemberCounts,
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

  it('marks a node unreachable only when nothing beneath it has members either', () => {
    // A division with no members anywhere in its subtree. The caller now
    // supplies EFFECTIVE counts, so a zero here means the whole subtree is
    // empty — not merely that nobody holds a membership row on the division
    // itself, which is what this used to assert.
    const [opt] = buildAudienceOptions({
      candidates: [node('div', 'Equity', 'division')],
      storedTargetIds: [],
      memberCounts: counts({ some_other_node: 9 }),
    })
    expect(opt.reachable).toBe(false)
    expect(opt.memberCount).toBe(0)
    expect(unreachableReason(opt)).toMatch(/no members/i)
    expect(unreachableReason(opt)).not.toMatch(/not included/i)
  })

  it('is reachable through its subtree alone, with no direct members of its own', () => {
    // The case the previous behaviour got backwards: a division nobody holds
    // a row on, whose teams are full of people. It reaches all of them.
    const [opt] = buildAudienceOptions({
      candidates: [node('div', 'Equity', 'division')],
      storedTargetIds: [],
      memberCounts: counts({ div: 9 }),
    })
    expect(opt.reachable).toBe(true)
    expect(opt.memberCount).toBe(9)
    expect(unreachableReason(opt)).toBeNull()
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
  it('tells the author that descent IS included', () => {
    // This assertion is inverted from what it used to say, deliberately.
    // Sharing with a division now reaches the groups beneath it, so copy
    // promising the opposite would be the picker lying about its own effect.
    const reason = emptyLevelReason('division')
    expect(reason).toMatch(/beneath/i)
    expect(reason).not.toMatch(/not included/i)
    expect(reason).not.toMatch(/direct member/i)
  })
})

describe('effective member counts follow the hierarchy', () => {
  // The same shape as the SQL suite's fixture, so both halves of the change
  // are pinned to one tree:
  //
  //   D ── P1 ── T1, T2
  //     └─ P2 ── T3
  const tree: AudienceNode[] = [
    { id: 'D',  name: 'Division',   node_type: 'division',   parent_id: null },
    { id: 'P1', name: 'Dept One',   node_type: 'department', parent_id: 'D' },
    { id: 'P2', name: 'Dept Two',   node_type: 'department', parent_id: 'D' },
    { id: 'T1', name: 'Team One',   node_type: 'team',       parent_id: 'P1' },
    { id: 'T2', name: 'Team Two',   node_type: 'team',       parent_id: 'P1' },
    { id: 'T3', name: 'Team Three', node_type: 'team',       parent_id: 'P2' },
  ]

  it('rolls members up from the teams beneath a node', () => {
    const counts = effectiveMemberCounts(tree, [
      { node_id: 'T1', user_id: 'u1' },
      { node_id: 'T2', user_id: 'u2' },
      { node_id: 'T3', user_id: 'u3' },
    ])
    expect(counts.get('T1')).toBe(1)
    expect(counts.get('P1')).toBe(2)  // T1 + T2
    expect(counts.get('P2')).toBe(1)  // T3
    expect(counts.get('D')).toBe(3)   // everyone
  })

  it('counts a node with only direct members', () => {
    const counts = effectiveMemberCounts(tree, [{ node_id: 'P1', user_id: 'u1' }])
    expect(counts.get('P1')).toBe(1)
    expect(counts.get('D')).toBe(1)
    expect(counts.get('T1')).toBe(0)  // nothing descends to a child
  })

  it('counts one person once, however many groups beneath they are in', () => {
    const counts = effectiveMemberCounts(tree, [
      { node_id: 'T1', user_id: 'u1' },
      { node_id: 'T2', user_id: 'u1' },  // the same person, two teams
    ])
    expect(counts.get('P1')).toBe(1)
    expect(counts.get('D')).toBe(1)
  })

  it('never counts a sibling or a parent toward a team', () => {
    const counts = effectiveMemberCounts(tree, [
      { node_id: 'T2', user_id: 'u2' },
      { node_id: 'P1', user_id: 'u3' },
      { node_id: 'D',  user_id: 'u4' },
    ])
    expect(counts.get('T1')).toBe(0)
  })

  it('reports zero for a node nobody is in, so the picker can say so', () => {
    expect(effectiveMemberCounts(tree, []).get('D')).toBe(0)
  })

  it('terminates on a cycle instead of hanging', () => {
    // parent_id has no cycle guard in the schema; the server bounds its
    // recursion at 32 for the same reason.
    const cyclic: AudienceNode[] = [
      { id: 'A', name: 'A', node_type: 'division',   parent_id: 'B' },
      { id: 'B', name: 'B', node_type: 'department', parent_id: 'A' },
    ]
    const counts = effectiveMemberCounts(cyclic, [{ node_id: 'B', user_id: 'u1' }])
    expect(counts.get('A')).toBe(1)
    expect(counts.get('B')).toBe(1)
  })
})
