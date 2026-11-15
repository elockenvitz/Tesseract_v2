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
import type { AiSourceKind, AiVisibilityScope, MessageToolCall } from './presentation'

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
  /* Not "Recommendation": an idea in the pipeline has not been submitted to
     anybody. Labelling it as one would be the exact merge the decision chain
     exists to prevent, one step earlier. */
  idea: 'Idea',
})

/**
 * The short, human name for one reference: "AAPL · Thesis".
 *
 * ── What it is for ───────────────────────────────────────────────────────
 *
 * A cited row led with an uppercase kind chip and then the record's own
 * title, which for a thesis contribution or a requirement is a sentence. On
 * a research answer with six sources that is six lines of record headings
 * competing with the analysis above them, and the thing a reader actually
 * scans for -- which company, what kind of document -- was the smallest part
 * of the row.
 *
 * So the ticker and the kind lead, as one label. The record's own title is
 * NOT dropped: it still identifies which thesis, which ruling, which note,
 * and provenance is the whole point of the evidence section. It follows,
 * clamped to a line.
 *
 * Falls back to the kind alone where there is no symbol -- a portfolio or a
 * theme has none, and "· Portfolio" with an empty left half reads as a bug.
 */
export function referenceLabel(
  source: { kind?: string | null; symbol?: string | null },
): string {
  const kind = SOURCE_KIND_LABEL[(source.kind ?? '') as AiSourceKind] ?? source.kind ?? 'Record'
  const symbol = (source.symbol ?? '').trim().toUpperCase()
  return symbol ? `${symbol} · ${kind}` : kind
}

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

  /* The cross-asset lookups. Each says WHOSE records it read, because that is
     the part a reader needs in order to judge the answer: "your pipeline" and
     "the desk's pipeline" are different questions with different answers. */
  if (name === 'get_watchlists') {
    const q = String(input.name || '')
    return q ? `Read your lists matching "${q}"` : 'Read your lists'
  }
  if (name === 'get_coverage') {
    const org = input.scope === 'organization'
    if (sym) return org ? `Checked who covers ${sym}` : `Checked your coverage of ${sym}`
    return org ? "Read the desk's coverage" : 'Read your coverage'
  }
  if (name === 'get_idea_pipeline') {
    const whose = input.scope === 'organization' ? "the desk's" : 'your'
    const stage = typeof input.stage === 'string' ? input.stage.replace(/_/g, ' ') : ''
    return stage ? `Read ${whose} ideas at ${stage}` : `Read ${whose} Idea Pipeline`
  }
  if (name === 'get_pending_decisions') {
    return sym ? `Checked open recommendations on ${sym}` : 'Checked what is awaiting a ruling'
  }
  if (name === 'get_outstanding_work') {
    return input.overdue_only === true ? 'Checked what is overdue' : 'Checked outstanding research work'
  }

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
      text: emptySentence(tc.searched, tc.scope),
      tone: 'text-amber-700 dark:text-amber-500',
    }
  }
  if (tc.status === 'ok') {
    return {
      text: n > 0 ? foundSentence(n, tc.scope) : 'Found, with nothing linked to it.',
      tone: 'text-gray-500 dark:text-gray-400',
    }
  }
  /* A message produced before statuses existed. Say nothing rather than
     invent an outcome for it. */
  return { text: '', tone: '' }
}

/**
 * "Nothing", said only as far as the lookup could see.
 *
 * ── The bug this closes ──────────────────────────────────────────────────
 *
 * This read `No matching records.` for every empty result, whatever the
 * lookup's reach. On a permission-scoped path that is a claim the panel
 * cannot support: the retrieval tools already declare a `visibility.scope`
 * and the model is instructed never to turn an RLS-filtered zero into "the
 * firm has none" -- and then the trail said it anyway, in its own voice,
 * right underneath the model's careful sentence.
 *
 * So only `organization` may speak for the firm. `caller_visible` and
 * `caller` speak for the reader. A missing scope -- an older message, or a
 * tool the client has not learned -- speaks only about MATCHES, which is the
 * weakest true thing available.
 */
