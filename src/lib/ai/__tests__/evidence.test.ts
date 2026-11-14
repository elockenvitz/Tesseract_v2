/**
 * One evidence model, not three.
 *
 * ── What was wrong ──────────────────────────────────────────────────────
 *
 * A response could present a reader with a research trail of every lookup AND
 * a separate citations list of quoted documents, with the same record in both
 * under different headings. The reader had to work out whether that was one
 * record or two, and whether "consulted" and "quoted" were the same claim.
 *
 * ── What must not be lost in fixing it ──────────────────────────────────
 *
 * The distinction. "Quoted" is a stronger statement than "consulted", and
 * pooling them would let a list of files the model merely opened read as
 * support for a specific sentence. The old code preserved it by rendering two
 * sections, which is what caused the duplication; this preserves it per
 * record. Most of the tests below are about that, and about the failed-lookup
 * case, which is the one that changes what a reader should believe.
 */
import { describe, it, expect } from 'vitest'
import {
  consolidateEvidence,
  evidenceHeading,
  lookupSummary,
} from '../evidence'
import type { AiSourceRef, MessageCitation, MessageToolCall } from '../presentation'

/* `AiSourceRef` directly: `MessageToolCall['sources']` is optional, so
   indexing it is a type error rather than a convenience. */
const source = (over: Partial<AiSourceRef> = {}): AiSourceRef => ({
  kind: 'decision_request' as const,
  id: 'dr1',
  asset_id: 'a1',
  symbol: 'AAPL',
  title: 'AAPL PM ruling: pending',
  timestamp: '2026-11-01T00:00:00Z',
  ...over,
})

const call = (over: Partial<MessageToolCall> = {}): MessageToolCall => ({
  name: 'get_decisions',
  input: { symbol: 'AAPL' },
  status: 'ok',
  result_count: 1,
  sources: [source()],
  ...over,
})

const citation = (over: Partial<MessageCitation> = {}): MessageCitation => ({
  document_title: 'AAPL PM ruling: pending',
  cited_text: 'The committee deferred pending a valuation refresh.',
  kind: 'decision_request',
  document_id: 'dr1',
  asset_id: 'a1',
  symbol: 'AAPL',
  ...over,
})

describe('the same record appears once', () => {
  it('folds a record found by two different lookups into one entry', () => {
    const e = consolidateEvidence({
      toolCalls: [
        call({ name: 'get_asset' }),
        call({ name: 'get_decisions' }),
      ],
    })
    expect(e.records).toHaveLength(1)
    /* Both lookups are still accounted for -- the dedup is of RECORDS, and
       losing a lookup would lose the provenance. */
    expect(e.lookups).toHaveLength(2)
  })

  it('folds a quoted document together with the lookup that found it', () => {
    /* The headline duplication: one record, listed twice, under two
       competing systems. */
    const e = consolidateEvidence({ toolCalls: [call()], citations: [citation()] })
    expect(e.records).toHaveLength(1)
  })

  it('keeps two records that merely share a kind', () => {
    const e = consolidateEvidence({
      toolCalls: [call({ sources: [source(), source({ id: 'dr2', title: 'MSFT ruling' })] })],
    })
    expect(e.records).toHaveLength(2)
  })

  it('keeps two records of different kinds that share an id', () => {
    /* Ids are not globally unique across tables. Keying on the id alone would
       merge a note and a requirement that happened to collide. */
    const e = consolidateEvidence({
      toolCalls: [call({
        sources: [source({ kind: 'note', id: 'x1', title: 'Note' }),
                  source({ kind: 'checklist_item', id: 'x1', title: 'Requirement' })],
      })],
    })
    expect(e.records).toHaveLength(2)
  })

  it('still separates two records when neither has an id', () => {
    const e = consolidateEvidence({
      citations: [
        citation({ document_id: undefined, document_title: 'Bull case' }),
        citation({ document_id: undefined, document_title: 'Bear case' }),
      ],
    })
    expect(e.records).toHaveLength(2)
  })
})

describe('quoted is a stronger claim than consulted', () => {
  it('labels a record the answer only looked at as consulted', () => {
    const e = consolidateEvidence({ toolCalls: [call()] })
    expect(e.records[0].relation).toBe('consulted')
  })

  it('upgrades a consulted record to quoted when it was also cited', () => {
    const e = consolidateEvidence({ toolCalls: [call()], citations: [citation()] })
    expect(e.records[0].relation).toBe('quoted')
  })

  it('does not downgrade a quoted record when a later lookup also finds it', () => {
    /* Order independence. The relation is a property of the record, not of
       which list happened to mention it last. */
    const e = consolidateEvidence({
      toolCalls: [call(), call({ name: 'get_asset' })],
      citations: [citation()],
    })
    expect(e.records[0].relation).toBe('quoted')
  })

  it('puts quoted records before consulted ones', () => {
    const e = consolidateEvidence({
      toolCalls: [call({
        sources: [source({ id: 'c1', title: 'Consulted only' }), source()],
      })],
      citations: [citation()],
    })
    expect(e.records.map(r => r.relation)).toEqual(['quoted', 'consulted'])
  })

  it('keeps the answer s own order within a group, so the list does not reshuffle', () => {
    const e = consolidateEvidence({
      toolCalls: [call({
        sources: [
          source({ id: 'r1', title: 'First' }),
          source({ id: 'r2', title: 'Second' }),
          source({ id: 'r3', title: 'Third' }),
        ],
      })],
    })
    expect(e.records.map(r => r.ref.title)).toEqual(['First', 'Second', 'Third'])
  })
})

