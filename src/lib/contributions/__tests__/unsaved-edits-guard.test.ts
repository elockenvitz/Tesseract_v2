import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  registerUnsavedEditor,
  hasUnsavedEdits,
  requestUnsavedNavigation,
  getPendingNavigation,
  resolveUnsavedNavigation,
  subscribeUnsavedGuard,
  __resetUnsavedGuardForTests,
} from '../unsaved-edits-guard'

/**
 * UX1c-2b — in-app unsaved-research guard. This module is framework-free, so
 * these are real behavioural tests (not source pins): they exercise the exact
 * decision the guard makes before any navigation is allowed to unmount a dirty
 * editor. Non-vacuous by construction — each asserts the observable effect
 * (proceed ran / did not run, pending retained / cleared, save invoked).
 */

beforeEach(() => __resetUnsavedGuardForTests())

describe('clean editor: navigation is transparent', () => {
  it('runs the gesture immediately and raises no prompt when nothing is dirty', () => {
    registerUnsavedEditor({ isDirty: () => false, saveDraft: async () => {} })
    const proceed = vi.fn()
    requestUnsavedNavigation(proceed)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(getPendingNavigation()).toBeNull()
  })

  it('with no editors registered at all, navigation just proceeds', () => {
    const proceed = vi.fn()
    requestUnsavedNavigation(proceed)
    expect(proceed).toHaveBeenCalledTimes(1)
  })
})

describe('dirty editor: navigation is held', () => {
  it('does NOT run the gesture and holds it pending, notifying subscribers', () => {
    registerUnsavedEditor({ isDirty: () => true, saveDraft: async () => {} })
    const listener = vi.fn()
    subscribeUnsavedGuard(listener)
    const proceed = vi.fn()

    requestUnsavedNavigation(proceed)

    expect(proceed).not.toHaveBeenCalled()
    expect(getPendingNavigation()).not.toBeNull()
    expect(listener).toHaveBeenCalled()
  })

  it('Stay cancels navigation and keeps editor state', async () => {
    registerUnsavedEditor({ isDirty: () => true, saveDraft: async () => {} })
    const proceed = vi.fn()
    requestUnsavedNavigation(proceed)

    await resolveUnsavedNavigation('stay')

    expect(proceed).not.toHaveBeenCalled()
    expect(getPendingNavigation()).toBeNull()
  })

  it('Discard abandons the edits and completes the navigation exactly once', async () => {
    registerUnsavedEditor({ isDirty: () => true, saveDraft: async () => {} })
    const proceed = vi.fn()
    requestUnsavedNavigation(proceed)

    await resolveUnsavedNavigation('discard')

    expect(proceed).toHaveBeenCalledTimes(1)
    expect(getPendingNavigation()).toBeNull()
  })
})

describe('Save draft: persist then navigate', () => {
  it('runs the existing draft save, then navigates, in that order', async () => {
    const calls: string[] = []
    const saveDraft = vi.fn(async () => { calls.push('save') })
    registerUnsavedEditor({ isDirty: () => true, saveDraft })
    const proceed = vi.fn(() => { calls.push('proceed') })
    requestUnsavedNavigation(proceed)

    await resolveUnsavedNavigation('save')

    expect(saveDraft).toHaveBeenCalledTimes(1)
    expect(proceed).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(['save', 'proceed'])
    expect(getPendingNavigation()).toBeNull()
  })

  it('on save FAILURE does not navigate and retains the pending gesture', async () => {
    const saveDraft = vi.fn(async () => { throw new Error('network') })
    registerUnsavedEditor({ isDirty: () => true, saveDraft })
    const proceed = vi.fn()
    requestUnsavedNavigation(proceed)

    await expect(resolveUnsavedNavigation('save')).rejects.toThrow('network')

    expect(proceed).not.toHaveBeenCalled()
    expect(getPendingNavigation()).not.toBeNull() // user can retry or Stay
  })

  it('only saves editors that are actually dirty', async () => {
    const dirtySave = vi.fn(async () => {})
    const cleanSave = vi.fn(async () => {})
    registerUnsavedEditor({ isDirty: () => true, saveDraft: dirtySave })
    registerUnsavedEditor({ isDirty: () => false, saveDraft: cleanSave })
    requestUnsavedNavigation(vi.fn())

    await resolveUnsavedNavigation('save')

    expect(dirtySave).toHaveBeenCalledTimes(1)
    expect(cleanSave).not.toHaveBeenCalled()
  })
})

describe('edge cases', () => {
  it('a second navigation attempt while one is pending is ignored (first wins)', async () => {
    registerUnsavedEditor({ isDirty: () => true, saveDraft: async () => {} })
    const first = vi.fn()
    const second = vi.fn()
    requestUnsavedNavigation(first)
    requestUnsavedNavigation(second) // modal is up; must not clobber the first

    await resolveUnsavedNavigation('discard')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).not.toHaveBeenCalled()
  })

  it('after resolving, a fresh navigation attempt works again', async () => {
    registerUnsavedEditor({ isDirty: () => true, saveDraft: async () => {} })
    const first = vi.fn()
    requestUnsavedNavigation(first)
    await resolveUnsavedNavigation('discard')

    const second = vi.fn()
    requestUnsavedNavigation(second)
    await resolveUnsavedNavigation('discard')

    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('unregistering an editor makes navigation transparent again', () => {
    const unregister = registerUnsavedEditor({ isDirty: () => true, saveDraft: async () => {} })
    expect(hasUnsavedEdits()).toBe(true)
    unregister()
    expect(hasUnsavedEdits()).toBe(false)

    const proceed = vi.fn()
    requestUnsavedNavigation(proceed)
    expect(proceed).toHaveBeenCalledTimes(1)
  })

  it('resolving with no pending gesture is a no-op', async () => {
    await expect(resolveUnsavedNavigation('discard')).resolves.toBeUndefined()
  })
})
