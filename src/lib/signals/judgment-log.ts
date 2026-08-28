import { emitAuditEvent } from '../audit/audit-service'
import { evaluateActivation, markActivationMilestone } from '../onboarding/activation'
import type { SignalCard } from './contract'
import {
  DISPOSITION_DAYS,
  recordDisposition,
  type DispositionKind,
} from './dispositions'

/**
 * Where an analyst's judgment actually lives.
 *
 * ── The problem this closes ───────────────────────────────────────────────
 *
 * Phase 3 persisted structured judgments to `localStorage`. That is the right
 * store for "which cards should this browser hide", and the wrong one for "what
 * did this analyst conclude about this position". It does not survive a cleared
 * cache, does not follow a user to a second device, cannot be queried, and
 * cannot be audited — and a research record with those properties is not a
 * record.
 *
 * ── Why no migration was needed ───────────────────────────────────────────
 *
 * `audit_events` already exists, carries 2,843 rows, allows INSERT to
 * `authenticated`, and has an `emitAuditEvent` client that computes the
 * required checksum, swallows its own errors and returns an id or null. Its
 * `metadata` column is `jsonb` with an open index signature, so the semantic
 * judgment needs no column of its own. It is designed for exactly this: an
 * immutable, queryable statement that a person decided something about an
 * entity at a time.
 *
 * ── The one real constraint, and how it is handled ────────────────────────
 *
 * `audit_events` has a CHECK constraint limiting `entity_type` to a fixed list.
 * `asset` is on it; `market` and `project` are not. So judgments about a
 * position are recorded durably, and judgments about a macro release or a
 * workflow item stay local until someone decides to widen that enum.
 *
 * That split is deliberate rather than convenient: the asset cards are the ones
 * carrying investment judgments, which are the ones worth auditing. Writing a
 * workflow acknowledgement under a fabricated asset id to satisfy a constraint
 * would put false data in the audit log to avoid a schema conversation.
 */

/** Named so a query can find every judgment without knowing the card types. */
export const JUDGMENT_ACTION = 'record_judgment' as const

export interface SignalJudgmentInput {
  userId: string
  /** Required by `audit_events`. Without it there is no durable write. */
  orgId: string | null
  card: SignalCard
  /** The question as it was asked, so the answer stays interpretable. */
  question: string
  judgment: {
    key: string
    label: string
    disposition: DispositionKind
    intent?: 'judgment' | 'feed_quality'
  }
}

export interface SignalJudgmentResult {
  /** Whether the optimistic local write stuck. This is what the UI reports:
   *  it is the store the feed actually reads on the next open. */
  local: boolean
  /**
   * What happened to the durable write.
   *
   * `skipped` is not a failure. It means this card's entity cannot be
   * represented in `audit_events` today, which is a known and documented gap
   * rather than an error to surface to a reader mid-triage.
   */
  durable: 'written' | 'skipped' | 'failed'
}

/**
 * True when this card's subject can be written to `audit_events` as-is.
 *
 * Asset entities only, because `valid_entity_type` says so. The id also has to
 * be a UUID: the column is `uuid NOT NULL`, and a market card's "id" is a
 * ticker string.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function isDurableEntity(card: SignalCard): boolean {
  return card.entity.kind === 'asset' && UUID.test(card.entity.id)
}

/**
 * Record a judgment locally, then durably.
 *
 * ── Why the local write decides the UI ────────────────────────────────────
 *
 * The reader is told whether their answer stuck based on the LOCAL write,
 * not the server one. Two reasons.
 *
 * The local store is what the feed reads on the next open, so it is what
 * determines whether the reader sees the card again — which is the thing the
 * response control promised them.
 *
 * And a failed server write must not block triage. Someone working through a
 * feed on a train should not be stopped by a dropped request, and
 * `emitAuditEvent` already treats audit logging as something that must never
 * break the main flow. A durable failure is marked on the local record instead,
 * so a later sync pass can find it.
 */
export async function recordSignalJudgment(
  input: SignalJudgmentInput,
): Promise<SignalJudgmentResult> {
  const { userId, orgId, card, question, judgment } = input
  const until = Date.now() + DISPOSITION_DAYS[judgment.disposition] * 86_400_000

  const local = recordDisposition(userId, card.type, card.entity.id, {
    kind: judgment.disposition,
    key: judgment.key,
    label: judgment.label,
    question,
    cardType: card.type,
    until,
  })

  if (!isDurableEntity(card) || !orgId) {
    return { local, durable: 'skipped' }
  }

  const id = await emitAuditEvent({
    actor: { id: userId, type: 'user' },
    entity: {
      type: 'asset',
      id: card.entity.id,
      displayName: card.entity.ticker ?? card.entity.name,
    },
    action: { type: JUDGMENT_ACTION, category: 'state_change' },
    // `to_state` carries the judgment, so the audit explorer's existing
    // state-diff rendering shows something meaningful without special-casing
    // this action type.
    state: {
      to: {
        judgment: judgment.key,
        judgment_label: judgment.label,
        question,
      },
    },
    metadata: {
      ui_source: 'mobile_feed',
      // The semantic key, indexed under its own name so a query for
      // "every position anyone called not_price_driven" does not have to
      // parse a state blob.
      judgment_key: judgment.key,
      judgment_label: judgment.label,
      judgment_question: question,
      // Whether this was a claim about the INVESTMENT or about the FEED.
      // `not_relevant` on a news card maps to `rejected` for suppression and is
      // not an investment conclusion; anything reading these back has to be
      // able to tell, or it will count feed complaints as research.
      judgment_intent: judgment.intent ?? 'judgment',
      // The compatibility state, recorded as what it is: a feed mechanism.
      // Kept so a reader of the log can reconstruct what the surface did,
      // never as the meaning of the answer.
      feed_disposition: judgment.disposition,
      signal_type: card.type,
      card_surface: card.surface,
      suppressed_until: new Date(until).toISOString(),
    },
    orgId,
    assetSymbol: card.entity.ticker ?? undefined,
  })

  /**
   * The judgment half of activation.
   *
   * Marked here rather than at the call sites because this is the one function
   * every durable judgment already passes through, and a milestone recorded in
   * some of the places a user can record a judgment is worse than none — it
   * would make activation depend on which surface they happened to use.
   *
   * Only for a judgment that actually reached the log (`id` is non-null) and
   * only for an investment conclusion. A `feed_quality` answer is the reader
   * telling us the card was wrong, which is valuable and is not a judgment
   * about a position — counting it as activation would let a user activate by
   * complaining, which is the most misleading possible version of this number.
   *
   * Awaited but never able to throw: `markActivationMilestone` swallows its own
   * failures, and `evaluateActivation` promotes to `activated` only when the
   * coverage half is already recorded.
   */
  if (id && (judgment.intent ?? 'judgment') === 'judgment') {
    const ctx = { userId, orgId }
    await markActivationMilestone('first_judgment', ctx, {
      metadata: { judgment_key: judgment.key, signal_type: card.type },
    })
    await evaluateActivation(ctx)
  }

  return { local, durable: id ? 'written' : 'failed' }
}