describe('the record keeps its own words', () => {
  it('carries a citation snippet', () => {
    const e = consolidateEvidence({ citations: [citation()] })
    expect(e.records[0].quotes).toEqual(['The committee deferred pending a valuation refresh.'])
  })

  it('falls back to the trail excerpt when there is no citation', () => {
    const e = consolidateEvidence({
      toolCalls: [call({ sources: [source({ excerpt: 'Thesis last written in April.' })] })],
    })
    expect(e.records[0].quotes).toEqual(['Thesis last written in April.'])
  })

  it('does not repeat the same words twice', () => {
    const text = 'The committee deferred pending a valuation refresh.'
    const e = consolidateEvidence({
      toolCalls: [call({ sources: [source({ excerpt: text })] })],
      citations: [citation({ cited_text: text })],
    })
    expect(e.records[0].quotes).toEqual([text])
  })

  it('keeps two genuinely different quotations from one document', () => {
    const e = consolidateEvidence({
      citations: [citation(), citation({ cited_text: 'Target raised to 260.' })],
    })
    expect(e.records[0].quotes).toHaveLength(2)
  })

  it('takes the richer reference when two lookups describe one record', () => {
    /* A later lookup may carry the date or the lifecycle state the first one
       lacked. Losing it would render a record less completely purely because
       of call ordering. */
    const e = consolidateEvidence({
      toolCalls: [call({
        sources: [
          source({ timestamp: null, state: null }),
          source({ timestamp: '2026-11-01T00:00:00Z', state: 'pending' }),
        ],
      })],
    })
    expect(e.records[0].ref.state).toBe('pending')
    expect(e.records[0].ref.timestamp).toBe('2026-11-01T00:00:00Z')
  })
})

describe('a lookup that failed is never read as a lookup that found nothing', () => {
  it('counts the failures', () => {
    const e = consolidateEvidence({
      toolCalls: [call(), call({ status: 'error', sources: [], result_count: 0 })],
    })
    expect(e.failedCount).toBe(1)
  })

  it('says so in the provenance line rather than swallowing it', () => {
    const e = consolidateEvidence({
      toolCalls: [call(), call({ status: 'error', sources: [], result_count: 0 })],
    })
    expect(lookupSummary(e)).toBe('From 2 lookups, 1 of which failed')
  })

  it('says so when every lookup failed', () => {
    const e = consolidateEvidence({ toolCalls: [call({ status: 'error', sources: [] })] })
    expect(lookupSummary(e)).toBe('From 1 lookup, which failed')
  })

  it('claims nothing extra when all of them ran', () => {
    expect(lookupSummary(consolidateEvidence({ toolCalls: [call()] }))).toBe('From 1 lookup')
  })

  it('carries each lookup s own scoped sentence', () => {
    /* The three-outcome contract. An empty permission-scoped lookup must not
       read as a statement about the firm. */
    const e = consolidateEvidence({
      toolCalls: [call({
        status: 'empty', result_count: 0, sources: [],
        searched: 'AAPL', scope: 'caller_visible',
      })],
    })
    expect(e.lookups[0].outcome).toContain('you have access to')
    expect(e.lookups[0].outcome).not.toMatch(/in your organization/)
  })
})

describe('the heading counts what the list contains', () => {
  it('counts records, not lookups', () => {
    /* Counting lookups under a list of records is part of why the old trail
       read as diagnostics rather than as sources. */
    const e = consolidateEvidence({ toolCalls: [call(), call({ name: 'get_asset' })] })
    expect(e.records).toHaveLength(1)
    expect(evidenceHeading(e)).toBe('1 source')
  })

  it('is honest when lookups ran and found nothing', () => {
    const e = consolidateEvidence({
      toolCalls: [call({ status: 'empty', sources: [], result_count: 0 })],
    })
    expect(evidenceHeading(e)).toBe('1 lookup, no records')
  })

  it('pluralises', () => {
    const e = consolidateEvidence({
      toolCalls: [call({ sources: [source(), source({ id: 'dr2', title: 'Other' })] })],
    })
    expect(evidenceHeading(e)).toBe('2 sources')
  })
})

describe('it survives whatever a stored transcript contains', () => {
  it('reports empty for a message with neither', () => {
    const e = consolidateEvidence({})
    expect(e.isEmpty).toBe(true)
    expect(lookupSummary(e)).toBeNull()
  })

  it('does not throw on nulls, non-arrays or missing fields', () => {
    /* Transcripts written by older versions of the app are replayed through
       this, so a malformed entry must be skipped rather than fatal. */
    for (const input of [
      { toolCalls: null, citations: null },
      { toolCalls: undefined },
      { toolCalls: 'nope' as unknown as MessageToolCall[] },
      { toolCalls: [null as unknown as MessageToolCall] },
      { toolCalls: [{ name: 'x', input: {}, status: 'ok', sources: 'no' } as unknown as MessageToolCall] },
      { citations: [{} as MessageCitation] },
    ]) {
      expect(() => consolidateEvidence(input)).not.toThrow()
    }
  })

  it('skips a source with no usable title rather than listing a blank row', () => {
    const e = consolidateEvidence({
      toolCalls: [call({ sources: [source({ title: '   ' }), source({ id: 'ok', title: 'Real' })] })],
    })
    expect(e.records.map(r => r.ref.title)).toEqual(['Real'])
  })
})
