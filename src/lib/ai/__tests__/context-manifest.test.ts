/**
 * A context chip must be a claim the server supports.
 *
 * ── The defect ──────────────────────────────────────────────────────────
 *
 * Attaching an object wrote a tag row and drew a chip. The chip proved the
 * client's own write, nothing more. In `ai-chat`'s context loop a tag that
 * resolved to nothing returned an empty string and was dropped silently, so
 * "Large Cap Growth" sat pinned to the conversation while the answer was
 * built from no portfolio -- and the model, given neither the object nor any
 * statement that it was missing, answered as though the question had been
 * general.
 *
 * This suite covers the classification and the prompt the model is given
 * about its own gaps, plus a source check that the edge function actually
 * records an outcome for every tag instead of discarding the empty ones.
 *
 * The helper is imported directly from `supabase/functions/_shared`, which
 * is how edge logic is tested in this repo (see
 * `research-decisions-workflows.test.ts`): the pure part is importable and
 * the Deno-only part is not involved.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CONTEXT_TABLE,
  allResolved,
  classifyContext,
  contextGapPrompt,
  describeLoaded,
  isRetrievableType,
  manifestLogLine,
  type ContextEntry,
} from '../../../../supabase/functions/_shared/context-manifest.ts'

const LCG = 'a2693ece-cdb7-4f17-a292-7c4a55df8c68'

describe('classifyContext', () => {
  it('calls a loaded object resolved and keeps what loaded', () => {
    const e = classifyContext({ type: 'asset', id: 'a1', found: true, loaded: ['thesis', '3 notes'] })
    expect(e.outcome).toBe('resolved')
    expect(e.loaded).toEqual(['thesis', '3 notes'])
    expect(e.detail).toBeUndefined()
  })

  it('separates an object that is bare from one that is missing', () => {
    /* The distinction the reader needs. "The firm has written nothing on
       NVDA" is an answer; "I could not look at NVDA" is a fault. */
    const bare = classifyContext({ type: 'asset', id: 'a1', found: true, loaded: [] })
    const gone = classifyContext({ type: 'asset', id: 'a1', found: false })
    expect(bare.outcome).toBe('empty')
    expect(gone.outcome).toBe('unavailable')
    expect(bare.outcome).not.toBe(gone.outcome)
  })

  it('reports a failed read as failed, not as an absence', () => {
    const e = classifyContext({ type: 'portfolio', id: LCG, found: false, errored: true })
    expect(e.outcome).toBe('failed')
    expect(e.detail).toMatch(/failed/i)
  })

  it('lets a read failure outrank a missing row', () => {
    /* `errored` is checked before `found`, because a read that threw tells
       you nothing about whether the object exists. Reversing the order
       would report a transient Postgres fault as a deleted portfolio. */
    const e = classifyContext({ type: 'portfolio', id: LCG, found: false, errored: true, loaded: [] })
    expect(e.outcome).toBe('failed')
  })

  it('refuses a type the retrieval layer cannot honour', () => {
    const e = classifyContext({ type: 'trade_idea', id: 'x', found: true, loaded: ['thesis'] })
    expect(e.outcome).toBe('unsupported')
    expect(e.detail).toContain('trade_idea')
  })

  it('names both possibilities for an object it could not read, and claims neither', () => {
    /* Deleted and not-visible-to-you are the same empty result under the
       caller's RLS. Telling them apart needs a privileged read of a
       client-supplied id, which is forbidden here AND is itself a
       disclosure. So the wording must hold both. */
    const e = classifyContext({ type: 'portfolio', id: LCG, found: false })
    expect(e.detail).toMatch(/not found/i)
    expect(e.detail).toMatch(/visible/i)
    expect(e.detail).not.toMatch(/deleted\b(?!,)/i)
  })

  it('ignores blank entries in the loaded list', () => {
    const e = classifyContext({ type: 'asset', id: 'a1', found: true, loaded: ['', '   '] })
    expect(e.outcome).toBe('empty')
  })

  it('accepts exactly the four types the tag table accepts', () => {
    for (const t of ['asset', 'portfolio', 'theme', 'note']) {
      expect(isRetrievableType(t)).toBe(true)
      expect(CONTEXT_TABLE[t]).toBeTruthy()
    }
    for (const t of ['trade_idea', 'workflow', 'decision', '']) {
      expect(isRetrievableType(t)).toBe(false)
    }
  })
})

