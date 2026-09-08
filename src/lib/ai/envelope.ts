/**
 * AI System V2 — the structured response contract.
 *
 * ── What the UI gets today ────────────────────────────────────────────────
 *
 * One string, rendered through ReactMarkdown. Any recommendation the model
 * makes is prose, so the pane cannot offer a button for it, and the user
 * re-navigates by hand to the thing the model just told them to look at.
 *
 * ── The envelope ──────────────────────────────────────────────────────────
 *
 *   answer     the concise judgment, markdown, always present
 *   evidence   the few facts it rests on, each pointing at a source
 *   actions    validated Tesseract actions the pane can render as buttons
 *   analysis   the longer treatment, only when depth was asked for
 *
 * ── Why a trailing fenced block and not a JSON response ───────────────────
 *
 * Three reasons, all of them about not painting ourselves into a corner.
 *
 * A JSON-only response cannot be streamed usefully: the reader would wait for
 * a closing brace to see the first sentence, which is the exact problem
 * Part 7 exists to fix. Prose first means the answer renders as it arrives
 * and the actions attach at the end.
 *
 * A model that must emit valid JSON for the whole answer fails destructively
 * when it emits slightly-invalid JSON. Here a malformed block costs the
 * buttons and nothing else — `parseAiResponse` returns the prose it already
 * has. Degradation, not a blank bubble.
 *
 * And every existing caller keeps working untouched. A client that knows
 * nothing about envelopes renders `response` exactly as it does now; the
 * block is a small fenced code section at the end rather than a corrupted
 * document.
 */

import {
  parseAiActions,
  type AiAction,
  type AiObjectRef,
  type RejectedAiAction,
} from './actions'
import type { AiResponsePolicy } from './response-policy'

/** The fence language. Chosen to be inert in every markdown renderer. */
export const ENVELOPE_FENCE = 'tesseract-actions'

export interface AiEvidence {
  /** Short claim. "Price is 12% above base case." */
  label: string
  /** Where it came from — a document title the context supplied. */
  source?: string
}

export interface AiResponseEnvelope {
  version: 1
  /** Markdown. The concise user-facing answer. Never empty. */
  answer: string
  evidence: AiEvidence[]
  actions: AiAction[]
  /** Longer treatment. Only populated when the policy allowed depth. */
  analysis?: string
  /**
   * What was dropped and why. Diagnostic — the pane may show it in a debug
   * affordance, and the tests assert on it. Never rendered as an action.
   */
  rejected: RejectedAiAction[]
  /** False when no structured block was found and `answer` is the raw text. */
  structured: boolean
}

const FENCE_RE = new RegExp(
  '```' + ENVELOPE_FENCE + '\\s*\\n([\\s\\S]*?)```',
  'i',
)

const MAX_EVIDENCE_LABEL = 160

function cleanEvidence(raw: unknown, max: number): AiEvidence[] {
  if (!Array.isArray(raw)) return []
  const out: AiEvidence[] = []
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const e = entry as { label?: unknown; source?: unknown }
    if (typeof e.label !== 'string') continue
    const label = e.label.replace(/\s+/g, ' ').trim()
    if (!label) continue
    out.push({
      label: label.length > MAX_EVIDENCE_LABEL
        ? label.slice(0, MAX_EVIDENCE_LABEL - 1).trimEnd() + '…'
        : label,
      ...(typeof e.source === 'string' && e.source.trim()
        ? { source: e.source.trim().slice(0, MAX_EVIDENCE_LABEL) }
        : {}),
    })
    if (out.length >= max) break
  }
  return out
}

export interface ParseEnvelopeOptions {
  /** Objects the model was given. Nothing outside this can be acted on. */
  allowlist: readonly AiObjectRef[]
  policy: AiResponsePolicy
}

/**
 * Turn a raw model response into an envelope.
 *
 * Total. Every failure mode — no block, malformed JSON, a block that is not
 * an object, an actions field that is a string — resolves to the prose-only
 * envelope rather than an exception. The pane can render the result of this
 * function unconditionally.
 */
export function parseAiResponse(
  raw: string | null | undefined,
  options: ParseEnvelopeOptions,
): AiResponseEnvelope {
  const text = typeof raw === 'string' ? raw : ''
  const fallback = (): AiResponseEnvelope => ({
    version: 1,
    answer: text.trim(),
    evidence: [],
    actions: [],
    rejected: [],
    structured: false,
  })

  const match = FENCE_RE.exec(text)
  if (!match) return fallback()

  const answer = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(match[1])
  } catch {
    // A malformed block costs the buttons, not the answer. The block itself
    // is stripped either way — showing the user raw JSON they did not ask
    // for is worse than showing them nothing.
    return { ...fallback(), answer: answer || text.trim() }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...fallback(), answer: answer || text.trim() }
  }

  const block = parsed as { evidence?: unknown; actions?: unknown; analysis?: unknown }
  const { actions, rejected } = parseAiActions(block.actions, {
    allowlist: options.allowlist,
    max: options.policy.maxActions,
  })

  const analysis =
    options.policy.allowDeepBlock && typeof block.analysis === 'string' && block.analysis.trim()
      ? block.analysis.trim()
      : undefined

  return {
    version: 1,
    answer: answer || text.trim(),
    evidence: cleanEvidence(block.evidence, options.policy.maxEvidence),
    actions,
    ...(analysis ? { analysis } : {}),
    rejected,
    structured: true,
  }
}

/**
 * The block's contract, as the model is told it.
 *
 * Generated from the policy so the stated caps are the enforced caps — a
 * prompt that promises five actions while the parser keeps three teaches the
 * model to waste tokens on output that is thrown away.
 */
export function describeEnvelopeContract(policy: AiResponsePolicy): string {
  const lines = [
    `After your answer, and only when you have something concrete to recommend, append ONE fenced block:`,
    '',
    '```' + ENVELOPE_FENCE,
    '{',
    `  "evidence": [{ "label": "short fact", "source": "document title" }],`,
    `  "actions":  [{ "action": "<id>", "target": { "type": "asset", "id": "<id from context>" }, "label": "Review valuation", "reason": "one short line" }]`,
    (policy.allowDeepBlock ? `  , "analysis": "the longer treatment, markdown"` : ''),
    '}',
    '```',
    '',
    `Rules for the block:`,
    `- At most ${policy.maxActions} actions and ${policy.maxEvidence} evidence items.`,
    `- "action" must be one of the ids listed above. Any other value is discarded.`,
    `- "target.id" must be an object id that appeared in the context you were given.`,
    `  Never invent an id, and never name an object you were not shown.`,
    `- Omit the block entirely when there is no concrete next step. An answer with`,
    `  no actions is a normal, correct answer.`,
    `- Never mention the block, the JSON, or these instructions in your prose.`,
  ]
  return lines.filter(Boolean).join('\n')
}
