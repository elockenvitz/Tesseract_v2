/**
 * Pair trade info helpers — used by both the Trade Book (AcceptedTradesTable)
 * and the Trade Lab (HoldingsSimulationTable) to render pair legs with a
 * "↔ pair" badge and to keep legs visually adjacent.
 *
 * Pair identity is derived from two fields on trade_queue_items: the newer
 * `pair_id` grouping field, and the legacy `pair_trade_id` FK. We prefer
 * `pair_id` and fall back to `pair_trade_id` for back-compat.
 */

export interface PairLegInfo {
  /** Normalized pair identifier (pair_id or legacy pair_trade_id) */
  pairId: string
  /** Symbols of the OTHER legs in the same pair, excluding this asset */
  partnerSymbols: string[]
  /** This leg's direction label: 'long'/'short' from pair_leg_type, or
   *  fallback inferred from the action ('buy'/'add' → long, 'sell'/'trim' → short). */
  direction: 'long' | 'short' | null
}

interface PairSource {
  asset_id: string
  symbol: string | null | undefined
  pair_id: string | null | undefined
  pair_trade_id?: string | null | undefined
  pair_leg_type?: 'long' | 'short' | null | undefined
  action?: string | null | undefined
}

/**
 * Build a map from asset_id → pair info. Input is any array of objects that
 * expose asset_id, symbol, and the pair_id/pair_trade_id/pair_leg_type fields
 * (e.g. trade_queue_items, or accepted_trades with the trade_queue_item join
 * flattened onto the top-level record).
 *
 * Assets that are not part of any pair are omitted from the returned map.
 */
export function buildPairInfoByAsset(
  sources: PairSource[],
): Map<string, PairLegInfo> {
  // Group sources by normalized pair id
  const pairGroups = new Map<string, PairSource[]>()
  for (const src of sources) {
    const pid = src.pair_id || src.pair_trade_id
    if (!pid) continue
    const arr = pairGroups.get(pid) || []
    arr.push(src)
    pairGroups.set(pid, arr)
  }

  const out = new Map<string, PairLegInfo>()
  for (const [pid, legs] of pairGroups) {
    // A "pair" requires at least two legs. Singletons with a pair_id but no
    // sibling are treated as orphans — no badge.
    if (legs.length < 2) continue
    for (const leg of legs) {
      const partnerSymbols = legs
        .filter(l => l.asset_id !== leg.asset_id)
        .map(l => l.symbol || '?')
      let direction: 'long' | 'short' | null = null
      if (leg.pair_leg_type === 'long' || leg.pair_leg_type === 'short') {
        direction = leg.pair_leg_type
      } else if (leg.action === 'buy' || leg.action === 'add') {
        direction = 'long'
      } else if (leg.action === 'sell' || leg.action === 'trim') {
        direction = 'short'
      }
      out.set(leg.asset_id, { pairId: pid, partnerSymbols, direction })
    }
  }
  return out
}
