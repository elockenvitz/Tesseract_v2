/**
 * The Slash Command menu, above the composer.
 *
 * Opens when the message STARTS with `/`, which is the only position a
 * command can be in: a sentence containing "/price" is prose, and a reader
 * writing "the /price command" is not invoking it. `parseSlashCommand` owns
 * that rule, including which leading slashes are not commands at all -- a
 * date, a sum, a path -- and this draws the result.
 *
 * What it can say, and which of those have something to press:
 *
 *   * the commands that work here, filtered as the reader types     [rows]
 *   * A FIGURE, retrieved, with its source and its date             [1 row]
 *   * that a figure is NOT stored, naming the missing input, with
 *     the model lookup offered as a separate choice                 [1 row]
 *   * that a symbol is still needed, when the command takes one     [none]
 *   * that a command belongs to the editor, BY NAME, with why       [none]
 *   * what works in chat, for `/help`                               [none]
 *
 * The figure is the one worth having. `/price.AAPL` used to put "What is the
 * current price of AAPL?" in the box for the reader to send; it now shows
 * the stored close, what it is called, where it came from and how old it is,
 * and pressing it inserts all four as one string. A number travelling into
 * a message without its provenance is the failure the market-data layer
 * exists to prevent, so the row cannot insert the figure alone.
 *
 * Nothing here is ever sent. Choosing a row puts text under the reader's
 * hands and they press Send: a menu that fired a request on selection would
 * spend tokens on a keystroke, and the reader would never see what they had
 * asked.
 *
 * ── Keyboard ────────────────────────────────────────────────────────────
 *
 * Arrow keys and Enter are handled by the COMPOSER, not here, because the
 * reader's focus never leaves the textarea while the menu is open -- they
 * are still typing the command. This component owns the list and reports
 * which row is active; `AiComposer` owns the keystrokes. Two components
 * both listening for Enter is how a menu selection also sends the message.
 */
import { useEffect } from 'react'
import { clsx } from 'clsx'
import { AlertTriangle } from 'lucide-react'
import {
  parseSlashCommand, expandSlashCommand, slashSuggestions,
  SLASH_UNAVAILABLE_TEXT, SLASH,
  type SlashChatCommand, type SlashExpansion,
} from '../../lib/ai/slash-commands'
import {
  formatReading, provenanceLine, stalenessNote, readingAsText,
  type SlashReading,
} from '../../lib/ai/slash-market-data'

export interface AiSlashMenuProps {
  /** The composer's current value. */
  value: string
  /** Replaces the composer's value with the expansion. */
  onPick: (text: string) => void
  /** The reader's own templates, by shortcut. */
  templateBody?: (shortcut: string) => string | null
  /**
   * The figure, when the command is one the store can answer.
   *
   * Passed in rather than read here: the read needs Supabase and this
   * component is rendered in tests without one. Null while there is nothing
   * to read -- which is every state except a data command with a ticker.
   */
  reading?: SlashReading | null
  /**
   * Which row the keyboard is on, owned by the composer.
   *
   * Passed in rather than held here because the composer is what has focus
   * and therefore what sees the arrow keys. Undefined means no keyboard
   * navigation is wired up, and every row is still clickable.
   */
  activeIndex?: number
  /**
   * How many rows there are, reported upward.
   *
   * The composer needs the count to clamp its own cursor, and it cannot
   * derive it: the filtering rule lives in `slashSuggestions`. Called on
   * every render where the count changes.
   */
  onRowCountChange?: (count: number) => void
  className?: string
}

