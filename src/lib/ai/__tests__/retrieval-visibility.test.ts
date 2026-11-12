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
  summarizeToolResult,
  excerptOf,
} from '../../../../supabase/functions/_shared/research-results'
/* The panel's half of the same rule. Imported here rather than tested
   separately so a scope change breaks one file, not two that agree. */
import { emptySentence, foundSentence, sourceStateLabel, toolCallOutcome } from '../trail-text'
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

  it('reaches the panel, not only the model', () => {
    /*
     * The summary is what the browser gets. The declaration used to stop
     * here: it was in the tool result the model read, and `summarizeToolResult`
     * dropped it, so the research trail wrote its own absence sentence with
     * no idea how far the lookup had seen.
     */
    const empty = summarizeToolResult('get_pending_decisions', toolEmpty('get_pending_decisions', { scope: 'your inbox' }))
    expect(empty.status).toBe('empty')
    expect(empty.scope).toBe('caller_visible')

    /* Read from the table, not hardcoded: `coverage` is org-wide readable, so
       this tool declares `organization` and the test must follow the
       declaration rather than assert a second opinion about it. */
    const ok = summarizeToolResult('get_coverage', toolOk('get_coverage', { assignments: [], records_returned: 4 }))
    expect(ok.status).toBe('ok')
    expect(ok.scope).toBe(TOOL_VISIBILITY.get_coverage.scope)

    /* Not on an error: nothing was learned, so there is no reach to report. */
    const failed = summarizeToolResult('get_coverage', toolError('get_coverage', 'coverage'))
    expect(failed.status).toBe('error')
    expect(failed.scope).toBeUndefined()
  })

  it('survives a tool the client has not learned, without losing the trail', () => {
    /* `toolVisibility` throws by design, and that is right at the call site.
       It would be wrong here: this runs on every answer, and an unknown tool
       must cost the reader a scope, not their whole research trail. */
    const s = summarizeToolResult(
      'get_something_new',
      JSON.stringify({ tool: 'get_something_new', status: 'ok', records_returned: 2 }),
    )
    expect(s.status).toBe('ok')
    expect(s.scope).toBeUndefined()
  })
})

/*
 * The panel is a SECOND voice, under the same rule.
 *
 * The model is instructed never to turn an RLS-filtered zero into a claim
 * about the firm. The research trail renders directly underneath its answer
 * and was making exactly that claim in its own words: "No matching records."
 * for every empty result, whatever the reach. A careful sentence from the
 * model and a careless one from the panel is still a reader told the firm
 * holds nothing.
 */
describe('the panel says no more than the lookup could see', () => {
  it('speaks for the firm only on an organization-wide path', () => {
    expect(emptySentence(undefined, 'organization')).toBe('No records in your organization.')
    expect(emptySentence('AAPL', 'organization')).toBe('No records for AAPL in your organization.')
  })

  it('speaks only for the reader on a permission-scoped path', () => {
    const s = emptySentence('AAPL in your inbox', 'caller_visible')
    expect(s).toBe('Nothing for AAPL in your inbox that you have access to.')
    /* The sentences the brief forbids. */
    expect(s).not.toMatch(/\bnone exist\b|\bthe firm has\b|\bno records exist\b/i)
    expect(s).not.toBe('No matching records.')
  })

  it('speaks only for the reader s own rows on a caller path', () => {
    expect(emptySentence(undefined, 'caller')).toBe('None of yours.')
  })

  it('claims nothing about the firm when no reach was declared', () => {
    /* An older message, or a tool the client has not learned. A statement
       about MATCHES is the weakest true thing available, so that is what it
       says. */
    expect(emptySentence('AAPL', undefined)).toBe('No matches for AAPL.')
    expect(emptySentence(undefined, undefined)).toBe('No matching records.')
  })

  it('never phrases a non-organization absence as a fact about the firm', () => {
    /* The property, over every declared tool. The table is what decides, so
       this catches a tool whose scope changes without its sentence. */
    for (const [tool, decl] of Object.entries(TOOL_VISIBILITY)) {
      if (decl.scope === 'organization') continue
      const s = emptySentence('something', decl.scope)
      expect(s, `${tool} (${decl.scope})`).toMatch(/you have access to|of yours/)
      expect(s, `${tool} (${decl.scope})`).not.toMatch(/organization/)
    }
  })

  it('handles every scope the server actually declares', () => {
    /*
     * The mirror guard, asserted by behaviour rather than by reading the
     * union's source text.
     *
     * `AiVisibilityScope` is a hand-written copy of the server's
     * `VisibilityScope`, and types are erased, so nothing stops a fourth
     * scope from being added server-side and silently falling through to the
     * no-reach fallback here. That fallback is the OLD sentence, which means
     * the regression would be invisible: the panel would keep working and
     * keep understating what it knew.
     *
     * So: a scope the table declares must produce a scoped sentence, which
     * the fallback by definition is not.
     */
    const FALLBACK_EMPTY = emptySentence(undefined, undefined)
    const FALLBACK_FOUND = foundSentence(3, undefined)
    const declared = new Set(Object.values(TOOL_VISIBILITY).map(v => v.scope))
    expect(declared.size).toBeGreaterThan(1)
    for (const scope of declared) {
      expect(emptySentence(undefined, scope), `empty sentence for ${scope}`).not.toBe(FALLBACK_EMPTY)
      expect(foundSentence(3, scope), `found sentence for ${scope}`).not.toBe(FALLBACK_FOUND)
    }
  })

  it('says whose records a count counted', () => {
    /* The partial-answer case. 18 of 84 reads as the whole desk otherwise. */
    expect(foundSentence(18, 'caller_visible')).toBe('18 records you have access to.')
    expect(foundSentence(1, 'caller_visible')).toBe('1 record you have access to.')
    expect(foundSentence(4, 'organization')).toBe('4 records in your organization.')
    expect(foundSentence(4, 'caller')).toBe('4 records of yours.')
    expect(foundSentence(4, undefined)).toBe('4 records found.')
  })

  it('renders the three outcomes as three different sentences', () => {
    /* The rule the whole layer exists for, now with scope in play: an error
       must not read like an absence at any scope. */
    const base = { name: 'get_pending_decisions', input: {}, scope: 'caller_visible' as const }
    const ok = toolCallOutcome({ ...base, status: 'ok', result_count: 3 })
    const none = toolCallOutcome({ ...base, status: 'empty' })
    const failed = toolCallOutcome({ ...base, status: 'error' })

    expect(new Set([ok.text, none.text, failed.text]).size).toBe(3)
    expect(failed.text).toMatch(/failed/)
    expect(failed.text).not.toMatch(/\bno\b|\bnothing\b|\bnone\b/i)
    expect(none.text).toMatch(/you have access to/)
    expect(ok.text).toMatch(/you have access to/)
  })

  it('reads a record s own state, never the lookup s', () => {
    expect(sourceStateLabel('ready_to_recommend')).toBe('Ready to recommend')
    expect(sourceStateLabel('overdue')).toBe('Overdue')
    expect(sourceStateLabel(null)).toBeNull()
    expect(sourceStateLabel('')).toBeNull()
    expect(sourceStateLabel('   ')).toBeNull()
  })
})

