/**
 * Pure formatting functions for activity log rows and expanded details.
 *
 * formatActivityRow   — collapsed row: narrative title, subtitle, tone, icon, chips
 * formatActivityDetails — expanded view: diff / context / audit sections
 */

import { ACTION_FORMAT, FALLBACK_FORMAT } from '../org-activity-labels'
import type {
  OrgActivityEvent,
  FormattedActivityRow,
  FormattedActivityDetails,
  ActivityTone,
  ActivityDiffItem,
  ActivityContextItem,
  ActivityAuditItem,
} from '../../types/organization'

// ─── Tone derivation ─────────────────────────────────────────────────

const SUCCESS_ACTIONS = new Set([
  'created', 'added', 'role_granted', 'approved', 'restored', 'reactivated',
  'linked', 'temporary_access_granted',
])
const DANGER_ACTIONS = new Set([
  'removed', 'deleted', 'role_revoked', 'rejected', 'deactivated', 'discarded',
  'temporary_access_revoked',
])
const WARNING_ACTIONS = new Set([
  'archived',
])

function deriveTone(actionType: string | null): ActivityTone {
  if (!actionType) return 'neutral'
  if (SUCCESS_ACTIONS.has(actionType)) return 'success'
  if (DANGER_ACTIONS.has(actionType)) return 'danger'
  if (WARNING_ACTIONS.has(actionType)) return 'warning'
  return 'neutral'
}

// ─── Subtitle builder ────────────────────────────────────────────────

function buildSubtitle(
  event: OrgActivityEvent,
  userNameMap: Map<string, string>,
): string {
  const parts: string[] = []

  // Actor or System line
  if (event.actor_id) {
    const actorName = userNameMap.get(event.actor_id) || event.actor_id.slice(0, 8)
    parts.push(`By ${actorName}`)
  } else if (event.initiator_user_id) {
    const initiatorName = userNameMap.get(event.initiator_user_id) || event.initiator_user_id.slice(0, 8)
    parts.push(`System (initiated by ${initiatorName})`)
  } else {
    parts.push('System')
  }

  // Source type
  if (event.source_type === 'via_team') {
    const nodeName = event.details?.node_name
    parts.push(nodeName ? `Via ${nodeName}` : 'Via team')
  } else if (event.source_type === 'system') {
    parts.push('Scheduled')
  } else {
    parts.push('Direct')
  }

  // Time
  const d = new Date(event.created_at)
  parts.push(d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))

  return parts.join(' \u00b7 ')
}

// ─── Title builder ───────────────────────────────────────────────────

