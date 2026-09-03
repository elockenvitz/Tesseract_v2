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
      return null
    },
  }
}

export default defineConfig({
  root: path.resolve(__dirname, 'desktop-harness'),
  base: './',
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
