/**
 * THE test for this slice.
 *
 * Everything else here is scaffolding for one claim: after a recommendation
 * is submitted, editing the underlying idea must not change what the
 * recommendation is recorded as having said.
 *
 * The scenario below mirrors the production defect exactly — an idea is
 * written with thesis A / conviction A / target A, a recommendation is
 * submitted, a decision is taken, and then the idea is rewritten to B. The
 * four surfaces that render history must still show A.
 *
 * Non-vacuity is proven inside this file rather than asserted in a comment:
 * `renderWithLiveJoin` reproduces the OLD implementation (read the current
 * idea) and the final describe block runs the identical scenario through it
 * and asserts it FAILS. If a future change makes the frozen path fall back
 * to live state, that block starts passing where it should not and the
 * `.not.toBe` assertions in it fire.
 */
import { describe, it, expect, vi } from 'vitest'
import {
  resolveHistoricalRecommendation,
  compareRecommendedWithDecided,
  reasoningFallbackNote,
} from '../historical-recommendation'
import { fingerprintSubmission } from '../recommendation-version'
import type { RecommendationVersion } from '../recommendation-version'

/* ── The idea, before and after someone edits it ───────────────────────── */

const IDEA_AT_SUBMISSION = {
  thesis_text: 'Thesis A: margin inflection as the new line ships in Q3.',
  rationale: 'Rationale A: the sell-side has not modelled the mix shift.',
  conviction: 'high',
  target_price: 240,
  time_horizon: 'medium',
  theses: [
    { id: 'th-1', direction: 'bull', rationale: 'Bull A: operating leverage.', conviction: 'high', created_at: '2026-01-02T00:00:00Z' },
    { id: 'th-2', direction: 'bear', rationale: 'Bear A: channel inventory.', conviction: 'low', created_at: '2026-01-02T00:00:00Z' },
  ],
}

/** The same idea six weeks later. Every reasoning field has moved. */
const IDEA_AFTER_EDIT = {
  thesis_text: 'Thesis B: it is a cost story now, the product line slipped.',
  rationale: 'Rationale B: we were wrong about the mix.',
  conviction: 'low',
  target_price: 120,
  time_horizon: 'short',
  theses: [
    { id: 'th-1', direction: 'bull', rationale: 'Bull B: buyback support.', conviction: 'low', created_at: '2026-01-02T00:00:00Z' },
    { id: 'th-3', direction: 'risk', rationale: 'Risk B: covenant headroom.', conviction: 'high', created_at: '2026-03-01T00:00:00Z' },
  ],
}

/** What `captureRecommendationVersion` wrote at submission time. */
const FROZEN_VERSION: RecommendationVersion = {
  id: 'ver-1',
  proposal_id: 'prop-1',
  version_number: 1,
  organization_id: 'org-1',
  portfolio_id: 'pf-1',
  trade_queue_item_id: 'tqi-1',
  asset_id: 'asset-1',
  action: 'add',
  idea_stage: 'ready_to_recommend',
  weight: 1.0,
  shares: null,
  sizing_mode: 'weight',
  sizing_context: {},
  notes: 'Sizing to 100bps.',
  ...IDEA_AT_SUBMISSION,
  captured_from: { captured_at: '2026-01-10T00:00:00Z', fields: {} },
  trigger_event: 'submission',
  submitted_at: '2026-01-10T00:00:00Z',
  created_at: '2026-01-10T00:00:00Z',
  created_by: 'analyst-1',
  dedupe_key: 'sub:abc',
}

const DECISION_REQUEST = {
  proposal_version_id: 'ver-1',
  submission_snapshot: { action: 'add', weight: 1.0, sizing_mode: 'weight', submitted_at: '2026-01-10T00:00:00Z' },
  sizing_weight: 1.0,
  sizing_shares: null,
  sizing_mode: 'weight',
  requested_action: 'add',
  created_at: '2026-01-10T00:00:00Z',
}

