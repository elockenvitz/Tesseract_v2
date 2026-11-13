/**
 * One turn in a conversation, or one briefing.
 *
 * ── Why the model name arrives as a prop ─────────────────────────────────
 *
 * The bubble used to look the display name up in `AI_MODELS`, which lives in
 * `useAIConfig` — a module that builds a Supabase client on import. A
 * presentation component that cannot be rendered without auth cannot be
 * tested, and that is the reason this and the trail spent their lives inside
 * `AISection.tsx`. The caller resolves the label; this renders it.
 *
 * `footer` is the same idea for suggested actions: those arrive pre-validated
 * against the action catalogue and the conversation's own context, and the
 * component that renders them belongs to the chat, not to the presentation
 * layer. A briefing passes nothing and gets no actions, which is correct.
 */
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Check, Copy } from 'lucide-react'
import { clsx } from 'clsx'
import { AiProse } from './AiProse'
import { AiEvidence } from './AiEvidence'
import type { AiRenderableMessage, AiSourceRef } from '../../lib/ai/presentation'
import { chatLayout, type AiChatMode } from '../../lib/ai/chat-modes'

interface AiMessageProps {
  message: AiRenderableMessage
  /** Display name for `message.model`, resolved by the caller. */
  modelLabel?: string | null
  onTickerClick?: (symbol: string) => void
  onOpenSource?: (source: AiSourceRef) => void
  /** Suggested actions, or anything else the chat wants under the body. */
  footer?: ReactNode
  /**
   * Controls that sit beside Copy on the meta row, for an assistant turn.
   *
   * A slot rather than a prop per control: what can be done with an answer
   * belongs to the chat, which knows the thread and the subject. This
   * component still owns where those controls live and when they appear,
   * which is why a streaming turn gets neither this nor Copy.
   */
  metaActions?: ReactNode
  /**
   * A briefing opens its evidence; a chat reply folds it away.
   *
   * Left undefined, the mode decides: research mode is where someone is
   * checking sources, and a trail folded shut on a full-width pane is a click
   * charged for nothing.
   */
  evidenceOpen?: boolean
  /**
   * Compact rail or full-width research pane.
   *
   * It governs the bubble's ceiling, which is not cosmetic: at `max-w-[85%]`
   * a six-column weight table scrolls inside a container that had 15% of a
   * 1600px pane left over beside it.
   */
  mode?: AiChatMode
}

export function AiMessage({
  message, modelLabel, onTickerClick, onOpenSource, footer, metaActions, evidenceOpen,
  mode = 'compact',
}: AiMessageProps) {
  const layout = chatLayout(mode)
  const showEvidenceOpen = evidenceOpen ?? layout.evidenceOpen
  const [copied, setCopied] = useState(false)
  const isAssistant = message.role === 'assistant'

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      /* The clipboard can be refused. Never claim a copy that did not happen. */
    }
  }

  return (
    <div className={clsx('flex group', isAssistant ? 'justify-start' : 'justify-end')}>
      <div
        /*
         * The answer is not a chat bubble.
         *
         * It used to be a filled grey container inset to 85% of the pane, and
         * both halves of that were wrong. The fill made a long reply read as
         * a dense block rather than as something written to be read, and the
         * inset spent the pane's scarcest dimension on an empty gutter.
         *
         * So the assistant's turn sits on the pane's own surface at full
         * width, like a document. The reader's turn keeps the filled bubble,
         * which is what still makes the alternation legible: one voice is
         * boxed and right-aligned, the other is the page.
         */
        className={clsx(
          'relative',
          isAssistant
            ? clsx(layout.assistantTurn, 'text-gray-900 dark:text-gray-100')
            : clsx(layout.userBubble, 'rounded-lg px-4 py-3 bg-primary-600 text-white'),
        )}
        data-turn={isAssistant ? 'assistant' : 'user'}
      >
        {isAssistant ? (
          <AiProse content={message.content} onTickerClick={onTickerClick} />
        ) : (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        )}

        {/*
          ONE evidence section, not two.

          This replaced a research trail plus a separate citations list. The
          same record could appear in both, under two headings, and a reader
          could not tell whether that was one record or two. `AiEvidence`
          deduplicates by record identity and marks each one quoted or
          consulted, so the distinction that justified two sections survives
          without them.
        */}
        {isAssistant && (
          <AiEvidence
            toolCalls={message.tool_calls}
            citations={message.citations}
            defaultOpen={showEvidenceOpen}
            onOpenSource={onOpenSource}
          />
        )}

        {isAssistant && footer}

        <div className="flex items-center justify-between gap-2 mt-2">
          <div className="flex items-center gap-2 min-w-0">
            <p
              className={clsx(
                'text-[11px] shrink-0 tabular-nums',
                isAssistant ? 'text-gray-500 dark:text-gray-400' : 'text-primary-200',
              )}
            >
              {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            {isAssistant && modelLabel && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-gray-200 dark:bg-gray-700
                           text-gray-600 dark:text-gray-300 truncate"
                title={message.model || undefined}
              >
                {modelLabel}
              </span>
            )}
            {isAssistant && message.truncated && (
              <span
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 dark:bg-amber-900/30
                           text-amber-800 dark:text-amber-300 shrink-0"
                title="The connection ended before the answer finished."
              >
                Incomplete
              </span>
            )}
          </div>
          {isAssistant && !message.streaming && (
            <div className={clsx(
              'flex items-center gap-1 shrink-0',
              /* The whole group appears on hover, as Copy always has: a row
                 of controls under every answer is a row of chrome between
                 the reader and the next paragraph. */
              'opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity',
            )}>
              {metaActions}
            <button
              type="button"
              onClick={handleCopy}
              className={clsx(
                'inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded shrink-0',
                'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200',
                'hover:bg-gray-200 dark:hover:bg-gray-700',
              )}
              title="Copy response"
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
