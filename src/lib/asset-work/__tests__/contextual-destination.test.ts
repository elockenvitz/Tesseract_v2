/**
 * Where a click in the Work sidebar goes, and how the reader gets back.
 *
 * ── The defect ──────────────────────────────────────────────────────────
 *
 * Processes, ideas and conversations selected in place. Lists and
 * portfolios called `onNavigate` instead, which opens a TOP-LEVEL tab — so
 * one click in an asset's own sidebar closed the asset workspace, lost the
 * process being worked, and left no way back but the browser tab strip.
 *
 * Two destinations in one sidebar, one of which ends your session on the
 * asset, is not a styling problem. These cases pin the contract that
 * replaces it: every destination is a key on ONE selection state, an
 * unrecognised key resolves to nothing rather than to some other piece of
 * work, and Back always has a name.
 */
import { describe, it, expect } from 'vitest'
import {
  contextualKey, contextualSelection, parseWorkKey, backTarget,
} from '../contextual-destination'

describe('one key names every destination', () => {
  it('builds list and portfolio keys the parser round-trips', () => {
    expect(parseWorkKey(contextualKey.list('l1'))).toEqual({ kind: 'list', id: 'l1' })
    expect(parseWorkKey(contextualKey.portfolio('p1'))).toEqual({ kind: 'portfolio', id: 'p1' })
  })

  it('still parses the three kinds that already existed', () => {
    expect(parseWorkKey('process:w1')).toEqual({ kind: 'process', id: 'w1' })
    expect(parseWorkKey('idea:i1')).toEqual({ kind: 'idea', id: 'i1' })
    expect(parseWorkKey('conversation:c1')).toEqual({ kind: 'conversation', id: 'c1' })
  })

  it('keeps an id containing a colon intact', () => {
    /* Stage ids in this schema look like `stage_1774568824765_yd73uy`, and
       nothing stops an id carrying a separator one day. Splitting on the
       FIRST colon is the rule; splitting on every one would truncate. */
    expect(parseWorkKey('list:a:b:c')).toEqual({ kind: 'list', id: 'a:b:c' })
  })

  /** THE safety case. */
  it('resolves an unrecognised key to nothing, never to another kind', () => {
    for (const bad of ['', null, undefined, 'bare', ':x', 'list:', 'theme:t1', 'LIST:l1']) {
      expect(parseWorkKey(bad as string)).toBeNull()
    }
  })
})

describe('only lists and portfolios render a contextual surface', () => {
  it('recognises the two contextual kinds', () => {
    expect(contextualSelection('list:l1')).toEqual({ kind: 'list', id: 'l1' })
    expect(contextualSelection('portfolio:p1')).toEqual({ kind: 'portfolio', id: 'p1' })
  })

  it('leaves the navigator kinds to the navigator', () => {
    for (const key of ['process:w1', 'idea:i1', 'conversation:c1']) {
      expect(contextualSelection(key)).toBeNull()
    }
  })

  it('is null for no selection, so the Work overview still shows', () => {
    expect(contextualSelection(null)).toBeNull()
    expect(contextualSelection(undefined)).toBeNull()
  })
})

describe('Back always has a name', () => {
  const labels: Record<string, string> = { 'process:w1': 'Earnings Season — Q2 2026' }
  const labelFor = (key: string) => labels[key] ?? null

  it('names the work item it returns to', () => {
    expect(backTarget('process:w1', labelFor)).toEqual({
      key: 'process:w1',
      label: 'Back to Earnings Season — Q2 2026',
    })
  })

  /** Entering a contextual view directly, e.g. restored on a reload. */
  it('falls back to the Work overview when there is no previous selection', () => {
    expect(backTarget(null, labelFor)).toEqual({ key: null, label: 'Back to work' })
  })

  it('falls back when the previous item no longer exists', () => {
    /* A process that completed, or that the reader lost access to. Returning
       to a key nothing can resolve would be a dead control. */
    expect(backTarget('process:gone', labelFor)).toEqual({ key: null, label: 'Back to work' })
  })

  it('never produces a bare arrow', () => {
    for (const prev of ['process:w1', 'process:gone', null]) {
      expect(backTarget(prev, labelFor).label.length).toBeGreaterThan('Back to'.length)
    }
  })
})
