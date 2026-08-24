import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

/**
 * The merge blocker: the card showed $355 / $370 / $390 and Review cases showed
 * "Not set" on every row, at the same moment, for the same asset.
 *
 * The two read different SCOPES. `useScenarioCards` selects targets by
 * `organization_id` with no user filter, so the card shows whichever analyst
 * published the ladder. This sheet picked `user_id === viewFilter` — the
 * signed-in reader — and on a name covered by somebody else that find returns
 * nothing.
 *
 * Making the card user-scoped instead would change which signals fire, so the
 * editor follows the card rather than the other way round.
 */

const TARGETS = [
  { id: 't1', scenario_id: 's-bear', user_id: 'analyst-a', price: 355, timeframe: '6 months', is_official: true, probability: null },
  { id: 't2', scenario_id: 's-base', user_id: 'analyst-a', price: 370, timeframe: '3 months', is_official: true, probability: null },
  { id: 't3', scenario_id: 's-bull', user_id: 'analyst-a', price: 390, timeframe: '12 months', is_official: true, probability: null },
]
const SCENARIOS = [
  { id: 's-bear', name: 'Bear', color: '#f00', is_default: true },
  { id: 's-base', name: 'Base', color: '#888', is_default: true },
  { id: 's-bull', name: 'Bull', color: '#0f0', is_default: true },
]

const savePriceTarget = { mutate: vi.fn(), isPending: false }
let signedInAs = 'reader-b'
let targets: typeof TARGETS = TARGETS

vi.mock('../../../../hooks/useAnalystPriceTargets', () => ({
  useAnalystPriceTargets: () => ({ priceTargets: targets, isLoading: false, savePriceTarget }),
}))
vi.mock('../../../../hooks/useScenarios', () => ({
  useScenarios: () => ({ scenarios: SCENARIOS, isLoading: false }),
}))
vi.mock('../../../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { id: signedInAs } }),
}))

import { MobileCaseTargets } from '../MobileCaseTargets'

beforeEach(() => { signedInAs = 'reader-b'; targets = TARGETS })

describe('the editor opens on the ladder the card is describing', () => {
  it('shows the published targets when none of them are the reader’s own', () => {
    render(<MobileCaseTargets assetId="a1" currentPrice={274.56} viewFilter="reader-b" />)
    expect(screen.queryByText('Not set')).toBeNull()
    for (const v of ['355', '370', '390']) {
      expect(screen.getByText(new RegExp(`\\$?${v}`))).toBeTruthy()
    }
  })

  it('says whose targets they are, so "your cases" is not implied', () => {
    render(<MobileCaseTargets assetId="a1" currentPrice={274.56} viewFilter="reader-b" />)
    expect(screen.getAllByTestId('case-target-borrowed')).toHaveLength(3)
  })

  it('prefers the reader’s own target where they have one', () => {
    signedInAs = 'analyst-a'
    render(<MobileCaseTargets assetId="a1" currentPrice={274.56} viewFilter="analyst-a" />)
    // Their own, so nothing is borrowed.
    expect(screen.queryAllByTestId('case-target-borrowed')).toHaveLength(0)
    expect(screen.queryByText('Not set')).toBeNull()
  })

  it('still says Not set when there is genuinely nothing published', () => {
    // The message is correct in its own right — it just must not appear on a
    // ladder the card is rendering at the same moment.
    targets = []
    render(<MobileCaseTargets assetId="a1" currentPrice={274.56} viewFilter="reader-b" />)
    expect(screen.getAllByText('Not set')).toHaveLength(3)
    expect(screen.queryAllByTestId('case-target-borrowed')).toHaveLength(0)
  })

  it('keeps every scenario row, in the sheet’s own highest-first order', () => {
    render(<MobileCaseTargets assetId="a1" currentPrice={274.56} viewFilter="reader-b" />)
    const names = screen.getAllByText(/^(Bear|Base|Bull)$/).map(n => n.textContent)
    // Highest first, which is how this sheet and the Cases pane both read.
    // Unchanged by this pass.
    expect(names).toEqual(['Bull', 'Base', 'Bear'])
  })
})
