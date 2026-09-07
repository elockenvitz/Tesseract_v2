/**
 * The gate that used to name one type.
 *
 * Layout's notification handler ended in `if (notification.type === 'asset')`.
 * NotificationPane resolves notes, lists, workflows and price targets too, and
 * every one of those was dropped on the floor: the row was marked read, the
 * pane stayed open, and nothing opened. On a phone the pane covers the screen,
 * so a tap that did nothing looked exactly like a tap that was not registered.
 */

import { describe, it, expect } from 'vitest'
import { isNavigableNotificationTarget } from '../routing'

describe('every destination the pane resolves is opened', () => {
  it('opens an asset, which is the only one that ever worked', () => {
    expect(isNavigableNotificationTarget({
      id: 'asset-1', title: 'AMZN', type: 'asset', data: { id: 'asset-1' },
    })).toBe(true)
  })

  it('opens a shared note', () => {
    expect(isNavigableNotificationTarget({
      id: 'note-1', title: 'Q1 review', type: 'note', data: { id: 'note-1' },
    })).toBe(true)
  })

  it('opens a list a collaborator changed', () => {
    expect(isNavigableNotificationTarget({
      id: 'list-1', title: 'Watchlist', type: 'list',
    })).toBe(true)
  })

  it('opens a workflow', () => {
    expect(isNavigableNotificationTarget({
      id: 'wf-1', title: 'Deep dive', type: 'workflow',
    })).toBe(true)
  })
})

describe('targets that cannot be opened are left alone', () => {
  it('refuses a target with no type, which chooses no surface', () => {
    expect(isNavigableNotificationTarget({ id: 'x' })).toBe(false)
  })

  it('refuses a target with no id, which would open a blank surface', () => {
    expect(isNavigableNotificationTarget({ type: 'asset' })).toBe(false)
  })

  it('refuses an empty string id, which reads as present but addresses nothing', () => {
    expect(isNavigableNotificationTarget({ id: '', type: 'asset' })).toBe(false)
  })

  it('refuses nothing at all', () => {
    expect(isNavigableNotificationTarget(null)).toBe(false)
    expect(isNavigableNotificationTarget(undefined)).toBe(false)
  })
})
