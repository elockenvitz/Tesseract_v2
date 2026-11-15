/**
 * A failed research lookup must never read as "we have no research".
 *
 * ── The defect ───────────────────────────────────────────────────────────
 *
 * Every ai-chat tool query was written `const { data } = await ...`. A failure
 * left `data` null, `data || []` turned that into `[]`, and the model was
 * handed the same `{"results":[]}` it gets for a genuine miss. It then told
 * the user there was no research on the name -- a claim about the firm's own
 * record that the function had no basis for. `get_theme` queried a table that
 * does not exist and reported "no constituents" for every theme for as long as
 * it existed, and not one error reached anybody.
 *
 * So these tests are about a DISTINCTION, not a shape: ok, empty and error are
 * three different facts, and nothing in this module may collapse them. The
 * first test is the regression -- it feeds in the exact legacy payload and
 * requires that it NOT be classified as an empty search.
 *
 * ── The second property ──────────────────────────────────────────────────
 *
 * What crosses the wire carries no database detail. A driver message names
 * tables, columns, policies and sometimes row values; it goes to the logger
 * and stays server-side. Several tests below assert on the absence of that
 * text in the returned payload, which is the only place it could leak to the
 * model or the browser.
 */
import { describe, expect, it } from 'vitest'
import {
  SECTION_LABELS,
  buildNoteSearchTerms,
  escapeLike,
  runQuery,
  summarizeToolResult,
  toolEmpty,
  toolError,
  toolOk,
  type ToolResultSummary,
} from '../../../../supabase/functions/_shared/research-results'

/** A driver message of the kind Postgres actually returns, with a table in it. */
const DRIVER_MESSAGE =
  'relation "public.asset_themes" does not exist; policy "asset_notes_select_own_or_shared" on asset_notes'

function capture() {
  const lines: string[] = []
  const log = (m: string, d?: string) => { lines.push(`${m} ${d ?? ''}`) }
  return { lines, log, joined: () => lines.join('\n') }
}

describe('runQuery: a failure is reported as a failure', () => {
  it('reports failed for a postgrest error and returns no data', async () => {
    const log = capture()
    const r = await runQuery<unknown[]>(
      'get_theme', 'constituents',
      Promise.resolve({ data: null, error: { message: DRIVER_MESSAGE } }),
      log.log,
    )
    expect(r.failed).toBe(true)
    expect(r.data).toBeNull()
  })

  it('reports failed when the query THROWS, not just when it returns an error', async () => {
    // A transport failure, an aborted fetch and a null client all arrive this
    // way. Before the fix this was an unhandled rejection inside the tool
    // executor, whose catch tail returned a generic result the model read as
    // an answer.
    const log = capture()
    const r = await runQuery<unknown[]>(
      'get_asset', 'notes',
      Promise.reject(new Error('fetch failed')),
      log.log,
    )
    expect(r.failed).toBe(true)
    expect(r.data).toBeNull()
  })

  it('reports success and passes the rows through untouched', async () => {
    const rows = [{ id: 'a' }, { id: 'b' }]
    const r = await runQuery('search_assets', 'q', Promise.resolve({ data: rows, error: null }))
    expect(r.failed).toBe(false)
    expect(r.data).toBe(rows)
  })

  it('does NOT treat zero rows as a failure', async () => {
    // The other half of the distinction. A real empty result must stay empty,
    // or the fix would turn every genuine miss into a scary error.
    const r = await runQuery('search_team_notes', 'terms', Promise.resolve({ data: [], error: null }))
    expect(r.failed).toBe(false)
    expect(r.data).toEqual([])
  })

  it('logs the tool and stage so an operator can find the broken query', async () => {
    const log = capture()
    await runQuery('get_theme', 'constituents',
      Promise.resolve({ data: null, error: { message: DRIVER_MESSAGE } }), log.log)
    expect(log.joined()).toContain('get_theme')
    expect(log.joined()).toContain('constituents')
    expect(log.joined()).toContain('asset_themes')
  })
})

