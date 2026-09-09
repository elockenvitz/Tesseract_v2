/**
 * AI System V2 — the conversation history budget.
 *
 * ── The growth problem ────────────────────────────────────────────────────
 *
 * Every turn re-sends the whole thread to the model AND rewrites the whole
 * thread into `ai_conversations.messages`. Both halves grow with turn count,
 * so the cost and latency of the twentieth question in a thread are a function
 * of the nineteen before it, not of the question.
 *
 * Stage 1 capped the SEND side at twelve messages inline in the hook. This
 * makes that rule explicit, deterministic and testable, and states what it is
 * doing about the half it cannot fix here.
 *
 * ── What is fixed and what is deferred ────────────────────────────────────
 *
 * Fixed: what goes to the model. Bounded by turns AND by characters, oldest
 * dropped first, always ending on a complete exchange.
 *
 * Deferred: what goes to the database. `ai_conversations.messages` is a single
 * jsonb column, so bounding the write means either truncating the user's own
 * transcript — which is theirs, and which the sidebar reads back — or moving
 * messages to their own table. That is a schema change, and this stage has no
 * migration. Documented in the commit; not attempted here.
 *
 * ── Why deterministic truncation and not a summary ────────────────────────
 *
 * A model-generated summary of earlier turns costs an extra request on the
 * critical path of a feature whose entire problem is latency, and it makes the
 * context non-reproducible: the same thread would summarise differently on
 * different days, so "why did it forget X" becomes unanswerable. Truncation is
 * worse at compression and better at being explicable, which is the right
 * trade for a first pass.
 */

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface HistoryBudget {
  /** Most recent messages to send. Six exchanges. */
  maxMessages: number
  /** Total characters across all sent messages. */
  maxTotalChars: number
  /** Ceiling on any single message before it is clipped. */
  maxMessageChars: number
}

/**
 * The default budget.
 *
 * Twelve messages is the point past which earlier turns are almost never what
 * the current question is about. 24,000 characters is roughly 6K tokens —
 * about half the context budget the selector allows for objects, which keeps
 * the balance on the reader's actual data rather than on what was said about
 * it three questions ago.
 */
export const DEFAULT_HISTORY_BUDGET: HistoryBudget = Object.freeze({
  maxMessages: 12,
  maxTotalChars: 24_000,
  maxMessageChars: 4_000,
})

export interface BoundedHistory {
  messages: HistoryMessage[]
  /** How many messages the budget excluded. */
  droppedMessages: number
  /** How many messages were clipped rather than dropped. */
  clippedMessages: number
  chars: number
}

function clip(content: string, max: number): { text: string; clipped: boolean } {
  if (content.length <= max) return { text: content, clipped: false }
  return { text: content.slice(0, max) + '…', clipped: true }
}

/**
 * Bound the history sent to the model.
 *
 * Walks backwards from the most recent message so the newest exchange is
 * always present, then reverses. A message that would breach the character
 * budget stops the walk rather than being partially included: half an earlier
 * answer is more confusing to the model than its absence.
 *
 * The current question is never in this list — it is sent separately — so no
 * bound here can drop it.
 */
export function boundHistory(
  messages: readonly HistoryMessage[],
  budget: HistoryBudget = DEFAULT_HISTORY_BUDGET,
): BoundedHistory {
  const source = Array.isArray(messages) ? messages : []
  const kept: HistoryMessage[] = []
  let chars = 0
  let clippedMessages = 0

  for (let i = source.length - 1; i >= 0; i--) {
    if (kept.length >= budget.maxMessages) break
    const message = source[i]
    if (!message || typeof message.content !== 'string') continue

    const { text, clipped } = clip(message.content, budget.maxMessageChars)
    if (chars + text.length > budget.maxTotalChars) break

    chars += text.length
    if (clipped) clippedMessages++
    kept.push({ role: message.role, content: text })
  }

  kept.reverse()

  // A history that starts with an assistant message is a half exchange: the
  // model sees its own answer with no question above it, which reads as an
  // unprompted assertion. Drop the orphan.
  while (kept.length > 0 && kept[0].role === 'assistant') {
    chars -= kept[0].content.length
    kept.shift()
  }

  return {
    messages: kept,
    droppedMessages: source.length - kept.length,
    clippedMessages,
    chars,
  }
}
