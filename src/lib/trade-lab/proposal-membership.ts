/**
 * Whether a recommendation is in the simulation — derived, never remembered.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * "Added to simulation" on a recommendation read two sets of proposal ids held
 * in component state. They were filled once from the database on load and
 * then only by the recommendation's own toggle, so every other way a trade
 * leaves the simulation — the row's remove control, the Delete key, the phone
 * sizing sheet's trash, clear all — left the set behind. The trade was gone
 * from `simulation_trades` and the panel still said Added, on every reopen,
 * until a hard refresh rebuilt the set from scratch.
 *
 * ── The truth ─────────────────────────────────────────────────────────────
 *
 * A recommendation is in the simulation when the simulation holds a persisted
 * trade for its source idea — `simulation_trades.trade_queue_item_id` — which
 * is what the add writes and what every removal deletes. The page's per-asset
 * `checkboxOverrides` sit on top for the moment between a tap and its write:
 * the add and remove paths set them, a failed write clears them, and the
 * convergence effect clears them once the server agrees. So a failed add or
 * remove falls back to what is persisted, not to what was hoped.
 *
 * Temp rows (`temp-…`) are placeholders drawn before a write returns; they are
 * not membership.
 *
 * Pure: no React, no Supabase.
 */

export interface MembershipTrade {
  id: string
  asset_id: string
  trade_queue_item_id: string | null
}

/** One trade a recommendation puts in the simulation: a single idea, or one pair leg. */
export interface ProposalTarget {
  assetId: string | null | undefined
  tradeQueueItemId: string | null | undefined
}

export interface MembershipProposal {
  id: string
  targets: ProposalTarget[]
}

export interface ProposalMembership {
  appliedProposalIds: Set<string>
  /** Assets currently in the simulation because of a recommendation. */
  proposalAddedAssetIds: Set<string>
}

function persisted(trades: ReadonlyArray<MembershipTrade> | null | undefined) {
  const byItem = new Set<string>()
  const byAsset = new Set<string>()
  for (const t of trades ?? []) {
    if (!t || String(t.id).startsWith('temp-')) continue
    if (t.trade_queue_item_id) byItem.add(t.trade_queue_item_id)
    byAsset.add(t.asset_id)
  }
  return { byItem, byAsset }
}

export function deriveProposalMembership(
  proposals: ReadonlyArray<MembershipProposal>,
  trades: ReadonlyArray<MembershipTrade> | null | undefined,
  overrides: ReadonlyMap<string, boolean>,
): ProposalMembership {
  const { byItem, byAsset } = persisted(trades)
  const appliedProposalIds = new Set<string>()
  const proposalAddedAssetIds = new Set<string>()

  for (const p of proposals) {
    const targets = p.targets.filter(t => t.assetId || t.tradeQueueItemId)
    if (targets.length === 0) continue

    const present = targets.every(t => {
      if (t.assetId && overrides.has(t.assetId)) return overrides.get(t.assetId) === true
      // The source idea is the membership fact; the asset stands in only for a
      // target whose idea could not be resolved.
      if (t.tradeQueueItemId) return byItem.has(t.tradeQueueItemId)
      return !!t.assetId && byAsset.has(t.assetId)
    })

    if (present) {
      appliedProposalIds.add(p.id)
      for (const t of targets) if (t.assetId) proposalAddedAssetIds.add(t.assetId)
    }
  }

  return { appliedProposalIds, proposalAddedAssetIds }
}
