/** Fixture-backed stand-ins for the Ideas data hooks. Harness only. */
import type { IdeaRow } from '../src/lib/desktop-ideas'
import { IDEAS, FRAMEWORK, EXPOSURE, OPEN_PRICE } from './fixtures'

export type { ScanFrame, ScanExposure } from '../src/hooks/useDesktopIdeas'

export const useIdeaScan = () => ({ ideas: IDEAS, isLoading: false, error: null })
export const useScanExposure = () => EXPOSURE
export const useScanFramework = () => FRAMEWORK
export const useScanOpenPrice = () => OPEN_PRICE
/**
 * Enrichment for the expanded idea.
 *
 * Returned undefined until now, which meant the workspace rendered only the
 * claim, the decision and the proposal -- so the framework and performance
 * modules never appeared and no amount of focus could foreground them. The
 * harness has to draw the panel before it can prove the panel responds.
 *
 * Built from the same FRAMEWORK the field uses, so a card and its expanded
 * form describe one object.
 */
export const useIdeaDetail = (i: IdeaRow | null) => {
  if (!i) return { detail: undefined, isLoading: false }
  const f = FRAMEWORK[i.assetId ?? '']
  const e = EXPOSURE[i.assetId ?? '']
  return {
    detail: {
      history: f?.closes ?? [],
      spot: f?.spot,
      target: f?.target,
      weightPct: e?.pct,
      ladder: f?.ladder ? { cases: f.ladder, updatedAt: new Date().toISOString() } : undefined,
      researchCount: 4,
    },
    isLoading: false,
  }
}
