/**
 * What a briefing is FOR, decided before anything is asked.
 *
 * ── The two contexts, and why only two ──────────────────────────────────
 *
 * A reader opens an asset in one of two situations that change what they
 * need. Either something is waiting on a human decision, or it is not. In the
 * first case the reader is preparing to rule on a specific recommendation and
 * needs the case for and against it assembled; in the second they are
 * reviewing a name and need to know what has moved and what is missing.
 *
 * Those are genuinely different asks, and no third one has a different answer.
 * More contexts would be more branches producing the same briefing in
 * different words, which is how a feature starts asserting a distinction its
 * output does not actually have.
 *
 * ── Where the facts come from ────────────────────────────────────────────
 *
 * Not from here. The workspace state and the signals are already resolved by
 * `lib/asset-workspace/context` and already on screen in the attention band,
 * served from the same cached hooks. This module is handed them.
 *
 * That sharing is the point rather than a convenience. A briefing that
 * re-derived its own view of the asset would eventually contradict the band
 * two inches above it, and a reader cannot be expected to adjudicate between
 * two parts of one screen. One resolver, two presentations.
 *
 * ── Why the signals go into the question ─────────────────────────────────
 *
 * The briefing is asked about the specific things the page is already
 * flagging, by name. Not "tell me about AAPL": a general request produces a
 * general answer, and the reader can already see the general picture. Naming
 * the signals also binds the answer to records that exist, which is the same
 * rule the suggested questions follow.
 */
import type { WorkspaceSignal, WorkspaceState } from '../asset-workspace/context'

/**
 * The two situations.
 *
 * `decision` is narrower and more urgent, so it wins whenever it applies.
 */
export type BriefingContext = 'decision' | 'review'

/** The heading each context carries, in the product's own words. */
export const BRIEFING_TITLE: Record<BriefingContext, string> = {
  decision: 'Decision preparation',
  review: 'Asset review',
}

/**
 * One line saying what the briefing is about to do, shown before it runs.
 *
 * The reader presses a button that costs them several seconds and a model
 * call, so they are told what they are buying first.
 */
export const BRIEFING_INTENT: Record<BriefingContext, string> = {
  decision: 'Assemble the case for and against the decision waiting here.',
  review: 'What has moved on this name, and what is missing from the case.',
}

/**
 * Which context a workspace state puts the reader in.
 *
 * Total over the state union by construction, so a new state cannot silently
 * fall through to a default that happens to be wrong.
 */
export function briefingContextFor(state: WorkspaceState): BriefingContext {
  return state === 'decision-pending' ? 'decision' : 'review'
}

export interface BriefingRequestInput {
  context: BriefingContext
  symbol: string | null
  state: WorkspaceState
  /** Already resolved, already ranked, already on screen. */
  signals: readonly WorkspaceSignal[]
}

/**
 * How many signals go into the question.
 *
 * The resolver sorts by weight, so these are the ones the band is already
 * showing. Past three, a briefing stops being about anything in particular.
 */
export const SIGNALS_IN_BRIEFING = 3

/**
 * The question, as the model receives it.
 *
 * Written as an instruction about THIS asset and THESE signals. It does not
 * repeat the presentation rules: those live in the system prompt, so a
 * briefing and a chat reply are written to the same contract, which is what
 * makes them render through the same components.
 */
export function briefingQuestion(input: BriefingRequestInput): string {
  const name = input.symbol ?? 'this asset'
  const flagged = input.signals.slice(0, SIGNALS_IN_BRIEFING)

  const lines: string[] = []

  if (input.context === 'decision') {
    lines.push(
      `A decision on ${name} is waiting on someone. Prepare the reader to rule on it.`,
      'Assemble what the firm already holds: the recommendation and what it proposes, the written case behind it, the position and exposure that would change, and the strongest argument against acting.',
      'Say explicitly what is NOT on record that a ruling would normally rest on.',
    )
  } else {
    lines.push(
      `Review ${name} for the reader.`,
      'Cover what has changed since the case was last written, what the written case says now, and what is missing from it.',
      'If nothing material has changed, say so in one line rather than finding something to report.',
    )
  }

  if (flagged.length > 0) {
    lines.push(
      '',
      'This page is already flagging the following, so address these specifically rather than in general:',
    )
    for (const s of flagged) lines.push(`- ${s.headline}`)
  } else {
    /*
     * No signals is a real answer and worth stating. Without this the model
     * fills the silence, which on a quiet name produces a briefing that
     * manufactures concern in order to have something to say.
     */
    lines.push(
      '',
      'This page is flagging nothing: no decision is waiting, nothing is stale and nothing is missing that the records can show. If that is the whole answer, that is the answer.',
    )
  }

  lines.push(
    '',
    'Use the research tools to read what the firm holds. Do not answer from general knowledge about the company.',
  )

  return lines.join('\n')
}

/**
 * The cache identity of a briefing.
 *
 * Keyed on the asset AND on the signals, not on the asset alone. The signals
 * are what the briefing is about, so a briefing written before a
 * recommendation arrived is a different briefing from one written after, and
 * serving the stale one would describe a page the reader is no longer looking
 * at.
 *
 * Keyed on the signal IDS rather than a hash of their text: the ids are
 * stable and content-derived, while a headline carries counts and dates that
 * change without changing what the briefing is about.
 */
export function briefingKey(input: {
  assetId: string
  context: BriefingContext
  signals: readonly WorkspaceSignal[]
}): readonly unknown[] {
  return [
    'ai-asset-briefing',
    input.assetId,
    input.context,
    input.signals.slice(0, SIGNALS_IN_BRIEFING).map(s => s.id).join('|'),
  ] as const
}

/**
 * The opening message when the reader carries a briefing into the chat pane.
 *
 * ── Why the question and not the answer ──────────────────────────────────
 *
 * Continuity here means the pane picks up where the briefing left off. Two
 * ways to do that, and only one is honest: hand the pane the QUESTION the
 * briefing answered, so it researches afresh under the same framing, or paste
 * the briefing's prose in as if the reader had typed it.
 *
 * The second is worse than it looks. The pane would be reasoning about text
 * attributed to the reader, the evidence trail behind it would be gone, and a
 * figure the briefing sourced from a record would arrive as an unsourced
 * assertion the model then builds on. So: the framing carries, the prose does
 * not, and the reader keeps the briefing on screen to read alongside.
 */
export function briefingHandoffDraft(input: BriefingRequestInput): string {
  const name = input.symbol ?? 'this asset'
  return input.context === 'decision'
    ? `I am about to rule on the decision waiting on ${name}. What should I be asking that the briefing did not cover?`
    : `Following up on the ${name} review: what would change the case, and what should I check first?`
}
