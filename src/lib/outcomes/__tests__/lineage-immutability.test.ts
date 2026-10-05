/**
 * An edit to an idea must not change what Outcomes says about a past decision.
 *
 * ── The gap this closes ──────────────────────────────────────────────────
 *
 * `mutation-regression.test.ts` proves `resolveHistoricalRecommendation` is
 * load-bearing. It proves nothing about any surface: it builds its own
 * literals, calls one resolver, and compares against a test-local
 * `renderWithLiveJoin`. Outcomes does not render through that resolver — the
 * thesis comes from `story.recommendationVersion` and "Why now" from
 * `row.rationale_text`. Every assertion in that file could pass while
 * Outcomes narrated a rejected decision with today's idea text.
 *
 * Which is exactly what happened. `useDecisionAccountability` fixed the
 * approved path server-side in
 * `20260930170300_outcomes_payload_frozen_recommendation`, and left the
 * passed (rejected/deferred) path reading
 * `ti?.rationale || ti?.thesis_text` off a live `trade_queue_items` join.
 *
 * Two halves here, matching the two places the contract lives:
 *   1. the SQL that decides what the server freezes, and
 *   2. the client mapper that decides what the surface shows.
 *
 * Comments are stripped before every assertion. Both migration headers quote
 * the very expressions they replaced, so an unstripped match is a false
 * positive — this file would pass on prose alone without the stripper.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const ROOT = resolve(__dirname, '../../../..')
const read = (p: string) => readFileSync(resolve(ROOT, p), 'utf8')

/** Strip `--` (SQL) and `//` + block (TS) comments. */
const codeOf = (s: string) =>
  s
    .split('\n')
    .map((l) => l.replace(/--.*$/, '').replace(/\/\/.*$/, ''))
    .join('\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')

const OUTCOMES_SQL = codeOf(read('supabase/migrations/20260930170300_outcomes_payload_frozen_recommendation.sql'))
const STORY_SQL = codeOf(read('supabase/migrations/20260930170200_decision_story_frozen_recommendation.sql'))
const HOOK = codeOf(read('src/hooks/useDecisionAccountability.ts'))

describe('the comment stripper earns its place', () => {
  it('removes commentary from this very file, not just in principle', () => {
    const raw = read('supabase/migrations/20260930170300_outcomes_payload_frozen_recommendation.sql')
    const count = (s: string, needle: string) => s.split(needle).length - 1
    // `tqi.rationale` appears in BOTH the header prose and the executable
    // CTE — the payload deliberately still carries the idea's current text
    // as `rationale`, and the contract is that the CLIENT must not fall back
    // to it. So the right assertion is that stripping removed the prose
    // occurrences and kept the code one.
    expect(count(raw, 'tqi.rationale')).toBeGreaterThan(count(OUTCOMES_SQL, 'tqi.rationale'))
    expect(count(OUTCOMES_SQL, 'tqi.rationale')).toBe(1)
  })

  it('strips both comment syntaxes', () => {
    expect(codeOf('-- recommended_rationale\nselect 1')).not.toContain('recommended_rationale')
    expect(codeOf('// recommended_rationale\nconst a = 1')).not.toContain('recommended_rationale')
    expect(codeOf('/* recommended_rationale */\nconst a = 1')).not.toContain('recommended_rationale')
    expect(codeOf('select 1 -- note')).toContain('select 1')
  })
})

