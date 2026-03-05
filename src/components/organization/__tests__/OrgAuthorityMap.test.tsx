import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrgAuthorityMap } from '../OrgAuthorityMap'
import type { AuthorityRow, AuthoritySummary } from '../../../lib/authority-map'
import type { OrgPermissions } from '../../../lib/permissions/orgGovernance'
import type { OrgGraph } from '../../../lib/org-graph'

// ─── Helpers ────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<AuthorityRow> & { userId: string }): AuthorityRow {
  return {
    fullName: overrides.userId,
    email: `${overrides.userId}@test.com`,
    avatarUrl: null,
    isOrgAdmin: false,
    isGlobalCoverageAdmin: false,
    roleChips: ['Analyst'],
    scopeSummary: '1 team',
    coverageScopes: [],
    teams: [{ nodeId: 'node-1', nodeName: 'Team A', role: 'Analyst', nodePath: [], isCoverageAdmin: false, coverageAdminBlocked: false }],
    portfolios: [],
    riskFlags: [],
    riskSeverity: null,
    ...overrides,
  }
}

function makeSummary(overrides: Partial<AuthoritySummary> = {}): AuthoritySummary {
  return {
    totalUsers: 3,
    orgAdminCount: 1,
    globalCoverageAdminCount: 1,
    nodeCoverageAdminCount: 0,
    pmCount: 1,
    flaggedUserCount: 0,
    riskBySeverity: { high: 0, medium: 0, low: 0 },
    ...overrides,
  }
}

function makeOrgPerms(overrides: Partial<OrgPermissions> = {}): OrgPermissions {
  return {
    role: 'COMPLIANCE',
    canViewGovernance: true,
    canManageOrgStructure: false,
    canViewPermissionsView: true,
    canViewAccessSection: true,
    isInvestmentOnly: false,
    ...overrides,
  }
}

const emptyGraph: OrgGraph = {
  nodes: new Map(),
  rootIds: [],
  overallHealth: 100,
  totalNodes: 0,
  totalMembers: 0,
  totalPortfolios: 0,
  totalTeams: 0,
  totalRiskFlags: 0,
}

const defaultRows: AuthorityRow[] = [
  makeRow({
    userId: 'alice',
    fullName: 'Alice Adams',
    isOrgAdmin: true,
    roleChips: ['Org Admin', 'PM'],
    scopeSummary: '2 teams · 1 portfolio',
    teams: [
      { nodeId: 'n1', nodeName: 'Equity Research', role: 'PM', nodePath: [], isCoverageAdmin: false, coverageAdminBlocked: false },
      { nodeId: 'n2', nodeName: 'Fixed Income', role: 'Analyst', nodePath: [], isCoverageAdmin: false, coverageAdminBlocked: false },
    ],
    portfolios: [{ nodeId: 'p1', nodeName: 'Growth Fund', role: 'PM', parentTeamName: 'Equity Research' }],
  }),
  makeRow({
    userId: 'bob',
    fullName: 'Bob Baker',
    roleChips: ['Analyst'],
    scopeSummary: '1 team',
  }),
  makeRow({
    userId: 'charlie',
    fullName: 'Charlie Clark',
    isGlobalCoverageAdmin: true,
    roleChips: ['Coverage Admin', 'Analyst'],
    scopeSummary: 'Coverage: Global · Teams: 1',
    coverageScopes: [{ type: 'global' }],
    riskFlags: [{
      type: 'single_point_of_failure',
      severity: 'high',
      label: 'Single point of coverage on Team C',
      detail: 'Charlie Clark is the only assigned member on Team C. If unavailable, this team would have no active coverage.',
      anchorNodeId: 'n3',
    }],
    riskSeverity: 'high',
  }),
]

// ─── Tests ──────────────────────────────────────────────────────────────

