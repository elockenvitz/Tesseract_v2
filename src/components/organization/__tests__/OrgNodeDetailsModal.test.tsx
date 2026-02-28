import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { OrgNodeDetailsModal } from '../OrgNodeDetailsModal'
import type { OrgGraphNode, RiskFlag } from '../../../lib/org-graph'
import type { RawNodeMember } from '../../../lib/org-graph'

function makeGraphNode(overrides: Partial<OrgGraphNode> = {}): OrgGraphNode {
  return {
    id: 'node-1',
    parentId: null,
    nodeType: 'team',
    name: 'Equity Research',
    color: '#6366f1',
    icon: 'users',
    sortOrder: 0,
    settings: null,
    isNonInvestment: false,
    coverageAdminOverride: false,
    createdAt: '2026-01-15T00:00:00Z',
    childIds: [],
    linkedNodeIds: [],
    depth: 1,
    path: ['root-1'],
    memberCount: 3,
    directMemberCount: 3,
    derivedMemberCount: 0,
    effectiveMemberCount: 3,
    portfolioCount: 2,
    totalMemberCount: 5,
    totalPortfolioCount: 2,
    totalNodeCount: 4,
    coverageAssetCount: 15,
    coverageAnalystCount: 3,
    riskFlags: [],
    healthScore: 85,
    ...overrides,
  }
}

function makeMember(userId: string, role: string, extra: Partial<RawNodeMember> = {}): RawNodeMember {
  return {
    id: `member-${userId}`,
    node_id: 'node-1',
    user_id: userId,
    role,
    focus: null,
    created_at: '2026-01-01T00:00:00Z',
    user: {
      id: userId,
      email: `${userId}@example.com`,
      full_name: `User ${userId}`,
    },
    ...extra,
  }
}