describe('outcomes_payload freezes the recommendation server-side', () => {
  it('reaches the version through the decision request pointer', () => {
    expect(OUTCOMES_SQL).toContain('dr.proposal_version_id')
    expect(OUTCOMES_SQL).toMatch(
      /LEFT JOIN trade_proposal_versions v ON v\.id = rdr\.proposal_version_id/,
    )
  })

  it('never resolves "the latest version of this proposal"', () => {
    // A revision submitted AFTER the decision would retroactively become the
    // thing the PM approved.
    expect(OUTCOMES_SQL).not.toMatch(/ORDER BY v\.version_number DESC/i)
    expect(OUTCOMES_SQL).not.toMatch(/ORDER BY\s+v\.created_at DESC/i)
  })

  it('takes the recommended rationale only from the frozen version', () => {
    expect(OUTCOMES_SQL).toContain('COALESCE(v.thesis_text, v.rationale) AS recommended_rationale')
    // No `tqi.` term anywhere in the recommended_* projection.
    const projection = OUTCOMES_SQL.slice(
      OUTCOMES_SQL.indexOf('recommended_version_id'),
      OUTCOMES_SQL.indexOf('recommendation_captured'),
    )
    expect(projection).not.toContain('tqi.')
  })

  it('reports capture as the presence of a version, not as non-empty text', () => {
    expect(OUTCOMES_SQL).toContain('(v.id IS NOT NULL) AS recommendation_captured')
  })

  it('binds to a RESOLVED request only', () => {
    expect(OUTCOMES_SQL).toMatch(
      /dr\.status IN \('accepted', 'accepted_with_modification', 'rejected', 'deferred'\)/,
    )
  })
})

describe('decision_story_payload freezes it too, and guards the lookup', () => {
  it('populates recommendationVersion only when the pointer exists', () => {
    expect(STORY_SQL).toMatch(/proposal_version_id'\)\s*IS NOT NULL THEN/)
    expect(STORY_SQL).toContain("WHERE v.id = (v_decision_request ->> 'proposal_version_id')::uuid")
  })

  it('keeps current idea state as a separate, clearly-named key', () => {
    // ideaExtras exists and is CURRENT. It must never be the fallback for
    // recommendationVersion, which is why they are distinct keys.
    expect(STORY_SQL).toContain("'ideaExtras', v_idea_extras")
    expect(STORY_SQL).toContain("'recommendationVersion', v_recommendation_version")
  })

  it('returns a null recommendationVersion rather than substituting the idea', () => {
    expect(STORY_SQL).toMatch(/'recommendationVersion',\s*NULL/)
  })
})

describe('the passed-decision path reads the frozen version too', () => {
  it('selects the version through the decision request', () => {
    expect(HOOK).toMatch(/proposal_version:proposal_version_id \(\s*thesis_text, rationale, submitted_at, created_at\s*\)/)
  })

  it('no longer narrates a rejected decision with the idea\'s current text', () => {
    // The exact expression that rewrote history on every idea edit.
    expect(HOOK).not.toContain('ti?.rationale || ti?.thesis_text')
  })

  it('does not even fetch the mutable columns any more', () => {
    // Structural: the fallback cannot be reintroduced by reflex if the
    // columns are not in hand. `trade_queue_items` is still joined for
    // asset_id, symbol and owner.
    expect(HOOK).toMatch(/trade_idea:trade_queue_items!inner \(\s*id, asset_id, origin_metadata,/)
  })

  it('maps rationale, capture and timestamp from the version alone', () => {
    expect(HOOK).toContain('rationale_text: pv ? (pv.thesis_text || pv.rationale || null) : null')
    expect(HOOK).toContain('recommendation_captured: !!pv')
    expect(HOOK).toContain('recommended_at: pv ? (pv.submitted_at ?? pv.created_at ?? null) : null')
  })

  it('reports "not captured" rather than blaming the analyst', () => {
    // With no version, rationale_text is null AND recommendation_captured is
    // false — which is what makes the surface say the record was not kept,
    // instead of "No catalyst recorded."
    expect(HOOK).not.toMatch(/rationale_text: pv \? [^\n]*: ti\?\./)
  })
})

describe('the approved path still gates on capture', () => {
  it('refuses to fall back to the payload\'s mutable rationale', () => {
    // outcomes_payload still carries `tqi.rationale` as `rationale`. The
    // mapper must not reach for it when the version is absent.
    expect(HOOK).toContain('item.recommendation_captured')
    expect(HOOK).not.toMatch(/recommendation_captured\s*\?[^\n]*:\s*item\.rationale/)
  })
})
