/**
 * What a retrieval tool is allowed to conclude from an empty result.
 *
 * ── The defect class ─────────────────────────────────────────────────────
 *
 * Every tool runs on a caller-scoped client, so Row Level Security decides
 * what comes back. A row the reader may not read is not returned and not
 * counted, which means "there are none" and "there are none you may see" are
 * THE SAME OBSERVATION at the data layer. Nothing in the old result
 * distinguished them, so the model filled the silence by asserting absence.
 *
 * It has already been wrong in production: `accepted_trades` reads zero for a
 * user while six exist on AAPL, and `decision_requests` is readable only for
 * portfolios the reader is on the team of -- a membership this product records
 * in two tables that disagree. "Nothing needs your decision" is then a false
 * statement about the firm, produced by a correct query.
 *
 * These tests assert the shape that prevents it: every tool declares its
 * reach, the declaration rides on both ok and empty results, and only an
 * organization-wide path may phrase absence as a fact.
 *
 * ── And the mirrors ─────────────────────────────────────────────────────
 *
 * The Edge Function cannot import from `src`, so the idea-stage vocabulary,
 * the liveness rule and the decided-ruling list are copied into
 * `_shared/research-results.ts`. The second half of this file is the drift
 * guard on those copies. A quietly disagreeing copy is how the assistant ends
 * up contradicting the screen the reader is looking at.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  TOOL_VISIBILITY,
  toolVisibility,
  absenceRule,
  toolOk,
  toolEmpty,
  toolError,
  IDEA_STAGES as EDGE_IDEA_STAGES,
  LEGACY_IDEA_STAGES as EDGE_LEGACY_STAGES,
  toIdeaStage as edgeToIdeaStage,
  TERMINAL_IDEA_STATUSES as EDGE_TERMINAL,
  isLiveIdeaRow,
  DECIDED_DECISION_STATUSES as EDGE_DECIDED,
} from '../../../../supabase/functions/_shared/research-results'
import { IDEA_STAGES, LEGACY_STAGE_MAP, toIdeaStage } from '../../ideas/stage-model'
import { TERMINAL_STATUSES } from '../../trade-status-semantics'
import { DECIDED_DECISION_STATUSES } from '../../decisions/outcome-eligibility'

const EDGE_SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/functions/ai-chat/index.ts'),
  'utf8',
)

/** Every tool name the edge function declares to the model. */
function declaredToolNames(): string[] {
  const block = EDGE_SOURCE.match(/const RESEARCH_TOOLS[\s\S]*?\n\] as const;/)
  expect(block, 'RESEARCH_TOOLS not found in the edge function').toBeTruthy()
  return [...block![0].matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map(m => m[1]).sort()
}

describe('every retrieval tool declares its reach', () => {
  it('has a visibility entry for each tool offered to the model', () => {
    /* The gate that makes the rest of this enforceable: a new tool cannot
       ship without saying what it can see, because `toolOk` throws without
       an entry and this names the omission before anyone runs it. */
    const declared = declaredToolNames()
    expect(declared.length).toBeGreaterThanOrEqual(12)
    for (const name of declared) {
      expect(TOOL_VISIBILITY[name], `no TOOL_VISIBILITY entry for "${name}"`).toBeTruthy()
    }
  })

  it('declares nothing for a tool that does not exist', () => {
    /* The table is not allowed to drift the other way either: an entry for a
       removed tool is a claim about a lookup nobody can make. */
    const declared = new Set(declaredToolNames())
    for (const name of Object.keys(TOOL_VISIBILITY)) {
      expect(declared.has(name), `TOOL_VISIBILITY has "${name}" but no tool declares it`).toBe(true)
    }
  })

  it('refuses to summarise a tool it has no declaration for', () => {
    expect(() => toolVisibility('get_everything')).toThrow(/No visibility declaration/)
    expect(() => toolOk('get_everything', {})).toThrow(/No visibility declaration/)
  })

  it('names what it cannot see unless it covers the organization', () => {
    for (const [name, v] of Object.entries(TOOL_VISIBILITY)) {
      if (v.scope === 'organization') {
        expect(v.excludes, `${name} claims org-wide reach, so excludes must be null`).toBeNull()
      } else {
        expect(v.excludes, `${name} is not org-wide and must say what it misses`).toBeTruthy()
        expect(String(v.excludes).length).toBeGreaterThan(10)
      }
    }
  })

  it('covers the five questions the assistant could not answer', () => {
    for (const name of [
      'get_watchlists', 'get_coverage', 'get_idea_pipeline',
      'get_pending_decisions', 'get_outstanding_work',
    ]) {
      expect(declaredToolNames()).toContain(name)
    }
  })
})

