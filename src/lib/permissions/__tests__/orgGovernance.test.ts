import { describe, it, expect } from 'vitest'
import {
  resolveOrgRole,
  resolveOrgPermissions,
  resolveFromMembership,
  canSeeGovernanceUI,
  canSeePermissionsTab,
  canManageStructure,
  canSeeAccessSection,
} from '../orgGovernance'
import type { OrgPermissionInput, OrgRole } from '../orgGovernance'
import type { OrganizationMembership, UserProfileData } from '../../../types/organization'

// ─── Helper ──────────────────────────────────────────────────────────────

function makeProfile(overrides: Partial<UserProfileData> = {}): UserProfileData {
  return {
    user_type: null,
    sector_focus: [],
    investment_style: [],
    market_cap_focus: [],
    geography_focus: [],
    time_horizon: [],
    ops_departments: [],
    compliance_areas: [],
    ...overrides,
  }
}

// ─── resolveOrgRole ──────────────────────────────────────────────────────

describe('resolveOrgRole', () => {
  // ── Org Admin ──

  it('returns ORG_ADMIN when isOrgAdmin flag is true', () => {
    expect(resolveOrgRole({ isOrgAdmin: true, profile: null })).toBe('ORG_ADMIN')
  })

  it('returns ORG_ADMIN even when profile says ops', () => {
    expect(resolveOrgRole({
      isOrgAdmin: true,
      profile: makeProfile({ user_type: 'ops' }),
    })).toBe('ORG_ADMIN')
  })

  // ── Ops user ──

  it('returns OPS for user_type=ops', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'ops' }),
    })).toBe('OPS')
  })

  it('returns OPS for legacy user with null user_type and ops_departments', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: null, ops_departments: ['trading_ops'] }),
    })).toBe('OPS')
  })

  // ── Compliance user ──

  it('returns COMPLIANCE for user_type=compliance', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'compliance' }),
    })).toBe('COMPLIANCE')
  })

  it('returns COMPLIANCE for legacy user with null user_type and compliance_areas', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: null, compliance_areas: ['aml'] }),
    })).toBe('COMPLIANCE')
  })

  // ── user_type overrides arrays (critical edge cases) ──

  it('returns INVESTMENT when user_type=analyst despite ops_departments', () => {
    // This is the key behavioral change: user_type is authoritative
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'analyst', ops_departments: ['trading_ops'] }),
    })).toBe('INVESTMENT')
  })

  it('returns INVESTMENT when user_type=analyst despite compliance_areas', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'analyst', compliance_areas: ['aml'] }),
    })).toBe('INVESTMENT')
  })

  it('returns INVESTMENT when user_type=pm despite ops_departments and compliance_areas', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({
        user_type: 'pm',
        ops_departments: ['trading_ops'],
        compliance_areas: ['aml'],
      }),
    })).toBe('INVESTMENT')
  })

  // ── Coverage Admin ──

  it('returns COVERAGE_ADMIN when isCoverageAdmin and no profile role', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      isCoverageAdmin: true,
      profile: null,
    })).toBe('COVERAGE_ADMIN')
  })

  it('returns OPS over COVERAGE_ADMIN when profile says ops', () => {
    // Profile-based role takes priority over isCoverageAdmin
    expect(resolveOrgRole({
      isOrgAdmin: false,
      isCoverageAdmin: true,
      profile: makeProfile({ user_type: 'ops' }),
    })).toBe('OPS')
  })

  // ── Investment (default) ──

  it('returns INVESTMENT for analyst user_type', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'analyst' }),
    })).toBe('INVESTMENT')
  })

  it('returns INVESTMENT for null profile', () => {
    expect(resolveOrgRole({ isOrgAdmin: false, profile: null })).toBe('INVESTMENT')
  })

  it('returns INVESTMENT for undefined profile', () => {
    expect(resolveOrgRole({ isOrgAdmin: false })).toBe('INVESTMENT')
  })

  it('returns INVESTMENT for unknown user_type', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'intern' }),
    })).toBe('INVESTMENT')
  })

  // ── Legacy fallback only fires when user_type is null ──

  it('ops_departments fallback fires when user_type is null', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: null, ops_departments: ['risk_ops'] }),
    })).toBe('OPS')
  })

  it('ops_departments fallback does NOT fire when user_type is empty string', () => {
    // Empty string is truthy for the null check — treated as "set but unknown"
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: '', ops_departments: ['risk_ops'] }),
    })).toBe('INVESTMENT')
  })

  it('compliance_areas fallback does NOT fire when user_type is set', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'analyst', compliance_areas: ['aml', 'kyc'] }),
    })).toBe('INVESTMENT')
  })

  // ── Priority order: ops fallback wins over compliance fallback ──

  it('returns OPS when legacy user has both ops_departments and compliance_areas', () => {
    expect(resolveOrgRole({
      isOrgAdmin: false,
      profile: makeProfile({
        user_type: null,
        ops_departments: ['trading_ops'],
        compliance_areas: ['aml'],
      }),
    })).toBe('OPS')
  })
})

