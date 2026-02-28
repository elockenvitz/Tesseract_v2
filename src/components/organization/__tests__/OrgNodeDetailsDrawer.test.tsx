import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { OrgNodeDetailsDrawer } from '../OrgNodeDetailsDrawer'
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

describe('OrgNodeDetailsDrawer', () => {
  const onClose = vi.fn()

  it('renders node name and type', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText('Equity Research')).toBeInTheDocument()
    expect(screen.getByText('Team')).toBeInTheDocument()
  })

  it('renders breadcrumb path', () => {
    const breadcrumb = [
      { id: 'root', name: 'Investment Division' },
      { id: 'dept', name: 'Research Dept' },
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={breadcrumb}
        onClose={onClose}
      />
    )
    expect(screen.getByText('Investment Division')).toBeInTheDocument()
    expect(screen.getByText('Research Dept')).toBeInTheDocument()
  })

  it('renders health pill', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ healthScore: 72 })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    expect(screen.getByText('72%')).toBeInTheDocument()
  })

  it('renders governance diagnostics checklist', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ healthScore: 85 })}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    expect(screen.getByText('Governance & Risk')).toBeInTheDocument()
    expect(screen.getByText('Has direct members')).toBeInTheDocument()
    expect(screen.getByText('No high-severity risks')).toBeInTheDocument()
    expect(screen.getByText('No medium-severity risks')).toBeInTheDocument()
    // Score is behind collapsible toggle
    fireEvent.click(screen.getByText('Scoring details'))
    expect(screen.getByText('85/100')).toBeInTheDocument()
  })

  it('renders risk flags when present', () => {
    const risks: RiskFlag[] = [
      { type: 'no_pm_assigned', severity: 'high', label: 'No Portfolio Manager assigned' },
      { type: 'uncovered_assets', severity: 'medium', label: 'No coverage assigned' },
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ riskFlags: risks })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    expect(screen.getByText('No Portfolio Manager assigned')).toBeInTheDocument()
    expect(screen.getByText('No coverage assigned')).toBeInTheDocument()
  })

  it('renders member list with roles', () => {
    const members = [
      makeMember('u1', 'Portfolio Manager'),
      makeMember('u2', 'Analyst'),
      makeMember('u3', 'Research Associate'),
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={members}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText('User u1')).toBeInTheDocument()
    expect(screen.getByText('User u2')).toBeInTheDocument()
    expect(screen.getByText('User u3')).toBeInTheDocument()
  })

  it('renders PM and analyst counts', () => {
    const members = [
      makeMember('u1', 'PM'),
      makeMember('u2', 'Analyst'),
      makeMember('u3', 'Analyst'),
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={members}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText('1 PM')).toBeInTheDocument()
    expect(screen.getByText('2 Analysts')).toBeInTheDocument()
  })

  it('closes on ESC key', () => {
    const closeFn = vi.fn()
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={closeFn}
      />
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeFn).toHaveBeenCalled()
  })

  it('closes on backdrop click', () => {
    const closeFn = vi.fn()
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={closeFn}
      />
    )
    // Backdrop is the first element with aria-hidden
    const backdrop = document.querySelector('[aria-hidden="true"]') as HTMLElement
    if (backdrop) {
      fireEvent.click(backdrop)
      expect(closeFn).toHaveBeenCalled()
    }
  })

  it('shows edit button only for admin', () => {
    const onEdit = vi.fn()

    // Non-admin
    const { rerender } = render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        onEditNode={onEdit}
        isAdmin={false}
      />
    )
    expect(screen.queryByTitle('Edit node')).not.toBeInTheDocument()

    // Admin
    rerender(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        onEditNode={onEdit}
        isAdmin={true}
      />
    )
    expect(screen.getByTitle('Edit node')).toBeInTheDocument()
  })

  it('renders coverage stats for team nodes', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({
          nodeType: 'team',
          coverageAssetCount: 42,
          coverageAnalystCount: 5,
          portfolioCount: 3,
          totalMemberCount: 8,
        })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Assets Covered')).toBeInTheDocument()
  })

  it('navigates breadcrumb on click', () => {
    const onNav = vi.fn()
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[{ id: 'root', name: 'Root Division' }]}
        onClose={onClose}
        onNavigateNode={onNav}
      />
    )
    fireEvent.click(screen.getByText('Root Division'))
    expect(onNav).toHaveBeenCalledWith('root')
  })

  it('shows non-investment message in health diagnostics', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ isNonInvestment: true, healthScore: 100 })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={true}
      />
    )
    expect(screen.getByText(/always 100%/)).toBeInTheDocument()
  })

  // ── Focus trap tests ──

  it('focuses the close button on mount', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(document.activeElement).toBe(screen.getByTitle('Close (Esc)'))
  })

  it('wraps Tab from last focusable to first', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        onEditNode={() => {}}
        isAdmin={true}
      />
    )
    const drawer = document.querySelector('[role="dialog"]')!
    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    )
    expect(focusable.length).toBeGreaterThan(1)
    // Focus last element
    const last = focusable[focusable.length - 1]
    last.focus()
    expect(document.activeElement).toBe(last)
    // Tab forward from last → should wrap to first
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(focusable[0])
  })

  it('wraps Shift+Tab from first focusable to last', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        onEditNode={() => {}}
        isAdmin={true}
      />
    )
    const drawer = document.querySelector('[role="dialog"]')!
    const focusable = Array.from(
      drawer.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])',
      ),
    )
    // Focus first
    focusable[0].focus()
    expect(document.activeElement).toBe(focusable[0])
    // Shift+Tab from first → should wrap to last
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(focusable[focusable.length - 1])
  })

  // ── Governance gating tests ──

  it('hides governance section when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ healthScore: 85 })}
        members={[makeMember('u1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('Governance & Risk')).not.toBeInTheDocument()
    expect(screen.queryByText('Has direct members')).not.toBeInTheDocument()
  })

  it('hides risk flags when showGovernanceSignals is false', () => {
    const risks: RiskFlag[] = [
      { type: 'no_pm_assigned', severity: 'high', label: 'No Portfolio Manager assigned' },
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ riskFlags: risks })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('Risk Flags')).not.toBeInTheDocument()
    expect(screen.queryByText('No Portfolio Manager assigned')).not.toBeInTheDocument()
  })

  it('hides coverage admin info when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode()}
        members={[makeMember('u1', 'Analyst', { is_coverage_admin: true })]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('Coverage Admins')).not.toBeInTheDocument()
  })

  it('hides health pill in header when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ healthScore: 72 })}
        members={[]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    expect(screen.queryByText('72%')).not.toBeInTheDocument()
  })

  it('still shows members and coverage when showGovernanceSignals is false', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ nodeType: 'team', coverageAssetCount: 42 })}
        members={[makeMember('u1', 'PM')]}
        breadcrumb={[]}
        onClose={onClose}
        showGovernanceSignals={false}
      />
    )
    // Members section still present
    expect(screen.getByText('User u1')).toBeInTheDocument()
    // Coverage section still present
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Assets Covered')).toBeInTheDocument()
  })

  // ── Membership semantics tests ──

  it('shows Direct Members and Inherited from Portfolios headings for team with derived members', () => {
    const portfolioMembers = [
      makeMember('p1', 'Analyst'),
      makeMember('p2', 'Analyst'),
      makeMember('p3', 'Research Associate'),
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ nodeType: 'team', memberCount: 0 })}
        members={[]}
        portfolioMembers={portfolioMembers}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/Direct Members \(0\)/)).toBeInTheDocument()
    expect(screen.getByText(/Inherited from Portfolios \(3\)/)).toBeInTheDocument()
    expect(screen.getByText('No direct members')).toBeInTheDocument()
  })

  it('shows both direct and portfolio members simultaneously', () => {
    const directMembers = [makeMember('u1', 'PM')]
    const portfolioMembers = [
      makeMember('p1', 'Analyst'),
      makeMember('p2', 'Analyst'),
    ]
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ nodeType: 'team' })}
        members={directMembers}
        portfolioMembers={portfolioMembers}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.getByText(/Direct Members \(1\)/)).toBeInTheDocument()
    expect(screen.getByText(/Inherited from Portfolios \(2\)/)).toBeInTheDocument()
    // Both lists visible simultaneously
    expect(screen.getByText('User u1')).toBeInTheDocument()
    expect(screen.getByText('User p1')).toBeInTheDocument()
    expect(screen.getByText('User p2')).toBeInTheDocument()
  })

  it('does not show membership headings for non-team nodes even with portfolioMembers', () => {
    render(
      <OrgNodeDetailsDrawer
        node={makeGraphNode({ nodeType: 'division' })}
        members={[makeMember('u1', 'PM')]}
        portfolioMembers={[makeMember('p1', 'Analyst')]}
        breadcrumb={[]}
        onClose={onClose}
      />
    )
    expect(screen.queryByText(/Direct Members/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Inherited from Portfolios/)).not.toBeInTheDocument()
  })
})
