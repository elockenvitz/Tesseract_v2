import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Builds the coverage visual harness, and only that.
 *
 * Separate from vite.gallery.config.ts on purpose. The gallery is guarded by
 * `guard:gallery`, which proves nothing it can reach imports Supabase;
 * CoverageQuickStart does, so it gets its own entry with Supabase and the
 * coverage/auth hooks aliased to fixtures. Keeping them apart means the
 * gallery's guarantee stays meaningful.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'visual'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: /^.*\/lib\/supabase$/, replacement: path.resolve(__dirname, 'visual/supabase-stub.ts') },
      { find: /^.*\/hooks\/useMyCoverage$/, replacement: path.resolve(__dirname, 'visual/useMyCoverage-stub.ts') },
      { find: /^.*\/hooks\/useAuth$/, replacement: path.resolve(__dirname, 'visual/context-stubs.ts') },
      { find: /^.*\/contexts\/OrganizationContext$/, replacement: path.resolve(__dirname, 'visual/context-stubs.ts') },
    ],
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-visual'),
    emptyOutDir: true,
  },
})
