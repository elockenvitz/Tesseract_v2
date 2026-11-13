/**
 * Where a question is written, and the one control that starts or stops it.
 *
 * ── Four faults this replaces ────────────────────────────────────────────
 *
 * 1. THE BOX WENT DEAD WHILE AN ANSWER STREAMED. The textarea carried
 *    `disabled={isLoading}`, so from the moment a question was sent until the
 *    answer finished, the reader could not type the next one -- or correct a
 *    typo in what they were about to ask. Nothing requires that: `sendMessage`
 *    already supersedes an in-flight request, and the composer holds its own
 *    text. It stays editable.
 *
 * 2. THERE WAS NO WAY TO STOP A LONG ANSWER. The send control became a
 *    disabled spinner, and the only Stop lived in the working row, which by
 *    design disappears the moment prose starts arriving. So the whole period
 *    where stopping is actually worth something -- a long answer being
 *    written -- had no control at all. Stop now lives here, where Send was,
 *    and stays for the whole generation.
 *
 * 3. THE BOX DID NOT GROW WHEN SOMETHING ELSE FILLED IT. Auto-resize ran in
 *    the change handler only, so a seeded prompt -- the engagement seam writes
 *    one straight into the value -- arrived in a one-row box with its own
 *    scrollbar. The height is a layout effect on the value now, so every
 *    writer of the value gets it, including the clear after a send.
 *
 * 4. A DETAILED QUESTION HAD FIVE LINES. The cap was 120px. A question worth
 *    asking an investment assistant is often a paragraph with a list in it,
 *    and the reader could see a fifth of it while writing.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It does not queue. Enter while an answer is streaming does nothing rather
 * than silently stacking a second question, because the hook's behaviour on a
 * second send is to ABANDON the first answer, and a keystroke is not a clear
 * instruction to throw away an answer that is half-written. Stop, then send,
 * is two deliberate acts and reads as one.
 *
 * It does not own the context chips, the model selector or the mode switch.
 * Those are the pane's, and they sit above and below this.
 */
import { useLayoutEffect, useRef } from 'react'
import { Send, Square } from 'lucide-react'

/**
 * The tallest the box grows before it scrolls, in pixels.
 *
 * About nine lines at the composer's size: enough for a question with a
 * short list in it, which is the shape of a real one, while still leaving
 * the thread above it readable. Past this it scrolls rather than pushing the
 * conversation off screen.
 */
const MAX_HEIGHT = 220

export interface AiComposerProps {
  value: string
  onChange: (value: string) => void
  /** Called with the trimmed text. Never called while `isStreaming`. */
  onSend: (text: string) => void
  /**
   * Cancels the answer being written. Required when `isStreaming` can be
   * true: a Stop that does not stop is worse than no Stop, so this takes a
   * real handler rather than being inferred from a flag.
   */
  onStop?: () => void
  isStreaming?: boolean
  /** Blocks typing and sending outright -- AI not configured, no access. */
  disabled?: boolean
  placeholder?: string
  className?: string
  /** Rendered between the box and the controls, e.g. the context chips. */
  children?: React.ReactNode
}

export function AiComposer({
  value, onChange, onSend, onStop,
  isStreaming = false, disabled = false, placeholder, className, children,
}: AiComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)

  /*
   * The height follows the value, not the keystroke.
   *
   * `useLayoutEffect` so the box is already the right size on the frame the
   * text appears, rather than one frame of a one-row box and then a jump --
   * which is what a seeded prompt looked like.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`
  }, [value])

  const canSend = value.trim().length > 0 && !isStreaming && !disabled

  const submit = () => {
    if (!canSend) return
    onSend(value.trim())
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    /* A newline, deliberately asked for. */
    if (e.shiftKey) return
    /*
     * Enter sends, and so does Cmd/Ctrl+Enter -- the habit from every other
     * composer, and harmless to honour.
     *
     * While an answer streams, Enter is swallowed rather than sent: see the
     * note on queueing above. It is still prevented, so the keystroke does
     * not drop a newline into the box the reader did not ask for.
     */
    e.preventDefault()
    submit()
  }

  return (
    <div className={className}>
      {children}
      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          <textarea
            ref={ref}
            value={value}
            onChange={e => onChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            rows={1}
            disabled={disabled}
            data-testid="ai-composer-input"
            /* `aria-busy`, not `disabled`: the answer is being written, and
               the reader may keep typing while it is. */
            aria-busy={isStreaming || undefined}
            className="w-full resize-none rounded-lg border border-gray-300 px-4 py-3
                       focus:border-primary-500 focus:ring-2 focus:ring-primary-500
                       disabled:bg-gray-50 disabled:text-gray-500
                       dark:border-gray-600 dark:bg-gray-800 dark:text-white
                       dark:disabled:bg-gray-900"
          />
        </div>
        {isStreaming && onStop ? (
          <button
            type="button"
            onClick={onStop}
            data-testid="ai-composer-stop"
            aria-label="Stop generating"
            title="Stop generating"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg
                       border border-gray-300 text-gray-700 hover:bg-gray-100
                       dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            {/* Decorative: the control is named above. */}
            <Square className="h-4 w-4 fill-current" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            data-testid="ai-composer-send"
            aria-label="Send"
            title="Send"
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg
                       bg-primary-600 text-white hover:bg-primary-700
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Send className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}
