/**
 * The AMZN 3 → 6 defect, pinned.
 *
 * ── What actually happened ────────────────────────────────────────────────
 *
 * Three AMZN price targets expired and the analyst got six notifications.
 * Reading it as a rendering problem would have been wrong twice over: six
 * ROWS existed, and they existed because two things were missing at the
 * producer.
 *
 *   * No semantic grouping. Each expired `price_target_outcomes` record
 *     emitted its own row, so one situation arrived as three lines.
 *   * No idempotency. `check_and_expire_user_targets` selects the pending
 *     outcomes and then writes them, holding no lock in between. The client
 *     fires it from a mount effect that StrictMode invokes twice, so two
 *     executions read the same three pending rows and each emitted three.
 *
 * These tests hold the identity that both halves of the fix are keyed on:
 * this module, and the SQL in
 * `supabase/migrations/20260907120000_notification_semantic_grouping.sql`
 * which must build the same string. The last test asserts they agree — if
 * they ever drift, the database groups on one key while the client folds on
 * another, and the duplicates come back.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import {
  consolidateNotifications,
  notificationGroupKey,
  type GroupableNotification,
} from '../grouping'

const ORG = '11111111-1111-1111-1111-111111111111'
const AMZN = '22222222-2222-2222-2222-222222222222'
const MSFT = '33333333-3333-3333-3333-333333333333'

/** One expiry notification exactly as the sweep emits it. */
function expiredTarget(over: Partial<GroupableNotification> & { targetId: string }): GroupableNotification {
  const { targetId, ...rest } = over
  return {
    id: `n-${targetId}`,
    type: 'price_target_expired',
    title: 'Price Target Expired: AMZN Bull',
    message: 'Your Bull price target of $220 for Amazon (AMZN) expired on Mar 14, 2026.',
    context_type: 'asset',
    context_id: AMZN,
    created_at: '2026-03-15T09:00:00.000Z',
    is_read: false,
    context_data: {
      organization_id: ORG,
      asset_id: AMZN,
      asset_symbol: 'AMZN',
      asset_name: 'Amazon.com Inc',
      price_target_id: targetId,
    },
    ...rest,
  }
}

/** The six rows the pilot inbox actually held: three targets, emitted twice. */
const AMZN_SIX: GroupableNotification[] = [
  expiredTarget({ targetId: 'pt-bull', id: 'n1' }),
  expiredTarget({ targetId: 'pt-base', id: 'n2' }),
  expiredTarget({ targetId: 'pt-bear', id: 'n3' }),
  expiredTarget({ targetId: 'pt-bull', id: 'n4' }),
  expiredTarget({ targetId: 'pt-base', id: 'n5' }),
  expiredTarget({ targetId: 'pt-bear', id: 'n6' }),
]

describe('three expired targets on one asset are one situation', () => {
  it('collapses three separate expiry rows into a single notification', () => {
    const rows = AMZN_SIX.slice(0, 3)
    const out = consolidateNotifications(rows)

    expect(out).toHaveLength(1)
  })

  it('reports that three targets contributed', () => {
    const [amzn] = consolidateNotifications(AMZN_SIX.slice(0, 3))

    expect(amzn.groupCount).toBe(3)
    expect([...amzn.contributingIds].sort()).toEqual(['pt-base', 'pt-bear', 'pt-bull'])
  })

  it('says what the reader needs: which asset, and how many need review', () => {
    const [amzn] = consolidateNotifications(AMZN_SIX.slice(0, 3))

    expect(amzn.title).toBe('AMZN targets expired')
    expect(amzn.message).toBe('3 targets need review')
  })

  it('reproduces the reported defect: three targets never yield six rows', () => {
    const out = consolidateNotifications(AMZN_SIX)

    expect(out).toHaveLength(1)
    expect(out[0].groupCount).toBe(3)
    expect(out[0].message).toBe('3 targets need review')
  })
})

describe('two producers describing one situation land on one notification', () => {
  /*
    `notify_price_target_expired` wrote the target id into `context_id` with
    `context_type: 'price_target'`. `process_all_expired_price_targets` wrote
    it into `context_data.price_target_id` with `context_id` set to the ASSET.
    The second producer's only de-duplication test read
    `context_data->>'price_target_id'` — a key the first has never written —
    so it could not see the rows it existed to suppress.
  */
  const fromOutcomeSweep: GroupableNotification = {
    id: 'n-a',
    type: 'price_target_expired',
    title: 'Price Target Expired: AMZN Bull',
    message: 'Your Bull price target expired.',
    context_type: 'price_target',
    context_id: 'pt-bull',
    created_at: '2026-03-15T09:00:00.000Z',
    context_data: { organization_id: ORG, asset_id: AMZN, asset_symbol: 'AMZN' },
  }

  const fromScheduledSweep: GroupableNotification = {
    id: 'n-b',
    type: 'price_target_expired',
    title: 'Price Target Expired',
    message: 'Your Bull for AMZN ($220) has expired',
    context_type: 'asset',
    context_id: AMZN,
    created_at: '2026-03-15T09:00:04.000Z',
    context_data: { organization_id: ORG, asset_id: AMZN, asset_symbol: 'AMZN', price_target_id: 'pt-bull' },
  }

  it('gives both producers the same semantic identity', () => {
    expect(notificationGroupKey(fromOutcomeSweep))
      .toBe(notificationGroupKey(fromScheduledSweep))
  })

  it('folds them into one notification about one target', () => {
    const out = consolidateNotifications([fromOutcomeSweep, fromScheduledSweep])

    expect(out).toHaveLength(1)
    expect(out[0].groupCount).toBe(1)
    // One target, so the specific copy survives rather than a "1 targets" summary.
    expect(out[0].message).toBe('Your Bull price target expired.')
  })
})