describe('describeLoaded', () => {
  it('counts documents by kind', () => {
    expect(describeLoaded(['thesis', 'note', 'note', 'note'], 0))
      .toEqual(['thesis', '3 notes'])
  })

  it('reports the string path as a summary when there are no documents', () => {
    expect(describeLoaded([], 400)).toEqual(['summary'])
  })

  it('finds nothing loaded when there are no documents and no text', () => {
    expect(describeLoaded([], 0)).toEqual([])
  })

  it('counts a portfolio with only a name as found, not empty', () => {
    /* A low threshold on purpose. A portfolio that exists but holds nothing
       is a real portfolio, and calling it `empty` would tell the reader the
       object could not be read. */
    expect(describeLoaded([], 1)).toEqual(['summary'])
  })

  it('does not double-count a kind that appears once', () => {
    expect(describeLoaded(['thesis'], 0)).toEqual(['thesis'])
  })
})

describe('contextGapPrompt', () => {
  const resolved: ContextEntry = { type: 'asset', id: 'a1', outcome: 'resolved', loaded: ['thesis'] }
  const missing: ContextEntry = { type: 'portfolio', id: LCG, outcome: 'unavailable' }

  it('says nothing when everything resolved', () => {
    /* Not a nicety: a line describing the normal case is paid for on every
       request. */
    expect(contextGapPrompt([resolved, resolved])).toBe('')
    expect(contextGapPrompt([])).toBe('')
    expect(allResolved([resolved])).toBe(true)
  })

  it('names the object the model could not read', () => {
    const p = contextGapPrompt([resolved, missing])
    expect(p).toContain(LCG)
    expect(p).toContain('portfolio')
    expect(p).not.toContain('a1')
  })

  it('tells the model the user believes it has the object', () => {
    /* The instruction that matters. A model told only "this is missing"
       answers around the hole; told that the reader can see the chip, it
       says which object it could not read. */
    const p = contextGapPrompt([missing])
    expect(p).toMatch(/they believe you have them/i)
    expect(p).toMatch(/say plainly/i)
  })

  it('forbids filling the hole from the question', () => {
    const p = contextGapPrompt([missing])
    expect(p).toMatch(/do not substitute general knowledge/i)
    expect(p).toMatch(/do not infer its contents from the question/i)
  })

  it('distinguishes a system fault from an absence in the wording', () => {
    const failed = contextGapPrompt([{ type: 'portfolio', id: LCG, outcome: 'failed' }])
    const absent = contextGapPrompt([{ type: 'portfolio', id: LCG, outcome: 'unavailable' }])
    expect(failed).toMatch(/system fault, not an absence/i)
    expect(absent).not.toMatch(/system fault/i)
  })

  it('tells the model an empty object was found rather than lost', () => {
    const p = contextGapPrompt([{ type: 'asset', id: 'a1', outcome: 'empty' }])
    expect(p).toMatch(/found, but nothing is recorded/i)
  })

  it('explains an unsupported type instead of implying it is missing', () => {
    const p = contextGapPrompt([{ type: 'trade_idea', id: 'x', outcome: 'unsupported' }])
    expect(p).toMatch(/cannot be loaded as context/i)
  })

  it('lists every gap, not just the first', () => {
    const p = contextGapPrompt([
      { type: 'portfolio', id: 'p1', outcome: 'unavailable' },
      { type: 'asset', id: 'a9', outcome: 'empty' },
      { type: 'note', id: 'n3', outcome: 'failed' },
    ])
    expect(p).toContain('p1')
    expect(p).toContain('a9')
    expect(p).toContain('n3')
  })
})

