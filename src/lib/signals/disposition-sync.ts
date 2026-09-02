import { supabase } from '../supabase'
import type { SignalType } from './contract'
import {
  DISPOSITION_SCHEMA,
  dispositionKey,
  type Disposition,
  type DispositionKind,
  type DispositionMap,
} from './dispositions'
import {
  DURABLE_KEY_PREFIX,
  durableDispositionKey,
  parseDurableKey,
  suppressionFieldFor,
} from './disposition-scope'
import { DAY_MS } from './thresholds'

/**
 * The durable half of personal feed state.
 *
 * ── What was wrong ────────────────────────────────────────────────────────
 *
 * Every Defer, Dismiss, Snooze and verdict on the signal feed lived in
 * `localStorage` and nowhere else. The header of `dispositions.ts` justified
 * that on the grounds that losing it "costs the reader one repeated card rather
 * than any real state" — true when the longest window was a session, and false
 * once the same store started carrying 180-day answers about positions. A
 * cleared cache, a second device or a different browser and the reader is asked
 * everything again, and nothing can answer "what has this analyst deferred".
 *
 * ── The store ─────────────────────────────────────────────────────────────
 *
 * `attention_user_state`, in a `signal:` namespace. Not a new table: that one is
 * already `UNIQUE (user_id, attention_id)` over an opaque text key with RLS on
 * all four verbs, which is exactly `user × object × disposition`. See the
 * migration header for why a sibling table would have been the same thing twice.
 *
 * ── Failure discipline ────────────────────────────────────────────────────
 *
 * `judgment-log`'s, deliberately: every error is swallowed and reported as a
 * status, never thrown. The LOCAL write is what the reader is told about,
 * because it is what the feed reads on the next open; somebody triaging on a
 * train must not be stopped by a dropped request. A failed durable write leaves
 * the local record standing and is logged for a later sync pass.
 *
 * ── What this file cannot do ──────────────────────────────────────────────
 *
 * Touch a shared object. The RPC takes no user id and writes one row in one
 * table, and that table holds nothing anybody else can read. See
 * `disposition-scope.ts` for the contract, and
 * `supabase/tests/feed-disposition-ownership.sql` for the RLS proof.
 */

export type SyncResult = 'written' | 'skipped' | 'failed'

export interface SyncDispositionInput {
  /** `card.type` — the signal type, which is the first half of the local key. */
  type: string
  /** `dispositionEntityFor(card)` — entity for a recurring finding, card id for an artefact. */
  subject: string
  kind: DispositionKind
  /** The semantic key `judgment-policy` classifies. Feed mechanics, not a judgment. */
  key: string
  intent?: 'triage' | 'feed_quality' | 'attention' | 'judgment'
  /** Epoch ms the suppression runs to. */
  until: number
}

/**
 * Write one personal disposition durably. Never throws.
 *
 * `flagged` is written with no window at all, matching `isDisposedOf`: the
 * reader said the finding is real and needs work, so the card keeps coming
 * back. The row still exists, because the ANSWER should be remembered even when
 * it suppresses nothing — that distinction is the bug `DISPOSITION_DAYS`
 * documents, where a flagged judgment was retained for zero days and forgotten
 * on the next read.
 */
export async function syncDisposition(input: SyncDispositionInput): Promise<SyncResult> {
  const field = suppressionFieldFor(input.kind)
  const until = field ? new Date(input.until).toISOString() : null

  try {
    // `as never` on the args, and the row cast below, for the reason every
    // other `attention_user_state` call site carries one: `types/database.ts`
    // is generated and has never included this table or its seven RPCs, so the
    // client resolves both to `never`. The cast is the repo's existing idiom
    // here, not a suppressed real error — regenerating the types is a separate
    // job that would touch every attention call site at once.
    const { error } = await supabase.rpc('set_feed_disposition' as never, {
      p_key: durableDispositionKey(input.type, input.subject),
      p_signal_type: input.type,
      p_disposition_key: input.key,
      p_intent: input.intent ?? 'judgment',
      p_snoozed_until: field === 'snoozed_until' ? until : null,
      p_dismissed_until: field === 'dismissed_until' ? until : null,
    } as never)
    if (error) {
      console.warn('[feed] disposition not persisted durably', {
        type: input.type, key: input.key, error: error.message,
      })
      return 'failed'
    }
    return 'written'
  } catch {
    // Offline, or the RPC has not been deployed to this environment yet. The
    // local write already stands; this is not the reader's problem.
    return 'failed'
  }
}