// ─── Permission helper functions ─────────────────────────────────────────

describe('canSeeGovernanceUI', () => {
  it('returns true for all non-INVESTMENT roles', () => {
    const roles: OrgRole[] = ['ORG_ADMIN', 'OPS', 'COMPLIANCE', 'COVERAGE_ADMIN']
    for (const role of roles) {
      expect(canSeeGovernanceUI(role)).toBe(true)
    }
  })

  it('returns false for INVESTMENT', () => {
    expect(canSeeGovernanceUI('INVESTMENT')).toBe(false)
  })
})

describe('canSeePermissionsTab', () => {
  it('returns true for ORG_ADMIN and COMPLIANCE', () => {
    expect(canSeePermissionsTab('ORG_ADMIN')).toBe(true)
    expect(canSeePermissionsTab('COMPLIANCE')).toBe(true)
  })

  it('returns false for OPS, COVERAGE_ADMIN, INVESTMENT', () => {
    expect(canSeePermissionsTab('OPS')).toBe(false)
    expect(canSeePermissionsTab('COVERAGE_ADMIN')).toBe(false)
    expect(canSeePermissionsTab('INVESTMENT')).toBe(false)
  })
})

describe('canManageStructure', () => {
  it('returns true only for ORG_ADMIN', () => {
    expect(canManageStructure('ORG_ADMIN')).toBe(true)
  })

  it('returns false for all other roles', () => {
    const roles: OrgRole[] = ['OPS', 'COMPLIANCE', 'COVERAGE_ADMIN', 'INVESTMENT']
    for (const role of roles) {
      expect(canManageStructure(role)).toBe(false)
    }
  })
})

describe('canSeeAccessSection', () => {
  it('returns true for ORG_ADMIN and COMPLIANCE', () => {
    expect(canSeeAccessSection('ORG_ADMIN')).toBe(true)
    expect(canSeeAccessSection('COMPLIANCE')).toBe(true)
  })

  it('returns false for OPS, COVERAGE_ADMIN, INVESTMENT', () => {
    expect(canSeeAccessSection('OPS')).toBe(false)
    expect(canSeeAccessSection('COVERAGE_ADMIN')).toBe(false)
    expect(canSeeAccessSection('INVESTMENT')).toBe(false)
  })
})

// ─── resolveOrgPermissions (combined) ────────────────────────────────────

