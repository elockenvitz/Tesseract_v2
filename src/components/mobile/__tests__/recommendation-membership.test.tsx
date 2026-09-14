/**
 * "Added to simulation" on a recommendation follows the simulation.
 *
 * ── The defect ────────────────────────────────────────────────────────────
 *
 * Added-state lived in two proposal-id sets in SimulationPage state, filled once
 * on load and changed only by the recommendation's own toggle. Removing the
 * trade any other way — the table row's remove, the Delete key, the phone
 * sizing sheet's trash — left the set behind, so reopening Ideas &
 * recommendations still said Added until a hard refresh. And the phone trash
 * deleted only the variant, leaving the `simulation_trades` row itself.
 *
 * ── What these drive ──────────────────────────────────────────────────────
 *
 * The real phone drawer, fed the page's own rule — `deriveProposalMembership`
 * over persisted trades plus the per-asset overrides — through the lifecycle
 * the page runs: tap (override), write (row or no row), converge (override
 * cleared). Then the page wiring, on source.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi } from 'vitest'
import { render, within } from '@testing-library/react'
import { MobileIdeasDrawer } from '../trade-lab/MobileIdeasDrawer'
import {
  deriveProposalMembership, type MembershipProposal, type MembershipTrade,
} from '../../../lib/trade-lab/proposal-membership'
import { TRADE_LAB_STEP1_EVENT, reportTradeLabStep1 } from '../../../lib/pilot/trade-lab-basics'

const TUTORIAL = 'tq-lly'
const AAPL_ITEM = 'tq-aapl'
const AAPL = 'asset-aapl'

/** The seeded AAPL recommendation, as the drawer and the page both see it. */
const proposalItem = {
  type: 'proposal',
  isPairTrade: false,
  legs: [],
  proposal: {
    id: 'prop-aapl',
    trade_queue_item_id: AAPL_ITEM,
    weight: 2,
    users: { first_name: 'Pilot', last_name: '' },
    trade_queue_items: { id: AAPL_ITEM, action: 'buy', assets: { id: AAPL, symbol: 'AAPL', company_name: 'Apple Inc.' } },
  },
}
const membershipProposals: MembershipProposal[] = [
  { id: 'prop-aapl', targets: [{ assetId: AAPL, tradeQueueItemId: AAPL_ITEM }] },
]

const written = (): MembershipTrade => ({ id: 'st-aapl', asset_id: AAPL, trade_queue_item_id: AAPL_ITEM })

/** One render of Ideas & recommendations against a state of the page. */
function openPanel(trades: MembershipTrade[], overrides: Map<string, boolean>) {
  const { appliedProposalIds } = deriveProposalMembership(membershipProposals, trades, overrides)
  const view = render(
    <MobileIdeasDrawer
      currentPortfolioId="p-1"
      items={[]}
      proposals={[proposalItem]}
      search=""
      onSearchChange={vi.fn()}
      onToggleAsset={vi.fn()}
      onOpenIdea={vi.fn()}
      onToggleProposal={vi.fn()}
      isProposalAdded={(p: typeof proposalItem) => appliedProposalIds.has(p.proposal.id)}
    />,
  )
  const label = () => {
    const btn = within(view.container).getAllByRole('button').find(b => /Add to simulation|Added — tap to remove/.test(b.textContent ?? ''))
    return btn?.textContent?.includes('Added') ? 'Added' : 'Add'
  }
  return { ...view, label }
}

describe('adding a recommendation', () => {
  it('says Added once tapped, stays Added once written, and completes the local step', () => {
    // Tap: the add path sets the asset override.
    const tapped = openPanel([], new Map([[AAPL, true]]))
    expect(tapped.label()).toBe('Added')
    tapped.unmount()

    // Write succeeded: the row is in the cache and the success handler reports.
    const events: string[] = []
    const fired = reportTradeLabStep1([written()], TUTORIAL, { fromRecommendation: true }, {
      dispatchEvent: (e: Event) => { events.push(e.type); return true },
    })
    expect(fired).toBe(true)
    expect(events).toEqual([TRADE_LAB_STEP1_EVENT])

    // Converged: override cleared, membership is the persisted row.
    const converged = openPanel([written()], new Map())
    expect(converged.label()).toBe('Added')
  })

  it('shows nothing added and completes nothing when the add fails', () => {
    // onError clears the override and no row was written.
    const failed = openPanel([], new Map())
    expect(failed.label()).toBe('Add')
    expect(reportTradeLabStep1([], TUTORIAL, { fromRecommendation: true }, { dispatchEvent: () => { throw new Error('must not fire') } })).toBe(false)
  })
})

