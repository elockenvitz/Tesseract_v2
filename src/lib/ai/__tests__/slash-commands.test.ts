/**
 * Slash Commands in chat: what works, what does not, what must never fire,
 * and the drift guard.
 *
 * The classification in `slash-commands.ts` mirrors a registry it cannot
 * import -- the editor extension pulls in TipTap, ProseMirror, tippy and a
 * React DOM root. So the first describe below reads that file's SOURCE and
 * fails if the two have drifted, which is the same arrangement as
 * `prompt-drift` and the edge function.
 *
 * That guard is the reason the rest of this suite means anything. Without
 * it, a command added to the editor would appear in chat's menu as
 * "unknown", or worse be silently absent, and every assertion here would
 * still pass.
 *
 * ── The trigger moved from `.` to `/` ────────────────────────────────────
 *
 * `describe('what must never trigger')` is the load-bearing part of that
 * change. A dot is punctuation; a slash is division, a date separator, a
 * ratio and a URL path. The parser's rules are narrow on purpose and each
 * one of those five has a case here.
 *
 * `describe('the dot no longer triggers')` is the other half: the old
 * trigger must be gone, not kept as a quiet second way in.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  parseSlashCommand, expandSlashCommand, slashSuggestions, chatCommand, helpText,
  SLASH, SLASH_CHAT_COMMANDS, SLASH_UNAVAILABLE, SLASH_UNAVAILABLE_TEXT,
} from '../slash-commands'
import { isRetrievableData, SLASH_DATA_BLOCKER } from '../slash-market-data'

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
      ...SLASH_CHAT_COMMANDS.map(c => c.id),
      ...Object.keys(SLASH_UNAVAILABLE),
    ])
    const missing = registryIds().filter(id => !classified.has(id))
    expect(missing, 'editor commands with no chat classification').toEqual([])
  })

  it('invents no command the editor does not have', () => {
    /* The other direction. A chat-only id would be a command the reader
       cannot find anywhere else in the product. */
    const known = new Set(registryIds())
    const invented = [
      ...SLASH_CHAT_COMMANDS.map(c => c.id),
      ...Object.keys(SLASH_UNAVAILABLE),
    ].filter(id => !known.has(id))
    expect(invented).toEqual([])
  })

  it('puts each id on one side only', () => {
    const overlap = SLASH_CHAT_COMMANDS.map(c => c.id).filter(id => id in SLASH_UNAVAILABLE)
    expect(overlap).toEqual([])
  })

  it('gives every declined command a reason a reader can read', () => {
    for (const [id, reason] of Object.entries(SLASH_UNAVAILABLE)) {
      expect(SLASH_UNAVAILABLE_TEXT[reason], id).toBeTruthy()
    }
  })
})

