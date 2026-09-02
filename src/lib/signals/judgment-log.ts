import { emitAuditEvent } from '../audit/audit-service'
import type { SignalCard } from './contract'
import { syncDisposition, type SyncResult } from './disposition-sync'
import {
  DISPOSITION_DAYS,
  dispositionEntityFor,
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
    intent?: 'judgment' | 'feed_quality' | 'attention'
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
  /**
   * What happened to the durable PERSONAL state — a different thing from
   * `durable`, and the distinction is the point of this stage.
   *
   * `durable` is the firm's record that somebody concluded something: an
   * append-only `audit_events` row, org-visible, and skipped entirely for a
   * card whose subject the audit enum cannot name. `state` is this reader's own
   * suppression, which every card has and no colleague can see.
   *
   * They fail independently on purpose. A macro card writes no audit row and
   * must still remember that the reader deferred it, and a dropped attention
   * write must not lose the analyst's conclusion.
   */
  state: SyncResult
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

  /**
   * The disposition identity, which is the card's entity for a finding and the
   * card itself for a post — see `dispositionEntityFor`.
   *
   * The durable audit row below still names `card.entity`, and correctly: an
   * audit event is about the ASSET whatever prompted it. Only the feed's own
   * memory of having asked is keyed more narrowly, so one reader's answer to
   * one colleague's thought cannot silence a different colleague's thought
   * about the same name.
   */
  const subject = dispositionEntityFor(card)
  const local = recordDisposition(userId, card.type, subject, {
    kind: judgment.disposition,
    key: judgment.key,
    label: judgment.label,
    question,
    cardType: card.type,
    until,
  })

  /**
   * The same answer, in the store that survives this browser.
   *
   * ── Why it is here and not behind the audit gate below ────────────────────
   *
   * Personal state and the firm's record are different things with different
   * eligibility. The audit row is skipped for a macro release, a workflow item
   * and anything whose entity `audit_events` cannot name — and every one of
   * those cards still has to stop asking. Gating suppression on auditability
   * would mean the cards least able to prove anything are also the ones that
   * never remember an answer.
   *
   * Fire-and-forget, and deliberately not awaited before the local result is
   * decided: `local` is what the reader is told, because it is what the feed
   * reads on the next open. This is the copy that reaches their other device.
   */
  const state = await syncDisposition({
    type: card.type,
    subject,
    kind: judgment.disposition,
    key: judgment.key,
    intent: judgment.intent ?? 'judgment',
    until,
  })

  /**
   * An attention answer never becomes an investment judgment.
   *
   * ── The write this removes ────────────────────────────────────────────────
   *
   * A workflow card carries the ASSET as its entity whenever the item happens
   * to be linked to one, and `isDurableEntity` is satisfied by exactly that. So
   * tapping "Done" on an overdue deliverable wrote a `record_judgment` row
   * against AAPL with `judgment_key: 'done'`, `action_category: 'state_change'`
   * and a `to_state` claiming a judgment had been recorded about the position.
   *
   * Nobody concluded anything about AAPL. They cleared a task off a screen.
   * Anything reading the judgment history back — a coverage review, an analyst
   * scorecard, the audit explorer's own state diff — would have counted it, and
   * `judgment_intent` in the metadata was the only thing distinguishing it from
   * a real answer, which is a filter every future reader has to remember to
   * apply and one of them will not.
   *
   * `skipped` rather than a failure, and for the documented reason: this is a
   * known and deliberate absence, not an error to surface mid-triage. The local
   * disposition still stands, so the queue still clears.
   *
   * Feed-quality answers are deliberately NOT gated here. They already carry
   * `judgment_intent: 'feed_quality'`, they are a claim about the surface that
   * somebody will want to analyse, and removing them is a separate decision
   * from removing a claim that was never made.
   */
  if (judgment.intent === 'attention') {
    return { local, durable: 'skipped', state }
  }

  if (!isDurableEntity(card) || !orgId) {
    return { local, durable: 'skipped', state }
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

  return { local, durable: id ? 'written' : 'failed', state }
}
