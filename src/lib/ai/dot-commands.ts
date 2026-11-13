/**
 * Tesseract's dot commands, in chat.
 *
 * ── One registry, two hosts ──────────────────────────────────────────────
 *
 * The commands are defined once, in
 * `components/rich-text-editor/extensions/DotCommandSuggestionExtension.ts`.
 * That file is not importable from here and should not become so: it pulls in
 * TipTap, ProseMirror, tippy and a React DOM root, none of which belong in
 * the chat bundle. So this module does not redefine the commands. It
 * classifies them, by id, and `dot-commands.test.ts` reads the extension's
 * source and fails if an id exists there with no classification here -- the
 * same arrangement as `prompt-drift` and the edge function, and for the same
 * reason: a mirrored list that nothing checks is a list that drifts.
 *
 * ── Most of them do not work here, and say so ────────────────────────────
 *
 * Every command in the editor ends in a callback that inserts a ProseMirror
 * node or opens an editor picker. A chat message is a string. So the honest
 * answer for `.chart.price` in a composer is not a degraded chart or a
 * promise to draw one later -- it is that this command belongs to the
 * editor, named as such, with the reason attached.
 *
 * What is left is what can be honoured with the machinery chat already has:
 *
 *   * THE DATA COMMANDS. `.price.AAPL` becomes the question it means, and
 *     the model answers it with its own `get_price` lookup, which lands in
 *     the message's evidence section with a source. The figure is retrieved,
 *     never composed: nothing here puts a number in front of the reader, and
 *     nothing asks the model to recall one.
 *   * THE TEMPLATES. A template is text. Its body goes into the composer for
 *     the reader to edit and send, which is the same act as in the editor.
 *   * `.help`. Which lists exactly this, rather than the editor's full set.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * It does not send anything. Every command resolves to TEXT IN THE COMPOSER,
 * under the reader's hands, and they press Send. A command that fired a
 * request on selection would be a slash command that spends tokens on a
 * keystroke, and the expansion would never be seen before it was sent.
 *
 * Pure. No React, no Supabase, no network.
 */

/** Why a command is not offered in chat. Shown to the reader verbatim. */
export type DotUnavailableReason =
  | 'editor-only'
  | 'already-here'
  | 'not-applicable'

export interface DotChatCommand {
  /** The registry id, exactly as the editor defines it. */
  id: string
  /** What typing it in the composer produces. */
  kind: 'question' | 'template' | 'help'
  /** The menu row. */
  label: string
  /** One line under it. */
  hint: string
  /** Whether a trailing symbol is expected, e.g. `.price.AAPL`. */
  takesSymbol: boolean
}

export const DOT_UNAVAILABLE_TEXT: Readonly<Record<DotUnavailableReason, string>> =
  Object.freeze({
    'editor-only': 'Works in a note or research editor, not in chat.',
    'already-here': 'You are already talking to ACT AI.',
    'not-applicable': 'Sets who can see stored content. A question has no audience.',
  })

/**
 * The data commands, and the question each one means.
 *
 * The question is a QUESTION, not an instruction to state a number: the
 * model answers it by looking the figure up, and the lookup is what the
 * evidence section then shows. `{SYMBOL}` is substituted with what the
 * reader chose.
 */
const DATA_QUESTIONS: Readonly<Record<string, string>> = Object.freeze({
  price: 'What is the current price of {SYMBOL}?',
  volume: 'What is the latest trading volume for {SYMBOL}?',
  marketcap: 'What is the market capitalisation of {SYMBOL}?',
  change: 'How has {SYMBOL} moved, and over what period?',
  pe: 'What is the P/E ratio for {SYMBOL}?',
  dividend: 'What is the dividend yield on {SYMBOL}?',
})

/**
 * Every registry id that does something in chat.
 *
 * Deliberately small. The test that reads the extension's source asserts
 * that every OTHER id is listed as unavailable with a reason, so this list
 * growing is a decision rather than an accident.
 */
export const DOT_CHAT_COMMANDS: readonly DotChatCommand[] = Object.freeze([
  { id: 'price', kind: 'question', label: '.price', hint: 'Ask for the current price, looked up.', takesSymbol: true },
  { id: 'volume', kind: 'question', label: '.volume', hint: 'Ask for the latest volume, looked up.', takesSymbol: true },
  { id: 'marketcap', kind: 'question', label: '.marketcap', hint: 'Ask for market capitalisation.', takesSymbol: true },
  { id: 'change', kind: 'question', label: '.change', hint: 'Ask how it has moved.', takesSymbol: true },
  { id: 'pe', kind: 'question', label: '.pe', hint: 'Ask for the P/E ratio.', takesSymbol: true },
  { id: 'dividend', kind: 'question', label: '.dividend', hint: 'Ask for the dividend yield.', takesSymbol: true },
  { id: 'help', kind: 'help', label: '.help', hint: 'What works in chat.', takesSymbol: false },
])

/**
 * The ids that exist in the editor and are not offered here, with the reason.
 *
 * Keyed by id so the drift test can assert the two sets together cover the
 * registry exactly. `template.*` is absent from both because those ids are
 * generated at runtime from the reader's own templates; `templateCommand`
 * below handles them, and the drift test only sees the static list.
 */
export const DOT_UNAVAILABLE: Readonly<Record<string, DotUnavailableReason>> =
  Object.freeze({
    ai: 'already-here',
    'ai.claude': 'already-here',
    'ai.gpt': 'already-here',
    capture: 'editor-only',
    screenshot: 'editor-only',
    embed: 'editor-only',
    data: 'editor-only',
    table: 'editor-only',
    metric: 'editor-only',
    chart: 'editor-only',
    'chart.price': 'editor-only',
    'chart.volume': 'editor-only',
    'chart.performance': 'editor-only',
    'chart.comparison': 'editor-only',
    'chart.technicals': 'editor-only',
    task: 'editor-only',
    event: 'editor-only',
    note: 'editor-only',
    link: 'editor-only',
    private: 'not-applicable',
    team: 'not-applicable',
    portfolio: 'not-applicable',
    toc: 'editor-only',
    divider: 'editor-only',
  })

