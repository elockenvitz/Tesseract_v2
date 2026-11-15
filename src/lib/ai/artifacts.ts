/**
 * Keeping something ACT AI wrote.
 *
 * ── What an artifact is here, and what it is not ───────────────────────────
 *
 * An artifact is an answer the reader decided is worth keeping. It is not a
 * new kind of record: the answer is already durable, stored in the
 * conversation's own `messages` column, and inventing a second table to hold
 * a copy of it would create two versions of the same sentence with no rule
 * about which one is true.
 *
 * So promotion does not SAVE anything. It opens the canonical form for the
 * object the reader chose, with the text already in it, under their hands.
 * They edit it, they can change their mind, and the record is written by the
 * same component with the same validation, the same visibility choice and the
 * same server-side org stamping as a note typed from scratch.
 *
 * That is deliberate rather than cautious. A model's paragraph that becomes a
 * stored investment record without a person reading it is an audit trail that
 * says a human wrote something they never saw. The confirmation step below
 * says as much in the words the reader is shown.
 *
 * ── Provenance ────────────────────────────────────────────────────────────
 *
 * Every promotion carries a `sourceTitle` naming ACT AI and the conversation
 * it came from, which the quick-thought form writes to the record's own
 * `source_title` field. A promoted draft with no provenance is refused by the
 * prefill parser, not merely discouraged.
 *
 * Pure — no React, no Supabase. The dispatch itself is one call into
 * `lib/capture/prefill`.
 */
import type { CaptureOpenRequest, PrefilledIdeaType } from '../capture/prefill'
import type { AiRenderableMessage } from './presentation'

/** The kinds of object an answer can be promoted into. */
export type ArtifactPromotionId = 'thought' | 'research_idea' | 'thesis'

export interface ArtifactPromotionSpec {
  id: ArtifactPromotionId
  /** The quick-thought form's own `idea_type`. */
  ideaType: PrefilledIdeaType
  /** The menu row. */
  label: string
  /** One line under it: what the reader gets. */
  hint: string
}

/**
 * Three, because the quick-thought form has three kinds and they are the only
 * promotion targets with a working prefill path.
 *
 * A trade idea and a recommendation are deliberately absent. Both forms exist
 * and neither accepts initial content, so offering them here would open an
 * empty form after a dialog that promised a draft. They also both start work
 * that moves money, which is not something a reader should arrive at by
 * keeping a paragraph. The existing `create_trade_idea` and
 * `create_recommendation` actions still open those forms empty, which is
 * honest about what they do.
 */
export const ARTIFACT_PROMOTIONS: readonly ArtifactPromotionSpec[] = Object.freeze([
  {
    id: 'thought',
    ideaType: 'thought',
    label: 'Keep as a quick thought',
    hint: 'An observation to come back to.',
  },
  {
    id: 'research_idea',
    ideaType: 'research_idea',
    label: 'Keep as a research note',
    hint: 'A topic to work on, filed with the name.',
  },
  {
    id: 'thesis',
    ideaType: 'thesis',
    label: 'Keep as a thesis draft',
    hint: 'A starting point for the written case. Still a draft.',
  },
])

export function artifactPromotion(id: string): ArtifactPromotionSpec | undefined {
  return ARTIFACT_PROMOTIONS.find(p => p.id === id)
}

export type PromotionRefusal = 'streaming' | 'empty' | 'not_an_answer'

/**
 * Whether this turn can be kept at all.
 *
 * A streaming answer is refused because the reader has not seen the end of
 * it, and a half-written sentence promoted into a thesis draft is worse than
 * no draft. A user's own turn is refused because keeping your own words is
 * what the capture form is already for.
 */
export function promotable(
  message: Pick<AiRenderableMessage, 'role' | 'content' | 'streaming'>,
): { ok: true } | { ok: false; reason: PromotionRefusal } {
  if (message.role !== 'assistant') return { ok: false, reason: 'not_an_answer' }
  if (message.streaming) return { ok: false, reason: 'streaming' }
  if (!message.content || !message.content.trim()) return { ok: false, reason: 'empty' }
  return { ok: true }
}

export interface PromotionSubject {
  type: string
  id: string
  label?: string | null
}

export interface BuildPromotionInput {
  message: Pick<AiRenderableMessage, 'role' | 'content' | 'streaming' | 'truncated'>
  promotion: ArtifactPromotionSpec
  /** The thread's title, for provenance. */
  conversationTitle?: string | null
  /** What the pane was open on, when it was an asset. */
  subject?: PromotionSubject | null
}

/**
 * The capture request for a promotion, or null if the turn cannot be kept.
 *
 * The body is passed through unchanged. Nothing is prepended, summarised or
 * reformatted: the reader approved the words they were shown, and a draft
 * that differs from the answer it came from is a third version of the text.
 */
export function buildArtifactPromotion(input: BuildPromotionInput): CaptureOpenRequest | null {
  const check = promotable(input.message)
  if (!check.ok) return null

  const thread = (input.conversationTitle ?? '').replace(/\s+/g, ' ').trim()
  const sourceTitle = thread ? `ACT AI answer, ${thread}` : 'ACT AI answer'

  const asset = input.subject && input.subject.type === 'asset' && input.subject.id
    ? input.subject
    : null

  return {
    captureType: 'idea',
    ...(asset
      ? {
          contextType: 'asset',
          contextId: asset.id,
          ...(asset.label ? { contextTitle: asset.label } : {}),
        }
      : {}),
    prefill: {
      text: input.message.content,
      ideaType: input.promotion.ideaType,
      sourceTitle,
      ...(asset ? { assetId: asset.id } : {}),
    },
  }
}

export interface PromotionConfirmation {
  title: string
  /** Shown in order. The last line is the standing caveat. */
  lines: string[]
  confirmLabel: string
}

/**
 * What the reader is told before anything opens.
 *
 * The caveat is not negotiable copy: an AI-written paragraph is not an
 * investment decision and not an audit record, and the moment it enters the
 * research corpus is the moment to say so.
 */
export function promotionConfirmation(
  promotion: ArtifactPromotionSpec,
  options: { subjectLabel?: string | null; truncated?: boolean } = {},
): PromotionConfirmation {
  const lines: string[] = [
    `The answer opens in the ${promotion.id === 'thesis' ? 'thesis' : 'capture'} form with the text already in it. Nothing is saved until you save it.`,
  ]

  if (options.subjectLabel) {
    lines.push(`It will be filed against ${options.subjectLabel}.`)
  }

  if (options.truncated) {
    lines.push('This answer was cut short by a lost connection, so the draft ends mid thought.')
  }

  lines.push('ACT AI wrote it. It is a draft for you to check and edit, not a decision or an audit record.')

  return { title: promotion.label, lines, confirmLabel: 'Open the draft' }
}
