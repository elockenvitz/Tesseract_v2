/**
 * The list access rules, now that they are callable per row.
 *
 * ── Why this is gated ───────────────────────────────────────────────────
 *
 * The DELETE policy on `asset_list_items` once admitted the list owner and
 * ANY write collaborator, while the product rule on a collaborative list is
 * narrower — you may remove the rows you added. This function was the whole
 * boundary, and a regression here was silent: the button simply appeared, and
 * the delete succeeded. Migration 20261027002812 put the same own-row term in
 * Postgres, so the two now agree and this file pins the client half of a rule
 * that is enforced twice.
 *
 * The rules themselves are unchanged from `useListPermissions`; this file
 * pins them so the extraction cannot quietly become a rewrite.
 */
import { describe, it, expect } from 'vitest'
import { listPermissions, NO_LIST_ACCESS, type ListDataLike } from '../list-permissions'

const ME = 'user-me'
const THEM = 'user-them'

const mutual = (over: Partial<ListDataLike> = {}): ListDataLike => ({
  id: 'l1', name: 'Watchlist', list_type: 'mutual', created_by: ME, ...over,
})
const collaborative = (over: Partial<ListDataLike> = {}): ListDataLike => ({
  id: 'l2', name: 'Q3 Ideas', list_type: 'collaborative', created_by: ME, ...over,
})

describe('no list or no reader is no access', () => {
  it('returns nothing-permitted for an absent list', () => {
    const p = listPermissions({ list: null, userId: ME })
    expect(p).toEqual(NO_LIST_ACCESS)
    expect(p.canRemoveItem({ added_by: ME })).toBe(false)
  })

  it('returns nothing-permitted for a signed-out reader', () => {
    // Not "owner of everything". An undefined userId matching a null
    // created_by would otherwise read as ownership.
    const p = listPermissions({ list: mutual({ created_by: null }), userId: null })
    expect(p.isOwner).toBe(false)
    expect(p.canWrite).toBe(false)
    expect(p.canRemoveItem({ added_by: null })).toBe(false)
  })
})

describe('a mutual list', () => {
  it('lets the owner add and remove anything', () => {
    const p = listPermissions({ list: mutual(), userId: ME })
    expect(p.isOwner).toBe(true)
    expect(p.canAddAnyItem).toBe(true)
    expect(p.canRemoveAnyItem).toBe(true)
    expect(p.canRemoveItem({ added_by: THEM })).toBe(true)
  })

  it('lets a write collaborator remove a row somebody else added', () => {
    const p = listPermissions({
      list: mutual({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'write' }],
      userId: ME,
    })
    expect(p.canWrite).toBe(true)
    expect(p.canRemoveItem({ added_by: THEM })).toBe(true)
  })

  it('gives a read collaborator view access and nothing else', () => {
    const p = listPermissions({
      list: mutual({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'read' }],
      userId: ME,
    })
    expect(p.canView).toBe(true)
    expect(p.canWrite).toBe(false)
    expect(p.canRemoveItem({ added_by: ME })).toBe(false)
  })

  it('gives a stranger nothing', () => {
    const p = listPermissions({ list: mutual({ created_by: THEM }), userId: ME })
    expect(p.canView).toBe(false)
    expect(p.canRemoveItem({ added_by: ME })).toBe(false)
  })
})

describe('a collaborative list — the own-row rule, client half', () => {
  it('lets a write collaborator remove only the rows they added', () => {
    const p = listPermissions({
      list: collaborative({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'write' }],
      userId: ME,
    })
    expect(p.canWrite).toBe(true)
    expect(p.canRemoveItem({ added_by: ME })).toBe(true)
    // Refused here, and now refused by the DELETE policy too.
    expect(p.canRemoveItem({ added_by: THEM })).toBe(false)
    /*
     * `added_by: null` can no longer occur — 20261027013936 made the column
     * NOT NULL — but the rule still has to answer, because an optimistic row
     * built client-side before the insert returns has no author yet. Refusing
     * is the right answer: `null === userId` is false, so this is the
     * behaviour, not a gap.
     */
    expect(p.canRemoveItem({ added_by: null })).toBe(false)
  })

  it('applies the same restriction to the owner', () => {
    // Deliberate: on a collaborative list the owner does not reach into
    // another analyst's section either. This is the existing behaviour.
    const p = listPermissions({ list: collaborative(), userId: ME })
    expect(p.isOwner).toBe(true)
    expect(p.canRemoveAnyItem).toBe(false)
    expect(p.canRemoveItem({ added_by: THEM })).toBe(false)
    expect(p.canRemoveItem({ added_by: ME })).toBe(true)
  })

  it('never lets a read collaborator remove their own row', () => {
    const p = listPermissions({
      list: collaborative({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'read' }],
      userId: ME,
    })
    expect(p.canRemoveItem({ added_by: ME })).toBe(false)
  })
})

describe('an incomplete collaborator read cannot widen anything', () => {
  /*
   * A collaborator's SELECT on `asset_list_collaborations` is
   * `user_id = auth.uid()`, so they see only their own row. Every access
   * answer must therefore depend on the READER's row and never on the size
   * of the array — except `canChangeListType`, which requires ownership and
   * so is only ever asked of a complete read.
   */
  it('reads write access from the reader\'s own row, not the count', () => {
    /*
     * This case was written with `permission: 'admin'` and asserted
     * `canManageCollaborators === true`. Neither was ever reachable: 'admin'
     * failed the `valid_permission` CHECK on insert, so no such row could
     * exist, and the assertion was describing a tier that only the test had.
     * Changed to 'write', the tier that does exist, with the management
     * answer corrected to what production always returned.
     */
    const p = listPermissions({
      list: mutual({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'write' }],
      userId: ME,
    })
    expect(p.canWrite).toBe(true)
    expect(p.canManageCollaborators).toBe(false) // owner-only
    expect(p.canDeleteList).toBe(false) // still not the owner
  })

  it('ignores other people\'s collaboration rows entirely', () => {
    const p = listPermissions({
      list: mutual({ created_by: THEM }),
      collaborators: [{ user_id: THEM, permission: 'write' }],
      userId: ME,
    })
    expect(p.canView).toBe(false)
    expect(p.canWrite).toBe(false)
  })

  it('gives settings and collaborator management to the owner alone', () => {
    /*
     * The guard against re-growing a phantom tier. `hasAdminAccess` used to
     * read `isOwner || permission === 'admin'`, which looked like two ways in
     * and was one. Every storable permission must answer false here; if an
     * admin tier is ever added deliberately, this test is the place that has
     * to change, and changing it forces the product question to be answered.
     */
    for (const permission of ['read', 'write'] as const) {
      const p = listPermissions({
        list: mutual({ created_by: THEM }),
        collaborators: [{ user_id: ME, permission }],
        userId: ME,
      })
      expect(p.canManageCollaborators).toBe(false)
      expect(p.canEditListSettings).toBe(false)
      expect(p.canDeleteList).toBe(false)
    }
    const owner = listPermissions({ list: mutual(), userId: ME })
    expect(owner.canManageCollaborators).toBe(true)
    expect(owner.canEditListSettings).toBe(true)
  })

  it('refuses a list-type change to an owner who has collaborators', () => {
    expect(listPermissions({
      list: mutual(),
      collaborators: [{ user_id: THEM, permission: 'read' }],
      userId: ME,
    }).canChangeListType).toBe(false)
    expect(listPermissions({ list: mutual(), userId: ME }).canChangeListType).toBe(true)
  })
})