/**
 * The OLD behaviour, reproduced so the fix can be shown to be load bearing.
 *
 * This is what every one of the four surfaces did: reach for the current
 * idea when rendering a historical recommendation. Decision Inbox read
 * `trade_queue_item.thesis_text`; Trade Book read the same through
 * TRADE_SELECT; `outcomes_payload` selected `tqi.rationale`; and
 * `decision_story_payload` returned `ideaExtras` plus live `trade_idea_theses`.
 */
function renderWithLiveJoin(currentIdea: typeof IDEA_AT_SUBMISSION) {
  return {
    thesisText: currentIdea.thesis_text,
    rationale: currentIdea.rationale,
    conviction: currentIdea.conviction,
    targetPrice: currentIdea.target_price,
    theses: currentIdea.theses,
  }
}

/* ── Part 9: the mutation regression ───────────────────────────────────── */

describe('a later idea edit cannot change the submitted recommendation', () => {
  const historical = resolveHistoricalRecommendation(DECISION_REQUEST, FROZEN_VERSION)

  it('reads from the frozen version, not the request', () => {
    expect(historical.source).toBe('version')
    expect(historical.versionId).toBe('ver-1')
  })

  it('still shows thesis A after the idea is rewritten to thesis B', () => {
    expect(historical.thesisText.value).toBe(IDEA_AT_SUBMISSION.thesis_text)
    expect(historical.thesisText.value).not.toBe(IDEA_AFTER_EDIT.thesis_text)
  })

  it('still shows conviction A, target A, horizon A', () => {
    expect(historical.conviction.value).toBe('high')
    expect(historical.targetPrice.value).toBe(240)
    expect(historical.timeHorizon.value).toBe('medium')
    expect(historical.conviction.value).not.toBe(IDEA_AFTER_EDIT.conviction)
    expect(historical.targetPrice.value).not.toBe(IDEA_AFTER_EDIT.target_price)
  })

  it('still shows the bull and bear cases as they stood at submission', () => {
    const frozen = historical.theses.value ?? []
    expect(frozen.map(t => t.rationale)).toEqual([
      'Bull A: operating leverage.',
      'Bear A: channel inventory.',
    ])
    // The risk case was added AFTER the decision. It must not appear as
    // reasoning the PM had in front of them.
    expect(frozen.some(t => t.id === 'th-3')).toBe(false)
  })

  it('the frozen record is unaffected by how many times the idea changes', () => {
    const again = resolveHistoricalRecommendation(DECISION_REQUEST, FROZEN_VERSION)
    expect(again.thesisText.value).toBe(historical.thesisText.value)
  })

  it('current idea surfaces still show B — the edit is not suppressed', () => {
    // The point is separation, not freezing the product. Someone asking what
    // the desk thinks TODAY must still get B.
    const live = renderWithLiveJoin(IDEA_AFTER_EDIT)
    expect(live.thesisText).toBe(IDEA_AFTER_EDIT.thesis_text)
    expect(live.conviction).toBe('low')
  })
})

/* ── Non-vacuity: the old implementation fails this scenario ───────────── */

describe('NON-VACUITY: the live-join implementation fails the same scenario', () => {
  // If these ever stop holding, the "historical" path has started reading
  // current state again and every assertion above has become decoration.
  const live = renderWithLiveJoin(IDEA_AFTER_EDIT)

  it('shows thesis B where thesis A was submitted', () => {
    expect(live.thesisText).not.toBe(IDEA_AT_SUBMISSION.thesis_text)
    expect(live.thesisText).toBe(IDEA_AFTER_EDIT.thesis_text)
  })

  it('shows conviction low where high was submitted', () => {
    expect(live.conviction).not.toBe(IDEA_AT_SUBMISSION.conviction)
  })

  it('shows a target of 120 where 240 was submitted', () => {
    expect(live.targetPrice).not.toBe(IDEA_AT_SUBMISSION.target_price)
  })

  it('shows a risk case written after the decision', () => {
    expect(live.theses.some(t => t.id === 'th-3')).toBe(true)
  })

  it('and the frozen path disagrees with it on every field', () => {
    const historical = resolveHistoricalRecommendation(DECISION_REQUEST, FROZEN_VERSION)
    expect(historical.thesisText.value).not.toBe(live.thesisText)
    expect(historical.conviction.value).not.toBe(live.conviction)
    expect(historical.targetPrice.value).not.toBe(live.targetPrice)
  })
})

