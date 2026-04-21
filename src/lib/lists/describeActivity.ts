/**
 * Human-readable verb phrases for list activity events.
 *
 * Shared between the row-expansion activity strip (per-asset) and the
 * right-rail activity feed (list-wide), so phrasing stays consistent.
 */

interface ActivityLike {
  activity_type: string
  metadata: Record<string, any> | null
}

export function describeActivity(a: ActivityLike): string {
  const m = a.metadata ?? {}
  switch (a.activity_type) {
    case 'item_added':       return `added ${m.asset_symbol ?? 'an asset'} to the list`
    case 'item_removed':     return `removed ${m.asset_symbol ?? 'an asset'} from the list`
    case 'metadata_updated': {
      const fields = Array.isArray(m.changed_fields) ? (m.changed_fields as string[]).join(', ') : 'the list'
      return `updated ${fields}`
    }
    case 'collaborator_added':   return 'added a collaborator'
    case 'collaborator_removed': return 'removed a collaborator'

    // Row-level events
    case 'status_changed':
      return m.to_status
        ? `set ${m.asset_symbol ?? 'a row'} → ${m.to_status}`
        : `cleared status on ${m.asset_symbol ?? 'a row'}`
    case 'assignee_changed':
      return m.to_assignee_id
        ? `reassigned ${m.asset_symbol ?? 'a row'}`
        : `unassigned ${m.asset_symbol ?? 'a row'}`
    case 'due_date_changed':
      return m.to
        ? `set due date on ${m.asset_symbol ?? 'a row'} → ${m.to}`
        : `cleared due date on ${m.asset_symbol ?? 'a row'}`
    case 'tag_added':   return `tagged ${m.asset_symbol ?? 'a row'} ${m.tag_name ? `with ${m.tag_name}` : ''}`.trim()
    case 'tag_removed': return `removed ${m.tag_name ?? 'a tag'} from ${m.asset_symbol ?? 'a row'}`
    case 'flagged':     return `flagged ${m.asset_symbol ?? 'a row'} for discussion`
    case 'unflagged':   return `unflagged ${m.asset_symbol ?? 'a row'}`

    // List-level events
    case 'brief_updated':     return 'updated the brief'
    case 'deadline_changed':  return m.to ? `set deadline → ${m.to}` : 'cleared the deadline'
    case 'lifecycle_changed': return `moved list to ${m.to ?? '?'}`

    // Suggestion outcomes
    case 'suggestion_accepted': return 'accepted a suggestion'
    case 'suggestion_rejected': return 'rejected a suggestion'

    default: return a.activity_type.replace(/_/g, ' ')
  }
}