function buildTitle(
  event: OrgActivityEvent,
  userNameMap: Map<string, string>,
): string {
  const d = event.details || {}
  const targetName = event.target_user_id
    ? (userNameMap.get(event.target_user_id) || 'a user')
    : (d.user_name || d.email || '')
  const nodeName = d.node_name || ''
  const portfolioName = d.portfolio_name || d.name || ''
  const role = d.role || d.new_role || ''
  const oldRole = d.old_role || ''

  switch (event.entity_type) {
    case 'org_member': {
      switch (event.action_type) {
        case 'updated':
          if (event.action === 'member.deactivated')
            return `${targetName} was suspended`
          if (event.action === 'member.reactivated')
            return `${targetName} was reactivated`
          return `${targetName} membership updated`
        case 'role_granted':
          if (event.action === 'membership.admin_changed')
            return `${targetName} promoted to Org Admin`
          if (event.action === 'user.coverage_admin_changed')
            return `${targetName} granted coverage admin`
          return `${targetName} role granted`
        case 'role_revoked':
          if (event.action === 'membership.admin_changed')
            return `${targetName} demoted from Org Admin`
          if (event.action === 'user.coverage_admin_changed')
            return `${targetName} coverage admin revoked`
          return `${targetName} role revoked`
        case 'deactivated':
          return `${targetName} was suspended`
        case 'reactivated':
          return `${targetName} was reactivated`
        default:
          break
      }
      break
    }

    case 'team_membership': {
      const loc = nodeName ? ` to ${nodeName}` : ''
      const asRole = role ? ` as ${role}` : ''
      switch (event.action_type) {
        case 'added':
        case 'role_granted':
          return `${targetName} added${loc}${asRole}`
        case 'removed':
        case 'role_revoked':
          return `${targetName} removed${loc ? ` from ${nodeName}` : ''}`
        case 'role_changed':
          return `${targetName} role changed${loc ? ` on ${nodeName}` : ''}: ${oldRole} \u2192 ${role}`
        default:
          break
      }
      break
    }

    case 'portfolio_membership': {
      const on = portfolioName ? ` on ${portfolioName}` : ''
      switch (event.action_type) {
        case 'role_granted':
          return `${targetName} granted ${role || 'access'}${on}`
        case 'role_revoked':
        case 'removed':
          return `${targetName} removed${on}`
        case 'role_changed':
          return `${targetName} role changed${on}: ${oldRole} \u2192 ${role}`
        default:
          break
      }
      break
    }

    case 'portfolio': {
      const name = portfolioName || 'Portfolio'
      switch (event.action_type) {
        case 'created': return `${name} created`
        case 'archived': return `${name} archived`
        case 'restored': return `${name} restored`
        case 'discarded': return `${name} discarded`
        case 'deleted': return `${name} deleted`
        default: break
      }
      break
    }

    case 'team_node': {
      const name = d.name || nodeName || 'Team'
      switch (event.action_type) {
        case 'created': return `${name} team created`
        case 'updated': return `${name} updated`
        case 'deleted': return `${name} deleted`
        default: break
      }
      break
    }

    case 'access_request': {
      const reqType = d.request_type ? d.request_type.replace(/_/g, ' ') : 'access'
      switch (event.action_type) {
        case 'approved': return `${targetName} ${reqType} request approved`
        case 'rejected': return `${targetName} ${reqType} request rejected`
        default: break
      }
      break
    }

    case 'invite': {
      const email = d.email || ''
      switch (event.action_type) {
        case 'created': return `Invite sent to ${email}`
        case 'deleted': return `Invite to ${email} cancelled`
        default: break
      }
      break
    }

    case 'organization_membership': {
      switch (event.action_type) {
        case 'temporary_access_granted':
          return `${targetName} granted temporary access (${d.duration_minutes || '?'}min)`
        case 'temporary_access_revoked':
          return `${targetName} temporary access revoked`
        default: break
      }
      break
    }

    case 'settings': {
      const fmt = ACTION_FORMAT[event.action]
      return fmt?.title || 'Settings updated'
    }

    default:
      break
  }

  // Fallback: try ACTION_FORMAT title
  const fmt = ACTION_FORMAT[event.action]
  if (fmt) return fmt.title
  return 'Activity recorded'
}

// ─── Chip builder ────────────────────────────────────────────────────

function buildChips(event: OrgActivityEvent): string[] {
  const chips: string[] = []
  const d = event.details || {}
  if (d.node_name && event.entity_type !== 'team_node') chips.push(d.node_name)
  if (d.portfolio_name && event.entity_type !== 'portfolio') chips.push(d.portfolio_name)
  if (event.source_type === 'via_team' && !chips.some((c) => c === d.node_name)) chips.push('via team')
  if (event.source_type === 'system') chips.push('system')
  return chips.slice(0, 2)
}

// ─── Icon key derivation ─────────────────────────────────────────────

function deriveIconKey(event: OrgActivityEvent): string {
  const fmt = ACTION_FORMAT[event.action]
  if (fmt) return fmt.icon

  // Entity-type fallbacks
  switch (event.entity_type) {
    case 'org_member': return 'UserCog'
    case 'team_membership': return 'Users'
    case 'team_node': return 'FolderPlus'
    case 'portfolio': return 'Briefcase'
    case 'portfolio_membership': return 'Briefcase'
    case 'access_request': return 'ClipboardCheck'
    case 'invite': return 'Send'
    case 'settings': return 'Settings'
    default: return 'Activity'
  }
}