describe('the absence rule', () => {
  it('permits a firm-level statement only for an organization-wide path', () => {
    const rule = absenceRule(TOOL_VISIBILITY.get_coverage)
    expect(TOOL_VISIBILITY.get_coverage.scope).toBe('organization')
    expect(rule).toMatch(/there are none in your active organization/)
  })

  it('forbids it everywhere else, in words the model is told to follow', () => {
    const rule = absenceRule(TOOL_VISIBILITY.get_pending_decisions)
    expect(rule).toMatch(/Do not say none exist/)
    expect(rule).toMatch(/none are visible to you/)
    /* The specific blind spot, named, so the model can pass it on. */
    expect(rule).toMatch(/not on the team of/)
  })

  it('says almost nothing about the firm for a caller-only path', () => {
    expect(TOOL_VISIBILITY.get_watchlists.scope).toBe('caller')
    expect(absenceRule(TOOL_VISIBILITY.get_watchlists)).toMatch(/Do not say none exist/)
  })
})

describe('the declaration travels with the result', () => {
  it('rides on an empty result, alongside the rule', () => {
    const parsed = JSON.parse(toolEmpty('get_pending_decisions', { scope: 'your inbox' }))
    expect(parsed.status).toBe('empty')
    expect(parsed.visibility.scope).toBe('caller_visible')
    expect(parsed.visibility.excludes).toBeTruthy()
    expect(parsed.absence_rule).toMatch(/none are visible to you/)
  })

  it('rides on an ok result too, because a partial answer reads as complete', () => {
    /* Three of eleven ideas looks like the whole pipeline unless the reach is
       stated, and the empty case is the only one anybody thinks to guard. */
    const parsed = JSON.parse(toolOk('get_idea_pipeline', { records_returned: 3 }))
    expect(parsed.status).toBe('ok')
    expect(parsed.visibility.scope).toBe('caller_visible')
  })

  it('does not ride on an error, where reach is irrelevant', () => {
    /* An error means nothing was learned. Attaching a scope would invite the
       model to reason about coverage it never had. */
    const parsed = JSON.parse(toolError('get_idea_pipeline', 'ideas'))
    expect(parsed.status).toBe('error')
    expect(parsed.visibility).toBeUndefined()
  })

  it('cannot have its own status overwritten by a payload field', () => {
    /* Several of these tables have a column called `status`. */
    const parsed = JSON.parse(toolOk('get_pending_decisions', { status: 'pending' }))
    expect(parsed.status).toBe('ok')
  })
})

describe('the idea-stage mirror does not drift', () => {
  it('carries the same four canonical stages, in the same order', () => {
    expect([...EDGE_IDEA_STAGES]).toEqual([...IDEA_STAGES])
  })

  it('maps every legacy value the same way', () => {
    expect(EDGE_LEGACY_STAGES).toEqual(LEGACY_STAGE_MAP)
  })

  it('agrees with the canonical function on every stored value', () => {
    /* Every key either module knows, plus the shapes a column actually
       produces: an unmigrated v1 value, an unknown one, and null. */
    const values = [
      ...IDEA_STAGES,
      ...Object.keys(LEGACY_STAGE_MAP),
      'deciding', 'ready_for_decision', 'working_on',
      'something_nobody_defined', '', null, undefined,
    ]
    for (const v of values) {
      expect(edgeToIdeaStage(v as string), `disagreement on ${String(v)}`)
        .toBe(toIdeaStage(v as string))
    }
  })
})

describe('the liveness mirror does not drift', () => {
  it('carries the same terminal statuses', () => {
    expect([...EDGE_TERMINAL].sort()).toEqual([...TERMINAL_STATUSES].sort())
  })

  it('lets a non-null outcome outrank the status', () => {
    /* The rule the canonical module records: the stage column says where the
       process got to and nothing moves it back, so an executed idea can still
       read `ready_for_decision`. Status alone would call this one live. */
    expect(isLiveIdeaRow({ outcome: 'executed', status: 'idea' })).toBe(false)
    expect(isLiveIdeaRow({ outcome: null, status: 'idea' })).toBe(true)
    expect(isLiveIdeaRow({ outcome: null, status: 'approved' })).toBe(false)
    expect(isLiveIdeaRow(null)).toBe(false)
  })
})

describe('the decided-ruling mirror does not drift', () => {
  it('carries the same four answered statuses', () => {
    expect([...EDGE_DECIDED].sort()).toEqual([...DECIDED_DECISION_STATUSES].sort())
  })

  it('does not count a withdrawn request as answered', () => {
    /* A retracted request was never ruled on. It is excluded from the open
       inbox at the one call site that needs it, so this list keeps meaning
       "a PM answered". */
    expect(EDGE_DECIDED).not.toContain('withdrawn')
  })
})

describe('the model is taught the visibility contract', () => {
  it('explains all three scopes in the system prompt', () => {
    for (const scope of ['organization', 'caller_visible', 'caller']) {
      expect(EDGE_SOURCE).toContain(`visibility.scope "${scope}"`)
    }
  })

  it('forbids the absence claim in the prompt, not only in the payload', () => {
    /* The payload carries the rule; the prompt is what makes the model read
       it. Both, because either alone has been enough to produce the bug. */
    expect(EDGE_SOURCE).toMatch(/Never "none exist", never "the firm has none"/)
  })

  it('keeps maturity and decisions apart in the prompt', () => {
    expect(EDGE_SOURCE).toMatch(/Never report a pipeline stage as a decision/)
  })
})
