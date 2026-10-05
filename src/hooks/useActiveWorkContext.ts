/**
 * The graduation answer every active-work surface must share.
 *
 * `isActiveIdeaWork` takes `hasGraduated` as a required input, and there are
 * two plausible readings of it: the live flag, or the live flag backed by the
 * previous session's cached hint. They differ for the few hundred
 * milliseconds before the live read resolves — long enough for a retired
 * pilot seed to flash onto a surface that chose the narrower one.
 *
 * `usePipelineItems` already resolved this correctly (`live || cached`, so the
 * tour does not flash back onto the board on refresh). This exists so the
 * picker and every later surface inherit that decision instead of each
 * re-deriving it, which is the same failure the predicate itself fixes one
 * level up.
 */

import { usePilotProgress } from './usePilotProgress'
import type { ActiveWorkContext } from '../lib/ideas/active-work'

export function useActiveWorkContext(): { hasGraduated: boolean } {
  const { hasGraduated: liveGraduated, cachedHasGraduated } = usePilotProgress()
  // Cached hint covers the window before the live read resolves. Treating an
  // unresolved read as "not graduated" would re-show the tour; treating it as
  // graduated would hide real work. The cache is the only honest third option.
  return { hasGraduated: liveGraduated || cachedHasGraduated }
}

export type { ActiveWorkContext }
