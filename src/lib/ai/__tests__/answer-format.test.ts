/**
 * The prompt asks for a presentation the client can actually render.
 *
 * ── Why this is two different tests ──────────────────────────────────────
 *
 * The first half is a drift guard: the edge function cannot import from
 * `src`, so the contract is mirrored into its prompt, and a mirror that
 * disagrees with its source is the recurring defect in this codebase.
 *
 * The second half is the one that matters, and it is not about text at all.
 * A rule in a prompt is worth nothing if the client does not honour it, and
 * that failure mode is silent rather than loud: a prompt that asked for a
 * bare `AAPL` instead of `$AAPL` would produce answers that read perfectly
 * and contain no working links, and nobody reviewing an answer would see it.
 * So for each rule the contract states, these assert that the module which
 * implements the rendering does the thing the rule promises.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  presentationContract,
  TICKER_FORM,
  FIGURE_RULES,
  CLAIM_KINDS,
  TABLE_RULES,
  ANSWER_FORMS,
} from '../answer-format'
import { preprocessTickers } from '../markdown'
import { readFigure, figureTone, numericColumns } from '../figures'

const EDGE_SOURCE = readFileSync(
  resolve(process.cwd(), 'supabase/functions/ai-chat/index.ts'),
  'utf8',
)

/** The mirrored contract as the edge function spells it. */
function edgeContract(): string {
  const m = EDGE_SOURCE.match(/const PRESENTATION_CONTRACT = `([\s\S]*?)`;/)
  expect(m, 'PRESENTATION_CONTRACT not found in the edge function').toBeTruthy()
  return m![1]
}

describe('the mirror does not drift', () => {
  it('is the same contract on both sides, character for character', () => {
    expect(edgeContract()).toBe(presentationContract())
  })

  it('is actually in the prompt the model receives, not merely declared', () => {
    /* A constant nobody interpolates is decoration. The stable half is the
       right place for it: identical for every request, so it caches. */
    const used = EDGE_SOURCE.indexOf('${PRESENTATION_CONTRACT}')
    expect(used, 'the contract is declared but never interpolated').toBeGreaterThan(-1)
    /* Positional rather than by matching the function body: a brace-counting
       regex over a file full of template literals is its own bug. The
       interpolation has to land between the start of the stable builder and
       the start of the variable one, which is the cached half. */
    const stableStart = EDGE_SOURCE.indexOf('function buildStableSystemPrompt')
    const variableStart = EDGE_SOURCE.indexOf('function buildVariableSystemPrompt')
    expect(stableStart).toBeGreaterThan(-1)
    expect(variableStart).toBeGreaterThan(stableStart)
    expect(used).toBeGreaterThan(stableStart)
    expect(used).toBeLessThan(variableStart)
  })

  it('carries every rule the module defines', () => {
    const c = presentationContract()
    for (const r of FIGURE_RULES) expect(c).toContain(r)
    for (const r of TABLE_RULES) expect(c).toContain(r)
    for (const k of CLAIM_KINDS) expect(c).toContain(k.rule)
    for (const f of ANSWER_FORMS) expect(c).toContain(f.form)
  })
})

