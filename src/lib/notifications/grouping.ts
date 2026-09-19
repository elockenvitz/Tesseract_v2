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
   * What to show the reader about that record.
   *
   * A grouped notification that only counts is worse than the duplicates it
   * replaced: "3 targets need review" with no way to see which three is a
   * summary the reader has to leave the screen to act on.
   */
  detail?: (n: GroupableNotification) => ContributingTarget
  /**
   * The event this row belongs to, from the situation's OWN semantics.
   *
   * ── Why not the day the sweep ran ─────────────────────────────────────────
   *
   * It was, and that was wrong. The sweep is a job: it runs when someone opens
   * a screen, it can be late, and it can be re-run. Bucketing by its clock made
   * "which event is this" a fact about the server's schedule rather than about
   * the investment situation — three targets found on Tuesday were one event
   * and the same three found either side of midnight were two.
   *
   * For an expiry the event is the EXPIRY DATE. Bull, Base and Bear set
   * together carry one horizon and therefore one `target_date`, which is the
   * "same expiry event" a reader means. A target that lapses next month is a
   * different event and gets its own notification, however many times the
   * sweep runs in between.
   */
  window: (n: GroupableNotification) => string
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
    /**
     * `price_target_outcomes.target_date` — the horizon the view was given,
     * carried into the notification by the producer since the first version.
     * Present on every row already in storage, so the backlog groups by the
     * same rule as anything written from now on.
     *
     * Undated rows share one bucket rather than each inventing their own: with
     * no date there is nothing to tell two events apart, and one notification
     * about an asset beats one per record.
     */
    window: n => dayOf(n.context_data?.target_date) ?? '-',
    detail: n => ({
      priceTargetId: str(n.context_data?.price_target_id)
        ?? (n.context_type === 'price_target' ? str(n.context_id) : undefined)
        ?? null,
      /** Bull / Base / Bear. `scenario_name` is what the producer writes. */
      scenario: str(n.context_data?.scenario_name) ?? str(n.context_data?.scenario_type) ?? null,
      price: num(n.context_data?.target_price),
      targetDate: dayOf(n.context_data?.target_date),
      ownerId: str(n.context_data?.user_id) ?? null,
      ownerName: str(n.context_data?.analyst_name) ?? null,
    }),
  },
}

/** A date column or timestamp reduced to its calendar day, or null. */
function dayOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const d = new Date(v)
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

/**
 * One record that contributed to a consolidated notification.
 *
 * Enough to answer "which targets expired" without another query: the reader
 * sees the case, the number and the horizon, which is what makes a grouped row
 * an answer rather than a collapsed one.
 */
export interface ContributingTarget {
  priceTargetId: string | null
  scenario: string | null
  price: number | null
  targetDate: string | null
  ownerId: string | null
  ownerName: string | null
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
    `w:${spec.window(n)}`,
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
   * What each of those records was, for the reader.
   *
   * Recovered from the folded rows where the producer has not written it yet:
   * every expiry notification already in storage carries its own scenario,
   * price and horizon, so the backlog can be inspected today rather than after
   * the migration runs.
   */
  contributing: ContributingTarget[]
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

/**
 * The records this ROW speaks for, with what to show about each.
 *
 * A row written by the migrated producer already declares its whole group in
 * `context_data.contributing`. A row written before it declares one record —
 * itself — and carries that record's scenario, price and horizon inline, which
 * is what lets six legacy AMZN rows fold into one line that can still name all
 * three targets.
 */
function declaredMembers(
  row: GroupableNotification,
  spec: SituationSpec | undefined,
): ContributingTarget[] {
  const declared = row.context_data?.contributing
  if (Array.isArray(declared) && declared.length > 0) {
    return declared.map((d: any) => ({
      priceTargetId: str(d?.price_target_id) ?? str(d?.priceTargetId) ?? null,
      scenario: str(d?.scenario) ?? str(d?.scenario_name) ?? null,
      price: num(d?.price ?? d?.target_price),
      targetDate: dayOf(d?.target_date ?? d?.targetDate),
      ownerId: str(d?.user_id) ?? str(d?.ownerId) ?? null,
      ownerName: str(d?.analyst_name) ?? str(d?.ownerName) ?? null,
    }))
  }

  // Older shape: ids only, no per-target detail to show.
  const ids = row.context_data?.contributing_ids
  if (Array.isArray(ids) && ids.length > 0) {
    return [...new Set(ids.map(v => String(v)).filter(Boolean))]
      .map(id => ({ priceTargetId: id, scenario: null, price: null, targetDate: null, ownerId: null, ownerName: null }))
  }

  if (!spec) return []
  const detail = spec.detail?.(row)
  const id = spec.member(row)
  if (detail) return [{ ...detail, priceTargetId: detail.priceTargetId ?? id }]
  return id ? [{ priceTargetId: id, scenario: null, price: null, targetDate: null, ownerId: null, ownerName: null }] : []
}

/** How one contributing record is identified for de-duplication. */
function memberKey(t: ContributingTarget): string {
  return t.priceTargetId ?? `${t.scenario ?? ''}|${t.price ?? ''}|${t.targetDate ?? ''}`
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
      out.push({
        ...row, groupCount: 1,
        contributing: members,
        contributingIds: members.map(memberKey),
        memberNotificationIds: [],
      })
      continue
    }

    const existing = byKey.get(key)
    if (!existing) {
      const seeded: ConsolidatedNotification = {
        ...row,
        group_key: key,
        groupCount: Math.max(1, members.length, declaredCount(row)),
        contributing: members,
        contributingIds: members.map(memberKey),
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
    // not raise the count, which is the whole reason the records are carried
    // rather than a counter incremented.
    for (const m of members) {
      const k = memberKey(m)
      if (existing.contributingIds.includes(k)) continue
      existing.contributingIds.push(k)
      existing.contributing.push(m)
    }
    if (row.id) existing.memberNotificationIds.push(row.id)
    existing.groupCount = Math.max(
      existing.contributing.length,
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
