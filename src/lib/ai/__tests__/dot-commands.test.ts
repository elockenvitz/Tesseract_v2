/**
 * Dot commands in chat: what works, what does not, and the drift guard.
 *
 * The classification in `dot-commands.ts` mirrors a registry it cannot
 * import -- the editor extension pulls in TipTap, ProseMirror, tippy and a
 * React DOM root. So the first describe below reads that file's SOURCE and
 * fails if the two have drifted, which is the same arrangement as
 * `prompt-drift` and the edge function.
 *
 * That guard is the reason the rest of this suite means anything. Without
 * it, a command added to the editor would appear in chat's menu as
 * "unknown", or worse be silently absent, and every assertion here would
 * still pass.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseDotCommand, expandDotCommand, dotSuggestions, chatCommand, helpText,
  DOT_CHAT_COMMANDS, DOT_UNAVAILABLE, DOT_UNAVAILABLE_TEXT,
} from '../dot-commands'

const REGISTRY_SOURCE = readFileSync(
  resolve(
    process.cwd(),
    'src/components/rich-text-editor/extensions/DotCommandSuggestionExtension.ts',
  ),
  'utf8',
)

/** Every static id the editor defines, read off its own array. */
function registryIds(): string[] {
  const ids = [...REGISTRY_SOURCE.matchAll(/^\s*\{ id: '([^']+)',/gm)].map(m => m[1])
  expect(ids.length, 'no command ids found in the editor extension').toBeGreaterThan(20)
  return ids
}

describe('the chat classification covers the editor registry exactly', () => {
  it('classifies every command the editor defines', () => {
    const classified = new Set([
      ...DOT_CHAT_COMMANDS.map(c => c.id),
      ...Object.keys(DOT_UNAVAILABLE),
    ])
    const missing = registryIds().filter(id => !classified.has(id))
    expect(missing, 'editor commands with no chat classification').toEqual([])
  })

  it('invents no command the editor does not have', () => {
    /* The other direction. A chat-only id would be a command the reader
       cannot find anywhere else in the product. */
    const known = new Set(registryIds())
    const invented = [
      ...DOT_CHAT_COMMANDS.map(c => c.id),
      ...Object.keys(DOT_UNAVAILABLE),
    ].filter(id => !known.has(id))
    expect(invented).toEqual([])
  })

  it('puts each id on one side only', () => {
    const overlap = DOT_CHAT_COMMANDS.map(c => c.id).filter(id => id in DOT_UNAVAILABLE)
    expect(overlap).toEqual([])
  })

  it('gives every declined command a reason a reader can read', () => {
    for (const [id, reason] of Object.entries(DOT_UNAVAILABLE)) {
      expect(DOT_UNAVAILABLE_TEXT[reason], id).toBeTruthy()
    }
  })
})

describe('what is honoured in chat', () => {
  it('turns a price command into the question it means', () => {
    const parsed = parseDotCommand('.price.AAPL')!
    expect(parsed.id).toBe('price')
    expect(parsed.symbol).toBe('AAPL')
    expect(expandDotCommand(parsed)).toEqual({
      kind: 'text',
      text: 'What is the current price of AAPL?',
    })
  })

  it('states no figure of its own', () => {
    /*
     * The provenance rule. Every data command expands into a QUESTION, so
     * the number the reader sees came from the model's own lookup with a
     * source attached. A figure produced here would have no provenance path.
     */
    for (const command of DOT_CHAT_COMMANDS) {
      if (!command.takesSymbol) continue
      const expansion = expandDotCommand(
        parseDotCommand(`.${command.id}.LRCX`)!,
      )
      expect(expansion.kind).toBe('text')
      const text = (expansion as { text: string }).text
      expect(text).toMatch(/\?$/)
      expect(text).not.toMatch(/\d/)
    }
  })

  it('accepts a space as well as the editors dot', () => {
    /* `.price AAPL` is what someone who never used the editor will type. */
    expect(parseDotCommand('.price AAPL')).toEqual({
      id: 'price', symbol: 'AAPL', partial: false,
    })
  })

  it('asks for the symbol rather than guessing one', () => {
    const expansion = expandDotCommand(parseDotCommand('.price')!)
    expect(expansion.kind).toBe('needs-symbol')
    expect((expansion as { command: { id: string } }).command.id).toBe('price')
  })

  it('refuses a symbol that is a sentence', () => {
    /* "the price of apple please" is not a ticker. Left for the reader to
       fix rather than truncated into something that looks like one. */
    expect(parseDotCommand('.price the price of apple please')?.symbol).toBeNull()
  })

  it('expands a template into its own body', () => {
    const expansion = expandDotCommand(
      { id: 'template.bear', symbol: null, partial: false },
      { templateBody: s => (s === 'bear' ? 'Bear case:\n- ' : null) },
    )
    expect(expansion).toEqual({ kind: 'text', text: 'Bear case:\n- ' })
  })

  it('does not pretend to know a template that is not the readers', () => {
    expect(
      expandDotCommand(
        { id: 'template.nope', symbol: null, partial: false },
        { templateBody: () => null },
      ).kind,
    ).toBe('unknown')
  })

  it('answers .help with what works here, not the editors full set', () => {
    const text = helpText()
    expect(text).toContain('.price')
    /* The ones that do not work must not be advertised. */
    expect(text).not.toContain('.chart')
    expect(text).not.toContain('.screenshot')
  })
})

describe('what is declined, and said so', () => {
  it('declines the chart commands rather than drawing something else', () => {
    /*
     * The named trap: claiming an editor-only command works in chat. A chart
     * needs a ProseMirror node, and chat has no chart renderer, so this is
     * the honest answer rather than a degraded one.
     */
    for (const id of ['chart', 'chart.price', 'chart.technicals']) {
      const expansion = expandDotCommand(parseDotCommand(`.${id}.AAPL`)!)
      expect(expansion).toEqual({ kind: 'unavailable', id, reason: 'editor-only' })
    }
  })

  it('reads a long id as the long id, not as its prefix', () => {
    /* `.chart.price.AAPL` is `chart.price` + AAPL, never `chart` + a symbol
       called "price.AAPL". The editors own symbol detection sorts the same
       way, for the same reason. */
    expect(parseDotCommand('.chart.price.AAPL')).toEqual({
      id: 'chart.price', symbol: 'AAPL', partial: false,
    })
  })

  it('declines the AI commands as redundant, not broken', () => {
    expect(expandDotCommand(parseDotCommand('.ai')!)).toEqual({
      kind: 'unavailable', id: 'ai', reason: 'already-here',
    })
  })

  it('declines the visibility commands as inapplicable', () => {
    expect(expandDotCommand(parseDotCommand('.private')!).kind).toBe('unavailable')
    expect(DOT_UNAVAILABLE.private).toBe('not-applicable')
  })
})

describe('reading a command off the composer', () => {
  it('ignores a dot that is not at the front', () => {
    expect(parseDotCommand('What is the .price command?')).toBeNull()
    expect(parseDotCommand('Compare AAPL and MSFT')).toBeNull()
  })

  it('reads one behind leading whitespace', () => {
    expect(parseDotCommand('  .pe MSFT')?.id).toBe('pe')
  })

  it('reports a bare dot as a command still being typed', () => {
    expect(parseDotCommand('.')).toEqual({ id: '', symbol: null, partial: true })
  })

  it('reports an unknown command as unknown, not as nothing', () => {
    /* The menu needs to say "no such command" rather than silently treating
       it as prose the reader is about to send. */
    const parsed = parseDotCommand('.nonsense')!
    expect(parsed.id).toBe('nonsense')
    expect(expandDotCommand(parsed).kind).toBe('unknown')
  })

  it('is case-insensitive about the command and the symbol', () => {
    expect(parseDotCommand('.PRICE aapl')).toEqual({
      id: 'price', symbol: 'AAPL', partial: false,
    })
  })

  it('offers everything for a bare dot and narrows as it is typed', () => {
    expect(dotSuggestions('.')).toHaveLength(DOT_CHAT_COMMANDS.length)
    expect(dotSuggestions('.pr').map(c => c.id)).toEqual(['price'])
    expect(dotSuggestions('.zzz')).toEqual([])
  })

  it('offers no command it would then decline', () => {
    const offered = new Set(dotSuggestions('.').map(c => c.id))
    for (const id of Object.keys(DOT_UNAVAILABLE)) {
      expect(offered.has(id), id).toBe(false)
    }
  })

  it('knows its own commands by id', () => {
    expect(chatCommand('price')?.label).toBe('.price')
    expect(chatCommand('chart')).toBeUndefined()
  })
})
