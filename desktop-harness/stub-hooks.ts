/** Fixture-backed stand-ins for the Ideas data hooks. Harness only. */
import type { IdeaRow } from '../src/lib/desktop-ideas'
import { IDEAS, FRAMEWORK, EXPOSURE, OPEN_PRICE } from './fixtures'

export type { ScanFrame, ScanExposure } from '../src/hooks/useDesktopIdeas'

export const useIdeaScan = () => ({ ideas: IDEAS, isLoading: false, error: null })
export const useScanExposure = () => EXPOSURE
export const useScanFramework = () => FRAMEWORK
export const useScanOpenPrice = () => OPEN_PRICE
export const useIdeaDetail = (_i: IdeaRow | null) => ({ detail: undefined, isLoading: false })
