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
  FOCUS_BY_SOURCE_KIND, FOCUS_LANDING_SUBPAGE, SECTION_BY_SOURCE_KIND,
  focusForSourceKind, landingModeForSourceKind, sectionForSourceKind,
  type AiResearchSourceKind,
} from '../source-focus'
import { SUBPAGE_MODE } from '../../asset-workspace/modes'
import { ASSET_FOCUSES, isAssetSectionTarget } from '../../desktop-asset/navigate'

const ALL_KINDS = Object.keys(FOCUS_BY_SOURCE_KIND) as AiResearchSourceKind[]

describe('research source focus', () => {
  it('routes every kind to a focus the asset page lands on', () => {
    const dead = ALL_KINDS.filter(k => landingModeForSourceKind(k) === null)
    expect(dead).toEqual([])
  })

  /*
   * `framework` lands now, and the assertion flipped with it.
   *
   * This test used to pin `FOCUS_LANDING_SUBPAGE.framework` as undefined --
   * it asserted the DEFECT, on the reasoning that nothing should route
   * through a focus the page ignores. The right fix was to stop the page
   * ignoring it: the value has a live sender into the dashboard pane
   * (`FOCUS_FOR_FAMILY.scenario_gap`), where it is the only ordering that
   * puts the ladder above the case, so deleting it would have cost a real
   * product distinction to close a page-side hole.
   *
   * What is still asserted is the thing that actually matters and is
   * stronger than before: the landing table is TOTAL over `AssetFocus`, so
   * no focus value is a dead link for anything to route through.
   */
  it('gives every focus value a landing, so none of them is a dead link', () => {
    const landless = ASSET_FOCUSES.filter(f => !FOCUS_LANDING_SUBPAGE[f])
    expect(landless).toEqual([])
  })

  it('lands the framework on research, where the ladder is', () => {
    expect(FOCUS_LANDING_SUBPAGE.framework).toBe('research')
    expect(landingModeForSourceKind('price_target')).toBe('research')
  })

  /*
   * No SOURCE kind routes through `framework`, and that is a separate
   * judgement from whether it lands.
   *
   * A research-trail row is a link to one RECORD -- this target, this
   * contribution -- so naming the lens is less precise than naming the
   * paragraph. `price_target` therefore goes to `research` + `targets`
   * rather than to `framework`, which would land on the same page without
   * the anchor.
   */
  it('keeps source kinds on a lens plus a section, not on the framework lens', () => {
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

  it('honours framework, which it used to drop on the floor', () => {
    expect(effect).toMatch(/focus === 'framework'/)
  })
})

/*
 * ── The section half of the routing ──────────────────────────────────────
 *
 * `focus` picks the lens, `section` picks the paragraph. The defect these
 * cover is the one the 2.4 report named: an assistant citing "the bull case
 * is $260" linked to the asset's SNAPSHOT, which shows today's price and
 * nothing about the target it had just quoted.
 */
describe('research source sections', () => {
  it('sends a cited price target to the targets anchor, not to the snapshot', () => {
    expect(focusForSourceKind('price_target')).toBe('research')
    expect(sectionForSourceKind('price_target')).toBe('targets')
  })

  it('sends a cited contribution to the case it is part of', () => {
    expect(focusForSourceKind('contribution')).toBe('research')
    expect(sectionForSourceKind('contribution')).toBe('case')
  })

  /*
   * The default is NO section, and that is a product decision rather than an
   * omission. A reader who clicks the asset a claim was made about wants the
   * asset; an arrival that scrolls when nobody asked is as disorienting as
   * one that fails to.
   */
  it('names no section for the kinds that name no paragraph', () => {
    for (const kind of ['asset', 'note', 'portfolio', 'theme', 'recommendation',
      'decision_request', 'accepted_trade', 'workflow', 'idea'] as const) {
      expect(sectionForSourceKind(kind)).toBeNull()
    }
    expect(sectionForSourceKind('some_future_kind')).toBeNull()
  })

  /*
   * THE non-obvious one.
   *
   * A section the Asset page has no anchor for is worse than no section: the
   * receiving effect sets an anchor whose DOM id is `undefined`, polls for
   * three seconds, and gives up without saying anything. So every value in
   * this table has to be one of the five the page can actually reach, and
   * that is checked against the page's own list rather than restated here.
   */
  it('only names sections the asset page can actually reach', () => {
    for (const section of Object.values(SECTION_BY_SOURCE_KIND)) {
      expect(isAssetSectionTarget(section)).toBe(true)
    }
  })

  /* A section without a lens that renders it is the same dead link one
     layer down: `targets` only exists on the research page. */
  it('pairs every section with a focus that lands where the section is', () => {
    for (const kind of Object.keys(SECTION_BY_SOURCE_KIND) as AiResearchSourceKind[]) {
      expect(FOCUS_LANDING_SUBPAGE[focusForSourceKind(kind)]).toBe('research')
    }
  })
})