// ─── Public API ──────────────────────────────────────────────────────

export function formatActivityRow(
  event: OrgActivityEvent,
  userNameMap: Map<string, string>,
): FormattedActivityRow {
  return {
    title: buildTitle(event, userNameMap),
    subtitle: buildSubtitle(event, userNameMap),
    iconKey: deriveIconKey(event),
    tone: deriveTone(event.action_type),
    chips: buildChips(event),
  }
}

export function formatActivityDetails(
  event: OrgActivityEvent,
  userNameMap: Map<string, string>,
): FormattedActivityDetails {
  const d = event.details || {}

  // ── Diff section ──
  const diffs: ActivityDiffItem[] = []
  if (d.old_status != null && d.new_status != null) {
    diffs.push({ label: 'Status', left: String(d.old_status), right: String(d.new_status) })
  }
  if (d.old_role != null && d.new_role != null) {
    diffs.push({ label: 'Role', left: String(d.old_role), right: String(d.new_role) })
  }
  if (d.old_is_org_admin !== undefined) {
    diffs.push({
      label: 'Org Admin',
      left: d.old_is_org_admin ? 'Yes' : 'No',
      right: d.new_is_org_admin ? 'Yes' : 'No',
    })
  }
  if (d.old_coverage_admin !== undefined) {
    diffs.push({
      label: 'Coverage Admin',
      left: d.old_coverage_admin ? 'Yes' : 'No',
      right: d.new_coverage_admin ? 'Yes' : 'No',
    })
  }

  // ── Context section ──
  const context: ActivityContextItem[] = []
  if (event.target_user_id) {
    const name = userNameMap.get(event.target_user_id) || event.target_user_id.slice(0, 8)
    context.push({ label: 'Target User', value: name })
  }
  if (d.node_name) context.push({ label: 'Team / Node', value: d.node_name })
  if (d.portfolio_name) context.push({ label: 'Portfolio', value: d.portfolio_name })
  if (d.email) context.push({ label: 'Email', value: d.email })
  if (d.role) context.push({ label: 'Role', value: d.role })
  if (d.request_type) context.push({ label: 'Request Type', value: d.request_type.replace(/_/g, ' ') })
  if (d.reason) context.push({ label: 'Reason', value: d.reason })
  if (d.duration_minutes) context.push({ label: 'Duration', value: `${d.duration_minutes} min` })
  if (event.source_type) {
    const sourceLabel = event.source_type === 'via_team'
      ? (d.node_name ? `Via team (${d.node_name})` : 'Via team')
      : event.source_type === 'system' ? 'System' : 'Direct'
    context.push({ label: 'Source', value: sourceLabel })
  }

  // ── Audit section (always present) ──
  const audit: ActivityAuditItem[] = [
    { label: 'Event ID', value: event.id },
    { label: 'Entity Type', value: event.entity_type || 'unknown' },
    { label: 'Entity ID', value: event.target_id || '-' },
    { label: 'Action Type', value: event.action_type || event.action },
    { label: 'Action', value: event.action },
    { label: 'Source Type', value: event.source_type || '-' },
    { label: 'Source ID', value: event.source_id || '-' },
    { label: 'Timestamp', value: new Date(event.created_at).toISOString() },
    { label: 'Details (JSON)', value: JSON.stringify(event.details || {}, null, 2) },
    { label: 'Metadata (JSON)', value: JSON.stringify(event.metadata || {}, null, 2) },
  ]

  return {
    diff: diffs.length > 0 ? diffs : undefined,
    context: context.length > 0 ? context : undefined,
    audit,
  }
}
