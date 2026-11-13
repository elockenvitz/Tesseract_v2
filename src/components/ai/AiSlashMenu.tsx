/**
 * The Slash Command menu, above the composer.
 *
 * Opens when the message STARTS with `/`, which is the only position a
 * command can be in: a sentence containing "/price" is prose, and a reader
 * writing "the /price command" is not invoking it. `parseSlashCommand` owns
 * that rule, including which leading slashes are not commands at all -- a
 * date, a sum, a path -- and this draws the result.
 *
 * Three things it says, and the third is the one worth having:
 *
 *   * the commands that work here, filtered as the reader types
 *   * that a symbol is still needed, when the command takes one
 *   * that a command belongs to the editor, BY NAME, with the reason
 *
 * The third is why a reader who types `/chart.price.AAPL` is told that
 * charts work in a note editor rather than being shown a degraded chart, an
 * empty box, or nothing at all.
 *
 * Choosing a command replaces the composer's text with the expansion and
 * leaves it there. Nothing is sent: a menu that fired a request on selection
 * would spend tokens on a keystroke, and the reader would never see what
 * they had asked.
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
import {
  parseSlashCommand, expandSlashCommand, slashSuggestions,
  SLASH_UNAVAILABLE_TEXT, SLASH, type SlashChatCommand,
} from '../../lib/ai/slash-commands'

export interface AiSlashMenuProps {
  /** The composer's current value. */
  value: string
  /** Replaces the composer's value with the expansion. */
  onPick: (text: string) => void
  /** The reader's own templates, by shortcut. */
  templateBody?: (shortcut: string) => string | null
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
  value, onPick, templateBody, activeIndex, onRowCountChange, className,
}: AiSlashMenuProps) {
  const parsed = parseSlashCommand(value)
  const expansion = parsed ? expandSlashCommand(parsed, { templateBody }) : null

  /*
   * The rows the keyboard can reach, which is NOT every state this component
   * renders: "needs a ticker" and "works in the editor" are statements with
   * nothing to select, and reporting them as one row would let Enter pick
   * something that does not exist.
   */
  const matches = parsed && expansion && expansion.kind !== 'text'
      && expansion.kind !== 'unavailable' && expansion.kind !== 'needs-symbol'
    ? slashSuggestions(parsed.id)
    : []
  const rowCount = expansion?.kind === 'text' ? 1 : matches.length

  useEffect(() => { onRowCountChange?.(rowCount) }, [rowCount, onRowCountChange])

  if (!parsed || !expansion) return null

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

/**
 * The text the composer should insert for the row at `index`.
 *
 * Exported so `AiComposer` can honour Enter without reimplementing the
 * filtering or the prefix rule. Returns null when there is nothing at that
 * index, which is the case in every state that has no selectable row.
 */
export function slashRowText(
  value: string,
  index: number,
  templateBody?: (shortcut: string) => string | null,
): string | null {
  const parsed = parseSlashCommand(value)
  if (!parsed) return null
  const expansion = expandSlashCommand(parsed, { templateBody })
  if (expansion.kind === 'text') return index === 0 ? expansion.text : null
  if (expansion.kind === 'unavailable' || expansion.kind === 'needs-symbol') return null
  const command = slashSuggestions(parsed.id)[index]
  return command ? pickText(command, templateBody) : null
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
