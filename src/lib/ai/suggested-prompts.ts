/**
 * The questions offered on an empty thread, derived from what is actually
 * bound to it.
 *
 * ── Why this moved out of useAI ──────────────────────────────────────────
 *
 * `useAISuggestions` lived in `hooks/useAI.ts`, a module that builds a
 * Supabase client at import time, so the only way to test the strings was to
 * stand up auth. It is a pure function of the tag set and the engagement
 * target; it is now in `lib` where a test can read it, and the hook delegates.
 *
 * ── The rule these follow ────────────────────────────────────────────────
 *
 * A suggestion may name only something the caller gave us. The previous
 * version fell back to the tag's TYPE when no label had resolved yet, which
 * produced "Analyze asset's thesis for blind spots" on first paint — a
 * sentence about a company called "asset". Where the name is unknown the
 * prompt is written without one.
 *
 * Nor does a suggestion assert that a record exists. "What has the team
 * decided about AAPL?" is answerable with "nothing recorded"; "Summarise the
 * three open requirements" is not, and would have the panel inventing the
 * firm's work before the model has looked anything up.
 */
import type { AiChatMode } from './chat-modes'

/** A tag on the conversation: what the thread is bound to. */
export interface PromptTag {
  type: string
  id: string
}

/**
 * The engagement target's fields this cares about. A structural subset of
 * `EngagementTarget` rather than the type itself, so `lib/ai` does not take a
 * dependency on the engagement seam for four optional strings.
 */
export interface PromptTarget {
  symbol?: string | null
  portfolioName?: string | null
  issue?: { title?: string | null } | null
}

export interface PromptContext {
  tags?: readonly PromptTag[] | null
  /** `${type}:${id}` → display name. Missing entries mean "name not known yet". */
  tagLabels?: Record<string, string> | null
  /** Why the reader is here, when the pane was opened from a surface. */
  target?: PromptTarget | null
  /** Research mode has room for more of them. */
  mode?: AiChatMode
}

/** How many fit before they stop being scannable. */
const LIMIT: Record<AiChatMode, number> = { compact: 4, research: 6 }

const GENERIC = [
  'What sectors are showing momentum?',
  'Explain the current market environment',
  'What should I be watching this week?',
]

export function suggestedPrompts(ctx: PromptContext = {}): string[] {
  const tags = ctx.tags ?? []
  const labels = ctx.tagLabels ?? {}
  const limit = LIMIT[ctx.mode ?? 'compact']

  /** The name, or null. Never the tag type dressed up as a name. */
  const nameOf = (t: PromptTag): string | null => {
    const label = labels[`${t.type}:${t.id}`]
    return label && label.trim() ? label.trim() : null
  }

  const out: string[] = []
  const push = (s: string) => { if (!out.includes(s)) out.push(s) }

  /*
   * Why now, first.
   *
   * The surface that opened the pane found something; that finding is the most
   * specific context in the room, and it is quoted rather than paraphrased so
   * the question cannot drift from what was actually flagged.
   */
  const issue = ctx.target?.issue?.title?.trim()
  if (issue) push(`What does "${issue}" mean for the thesis?`)

  /*
   * Then exposure, while both halves are real.
   *
   * Ahead of the generic set rather than appended after it: a question that
   * names this ticker AND this portfolio is the most specific thing the pane
   * can ask, and on the rail only four prompts fit, so "specific but
   * truncated away" is the same as absent. A portfolio name without a ticker,
   * or the reverse, would produce "How does this affect exposure?", which the
   * model cannot ground.
   */
  const portfolio = ctx.target?.portfolioName?.trim()
  const symbol = ctx.target?.symbol?.trim()
  if (portfolio && symbol) push(`How does ${symbol} affect ${portfolio} exposure?`)

  if (tags.length === 1) {
    const t = tags[0]
    const name = nameOf(t)
    const subject = name ?? (t.type === 'portfolio' ? 'this portfolio' : t.type === 'theme' ? 'this theme' : 'this name')
    const possessive = name ? `${name}'s` : `this ${t.type === 'asset' ? 'name' : t.type}'s`

    if (t.type === 'asset') {
      push(`What has the team decided about ${subject}, and what evidence supports it?`)
      push(`Analyze ${possessive} thesis for blind spots`)
      push(`What research work is still open on ${subject}?`)
      push(`What are the key risks to the ${subject} thesis?`)
      push(`Suggest bull, base and bear outcomes for ${subject}`)
      push(`Summarize the team's notes on ${subject}`)
    } else if (t.type === 'theme') {
      push(`Which assets have the most exposure to ${subject}?`)
      push(`What are the key drivers of ${subject}?`)
      push(`What research work is still open across ${subject}?`)
      push(`Suggest assets to add to ${subject}`)
    } else if (t.type === 'portfolio') {
      push(`Analyze ${possessive} sector allocation`)
      push(`What are ${possessive} concentration risks?`)
      push(`What decisions are pending across ${subject}?`)
      push(`Suggest rebalancing actions for ${subject}`)
    } else {
      push(`Summarize what is recorded about ${subject}`)
      push(`What work remains on ${subject}?`)
    }
  } else if (tags.length > 1) {
    const named = tags.map(nameOf).filter((n): n is string => Boolean(n))
    const onlyAssets = tags.every(t => t.type === 'asset')

    /* Named every one of them, or none of them. A comparison that silently
       drops the member whose label had not arrived compares the wrong set. */
    if (named.length === tags.length) {
      const list = named.join(' vs ')
      if (onlyAssets) {
        push(`Compare ${list} side by side`)
        push(`Which has the strongest thesis: ${list}?`)
        push(`How do the risks differ across ${list}?`)
      }
      push(`Synthesize what ${named.join(', ')} have in common`)
      push(`Highlight the biggest risks across ${named.join(', ')}`)
    } else {
      push('Compare the names in this conversation side by side')
      push('Highlight the biggest risks across them')
    }
  }

  if (out.length === 0) return GENERIC.slice(0, limit)
  return out.slice(0, limit)
}
