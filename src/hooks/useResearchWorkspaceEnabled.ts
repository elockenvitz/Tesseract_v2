import { useMemo } from 'react'

/**
 * Feature flag for the Research Workspace canvas — the flexible, customizable
 * Asset Research layout that places the structured Investment Case on a grid
 * with widgets.
 *
 * Default OFF. When this returns false the Research page renders exactly as it
 * does today (the canvas is a layout-transparent pass-through), so the rollout
 * is fully reversible and no one sees the canvas until it is enabled.
 *
 * S0 sources the flag from a per-viewer opt-in in localStorage
 * (`tsx:research-workspace` === "1"), which keeps it off by default and lets a
 * pilot user or operator turn it on in their own browser. A later slice swaps
 * the source for the org/pilot flag (usePilotMode) without changing callers.
 * Reads are wrapped in try/catch so a blocked or private store never throws.
 */
export function useResearchWorkspaceEnabled(): boolean {
  return useMemo(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('tsx:research-workspace') === '1'
    } catch {
      return false
    }
  }, [])
}