export function emptySentence(
  searched: string | undefined,
  scope: AiVisibilityScope | undefined,
): string {
  const on = searched ? ` for ${searched}` : ''
  if (scope === 'organization') return `No records${on} in your organization.`
  if (scope === 'caller') return `None of yours${on}.`
  if (scope === 'caller_visible') return `Nothing${on} that you have access to.`
  /* No declaration. Say what was looked for and stop. */
  return searched ? `No matches for ${searched}.` : 'No matching records.'
}

/**
 * A count, with whose records it counted.
 *
 * The partial-answer case is the more dangerous one and the easier to miss:
 * on 2026-11-11 the database held 84 open decision requests and this reader
 * could see a fraction, so a bare "18 records found." reads as the whole
 * desk. The scope is what makes the number honest.
 */
export function foundSentence(n: number, scope: AiVisibilityScope | undefined): string {
  const records = `${n} ${n === 1 ? 'record' : 'records'}`
  if (scope === 'organization') return `${records} in your organization.`
  if (scope === 'caller') return `${records} of yours.`
  if (scope === 'caller_visible') return `${records} you have access to.`
  return `${records} found.`
}

/**
 * A record's own state, as a short label beside it.
 *
 * Passed through rather than mapped: the server sends product words, and a
 * second translation table here is a second place for "awaiting ruling" to
 * drift into "pending". Only the shape is enforced, so a raw enum value
 * (`ready_to_recommend`) reads as words.
 */
export function sourceStateLabel(state: string | null | undefined): string | null {
  if (!state) return null
  const flat = state.replace(/_/g, ' ').trim()
  if (!flat) return null
  return flat.charAt(0).toUpperCase() + flat.slice(1)
}

/**
 * How old a record is, where that is old enough to matter.
 *
 * ── Why an age and not just a date ────────────────────────────────────────
 *
 * Every source already rendered its date, in the lightest grey on the row.
 * That is provenance, and it is nearly useless for the question a reader
 * actually has: a thesis dated "12 Mar 2026" and one dated "9 Nov 2026" look
 * identical while scanning, and only one of them should be leaned on. An
 * answer built on an eight-month-old thesis is not wrong, but a reader has to
 * KNOW that to weigh it.
 *
 * ── What it will not do ───────────────────────────────────────────────────
 *
 * It does not call anything stale, out of date or unreliable. Those are
 * judgments about a specific record in a specific context, and this layer has
 * no standing to make one: a thesis on a slow compounder can be two years old
 * and current, and a note on a company mid-takeover is stale in a week. So it
 * states the age and stops.
 *
 * It also returns nothing for a FUTURE timestamp. A record dated ahead of now
 * is a data defect, and "in 3 months old" is worse than silence.
 */
export const RECORD_AGE_NOTE_DAYS = 90

export function recordAge(
  timestamp: string | null | undefined,
  now: Date = new Date(),
): { days: number; label: string } | null {
  if (!timestamp) return null
  const then = new Date(timestamp)
  if (Number.isNaN(then.getTime())) return null

  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  /* Future-dated, or new enough that the date alone says it. */
  if (days < RECORD_AGE_NOTE_DAYS) return null

  const months = Math.floor(days / 30)
  if (months < 12) return { days, label: `${months} months old` }
  const years = Math.floor(days / 365)
  const rem = Math.floor((days - years * 365) / 30)
  if (rem === 0) return { days, label: years === 1 ? '1 year old' : `${years} years old` }
  return { days, label: `${years}y ${rem}m old` }
}

/** The left rule beside a lookup, coloured by how it went. */
export function trailBorderFor(status?: string): string {
  return status === 'error' ? 'border-red-300 dark:border-red-700'
    : status === 'empty' ? 'border-amber-300 dark:border-amber-700'
    : 'border-emerald-300 dark:border-emerald-700'
}
