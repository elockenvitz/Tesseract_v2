import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrganizationGovernanceHeader } from '../OrganizationGovernanceHeader'
import type { OrgGraph, RiskCounts } from '../../../lib/org-graph'

function makeOrgGraph(overrides: Partial<OrgGraph> = {}): OrgGraph {
  return {
    nodes: new Map(),
    rootIds: [],
    overallHealth: 72,
    totalNodes: 11,
    totalMembers: 24,
    totalPortfolios: 5,
    totalTeams: 3,
    totalRiskFlags: 4,
    ...overrides,
  }
}

describe('OrganizationGovernanceHeader', () => {
  it('renders org health score', () => {
    const graph = makeOrgGraph({ overallHealth: 65 })
    const counts: RiskCounts = { high: 1, medium: 2, low: 1, total: 4 }
    render(
      <OrganizationGovernanceHeader
        orgGraph={graph}
        riskCounts={counts}
        adminCount={2}
        coverageAdminCount={3}
        isOrgAdmin={false}
      />
    )
    expect(screen.getByText('65%')).toBeInTheDocument()
    expect(screen.getByText('Governance')).toBeInTheDocument()
    expect(screen.getByText('Org Health')).toBeInTheDocument()
  })

  it('renders entity counts', () => {
    const graph = makeOrgGraph()
    const counts: RiskCounts = { high: 0, medium: 0, low: 0, total: 0 }
    render(
      <OrganizationGovernanceHeader
        orgGraph={graph}
        riskCounts={counts}
        adminCount={2}
        coverageAdminCount={1}
        isOrgAdmin={false}
      />
    )
    expect(screen.getByText('11')).toBeInTheDocument() // nodes
    expect(screen.getByText('Nodes')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Members')).toBeInTheDocument()
    expect(screen.getByText('Portfolios')).toBeInTheDocument()
  })

  it('shows zero-count risk badges when counts are zero (showZero)', () => {
    const graph = makeOrgGraph()
    const counts: RiskCounts = { high: 0, medium: 0, low: 0, total: 0 }
    render(
      <OrganizationGovernanceHeader
        orgGraph={graph}
        riskCounts={counts}
        adminCount={1}
        coverageAdminCount={0}
        isOrgAdmin={false}
      />
    )
    // All three severity labels should be visible even at 0
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  it('renders risk count badges when risks exist', () => {
    const graph = makeOrgGraph()
    const counts: RiskCounts = { high: 2, medium: 3, low: 1, total: 6 }
    render(
      <OrganizationGovernanceHeader
        orgGraph={graph}
        riskCounts={counts}
        adminCount={1}
        coverageAdminCount={0}
        isOrgAdmin={false}
      />
    )
    expect(screen.getByText('High')).toBeInTheDocument()
    expect(screen.getByText('Medium')).toBeInTheDocument()
    expect(screen.getByText('Low')).toBeInTheDocument()
  })

  it('calls onRiskFilterClick when a risk badge is clicked', () => {
    const graph = makeOrgGraph()
    const counts: RiskCounts = { high: 2, medium: 1, low: 0, total: 3 }
    const onFilter = vi.fn()
    render(
      <OrganizationGovernanceHeader
        orgGraph={graph}
        riskCounts={counts}
        adminCount={1}
        coverageAdminCount={0}
        isOrgAdmin={false}
        onRiskFilterClick={onFilter}
      />
    )
    fireEvent.click(screen.getByText('High'))
    expect(onFilter).toHaveBeenCalledWith('high')

    fireEvent.click(screen.getByText('Medium'))
    expect(onFilter).toHaveBeenCalledWith('medium')
  })

  it('highlights active risk filter badge', () => {
    const graph = makeOrgGraph()
    const counts: RiskCounts = { high: 2, medium: 1, low: 0, total: 3 }
    const { container } = render(
      <OrganizationGovernanceHeader
        orgGraph={graph}
        riskCounts={counts}
        adminCount={1}
        coverageAdminCount={0}
        isOrgAdmin={false}
        activeRiskFilter="high"
        onRiskFilterClick={() => {}}
      />
    )
    // The active badge should have ring styling
    const highBadge = screen.getByText('High').closest('button')
    expect(highBadge?.className).toContain('ring')
  })
})