describe('the three payloads are distinguishable, and leak nothing', () => {
  it('toolError says the lookup failed and does not say none were found', () => {
    const raw = toolError('get_theme', 'constituents')
    const p = JSON.parse(raw)
    expect(p.status).toBe('error')
    expect(p.stage).toBe('constituents')
    // The instruction the model acts on. Without it a bare `status` is just a
    // field the model is free to paraphrase away.
    expect(p.note).toMatch(/do not say none were found/i)
    expect(raw).not.toContain('asset_themes')
    expect(raw).not.toContain('policy')
  })

  it('toolEmpty states what was searched, so the absence is bounded', () => {
    const p = JSON.parse(toolEmpty('search_team_notes', {
      query: 'thesis', asset_symbol: 'AAPL', scope: 'notes on AAPL',
    }))
    expect(p.status).toBe('empty')
    expect(p.searched).toEqual({ query: 'thesis', asset_symbol: 'AAPL', scope: 'notes on AAPL' })
    expect(p.note).toMatch(/absence of MATCHES/i)
  })

  it('toolOk carries the payload and nothing is renamed under it', () => {
    const p = JSON.parse(toolOk('get_asset', { asset_id: 'x', symbol: 'AAPL' }))
    expect(p).toMatchObject({ tool: 'get_asset', status: 'ok', asset_id: 'x', symbol: 'AAPL' })
  })

  it('a tool cannot overwrite its own status through its payload', () => {
    // `toolOk(tool, {...payload})` spreads the payload AFTER the status, so a
    // payload key called `status` would win. It must not: a tool that happens
    // to select a column named `status` would relabel its own outcome.
    const p = JSON.parse(toolOk('get_portfolio', { status: 'empty', name: 'Core' }))
    expect(p.status).toBe('ok')
  })
})

