/**
 * Friendly labels, icons, and badge colors for org activity events.
 *
 * Two label systems:
 * 1. ACTION_FORMAT: legacy action-string → badge. Used for badge pill display.
 * 2. getEventLabel: entity_type + action_type → humanized sentence. Used for primary row text.
 */

import type { OrgActivityEvent } from '../types/organization'

export interface ActivityFormat {
  title: string
  icon: string        // lucide icon name
  badgeColor: string  // tailwind badge classes
}

/**
 * Map of action strings → display format.
 * Covers both legacy actions and new structured actions.
 */
export const ACTION_FORMAT: Record<string, ActivityFormat> = {
  // ── Membership lifecycle ───────────────────────────────────────
  'membership.status_changed':   { title: 'Membership status changed', icon: 'UserCog',     badgeColor: 'bg-blue-50 text-blue-700' },
  'membership.admin_changed':    { title: 'Admin role changed',        icon: 'Crown',        badgeColor: 'bg-amber-50 text-amber-700' },
  'user.coverage_admin_changed': { title: 'Coverage admin changed',    icon: 'Shield',       badgeColor: 'bg-violet-50 text-violet-700' },
  'member.deactivated':          { title: 'Member suspended',          icon: 'UserX',        badgeColor: 'bg-red-50 text-red-700' },
  'member.reactivated':          { title: 'Member reactivated',        icon: 'UserCheck',    badgeColor: 'bg-emerald-50 text-emerald-700' },
  'member.temporary_access_granted': { title: 'Temp access granted',   icon: 'Clock',        badgeColor: 'bg-sky-50 text-sky-700' },
  'member.temporary_access_revoked': { title: 'Temp access revoked',   icon: 'Clock',        badgeColor: 'bg-gray-100 text-gray-600' },

  // ── Access requests & invites ──────────────────────────────────
  'access_request.reviewed':     { title: 'Access request reviewed',   icon: 'ClipboardCheck', badgeColor: 'bg-indigo-50 text-indigo-700' },
  'invite.created':              { title: 'Invite sent',               icon: 'Send',         badgeColor: 'bg-sky-50 text-sky-700' },
  'invite.accepted':             { title: 'Invite accepted',           icon: 'UserPlus',     badgeColor: 'bg-emerald-50 text-emerald-700' },
  'invite.cancelled':            { title: 'Invite cancelled',          icon: 'XCircle',      badgeColor: 'bg-gray-100 text-gray-600' },

  // ── Team node (org chart) ─────────────────────────────────────
  'team_node.created':           { title: 'Team created',              icon: 'FolderPlus',   badgeColor: 'bg-emerald-50 text-emerald-700' },
  'team_node.updated':           { title: 'Team updated',              icon: 'Pencil',       badgeColor: 'bg-blue-50 text-blue-700' },
  'team_node.deleted':           { title: 'Team deleted',              icon: 'FolderMinus',  badgeColor: 'bg-red-50 text-red-700' },
  'team_node.coverage_override_changed': { title: 'Coverage override changed', icon: 'Shield', badgeColor: 'bg-violet-50 text-violet-700' },

  // ── Team node members ─────────────────────────────────────────
  'team_node_member.added':      { title: 'Added team member',         icon: 'UserPlus',     badgeColor: 'bg-emerald-50 text-emerald-700' },
  'team_node_member.removed':    { title: 'Removed team member',       icon: 'UserMinus',    badgeColor: 'bg-red-50 text-red-700' },
  'team_node_member.role_changed':         { title: 'Team role changed',         icon: 'ArrowRightLeft', badgeColor: 'bg-blue-50 text-blue-700' },
  'team_node_member.coverage_admin_granted': { title: 'Coverage admin granted', icon: 'ShieldCheck', badgeColor: 'bg-violet-50 text-violet-700' },
  'team_node_member.coverage_admin_revoked': { title: 'Coverage admin revoked', icon: 'ShieldOff',   badgeColor: 'bg-gray-100 text-gray-600' },
  'team_node_member.coverage_admin_blocked': { title: 'Coverage admin blocked', icon: 'ShieldBan',   badgeColor: 'bg-amber-50 text-amber-700' },

  // ── Legacy team memberships (teams table) ──────────────────────
  'team_membership.added':       { title: 'Team member added',         icon: 'UserPlus',     badgeColor: 'bg-emerald-50 text-emerald-700' },
  'team_membership.removed':     { title: 'Team member removed',       icon: 'UserMinus',    badgeColor: 'bg-red-50 text-red-700' },

  // ── Portfolio ──────────────────────────────────────────────────
  'portfolio.created':           { title: 'Portfolio created',          icon: 'Briefcase',    badgeColor: 'bg-emerald-50 text-emerald-700' },
  'portfolio.archived':          { title: 'Portfolio archived',         icon: 'Archive',      badgeColor: 'bg-amber-50 text-amber-700' },
  'portfolio.restored':          { title: 'Portfolio restored',          icon: 'ArchiveRestore', badgeColor: 'bg-emerald-50 text-emerald-700' },
  'portfolio.discarded':         { title: 'Portfolio discarded',        icon: 'Ban',          badgeColor: 'bg-red-50 text-red-700' },
  'portfolio.deleted':           { title: 'Portfolio deleted',          icon: 'Trash2',       badgeColor: 'bg-red-50 text-red-700' },

  // ── Portfolio team (portfolio_team table) ──────────────────────
  'portfolio_team.added':        { title: 'Portfolio access granted',   icon: 'UserPlus',     badgeColor: 'bg-emerald-50 text-emerald-700' },
  'portfolio_team.removed':      { title: 'Portfolio access removed',   icon: 'UserMinus',    badgeColor: 'bg-red-50 text-red-700' },
  'portfolio_team.role_changed': { title: 'Portfolio role changed',     icon: 'ArrowRightLeft', badgeColor: 'bg-blue-50 text-blue-700' },

  // ── Legacy portfolio memberships (portfolio_memberships table) ─
  'portfolio_membership.added':  { title: 'Portfolio member added',     icon: 'UserPlus',     badgeColor: 'bg-emerald-50 text-emerald-700' },
  'portfolio_membership.removed': { title: 'Portfolio member removed',  icon: 'UserMinus',    badgeColor: 'bg-red-50 text-red-700' },

  // ── Settings ───────────────────────────────────────────────────
  'settings.onboarding_policy_changed': { title: 'Onboarding policy changed', icon: 'Settings', badgeColor: 'bg-gray-100 text-gray-700' },
  'settings.coverage_changed':   { title: 'Coverage settings changed',  icon: 'Settings',     badgeColor: 'bg-gray-100 text-gray-700' },
  'settings.branding_changed':   { title: 'Branding updated',           icon: 'Palette',      badgeColor: 'bg-gray-100 text-gray-700' },
  'settings.retention_changed':  { title: 'Retention policy changed',   icon: 'Clock',        badgeColor: 'bg-gray-100 text-gray-700' },

  // ── Governance ─────────────────────────────────────────────────
  'retention.applied':           { title: 'Retention policy applied',   icon: 'Trash2',       badgeColor: 'bg-gray-100 text-gray-500' },
}

