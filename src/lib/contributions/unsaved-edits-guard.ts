/**
 * UX1c-2b — In-app unsaved-research protection.
 *
 * A framework-free singleton that lets any in-app navigation that would unmount
 * an actively-editing Investment Case section pause and ask the user first. It
 * is deliberately NOT a router: React cannot cancel an unmount from the child
 * that is being unmounted, so every navigation gesture that could discard an
 * open editor must consult this guard *before* it changes the state that
 * unmounts the editor.
 *
 * Shape of the contract:
 *   - An inline editor registers while it is mounted (ContributionSection,
 *     inlineEditor only). Its `isDirty()` reports whether it holds unsaved work
 *     and `saveDraft()` runs the existing draft-save mutation (no new path).
 *   - A navigation gesture calls `requestUnsavedNavigation(proceed)`. When
 *     nothing is dirty this runs `proceed()` synchronously, so guarded and
 *     unguarded navigation behave identically when the editor is clean.
 *   - When something is dirty the gesture is held and subscribers (the mounted
 *     prompt) are notified. The user resolves it with 'stay' / 'discard' /
 *     'save'; only 'discard' and a *successful* 'save' let `proceed()` run.
 *
 * There is no persistence here — 'save' delegates to the editor's own
 * `saveDraft`. This module owns navigation intent only.
 */

export interface UnsavedEditor {
  /** True when the editor currently holds unsaved changes. */
  isDirty: () => boolean
  /** Runs the existing draft-save mutation. Rejects if the save fails. */
  saveDraft: () => Promise<void>
}

const editors = new Map<symbol, UnsavedEditor>()
let pending: (() => void) | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((l) => l())
}

/** Register an editor while it is mounted. Returns an unregister function. */
export function registerUnsavedEditor(editor: UnsavedEditor): () => void {
  const key = Symbol('unsaved-editor')
  editors.set(key, editor)
  return () => {
    editors.delete(key)
  }
}

/** True when any registered editor reports unsaved work. */
export function hasUnsavedEdits(): boolean {
  for (const editor of editors.values()) {
    if (editor.isDirty()) return true
  }
  return false
}

function dirtyEditors(): UnsavedEditor[] {
  return [...editors.values()].filter((e) => e.isDirty())
}

/**
 * Gate a navigation gesture. Runs `proceed` immediately when the editor is
 * clean; otherwise holds it and raises the prompt. A second request while one
 * is already pending is ignored so the first gesture is never lost behind the
 * modal.
 */
export function requestUnsavedNavigation(proceed: () => void): void {
  if (!hasUnsavedEdits()) {
    proceed()
    return
  }
  if (pending) return // a prompt is already open; keep the first gesture
  pending = proceed
  emit()
}

/** The gesture currently waiting on the user, if any. */
export function getPendingNavigation(): (() => void) | null {
  return pending
}

export type UnsavedResolution = 'stay' | 'discard' | 'save'

/**
 * Resolve the pending gesture.
 *   - 'stay'    cancels navigation and keeps all editor state.
 *   - 'discard' abandons the edits and completes the navigation.
 *   - 'save'    runs every dirty editor's draft save and navigates only after
 *               they all succeed; if any save rejects, the gesture is retained
 *               and the error propagates so the prompt can stay open.
 */
export async function resolveUnsavedNavigation(choice: UnsavedResolution): Promise<void> {
  const proceed = pending
  if (!proceed) return

  if (choice === 'stay') {
    pending = null
    emit()
    return
  }

  if (choice === 'save') {
    // Let a rejection bubble up WITHOUT clearing `pending`, so a failed save
    // never navigates and the user keeps their work and the open prompt.
    await Promise.all(dirtyEditors().map((e) => e.saveDraft()))
  }

  pending = null
  emit()
  proceed()
}

/** Subscribe to pending-state changes (used by the mounted prompt). */
export function subscribeUnsavedGuard(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only reset of module state. */
export function __resetUnsavedGuardForTests(): void {
  editors.clear()
  pending = null
  listeners.clear()
}
