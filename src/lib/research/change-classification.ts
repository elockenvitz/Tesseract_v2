/**
 * Was a contribution write a CONTENT change, or only metadata?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * `asset_contributions` is one row per (author, asset, section), and several
 * write paths update that row without touching the prose: a visibility change
 * (`updateVisibility`), an attachment change (`saveSectionReferences`), a draft
 * save or discard. Every one of them lands in the same row, and the history
 * row it produces is typed by its SECTION — so the Evolution Timeline has been
 * counting "I made this section team-only" as a thesis change, and the
 * Snapshot has been reading the resulting `updated_at` as "last written".
 *
 * This module answers only the textual question — did the published prose
 * change — and it answers it the same way for the timeline, the counts, the
 * significance filter and the AI change-analysis input, so those four cannot
 * disagree about what a change was.
 *
 * ── What it deliberately does NOT do ─────────────────────────────────────
 *
 * It does not judge whether a content change was IMPORTANT. A one-word edit
 * and a rewritten thesis are both `content`; ranking them is a different
 * question with a different answer per section, and `getSignificanceTier`
 * already owns it (badly, but separately).
 *
 * It does not guess. When the recorded before/after cannot distinguish a prose
 * change from a metadata write, the answer is `ambiguous` — never `content`
 * and never `metadata`. Ambiguous events stay visible in the timeline; they
 * are simply not counted as substantive, and they are labelled as unknown
 * rather than silently binned. Fabricating either answer is how a timeline
 * starts lying about what the desk did.
 */

import { hasProse } from './case-state'

export type ChangeKind =
  /** The published prose differs. A real edit to the case. */
  | 'content'
  /** The row was written, but the prose is byte-identical after normalisation. */
  | 'metadata'
  /** The record cannot establish which. Shown, never counted. */
  | 'ambiguous'

export interface ContributionChange {
  /** `old_content` as recorded. `null`/`undefined` means "not recorded". */
  oldContent?: string | null
  /** `new_content` as recorded. */
  newContent?: string | null
}

/**
 * Compare prose for *identity*, not for meaning.
 *
 * The editor emits HTML, and a re-save through a different code path can
 * re-serialise the same prose with different tag spacing or a trailing `<p>`.
 * That is not an edit, so tags and whitespace runs are flattened before the
 * comparison. Nothing else is normalised: punctuation, casing and wording are
 * the content, and a change to any of them is a content change.
 */
export function normalizeProse(content: string | null | undefined): string {
  return (content ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The history row shapes this classifier is NOT able to read.
 *
 * A production trigger — not in version control, see
 * `docs/contribution-freshness-audit.md` — writes `asset_contribution_history`
 * and serialises something other than bare prose into `new_content`: the
 * Evolution Timeline renders strings of the form `[Attachments: 2 items]`
 * which appear nowhere in this repository. Until that trigger's exact format
 * is read off production, a value carrying such an envelope cannot be compared
 * as prose, so it classifies as `ambiguous` instead of being parsed by guess.
 *
 * This list is deliberately conservative: it matches only the envelope form
 * already OBSERVED in the product, anchored at the start of the value.
 */
const OBSERVED_NON_PROSE_ENVELOPE = /^\s*\[\s*attachments\s*:/i

function isUnreadableEnvelope(content: string | null | undefined): boolean {
  return OBSERVED_NON_PROSE_ENVELOPE.test(content ?? '')
}

/**
 * Classify one recorded contribution write.
 *
 * Order matters, and each rule earns its place:
 *
 *  1. An envelope this module cannot parse is `ambiguous` — before any prose
 *     comparison, because comparing an envelope to prose would report a
 *     content change that may never have happened.
 *  2. Nothing written at all (no prose either side) is `metadata`: the row was
 *     touched, the case still says nothing.
 *  3. Prose appearing where there was none is `content` — first publication.
 *  4. Prose disappearing is `content` — a retraction is an edit to the case.
 *  5. Otherwise compare normalised prose.
 *
 * `oldContent` being absent is NOT treated as "there was nothing before".
 * A missing before-value means the record does not say, which is rule 1's
 * territory only when the after-value is also unreadable; where the after
 * value is prose and the before value was never recorded, the write is still
 * evidence that prose exists now, so rule 3 applies and reports `content`.
 */
export function classifyContributionChange(change: ContributionChange): ChangeKind {
  const { oldContent, newContent } = change

  if (isUnreadableEnvelope(newContent) || isUnreadableEnvelope(oldContent)) return 'ambiguous'

  const hadProse = hasProse(normalizeProse(oldContent))
  const hasNow = hasProse(normalizeProse(newContent))

  if (!hadProse && !hasNow) return 'metadata'
  if (!hadProse && hasNow) return 'content'
  if (hadProse && !hasNow) return 'content'

  return normalizeProse(oldContent) === normalizeProse(newContent) ? 'metadata' : 'content'
}

/** Counted as a substantive change to the written case. */
export function isSubstantiveChange(change: ContributionChange): boolean {
  return classifyContributionChange(change) === 'content'
}

/**
 * Human-facing label for a change the record cannot classify.
 *
 * Exported so the timeline states the limitation in the one place a reader
 * would otherwise assume a thesis edit.
 */
export const AMBIGUOUS_CHANGE_LABEL = 'Change type not recorded'
