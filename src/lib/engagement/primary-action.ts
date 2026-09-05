/**
 * The engagement seam — the primary action slot.
 *
 * ── What this is and is not ───────────────────────────────────────────────
 *
 * The third slot in the shared grammar. `Ask AI` and `Discuss` are the same
 * on every surface, which is why the seam can own them outright. The primary
 * action is the opposite: only the surface knows that a stale thesis wants
 * "Review scenarios" and an open proposal wants "Decide". So the seam owns the
 * *slot* — its shape, its resolution and its guarantees — and the surfaces
 * own what goes in it.
 *
 * This is NOT an action framework. It does not execute, queue, retry, batch,
 * confirm or undo. It resolves one label and one handler for one target. The
 * handler is an ordinary function the surface already had.
 *
 * ── Why a registry rather than a prop ─────────────────────────────────────
 *
 * A prop would be simpler and is the right answer for a single surface. The
 * registry earns its place because Stage D2+ has several surfaces raising
 * items about the same object types, and the useful property is that
 * "what is the next action for a stale thesis" has ONE answer regardless of
 * whether Today, Ideas or Research surfaced it. A registry keyed by the
 * producer's reason gives that; a prop per call site guarantees the opposite.
 *
 * Surfaces can still bypass it: `resolvePrimaryAction` takes an explicit
 * override, and an unregistered reason simply returns null rather than
 * throwing, so a surface with a one-off action does not have to register it.
 */

import type { EngagementTarget } from './types'

/**
 * A structured next action for a surfaced item.
 *
 * `run` is deliberately synchronous-or-promise and returns nothing: D1 proves
 * the seam carries an action, not that the seam manages its lifecycle. When a
 * later stage needs optimistic state or failure handling, that belongs to the
 * action's own implementation, not to the slot.
 */
export interface PrimaryAction {
  /** Stable identifier, for tests and telemetry. */
  key: string
  /** The verb, as it appears on the button. "Review scenarios". */
  label: string
  /**
   * Whether this action changes shared state. Purely descriptive in D1 — it
   * exists so the eventual Today UI can style a navigation differently from a
   * mutation, which is the distinction the architecture audit found missing.
   */
  kind: 'navigate' | 'mutate'
  run: (target: EngagementTarget) => void | Promise<void>
  /** Reason the action is unavailable for this target; disables the slot. */
  unavailable?: string
}

/** Builds an action for a target, or null when it does not apply to it. */
export type PrimaryActionFactory = (target: EngagementTarget) => PrimaryAction | null

const registry = new Map<string, PrimaryActionFactory>()

/**
 * Register the primary action for a producer reason.
 *
 * Keyed by `EngagementIssue.reason` — the evaluator or rule that raised the
 * item — because that is what actually determines the right next step. Two
 * items about the same asset raised by different evaluators want different
 * verbs, so keying on object type would collapse exactly the distinction the
 * slot exists to preserve.
 *
 * Last registration wins, and re-registering the same key is allowed: modules
 * register at import time and a hot reload must not throw.
 */
export function registerPrimaryAction(reason: string, factory: PrimaryActionFactory): void {
  registry.set(reason, factory)
}

/** Testing seam. */
export function __clearPrimaryActions(): void {
  registry.clear()
}

export function registeredPrimaryActionKeys(): string[] {
  return [...registry.keys()].sort()
}

/**
 * Resolve the primary action for a target.
 *
 * Order: an explicit override always wins, then the registry, then null.
 * Null is a normal outcome — an item with no meaningful structured next step
 * should show no primary button rather than a generic "Open", which is the
 * behaviour the prototype committed to.
 */
export function resolvePrimaryAction(
  target: EngagementTarget,
  override?: PrimaryAction | null,
): PrimaryAction | null {
  if (override) return override
  const reason = target.issue?.reason
  if (!reason) return null
  const factory = registry.get(reason)
  if (!factory) return null
  return factory(target)
}
