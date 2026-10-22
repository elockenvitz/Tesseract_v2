/**
 * The list access rules, now that they are callable per row.
 *
 * ── Why this is gated ───────────────────────────────────────────────────
 *
 * The DELETE policy on `asset_list_items` admits the list owner and ANY
 * write/admin collaborator. On a collaborative list the product rule is
 * narrower — you may remove the rows you added — and nothing in Postgres
 * enforces that half. So this function is the whole boundary, and a
 * regression here is silent: the button simply appears, and the delete
 * succeeds.
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

describe('a collaborative list — the rule Postgres does not enforce', () => {
  it('lets a write collaborator remove only the rows they added', () => {
    const p = listPermissions({
      list: collaborative({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'write' }],
      userId: ME,
    })
    expect(p.canWrite).toBe(true)
    expect(p.canRemoveItem({ added_by: ME })).toBe(true)
    // The DELETE policy would allow this. The product rule does not.
    expect(p.canRemoveItem({ added_by: THEM })).toBe(false)
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
    const p = listPermissions({
      list: mutual({ created_by: THEM }),
      collaborators: [{ user_id: ME, permission: 'admin' }],
      userId: ME,
    })
    expect(p.canWrite).toBe(true)
    expect(p.canManageCollaborators).toBe(true)
    expect(p.canDeleteList).toBe(false) // still not the owner
  })

  it('ignores other people\'s collaboration rows entirely', () => {
    const p = listPermissions({
      list: mutual({ created_by: THEM }),
      collaborators: [{ user_id: THEM, permission: 'admin' }],
      userId: ME,
    })
    expect(p.canView).toBe(false)
    expect(p.canWrite).toBe(false)
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