describe('removing it from the table', () => {
  it('returns to Add immediately', () => {
    // handleRemoveAsset: override false, and the trade dropped from the cache.
    const removing = openPanel([], new Map([[AAPL, false]]))
    expect(removing.label()).toBe('Add')
  })

  it('returns to Add even while the stale trade is still in the cache', () => {
    const removing = openPanel([written()], new Map([[AAPL, false]]))
    expect(removing.label()).toBe('Add')
  })

  it('is still Add when the panel is reopened after the delete lands', () => {
    const first = openPanel([], new Map())
    expect(first.label()).toBe('Add')
    first.unmount()
    const reopened = openPanel([], new Map())
    expect(reopened.label()).toBe('Add')
  })

  it('is still Add after a hard refresh — nothing but the persisted rows', () => {
    const afterRefresh = deriveProposalMembership(membershipProposals, [], new Map())
    expect(afterRefresh.appliedProposalIds.has('prop-aapl')).toBe(false)
    expect(openPanel([], new Map()).label()).toBe('Add')
  })

  it('goes back to Added when the removal fails and the refetch still has the row', () => {
    // removeTradeMutation.onError clears the false override; onSettled refetches.
    const failedRemove = openPanel([written()], new Map())
    expect(failedRemove.label()).toBe('Added')
  })
})

describe('what membership is made of', () => {
  it('ignores temp placeholder rows', () => {
    const temp = { id: 'temp-leg-aapl', asset_id: AAPL, trade_queue_item_id: AAPL_ITEM }
    expect(deriveProposalMembership(membershipProposals, [temp], new Map()).appliedProposalIds.size).toBe(0)
  })

  it('reads the source idea, not just the asset', () => {
    const otherIdeaSameAsset = { id: 'st-2', asset_id: AAPL, trade_queue_item_id: 'tq-someone-else' }
    expect(deriveProposalMembership(membershipProposals, [otherIdeaSameAsset], new Map()).appliedProposalIds.size).toBe(0)
  })

  it('drops a trade that was unlinked from its idea', () => {
    const unlinked = { id: 'st-aapl', asset_id: AAPL, trade_queue_item_id: null }
    expect(deriveProposalMembership(membershipProposals, [unlinked], new Map()).appliedProposalIds.size).toBe(0)
  })

  it('needs every leg of a pair recommendation', () => {
    const pair: MembershipProposal[] = [{ id: 'prop-pair', targets: [
      { assetId: 'a-long', tradeQueueItemId: 'tq-long' },
      { assetId: 'a-short', tradeQueueItemId: 'tq-short' },
    ] }]
    const oneLeg = [{ id: 's1', asset_id: 'a-long', trade_queue_item_id: 'tq-long' }]
    const bothLegs = [...oneLeg, { id: 's2', asset_id: 'a-short', trade_queue_item_id: 'tq-short' }]
    expect(deriveProposalMembership(pair, oneLeg, new Map()).appliedProposalIds.has('prop-pair')).toBe(false)
    const both = deriveProposalMembership(pair, bothLegs, new Map())
    expect(both.appliedProposalIds.has('prop-pair')).toBe(true)
    expect([...both.proposalAddedAssetIds].sort()).toEqual(['a-long', 'a-short'])
  })
})

describe('the page wiring', () => {
  const page = readFileSync(path.join(process.cwd(), 'src/pages/SimulationPage.tsx'), 'utf8')
  const list = readFileSync(path.join(process.cwd(), 'src/components/mobile/trade-lab/MobileSimulationList.tsx'), 'utf8')

  it('derives recommendation membership instead of holding it in state', () => {
    expect(page).not.toMatch(/useState<Set<string>>\(new Set\(\)\)\s*\n\s*\n?\s*\/\/ Track asset_ids that were added via proposals/)
    expect(page).not.toContain('setAppliedProposalIds')
    expect(page).not.toContain('setProposalAddedAssetIds')
    expect(page).not.toContain('hydratedRef')
    expect(page).toContain('const { appliedProposalIds, proposalAddedAssetIds } = useMemo(() => {')
    expect(page).toContain('return deriveProposalMembership(proposals, simulation?.simulation_trades as MembershipTrade[] | undefined, checkboxOverrides)')
  })

  it('feeds the drawer from that derivation', () => {
    expect(page).toContain('isProposalAdded={(p) => isProposalInSimulation(p)}')
    expect(page).toContain('(proposalItem: ProposalItem) => appliedProposalIds.has((proposalItem.proposal as any)?.id)')
  })

  it('takes the trade out, not just the variant, from the phone sizing sheet', () => {
    expect(page).toMatch(/onDeleteVariant=\{handleVariantDelete\}\s*\n\s*onRemoveAsset=\{handleRemoveAsset\}/)
    const onRemove = list.slice(list.indexOf('onRemove={'), list.indexOf('onClose={() => setEditing(null)}'))
    expect(onRemove).toContain('onRemoveAsset(editingRow.asset_id)')
  })
})
