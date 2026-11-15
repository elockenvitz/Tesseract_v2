/**
 * What a briefing is FOR, decided before anything is asked.
 *
 * ── The three contexts, and why exactly three ───────────────────────────
 *
 * This module argued for two: something is waiting on a human decision, or it
 * is not. That was right about the two situations the WORKSPACE STATE can
 * tell apart, and it was reasoning from the wrong input -- the state is a
 * fact about the asset, and what a briefing is for depends on why the reader
 * is here.
 *
 * The third situation is a reader who arrived on a recorded piece of work: a
 * requirement they were assigned, a process run somebody asked them to
 * advance. Their question is not "what has moved on this name" and not "is
 * this recommendation sound". It is "what is still owed here, what do we
 * already have, and what does the recorded process say is next" -- which has
 * a different answer, drawn from different records, and is the test this
 * module's own rule set: a context earns its place when the briefing it asks
 * for is not the same briefing in different words.
 *
 * `briefingContextFor` still derives from the state, for every surface that
 * has no entry reason to offer. `briefingContextForEntry` is how a surface
 * that knows WHY the reader came says so.
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
import type { WorkspaceEntryMode } from '../asset-workspace/entry'

/**
 * The three situations.
 *
 * `decision` is narrowest and most urgent, so it wins whenever it applies.
 */
export type BriefingContext = 'decision' | 'work' | 'review'

/** The heading each context carries, in the product's own words. */
export const BRIEFING_TITLE: Record<BriefingContext, string> = {
  decision: 'Decision preparation',
  work: 'Research support',
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
  work: 'What this process still needs, and what the firm already holds.',
  review: 'What has moved on this name, and what is missing from the case.',
}

/**
 * Which context a workspace state puts the reader in.
 *
 * Total over the state union by construction, so a new state cannot silently
 * fall through to a default that happens to be wrong.
 *
 * Never returns `work`: no state means "the reader came here to advance a
 * process". A state is a fact about the asset, and work owed on it does not
 * tell you the reader followed a requirement to get here. Only the entry
 * reason knows that, which is what `briefingContextForEntry` is for.
 */
export function briefingContextFor(state: WorkspaceState): BriefingContext {
  return state === 'decision-pending' ? 'decision' : 'review'
}

/**
 * The context when the surface knows why the reader came.
 *
 * The entry reason outranks the state, in the same way and for the same
 * reason that `resolveLanding` lets an explicit arrival outrank anything the
 * resolver infers: the reader's last action is better evidence of what they
 * want than a property of the record.
 *
 * A general entry falls back to the state, so a reader who opened a name with
 * a decision waiting on it still gets decision preparation.
 */
export function briefingContextForEntry(
  mode: WorkspaceEntryMode,
  state: WorkspaceState,
): BriefingContext {
  if (mode === 'decision') return 'decision'
  if (mode === 'work') return 'work'
  return briefingContextFor(state)
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
  } else if (input.context === 'work') {
    /*
     * The work briefing asks what is OUTSTANDING and what already exists,
     * and nothing about whether the process is going well. A model asked to
     * assess progress invents a judgement about work it cannot see; a model
     * asked what the records say is owed can only answer from them.
     */
    lines.push(
      `The reader is here to advance recorded work on ${name}.`,
      'Say what the firm already holds that bears on it: the written case, the research on record, and the figures. Then say what the records show is still outstanding.',
      'Do not assess whether the work is going well, and do not propose a next step the recorded process does not already imply.',
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
  if (input.context === 'decision') {
    return `I am about to rule on the decision waiting on ${name}. What should I be asking that the briefing did not cover?`
  }
  if (input.context === 'work') {
    return `I am working through the open requirements on ${name}. What do we already hold that bears on them, and what is missing?`
  }
  return `Following up on the ${name} review: what would change the case, and what should I check first?`
}

/**
 * The question the workspace's own "Ask ACT AI" action puts in the composer.
 *
 * Distinct from `briefingHandoffDraft`, which follows a briefing the reader
 * has already read. This is the cold start: the reader has not run a briefing
 * and is asking from the action area, so the draft has to carry the framing
 * the briefing would otherwise have established.
 *
 * Placed in the composer and never sent -- the pane's rule, not this
 * module's. The reader edits or discards it.
 */
export function workspaceAskDraft(context: BriefingContext, symbol: string | null): string {
  const name = symbol ?? 'this asset'
  if (context === 'decision') {
    return `A decision on ${name} is waiting. What evidence do we hold that supports it, what argues against it, and what is missing that a ruling would normally rest on?`
  }
  if (context === 'work') {
    return `What do we already hold on ${name} that bears on the open requirements, and what is still missing?`
  }
  return `What is our current view of ${name}, what has changed since the case was last written, and what is missing from it?`
}
