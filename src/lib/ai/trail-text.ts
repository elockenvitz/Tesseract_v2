/**
 * The words the research trail uses.
 *
 * ── Why the words are a module of their own ──────────────────────────────
 *
 * They carry the rule, not the layout. `empty` and `error` are different
 * facts — "we looked and found none" versus "we could not look" — and they
 * must never render the same way, because conflating them is how a reader is
 * told the firm holds no research on a name when the query simply fell over.
 * That rule belongs somewhere a test can read it without a DOM, and somewhere
 * a second surface cannot quietly reword it.
 */
import type { AiSourceKind, MessageToolCall } from './presentation'

/**
 * One word per kind of record.
 *
 * The four decision kinds get four different words on purpose. Calling them
 * all "Decision" would undo in the label exactly what the retrieval tool
 * keeps apart: a recommendation is not a ruling, and a ruling is not a trade.
 */
export const SOURCE_KIND_LABEL: Readonly<Record<AiSourceKind, string>> = Object.freeze({
  asset: 'Asset',
  note: 'Note',
  contribution: 'Thesis',
  price_target: 'Target',
  portfolio: 'Portfolio',
  theme: 'Theme',
  recommendation: 'Recommendation',
  decision_request: 'PM ruling',
  accepted_trade: 'Committed trade',
  decision_review: 'Review',
  outcome: 'Outcome',
  workflow: 'Process',
  checklist_item: 'Requirement',
})

/** What a lookup was, in plain words. */
export function toolCallLabel(name: string, input: Record<string, unknown>): string {
  const sym = String(input.symbol || '').toUpperCase()
  if (name === 'get_asset')         return `Looked up ${sym}`
  if (name === 'search_assets')     return `Searched assets for "${String(input.query || '')}"`
  if (name === 'get_portfolio')     return `Pulled portfolio: ${String(input.name_or_id || '')}`
  if (name === 'get_theme')         return `Pulled theme: ${String(input.name_or_id || '')}`
  if (name === 'search_team_notes') return `Searched notes for "${String(input.query || '')}"`
  if (name === 'get_decisions')     return `Checked the decision record for ${sym}`
  if (name === 'get_workflows')     return `Checked open work on ${sym}`
  /* A tool the client has not learned about yet. The raw name is honest; an
     invented sentence would not be. */
  return name
}

/**
 * What came back, in one sentence, with a tone.
 *
 * This replaced printing `result_summary` — the tool's raw JSON cut to 160
 * characters — which showed a reader the literal text `{"results":[]}` for an
 * empty search and something equally cryptic for a failed one.
 */
export function toolCallOutcome(tc: MessageToolCall): { text: string; tone: string } {
  const n = tc.result_count ?? tc.sources?.length ?? 0
  if (tc.status === 'error') {
    return {
      text: 'This lookup failed, so the answer may be incomplete.',
      tone: 'text-red-600 dark:text-red-400',
    }
  }
  if (tc.status === 'empty') {
    return {
      text: tc.searched ? `No matches for ${tc.searched}.` : 'No matching records.',
      tone: 'text-amber-700 dark:text-amber-500',
    }
  }
  if (tc.status === 'ok') {
    return {
      text: n > 0 ? `${n} ${n === 1 ? 'record' : 'records'} found.` : 'Found, with nothing linked to it.',
      tone: 'text-gray-500 dark:text-gray-400',
    }
  }
  /* A message produced before statuses existed. Say nothing rather than
     invent an outcome for it. */
  return { text: '', tone: '' }
}

/** The left rule beside a lookup, coloured by how it went. */
export function trailBorderFor(status?: string): string {
  return status === 'error' ? 'border-red-300 dark:border-red-700'
    : status === 'empty' ? 'border-amber-300 dark:border-amber-700'
    : 'border-emerald-300 dark:border-emerald-700'
}
