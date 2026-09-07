/**
 * One investment situation, one notification.
 *
 * ── The defect this exists to close ───────────────────────────────────────
 *
 * AMZN had three expired price targets and the user was shown SIX
 * notifications. Two things were wrong at once, and neither was rendering:
 *
 *  1. Every raw record produced its own row. Three expired targets on one
 *     name is one thing a reader needs to know — "AMZN targets expired, 3
 *     need review" — not three near-identical lines to dismiss one at a time.
 *
 *  2. The expiry sweep had no idempotency. `check_and_expire_user_targets`
 *     reads the pending outcomes, then writes; nothing locked the rows it had
 *     claimed, so two overlapping executions each saw the same three pending
 *     records and each emitted three notifications. React StrictMode remounts
 *     the alert that fires the sweep, which is how "overlapping executions"
 *     stopped being theoretical. Three plus three is six.
 *
 * The producer fix lives in the migration
 * `20260907120000_notification_semantic_grouping.sql`: one canonical emitter,
 * `SKIP LOCKED` on the claim, and a unique index on (user_id, group_key) so a
 * second attempt at the same semantic event folds instead of inserting.
 *
 * This module is the identity that fix is keyed on, expressed once so the
 * client and the database cannot drift apart, plus the read-side fold that
 * renders rows already in storage — a pilot's inbox holds duplicates emitted
 * before the migration, and they should read correctly today.
 *
 * ── What "the same situation" means ───────────────────────────────────────
 *
 * Semantic identity, never a display string. A key names the organization,
 * the asset, the situation, and the window the situation belongs to. Two
 * notifications collapse only when all four agree, so:
 *
 *   AMZN targets expired  +  AMZN thesis stale    → two notifications
 *   AMZN targets expired  +  MSFT targets expired → two notifications
 *   AMZN target #1/#2/#3 expired, same sweep      → one notification, count 3
 */

/**
 * The shape both the pane and the tests read. Deliberately loose: rows come
 * off the wire and older ones predate half these fields.
 */
export interface GroupableNotification {
  id?: string
  type: string
  title: string
  message: string
  context_type?: string | null
  context_id?: string | null
  context_data?: Record<string, any> | null
  created_at?: string | null
  is_read?: boolean | null
  group_key?: string | null
}

/**
 * How a notification type maps onto an underlying situation.
 *
 * `situation` is NOT the notification type. Two producers describing one
 * event must land on one slug, or they race into two rows and the reader gets
 * told twice. Types absent from this table do not group at all — one record,
 * one notification, which is right for a share, a mention or a message.
 */
interface SituationSpec {
  /** Stable slug for the underlying situation. */
  situation: string
  /** Where the situation lives. Missing parts are omitted, never guessed. */
  scope: (n: GroupableNotification) => { org?: string; portfolio?: string; asset?: string }
  /** Which raw record contributed this row. */
  member: (n: GroupableNotification) => string | null
  /**
   * The event window. Two expiries a month apart are two events; three
   * expiries found in one sweep are one. `day` buckets by the calendar day the
   * notification was raised, which is the day the sweep ran.
   */
  window: 'day' | 'none'
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined
}

const assetScope = (n: GroupableNotification) => ({
  org: str(n.context_data?.organization_id),
  asset:
    str(n.context_data?.asset_id) ??
    (n.context_type === 'asset' ? str(n.context_id) : undefined),
})

const SITUATIONS: Record<string, SituationSpec> = {
  /**
   * Both expiry producers land here. `notify_price_target_expired` (driven off
   * `price_target_outcomes`) and the scheduled sweep once inserted
   * independently, and the sweep's only guard read a `price_target_id` key the
   * other producer never wrote — so the guard could never see the rows it was
   * meant to suppress.
   */
  price_target_expired: {
    situation: 'price_target_expired',
    scope: assetScope,
    member: n =>
      str(n.context_data?.price_target_id) ??
      str(n.context_data?.outcome_id) ??
      (n.context_type === 'price_target' ? str(n.context_id) : undefined) ??
      str(n.id) ??
      null,
    window: 'day',
  },
}

/**
 * The calendar day a row belongs to, in UTC. Undated rows share one bucket
 * rather than each inventing their own, so a missing timestamp cannot split a
 * group.
 */
function dayBucket(createdAt: string | null | undefined): string {
  if (!createdAt) return 'unknown'
  const d = new Date(createdAt)
  return Number.isNaN(d.getTime()) ? 'unknown' : d.toISOString().slice(0, 10)
}

