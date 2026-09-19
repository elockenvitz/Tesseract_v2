/**
 * AI System V2 — the response-size policy.
 *
 * ── The problem this fixes ────────────────────────────────────────────────
 *
 * Today the only instruction about length is "Be concise and actionable",
 * buried in a 1,600-character system prompt in the edge function, with
 * `max_tokens` set to 4096 for every request regardless of what was asked.
 * Four other call sites bolt their own length hints onto the message text
 * ("2-3 sentences max", "brief but comprehensive"), so there are five
 * different answers to "how long should this be" and none of them is
 * enforced.
 *
 * ── The rule ──────────────────────────────────────────────────────────────
 *
 * One function decides verbosity, from the message and the purpose, before
 * the request leaves the client. It is pure and deterministic: the same
 * message always resolves to the same policy, which is what makes it
 * testable and what stops length from being a property of the model's mood.
 *
 * Brief is the default. Depth is opt-in, and opting in is something the user
 * does in words — the model never decides to write an essay.
 *
 * ── Where this lives and why ──────────────────────────────────────────────
 *
 * Client-side, because that is where it can be unit-tested and changed
 * without a function deploy, and because `max_tokens` has to be decided
 * before the request is built anyway. The edge function owns the DIRECTIVE
 * TEXT for each verbosity — one place, keyed by the union below — and a guard
 * test asserts the two cannot drift apart.
 */

export type AiVerbosity = 'brief' | 'standard' | 'deep'

/** The non-chat callers. Each has a fixed shape that is not a conversation. */
export type AiPurpose = 'chat' | 'analysis' | 'column' | 'snippet'

export interface AiResponsePolicy {
  verbosity: AiVerbosity
  /** Hard cap handed to the provider. Not advisory. */
  maxOutputTokens: number
  /** Soft cap the directive states, and the pane can use to offer "expand". */
  targetAnswerChars: number
  /** How many evidence items the envelope may carry. */
  maxEvidence: number
  /** How many recommended actions the envelope may carry. */
  maxActions: number
  /** Whether the model may attach a longer `analysis` block. */
  allowDeepBlock: boolean
  /** Why this verbosity was chosen. Diagnostic; never shown to the model. */
  rationale: string
}

/**
 * Phrases that mean "I want the long version".
 *
 * Explicit only. "Why" and "how" are not on this list on purpose: those are
 * the most common ordinary questions, and treating them as depth requests is
 * how a concise assistant turns back into an essay generator.
 */
const DEEP_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bdeep[- ]?dive\b/i,
  /\bin (?:full|great|more) detail\b/i,
  /\bfull (?:analysis|write[- ]?up|breakdown|review)\b/i,
  /\bdetailed (?:analysis|write[- ]?up|breakdown|review|explanation)\b/i,
  /\bwrite (?:me )?(?:a|an) (?:memo|essay|report|write[- ]?up)\b/i,
  /\bcomprehensive\b/i,
  /\bthorough(?:ly)?\b/i,
  /\bwalk me through\b/i,
  /\bexplain (?:it )?(?:fully|at length)\b/i,
  /\blong[- ]form\b/i,
])

/**
 * Phrases that mean "even shorter than default".
 *
 * Separate from the default because a user who says "one line" has told you
 * something the default cannot express, and honouring it is most of what
 * makes an assistant feel like it is listening.
 */
const TERSE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bone[- ](?:line|sentence|word)\b/i,
  /\bin (?:a|one) (?:line|sentence|word)\b/i,
  /\b(?:just|only) (?:the )?(?:answer|number|verdict|call)\b/i,
  /\btl;?dr\b/i,
  /\bquick(?:ly)? (?:take|answer|read)\b/i,
  /\byes or no\b/i,
])

const POLICIES: Readonly<Record<AiVerbosity, Omit<AiResponsePolicy, 'rationale'>>> = Object.freeze({
  brief: {
    verbosity: 'brief',
    maxOutputTokens: 700,
    targetAnswerChars: 600,
    maxEvidence: 3,
    maxActions: 3,
    allowDeepBlock: false,
  },
  standard: {
    verbosity: 'standard',
    maxOutputTokens: 1200,
    targetAnswerChars: 1200,
    maxEvidence: 5,
    maxActions: 3,
    allowDeepBlock: false,
  },
  deep: {
    verbosity: 'deep',
    maxOutputTokens: 4096,
    targetAnswerChars: 1200,
    maxEvidence: 8,
    maxActions: 3,
    allowDeepBlock: true,
  },
})

/** Fixed policies for the callers that are not conversations. */
const PURPOSE_POLICIES: Readonly<Partial<Record<AiPurpose, AiVerbosity>>> = Object.freeze({
  snippet: 'brief',
  column: 'brief',
  analysis: 'standard',
})

export interface ResolvePolicyInput {
  message: string
  purpose?: AiPurpose
  /** A user-chosen override from the pane, when one exists. Always wins. */
  override?: AiVerbosity | null
}

/**
 * Decide how long the answer may be.
 *
 * Order: explicit override, then the fixed policy for a non-chat purpose,
 * then the message itself. Deterministic at every step — no clock, no
 * randomness, no model call.
 */
export function resolveResponsePolicy(input: ResolvePolicyInput): AiResponsePolicy {
  const { message, purpose = 'chat', override = null } = input

  if (override && POLICIES[override]) {
    return { ...POLICIES[override], rationale: `override:${override}` }
  }

  const fixed = PURPOSE_POLICIES[purpose]
  if (fixed) {
    return { ...POLICIES[fixed], rationale: `purpose:${purpose}` }
  }

  const text = typeof message === 'string' ? message : ''

  for (const pattern of TERSE_PATTERNS) {
    if (pattern.test(text)) {
      return {
        ...POLICIES.brief,
        maxOutputTokens: 300,
        targetAnswerChars: 240,
        maxEvidence: 2,
        rationale: 'terse-request',
      }
    }
  }

  for (const pattern of DEEP_PATTERNS) {
    if (pattern.test(text)) {
      return { ...POLICIES.deep, rationale: 'explicit-depth-request' }
    }
  }

  return { ...POLICIES.brief, rationale: 'default' }
}

/**
 * The shape every default answer should take.
 *
 * Judgment, then the evidence behind it, then what to do about it. Stated
 * here rather than in the edge function so the pane, the tests and the prompt
 * all read the same three words.
 */
export const ANSWER_SHAPE = Object.freeze(['judgment', 'evidence', 'actions'] as const)

/** Every verbosity, for the drift guard against the edge function. */
export const AI_VERBOSITIES: readonly AiVerbosity[] = Object.freeze(
  (Object.keys(POLICIES) as AiVerbosity[]).sort(),
)