describe('reprocessing the same condition changes nothing', () => {
  it('is idempotent across repeated sweeps of the same three targets', () => {
    const once = consolidateNotifications(AMZN_SIX.slice(0, 3))
    const thrice = consolidateNotifications([...AMZN_SIX, ...AMZN_SIX.slice(0, 3)])

    expect(thrice).toHaveLength(once.length)
    expect(thrice[0].groupCount).toBe(3)
  })

  it('does not raise the count when a row already carries its provenance', () => {
    // What a refetch returns once the producer has consolidated: one row that
    // already declares its three contributors.
    const stored: GroupableNotification = expiredTarget({
      targetId: 'pt-bull',
      id: 'n-stored',
      title: 'AMZN targets expired',
      message: '3 targets need review',
      context_data: {
        organization_id: ORG,
        asset_id: AMZN,
        asset_symbol: 'AMZN',
        contributing_ids: ['pt-bull', 'pt-base', 'pt-bear'],
        contributing_count: 3,
      },
    })

    const first = consolidateNotifications([stored])
    const refetched = consolidateNotifications([stored, stored])

    expect(first).toHaveLength(1)
    expect(refetched).toHaveLength(1)
    expect(refetched[0].groupCount).toBe(3)
    expect(refetched[0].contributingIds).toHaveLength(3)
  })
})

describe('unrelated situations stay apart', () => {
  it('keeps a different material situation on the same asset separate', () => {
    const targetsExpired = expiredTarget({ targetId: 'pt-bull' })
    const targetChanged: GroupableNotification = {
      id: 'n-changed',
      type: 'price_target_change',
      title: 'Price Target Updated: AMZN',
      message: 'The bull case price target changed from 200 to 220',
      context_type: 'asset',
      context_id: AMZN,
      created_at: '2026-03-15T09:00:00.000Z',
      context_data: { organization_id: ORG, asset_id: AMZN, asset_symbol: 'AMZN' },
    }

    const out = consolidateNotifications([targetsExpired, targetChanged])

    expect(out).toHaveLength(2)
    expect(notificationGroupKey(targetsExpired))
      .not.toBe(notificationGroupKey(targetChanged))
  })

  it('keeps the same situation on a different asset separate', () => {
    const msft = expiredTarget({
      targetId: 'pt-msft-bull',
      id: 'n-msft',
      context_id: MSFT,
      context_data: {
        organization_id: ORG,
        asset_id: MSFT,
        asset_symbol: 'MSFT',
        price_target_id: 'pt-msft-bull',
      },
    })

    const out = consolidateNotifications([...AMZN_SIX.slice(0, 3), msft])

    expect(out).toHaveLength(2)
    expect(out.map(n => n.context_data?.asset_symbol)).toEqual(['AMZN', 'MSFT'])
  })

  it('keeps the same asset in a different organization separate', () => {
    const other = expiredTarget({
      targetId: 'pt-bull',
      id: 'n-other-org',
      context_data: {
        organization_id: '44444444-4444-4444-4444-444444444444',
        asset_id: AMZN,
        asset_symbol: 'AMZN',
        price_target_id: 'pt-bull',
      },
    })

    expect(consolidateNotifications([expiredTarget({ targetId: 'pt-bull' }), other])).toHaveLength(2)
  })

  it('keeps expiries found in different sweeps separate', () => {
    const march = expiredTarget({ targetId: 'pt-bull', created_at: '2026-03-15T09:00:00.000Z' })
    const april = expiredTarget({
      targetId: 'pt-base',
      id: 'n-april',
      created_at: '2026-04-15T09:00:00.000Z',
    })

    expect(consolidateNotifications([march, april])).toHaveLength(2)
  })
})

