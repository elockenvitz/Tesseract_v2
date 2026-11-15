/**
 * The render-time repairs, against the answers that motivated them.
 *
 * Every fixture marked LIVE below is a real string from an assistant message
 * stored in production on 11 or 13 November 2026 -- the whole corpus was ten
 * answers, and the counts are in `prose-repair.ts`. A test written from
 * invented prose would have passed against the first draft of each of these
 * rules; these did not.
 *
 * The valuable half of this suite is the exclusions. A repair that fires too
 * widely is worse than the defect: it corrupts a ticker, a URL or a query the
 * reader asked for, and it does so in a message nobody re-reads.
 */

import { describe, it, expect } from 'vitest'
import {
  repairAnswerProse, promoteBoldHeadings, separateRunOnSentences,
  humaniseInternalNames, internalWord,
} from '../prose-repair'

describe('a standalone bold line becomes a heading', () => {
  /* Two bold lines are a section system; one is emphasis. See the next
     describe. These fixtures pair the label under test with a second one. */
  const withSecond = (label: string) => `**${label}**\nBody.\n\n**Other**\nBody.`

  it('promotes the labels the live answers actually used', () => {
    /* LIVE: three of ten answers wrote their sections this way, and none of
       the ten used a real heading. */
    for (const label of ['Bull case', 'Bear case', 'Price Target Outcomes', 'PM Ruling']) {
      expect(promoteBoldHeadings(withSecond(label))).toContain(`### ${label}`)
    }
  })

  it('drops the colon a label was punctuated with', () => {
    /* LIVE: `**Decisions:**` and `**Work remaining:**`, with the colon
       INSIDE the asterisks, which the first draft of this left on screen. */
    const out = promoteBoldHeadings('**Decisions:**\nBody.\n\n**Work remaining:**\nBody.')
    expect(out).toContain('### Decisions\n')
    expect(out).toContain('### Work remaining\n')
    expect(out).not.toContain('Decisions:')
  })

  it('promotes every label in the answer, not just the first', () => {
    const out = promoteBoldHeadings('**Bull case**\nUp.\n\n**Bear case**\nDown.')
    expect(out).toBe('### Bull case\nUp.\n\n### Bear case\nDown.')
  })

  it('leaves a bolded SENTENCE alone', () => {
    /*
     * LIVE, and the case that decides whether this rule is a repair or a
     * rewrite. Turning a claim into a heading would restructure the argument,
     * so emphasis stays emphasis.
     */
    const claim = '**Decisions are fragmented and the process backlog is substantial.**'
    expect(promoteBoldHeadings(claim)).toBe(claim)
  })

  it('leaves a long bold line alone', () => {
    const long = `**${'x'.repeat(61)}**\nBody.\n\n**Other**\nBody.`
    expect(promoteBoldHeadings(long)).toContain(`**${'x'.repeat(61)}**`)
  })

  it('leaves a LONE bold line alone, because one is emphasis', () => {
    /*
     * THE discriminating case. A single bold line is usually the answer's
     * own lead judgment -- "**Still a buy on a 12-month view**" -- and
     * rendering that as a small-caps section label buries the one sentence
     * the reader opened the answer for.
     *
     * Measured: each of the three live answers that faked headings used two
     * to four of them, so two is where structure begins.
     */
    const lead = '**Still a buy on a 12-month view**\n\nWafer spending recovers into 2027.'
    expect(promoteBoldHeadings(lead)).toBe(lead)
  })

  it('leaves a list items own label alone', () => {
    /* `- **Risk**: ...` is a labelled item and its label already works. */
    expect(promoteBoldHeadings('- **Risk**: multiple compression')).toBe('- **Risk**: multiple compression')
    expect(promoteBoldHeadings('  **Nested**')).toBe('  **Nested**')
  })

  it('leaves bold inside a sentence alone', () => {
    const line = 'The **bear case** rests on WFE spending.'
    expect(promoteBoldHeadings(line)).toBe(line)
  })

  it('does not touch anything inside a code fence', () => {
    /* The fenced line is also not COUNTED: two labels outside the fence are
       what makes this a section system, and the one inside is code. */
    const content = '```\n**Bear case**\n```\n**Bull case**\nUp.\n\n**Risks**\nDown.'
    const out = promoteBoldHeadings(content)
    expect(out).toContain('```\n**Bear case**\n```')
    expect(out).toContain('### Bull case')
    expect(out).toContain('### Risks')
  })
})

