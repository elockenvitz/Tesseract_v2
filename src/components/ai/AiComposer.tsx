/**
 * Where a question is written, and everything that belongs to writing one.
 *
 * ── The five things a reader saw, and what each one actually was ─────────
 *
 * The first version of this file fixed the BEHAVIOUR of the composer and
 * left its shape alone: a bordered textarea, a detached blue square to its
 * right, the context control floating above it, and the model picker in a
 * separate row underneath. Five complaints came back off a screenshot, and
 * each one has a cause worth writing down, because four of them are not
 * matters of taste.
 *
 * 1. A HEAVY DOUBLE FOCUS BORDER. `focus:border-primary-500` AND
 *    `focus:ring-2 focus:ring-primary-500`, with no `outline-none`. That is
 *    two concentric rings of the same colour, plus whatever the browser
 *    draws for its own focus. The fix is structural rather than cosmetic:
 *    the CONTAINER carries one ring on `focus-within`, and the textarea
 *    inside it has no border, no ring and no outline of its own. One focus
 *    treatment, because there is one thing being focused.
 *
 * 2. A SCROLLBAR IN AN EMPTY BOX. This was a real bug, not styling.
 *    `height = scrollHeight` looks exact and is short by the border:
 *    Tailwind sets `box-sizing: border-box`, so the height property has to
 *    cover content, padding AND border, while `scrollHeight` covers only
 *    content and padding. The box ended up 2px too short for its own text,
 *    overflowed by 2px, and grew a native scrollbar on an empty line. The
 *    border is measured and added now, and overflow is hidden until the
 *    cap is actually reached, so the bar appears when there is something to
 *    scroll and never before.
 *
 * 3. A SEPARATE SEND BUTTON. A 48px primary-filled square sitting outside
 *    the input, which reads as a form control next to a field rather than
 *    as part of one composer. It moved inside, into the toolbar, at the
 *    size a send control is.
 *
 * 4. ADD CONTEXT FLOATING ABOVE THE TEXTAREA. The pane rendered it as a
 *    sibling. This component has always had a `children` slot for exactly
 *    that and nothing passed anything to it, so the attachment controls sat
 *    in their own band above the box with their own margin.
 *
 * 5. THE MODEL SELECTOR IN A ROW OF ITS OWN. Same cause, no slot. There is
 *    one now.
 *
 * ── What it owns, and what it still does not ─────────────────────────────
 *
 * It owns the container, the box, the keys, the toolbar, and the one control
 * that starts or stops a turn. It owns no state but its own height: the
 * value, the attachments, the model and the sending are all the pane's, and
 * arrive as props. That is what lets a test press Stop without standing up
 * the conversation hook.
 *
 * ── Behaviour preserved from the previous version ────────────────────────
 *
 * The box stays editable while an answer streams (`aria-busy`, never
 * `disabled`): the hook already supersedes an in-flight request and the
 * reader may well want to correct the next question while waiting. Stop
 * lives where Send was and stays for the whole generation, which is the
 * period that once had no Stop at all. The height follows the VALUE through
 * a layout effect, so a seeded prompt written straight into the value gets
 * a correctly sized box on its first frame.
 *
 * It does not queue. Enter while streaming does nothing, because the hook's
 * behaviour on a second send is to abandon the first answer, and a keystroke
 * is not a clear instruction to throw away a half-written one.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, Square } from 'lucide-react'
import clsx from 'clsx'

/**
 * The tallest the box grows before it scrolls, in pixels.
 *
 * About nine lines at this size: enough for a question with a short list in
 * it, which is the shape of a real one, while leaving the thread above it
 * readable. Past this it scrolls rather than pushing the conversation off
 * screen.
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
  /**
   * Above the box, inside the container: the attached-context chips.
   *
   * Inside, because an attachment is part of the question. Rendered in its
   * own padded band only when something is passed, so an empty conversation
   * does not carry an empty strip.
   */
  children?: React.ReactNode
  /**
   * The toolbar's left side, inside the container, beside the send control:
   * Add Context, Slash Commands, the model picker.
   */
  toolbar?: React.ReactNode
}