describe('notifications that were never duplicated are left alone', () => {
  const singles: GroupableNotification[] = [
    {
      id: 's1', type: 'note_shared', title: 'Note shared: Q1 review',
      message: 'Ada shared a note with you', context_type: 'note', context_id: 'note-1',
      created_at: '2026-03-15T09:00:00.000Z', context_data: {},
    },
    {
      id: 's2', type: 'new_message', title: 'New message from Ada',
      message: 'Ada: are you around?', context_type: 'conversation', context_id: 'conv-1',
      created_at: '2026-03-15T09:01:00.000Z', context_data: { conversation_id: 'conv-1' },
    },
    {
      id: 's3', type: 'mention', title: 'You were mentioned',
      message: 'Ada mentioned you', context_type: 'conversation', context_id: 'conv-1',
      created_at: '2026-03-15T09:02:00.000Z', context_data: { conversation_id: 'conv-1' },
    },
  ]

  it('passes ungrouped types through untouched, in order', () => {
    const out = consolidateNotifications(singles)

    expect(out).toHaveLength(3)
    expect(out.map(n => n.id)).toEqual(['s1', 's2', 's3'])
    expect(out.map(n => n.title)).toEqual(singles.map(n => n.title))
    expect(out.every(n => n.groupCount === 1)).toBe(true)
  })

  it('gives them no group key, so the database never folds them either', () => {
    expect(singles.map(notificationGroupKey)).toEqual([null, null, null])
  })

  it('leaves a lone expired target reading exactly as it did', () => {
    const [only] = consolidateNotifications([expiredTarget({ targetId: 'pt-bull' })])

    expect(only.title).toBe('Price Target Expired: AMZN Bull')
    expect(only.message).toContain('expired on Mar 14, 2026')
    expect(only.groupCount).toBe(1)
  })
})

describe('the consolidated notification can be acted on', () => {
  it('points at the asset, which is where three targets get reviewed', () => {
    const [amzn] = consolidateNotifications(AMZN_SIX)

    expect(amzn.context_type).toBe('asset')
    expect(amzn.context_id).toBe(AMZN)
    expect(amzn.context_data?.asset_symbol).toBe('AMZN')
  })

  it('keeps every contributing record, so the count can be audited', () => {
    const [amzn] = consolidateNotifications(AMZN_SIX)

    expect(amzn.contributingIds).toHaveLength(amzn.groupCount)
  })

  it('carries the folded rows so marking it read clears all of them', () => {
    const [amzn] = consolidateNotifications(AMZN_SIX)

    // Five rows folded into the first; all six must clear together, or the
    // header badge stays lit for a situation the reader has dealt with.
    expect([amzn.id, ...amzn.memberNotificationIds].sort())
      .toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6'])
  })

  it('stays unread while any folded row is unread', () => {
    const read = { ...expiredTarget({ targetId: 'pt-bull', id: 'r1' }), is_read: true }
    const unread = { ...expiredTarget({ targetId: 'pt-base', id: 'r2' }), is_read: false }

    expect(consolidateNotifications([read, unread])[0].is_read).toBe(false)
  })
})

describe('the client and the database build the same key', () => {
  const sql = readFileSync(
    resolve(__dirname, '../../../../supabase/migrations/20260907120000_notification_semantic_grouping.sql'),
    'utf8',
  )

  it('uses the same template in notification_group_key', () => {
    // Whitespace-insensitive: what must not drift is the separators and the
    // order of the parts.
    const template = sql.replace(/\s+/g, ' ')
    expect(template).toContain("'|org:' || COALESCE(p_org::text, '-')")
    expect(template).toContain("'|pf:' || COALESCE(p_portfolio::text, '-')")
    expect(template).toContain("'|asset:' || p_asset::text")
    expect(template).toContain("'|w:' || COALESCE(p_window, '-')")
  })

  it('uses the same situation slug for expired targets', () => {
    const key = notificationGroupKey(expiredTarget({ targetId: 'pt-bull' }))
    expect(key?.startsWith('price_target_expired|')).toBe(true)
    expect(sql).toContain("'price_target_expired',")
  })

  it('buckets the window by UTC calendar day in both', () => {
    const key = notificationGroupKey(expiredTarget({ targetId: 'pt-bull' }))
    expect(key?.endsWith('|w:2026-03-15')).toBe(true)
    expect(sql).toContain("to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD')")
  })

  it('refuses to group when there is no asset, in both', () => {
    const noAsset = expiredTarget({ targetId: 'pt-bull', context_type: 'price_target', context_data: {} })
    expect(notificationGroupKey(noAsset)).toBeNull()
    expect(sql.replace(/\s+/g, ' ')).toContain('WHEN p_asset IS NULL THEN NULL')
  })

  it('enforces one row per semantic identity in storage', () => {
    // Without this index the fold is cosmetic: two producers still write two
    // rows and only the reader sees one.
    expect(sql.replace(/\s+/g, ' ')).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS notifications_user_group_key_uniq ON public.notifications (user_id, group_key) WHERE group_key IS NOT NULL',
    )
  })

  it('claims outcome rows before emitting, so overlapping sweeps cannot double up', () => {
    // The 3 -> 6 mechanism itself: two concurrent read-then-write sweeps.
    // Both entry points must claim, so comment lines are stripped before
    // counting — a mention in the rationale is not a lock.
    const code = sql.split('\n').filter(l => !l.trim().startsWith('--')).join('\n')
    const claims = code.match(/FOR UPDATE OF pto SKIP LOCKED/g) ?? []
    expect(claims).toHaveLength(2)
  })

  it('leaves exactly one producer of the alert', () => {
    const template = sql.replace(/\s+/g, ' ')
    expect(template).toContain('CREATE OR REPLACE FUNCTION public.process_all_expired_price_targets()')
    expect(template).toContain('RETURN process_expired_price_targets();')
  })
})