describe('an excerpt is the record s own words, cut to fit', () => {
  it('collapses the editor s whitespace', () => {
    expect(excerptOf('A thesis.\n\n  Second   paragraph.')).toBe('A thesis. Second paragraph.')
  })

  it('cuts on a word boundary and marks the cut', () => {
    const e = excerptOf('alpha bravo charlie delta echo foxtrot', 20)
    expect(e).toBe('alpha bravo charlie…')
    expect(e!.length).toBeLessThanOrEqual(21)
  })

  it('still cuts text with no spaces to cut on', () => {
    const e = excerptOf('x'.repeat(200), 20)
    expect(e).toBe(`${'x'.repeat(20)}…`)
  })

  it('leaves short text exactly as written, with no ellipsis', () => {
    expect(excerptOf('Short note.')).toBe('Short note.')
  })

  it('treats nothing, and nothing textual, as no excerpt', () => {
    expect(excerptOf(null)).toBeNull()
    expect(excerptOf(undefined)).toBeNull()
    expect(excerptOf('')).toBeNull()
    expect(excerptOf('   \n ')).toBeNull()
    expect(excerptOf(42)).toBeNull()
  })

  it('carries a note s own words into the trail', () => {
    /* End to end through the summarizer, from the shape the handler sends. */
    const s = summarizeToolResult('search_team_notes', toolOk('search_team_notes', {
      results: [{
        id: 'n1', asset_id: 'a1', symbol: 'AAPL', title: 'Channel checks',
        excerpt: 'Supplier lead times extended again in the March quarter.',
        updated_at: '2026-11-01T00:00:00Z',
      }],
    }))
    const note = s.sources?.[0]
    expect(note?.title).toBe('Channel checks')
    expect(note?.excerpt).toBe('Supplier lead times extended again in the March quarter.')
  })

  it('marks an overdue requirement as overdue and a dateless one as open', () => {
    /*
     * The absent-field case, which this product has got wrong before: a row
     * with no due date was mapped to Overdue. The handler decides, and a row
     * it did not flag is open.
     */
    const s = summarizeToolResult('get_outstanding_work', toolOk('get_outstanding_work', {
      work: [{
        workflow_id: 'w1', asset_id: 'a1', symbol: 'AAPL', workflow: 'Deep dive',
        open_requirements: [
          { id: 'r1', requirement: 'Build the model', due_date: '2026-01-01', is_overdue: true },
          { id: 'r2', requirement: 'Call the CFO', due_date: null },
        ],
      }],
    }))
    const items = (s.sources ?? []).filter(x => x.kind === 'checklist_item')
    expect(items.map(i => i.state)).toEqual(['overdue', 'open'])
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