export const FALLBACK_FORMAT: ActivityFormat = {
  title: 'Activity',
  icon: 'Activity',
  badgeColor: 'bg-gray-100 text-gray-600',
}

export interface FormattedActivity {
  title: string
  subtitle: string | null
  icon: string
  badgeColor: string
}

/** Build a user-friendly display for an audit event (legacy — used for badge + subtitle). */
export function formatActivityEvent(
  event: OrgActivityEvent,
  userNameMap: Map<string, string>,
): FormattedActivity {
  const fmt = ACTION_FORMAT[event.action] ?? FALLBACK_FORMAT
  const d = event.details || {}
  const parts: string[] = []

  // Target user name
  if (event.target_user_id) {
    const name = userNameMap.get(event.target_user_id)
    if (name) parts.push(name)
  } else if (d.user_id) {
    const name = userNameMap.get(d.user_id)
    if (name) parts.push(name)
  }

  // Entity names from details
  if (d.node_name) parts.push(d.node_name)
  if (d.portfolio_name) parts.push(d.portfolio_name)
  if (d.email) parts.push(d.email)

  // Role transitions
  if (d.old_role && d.new_role) {
    parts.push(`${d.old_role} → ${d.new_role}`)
  }
  if (d.old_status && d.new_status) {
    parts.push(`${d.old_status} → ${d.new_status}`)
  }
  if (d.old_is_org_admin !== undefined) {
    parts.push(d.new_is_org_admin ? 'promoted to admin' : 'demoted from admin')
  }
  if (d.old_coverage_admin !== undefined) {
    parts.push(d.new_coverage_admin ? 'granted coverage admin' : 'revoked coverage admin')
  }

  // Access request specifics
  if (d.request_type) parts.push(d.request_type.replace(/_/g, ' '))
  if (d.reason) parts.push(d.reason)

  // Temp access
  if (d.duration_minutes) parts.push(`${d.duration_minutes}min`)
  if (d.expires_at) parts.push(`expires ${new Date(d.expires_at).toLocaleString()}`)

  return {
    title: fmt.title,
    subtitle: parts.length > 0 ? parts.join(' · ') : null,
    icon: fmt.icon,
    badgeColor: fmt.badgeColor,
  }
}