describe('two sentences run together get the space back', () => {
  it('repairs the live run-on', () => {
    /* LIVE: `.The` appeared in two of ten answers. */
    expect(separateRunOnSentences('This is the trough.The next leg is capex.'))
      .toBe('This is the trough. The next leg is capex.')
  })

  it('repairs a question and an exclamation the same way', () => {
    expect(separateRunOnSentences('Is it cheap?Probably not.')).toBe('Is it cheap? Probably not.')
    expect(separateRunOnSentences('Look at this!Margins fell.')).toBe('Look at this! Margins fell.')
  })

  it('leaves a ticker class suffix alone', () => {
    /* THE exclusion. `BRK.B` is a symbol, and a space in it is a dead link
       and a wrong instrument. */
    expect(separateRunOnSentences('We hold $BRK.B and $AAPL.')).toBe('We hold $BRK.B and $AAPL.')
    expect(separateRunOnSentences('BRK.Baby')).toBe('BRK.Baby')
  })

  it('leaves an initialism alone', () => {
    expect(separateRunOnSentences('Revenue in the U.S.Asia split')).toBe('Revenue in the U.S.Asia split')
  })

  it('leaves a decimal alone', () => {
    expect(separateRunOnSentences('It trades at 18.5x and 3.2x.')).toBe('It trades at 18.5x and 3.2x.')
  })

  it('leaves a URL alone', () => {
    const line = 'See https://example.com/a.Bc for the filing.'
    expect(separateRunOnSentences(line)).toBe(line)
  })

  it('leaves inline code alone', () => {
    /* `a.Name` in backticks is an expression, not two sentences. */
    expect(separateRunOnSentences('Use `row.Name` here.')).toBe('Use `row.Name` here.')
  })

  it('leaves a markdown links target alone', () => {
    const line = '[the note](#note:a.Bc) says so.'
    expect(separateRunOnSentences(line)).toBe(line)
  })

  it('fixes an abbreviation followed by a sentence, which is the right call', () => {
    expect(separateRunOnSentences('e.g.The margin fell.')).toBe('e.g. The margin fell.')
  })
})

describe('a database name becomes the word the product uses', () => {
  it('translates what the live answer leaked', () => {
    /* LIVE: a table header column and a parenthetical, both backticked. */
    expect(humaniseInternalNames('| `queue_status` |')).toBe('| decision status |')
    expect(humaniseInternalNames('`outcome_note` (from `lifecycle_outcome: executed`)'))
      .toBe('outcome note (from execution outcome: executed)')
  })

  it('reads record names from the same map the evidence section renders', () => {
    /* One vocabulary. Prose calling it a "Decision" while the source beneath
       says "PM ruling" is the drift this layer exists to stop. */
    expect(internalWord('decision_request')).toBe('pm ruling')
    expect(internalWord('accepted_trade')).toBe('committed trade')
    expect(internalWord('checklist_item')).toBe('requirement')
  })

  it('leaves an identifier it does not know EXACTLY as written', () => {
    /*
     * THE case. A guessed product word is worse than a visible column name,
     * because the reader cannot tell it was guessed. `ebitda_margin_ttm`
     * reads as "ebitda margin ttm" to a naive rule, which is not what
     * anything calls it.
     */
    expect(humaniseInternalNames('the `ebitda_margin_ttm` column')).toBe('the `ebitda_margin_ttm` column')
    expect(internalWord('ebitda_margin_ttm')).toBeNull()
  })

  it('leaves a code fence alone, because that is where a name belongs', () => {
    const content = '```sql\nselect queue_status from decision_requests\n```'
    expect(humaniseInternalNames(content)).toBe(content)
  })

  it('does not rewrite an unbackticked word in a sentence', () => {
    /* Without the backticks there is no signal, and rewriting arbitrary
       words in prose is a paraphrase rather than a repair. */
    const line = 'The queue_status field is on the request.'
    expect(humaniseInternalNames(line)).toBe(line)
  })

  it('leaves ordinary inline code alone', () => {
    expect(humaniseInternalNames('press `Enter` to send')).toBe('press `Enter` to send')
    expect(humaniseInternalNames('`npm run build`')).toBe('`npm run build`')
  })
})

describe('all together, on the live answer', () => {
  /* LIVE, reassembled from the stored strings. */
  const answer = [
    '**Decisions:**',
    'Three rulings are open.The oldest is from 4 Nov.',
    '',
    '| Portfolio | Action | `queue_status` |',
    '|---|---|---|',
    '| Large Cap Growth | Buy | `deciding` |',
    '',
    '**Bull case**',
    'Capex recovers into 2027.',
  ].join('\n')

  it('produces a heading, a space and a product word', () => {
    const out = repairAnswerProse(answer)
    expect(out).toContain('### Decisions')
    expect(out).toContain('### Bull case')
    expect(out).toContain('rulings are open. The oldest')
    expect(out).toContain('| decision status |')
  })

  it('leaves the table structure and the data intact', () => {
    const out = repairAnswerProse(answer)
    expect(out).toContain('|---|---|---|')
    expect(out).toContain('| Large Cap Growth | Buy |')
    /* `deciding` is a value, not a field name, and is not in the map, so it
       stays verbatim rather than being guessed at. */
    expect(out).toContain('`deciding`')
  })

  it('changes nothing in an answer that was already right', () => {
    /*
     * The idempotence case. A repair that keeps editing correct prose is a
     * repair that will eventually damage some, and this runs on every
     * render.
     */
    const good = [
      '### Bear case',
      '',
      'Wafer spending is the risk. My read is that it holds.',
      '',
      '- **Risk**: multiple compression',
    ].join('\n')
    expect(repairAnswerProse(good)).toBe(good)
    expect(repairAnswerProse(repairAnswerProse(answer))).toBe(repairAnswerProse(answer))
  })

  it('survives nothing at all', () => {
    expect(repairAnswerProse('')).toBe('')
    expect(repairAnswerProse(null as unknown as string)).toBe('')
    expect(repairAnswerProse(undefined as unknown as string)).toBe('')
  })
})