describe('resolveOrgPermissions', () => {
  it('grants all permissions for org admin', () => {
    const input: OrgPermissionInput = { isOrgAdmin: true, profile: null }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('ORG_ADMIN')
    expect(perms.canViewGovernance).toBe(true)
    expect(perms.canManageOrgStructure).toBe(true)
    expect(perms.canViewPermissionsView).toBe(true)
    expect(perms.canViewAccessSection).toBe(true)
    expect(perms.isInvestmentOnly).toBe(false)
  })

  it('grants governance view for ops user_type', () => {
    const input: OrgPermissionInput = {
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'ops' }),
    }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('OPS')
    expect(perms.canViewGovernance).toBe(true)
    expect(perms.canManageOrgStructure).toBe(false)
    expect(perms.canViewPermissionsView).toBe(false)
    expect(perms.canViewAccessSection).toBe(false)
    expect(perms.isInvestmentOnly).toBe(false)
  })

  it('does NOT grant governance for analyst with ops_departments (user_type authoritative)', () => {
    const input: OrgPermissionInput = {
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'analyst', ops_departments: ['trading_ops'] }),
    }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('INVESTMENT')
    expect(perms.canViewGovernance).toBe(false)
    expect(perms.isInvestmentOnly).toBe(true)
  })

  it('grants governance + permissions view for compliance user_type', () => {
    const input: OrgPermissionInput = {
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'compliance' }),
    }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('COMPLIANCE')
    expect(perms.canViewGovernance).toBe(true)
    expect(perms.canManageOrgStructure).toBe(false)
    expect(perms.canViewPermissionsView).toBe(true)
    expect(perms.canViewAccessSection).toBe(true)
    expect(perms.isInvestmentOnly).toBe(false)
  })

  it('does NOT grant permissions for analyst with compliance_areas (user_type authoritative)', () => {
    const input: OrgPermissionInput = {
      isOrgAdmin: false,
      profile: makeProfile({ user_type: 'analyst', compliance_areas: ['aml'] }),
    }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('INVESTMENT')
    expect(perms.canViewGovernance).toBe(false)
    expect(perms.canViewPermissionsView).toBe(false)
  })

  it('grants governance view for coverage admin', () => {
    const input: OrgPermissionInput = { isOrgAdmin: false, isCoverageAdmin: true, profile: null }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('COVERAGE_ADMIN')
    expect(perms.canViewGovernance).toBe(true)
    expect(perms.canManageOrgStructure).toBe(false)
    expect(perms.canViewPermissionsView).toBe(false)
    expect(perms.canViewAccessSection).toBe(false)
    expect(perms.isInvestmentOnly).toBe(false)
  })

  it('restricts investment-only user from governance', () => {
    const input: OrgPermissionInput = {
      isOrgAdmin: false,
      isCoverageAdmin: false,
      profile: makeProfile({ user_type: 'analyst', sector_focus: ['tech'] }),
    }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('INVESTMENT')
    expect(perms.canViewGovernance).toBe(false)
    expect(perms.canManageOrgStructure).toBe(false)
    expect(perms.canViewPermissionsView).toBe(false)
    expect(perms.canViewAccessSection).toBe(false)
    expect(perms.isInvestmentOnly).toBe(true)
  })

  it('restricts user with null profile', () => {
    const input: OrgPermissionInput = { isOrgAdmin: false, profile: null }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('INVESTMENT')
    expect(perms.canViewGovernance).toBe(false)
    expect(perms.isInvestmentOnly).toBe(true)
  })

  it('restricts user with undefined profile', () => {
    const input: OrgPermissionInput = { isOrgAdmin: false }
    const perms = resolveOrgPermissions(input)
    expect(perms.role).toBe('INVESTMENT')
    expect(perms.canViewGovernance).toBe(false)
    expect(perms.isInvestmentOnly).toBe(true)
  })
})

// ─── resolveFromMembership ───────────────────────────────────────────────

describe('resolveFromMembership', () => {
  it('returns investment-only for null membership', () => {
    const perms = resolveFromMembership(null)
    expect(perms.role).toBe('INVESTMENT')
    expect(perms.isInvestmentOnly).toBe(true)
    expect(perms.canViewGovernance).toBe(false)
  })

  it('returns admin permissions for admin membership', () => {
    const membership: OrganizationMembership = {
      id: 'm1',
      organization_id: 'org1',
      user_id: 'u1',
      is_org_admin: true,
      title: null,
      status: 'active',
      profile: null,
    }
    const perms = resolveFromMembership(membership)
    expect(perms.role).toBe('ORG_ADMIN')
    expect(perms.canViewGovernance).toBe(true)
    expect(perms.canManageOrgStructure).toBe(true)
  })

  it('respects coverage admin flag', () => {
    const membership: OrganizationMembership = {
      id: 'm1',
      organization_id: 'org1',
      user_id: 'u1',
      is_org_admin: false,
      title: null,
      status: 'active',
      profile: null,
    }
    const perms = resolveFromMembership(membership, true)
    expect(perms.role).toBe('COVERAGE_ADMIN')
    expect(perms.canViewGovernance).toBe(true)
  })

  it('resolves ops from membership profile', () => {
    const membership: OrganizationMembership = {
      id: 'm1',
      organization_id: 'org1',
      user_id: 'u1',
      is_org_admin: false,
      title: null,
      status: 'active',
      profile: makeProfile({ user_type: 'ops' }),
    }
    const perms = resolveFromMembership(membership)
    expect(perms.role).toBe('OPS')
    expect(perms.canViewGovernance).toBe(true)
  })
})