describe('summarizeToolResult: the browser is told the truth', () => {
  it('REGRESSION: the legacy `{"results":[]}` payload is an ERROR, not an empty search', () => {
    // This is the exact string the Research panel showed the user next to
    // "Searched notes for AAPL Apple thesis risk decision". It carries no
    // status, so its outcome is unknown -- and unknown is not "none found".
    const s = summarizeToolResult('search_team_notes', '{"results":[]}', capture().log)
    expect(s.status).toBe('error')
    expect(s.status).not.toBe('empty')
    // And it must not assert a count, which would read as a measured zero.
    expect(s.result_count).toBeUndefined()
  })

  it('classifies unparseable output as an error', () => {
    const log = capture()
    const s = summarizeToolResult('get_asset', 'Internal Server Error', log.log)
    expect(s.status).toBe('error')
    expect(log.joined()).toContain('unparseable')
  })

  it('an unknown status value is an error, not silently accepted', () => {
    const s = summarizeToolResult('get_theme', '{"status":"partial","constituents_returned":3}', capture().log)
    expect(s.status).toBe('error')
  })

  it('carries an error through with what was searched, and no stage detail', () => {
    const s = summarizeToolResult('search_team_notes', toolError('search_team_notes', 'terms'), capture().log)
    expect(s.status).toBe('error')
    expect(s.sources).toBeUndefined()
    expect(JSON.stringify(s)).not.toContain('terms')
  })

  it('describes an empty search in words the UI can show', () => {
    const s = summarizeToolResult('search_team_notes',
      toolEmpty('search_team_notes', { query: 'moat', scope: 'notes on AAPL' }), capture().log)
    expect(s.status).toBe('empty')
    expect(s.searched).toBe('"moat" in notes on AAPL')
  })

  it('turns an asset lookup into titled, dated, openable sources', () => {
    const raw = toolOk('get_asset', {
      asset_id: 'asset-1',
      symbol: 'AAPL',
      sections: {
        thesis: { id: 'contrib-1', updated_at: '2026-04-02T10:00:00Z', content: 'long body text' },
        risks_to_thesis: { id: 'contrib-2', updated_at: '2026-04-03T10:00:00Z' },
      },
      price_targets: [{ id: 'pt-1', type: 'bull', price: 310, created_at: '2026-03-01T00:00:00Z' }],
      recent_notes: [{ id: 'note-1', title: 'Q2 teardown', updated_at: '2026-05-01T00:00:00Z' }],
    })
    const s = summarizeToolResult('get_asset', raw, capture().log)

    expect(s.status).toBe('ok')
    const byId = Object.fromEntries((s.sources ?? []).map((x) => [x.id, x]))

    expect(byId['asset-1']).toMatchObject({ kind: 'asset', asset_id: 'asset-1', symbol: 'AAPL' })
    expect(byId['contrib-1']).toMatchObject({
      kind: 'contribution', asset_id: 'asset-1', timestamp: '2026-04-02T10:00:00Z',
    })
    // Human-readable, and the label comes from the shared map rather than the
    // raw slug the column stores.
    expect(byId['contrib-1'].title).toContain(SECTION_LABELS.thesis)
    expect(byId['contrib-1'].title).not.toContain('risks_to_thesis')
    expect(byId['pt-1']).toMatchObject({ kind: 'price_target', asset_id: 'asset-1' })
    expect(byId['pt-1'].title).toContain('BULL')
    expect(byId['note-1']).toMatchObject({
      kind: 'note', asset_id: 'asset-1', title: 'Q2 teardown', timestamp: '2026-05-01T00:00:00Z',
    })
  })

  it('every source is openable or is not claimed to be a record of an asset', () => {
    const s = summarizeToolResult('get_asset', toolOk('get_asset', {
      asset_id: 'asset-1', symbol: 'AAPL',
      sections: { thesis: { id: 'c1' } },
      recent_notes: [{ id: 'n1', title: 'T' }],
    }), capture().log)
    for (const src of s.sources ?? []) {
      expect(src.id).toBeTruthy()
      expect(src.title).toBeTruthy()
      if (src.kind !== 'portfolio' && src.kind !== 'theme') expect(src.asset_id).toBe('asset-1')
    }
  })

  it('drops records with no id rather than emitting a link that goes nowhere', () => {
    const s = summarizeToolResult('search_team_notes', toolOk('search_team_notes', {
      results: [{ id: 'n1', title: 'Real' }, { title: 'Orphan with no id' }],
    }), capture().log)
    expect((s.sources ?? []).map((x) => x.id)).toEqual(['n1'])
  })

  /*
   * This test used to forbid record text in the summary outright.
   *
   * It was guarding two different things at once, and only one of them was
   * the real boundary. The trail now shows a short quotation from each record
   * -- a title and a date identify a row without letting anybody judge it --
   * and that text is safe to SHOW, because it came back through the reader's
   * own RLS-scoped query and is content they can already open.
   *
   * The boundary that matters is STORAGE, and it is now asserted where it
   * happens: `stripStoredExcerpts` in `history.test.ts`. What is still
   * forbidden here is the FULL body, which never travels at all: the server
   * sends `content_excerpt`, a computed column, and the summarizer trims it
   * again. A note's whole content reaching the client would be both a leak of
   * volume and the two-million-character read that column exists to prevent.
   */
  it('carries a trimmed excerpt, never a record s full body', () => {
    const BODY = 'FULL-NOTE-BODY-THAT-MUST-NOT-TRAVEL'
    const s = summarizeToolResult('search_team_notes', toolOk('search_team_notes', {
      query: 'moat',
      results: [{ id: 'n1', title: 'Q2 teardown', excerpt: 'margins compressed', content: BODY }],
    }), capture().log)
    expect(JSON.stringify(s)).not.toContain(BODY)
    expect(s.sources?.[0]?.title).toBe('Q2 teardown')
    expect(s.sources?.[0]?.excerpt).toBe('margins compressed')
  })

  it('trims an over-long excerpt rather than passing it through', () => {
    /* The server's computed column already truncates. This is the second
       bound, for a payload that arrives longer than a trail row can hold. */
    const s = summarizeToolResult('search_team_notes', toolOk('search_team_notes', {
      results: [{ id: 'n1', title: 'T', excerpt: 'word '.repeat(200) }],
    }), capture().log)
    const e = s.sources?.[0]?.excerpt ?? ''
    expect(e.length).toBeLessThanOrEqual(181)
    expect(e.endsWith('…')).toBe(true)
  })

  it('counts theme constituents and portfolio holdings from their own fields', () => {
    const theme = summarizeToolResult('get_theme',
      toolOk('get_theme', { theme_id: 't1', name: 'AI infrastructure', constituents_returned: 20 }),
      capture().log)
    expect(theme.result_count).toBe(20)
    expect(theme.sources?.[0]).toMatchObject({ kind: 'theme', id: 't1', title: 'AI infrastructure' })

    const pf = summarizeToolResult('get_portfolio',
      toolOk('get_portfolio', { portfolio_id: 'p1', name: 'Core', holdings_returned: 42 }),
      capture().log)
    expect(pf.result_count).toBe(42)
  })
})

describe('buildNoteSearchTerms: the search that found nothing', () => {
  it('REGRESSION: splits the live failing query instead of asking for the whole phrase', () => {
    // The model wrote this. The old code sent it as one ILIKE pattern, so it
    // asked for notes containing all 31 characters in that order. Seven notes
    // on AAPL existed; none matched.
    const terms = buildNoteSearchTerms('AAPL Apple thesis risk decision')
    expect(terms).toEqual(['aapl', 'apple', 'thesis', 'risk', 'decision'])
  })

  it('drops stopwords and fragments, so the fallback does not match every note', () => {
    expect(buildNoteSearchTerms('what have we written about the moat and its risks'))
      .toEqual(['written', 'moat', 'risks'])
  })

  it('dedupes and caps the term list', () => {
    expect(buildNoteSearchTerms('moat moat moat')).toEqual(['moat'])
    expect(buildNoteSearchTerms('alpha bravo charlie delta echo foxtrot golf hotel', 6)).toHaveLength(6)
  })

  it('keeps hyphenated terms and discards punctuation', () => {
    expect(buildNoteSearchTerms('free-cash-flow, margins!')).toEqual(['free-cash-flow', 'margins'])
  })

  it('returns nothing for a query made only of stopwords, rather than matching everything', () => {
    expect(buildNoteSearchTerms('what about the')).toEqual([])
  })
})