/**
 * The canonical semantic identity, or null when the type does not group.
 *
 * The database builds the same string in `notification_group_key`. The
 * template is asserted identical by the test beside this file, so a change
 * made here and not there fails the build rather than silently splitting
 * groups across the two implementations.
 */
export function notificationGroupKey(n: GroupableNotification): string | null {
  const spec = SITUATIONS[n.type]
  if (!spec) return null

  const scope = spec.scope(n)
  // An asset-scoped situation with no asset has no identity worth grouping on.
  // Falling back to the ticker string is exactly the display-string matching
  // this is meant to replace.
  if (!scope.asset) return null

  return [
    spec.situation,
    `org:${scope.org ?? '-'}`,
    `pf:${scope.portfolio ?? '-'}`,
    `asset:${scope.asset}`,
    `w:${spec.window === 'day' ? dayBucket(n.created_at) : '-'}`,
  ].join('|')
}

/** A notification after folding, carrying what the fold learned. */
export interface ConsolidatedNotification extends GroupableNotification {
  /** How many underlying records this row speaks for. Always at least one. */
  groupCount: number
  /**
   * The records themselves, so the count can be audited and the detail
   * reached. Empty for rows that never grouped.
   */
  contributingIds: string[]
  /**
   * The rows folded away. Kept so marking the consolidated row read can mark
   * its members read too.
   */
  memberNotificationIds: string[]
}

/**
 * What the reader is told once several records have folded together.
 *
 * A single record keeps its own words: "Your Bull price target of $220 for
 * Amazon expired on Mar 14" says more than any summary, and rewriting it would
 * be a regression for the common case.
 */
export function consolidatedCopy(
  n: GroupableNotification,
  count: number,
): { title: string; message: string } {
  if (count <= 1) return { title: n.title, message: n.message }

  if (n.type === 'price_target_expired') {
    const symbol = str(n.context_data?.asset_symbol) ?? 'This asset'
    return {
      title: `${symbol} targets expired`,
      message: `${count} targets need review`,
    }
  }

  return { title: n.title, message: `${count} updates` }
}

function declaredMembers(
  row: GroupableNotification,
  spec: SituationSpec | undefined,
): string[] {
  const declared = row.context_data?.contributing_ids
  if (Array.isArray(declared)) {
    const ids = declared.map(v => String(v)).filter(Boolean)
    if (ids.length > 0) return [...new Set(ids)]
  }
  const single = spec?.member(row) ?? null
  return single ? [single] : []
}

function declaredCount(row: GroupableNotification): number {
  const c = row.context_data?.contributing_count
  return typeof c === 'number' && Number.isFinite(c) && c > 0 ? Math.floor(c) : 1
}

/**
 * Collapse a fetched page of notifications onto their semantic identities.
 *
 * Order is preserved by first appearance, so an inbox does not reshuffle when
 * a fold happens. Ungrouped rows pass through untouched with a count of one.
 */
export function consolidateNotifications(
  rows: GroupableNotification[],
): ConsolidatedNotification[] {
  const out: ConsolidatedNotification[] = []
  const byKey = new Map<string, ConsolidatedNotification>()

  for (const row of rows) {
    const key = row.group_key ?? notificationGroupKey(row)
    const spec = SITUATIONS[row.type]
    const members = declaredMembers(row, spec)

    if (!key) {
      out.push({ ...row, groupCount: 1, contributingIds: members, memberNotificationIds: [] })
      continue
    }

    const existing = byKey.get(key)
    if (!existing) {
      const seeded: ConsolidatedNotification = {
        ...row,
        group_key: key,
        groupCount: Math.max(1, members.length, declaredCount(row)),
        contributingIds: members,
        memberNotificationIds: [],
      }
      const copy = consolidatedCopy(row, seeded.groupCount)
      seeded.title = copy.title
      seeded.message = copy.message
      byKey.set(key, seeded)
      out.push(seeded)
      continue
    }

    // Fold. Contributing records are a SET: reprocessing the same record must
    // not raise the count, which is the whole reason ids are carried rather
    // than a counter incremented.
    for (const m of members) {
      if (!existing.contributingIds.includes(m)) existing.contributingIds.push(m)
    }
    if (row.id) existing.memberNotificationIds.push(row.id)
    existing.groupCount = Math.max(
      existing.contributingIds.length,
      existing.groupCount,
      declaredCount(row),
    )
    // An unread member keeps the consolidated row unread — folding must never
    // hide something the reader has not seen.
    if (row.is_read === false) existing.is_read = false

    const copy = consolidatedCopy(existing, existing.groupCount)
    existing.title = copy.title
    existing.message = copy.message
  }

  return out
}
