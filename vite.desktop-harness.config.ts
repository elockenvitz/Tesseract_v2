import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Renders the desktop Ideas field against fixtures, and nothing else.
 *
 * Stage 3S.1 measured the field at 1920 by hand. There was no harness, which
 * meant the density budget it established could only be re-checked by an
 * authenticated session against live data -- so in practice it was not
 * re-checked at all. This builds the same surface from fixtures so heights can
 * be measured and screenshotted repeatably.
 *
 * Kept out of the app config for the same reason the signal gallery is: it
 * resolves the data hooks to fixture stubs, and nothing that does that should
 * be reachable from the app bundle.
 */
function stubDataHooks(): Plugin {
  const ideas = path.resolve(__dirname, 'desktop-harness/stub-hooks.ts')
  const today = path.resolve(__dirname, 'desktop-harness/stub-today.ts')
  const research = path.resolve(__dirname, 'desktop-harness/stub-research.ts')
  const portfolio = path.resolve(__dirname, 'desktop-harness/stub-portfolio.ts')
  const decisions = path.resolve(__dirname, 'desktop-harness/stub-decisions.ts')
  const day = path.resolve(__dirname, 'desktop-harness/stub-day.ts')
  const timeline = path.resolve(__dirname, 'desktop-harness/stub-decision-timeline.ts')
  const workspace = path.resolve(__dirname, 'desktop-harness/stub-asset-workspace.ts')
  const mobileAsset = path.resolve(__dirname, 'desktop-harness/stub-mobile-asset-hooks.ts')
  const org = path.resolve(__dirname, 'desktop-harness/stub-organization.ts')
  const ratings = path.resolve(__dirname, 'desktop-harness/stub-analyst-ratings.ts')
  return {
    name: 'desktop-harness-stub-hooks',
    enforce: 'pre',
    resolveId(source) {
      if (/hooks\/useDesktopIdeas$/.test(source)) return ideas
      // Today's three data hooks all resolve to one stub module, which is
      // fine: each export is named, and a module that imports only
      // `useTodayEnrichment` gets only that.
      if (/engine\/decisionEngine$/.test(source)) return today
      if (/hooks\/useTodayEnrichment$/.test(source)) return today
      if (/hooks\/useAttentionState$/.test(source)) return today
      // The focused workspace. Without this the destination resolves no
      // subject and renders its not-found state, which is what earlier stages
      // were unknowingly screenshotting as "the workbench".
      if (/hooks\/useDesktopResearch$/.test(source)) return research
      // Portfolio and Decisions rendered a blank page until these existed,
      // which is how two rounds of cross-lens work shipped changes to them
      // that nobody had looked at.
      if (/hooks\/useDesktopPortfolio$/.test(source)) return portfolio
      if (/hooks\/useDesktopDecisions$/.test(source)) return decisions
      if (/hooks\/useDayPerformance$/.test(source)) return day
      // Asset Decision Memory (Increment 2B). Without this the timeline
      // reaches for Supabase and renders its loading state forever, which is
      // how a surface gets "validated" without anybody seeing it.
      if (/hooks\/useAssetDecisionTimeline$/.test(source)) return timeline
      // The Snapshot's headline rating. Deliberately a SPLIT fixture, so the
      // "3 of 5 analysts" qualifier has something to qualify.
      if (/hooks\/useAnalystRatings$/.test(source)) return ratings
      // The one read behind both Snapshots. Guard against the stub
      // re-entering itself: its own imports are already resolved.
      if (/hooks\/useAssetWorkspace$/.test(source) && !source.includes('stub-')) return workspace
      /*
       * The phone page's secondary reads. Two of them call
       * `useOrganization`, which THROWS without a provider -- so opening the
       * Decisions tab took the whole harness page down. One stub module
       * serves them all; each export is named.
       */
      if (/hooks\/useAssetTradeIdeas$/.test(source)) return mobileAsset
      if (/hooks\/useAssetRecentDecisions$/.test(source)) return mobileAsset
      if (/hooks\/useAssetHeaderContext$/.test(source)) return mobileAsset
      if (/hooks\/useAssetPortfolioWeights$/.test(source)) return mobileAsset
      if (/hooks\/useAssetLiveWeights$/.test(source)) return mobileAsset
      /*
       * `useOrganization` throws without a provider, and the harness has
       * none -- so ANY surface reaching it took the whole page down, tab bar
       * included. One stub unblocks every surface at once.
       */
      if (/contexts\/OrganizationContext$/.test(source) && !source.includes('stub-')) return org
      return null
    },
  }
}

export default defineConfig({
  root: path.resolve(__dirname, 'desktop-harness'),
  base: './',
  /**
   * The harness gets its OWN dependency cache.
   *
   * Without this it shares `node_modules/.vite` with the app config. The two
   * configs have different roots and therefore different dependency graphs, so
   * whichever ran last rewrote the cache — and the other then loaded a second
   * copy of React. The symptom is
   *
   *   Warning: Invalid hook call
   *   TypeError: Cannot read properties of null (reading 'useEffect')
   *
   * and a completely blank surface. That looks exactly like a component
   * defect, and it cost a round of chasing one: every journey assertion
   * failed immediately after an `npx vite build`, with no code change between
   * the passing and failing runs.
   *
   * A separate cacheDir lets `npm run dev` and the harness run side by side,
   * which is the normal way to compare a change against the real app.
   */
  cacheDir: path.resolve(__dirname, 'node_modules/.vite-desktop-harness'),
  plugins: [stubDataHooks(), react()],
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify('http://harness.invalid'),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('harness-anon-key'),
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-desktop-harness'),
    emptyOutDir: true,
  },
})