describe('escapeLike: a query cannot widen its own pattern', () => {
  it('escapes the ilike wildcards', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('a_b')).toBe('a\\_b')
  })

  it('removes the comma that would otherwise split a PostgREST or= clause', () => {
    // A note titled "risk, reward" would otherwise inject an extra predicate
    // into the or= list and widen the search.
    expect(escapeLike('risk, reward')).not.toContain(',')
  })
})

/**
 * ── Non-vacuity ──────────────────────────────────────────────────────────
 *
 * The suite above would be decoration if it passed against the code it
 * replaces, so the two defects are reconstructed here and the assertions are
 * pointed at them. These tests FAIL if the implementation ever reverts.
 */
describe('non-vacuity: the old implementations are caught', () => {
  /** The pre-fix tool body: a failure became `[]`, and `[]` became "none found". */
  async function legacyTool(
    query: PromiseLike<{ data: unknown[] | null; error: unknown }>,
  ): Promise<string> {
    const { data } = await query
    return JSON.stringify({ results: data || [] })
  }

  /** The pre-fix client summary: the raw JSON, cut at 160 characters. */
  function legacySummary(raw: string): { result_summary: string } {
    return { result_summary: raw.slice(0, 160) }
  }

  it('the old tool body turns a failure into an empty result', async () => {
    const legacy = await legacyTool(Promise.resolve({ data: null, error: { message: DRIVER_MESSAGE } }))
    // Indistinguishable from a real miss. That is the whole defect.
    expect(legacy).toBe('{"results":[]}')
    expect(legacy).toBe(await legacyTool(Promise.resolve({ data: [], error: null })))

    // And the new classifier refuses to read it as a miss.
    expect(summarizeToolResult('search_team_notes', legacy, capture().log).status).toBe('error')
  })

  it('the new tool body keeps the same two cases apart', async () => {
    const failed = await runQuery<unknown[]>('search_team_notes', 'terms',
      Promise.resolve({ data: null, error: { message: DRIVER_MESSAGE } }), capture().log)
    const missed = await runQuery<unknown[]>('search_team_notes', 'terms',
      Promise.resolve({ data: [], error: null }), capture().log)

    const failedOut = failed.failed
      ? toolError('search_team_notes', 'terms')
      : toolEmpty('search_team_notes', { query: 'q' })
    const missedOut = missed.failed
      ? toolError('search_team_notes', 'terms')
      : toolEmpty('search_team_notes', { query: 'q' })

    expect(failedOut).not.toBe(missedOut)
    expect(summarizeToolResult('search_team_notes', failedOut, capture().log).status).toBe('error')
    expect(summarizeToolResult('search_team_notes', missedOut, capture().log).status).toBe('empty')
  })

  it('the old summary put raw JSON in front of the user; the new one never does', () => {
    const raw = toolOk('search_team_notes', {
      results: [{ id: 'n1', title: 'Q2 teardown', excerpt: 'margins compressed' }],
    })
    expect(legacySummary(raw).result_summary).toContain('{"tool"')

    const s: ToolResultSummary = summarizeToolResult('search_team_notes', raw, capture().log)
    // The summary is structured fields, not a JSON string pasted into one.
    // `scope` joined them so the trail can say how far the lookup saw; the
    // point of the assertion is the SHAPE, so it is still exhaustive.
    expect(Object.keys(s).sort()).toEqual(['result_count', 'scope', 'searched', 'sources', 'status'])
    // And no raw JSON anywhere in it, which was the actual defect.
    expect(JSON.stringify(s)).not.toContain('{"tool"')
    expect(s.sources?.[0]?.excerpt).toBe('margins compressed')
  })

  it('the old get_theme table name is still wrong, and would now surface as an error', async () => {
    // `asset_themes` does not exist; the relationship is `theme_assets`. The
    // point of this test is that the failure is now VISIBLE: the same broken
    // query that silently reported "no constituents" produces status error.
    const broken = await runQuery<unknown[]>('get_theme', 'constituents',
      Promise.resolve({ data: null, error: { message: 'relation "public.asset_themes" does not exist' } }),
      capture().log)
    const out = broken.failed
      ? toolError('get_theme', 'constituents')
      : toolOk('get_theme', { constituents_returned: 0 })
    const s = summarizeToolResult('get_theme', out, capture().log)
    expect(s.status).toBe('error')
    expect(s.result_count).toBeUndefined()
  })
})