describe('manifestLogLine', () => {
  it('counts the outcomes and names the gaps', () => {
    const line = JSON.parse(manifestLogLine([
      { type: 'asset', id: 'a1', outcome: 'resolved' },
      { type: 'portfolio', id: LCG, outcome: 'unavailable' },
    ]))
    expect(line.attached).toBe(2)
    expect(line.resolved).toBe(1)
    expect(line.gaps).toEqual(['portfolio:unavailable'])
  })

  it('reports no gaps on a clean request', () => {
    const line = JSON.parse(manifestLogLine([{ type: 'asset', id: 'a1', outcome: 'resolved' }]))
    expect(line.gaps).toEqual([])
  })
})

/* ──────────────────────────────────────────────────────────────────────────
   The edge function has to USE it.

   A helper nothing calls is the exact shape of the original bug: the
   retrieval layer had a result contract and the context loop did not use
   it. These check the wiring, which no behavioural test of the helper can.
   ────────────────────────────────────────────────────────────────────────── */

const EDGE = readFileSync(
  join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', 'ai-chat', 'index.ts'),
  'utf8',
)

describe('ai-chat records an outcome for every attached tag', () => {
  it('imports the manifest helpers', () => {
    expect(EDGE).toMatch(/from "\.\.\/_shared\/context-manifest\.ts"/)
    for (const fn of ['classifyContext', 'contextGapPrompt', 'describeLoaded', 'isRetrievableType']) {
      expect(EDGE, `${fn} must be imported`).toContain(fn)
    }
  })

  it('pushes an entry for each tag rather than only the ones that loaded', () => {
    /*
     * Anchored to the whole line, not matched as a substring.
     *
     * This was `/contextManifest\.push\(p\.entry\)/`, and the obvious
     * regression -- `if (p.entry.outcome === "resolved") contextManifest
     * .push(p.entry)` -- CONTAINS that substring, so the case passed against
     * the bug it exists to catch. Found by injecting exactly that.
     *
     * The whole point of the manifest is the entries that did NOT resolve;
     * a filtered push is the original defect with extra steps.
     */
    expect(EDGE).toMatch(/^\s*contextManifest\.push\(p\.entry\);\s*$/m)
  })

  it('adds the gap paragraph to the prompt', () => {
    expect(EDGE).toMatch(/contextGapPrompt\(contextManifest\)/)
    expect(EDGE).toMatch(/contextPrompt \+= `\\n\$\{gapPrompt\}\\n`/)
  })

  it('returns the manifest to the client', () => {
    /* The chip reads this. Without it the pane is back to asserting its own
       write. */
    expect(EDGE).toMatch(/context:\s*contextManifest/)
  })

  it('catches a context read instead of failing the request', () => {
    expect(EDGE).toMatch(/errored:\s*true/)
  })

  it('puts the gap paragraph in the variable prompt, not the cached prefix', () => {
    /* `buildStableSystemPrompt` is the cached half. A per-request paragraph
       in it would invalidate the prefix cache on every request with a
       missing object, which is a cost regression disguised as a fix. */
    const stable = EDGE.indexOf('buildStableSystemPrompt({')
    const gap = EDGE.indexOf('contextGapPrompt(contextManifest)')
    expect(gap).toBeGreaterThan(-1)
    expect(gap).toBeLessThan(stable)
    expect(EDGE).toMatch(/buildVariableSystemPrompt\(verbosity, contextPrompt\)/)
  })
})