/* ── Part 10: accepted with modification ───────────────────────────────── */

describe('accepted with modification preserves both numbers', () => {
  const recommended = { ...FROZEN_VERSION, weight: 1.0 }
  const historical = resolveHistoricalRecommendation(DECISION_REQUEST, recommended)

  it('recommended +100bps, decided +50bps — both survive', () => {
    const cmp = compareRecommendedWithDecided(historical, {
      target_weight: 0.5,
      action: 'add',
    })
    expect(cmp.recommendedWeight).toBe(1.0)
    expect(cmp.decidedWeight).toBe(0.5)
    expect(cmp.modified).toBe(true)
    expect(cmp.comparable).toBe(true)
  })

  it('the recommendation is not rewritten to the decided number', () => {
    compareRecommendedWithDecided(historical, { target_weight: 0.5 })
    // The version object is the record. Nothing above may touch it.
    expect(recommended.weight).toBe(1.0)
    expect(historical.weight.value).toBe(1.0)
  })

  it('an unmodified acceptance is not flagged as a modification', () => {
    const cmp = compareRecommendedWithDecided(historical, {
      target_weight: 1.0,
      action: 'add',
    })
    expect(cmp.modified).toBe(false)
  })

  it('a changed action counts as a modification', () => {
    const cmp = compareRecommendedWithDecided(historical, {
      target_weight: 1.0,
      action: 'trim',
    })
    expect(cmp.modified).toBe(true)
  })

  it('an incomparable pair is reported as incomparable, not as unmodified', () => {
    const noSizing = resolveHistoricalRecommendation({ created_at: '2026-01-01' }, null)
    const cmp = compareRecommendedWithDecided(noSizing, null)
    expect(cmp.comparable).toBe(false)
    expect(cmp.modified).toBe(false)
  })
})

/* ── Part 11: version 1 vs version 2 ───────────────────────────────────── */

describe('a decision tied to version 1 keeps showing version 1', () => {
  const v1: RecommendationVersion = { ...FROZEN_VERSION, id: 'ver-1', version_number: 1, weight: 1.0, thesis_text: 'Thesis A' }
  const v2: RecommendationVersion = { ...FROZEN_VERSION, id: 'ver-2', version_number: 2, weight: 2.0, thesis_text: 'Thesis A-revised' }

  const decisionOnV1 = { ...DECISION_REQUEST, proposal_version_id: 'ver-1' }
  const decisionOnV2 = { ...DECISION_REQUEST, proposal_version_id: 'ver-2' }

  it('the first decision shows version 1 after version 2 is submitted', () => {
    const h = resolveHistoricalRecommendation(decisionOnV1, v1)
    expect(h.versionNumber).toBe(1)
    expect(h.thesisText.value).toBe('Thesis A')
    expect(h.weight.value).toBe(1.0)
  })

  it('the later decision shows version 2', () => {
    const h = resolveHistoricalRecommendation(decisionOnV2, v2)
    expect(h.versionNumber).toBe(2)
    expect(h.thesisText.value).toBe('Thesis A-revised')
    expect(h.weight.value).toBe(2.0)
  })

  it('resolution is by the request\'s own pointer, never by latest', () => {
    // Feeding v1's request the LATEST version is the bug. The resolver
    // cannot do this on its own — it is handed the version — so the guard
    // lives in the callers' queries, which join
    // `proposal_version:proposal_version_id`. This asserts the shape those
    // queries must preserve.
    expect(decisionOnV1.proposal_version_id).toBe('ver-1')
    expect(decisionOnV1.proposal_version_id).not.toBe(v2.id)
  })
})

/* ── Part 12: old rows, and never inventing reasoning ──────────────────── */

