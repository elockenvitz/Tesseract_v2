/**
 * The safety properties of the action vocabulary.
 *
 * These tests exist because `handleSearchResult` in DashboardPage builds a tab
 * from `result.type` verbatim. Anything that can reach it with a string can
 * open any surface in the shell. So the interesting assertions here are not
 * "the happy path works" but "these specific shapes produce nothing".
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  ACTION_SPECS,
  AI_ACTION_IDS,
  isAiActionId,
  parseAiActions,
  executeAiAction,
  describeActionVocabulary,
  type AiAction,
  type AiObjectRef,
} from '../actions'

const AMZN: AiObjectRef = { type: 'asset', id: 'asset-amzn', label: 'AMZN', symbol: 'AMZN' }
const BOOK: AiObjectRef = { type: 'portfolio', id: 'pf-growth', label: 'Growth Composite' }
const ALLOWLIST = [AMZN, BOOK]

function captureEvents(names: string[]) {
  const seen: Array<{ name: string; detail: any }> = []
  const listeners = names.map(name => {
    const handler = (e: Event) => seen.push({ name, detail: (e as CustomEvent).detail })
    window.addEventListener(name, handler)
    return () => window.removeEventListener(name, handler)
  })
  return { seen, stop: () => listeners.forEach(off => off()) }
}

const SEAM_EVENTS = [
  'decision-engine-action',
  'tesseract:open-asset',
  'tesseract:open-research',
  'tesseract:open-idea',
  'tesseract:open-engagement',
  'openThoughtsCapture',
]

describe('the catalogue', () => {
  it('every spec is keyed by its own id', () => {
    for (const id of AI_ACTION_IDS) {
      expect(ACTION_SPECS[id].id).toBe(id)
    }
  })

  it('no action in the catalogue writes', () => {
    // Nothing here may mutate shared state without an approval step. When the
    // first writing action lands, this test should fail and be replaced by one
    // that asserts the approval seam exists.
    for (const id of AI_ACTION_IDS) {
      expect(['navigate', 'compose']).toContain(ACTION_SPECS[id].effect)
    }
  })

  it('teaches the model exactly the ids it enforces', () => {
    const described = describeActionVocabulary()
    for (const id of AI_ACTION_IDS) {
      expect(described).toContain(`- ${id} (`)
    }
    const mentioned = [...described.matchAll(/^- ([a-z_]+) \(/gm)].map(m => m[1]).sort()
    expect(mentioned).toEqual([...AI_ACTION_IDS])
  })
})

describe('parseAiActions — an unsupported action cannot become executable', () => {
  it('rejects an action id that is not in the catalogue', () => {
    const { actions, rejected } = parseAiActions(
      [{ action: 'delete_portfolio', target: { type: 'portfolio', id: BOOK.id } }],
      { allowlist: ALLOWLIST },
    )
    expect(actions).toEqual([])
    expect(rejected[0]).toMatchObject({ code: 'unknown_action', raw: 'delete_portfolio' })
  })

  it('rejects a route or component name dressed up as an action', () => {
    const injections = [
      { action: 'admin-console' },
      { action: 'trade-lab', target: { type: 'portfolio', id: BOOK.id } },
      { action: '../../admin' },
      { action: 'AssetTab' },
      { action: 'open_asset; drop table' },
    ]
    const { actions, rejected } = parseAiActions(injections, { allowlist: ALLOWLIST, max: 10 })
    expect(actions).toEqual([])
    expect(rejected).toHaveLength(injections.length)
    expect(rejected.every(r => r.code === 'unknown_action')).toBe(true)
  })

  it('does not treat a prototype key as a known action', () => {
    const { actions } = parseAiActions(
      [{ action: 'constructor' }, { action: 'toString' }, { action: '__proto__' }],
      { allowlist: ALLOWLIST },
    )
    expect(actions).toEqual([])
    expect(isAiActionId('constructor')).toBe(false)
  })

  it('rejects a valid action pointed at an object the model was not given', () => {
    const { actions, rejected } = parseAiActions(
      [{ action: 'open_asset', target: { type: 'asset', id: 'asset-nvda' } }],
      { allowlist: ALLOWLIST },
    )
    expect(actions).toEqual([])
    expect(rejected[0].code).toBe('target_not_in_context')
  })

  it('rejects a valid action whose target is the wrong kind of object', () => {
    const { actions, rejected } = parseAiActions(
      [{ action: 'open_portfolio', target: { type: 'asset', id: AMZN.id } }],
      { allowlist: ALLOWLIST },
    )
    expect(actions).toEqual([])
    expect(rejected[0].code).toBe('wrong_target_type')
  })

  it('rejects a targeted action with no target', () => {
    const { actions, rejected } = parseAiActions(
      [{ action: 'update_thesis', label: 'Update thesis' }],
      { allowlist: ALLOWLIST },
    )
    expect(actions).toEqual([])
    expect(rejected[0].code).toBe('missing_target')
  })

  it('produces nothing at all when the allowlist is empty', () => {
    const { actions } = parseAiActions(
      [{ action: 'open_asset', target: { type: 'asset', id: AMZN.id } }],
      { allowlist: [] },
    )
    expect(actions).toEqual([])
  })

  it('survives every malformed shape without throwing', () => {
    for (const raw of [null, undefined, 'open_asset', 42, {}, [null], [1, 'x'], [[]]]) {
      expect(() => parseAiActions(raw, { allowlist: ALLOWLIST })).not.toThrow()
      expect(parseAiActions(raw, { allowlist: ALLOWLIST }).actions).toEqual([])
    }
  })
})

describe('parseAiActions — a valid action survives intact', () => {
  it('accepts a catalogued action on an allowlisted object', () => {
    const { actions, rejected } = parseAiActions(
      [{ action: 'review_target', target: { type: 'asset', id: AMZN.id }, label: 'Review valuation', reason: 'Price is above the base case' }],
      { allowlist: ALLOWLIST },
    )
    expect(rejected).toEqual([])
    expect(actions).toEqual([{
      action: 'review_target',
      target: AMZN,
      label: 'Review valuation',
      reason: 'Price is above the base case',
    }])
  })

  it('resolves the target from the allowlist, not from the model', () => {
    // The model supplied only type + id. The symbol and label come from the
    // context we sent — so a model that mislabels an object cannot make the
    // button say something the reader will misread.
    const { actions } = parseAiActions(
      [{ action: 'open_chart', target: { type: 'asset', id: AMZN.id, label: 'TSLA', symbol: 'TSLA' } }],
      { allowlist: ALLOWLIST },
    )
    expect(actions[0].target).toEqual(AMZN)
  })

  it('falls back to the spec label when the model supplies none', () => {
    const { actions } = parseAiActions(
      [{ action: 'discuss', target: { type: 'asset', id: AMZN.id } }],
      { allowlist: ALLOWLIST },
    )
    expect(actions[0].label).toBe(ACTION_SPECS.discuss.defaultLabel)
  })

  it('accepts a targetless action', () => {
    const { actions } = parseAiActions([{ action: 'open_pipeline' }], { allowlist: [] })
    expect(actions).toEqual([{ action: 'open_pipeline', target: null, label: 'Open idea pipeline', reason: undefined }])
  })

  it('caps the count and drops duplicates', () => {
    const { actions } = parseAiActions(
      [
        { action: 'open_asset', target: { type: 'asset', id: AMZN.id } },
        { action: 'open_asset', target: { type: 'asset', id: AMZN.id } },
        { action: 'open_research', target: { type: 'asset', id: AMZN.id } },
        { action: 'open_chart', target: { type: 'asset', id: AMZN.id } },
        { action: 'discuss', target: { type: 'asset', id: AMZN.id } },
      ],
      { allowlist: ALLOWLIST, max: 3 },
    )
    expect(actions).toHaveLength(3)
    expect(actions.map(a => a.action)).toEqual(['open_asset', 'open_research', 'open_chart'])
  })

  it('truncates a label the model tried to write an essay into', () => {
    const { actions } = parseAiActions(
      [{ action: 'open_asset', target: { type: 'asset', id: AMZN.id }, label: 'x'.repeat(500) }],
      { allowlist: ALLOWLIST },
    )
    expect(actions[0].label.length).toBeLessThanOrEqual(40)
  })
})

describe('executeAiAction — a valid action reaches the existing platform seam', () => {
  let capture: ReturnType<typeof captureEvents>

  beforeEach(() => { capture = captureEvents(SEAM_EVENTS) })
  afterEach(() => capture.stop())

  const run = (action: AiAction) => executeAiAction(action)

  it('open_asset goes through the asset seam with the asset id', () => {
    expect(run({ action: 'open_asset', target: AMZN, label: 'Open' })).toBe(true)
    const typed = capture.seen.find(e => e.name === 'tesseract:open-asset')
    expect(typed?.detail).toMatchObject({ assetId: AMZN.id, symbol: 'AMZN', origin: 'ai' })
    // And the shell channel gets a tab descriptor whose type is our literal.
    const tab = capture.seen.find(e => e.name === 'decision-engine-action')
    expect(tab?.detail.type).toBe('asset')
  })

  it('update_thesis lands on the research workspace focused on the thesis', () => {
    expect(run({ action: 'update_thesis', target: AMZN, label: 'Update thesis' })).toBe(true)
    const e = capture.seen.find(x => x.name === 'tesseract:open-research')
    expect(e?.detail).toMatchObject({ assetId: AMZN.id, focus: 'thesis' })
  })

  it('review_target lands on the price section', () => {
    run({ action: 'review_target', target: AMZN, label: 'Review valuation' })
    expect(capture.seen.find(x => x.name === 'tesseract:open-research')?.detail.focus).toBe('price')
  })

  it('create_trade_idea opens the capture pane in trade-idea mode', () => {
    expect(run({ action: 'create_trade_idea', target: AMZN, label: 'Create idea' })).toBe(true)
    const e = capture.seen.find(x => x.name === 'openThoughtsCapture')
    expect(e?.detail).toMatchObject({ captureType: 'trade_idea', contextType: 'asset', contextId: AMZN.id })
  })

  it('create_recommendation opens the proposal form, and saves nothing', () => {
    run({ action: 'create_recommendation', target: AMZN, label: 'Recommend' })
    expect(capture.seen.find(x => x.name === 'openThoughtsCapture')?.detail.captureType).toBe('proposal')
  })

  it('discuss opens the engagement pane on the object', () => {
    expect(run({ action: 'discuss', target: AMZN, label: 'Discuss' })).toBe(true)
    const e = capture.seen.find(x => x.name === 'tesseract:open-engagement')
    expect(e?.detail).toMatchObject({ mode: 'discuss', target: { objectType: 'asset', objectId: AMZN.id } })
  })

  it('open_chart needs a symbol and declines without one', () => {
    expect(run({ action: 'open_chart', target: { type: 'asset', id: 'x' }, label: 'Chart' })).toBe(false)
    expect(capture.seen).toHaveLength(0)
  })

  it('never emits a tab type that came from the action payload', () => {
    // Every tab type reaching the shell must be a literal written in
    // actions.ts. Feed the executor a target carrying hostile-looking data
    // and assert the emitted type is still the one the catalogue chose.
    run({
      action: 'open_portfolio',
      target: { type: 'portfolio', id: BOOK.id, label: 'admin-console' },
      label: 'Open',
    })
    const tab = capture.seen.find(e => e.name === 'decision-engine-action')
    expect(tab?.detail.type).toBe('portfolio')
  })

  it('every action id is reachable and dispatches, given a valid target', () => {
    // Guards against an id being added to the catalogue and forgotten in the
    // executor's switch — which would surface as a button that does nothing.
    const targetFor = {
      asset: { type: 'asset', id: 'a1', label: 'AMZN', symbol: 'AMZN' },
      portfolio: { type: 'portfolio', id: 'p1', label: 'Book' },
      theme: { type: 'theme', id: 't1', label: 'Theme' },
      idea: { type: 'idea', id: 'i1', label: 'Idea' },
      project: { type: 'project', id: 'pr1', label: 'Project' },
    } as const

    for (const id of AI_ACTION_IDS) {
      const spec = ACTION_SPECS[id]
      const target = spec.targets.length ? targetFor[spec.targets[0]] : null
      const dispatched = executeAiAction({ action: id, target, label: spec.defaultLabel })
      expect(dispatched, `${id} did not dispatch`).toBe(true)
    }
  })
})

describe('executeAiAction outside a browser', () => {
  it('returns false rather than throwing', () => {
    const spy = vi.spyOn(globalThis, 'window' as never, 'get').mockReturnValue(undefined as never)
    try {
      expect(executeAiAction({ action: 'open_pipeline', target: null, label: 'x' })).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