describe('OrgNodeDetailsModal', () => {
  const onClose = vi.fn()

  afterEach(() => {
    vi.clearAllMocks()
  })

  // ══════════════════════════════════════════════════════════════════
  // PROFILE PAGE
  // ══════════════════════════════════════════════════════════════════

  // ── Basic rendering ──

  it('renders node name and type badge', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    const profile = within(screen.getByTestId('profile-page'))
    expect(profile.getByText('Equity Research')).toBeInTheDocument()
    expect(profile.getByText('Team')).toBeInTheDocument()
  })

  it('renders breadcrumb path with navigation', () => {
    const onNav = vi.fn()
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[
          { id: 'root', name: 'Investment Division' },
          { id: 'dept', name: 'Research Dept' },
        ]}
        onClose={onClose}
        onNavigateNode={onNav}
      />
    )
    expect(screen.getByText('Investment Division')).toBeInTheDocument()
    expect(screen.getByText('Research Dept')).toBeInTheDocument()
    fireEvent.click(screen.getByText('Investment Division'))
    expect(onNav).toHaveBeenCalledWith('root')
  })

  // ── KPI Row ──

  it('renders KPI chips with correct values', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ totalMemberCount: 12, childIds: ['c1', 'c2'], totalNodeCount: 4 })}
        members={[makeMember('u1', 'Analyst'), makeMember('u2', 'PM')]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    const kpiRow = screen.getByTestId('kpi-row')
    expect(within(kpiRow).getByText('Members')).toBeInTheDocument()
    expect(within(kpiRow).getByText('Child Nodes')).toBeInTheDocument()
    expect(within(kpiRow).getByText('Descendants')).toBeInTheDocument()
    expect(kpiRow).toHaveTextContent('12')
    expect(kpiRow).toHaveTextContent('3')
  })

  it('shows admin coverage in KPI row when governance is enabled', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst', { is_coverage_admin: true })]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    expect(screen.getByText('Admin Coverage')).toBeInTheDocument()
    expect(screen.getByText('Yes')).toBeInTheDocument()
  })

  it('hides admin coverage in KPI row when governance is disabled', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('Admin Coverage')).not.toBeInTheDocument()
  })

  // ── Node switching ──

  it('updates content when node changes without remounting', () => {
    const { rerender } = render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ name: 'Alpha Team' })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    const profile = within(screen.getByTestId('profile-page'))
    expect(profile.getByText('Alpha Team')).toBeInTheDocument()

    rerender(
      <OrgNodeDetailsModal
        node={makeGraphNode({ id: 'node-2', name: 'Beta Team' })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    const profile2 = within(screen.getByTestId('profile-page'))
    expect(profile2.getByText('Beta Team')).toBeInTheDocument()
    expect(profile2.queryByText('Alpha Team')).not.toBeInTheDocument()
  })

  // ── Governance gating (collapsed by default) ──

  it('shows governance collapsible when showGovernanceSignals is true', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ healthScore: 72 })}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    expect(screen.getByText('Governance & Risk')).toBeInTheDocument()
    expect(screen.queryByText('Has direct members')).not.toBeInTheDocument()
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('expands governance section on click', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ healthScore: 72 })}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    fireEvent.click(screen.getByText('Governance & Risk'))
    expect(screen.getByText('Has direct members')).toBeInTheDocument()
  })

  it('hides governance section when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ healthScore: 72 })}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('Governance & Risk')).not.toBeInTheDocument()
  })

  it('hides health pill in header when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ healthScore: 85 })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('85%')).not.toBeInTheDocument()
  })

  it('hides risk flags when showGovernanceSignals is false', () => {
    const risks: RiskFlag[] = [
      { type: 'no_pm_assigned', severity: 'high', label: 'No Portfolio Manager assigned' },
    ]
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ riskFlags: risks })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('No Portfolio Manager assigned')).not.toBeInTheDocument()
  })

  it('renders risk flags when governance is expanded', () => {
    const risks: RiskFlag[] = [
      { type: 'no_pm_assigned', severity: 'high', label: 'No Portfolio Manager assigned' },
      { type: 'uncovered_assets', severity: 'medium', label: 'No coverage assigned' },
    ]
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ riskFlags: risks })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    fireEvent.click(screen.getByText('Governance & Risk'))
    expect(screen.getByText('No Portfolio Manager assigned')).toBeInTheDocument()
    expect(screen.getByText('No coverage assigned')).toBeInTheDocument()
  })

  it('risk severity summary appears when governance expanded', () => {
    const risks: RiskFlag[] = [
      { type: 'no_pm_assigned', severity: 'high', label: 'No PM' },
      { type: 'empty_team', severity: 'high', label: 'No members' },
      { type: 'uncovered_assets', severity: 'medium', label: 'No coverage' },
    ]
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ riskFlags: risks })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    fireEvent.click(screen.getByText('Governance & Risk'))
    const summary = screen.getByTestId('risk-summary')
    expect(summary).toBeInTheDocument()
  })

  it('uses severity badges for failing diagnostics', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({
          healthScore: 45,
          riskFlags: [
            { type: 'no_pm_assigned', severity: 'high', label: 'No PM' },
          ],
        })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    fireEvent.click(screen.getByText('Governance & Risk'))
    expect(screen.getByText('Med')).toBeInTheDocument()
    expect(screen.getAllByText('High').length).toBeGreaterThanOrEqual(1)
  })

  it('shows scoring details behind collapsible toggle', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ healthScore: 85 })}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    fireEvent.click(screen.getByText('Governance & Risk'))
    expect(screen.queryByText('85/100')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('Scoring details'))
    expect(screen.getByText('85/100')).toBeInTheDocument()
  })

  it('shows non-investment message in health diagnostics', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ isNonInvestment: true, healthScore: 100 })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    fireEvent.click(screen.getByText('Governance & Risk'))
    expect(screen.getByText(/always 100%/)).toBeInTheDocument()
  })

  // ── Coverage Admins (read-only on profile) ──

  it('shows coverage admins list', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[
          makeMember('u1', 'PM', { is_coverage_admin: true }),
          makeMember('u2', 'Analyst'),
        ]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText('Coverage Admins')).toBeInTheDocument()
  })

  it('coverage admins shows empty state', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/No coverage admins assigned/)).toBeInTheDocument()
  })

  it('coverage admins CTA slides to manage coverage tab for admin', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
      />
    )
    const assignLink = screen.getByText('assign in Manage')
    expect(assignLink).toBeInTheDocument()
    fireEvent.click(assignLink)
    // Should now be on manage page, coverage tab
    expect(screen.getByTitle('Back to profile')).toBeInTheDocument()
    expect(screen.getByText('coverage')).toBeInTheDocument()
  })

  it('no assign link for non-admin', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={false}
      />
    )
    expect(screen.queryByText('assign in Manage')).not.toBeInTheDocument()
  })

  // ── Membership (tabs + search) ──

  it('renders member list', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[
          makeMember('u1', 'Portfolio Manager'),
          makeMember('u2', 'Analyst'),
        ]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText('User u1')).toBeInTheDocument()
    expect(screen.getByText('User u2')).toBeInTheDocument()
  })

  it('groups multi-role members with expandable roles', async () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ nodeType: 'team' })}
        members={[
          makeMember('u1', 'PM', { node_id: 'port-a', _source: 'portfolio_team' }),
          makeMember('u1', 'Analyst', { id: 'member-u1-b', node_id: 'port-b', _source: 'portfolio_team' }),
          makeMember('u2', 'Analyst', { _source: 'portfolio_team' }),
        ]}
        breadcrumb={[]}
        onClose={onClose}
        allOrgChartNodes={[
          { id: 'node-1', parent_id: null, name: 'Value Team' },
          { id: 'port-a', parent_id: 'node-1', name: 'Large Cap Growth' },
          { id: 'port-b', parent_id: 'node-1', name: 'Small Cap Value' },
        ]}
      />
    )
    // Both users visible
    expect(screen.getByText('User u1')).toBeInTheDocument()
    expect(screen.getByText('User u2')).toBeInTheDocument()
    // Multi-role user shows role count
    expect(screen.getByText('2 roles')).toBeInTheDocument()
    // Single-role user shows role inline
    expect(screen.getByText('Analyst')).toBeInTheDocument()
  })

  it('member search filters results', () => {
    const manyMembers = Array.from({ length: 6 }, (_, i) =>
      makeMember(`u${i}`, i === 0 ? 'Portfolio Manager' : 'Analyst')
    )
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={manyMembers}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    const searchInput = screen.getByPlaceholderText('Search members...')
    expect(searchInput).toBeInTheDocument()

    fireEvent.change(searchInput, { target: { value: 'User u0' } })
    expect(screen.getByText('User u0')).toBeInTheDocument()
    expect(screen.queryByText('User u3')).not.toBeInTheDocument()
  })

  it('still shows members when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ nodeType: 'team' })}
        members={[makeMember('u1', 'PM')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.getByText('User u1')).toBeInTheDocument()
  })

  // ── Non-admin clean view ──

  it('non-admin sees clean profile without governance or manage button', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
        canManageOrgStructure={false}
      />
    )
    // "Members" appears in both KPI chip and Members card header
    expect(screen.getAllByText('Members').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('User u1')).toBeInTheDocument()
    expect(screen.getByText('Coverage Admins')).toBeInTheDocument()
    expect(screen.queryByText('Governance & Risk')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Manage node')).not.toBeInTheDocument()
    expect(screen.queryByText('85%')).not.toBeInTheDocument()
  })

  // ══════════════════════════════════════════════════════════════════
  // SLIDING PAGES
  // ══════════════════════════════════════════════════════════════════

  it('defaults to profile page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    // Profile page is the active page
    const profilePage = screen.getByTestId('profile-page')
    expect(profilePage.getAttribute('aria-hidden')).toBe('false')
    const kpiRow = within(profilePage).getByTestId('kpi-row')
    expect(within(kpiRow).getByText('Members')).toBeInTheDocument()
  })

  it('shows Manage button only when canManageOrgStructure', () => {
    const { rerender } = render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={false}
      />
    )
    expect(screen.queryByTitle('Manage node')).not.toBeInTheDocument()

    rerender(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
      />
    )
    expect(screen.getByTitle('Manage node')).toBeInTheDocument()
  })

  it('Manage button slides to manage page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
      />
    )
    fireEvent.click(screen.getByTitle('Manage node'))
    // Should now be on manage page
    expect(screen.getByTitle('Back to profile')).toBeInTheDocument()
    expect(screen.getByText('details')).toBeInTheDocument()
    expect(screen.getByText('members')).toBeInTheDocument()
    expect(screen.getByText('coverage')).toBeInTheDocument()
    expect(screen.getByText('settings')).toBeInTheDocument()
  })

  it('Back button slides to profile page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    // Start on manage page
    expect(screen.getByTitle('Back to profile')).toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Back to profile'))
    // Verify we returned to profile (profile content shows manage button)
    expect(screen.getByTitle('Manage node')).toBeInTheDocument()
  })

  it('opens on manage page when initialPage is manage', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    expect(screen.getByTitle('Back to profile')).toBeInTheDocument()
    expect(screen.getByText('details')).toBeInTheDocument()
  })

  it('opens on specific manage tab when initialManageTab is set', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
        initialManageTab="settings"
      />
    )
    // Settings tab content should be visible
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Non-investment team')).toBeInTheDocument()
  })

  it('node switch resets to profile page', () => {
    const { rerender } = render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    // Start on manage page
    const managePage = screen.getByTestId('manage-page')
    expect(managePage.getAttribute('aria-hidden')).toBe('false')

    // Switch node
    rerender(
      <OrgNodeDetailsModal
        node={makeGraphNode({ id: 'node-2', name: 'New Team' })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    // Should reset to profile page with new node content
    const profilePage = screen.getByTestId('profile-page')
    expect(profilePage.getAttribute('aria-hidden')).toBe('false')
    expect(within(profilePage).getByText('New Team')).toBeInTheDocument()
  })

  // ══════════════════════════════════════════════════════════════════
  // MANAGE PAGE
  // ══════════════════════════════════════════════════════════════════

  it('manage details tab shows name input', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    expect(screen.getByDisplayValue('Equity Research')).toBeInTheDocument()
  })

  it('save button disabled when unchanged', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    const saveButton = screen.getByText('Save changes')
    expect(saveButton).toBeDisabled()
  })

  it('save button enables when name changes', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    const nameInput = screen.getByDisplayValue('Equity Research')
    fireEvent.change(nameInput, { target: { value: 'New Name' } })
    const saveButton = screen.getByText('Save changes')
    expect(saveButton).not.toBeDisabled()
  })

  it('calls onSaveNode with updated data', () => {
    const onSave = vi.fn()
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
        onSaveNode={onSave}
      />
    )
    const nameInput = screen.getByDisplayValue('Equity Research')
    fireEvent.change(nameInput, { target: { value: 'Updated Team' } })
    fireEvent.click(screen.getByText('Save changes'))
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      id: 'node-1',
      name: 'Updated Team',
    }))
  })

  it('switches to members tab on manage page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    const manage = within(screen.getByTestId('manage-page'))
    fireEvent.click(manage.getByText('members'))
    expect(manage.getByText('Members (1)')).toBeInTheDocument()
    expect(manage.getByText('User u1')).toBeInTheDocument()
  })

  it('shows add member form when clicking add on members tab', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
        initialManageTab="members"
      />
    )
    fireEvent.click(screen.getByText('Add member'))
    expect(screen.getByText('Select User')).toBeInTheDocument()
  })

  it('shows member list with remove buttons on manage page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst'), makeMember('u2', 'PM')]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
        initialManageTab="members"
      />
    )
    const manage = within(screen.getByTestId('manage-page'))
    expect(manage.getByText('User u1')).toBeInTheDocument()
    expect(manage.getByText('User u2')).toBeInTheDocument()
    expect(manage.getAllByTitle('Remove member')).toHaveLength(2)
  })

  it('switches to settings tab on manage page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    fireEvent.click(screen.getByText('settings'))
    expect(screen.getByText('Color')).toBeInTheDocument()
    expect(screen.getByText('Non-investment team')).toBeInTheDocument()
  })

  it('shows non-investment message on coverage tab', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode({ isNonInvestment: true })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
        initialManageTab="coverage"
      />
    )
    expect(screen.getByText(/Non-investment node/)).toBeInTheDocument()
  })

  it('shows empty state on coverage tab when no members', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
        initialManageTab="coverage"
      />
    )
    expect(screen.getByText(/No members in this node/)).toBeInTheDocument()
  })

  // ── Unsaved changes ──

  it('warns on unsaved changes when going back to profile', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    // Modify name
    const nameInput = screen.getByDisplayValue('Equity Research')
    fireEvent.change(nameInput, { target: { value: 'Changed Name' } })
    // Click back
    fireEvent.click(screen.getByTitle('Back to profile'))
    expect(confirmSpy).toHaveBeenCalledWith('You have unsaved changes. Discard them?')
    confirmSpy.mockRestore()
  })

  it('stays on manage page when unsaved changes warning is dismissed', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    const nameInput = screen.getByDisplayValue('Equity Research')
    fireEvent.change(nameInput, { target: { value: 'Changed Name' } })
    fireEvent.click(screen.getByTitle('Back to profile'))
    // Should stay on manage page
    expect(screen.getByTitle('Back to profile')).toBeInTheDocument()
    confirmSpy.mockRestore()
  })

  it('no warning when going back without changes', () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    fireEvent.click(screen.getByTitle('Back to profile'))
    expect(confirmSpy).not.toHaveBeenCalled()
    confirmSpy.mockRestore()
  })

  // ══════════════════════════════════════════════════════════════════
  // KEYBOARD ACCESSIBILITY
  // ══════════════════════════════════════════════════════════════════

  it('closes on ESC key from profile page', () => {
    const closeFn = vi.fn()
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={closeFn}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeFn).toHaveBeenCalled()
  })

  it('closes on ESC key from manage page', () => {
    const closeFn = vi.fn()
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={closeFn}
        canManageOrgStructure={true}
        initialPage="manage"
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeFn).toHaveBeenCalled()
  })

  it('closes on backdrop click', () => {
    const closeFn = vi.fn()
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={closeFn}
      />
    )
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(closeFn).toHaveBeenCalled()
    }
  })

  it('focuses the close button on mount', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    const profile = within(screen.getByTestId('profile-page'))
    expect(document.activeElement).toBe(profile.getByTitle('Close (Esc)'))
  })

  it('wraps Tab from last focusable to first on profile page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
      />
    )
    // Get focusable elements in the active (profile) page
    const profilePage = document.querySelector('[aria-hidden="false"]') || document.querySelector('[role="dialog"]')!
    const focusable = Array.from(
      profilePage.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    )
    expect(focusable.length).toBeGreaterThan(1)
    const last = focusable[focusable.length - 1]
    last.focus()
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0])
  })

  it('wraps Shift+Tab from first focusable to last on profile page', () => {
    render(
      <OrgNodeDetailsModal
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        canManageOrgStructure={true}
      />
    )
    const profilePage = document.querySelector('[aria-hidden="false"]') || document.querySelector('[role="dialog"]')!
    const focusable = Array.from(
      profilePage.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    )
    focusable[0].focus()
    expect(document.activeElement).toBe(focusable[0])
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusable[focusable.length - 1])
  })
})