export function AiSlashMenu({
  value, onPick, templateBody, reading, activeIndex, onRowCountChange, className,
}: AiSlashMenuProps) {
  const parsed = parseSlashCommand(value)
  const expansion = parsed ? expandSlashCommand(parsed, { templateBody }) : null

  /*
   * The rows the keyboard can reach, which is NOT every state this component
   * renders: "needs a ticker", "works in the editor" and the help list are
   * statements with nothing to select, and reporting them as one row would
   * let Enter pick something that does not exist.
   */
  const matches = parsed && expansion && expansion.kind === 'unknown'
    ? slashSuggestions(parsed.id)
    : []
  const rowCount = slashRowCount(expansion, reading) || matches.length

  useEffect(() => { onRowCountChange?.(rowCount) }, [rowCount, onRowCountChange])

  if (!parsed || !expansion) return null

  /*
   * A figure, retrieved. The number, what it is called, where it came from
   * and how old it is -- all four, because a figure without them is the
   * thing provenance exists to prevent.
   */
  if (expansion.kind === 'reading') {
    return (
      <Frame className={className} testId="ai-slash-reading">
        <SlashReadingBody
          reading={reading}
          symbol={expansion.symbol}
          active={activeIndex === 0}
          onPick={onPick}
        />
      </Frame>
    )
  }

  /* A figure the store cannot produce. The missing input, named. */
  if (expansion.kind === 'data-blocked') {
    return (
      <Frame className={className} testId="ai-slash-data-blocked">
        <p className="flex items-start gap-1.5 px-2 py-1 text-[12px] text-amber-700 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          <span>{expansion.blocker}</span>
        </p>
        {/* Offered, and clearly a different act: asking the model to look it
            up, chosen by the reader after being told the store cannot. */}
        <Row
          label="Ask ACT AI to look it up"
          hint={expansion.fallback}
          active={activeIndex === 0}
          testId="ai-slash-data-fallback"
          onPick={() => onPick(expansion.fallback)}
        />
      </Frame>
    )
  }

  /* The registry answering for itself. Nothing to send. */
  if (expansion.kind === 'help') {
    return (
      <Frame className={className} testId="ai-slash-help">
        <p className="px-2 py-1 text-[12px] text-gray-700 dark:text-gray-200">{expansion.text}</p>
      </Frame>
    )
  }

  /* A command that cannot work here. Named, with the reason. */
  if (expansion.kind === 'unavailable') {
    return (
      <Frame className={className} testId="ai-slash-unavailable">
        <p className="text-[12px] text-gray-700 dark:text-gray-200">
          <span className="font-semibold">{SLASH}{expansion.id}</span>{' '}
          {SLASH_UNAVAILABLE_TEXT[expansion.reason]}
        </p>
      </Frame>
    )
  }

  /* The command is right, the symbol is missing. */
  if (expansion.kind === 'needs-symbol') {
    return (
      <Frame className={className} testId="ai-slash-needs-symbol">
        <p className="text-[12px] text-gray-700 dark:text-gray-200">
          <span className="font-semibold">{expansion.command.label}</span>{' '}
          needs a ticker. Try{' '}
          <span className="font-mono">{expansion.command.label}.AAPL</span>.
        </p>
      </Frame>
    )
  }

  /* Ready. One row, so there is something to press rather than only an
     instruction to keep typing. */
  if (expansion.kind === 'text') {
    return (
      <Frame className={className} testId="ai-slash-ready">
        <Row
          label={value.trim()}
          hint={expansion.text}
          active={activeIndex === 0}
          onPick={() => onPick(expansion.text)}
        />
      </Frame>
    )
  }

  /* Unknown, or still being typed: offer what matches. */
  if (matches.length === 0) {
    return (
      <Frame className={className} testId="ai-slash-none">
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          No command called <span className="font-mono">{SLASH}{parsed.id}</span> works in chat.
        </p>
      </Frame>
    )
  }

  return (
    <Frame className={className} testId="ai-slash-menu">
      <ul role="listbox" aria-label="Slash commands">
        {matches.map((command, i) => (
          <li key={command.id} role="none">
            <Row
              label={command.label}
              hint={command.hint}
              active={activeIndex === i}
              testId={`ai-slash-option-${command.id}`}
              onPick={() => onPick(pickText(command, templateBody))}
            />
          </li>
        ))}
      </ul>
    </Frame>
  )
}

/**
 * What choosing a row from the list puts in the box.
 *
 * A command that takes a symbol becomes its own prefix, ready for the
 * ticker, rather than a question with a placeholder in it: a composer
 * containing "What is the current price of {SYMBOL}?" invites sending it.
 */
export function pickText(
  command: SlashChatCommand,
  templateBody?: (shortcut: string) => string | null,
): string {
  if (command.takesSymbol) return `${command.label}.`
  const expansion = expandSlashCommand(
    { id: command.id, symbol: null, partial: false },
    { templateBody },
  )
  return expansion.kind === 'text' ? expansion.text : command.label
}

export interface SlashRowOptions {
  templateBody?: (shortcut: string) => string | null
  /** The figure, for a command the store can answer. */
  reading?: SlashReading | null
}

/**
 * The text the composer should insert for the row at `index`.
 *
 * Exported so `AiComposer` can honour Enter without reimplementing the
 * filtering or the prefix rule. Returns null when there is nothing at that
 * index, which is the case in every state that has no selectable row -- and
 * a null is what stops Enter inserting something that is not on screen.
 */