// ─── Canonical event label from entity_type + action_type ───────────

export interface EventLabel {
  /** Humanized primary line: "Dan added to Growth Team as Analyst" */
  sentence: string
  /** Short action verb for the badge pill */
  badgeText: string
}

/**
 * Build a human-readable sentence from entity_type + action_type + details.
 * Falls back to ACTION_FORMAT title if no canonical match.
 */
export function getEventLabel(
  event: OrgActivityEvent,
  userNameMap: Map<string, string>,
): EventLabel {
  const d = event.details || {}
  const targetName = event.target_user_id
    ? (userNameMap.get(event.target_user_id) || 'a user')
    : (d.user_name || d.email || '')
  const nodeName = d.node_name || ''
  const portfolioName = d.portfolio_name || d.name || ''
  const role = d.role || d.new_role || ''
  const oldRole = d.old_role || ''
  const fmt = ACTION_FORMAT[event.action]

  // Fallback badge text
  const fallbackBadge = fmt?.title || event.action.replace(/[._]/g, ' ')

  switch (event.entity_type) {
    case 'org_member': {
      switch (event.action_type) {
        case 'updated': {
          // Disambiguate by action string
          if (event.action === 'member.deactivated')
            return { sentence: `${targetName} suspended`, badgeText: 'Suspended' }
          if (event.action === 'member.reactivated')
            return { sentence: `${targetName} reactivated`, badgeText: 'Reactivated' }
          return { sentence: `${targetName} status changed`, badgeText: 'Status changed' }
        }
        case 'role_granted': {
          if (event.action === 'membership.admin_changed')
            return { sentence: `${targetName} promoted to admin`, badgeText: 'Admin granted' }
          if (event.action === 'user.coverage_admin_changed')
            return { sentence: `${targetName} granted coverage admin`, badgeText: 'Coverage admin' }
          return { sentence: `${targetName} role granted`, badgeText: fallbackBadge }
        }
        case 'role_revoked': {
          if (event.action === 'membership.admin_changed')
            return { sentence: `${targetName} demoted from admin`, badgeText: 'Admin revoked' }
          if (event.action === 'user.coverage_admin_changed')
            return { sentence: `${targetName} coverage admin revoked`, badgeText: 'Coverage revoked' }
          return { sentence: `${targetName} role revoked`, badgeText: fallbackBadge }
        }
        default:
          break
      }
      break
    }

    case 'team_membership': {
      const loc = nodeName ? ` on ${nodeName}` : ''
      const asRole = role ? ` as ${role}` : ''
      switch (event.action_type) {
        case 'added':
        case 'role_granted':
          return { sentence: `${targetName} added${loc}${asRole}`, badgeText: 'Added to team' }
        case 'removed':
        case 'role_revoked':
          return { sentence: `${targetName} removed${loc}`, badgeText: 'Removed from team' }
        case 'role_changed':
          return {
            sentence: `${targetName} role changed${loc}: ${oldRole} → ${role}`,
            badgeText: 'Role changed',
          }
        default:
          break
      }
      break
    }

    case 'portfolio_membership': {
      const on = portfolioName ? ` on ${portfolioName}` : ''
      const asRole = role ? ` as ${role}` : ''
      switch (event.action_type) {
        case 'role_granted':
          return { sentence: `${targetName} granted ${role || 'access'}${on}`, badgeText: 'Access granted' }
        case 'role_revoked':
        case 'removed':
          return { sentence: `${targetName} removed${on}`, badgeText: 'Access removed' }
        case 'role_changed':
          return {
            sentence: `${targetName} role changed${on}: ${oldRole} → ${role}`,
            badgeText: 'Role changed',
          }
        default:
          break
      }
      break
    }

    case 'portfolio': {
      const name = portfolioName || 'portfolio'
      switch (event.action_type) {
        case 'created':   return { sentence: `${name} created`, badgeText: 'Created' }
        case 'archived':  return { sentence: `${name} archived`, badgeText: 'Archived' }
        case 'restored':  return { sentence: `${name} restored`, badgeText: 'Restored' }
        case 'discarded': return { sentence: `${name} discarded`, badgeText: 'Discarded' }
        case 'deleted':   return { sentence: `${name} deleted`, badgeText: 'Deleted' }
        default: break
      }
      break
    }

    case 'team_node': {
      const name = d.name || nodeName || 'team'
      switch (event.action_type) {
        case 'created':  return { sentence: `${name} team created`, badgeText: 'Created' }
        case 'updated':  return { sentence: `${name} updated`, badgeText: 'Updated' }
        case 'deleted':  return { sentence: `${name} deleted`, badgeText: 'Deleted' }
        default: break
      }
      break
    }

    case 'access_request': {
      const reqType = d.request_type ? d.request_type.replace(/_/g, ' ') : 'access'
      switch (event.action_type) {
        case 'approved': return { sentence: `${targetName} ${reqType} request approved`, badgeText: 'Approved' }
        case 'rejected': return { sentence: `${targetName} ${reqType} request rejected`, badgeText: 'Rejected' }
        default: break
      }
      break
    }

    case 'invite': {
      const email = d.email || ''
      switch (event.action_type) {
        case 'created': return { sentence: `Invite sent to ${email}`, badgeText: 'Invited' }
        case 'deleted': return { sentence: `Invite to ${email} cancelled`, badgeText: 'Cancelled' }
        default: break
      }
      break
    }

    case 'organization_membership': {
      switch (event.action_type) {
        case 'temporary_access_granted':
          return { sentence: `${targetName} granted temporary access (${d.duration_minutes || '?'}min)`, badgeText: 'Temp access' }
        case 'temporary_access_revoked':
          return { sentence: `${targetName} temporary access revoked`, badgeText: 'Access revoked' }
        default: break
      }
      break
    }

    case 'settings': {
      return { sentence: fmt?.title || 'Settings updated', badgeText: 'Settings' }
    }

    default:
      break
  }

  // Final fallback: use ACTION_FORMAT title
  return { sentence: fallbackBadge, badgeText: fallbackBadge }
}