/**
 * Every live personal disposition for the calling user, shaped as the map the
 * feed already reads.
 *
 * ── Why the shape is the existing one ─────────────────────────────────────
 *
 * `DispositionMap` is `Record<'<type>:<subject>', Disposition>`, and
 * `rankInputFor`, `judgmentFor` and `priorityFor` all consume it. Returning the
 * same shape means the SOURCE changes and no consumer does — which is the whole
 * reason this is a store swap rather than a rewrite of the ranking.
 *
 * ── Bounded by construction ───────────────────────────────────────────────
 *
 * Only live rows: a spent window is not fetched. The predicate is the same one
 * `loadDispositions` applies on read, so the two stores agree about what has
 * expired without either having to prune.
 *
 * Returns an empty map on any failure, never throws. An empty map means "no
 * suppression", which fails open — the reader sees a card they had answered
 * rather than losing one they had not. That is the right direction for a feed:
 * showing something twice is a nuisance, hiding something silently is not.
 */
export async function fetchDurableDispositions(userId: string): Promise<DispositionMap> {
  if (!userId) return {}
  const nowIso = new Date().toISOString()

  try {
    const { data, error } = await supabase
      .from('attention_user_state')
      .select('attention_id, signal_type, disposition_key, intent, snoozed_until, dismissed_until, updated_at')
      // RLS restricts this to the caller regardless; the filter is here so a
      // misconfigured session produces no rows rather than someone else's.
      .eq('user_id', userId)
      .like('attention_id', `${DURABLE_KEY_PREFIX}%`)
      .or(`snoozed_until.gt.${nowIso},dismissed_until.gt.${nowIso}`)

    if (error || !data) return {}

    const map: DispositionMap = {}
    for (const row of data as unknown as DurableRow[]) {
      const parsed = parseDurableKey(row.attention_id)
      if (!parsed) continue
      const d = dispositionFromRow(row, parsed)
      if (d) map[dispositionKey(parsed.type as SignalType, parsed.subject)] = d
    }
    return map
  } catch {
    return {}
  }
}

interface DurableRow {
  attention_id: string
  signal_type: string | null
  disposition_key: string | null
  intent: string | null
  snoozed_until: string | null
  dismissed_until: string | null
  updated_at: string | null
}

/**
 * A durable row read back as the local record shape.
 *
 * `kind` is DERIVED from which window carries a value, and round-trips exactly
 * with `suppressionFieldFor` — the same function decided which column to write.
 * Storing it a second time as a column would create two places to disagree.
 *
 * `label` and `question` are absent, and that is not a loss. They exist locally
 * so an audit does not need the builder that produced the button, and the
 * durable audit already carries both on the `audit_events` row
 * (`judgment_label`, `judgment_question`). This table holds feed mechanics; the
 * record of what was asked and answered lives where records live.
 */
function dispositionFromRow(
  row: DurableRow,
  parsed: { type: string; subject: string },
): Disposition | null {
  const key = row.disposition_key
  if (!key) return null

  const at = row.updated_at ? Date.parse(row.updated_at) : Date.now()
  const snooze = row.snoozed_until ? Date.parse(row.snoozed_until) : null
  const dismiss = row.dismissed_until ? Date.parse(row.dismissed_until) : null

  const kind: DispositionKind = dismiss !== null ? 'rejected' : snooze !== null ? 'settled' : 'flagged'
  // A flagged answer suppresses nothing, so it has no window. `until` is also
  // the local retention key, so it gets the same 90 days `DISPOSITION_DAYS`
  // gives a flagged record locally — remembered, never hiding anything.
  const until = dismiss ?? snooze ?? at + 90 * DAY_MS

  return {
    kind,
    key,
    verdict: key,
    cardType: row.signal_type ?? parsed.type,
    v: DISPOSITION_SCHEMA,
    until,
    at: Number.isFinite(at) ? at : Date.now(),
  }
}

/**
 * Server over local, key by key.
 *
 * ── Why the server wins ───────────────────────────────────────────────────
 *
 * It is the only store that sees every device. A local record that disagrees is
 * either older or belongs to a browser that answered while offline; the first
 * should lose and the second is repaired by its own pending sync. Merging by
 * recency instead would let a stale tab resurrect a suppression the reader
 * cleared elsewhere.
 *
 * ── Why local is kept at all ──────────────────────────────────────────────
 *
 * It is synchronous, which the first paint needs, and it is the offline
 * fallback. `recordDisposition` still writes it and still returns the boolean
 * the UI reports, so a reader is never told an answer landed on the strength of
 * a request that had not returned yet.
 */
export function mergeDispositions(local: DispositionMap, durable: DispositionMap): DispositionMap {
  return { ...local, ...durable }
}