/**
 * Every known id, longest first, built once.
 *
 * Longest-first so `chart.price.AAPL` reads as `chart.price` + `AAPL` rather
 * than `chart` + `price.AAPL` — the same ordering the editor's own symbol-mode
 * detection uses, for the same reason.
 *
 * At module scope because `parseDotCommand` runs on every keystroke in the
 * composer. Sorting 31 strings is cheap, and doing it per keypress is still
 * work with no result that changes.
 */
const KNOWN_IDS_LONGEST_FIRST: readonly string[] = Object.freeze(
  [...Object.keys(DOT_UNAVAILABLE), ...DOT_CHAT_COMMANDS.map(c => c.id)]
    .sort((a, b) => b.length - a.length),
)

export interface ParsedDotCommand {
  /** The command id, lower-cased. May be unknown to either list. */
  id: string
  /** The symbol the reader attached, upper-cased, or null. */
  symbol: string | null
  /** True while the reader is still typing the command itself. */
  partial: boolean
}

/**
 * Read a dot command off the front of the composer.
 *
 * Both separators are accepted. The editor's own syntax joins the symbol with
 * a dot (`.price.AAPL`), which is what a reader who learned it there will
 * type; a space (`.price AAPL`) is what everyone else will type. Refusing one
 * of them would be a syntax lesson rather than a feature.
 *
 * Only at the START of the message, and only when the message is the command:
 * a sentence that happens to contain ".price" is prose, and the reader
 * writing "the .price command" is not invoking it.
 */
export function parseDotCommand(text: string): ParsedDotCommand | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trimStart()
  if (!trimmed.startsWith('.')) return null

  const body = trimmed.slice(1)
  /* A space ends the command and begins the symbol. */
  const spaceAt = body.search(/\s/)
  const head = spaceAt === -1 ? body : body.slice(0, spaceAt)
  const tail = spaceAt === -1 ? '' : body.slice(spaceAt + 1).trim()

  if (!head) return { id: '', symbol: null, partial: true }

  const lower = head.toLowerCase()
  for (const id of KNOWN_IDS_LONGEST_FIRST) {
    if (lower === id) {
      return { id, symbol: symbolOf(tail), partial: tail.length === 0 && spaceAt === -1 }
    }
    if (lower.startsWith(id + '.')) {
      const rest = head.slice(id.length + 1)
      return { id, symbol: symbolOf(rest || tail), partial: false }
    }
  }

  /* Unknown, or still being typed. Either way the menu filters on it. */
  return { id: lower, symbol: symbolOf(tail), partial: true }
}

function symbolOf(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  if (!s) return null
  /* A ticker, not a sentence. Anything else is left for the reader to fix
     rather than guessed at. */
  return /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(s) ? s : null
}

export function chatCommand(id: string): DotChatCommand | undefined {
  return DOT_CHAT_COMMANDS.find(c => c.id === id)
}

/** The commands to offer for what has been typed so far. */
export function dotSuggestions(query: string): readonly DotChatCommand[] {
  const q = query.replace(/^\./, '').toLowerCase()
  if (!q) return DOT_CHAT_COMMANDS
  return DOT_CHAT_COMMANDS.filter(
    c => c.id.startsWith(q) || c.hint.toLowerCase().includes(q),
  )
}

export type DotExpansion =
  | { kind: 'text'; text: string }
  | { kind: 'needs-symbol'; command: DotChatCommand }
  | { kind: 'unavailable'; id: string; reason: DotUnavailableReason }
  | { kind: 'unknown'; id: string }

/**
 * What a command becomes in the composer.
 *
 * Text, every time, which the reader then sends. Nothing here performs a
 * lookup, and nothing states a figure: `.price.AAPL` becomes the question,
 * and the answer's numbers come from the model's own retrieval with a source
 * attached. A figure this module produced would have no provenance path, and
 * provenance is enforced in this codebase rather than encouraged.
 */
export function expandDotCommand(
  parsed: ParsedDotCommand,
  options: { templateBody?: (shortcut: string) => string | null } = {},
): DotExpansion {
  const { id, symbol } = parsed

  if (id.startsWith('template.')) {
    const shortcut = id.slice('template.'.length)
    const body = options.templateBody?.(shortcut) ?? null
    return body
      ? { kind: 'text', text: body }
      : { kind: 'unknown', id }
  }

  const reason = DOT_UNAVAILABLE[id]
  if (reason) return { kind: 'unavailable', id, reason }

  const command = chatCommand(id)
  if (!command) return { kind: 'unknown', id }

  if (command.kind === 'help') {
    return { kind: 'text', text: helpText() }
  }

  if (command.takesSymbol) {
    if (!symbol) return { kind: 'needs-symbol', command }
    const question = DATA_QUESTIONS[id]
    if (!question) return { kind: 'unknown', id }
    return { kind: 'text', text: question.replace('{SYMBOL}', symbol) }
  }

  return { kind: 'unknown', id }
}

/**
 * `.help`, as a question rather than a canned answer.
 *
 * It expands into the composer like everything else, so the reader sees what
 * they are about to ask. The alternative -- printing a help card -- would be
 * a second kind of message in the thread with none of a message's provenance.
 */
export function helpText(): string {
  const names = DOT_CHAT_COMMANDS.filter(c => c.kind === 'question').map(c => c.label)
  return `Which Tesseract commands work in this chat? (${names.join(', ')}, plus my templates)`
}