describe('the client honours what the contract asks for', () => {
  it('turns the ticker spelling the contract names into a link', () => {
    /*
     * The silent failure. `preprocessTickers` is what makes a ticker
     * pressable, and it matches a leading `$`. A contract asking for anything
     * else would produce prose that reads correctly and navigates nowhere.
     */
    const out = preprocessTickers(`Our view on ${TICKER_FORM} has not changed.`)
    expect(out).toContain('[$AAPL](#ticker:AAPL)')

    /* And the form the contract does NOT ask for stays inert, which is why
       asking for the right one is load-bearing rather than cosmetic. */
    expect(preprocessTickers('Our view on AAPL has not changed.')).not.toContain('#ticker:')
  })

  it('colours a signed change and leaves an unsigned level alone', () => {
    /* The contract's figure rule, as the renderer applies it. `+4.2%` is a
       change; `4.2%` is a level, and colouring a level green asserts a
       direction nobody stated. */
    expect(readFigure('+4.2%')?.signed).toBe(true)
    expect(readFigure('4.2%')?.signed).toBe(false)
    expect(figureTone('+4.2%')).toBe('up')
    expect(figureTone('4.2%')).toBeNull()

    expect(readFigure('-180bps')?.negative).toBe(true)
    expect(figureTone('-180bps')).toBe('down')
    /* And the accountant's negative, which a record may well be written in. */
    expect(figureTone('(1,234)')).toBe('down')
  })

  it('reads every unit the contract tells the model to keep', () => {
    /* "Keep the unit you were given" is only safe if the client recognises
       each one. A unit it cannot read falls out of alignment. */
    expect(readFigure('4.2%')?.unit).toBe('percent')
    expect(readFigure('18.5x')?.unit).toBe('multiple')
    expect(readFigure('180bps')?.unit).toBe('basis_points')
    expect(readFigure('$1,234')?.unit).toBe('money')
    expect(readFigure('12.4bn')?.unit).toBe('scaled')
  })

  it('aligns a column of figures, which is the only thing a table adds', () => {
    /* The contract tells the model to keep figures in their own columns. This
       is what that buys: the column right-aligns so a reader can compare down
       it. A column of sentences does not, which is the other half of the rule. */
    const rows = [
      ['$AAPL', '4.2%', 'raise the target'],
      ['$MSFT', '3.1%', 'hold'],
      ['$NVDA', '-1.8%', 'trim into strength'],
    ]
    const numeric = numericColumns(rows)
    expect(numeric.has(1)).toBe(true)
    expect(numeric.has(0)).toBe(false)
    expect(numeric.has(2)).toBe(false)
  })

  it('does not mistake a date or a label for a figure', () => {
    /* Because a column of dates right-aligned in tabular figures is wrong,
       and because this is where a looser pattern would quietly go astray. */
    expect(readFigure('2026-11-10')).toBeNull()
    expect(readFigure('Q3 2026 revenue')).toBeNull()
    expect(readFigure('4.2% to 5.1%')).toBeNull()
  })

  it('renders the gap blockquote as something visibly apart from the prose', () => {
    /*
     * The contract puts what could not be found in a blockquote, because that
     * is a form markdown already has and the renderer already sets apart. If
     * the renderer stopped styling blockquotes, the three kinds of claim
     * would flatten back into one voice, which is the whole point of the
     * distinction.
     */
    const prose = readFileSync(
      resolve(process.cwd(), 'src/components/ai/AiProse.tsx'), 'utf8',
    )
    expect(prose).toMatch(/prose-blockquote:border-l-2/)
    expect(prose).toMatch(/prose-blockquote:text-gray-600/)
  })
})

describe('what the contract refuses to be', () => {
  it('states outright that it is not a template', () => {
    /*
     * The brief's own constraint, and a real failure mode: a fixed skeleton
     * applied to a one-line question produces an answer whose shape carries
     * no information, which is worse than no structure.
     */
    const c = presentationContract()
    expect(c).toMatch(/not a template/i)
    expect(c).toMatch(/Do not apply a fixed skeleton/)
  })

  it('offers plain prose first, and headings only on a multi-subject answer', () => {
    expect(ANSWER_FORMS[0].form).toBe('plain prose')
    const headings = ANSWER_FORMS.find(f => f.form === 'headings')
    expect(headings?.when).toMatch(/never on a single-subject answer/)
  })

  it('asks for the missing-information line only when something is missing', () => {
    const gap = CLAIM_KINDS.find(k => k.kind === 'gap')
    expect(gap?.rule).toMatch(/never include it when there is nothing missing/i)
  })

  it('forbids a number no record supports', () => {
    expect(FIGURE_RULES.some(r => /not in a record/.test(r))).toBe(true)
  })
})