describe('the editor and chat advertise the same trigger', () => {
  /*
   * The failure this prevents: the editor's display names were a separate
   * list from its parser, so the menu could have offered `.price` while the
   * parser listened for `/price`. Both now derive from `SLASH`, and these
   * read the source to prove it.
   */
  it('shows no command name starting with the old trigger', () => {
    const names = [...REGISTRY_SOURCE.matchAll(/name: [`']([^`']+)[`']/g)].map(m => m[1])
    const dotted = names.filter(n => n.startsWith('.'))
    expect(dotted, 'editor command names still advertising the dot').toEqual([])
  })

  it('builds its names from the shared trigger rather than a literal', () => {
    /* A literal '/' in 31 places is a literal '.' in 31 places waiting to
       happen again. */
    expect(REGISTRY_SOURCE).toMatch(/import \{ SLASH \} from '\.\.\/\.\.\/\.\.\/lib\/ai\/slash-commands'/)
    expect(REGISTRY_SOURCE).toMatch(/name: `\$\{SLASH\}price`/)
  })

  it('anchors its parser on the shared trigger', () => {
    expect(REGISTRY_SOURCE).toMatch(/const T = `\\\\\$\{SLASH\}`/)
    /* And the caret detection. A letter is required right after it. */
    expect(REGISTRY_SOURCE).toMatch(/textBefore\.match\(\/\\\/\(\[a-zA-Z\]/)
  })

  it('still requires the slash to start a word in the editor too', () => {
    /* Without this the `/path` in every URL opens the command menu. */
    expect(REGISTRY_SOURCE).toMatch(/triggerIndex > 0 && !\/\\s\/\.test\(textBefore\[triggerIndex - 1\]\)/)
  })

  it('agrees with chat about every chat command label', () => {
    for (const c of SLASH_CHAT_COMMANDS) {
      expect(c.label).toBe(`${SLASH}${c.id}`)
      expect(REGISTRY_SOURCE, `editor missing ${c.id}`)
        .toContain(`{ id: '${c.id}', name: \`\${SLASH}`)
    }
  })
})

describe('what must never trigger', () => {
  /*
   * Each of these is a thing a buy-side analyst writes every day. A trigger
   * that fires on them is worse than no trigger: the menu appears over the
   * text they are mid-sentence on.
   *
   * The rule that does the work is in `parseSlashCommand`: a LETTER must
   * follow the slash, and the slash must lead the message.
   */
  const prose = [
    ['a date', '2026/11/13'],
    ['a date fragment', '/2026'],
    ['a quarter', '3/26 guide'],
    ['division', '10/2'],
    ['division with spaces', '/ 50'],
    ['a ratio', 'P/E of 28x'],
    ['a named ratio', 'debt/equity is 0.4'],
    ['a URL', 'https://example.com/price'],
    ['a protocol-relative URL', '//cdn.example.com/x'],
    ['a path', 'see src/lib/ai/price'],
    ['an either-or', 'bull / bear'],
    ['a fraction', '1/2 of the position'],
  ] as const

  for (const [what, text] of prose) {
    it(`does not read a command out of ${what}`, () => {
      expect(parseSlashCommand(text), text).toBeNull()
    })
  }

  it('does read the command when the slash leads and a letter follows', () => {
    /* The control case. Without it the rules above could be satisfied by a
       parser that never matches anything. */
    expect(parseSlashCommand('/pe.AAPL')?.id).toBe('pe')
    expect(parseSlashCommand('/price MSFT')?.id).toBe('price')
  })

  it('still lets the reader ask about a ratio', () => {
    /* `P/E` is prose and `/pe` is a command, and the difference is only
       where the slash sits. Both have to work. */
    expect(parseSlashCommand('What is the P/E of AAPL?')).toBeNull()
    expect(parseSlashCommand('/pe AAPL')?.id).toBe('pe')
  })
})

describe('the dot no longer triggers', () => {
  /*
   * Not kept as a compatibility trigger. Two triggers for one registry is
   * two parsers to keep in step and a reader who learns the wrong one.
   */
  it('reads nothing from a leading dot', () => {
    for (const text of ['.price.AAPL', '.help', '.chart.price.AAPL', '.']) {
      expect(parseSlashCommand(text), text).toBeNull()
    }
  })

  it('treats dotted prose as prose, which it always was', () => {
    expect(parseSlashCommand('...thinking')).toBeNull()
    expect(parseSlashCommand('BRK.B is the one')).toBeNull()
  })

  it('exports no dot-era name', async () => {
    /* A leftover alias is how a deleted trigger comes back. */
    const mod = await import('../slash-commands')
    const dotNames = Object.keys(mod).filter(k => /^(DOT_|parseDot|expandDot|dotSug)/.test(k))
    expect(dotNames).toEqual([])
  })
})

describe('what is honoured in chat', () => {
  it('turns a price command into a read, not a question', () => {
    /*
     * This is the 2.3 correction. `/price.AAPL` used to produce "What is the
     * current price of AAPL?" for the reader to send -- a deterministic
     * command turned into a model request, answerable hedged, rounded, or
     * about a different day. It now names a read for the caller to perform.
     */
    const parsed = parseSlashCommand('/price.AAPL')!
    expect(parsed.id).toBe('price')
    expect(parsed.symbol).toBe('AAPL')
    expect(expandSlashCommand(parsed)).toEqual({
      kind: 'reading', id: 'price', symbol: 'AAPL',
    })
  })

  it('never turns a retrievable figure into a model question', () => {
    /*
     * The regression guard, stated as the defect. A `text` expansion is
     * composer text the reader sends, so any retrievable data command
     * producing one has reintroduced exactly what was removed -- including
     * by way of a "helpful" fallback when the cache looks empty.
     */
    for (const command of SLASH_CHAT_COMMANDS) {
      if (!command.takesSymbol || !isRetrievableData(command.id)) continue
      const expansion = expandSlashCommand(
        parseSlashCommand(`/${command.id}.LRCX`)!,
      )
      expect(expansion.kind).toBe('reading')
      expect(JSON.stringify(expansion)).not.toMatch(/\?/)
    }
  })

  it('composes no number itself, in any state', () => {
    /*
     * Provenance. The figure arrives from `price_history_cache` wrapped in
     * `Observed`; nothing in this pure module may put a digit in front of a
     * reader, because a number originating here would have no source and no
     * as-of date.
     */
    for (const command of SLASH_CHAT_COMMANDS) {
      if (!command.takesSymbol) continue
      const expansion = expandSlashCommand(
        parseSlashCommand(`/${command.id}.LRCX`)!,
      )
      expect(JSON.stringify(expansion)).not.toMatch(/\d/)
    }
  })

  it('names the missing input for a figure the store does not hold', () => {
    /* Not "unavailable". The exact input, so the gap is reportable. */
    const expansion = expandSlashCommand(parseSlashCommand('/pe.AAPL')!)
    expect(expansion.kind).toBe('data-blocked')
    const blocked = expansion as { blocker: string; fallback: string }
    expect(blocked.blocker).toMatch(/earnings/i)
    /* The model lookup is still offered -- as a separate, labelled choice. */
    expect(blocked.fallback).toMatch(/AAPL/)
    expect(blocked.fallback).toMatch(/source/i)
  })

  it('splits the six data commands by what the cache actually holds', () => {
    /* Three retrievable, three not. A change to this split is a change to
       what the store contains, so it should fail here first. */
    const retrievable = SLASH_CHAT_COMMANDS
      .filter(c => c.takesSymbol && isRetrievableData(c.id))
      .map(c => c.id)
    expect(retrievable.sort()).toEqual(['change', 'price', 'volume'])
    for (const id of ['marketcap', 'pe', 'dividend']) {
      expect(SLASH_DATA_BLOCKER[id]).toBeTruthy()
    }
  })

  it('answers /help from the registry instead of asking the model', () => {
    /*
     * `/help` used to expand into "Which Tesseract commands work in this
     * chat?" and the reader sent it: a model call to answer a question only
     * the registry can answer, and the model cannot actually know.
     */
    const expansion = expandSlashCommand(parseSlashCommand('/help')!)
    expect(expansion.kind).toBe('help')
    const text = (expansion as { text: string }).text
    expect(text).not.toMatch(/\?/)
    expect(text).toMatch(/\/price/)
  })

  it('accepts a space as well as the editors dot separator', () => {
    /* `/price AAPL` is what someone who never used the editor will type;
       `/price.AAPL` is what the editor taught. Both. */
    expect(parseSlashCommand('/price AAPL')).toEqual({
      id: 'price', symbol: 'AAPL', partial: false,
    })
  })

  it('asks for the symbol rather than guessing one', () => {
    const expansion = expandSlashCommand(parseSlashCommand('/price')!)
    expect(expansion.kind).toBe('needs-symbol')
    expect((expansion as { command: { id: string } }).command.id).toBe('price')
  })

  it('refuses a symbol that is a sentence', () => {
    /* "the price of apple please" is not a ticker. Left for the reader to
       fix rather than truncated into something that looks like one. */
    expect(parseSlashCommand('/price the price of apple please')?.symbol).toBeNull()
  })

  it('expands a template into its own body', () => {
    const expansion = expandSlashCommand(
      { id: 'template.bear', symbol: null, partial: false },
      { templateBody: s => (s === 'bear' ? 'Bear case:\n- ' : null) },
    )
    expect(expansion).toEqual({ kind: 'text', text: 'Bear case:\n- ' })
  })

  it('inserts the stored template, not a request to describe one', () => {
    /* Named in the brief. A template is TEXT, and selecting it must put that
       text in the box -- not ask the model what the template says. */
    const body = '## Bear case\n\n- Volume risk\n- Multiple'
    const expansion = expandSlashCommand(
      { id: 'template.bear', symbol: null, partial: false },
      { templateBody: () => body },
    )
    expect((expansion as { text: string }).text).toBe(body)
    expect((expansion as { text: string }).text).not.toMatch(/\?$/)
  })

  it('does not pretend to know a template that is not the readers', () => {
    expect(
      expandSlashCommand(
        { id: 'template.nope', symbol: null, partial: false },
        { templateBody: () => null },
      ).kind,
    ).toBe('unknown')
  })

  it('answers /help with what works here, not the editors full set', () => {
    const text = helpText()
    expect(text).toContain('/price')
    /* The ones that do not work must not be advertised. */
    expect(text).not.toContain('/chart')
    expect(text).not.toContain('/screenshot')
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
      const expansion = expandSlashCommand(parseSlashCommand(`/${id}.AAPL`)!)
      expect(expansion).toEqual({ kind: 'unavailable', id, reason: 'needs-canvas' })
    }
  })

  it('gives the chart commands their own reason, not a category', () => {
    /*
     * 2.3 asks for the EXACT incompatibility. "Works in the editor" is a
     * location, and it left a reader unable to tell whether a chart was
     * coming to chat later. The reason now says what is actually missing --
     * a live document to insert a node into -- and points at the surface
     * that reads the same stored closes.
     */
    const every = new Set(Object.values(SLASH_UNAVAILABLE))
    expect(every.has('needs-canvas')).toBe(true)
    for (const [id, reason] of Object.entries(SLASH_UNAVAILABLE)) {
      expect(id.startsWith('chart') ? reason : 'x', id)
        .toBe(id.startsWith('chart') ? 'needs-canvas' : 'x')
    }
    const text = SLASH_UNAVAILABLE_TEXT['needs-canvas']
    expect(text).toMatch(/chat message is text/i)
    expect(text).toMatch(/asset page/i)
    /* And it must not promise one. */
    expect(text).not.toMatch(/soon|coming|will be/i)
  })

  it('reads a long id as the long id, not as its prefix', () => {
    /* `/chart.price.AAPL` is `chart.price` + AAPL, never `chart` + a symbol
       called "price.AAPL". The editors own symbol detection sorts the same
       way, for the same reason. */
    expect(parseSlashCommand('/chart.price.AAPL')).toEqual({
      id: 'chart.price', symbol: 'AAPL', partial: false,
    })
  })

  it('declines the AI commands as redundant, not broken', () => {
    expect(expandSlashCommand(parseSlashCommand('/ai')!)).toEqual({
      kind: 'unavailable', id: 'ai', reason: 'already-here',
    })
  })

  it('declines the visibility commands as inapplicable', () => {
    expect(expandSlashCommand(parseSlashCommand('/private')!).kind).toBe('unavailable')
    expect(SLASH_UNAVAILABLE.private).toBe('not-applicable')
  })
})

describe('reading a command off the composer', () => {
  it('ignores a slash that is not at the front', () => {
    expect(parseSlashCommand('What is the /price command?')).toBeNull()
    expect(parseSlashCommand('Compare AAPL and MSFT')).toBeNull()
  })

  it('reads one behind leading whitespace', () => {
    expect(parseSlashCommand('  /pe MSFT')?.id).toBe('pe')
  })

  it('reports a bare slash as a command still being typed', () => {
    /* The bare trigger must open the menu -- that is how the feature is
       discovered at all. */
    expect(parseSlashCommand('/')).toEqual({ id: '', symbol: null, partial: true })
  })

  it('reports an unknown command as unknown, not as nothing', () => {
    /* The menu needs to say "no such command" rather than silently treating
       it as prose the reader is about to send. */
    const parsed = parseSlashCommand('/nonsense')!
    expect(parsed.id).toBe('nonsense')
    expect(expandSlashCommand(parsed).kind).toBe('unknown')
  })

  it('is case-insensitive about the command and the symbol', () => {
    expect(parseSlashCommand('/PRICE aapl')).toEqual({
      id: 'price', symbol: 'AAPL', partial: false,
    })
  })

  it('offers everything for a bare slash and narrows as it is typed', () => {
    expect(slashSuggestions('/')).toHaveLength(SLASH_CHAT_COMMANDS.length)
    expect(slashSuggestions('/pr').map(c => c.id)).toEqual(['price'])
    expect(slashSuggestions('/zzz')).toEqual([])
  })

  it('offers no command it would then decline', () => {
    const offered = new Set(slashSuggestions('/').map(c => c.id))
    for (const id of Object.keys(SLASH_UNAVAILABLE)) {
      expect(offered.has(id), id).toBe(false)
    }
  })

  it('knows its own commands by id', () => {
    expect(chatCommand('price')?.label).toBe('/price')
    expect(chatCommand('chart')).toBeUndefined()
  })

  it('tolerates a non-string', () => {
    expect(parseSlashCommand(undefined as never)).toBeNull()
    expect(parseSlashCommand(null as never)).toBeNull()
  })
})

describe('stored content is not rewritten', () => {
  /*
   * The brief's hard constraint: changing the trigger must not touch what is
   * saved. These assert the two things that would break it.
   */
  it('keeps the dot inside a command id', () => {
    /* `chart.price` is a namespace, and `/chart/price` would read as a URL
       path -- which is one of the things the trigger must not fire on. Ids
       are also what persisted nodes carry, so renaming them would be a
       storage change for a branding reason. */
    expect(Object.keys(SLASH_UNAVAILABLE)).toContain('chart.price')
    expect(REGISTRY_SOURCE).toContain("{ id: 'chart.price'")
  })

  it('leaves the highlighter blind to the old dot form rather than rewriting it', () => {
    /* Historical documents hold `.price.AAPL` as ordinary text. It stays
       ordinary text: undecorated, and untouched. A migration that rewrote
       saved research to chase a trigger change is the thing being avoided. */
    const highlighter = readFileSync(
      resolve(process.cwd(), 'src/components/rich-text-editor/extensions/DotCommandExtension.ts'),
      'utf8',
    )
    expect(highlighter).toMatch(/import \{ SLASH \}/)
    expect(highlighter).toMatch(/\\\\\$\{SLASH\}\(\$\{DATA_COMMANDS\.join\('\|'\)\}\)/)
    /* And it gained a leading word boundary, without which every URL path
       in every note would be decorated as a command. */
    expect(highlighter).toContain('(?<=^|\\\\s)')
  })
})
