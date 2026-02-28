/**
 * Organization Governance Permission Helpers
 *
 * Centralized role-based checks for the Organization → Teams tab.
 * Resolves a single OrgRole from membership flags and profile data,
 * then derives boolean permissions from that role.
 *
 * Role resolution priority:
 *   1. isOrgAdmin flag → ORG_ADMIN
 *   2. profile.user_type (authoritative) → OPS | COMPLIANCE
 *   3. Legacy fallback: ops_departments / compliance_areas arrays
 *      (only when user_type is null/undefined — NOT when user_type is set)
 *   4. isCoverageAdmin flag → COVERAGE_ADMIN
 *   5. Default → INVESTMENT
 *
 * Usage:
 *   const role = resolveOrgRole({ isOrgAdmin, isCoverageAdmin, profile })
 *   if (canSeeGovernanceUI(role)) { ... }
 *
 *   // Or use the combined resolver:
 *   const perms = resolveOrgPermissions(input)
 */

import type { OrganizationMembership, UserProfileData } from '../../types/organization'

// ─── Normalized role enum ───────────────────────────────────────────────

export type OrgRole =
  | 'ORG_ADMIN'
  | 'OPS'
  | 'COMPLIANCE'
  | 'COVERAGE_ADMIN'
  | 'INVESTMENT'

// ─── Input type (what we receive from the page) ─────────────────────────

export interface OrgPermissionInput {
  isOrgAdmin: boolean
  isCoverageAdmin?: boolean
  profile?: UserProfileData | null
}

// ─── Resolved permissions (what components consume) ─────────────────────

export interface OrgPermissions {
  /** The resolved role for this user */
  role: OrgRole
  /** Can see governance header, risk badges, health scores, risk filter */
  canViewGovernance: boolean
  /** Can add/delete/edit org chart nodes */
  canManageOrgStructure: boolean
  /** Can see the Permissions sub-tab */
  canViewPermissionsView: boolean
  /** Can see the Access section in node details drawer */
  canViewAccessSection: boolean
  /** True when user is a pure investment professional with no admin/ops/compliance role */
  isInvestmentOnly: boolean
}

// ─── Role resolution ────────────────────────────────────────────────────

/**
 * Resolves a single OrgRole from membership flags and profile data.
 *
 * Priority:
 *   1. isOrgAdmin → ORG_ADMIN
 *   2. user_type === 'ops' → OPS
 *   3. user_type === 'compliance' → COMPLIANCE
 *   4. Legacy fallback (user_type is null/undefined):
 *      - ops_departments non-empty → OPS
 *      - compliance_areas non-empty → COMPLIANCE
 *   5. isCoverageAdmin → COVERAGE_ADMIN
 *   6. Default → INVESTMENT
 */
export function resolveOrgRole(input: OrgPermissionInput): OrgRole {
  const { isOrgAdmin, isCoverageAdmin = false, profile } = input

  // 1. Org admin flag takes priority over everything
  if (isOrgAdmin) return 'ORG_ADMIN'

  // 2–3. Profile-based role detection
  if (profile) {
    const userType = profile.user_type

    if (userType === 'ops') return 'OPS'
    if (userType === 'compliance') return 'COMPLIANCE'

    // 4. Legacy fallback — ONLY when user_type is null/undefined.
    //    If user_type is set (e.g. 'analyst'), arrays do NOT override it.
    if (userType == null) {
      if (profile.ops_departments && profile.ops_departments.length > 0) return 'OPS'
      if (profile.compliance_areas && profile.compliance_areas.length > 0) return 'COMPLIANCE'
    }
  }

  // 5. Coverage admin flag
  if (isCoverageAdmin) return 'COVERAGE_ADMIN'

  // 6. Default
  return 'INVESTMENT'
}

// ─── Role-based permission helpers ──────────────────────────────────────

/** Can see the governance header, risk badges, health scores, risk filter */
export function canSeeGovernanceUI(role: OrgRole): boolean {
  return role !== 'INVESTMENT'
}

/** Can see the Permissions sub-tab */
export function canSeePermissionsTab(role: OrgRole): boolean {
  return role === 'ORG_ADMIN' || role === 'COMPLIANCE'
}

/** Can add/delete/edit org chart nodes */
export function canManageStructure(role: OrgRole): boolean {
  return role === 'ORG_ADMIN'
}

/** Can see the Access section in node details drawer */
export function canSeeAccessSection(role: OrgRole): boolean {
  return role === 'ORG_ADMIN' || role === 'COMPLIANCE'
}

// ─── Main resolver ──────────────────────────────────────────────────────

/**
 * Resolves governance permissions from membership + profile data.
 * Derives all booleans from the resolved OrgRole.
 */
export function resolveOrgPermissions(input: OrgPermissionInput): OrgPermissions {
  const role = resolveOrgRole(input)

  return {
    role,
    canViewGovernance: canSeeGovernanceUI(role),
    canManageOrgStructure: canManageStructure(role),
    canViewPermissionsView: canSeePermissionsTab(role),
    canViewAccessSection: canSeeAccessSection(role),
    isInvestmentOnly: role === 'INVESTMENT',
  }
}

// ─── Convenience: resolve from raw OrganizationMembership ───────────────

/**
 * Shortcut that extracts flags directly from an OrganizationMembership record.
 * Useful when you have the full membership object available.
 */
export function resolveFromMembership(
  membership: OrganizationMembership | undefined | null,
  isCoverageAdmin = false,
): OrgPermissions {
  if (!membership) {
    return {
      role: 'INVESTMENT',
      canViewGovernance: false,
      canManageOrgStructure: false,
      canViewPermissionsView: false,
      canViewAccessSection: false,
      isInvestmentOnly: true,
    }
  }
  return resolveOrgPermissions({
    isOrgAdmin: membership.is_org_admin,
    isCoverageAdmin,
    profile: membership.profile,
  })
}
