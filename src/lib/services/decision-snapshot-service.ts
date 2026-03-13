/**
 * Decision Price Snapshot Service
 *
 * Captures the market price at the moment a trade idea reaches
 * a terminal outcome (approved/executed, rejected, deferred).
 *
 * Primary consumer: Decision Outcomes page (delay cost, move since decision).
 *
 * METRIC HONESTY:
 * - Price source: assets.current_price (DB-cached, not real-time intraday)
 * - This is a directional proxy adequate for process analysis
 * - Not suitable for exact fill-price attribution or intraday slippage measurement
 */

import { supabase } from '../supabase'

// ============================================================
// Types
// ============================================================

export type SnapshotType = 'approval' | 'rejection' | 'cancellation'
export type PriceSource = 'db_cached' | 'live_quote' | 'manual' | 'backfill'

export interface DecisionPriceSnapshot {
  id: string
  trade_queue_item_id: string
  asset_id: string
  portfolio_id: string | null
  snapshot_type: SnapshotType
  snapshot_price: number
  snapshot_at: string
  price_source: PriceSource
  created_at: string
  created_by: string | null
}

// ============================================================
// Snapshot Capture
// ============================================================

/**
 * Capture the current asset price as a decision-time snapshot.
 *
 * Called from moveTradeIdea() when an outcome is set.
 * Uses upsert to handle re-approvals gracefully (updates existing snapshot).
 *
 * This is fire-and-forget from the caller's perspective —
 * a failed snapshot should not block the state transition.
 */
export async function captureDecisionPriceSnapshot(params: {
  tradeQueueItemId: string
  assetId: string
  portfolioId: string | null
  snapshotType: SnapshotType
  actorId?: string
  /** Override price (for backfill or manual). If omitted, fetches from assets.current_price */
  overridePrice?: number
  overridePriceSource?: PriceSource
}): Promise<{ success: boolean; snapshot?: DecisionPriceSnapshot; error?: string }> {
  const {
    tradeQueueItemId,
    assetId,
    portfolioId,
    snapshotType,
    actorId,
    overridePrice,
    overridePriceSource,
  } = params

  try {
    // Get the price
    let price: number
    let priceSource: PriceSource

    if (overridePrice != null) {
      price = overridePrice
      priceSource = overridePriceSource || 'manual'
    } else {
      // Fetch current_price from assets table
      const { data: asset, error: assetError } = await supabase
        .from('assets')
        .select('current_price')
        .eq('id', assetId)
        .single()

      if (assetError || !asset?.current_price) {
        return {
          success: false,
          error: `No current_price for asset ${assetId}: ${assetError?.message || 'null price'}`,
        }
      }

      price = Number(asset.current_price)
      priceSource = 'db_cached'
    }

    if (price <= 0 || !isFinite(price)) {
      return { success: false, error: `Invalid price: ${price}` }
    }

    // Upsert — handles re-approvals by updating the existing snapshot
    const { data, error } = await supabase
      .from('decision_price_snapshots')
      .upsert(
        {
          trade_queue_item_id: tradeQueueItemId,
          asset_id: assetId,
          portfolio_id: portfolioId || null,
          snapshot_type: snapshotType,
          snapshot_price: price,
          snapshot_at: new Date().toISOString(),
          price_source: priceSource,
          created_by: actorId || null,
        },
        { onConflict: 'trade_queue_item_id,snapshot_type' },
      )
      .select()
      .single()

    if (error) {
      return { success: false, error: `Upsert failed: ${error.message}` }
    }

    return { success: true, snapshot: data as DecisionPriceSnapshot }
  } catch (err: any) {
    console.error('[decision-snapshot] Failed to capture snapshot:', err)
    return { success: false, error: err.message }
  }
}

// ============================================================
// Snapshot Queries
// ============================================================

/**
 * Fetch approval snapshots for a batch of trade_queue_item IDs.
 * Returns a Map keyed by trade_queue_item_id for O(1) lookup.
 */
export async function fetchDecisionSnapshots(
  tradeQueueItemIds: string[],
  snapshotType: SnapshotType = 'approval',
): Promise<Map<string, DecisionPriceSnapshot>> {
  if (tradeQueueItemIds.length === 0) return new Map()

  const { data, error } = await supabase
    .from('decision_price_snapshots')
    .select('*')
    .in('trade_queue_item_id', tradeQueueItemIds)
    .eq('snapshot_type', snapshotType)

  if (error) {
    console.error('[decision-snapshot] Failed to fetch snapshots:', error)
    return new Map()
  }

  const map = new Map<string, DecisionPriceSnapshot>()
  for (const row of data || []) {
    map.set(row.trade_queue_item_id, {
      ...row,
      snapshot_price: Number(row.snapshot_price),
    } as DecisionPriceSnapshot)
  }
  return map
}

// ============================================================
// Outcome → SnapshotType mapping
// ============================================================

/**
 * Map a trade outcome to the appropriate snapshot type.
 * Returns null for outcomes that don't need a snapshot (e.g., deferred).
 */
export function outcomeToSnapshotType(outcome: string): SnapshotType | null {
  switch (outcome) {
    case 'executed':
    case 'accepted':
      return 'approval'
    case 'rejected':
      return 'rejection'
    // 'deferred' doesn't need a snapshot — the decision isn't terminal
    default:
      return null
  }
}
