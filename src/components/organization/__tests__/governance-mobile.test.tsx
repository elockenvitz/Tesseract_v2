/**
 * Governance on a phone: Manage and Report.
 *
 * Both surfaces are desktop tables. On a phone they become lists, and the
 * thing worth guarding is not that the list looks different — it is that
 * nothing the table carried has gone missing. A governance screen that
 * quietly drops which teams someone belongs to, or truncates the risk that
 * explains why their access is a problem, is worse than one that scrolls
 * sideways, because the reader cannot tell anything is absent.
 *
 * So these tests assert the data, the actions and the one-branch rule —
 * never both a table and a list, which would announce every person twice.
 *
 * jsdom has no layout engine and its `matchMedia` always reports false, so
 * the phone is simulated by stubbing the query the component actually reads.
 * That drives the real `useIsMobile()` path rather than a test-only branch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { OrgAuthorityMap } from '../OrgAuthorityMap'
import { OrgAccessTab } from '../OrgAccessTab'
import { MOBILE_QUERY } from '../../../hooks/useMediaQuery'
import type { AuthorityRow, AuthoritySummary } from '../../../lib/authority-map'
import type { OrgPermissions } from '../../../lib/permissions/orgGovernance'
import type { OrgGraph } from '../../../lib/org-graph'

// ─── Viewport simulation ────────────────────────────────────────────────

/** Report `matches` for the mobile query only, as a real phone would. */
function setViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

// ─── Fixtures ───────────────────────────────────────────────────────────

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
    status: 'active',
    ...overrides,
  } as AuthorityRow
}

