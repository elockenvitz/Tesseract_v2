/**
 * The dot-command menu, above the composer.
 *
 * Opens when the message STARTS with a dot, which is the only position a
 * command can be in: a sentence containing ".price" is prose, and a reader
 * writing "the .price command" is not invoking it. `parseDotCommand` owns
 * that rule; this draws the result.
 *
 * Three things it says, and the third is the one worth having:
 *
 *   * the commands that work here, filtered as the reader types
 *   * that a symbol is still needed, when the command takes one
 *   * that a command belongs to the editor, BY NAME, with the reason
 *
 * The third is why a reader who types `.chart.price.AAPL` is told that
 * charts work in a note editor rather than being shown a degraded chart, an
 * empty box, or nothing at all.
 *
 * Choosing a command replaces the composer's text with the expansion and
 * leaves it there. Nothing is sent: a menu that fired a request on selection
 * would spend tokens on a keystroke, and the reader would never see what
 * they had asked.
 */
import {
  parseDotCommand, expandDotCommand, dotSuggestions,
  DOT_UNAVAILABLE_TEXT, type DotChatCommand,
} from '../../lib/ai/dot-commands'

export interface AiDotMenuProps {
  /** The composer's current value. */
  value: string
  /** Replaces the composer's value with the expansion. */
  onPick: (text: string) => void
  /** The reader's own templates, by shortcut. */
  templateBody?: (shortcut: string) => string | null
  className?: string
}

export function AiDotMenu({ value, onPick, templateBody, className }: AiDotMenuProps) {
  const parsed = parseDotCommand(value)
  if (!parsed) return null

  const expansion = expandDotCommand(parsed, { templateBody })

  /* A command that cannot work here. Named, with the reason. */
  if (expansion.kind === 'unavailable') {
    return (
      <Frame className={className} testId="ai-dot-unavailable">
        <p className="text-[12px] text-gray-700 dark:text-gray-200">
          <span className="font-semibold">.{expansion.id}</span>{' '}
          {DOT_UNAVAILABLE_TEXT[expansion.reason]}
        </p>
      </Frame>
    )
  }

  /* The command is right, the symbol is missing. */
  if (expansion.kind === 'needs-symbol') {
    return (
      <Frame className={className} testId="ai-dot-needs-symbol">
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
      <Frame className={className} testId="ai-dot-ready">
        <Row
          label={value.trim()}
          hint={expansion.text}
          onPick={() => onPick(expansion.text)}
        />
      </Frame>
    )
  }

  /* Unknown, or still being typed: offer what matches. */
  const matches = dotSuggestions(parsed.id)
  if (matches.length === 0) {
    return (
      <Frame className={className} testId="ai-dot-none">
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          No command called <span className="font-mono">.{parsed.id}</span> works in chat.
        </p>
      </Frame>
    )
  }

  return (
    <Frame className={className} testId="ai-dot-menu">
      <ul>
        {matches.map(command => (
          <li key={command.id}>
            <Row
              label={command.label}
              hint={command.hint}
              testId={`ai-dot-option-${command.id}`}
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
function pickText(
  command: DotChatCommand,
  templateBody?: (shortcut: string) => string | null,
): string {
  if (command.takesSymbol) return `${command.label}.`
  const expansion = expandDotCommand(
    { id: command.id, symbol: null, partial: false },
    { templateBody },
  )
  return expansion.kind === 'text' ? expansion.text : command.label
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
  label, hint, onPick, testId,
}: {
  label: string
  hint: string
  onPick: () => void
  testId?: string
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      data-testid={testId}
      className="flex w-full flex-col items-start gap-0.5 rounded px-2 py-1 text-left
                 hover:bg-gray-100 dark:hover:bg-gray-800"
    >
      <span className="font-mono text-[12px] text-gray-900 dark:text-gray-100">{label}</span>
      <span className="text-[11px] text-gray-500 dark:text-gray-400">{hint}</span>
    </button>
  )
}
