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
  const stub = path.resolve(__dirname, 'desktop-harness/stub-hooks.ts')
  return {
    name: 'desktop-harness-stub-hooks',
    enforce: 'pre',
    resolveId(source) {
      if (/hooks\/useDesktopIdeas$/.test(source)) return stub
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