export function AiComposer({
  value, onChange, onSend, onStop,
  isStreaming = false, disabled = false, placeholder, className, children, toolbar,
}: AiComposerProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  /** True only once the text genuinely exceeds the cap. */
  const [scrolls, setScrolls] = useState(false)

  /*
   * The height follows the value, not the keystroke, and it accounts for the
   * border.
   *
   * `scrollHeight` is content + padding. The height property on a
   * border-box element must also cover the border, so adding scrollHeight
   * alone leaves the box short by exactly the border width -- which is what
   * put a scrollbar in an empty composer. The border is measured from the
   * computed style rather than assumed, because the theme sets it.
   */
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    el.style.height = 'auto'

    const style = window.getComputedStyle(el)
    const border =
      (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0)
    const needed = el.scrollHeight + border

    el.style.height = `${Math.min(needed, MAX_HEIGHT)}px`
    setScrolls(needed > MAX_HEIGHT)
  }, [value])

  const canSend = value.trim().length > 0 && !isStreaming && !disabled

  /*
   * One send per press.
   *
   * `isStreaming` arrives from the pane a render later than the click, so
   * two fast Enters or a double click could both pass `canSend` and send the
   * same question twice. The ref closes that window within the frame; the
   * pane clearing the value closes it after.
   */
  const sending = useRef(false)

  const submit = () => {
    if (!canSend || sending.current) return
    sending.current = true
    onSend(value.trim())
    /* Released on the next tick: by then either the value has been cleared
       or the send failed and the reader should be able to retry. */
    setTimeout(() => { sending.current = false }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    /*
     * Mid-composition Enter belongs to the input method, not to us.
     *
     * Typing Japanese, Chinese or Korean, Enter COMMITS the candidate the
     * IME is showing. Treating it as a send fires the question with
     * half-converted text in it and no way to get the rest back. `keyCode
     * === 229` is the older signal for the same state and some browsers
     * still send only that.
     */
    const native = e.nativeEvent as KeyboardEvent & { isComposing?: boolean }
    if (native.isComposing || native.keyCode === 229) return
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
      {/*
        One container, one border, one focus ring. `focus-within` rather than
        a focus class on the textarea: the thing a reader focuses is the
        composer, and the toolbar controls inside it are part of it.
      */}
      <div
        data-testid="ai-composer"
        className={clsx(
          'rounded-2xl border bg-white shadow-sm transition-colors dark:bg-gray-900',
          'focus-within:ring-2 focus-within:ring-primary-500/40',
          disabled
            ? 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/60'
            : 'border-gray-300 focus-within:border-primary-500 dark:border-gray-600',
        )}
      >
        {/* The attachments, inside, because an attachment is part of the
            question. Only when there is something to draw. */}
        {children ? (
          <div className="px-3 pt-2.5" data-testid="ai-composer-context">
            {children}
          </div>
        ) : null}

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
          className={clsx(
            /* No border, no ring, no outline. The container has those, and
               two of them stacked is what read as a heavy double edge. */
            'block w-full resize-none border-0 bg-transparent px-3.5 py-3 text-sm leading-relaxed',
            'text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0',
            'dark:text-gray-100 dark:placeholder:text-gray-500',
            /* Hidden until the text actually passes the cap, so an empty box
               never shows a bar. */
            scrolls ? 'overflow-y-auto' : 'overflow-y-hidden',
            disabled && 'cursor-not-allowed text-gray-500 dark:text-gray-400',
          )}
        />

        {/*
          The toolbar, inside the container. At the 384px sidebar width the
          left group may need to wrap or scroll before the send control
          does, so send is `shrink-0` and the group beside it is allowed to
          shrink and clip rather than pushing it out.
        */}
        <div className="flex items-center gap-2 px-2.5 pb-2.5 pt-0.5">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {toolbar}
          </div>

          {isStreaming && onStop ? (
            <button
              type="button"
              onClick={onStop}
              data-testid="ai-composer-stop"
              aria-label="Stop generating"
              title="Stop generating"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full
                         bg-gray-900 text-white transition-colors hover:bg-gray-700
                         dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white"
            >
              {/* Decorative: the control is named above. */}
              <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              data-testid="ai-composer-send"
              aria-label="Send"
              title="Send"
              className={clsx(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                canSend
                  ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-white'
                  : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-gray-700 dark:text-gray-500',
              )}
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
