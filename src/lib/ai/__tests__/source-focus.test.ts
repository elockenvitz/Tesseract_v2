/**
 * Every research-trail source must land somewhere.
 *
 * ── The defect this exists for ────────────────────────────────────────────
 *
 * The two process kinds shipped pointing at the `framework` focus, on the
 * assumption that "framework" meant the process framework. It does not: in
 * `AssetFocus` it means the PRICE framework (scenarios and targets), and
 * `AssetTab`'s focus effect ignores it for landing on purpose -- its own
 * comment says `framework` and anything unrecognised leave the saved page
 * alone. So clicking PROCESS in the trail opened the asset and dropped the
 * reader on whichever sub-page they last used. The link worked; the
 * navigation did not, and nothing could tell the difference by looking.
 *
 * So the assertions here are about LANDING, not about the literal strings:
 * every kind must resolve to a focus the asset page actually honours, and the
 * decision and process kinds must arrive in the mode that renders them.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  FOCUS_BY_SOURCE_KIND, FOCUS_LANDING_SUBPAGE,
  focusForSourceKind, landingModeForSourceKind,
  type AiResearchSourceKind,
} from '../source-focus'
import { SUBPAGE_MODE } from '../../asset-workspace/modes'

const ALL_KINDS = Object.keys(FOCUS_BY_SOURCE_KIND) as AiResearchSourceKind[]

describe('research source focus', () => {
  it('routes every kind to a focus the asset page lands on', () => {
    const dead = ALL_KINDS.filter(k => landingModeForSourceKind(k) === null)
    expect(dead).toEqual([])
  })

  it('never routes a kind through framework, which does not land', () => {
    expect(FOCUS_LANDING_SUBPAGE.framework).toBeUndefined()
    expect(Object.values(FOCUS_BY_SOURCE_KIND)).not.toContain('framework')
  })

  it('lands the four decision kinds on the surface that renders them', () => {
    for (const kind of ['recommendation', 'decision_request', 'decision_review', 'outcome'] as const) {
      expect(landingModeForSourceKind(kind)).toBe('work')
    }
  })

  it('lands a process and a requirement on the work surface', () => {
    expect(landingModeForSourceKind('workflow')).toBe('work')
    expect(landingModeForSourceKind('checklist_item')).toBe('work')
  })

  it('lands a committed trade on the holding, not on the process', () => {
    expect(landingModeForSourceKind('accepted_trade')).toBe('overview')
  })

  it('lands written research on the research surface', () => {
    expect(landingModeForSourceKind('note')).toBe('research')
    expect(landingModeForSourceKind('contribution')).toBe('research')
  })

  it('falls back to the overview for a kind it has never seen', () => {
    expect(focusForSourceKind('some_future_kind')).toBe('overview')
    expect(landingModeForSourceKind('some_future_kind')).toBe('overview')
  })

  it('keeps every landing sub-page a real sub-page', () => {
    for (const sub of Object.values(FOCUS_LANDING_SUBPAGE)) {
      expect(SUBPAGE_MODE[sub!]).toBeTruthy()
    }
  })
})

/*
 * The mirror check.
 *
 * `FOCUS_LANDING_SUBPAGE` is a copy of a rule that lives inside AssetTab's
 * focus effect, because that effect also consumes the request id and writes
 * tab state. A copy can drift, so this reads the effect back and asserts the
 * two agree on WHICH focus values land. It is deliberately about the set of
 * values, not the formatting: AssetTab may rewrite the ternary however it
 * likes as long as it still honours exactly these four.
 */
describe('AssetTab agreement', () => {
  const TAB = readFileSync(
    join(process.cwd(), 'src/components/tabs/AssetTab.tsx'), 'utf8',
  )
  const effect = TAB.slice(
    TAB.indexOf('const focus = asset.focus'),
    TAB.indexOf('const intent = focusIntentKey'),
  )

  it('found the focus effect', () => {
    expect(effect.length).toBeGreaterThan(80)
  })

  it('honours exactly the focus values this module says land', () => {
    const honoured = new Set(
      [...effect.matchAll(/focus === '([a-z]+)'/g)].map(m => m[1]),
    )
    expect([...honoured].sort()).toEqual(Object.keys(FOCUS_LANDING_SUBPAGE).sort())
  })

  it('still records that framework does not land', () => {
    expect(effect).toMatch(/framework/)
    expect(effect).not.toMatch(/focus === 'framework'/)
  })
})
