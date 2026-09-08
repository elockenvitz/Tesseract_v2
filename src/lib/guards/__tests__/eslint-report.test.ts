/**
 * The mobile ratchet's blind spot.
 *
 * Reproduced by dropping one unparseable .tsx into src/components/mobile and
 * running the gate unchanged:
 *
 *     files linted: 140
 *     use-before-define violations: 0
 *     conditional-hook violations: 0
 *     PASS
 *
 * The file counted as linted, which was the ratchet's whole proof that eslint
 * had run, and it contributed no violations — because no rule can run against
 * a file that has no syntax tree. Fewer violations read as better.
 *
 * FATAL_PAYLOAD below is eslint's actual output for that file, copied from the
 * run, not written from memory.
 */
import { describe, it, expect } from 'vitest'
import {
  fatalMessages, messagesByRule, filesLinted,
  // @ts-expect-error — plain .mjs script, no type declarations by design
} from '../../../../scripts/lib/eslint-report.mjs'

/** Verbatim from `npx eslint ... -f json` over the broken fixture. */
const FATAL_PAYLOAD = [
  {
    filePath: 'C:\\dev\\repo\\src\\components\\mobile\\BrokenCard.tsx',
    messages: [
      {
        ruleId: null,
        nodeType: null,
        fatal: true,
        severity: 2,
        message: 'Parsing error: Identifier expected.',
        line: 3,
        column: 33,
      },
    ],
    errorCount: 1,
    fatalErrorCount: 1,
    warningCount: 0,
  },
]

const HEALTHY_PAYLOAD = [
  { filePath: 'a.tsx', messages: [], errorCount: 0, warningCount: 0 },
  {
    filePath: 'b.tsx',
    messages: [
      { ruleId: '@typescript-eslint/no-unused-vars', severity: 1, message: 'unused', line: 4 },
    ],
    errorCount: 0,
    warningCount: 1,
  },
]

describe('fatalMessages', () => {
  it('catches the parse error the rule selectors could not see', () => {
    const fatal = fatalMessages(FATAL_PAYLOAD)
    expect(fatal).toHaveLength(1)
    expect(fatal[0]).toContain('Parsing error')
  })

  it('catches a fatal message on a formatter that omits the fatal flag', () => {
    const noFlag = [
      { filePath: 'x.tsx', messages: [{ ruleId: null, severity: 2, message: 'Unexpected token', line: 1 }] },
    ]
    expect(fatalMessages(noFlag)).toHaveLength(1)
  })

  it('does not fire on a clean report', () => {
    expect(fatalMessages(HEALTHY_PAYLOAD)).toEqual([])
  })

  it('does not fire on ordinary rule violations', () => {
    const violations = [
      { filePath: 'y.tsx', messages: [{ ruleId: 'no-use-before-define', severity: 2, message: 'x', line: 2 }] },
    ]
    expect(fatalMessages(violations)).toEqual([])
  })

  it('tolerates a report with no messages array', () => {
    expect(fatalMessages([{ filePath: 'z.tsx' }])).toEqual([])
    expect(fatalMessages(null)).toEqual([])
  })
})

describe('the counts a fatal file distorts', () => {
  it('still counts an unparseable file as linted', () => {
    // This is why the file total could not catch it: the number went UP.
    expect(filesLinted(FATAL_PAYLOAD)).toBe(1)
  })

  it('finds no rule violations in an unparseable file', () => {
    // And this is why the violation total could not catch it either: the
    // number went DOWN, which the ratchet reads as an improvement.
    expect(messagesByRule(FATAL_PAYLOAD, (id: string) => id.endsWith('no-use-before-define'))).toEqual([])
    expect(messagesByRule(FATAL_PAYLOAD, (id: string) => id === 'react-hooks/rules-of-hooks')).toEqual([])
  })
})