describe('the client and the server agree on the vocabulary', () => {
  /*
   * The client declares the five outcomes a second time, in
   * `src/lib/ai/context-outcome.ts`, because the browser bundle must not
   * import a Deno module. Two declarations of one vocabulary is exactly how
   * `AiStreamFinalEvent.tool_calls` went stale: `idea` was added to the
   * source-kind union in one place and missed in the other, so a real
   * source arriving on the wire did not type-check as one.
   *
   * This is that drift test. A sixth outcome on the server with no client
   * entry means the chip has no sentence for it and silently renders
   * nothing; a client outcome the server never sends means dead branches
   * that look like coverage.
   */
  const SHARED = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'supabase', 'functions', '_shared', 'context-manifest.ts'),
    'utf8',
  )

  /** The union members off `export type ContextOutcome = ...` in the shared file. */
  const serverOutcomes = () => {
    const m = SHARED.match(/export type ContextOutcome =([\s\S]*?);/)
    expect(m, 'ContextOutcome union not found in the shared module').toBeTruthy()
    return [...m![1].matchAll(/"([a-z_]+)"/g)].map(x => x[1]).sort()
  }

  it('declares the same five outcomes on both sides', async () => {
    const { CONTEXT_OUTCOMES } = await import('../context-outcome')
    expect([...CONTEXT_OUTCOMES].sort()).toEqual(serverOutcomes())
  })

  it('gives every outcome its own tooltip sentence', async () => {
    /* A missing branch returns undefined, which React renders as no title at
       all -- a silent downgrade to the behaviour this whole change replaces. */
    const { CONTEXT_OUTCOMES, retrievalTitle } = await import('../context-outcome')
    for (const o of CONTEXT_OUTCOMES) {
      const title = retrievalTitle('Large Cap Growth', o)
      if (o === 'resolved') {
        expect(title, 'resolved says nothing, deliberately').toBeNull()
      } else {
        expect(title, `no sentence for ${o}`).toBeTruthy()
        expect(title).toContain('Large Cap Growth')
      }
    }
  })

  it('classifies every outcome as a gap or not, with no undefined', async () => {
    const { CONTEXT_OUTCOMES, isRetrievalGap } = await import('../context-outcome')
    for (const o of [...CONTEXT_OUTCOMES, 'unknown' as const]) {
      expect(typeof isRetrievalGap(o as never), `${o} is unclassified`).toBe('boolean')
    }
  })

  it('treats exactly the three faults as gaps', async () => {
    const { isRetrievalGap } = await import('../context-outcome')
    expect(isRetrievalGap('unavailable')).toBe(true)
    expect(isRetrievalGap('unsupported')).toBe(true)
    expect(isRetrievalGap('failed')).toBe(true)
    /* `empty` is a finding, not a fault. `resolved` and `unknown` are fine. */
    expect(isRetrievalGap('empty')).toBe(false)
    expect(isRetrievalGap('resolved')).toBe(false)
    expect(isRetrievalGap('unknown')).toBe(false)
  })
})

describe('the banner above the composer', () => {
  it('names one object', async () => {
    const { retrievalBanner } = await import('../context-outcome')
    const line = retrievalBanner(
      [{ type: 'portfolio', id: LCG, outcome: 'unavailable' }],
      () => 'Large Cap Growth',
    )
    expect(line).toBe('Large Cap Growth was attached but could not be read, so the last answer did not use it.')
  })

  it('joins two with "and", and three with commas', async () => {
    const { retrievalBanner } = await import('../context-outcome')
    const names = ['A', 'B', 'C']
    const two = retrievalBanner(
      [{ type: 'asset', id: '1', outcome: 'failed' }, { type: 'asset', id: '2', outcome: 'failed' }],
      e => names[Number(e.id) - 1],
    )
    expect(two).toContain('A and B')
    expect(two).toContain('were attached')

    const three = retrievalBanner(
      [1, 2, 3].map(n => ({ type: 'asset', id: String(n), outcome: 'failed' as const })),
      e => names[Number(e.id) - 1],
    )
    expect(three).toContain('A, B and C')
  })

  it('stays silent when the only unresolved object is simply bare', async () => {
    /* Otherwise every question about a name the firm has not written on
       raises a warning, and the reader stops reading warnings. */
    const { retrievalBanner } = await import('../context-outcome')
    expect(retrievalBanner([{ type: 'asset', id: 'a1', outcome: 'empty' }], () => 'NVDA')).toBeNull()
  })

  it('stays silent when everything resolved, and when nothing was attached', async () => {
    const { retrievalBanner } = await import('../context-outcome')
    expect(retrievalBanner([{ type: 'asset', id: 'a1', outcome: 'resolved' }], () => 'AAPL')).toBeNull()
    expect(retrievalBanner([], () => 'x')).toBeNull()
  })
})