describe('OrgAuthorityMap', () => {
  it('renders summary strip with correct counts', () => {
    const summary = makeSummary({ orgAdminCount: 2, pmCount: 5, flaggedUserCount: 1, riskBySeverity: { high: 1, medium: 0, low: 0 } })
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={summary}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    expect(screen.getByText('Org Admins')).toBeInTheDocument()
    expect(screen.getAllByText('2').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('PMs')).toBeInTheDocument()
    expect(screen.getByText('5')).toBeInTheDocument()
  })

  it('renders table with correct column headers', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('Admin Roles')).toBeInTheDocument()
    expect(screen.getByText('Portfolio Roles')).toBeInTheDocument()
    expect(screen.getByText('Teams')).toBeInTheDocument()
    expect(screen.getByText('Portfolios')).toBeInTheDocument()
    expect(screen.getByText('Risk')).toBeInTheDocument()
  })

  it('shows all users in default (unfiltered) view', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    expect(screen.getByText('Alice Adams')).toBeInTheDocument()
    expect(screen.getByText('Bob Baker')).toBeInTheDocument()
    expect(screen.getByText('Charlie Clark')).toBeInTheDocument()
    expect(screen.getByText('3 of 3 members')).toBeInTheDocument()
  })

  it('filter chips highlight when active', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    const allBtn = screen.getByRole('button', { name: 'All' })
    expect(allBtn.className).toContain('indigo')

    fireEvent.click(screen.getByRole('button', { name: 'Org Admin' }))
    const orgAdminBtn = screen.getByRole('button', { name: 'Org Admin' })
    expect(orgAdminBtn.className).toContain('indigo')
  })

  it('search filters table rows', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    const searchInput = screen.getByPlaceholderText('Search by name or email...')
    fireEvent.change(searchInput, { target: { value: 'alice' } })

    expect(screen.getByText('Alice Adams')).toBeInTheDocument()
    expect(screen.queryByText('Bob Baker')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3 members')).toBeInTheDocument()
  })

  it('clicking a row expands the summary panel with hierarchical sections', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }]}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    expect(screen.getByText('Access Summary')).toBeInTheDocument()
    expect(screen.getByText('Firm-Level Permissions')).toBeInTheDocument()
  })

  it('expanded panel shows firm-level permissions section with Yes/No values', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }]}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    // Org Admin: Yes
    expect(screen.getByText('Yes')).toBeInTheDocument()
    // Coverage Admin: None (Alice is not a coverage admin in defaultRows)
    expect(screen.getByText('None')).toBeInTheDocument()
  })

  it('expanded panel shows collapsible teams section', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    // Teams section shows count and role summary
    expect(screen.getByText('Teams (2)')).toBeInTheDocument()
    // Teams should be auto-expanded since count <= 4
    // Alice has teams in both the row table AND the expanded panel,
    // so there may be multiple matches
    expect(screen.getAllByText('Equity Research').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Fixed Income').length).toBeGreaterThanOrEqual(1)
  })

  it('expanded panel shows collapsible portfolios section (collapsed by default)', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    // Portfolios section heading visible (with role grouping, the heading may vary)
    // Look for the portfolios section by its count
    expect(screen.getByText(/Portfolios \(1\)/)).toBeInTheDocument()
  })

  it('expanded panel shows risk flags with summary-first pattern', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    fireEvent.click(screen.getByText('Charlie Clark'))
    // Summary header shows count
    expect(screen.getByText('1 Governance Risk')).toBeInTheDocument()
    // Severity breakdown
    expect(screen.getByText('1 High')).toBeInTheDocument()
    // High severity auto-expands details — "Hide details" shown instead of "View details"
    expect(screen.getByText('Hide details')).toBeInTheDocument()
    // Risk detail is already visible (auto-expanded)
    expect(screen.getByText('Single point of coverage on Team C')).toBeInTheDocument()
    expect(screen.getByText(/Charlie Clark is the only assigned member/)).toBeInTheDocument()
  })

  it('shows "No governance risks detected" for users without flags', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    fireEvent.click(screen.getByText('Bob Baker'))
    expect(screen.getByText('No governance risks detected')).toBeInTheDocument()
  })

  it('risk column shows count badge instead of dot', () => {
    const { container } = render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
      />,
    )
    // Charlie has 1 risk — should show "1" badge
    // The badge has the count as text content
    const badges = container.querySelectorAll('[title]')
    const riskBadge = Array.from(badges).find(el =>
      el.getAttribute('title')?.includes('Single point of coverage'),
    )
    expect(riskBadge).toBeDefined()
    expect(riskBadge!.textContent).toContain('1')
  })

  // ─── Edit mode tests ─────────────────────────────────────────────────

  it('no edit button visible for non-admin users', () => {
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms({ canManageOrgStructure: false })}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }]}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    expect(screen.queryByText('Manage roles')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
  })

  it('edit button visible for admin, enters edit mode with remove actions', () => {
    const onToggle = vi.fn()
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms({ role: 'ORG_ADMIN', canManageOrgStructure: true })}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }, { user_id: 'bob', is_org_admin: false }]}
        onToggleOrgAdmin={onToggle}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    // View mode: no remove buttons, but manage roles button present
    expect(screen.getByText('Manage roles')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()

    // Enter edit mode
    fireEvent.click(screen.getByText('Manage roles'))
    expect(screen.getByText('Done')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument()
  })

  it('remove in edit mode shows confirmation banner before executing', () => {
    const onToggle = vi.fn()
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms({ role: 'ORG_ADMIN', canManageOrgStructure: true })}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }, { user_id: 'bob', is_org_admin: true }]}
        onToggleOrgAdmin={onToggle}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByText('Manage roles'))

    // Click Remove
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))

    // Confirmation banner should appear
    expect(screen.getByText(/Remove Organization Admin from Alice Adams/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()

    // Mutation should NOT have been called yet
    expect(onToggle).not.toHaveBeenCalled()

    // Click Confirm
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onToggle).toHaveBeenCalledWith('alice', false)
  })

  it('cancel on confirmation banner does not execute mutation', () => {
    const onToggle = vi.fn()
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms({ role: 'ORG_ADMIN', canManageOrgStructure: true })}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }, { user_id: 'bob', is_org_admin: true }]}
        onToggleOrgAdmin={onToggle}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByText('Manage roles'))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onToggle).not.toHaveBeenCalled()
    // Banner should be dismissed
    expect(screen.queryByText(/Remove Organization Admin from Alice Adams/)).not.toBeInTheDocument()
  })

  it('done editing exits edit mode and hides mutation controls', () => {
    const onToggle = vi.fn()
    render(
      <OrgAuthorityMap
        rows={defaultRows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms({ role: 'ORG_ADMIN', canManageOrgStructure: true })}
        orgGraph={emptyGraph}
        orgMembers={[{ user_id: 'alice', is_org_admin: true }, { user_id: 'bob', is_org_admin: false }]}
        onToggleOrgAdmin={onToggle}
      />,
    )
    fireEvent.click(screen.getByText('Alice Adams'))
    fireEvent.click(screen.getByText('Manage roles'))
    expect(screen.getByRole('button', { name: /Remove/ })).toBeInTheDocument()

    fireEvent.click(screen.getByText('Done'))
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    expect(screen.getByText('Manage roles')).toBeInTheDocument()
  })
})