function makeSummary(overrides: Partial<AuthoritySummary> = {}): AuthoritySummary {
  return {
    totalUsers: 3,
    orgAdminCount: 2,
    globalCoverageAdminCount: 2,
    nodeCoverageAdminCount: 0,
    pmCount: 5,
    flaggedUserCount: 1,
    riskBySeverity: { high: 1, medium: 0, low: 0 },
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

/** The risk copy the screenshot showed cut mid-word. */
const LONG_RISK_DETAIL =
  'Eric Lockenvitz is the only assigned member on The BEST Team. If unavailable, this team would have no active coverage.'

const rows: AuthorityRow[] = [
  makeRow({
    userId: 'eric',
    fullName: 'Eric Lockenvitz',
    email: 'elockenvitz@gmail.com',
    isOrgAdmin: true,
    isGlobalCoverageAdmin: true,
    roleChips: ['Org Admin', 'Coverage Admin'],
    coverageScopes: [{ type: 'global' }],
    teams: [
      { nodeId: 'n1', nodeName: 'Growth Team', role: 'PM', nodePath: [], isCoverageAdmin: false, coverageAdminBlocked: false },
      { nodeId: 'n2', nodeName: 'The BEST Team', role: 'Analyst', nodePath: [], isCoverageAdmin: false, coverageAdminBlocked: false },
    ],
    portfolios: [{ nodeId: 'p1', nodeName: 'Large Cap Growth Fund', role: 'PM', parentTeamName: 'Growth Team' }],
    riskFlags: [{
      type: 'single_point_of_failure',
      severity: 'high',
      label: 'Single point of coverage on The BEST Team',
      detail: LONG_RISK_DETAIL,
      anchorNodeId: 'n2',
    }],
    riskSeverity: 'high',
  }),
  makeRow({ userId: 'colin', fullName: 'Colin Knox', email: 'colin.e.knox@gmail.com', status: 'suspended' }),
]

// ─── Manage ─────────────────────────────────────────────────────────────

describe('Governance Manage on a phone', () => {
  beforeEach(() => setViewport(true))
  afterEach(() => vi.restoreAllMocks())

  function renderManage(props: Partial<React.ComponentProps<typeof OrgAuthorityMap>> = {}) {
    return render(
      <OrgAuthorityMap
        rows={rows}
        summary={makeSummary()}
        orgPerms={makeOrgPerms()}
        orgGraph={emptyGraph}
        orgMembers={[]}
        suspendedCount={2}
        {...props}
      />,
    )
  }

  it('renders people as rows, not as a table', () => {
    renderManage()
    // One branch or the other. Both would double-announce every person.
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Eric Lockenvitz')).toBeInTheDocument()
    expect(screen.getByText('elockenvitz@gmail.com')).toBeInTheDocument()
  })

  it('keeps the desktop table when not on a phone', () => {
    setViewport(false)
    renderManage()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Admin Roles')).toBeInTheDocument()
  })

  it('collapsed row leads with roles, not with counts', () => {
    renderManage()
    const rowEl = document.querySelector('[data-slot="governance-person"]') as HTMLElement
    expect(within(rowEl).getByText('Org Admin')).toBeInTheDocument()
    expect(within(rowEl).getByText('Coverage Admin')).toBeInTheDocument()
    expect(within(rowEl).getByText(/2 teams/)).toBeInTheDocument()
  })

  it('replaces the four summary pills with one compact summary', () => {
    renderManage()
    const compact = document.querySelector('[data-slot="governance-summary-compact"]') as HTMLElement
    expect(compact).not.toBeNull()
    // Same numbers the desktop chips carry.
    expect(within(compact).getByText(/Org Admins/)).toBeInTheDocument()
    expect(within(compact).getByText(/PMs/)).toBeInTheDocument()
    expect(within(compact).getByText(/1 risk/)).toBeInTheDocument()
  })

  it('a summary segment still drives the role filter', () => {
    renderManage()
    const compact = document.querySelector('[data-slot="governance-summary-compact"]') as HTMLElement
    fireEvent.click(within(compact).getByRole('button', { name: /Org Admins/ }))

    // Eric is an org admin; Colin is not.
    expect(screen.getByText('Eric Lockenvitz')).toBeInTheDocument()
    expect(screen.queryByText('Colin Knox')).toBeNull()
  })

  it('expanding a person reveals the governance detail in full', () => {
    renderManage()
    fireEvent.click(screen.getByText('Eric Lockenvitz'))

    expect(screen.getByText('Access Summary')).toBeInTheDocument()
    expect(screen.getByText('Firm-Level Permissions')).toBeInTheDocument()
    expect(screen.getByText(/Teams \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('Growth Team')).toBeInTheDocument()
  })

  it('risk copy is present in full, not truncated to an ellipsis', () => {
    renderManage()
    fireEvent.click(screen.getByText('Eric Lockenvitz'))

    // The exact sentence the phone was cutting at "Eric Loc...".
    const detail = screen.getByText(LONG_RISK_DETAIL)
    expect(detail).toBeInTheDocument()
    // It must be allowed to wrap; a nowrap or truncate class here is the bug.
    expect(detail.className).toContain('break-words')
    expect(detail.className).not.toContain('truncate')
    expect(detail.className).not.toContain('whitespace-nowrap')
  })

  it('opens one person at a time', () => {
    renderManage()
    fireEvent.click(screen.getByText('Eric Lockenvitz'))
    expect(screen.getByText('Firm-Level Permissions')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Colin Knox'))
    // Eric's panel closed; exactly one Access Summary on screen.
    expect(screen.getAllByText('Access Summary')).toHaveLength(1)
    expect(screen.queryByText('Growth Team')).toBeNull()
  })

  it('collapses again on a second tap', () => {
    renderManage()
    fireEvent.click(screen.getByText('Eric Lockenvitz'))
    expect(screen.getByText('Access Summary')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Eric Lockenvitz'))
    expect(screen.queryByText('Access Summary')).toBeNull()
  })

  it('preserves the admin edit path on a phone', () => {
    const onToggleOrgAdmin = vi.fn()
    renderManage({
      orgPerms: makeOrgPerms({ canManageOrgStructure: true }),
      onToggleOrgAdmin,
      orgMembers: [{ id: 'm1', user_id: 'eric', is_org_admin: true }, { id: 'm2', user_id: 'x', is_org_admin: true }],
    })
    fireEvent.click(screen.getByText('Eric Lockenvitz'))
    fireEvent.click(screen.getByRole('button', { name: /Manage roles/ }))

    // Same confirmation gate as desktop — a phone must not get a faster
    // path to revoking an admin.
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' })[0])
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeInTheDocument()
    expect(onToggleOrgAdmin).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    expect(onToggleOrgAdmin).toHaveBeenCalledWith('eric', false)
  })

  it('search stays a full-width field rather than an icon', () => {
    renderManage()
    const input = screen.getByPlaceholderText('Search by name or email...')
    expect(input.className).toContain('w-full')
    expect(input.parentElement?.className).toContain('w-full')
  })

  it('search filters the mobile list', () => {
    renderManage()
    fireEvent.change(screen.getByPlaceholderText('Search by name or email...'), {
      target: { value: 'colin' },
    })
    expect(screen.getByText('Colin Knox')).toBeInTheDocument()
    expect(screen.queryByText('Eric Lockenvitz')).toBeNull()
  })

  it('keeps the filtered count visible', () => {
    renderManage()
    expect(screen.getByText('2 of 2 members')).toBeInTheDocument()
  })
})

// ─── Report ─────────────────────────────────────────────────────────────

const orgMembers = [
  { id: 'm1', user_id: 'eric', is_org_admin: true, status: 'active', user: { id: 'eric', email: 'elockenvitz@gmail.com', full_name: 'Eric Lockenvitz' } },
  { id: 'm2', user_id: 'colin', is_org_admin: false, status: 'inactive', user: { id: 'colin', email: 'colin.e.knox@gmail.com', full_name: 'Colin Knox' } },
]

describe('Governance Report on a phone', () => {
  beforeEach(() => setViewport(true))
  afterEach(() => vi.restoreAllMocks())

  function renderReport() {
    return render(
      <OrgAccessTab
        orgMembers={orgMembers as never}
        teams={[]}
        teamMemberships={[]}
        portfolios={[]}
        portfolioMemberships={[]}
        authorityRows={rows}
      />,
    )
  }

  it('renders report rows as a list, not a cropped table', () => {
    renderReport()
    expect(screen.queryByRole('table')).toBeNull()
    expect(screen.getByText('Colin Knox')).toBeInTheDocument()
    expect(screen.getByText('colin.e.knox@gmail.com')).toBeInTheDocument()
  })

  it('keeps the desktop report table when not on a phone', () => {
    setViewport(false)
    renderReport()
    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByText('Person')).toBeInTheDocument()
  })

  it('shows status and org role on the collapsed row', () => {
    renderReport()
    const list = document.querySelector('[data-slot="report-people"]') as HTMLElement
    expect(within(list).getByText('Suspended')).toBeInTheDocument()
    expect(within(list).getByText('Admin')).toBeInTheDocument()
  })

  it('does not discard the columns a phone cannot show — they expand', () => {
    renderReport()
    // Collapsed: team names are not on screen.
    expect(screen.queryByText(/Growth Team/)).toBeNull()

    fireEvent.click(screen.getByText('Eric Lockenvitz'))

    // Expanded: every column the desktop table carries is reachable.
    expect(screen.getByText(/Teams \(2\)/)).toBeInTheDocument()
    expect(screen.getByText('Growth Team (PM)')).toBeInTheDocument()
    expect(screen.getByText(/Portfolios \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Large Cap Growth Fund (PM)')).toBeInTheDocument()
    expect(screen.getByText(/Risk flags \(1\)/)).toBeInTheDocument()
    expect(screen.getByText('Single point of coverage on The BEST Team')).toBeInTheDocument()
  })

  it('report risk labels wrap instead of truncating', () => {
    renderReport()
    fireEvent.click(screen.getByText('Eric Lockenvitz'))
    const label = screen.getByText('Single point of coverage on The BEST Team')
    expect(label.className).toContain('break-words')
    expect(label.className).not.toContain('truncate')
  })

  it('export stays available and named on a phone', () => {
    renderReport()
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeInTheDocument()
  })
})
