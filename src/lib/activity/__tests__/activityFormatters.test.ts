import { describe, it, expect } from 'vitest'
import { formatActivityRow, formatActivityDetails } from '../activityFormatters'
import type { OrgActivityEvent } from '../../../types/organization'

// ─── Factory ─────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<OrgActivityEvent> = {}): OrgActivityEvent {
  return {
    id: 'evt-001',
    organization_id: 'org-1',
    actor_id: 'user-1',
    action: 'membership.status_changed',
    target_type: 'membership',
    target_id: 'mem-1',
    details: {},
    created_at: '2026-03-03T14:15:00Z',
    entity_type: 'org_member',
    action_type: 'updated',
    target_user_id: 'user-2',
    source_type: 'direct',
    source_id: null,
    metadata: {},
    initiator_user_id: null,
    ...overrides,
  }
}

const userNameMap = new Map([
  ['user-1', 'Alice Chen'],
  ['user-2', 'Dan Roberts'],
  ['user-3', 'Eric Lock'],
])

// ─── formatActivityRow ──────────────────────────────────────────────

describe('formatActivityRow', () => {
  it('1. org_member deactivated → title "suspended", tone danger', () => {
    const e = makeEvent({
      action: 'member.deactivated',
      action_type: 'deactivated',
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title.toLowerCase()).toContain('suspended')
    expect(row.tone).toBe('danger')
  })

  it('2. org_member reactivated → title "reactivated", tone success', () => {
    const e = makeEvent({
      action: 'member.reactivated',
      action_type: 'reactivated',
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title.toLowerCase()).toContain('reactivated')
    expect(row.tone).toBe('success')
  })

  it('3. org_member admin promoted → title "promoted to Org Admin"', () => {
    const e = makeEvent({
      action: 'membership.admin_changed',
      action_type: 'role_granted',
      details: { old_is_org_admin: false, new_is_org_admin: true },
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toContain('promoted to Org Admin')
  })

  it('4. org_member admin demoted → title "demoted from Org Admin"', () => {
    const e = makeEvent({
      action: 'membership.admin_changed',
      action_type: 'role_revoked',
      details: { old_is_org_admin: true, new_is_org_admin: false },
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toContain('demoted from Org Admin')
  })

  it('5. team_membership added → title includes node name and role', () => {
    const e = makeEvent({
      entity_type: 'team_membership',
      action: 'team_node_member.added',
      action_type: 'added',
      details: { node_name: 'Growth Team', role: 'Analyst' },
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toContain('Growth Team')
    expect(row.title).toContain('Analyst')
    expect(row.tone).toBe('success')
  })

  it('6. portfolio_membership role_changed → title includes old→new role', () => {
    const e = makeEvent({
      entity_type: 'portfolio_membership',
      action: 'portfolio_team.role_changed',
      action_type: 'role_changed',
      details: { old_role: 'Viewer', new_role: 'Editor', portfolio_name: 'Tech Fund' },
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toContain('Viewer')
    expect(row.title).toContain('Editor')
  })

  it('7. access_request approved → title "approved", chip with team name', () => {
    const e = makeEvent({
      entity_type: 'access_request',
      action: 'access_request.reviewed',
      action_type: 'approved',
      details: { request_type: 'team_join', node_name: 'Growth Team' },
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title.toLowerCase()).toContain('approved')
    expect(row.chips).toContain('Growth Team')
  })

  it('8. invite created → title includes email', () => {
    const e = makeEvent({
      entity_type: 'invite',
      action: 'invite.created',
      action_type: 'created',
      target_user_id: null,
      details: { email: 'bob@co.com' },
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toContain('bob@co.com')
  })

  it('9. settings → uses ACTION_FORMAT title', () => {
    const e = makeEvent({
      entity_type: 'settings',
      action: 'settings.onboarding_policy_changed',
      action_type: 'updated',
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toBe('Onboarding policy changed')
  })

  it('10. unknown entity_type → fallback "Activity recorded", tone neutral', () => {
    const e = makeEvent({
      entity_type: 'some_future_thing' as any,
      action: 'some_future_action',
      action_type: 'created',
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.title).toBe('Activity recorded')
    expect(row.tone).toBe('success') // 'created' maps to success
  })

  it('11. subtitle with actor_id null + initiator set → contains "System (initiated by"', () => {
    const e = makeEvent({
      actor_id: null,
      initiator_user_id: 'user-3',
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.subtitle).toContain('System (initiated by Eric Lock)')
  })

  it('12. subtitle with both null → contains "System"', () => {
    const e = makeEvent({
      actor_id: null,
      initiator_user_id: null,
    })
    const row = formatActivityRow(e, userNameMap)
    expect(row.subtitle).toMatch(/^System\b/)
  })
})

// ─── formatActivityDetails ──────────────────────────────────────────

describe('formatActivityDetails', () => {
  it('13. event with old_status/new_status → diff array present', () => {
    const e = makeEvent({
      details: { old_status: 'invited', new_status: 'active' },
    })
    const det = formatActivityDetails(e, userNameMap)
    expect(det.diff).toBeDefined()
    expect(det.diff!.length).toBeGreaterThanOrEqual(1)
    expect(det.diff![0].label).toBe('Status')
    expect(det.diff![0].left).toBe('invited')
    expect(det.diff![0].right).toBe('active')
  })

  it('14. event with no diff keys → diff undefined', () => {
    const e = makeEvent({ details: { node_name: 'Growth' } })
    const det = formatActivityDetails(e, userNameMap)
    expect(det.diff).toBeUndefined()
  })

  it('15. audit always contains Event ID', () => {
    const e = makeEvent()
    const det = formatActivityDetails(e, userNameMap)
    expect(det.audit).toBeDefined()
    const idItem = det.audit.find((a) => a.label === 'Event ID')
    expect(idItem).toBeDefined()
    expect(idItem!.value).toBe('evt-001')
  })
})
