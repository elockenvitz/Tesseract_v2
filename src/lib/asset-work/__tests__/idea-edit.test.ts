/**
 * The Work surface must not be more permissive than the modal.
 *
 * These are authorization expectations, so each one is written as the thing
 * that must be DENIED rather than the thing that happens to work today.
 */
import { describe, it, expect } from 'vitest'
import { canEditIdea } from '../idea-edit'

describe('canEditIdea', () => {
  it('lets the creator edit', () => {
    expect(canEditIdea({ created_by: 'u1' }, 'u1')).toBe(true)
  })

  it('lets an invited collaborator edit', () => {
    expect(canEditIdea({ created_by: 'u1', collaborators: ['u2'] }, 'u2')).toBe(true)
  })

  it('denies someone who is neither', () => {
    expect(canEditIdea({ created_by: 'u1', collaborators: ['u2'] }, 'u3')).toBe(false)
  })

  it('denies a signed-out viewer', () => {
    expect(canEditIdea({ created_by: 'u1' }, null)).toBe(false)
    expect(canEditIdea({ created_by: 'u1' }, undefined)).toBe(false)
  })

  it('denies when the idea has not loaded, rather than defaulting open', () => {
    expect(canEditIdea(null, 'u1')).toBe(false)
    expect(canEditIdea(undefined, 'u1')).toBe(false)
  })

  it('does not treat the assignee as an author', () => {
    /*
     * Being asked to look at an idea is not authority to rewrite its
     * author's thesis. `assigned_to` is deliberately not consulted, so a
     * row carrying one must still be denied.
     */
    const assignedToMe = { created_by: 'u1', collaborators: null, assigned_to: 'u3' }
    expect(canEditIdea(assignedToMe, 'u3')).toBe(false)
  })

  it('survives a null or malformed collaborator list', () => {
    expect(canEditIdea({ created_by: 'u1', collaborators: null }, 'u2')).toBe(false)
    expect(canEditIdea({ created_by: 'u1', collaborators: undefined }, 'u2')).toBe(false)
    expect(canEditIdea(
      { created_by: 'u1', collaborators: 'u2' as unknown as string[] }, 'u2',
    )).toBe(false)
  })

  it('does not match an undefined creator against an undefined user', () => {
    /* `created_by === userId` with both nullish would otherwise open the
       editor to everyone on a row whose author is missing. */
    expect(canEditIdea({ created_by: null }, null)).toBe(false)
    expect(canEditIdea({ created_by: undefined }, undefined)).toBe(false)
  })
})