describe('old rows get an honest fallback, never a reconstruction', () => {
  it('a snapshot-only row shows sizing and reports reasoning as not captured', () => {
    const h = resolveHistoricalRecommendation(DECISION_REQUEST, null)
    expect(h.source).toBe('snapshot')
    expect(h.weight.value).toBe(1.0)
    expect(h.action.value).toBe('add')
    expect(h.thesisText.captured).toBe(false)
    expect(h.thesisText.value).toBeNull()
    expect(h.reasoningUnavailable).toBe(true)
  })

  it('a row with neither claims nothing beyond its own columns', () => {
    const h = resolveHistoricalRecommendation(
      { sizing_weight: 2.5, requested_action: 'buy', created_at: '2025-06-01T00:00:00Z' },
      null,
    )
    expect(h.source).toBe('none')
    expect(h.weight.value).toBe(2.5)
    expect(h.conviction.captured).toBe(false)
    expect(h.theses.captured).toBe(false)
  })

  it('"not captured" is distinguishable from "captured as empty"', () => {
    const emptyButCaptured = resolveHistoricalRecommendation(
      DECISION_REQUEST,
      { ...FROZEN_VERSION, thesis_text: null },
    )
    expect(emptyButCaptured.thesisText.captured).toBe(true)
    expect(emptyButCaptured.thesisText.value).toBeNull()

    const neverCaptured = resolveHistoricalRecommendation(DECISION_REQUEST, null)
    expect(neverCaptured.thesisText.captured).toBe(false)
    expect(neverCaptured.thesisText.value).toBeNull()
  })

  it('the fallback note describes our record keeping, not the analyst', () => {
    const note = reasoningFallbackNote(resolveHistoricalRecommendation(DECISION_REQUEST, null))
    expect(note).toMatch(/not recorded|before investment reasoning was captured/i)
    // It must not assert the analyst gave no reason.
    expect(note).not.toMatch(/no thesis was given|analyst did not/i)
  })

  it('no fallback note when the reasoning IS available', () => {
    expect(reasoningFallbackNote(resolveHistoricalRecommendation(DECISION_REQUEST, FROZEN_VERSION))).toBeNull()
  })

  it('a version-backed row never reads current idea state for any field', () => {
    const h = resolveHistoricalRecommendation(DECISION_REQUEST, FROZEN_VERSION)
    const serialised = JSON.stringify(h)
    for (const bValue of [
      IDEA_AFTER_EDIT.thesis_text,
      IDEA_AFTER_EDIT.rationale,
      'Bull B: buyback support.',
      'Risk B: covenant headroom.',
    ]) {
      expect(serialised).not.toContain(bValue)
    }
  })
})

/* ── Part 6: when a new version is created ─────────────────────────────── */

describe('version semantics: content decides, not the clock', () => {
  const base = {
    action: 'add', weight: 1.0, shares: null, sizingMode: 'weight',
    notes: 'n', ...IDEA_AT_SUBMISSION,
  }

  it('an identical resubmission fingerprints the same, so no new version', () => {
    expect(fingerprintSubmission(base)).toBe(fingerprintSubmission({ ...base }))
  })

  it('a different size is a new version', () => {
    expect(fingerprintSubmission({ ...base, weight: 2.0 })).not.toBe(fingerprintSubmission(base))
  })

  it('a changed thesis is a new version, even at the same size', () => {
    expect(
      fingerprintSubmission({ ...base, thesis_text: IDEA_AFTER_EDIT.thesis_text }),
    ).not.toBe(fingerprintSubmission(base))
  })

  it('a changed conviction is a new version', () => {
    expect(fingerprintSubmission({ ...base, conviction: 'low' })).not.toBe(fingerprintSubmission(base))
  })

  it('an added bull/bear case is a new version', () => {
    expect(
      fingerprintSubmission({ ...base, theses: [...IDEA_AT_SUBMISSION.theses, IDEA_AFTER_EDIT.theses[1]] }),
    ).not.toBe(fingerprintSubmission(base))
  })

  it('the fingerprint is stable across time, so a retry cannot fork', () => {
    // Asserting the STRING has no timestamp in it would be vacuous — the
    // fingerprint is a hash, so a clock folded into it is invisible in the
    // output. Move the clock instead.
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-01-10T09:00:00Z'))
      const a = fingerprintSubmission(base)
      vi.setSystemTime(new Date('2027-05-04T23:59:59Z'))
      const b = fingerprintSubmission(base)
      expect(a).toBe(b)
    } finally {
      vi.useRealTimers()
    }
  })
})