export function slashRowText(
  value: string,
  index: number,
  opts: SlashRowOptions = {},
): string | null {
  const { templateBody, reading } = opts
  const parsed = parseSlashCommand(value)
  if (!parsed) return null
  const expansion = expandSlashCommand(parsed, { templateBody })
  switch (expansion.kind) {
    case 'text':
      return index === 0 ? expansion.text : null
    case 'reading':
      /* Only once the figure is actually here. Enter during the read must
         insert nothing rather than a placeholder the reader would send. */
      return index === 0 ? readingAsText(reading ?? null) : null
    case 'data-blocked':
      return index === 0 ? expansion.fallback : null
    case 'help':
    case 'unavailable':
    case 'needs-symbol':
      return null
    default: {
      const command = slashSuggestions(parsed.id)[index]
      return command ? pickText(command, templateBody) : null
    }
  }
}

/**
 * How many rows the keyboard can reach.
 *
 * Shares `slashRowText`'s cases on purpose: the count and the text have to
 * agree, or Enter picks a row that is not drawn. A reading that has not
 * arrived is ZERO rows, not a disabled one.
 */
export function slashRowCount(
  expansion: SlashExpansion | null,
  reading?: SlashReading | null,
): number {
  if (!expansion) return 0
  switch (expansion.kind) {
    case 'text':
    case 'data-blocked':
      return 1
    case 'reading':
      return readingAsText(reading ?? null) ? 1 : 0
    default:
      return 0
  }
}

/**
 * The retrieved figure, in its four states.
 *
 * `loading` and `empty` are statements with nothing to select. Only `ok`
 * gives a row, and what that row inserts is the figure WITH its provenance
 * in one string -- the number travelling alone into a message is how a value
 * ends up quoted with no source attached.
 */
function SlashReadingBody({
  reading, symbol, active, onPick,
}: {
  reading?: SlashReading | null
  symbol: string
  active?: boolean
  onPick: (text: string) => void
}) {
  if (!reading || reading.state === 'loading') {
    return (
      <p className="px-2 py-1 text-[12px] text-gray-500 dark:text-gray-400">
        Looking up {symbol}...
      </p>
    )
  }

  if (reading.state === 'empty' || reading.state === 'error') {
    return (
      <p className="flex items-start gap-1.5 px-2 py-1 text-[12px] text-gray-600 dark:text-gray-300">
        <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" aria-hidden />
        {/* The reason the read gave, verbatim. Never "something went wrong". */}
        <span data-testid="ai-slash-reading-detail">{reading.detail ?? `Nothing stored for ${symbol}.`}</span>
      </p>
    )
  }

  const figure = formatReading(reading)
  const provenance = provenanceLine(reading)
  const stale = stalenessNote(reading)
  const text = readingAsText(reading)

  /* `ok` with no formattable figure is a contract break, not a blank row. */
  if (!figure || !provenance || !text) {
    return (
      <p className="px-2 py-1 text-[12px] text-gray-600 dark:text-gray-300">
        {symbol} came back without a usable figure.
      </p>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onPick(text)}
      data-testid="ai-slash-reading-row"
      role="option"
      aria-selected={!!active}
      className={clsx(
        'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left',
        'hover:bg-gray-100 dark:hover:bg-gray-800',
        active && 'bg-gray-100 dark:bg-gray-800',
      )}
    >
      <span className="flex items-baseline gap-2">
        <span className="text-[15px] font-semibold tabular-nums text-gray-900 dark:text-gray-100">
          {figure}
        </span>
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {reading.symbol} {(reading.label ?? 'value').toLowerCase()}
        </span>
      </span>
      <span className="text-[11px] text-gray-500 dark:text-gray-400" data-testid="ai-slash-provenance">
        {provenance}{stale ? ` · ${stale}` : ''}
      </span>
    </button>
  )
}

function Frame({
  children, className, testId,
}: {
  children: React.ReactNode
  className?: string
  testId: string
}) {
  return (
    <div
      data-testid={testId}
      className={`mb-2 rounded-md border border-gray-200 bg-white p-1.5 shadow-sm
                  dark:border-gray-700 dark:bg-gray-900 ${className ?? ''}`}
    >
      {children}
    </div>
  )
}

function Row({
  label, hint, onPick, active, testId,
}: {
  label: string
  hint: string
  onPick: () => void
  active?: boolean
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={testId}
      role="option"
      aria-selected={!!active}
      className={clsx(
        'flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left',
        'hover:bg-gray-100 dark:hover:bg-gray-800',
        active && 'bg-gray-100 dark:bg-gray-800',
      )}
    >
      <span className="font-mono text-[12px] text-gray-900 dark:text-gray-100">{label}</span>
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
    </button>
  )
}
