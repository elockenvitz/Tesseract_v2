import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

/**
 * Builds the signal card gallery, and only the gallery.
 *
 * Kept out of the main vite config on purpose: the gallery imports test
 * fixtures and a hand-built sparkline, none of which should be reachable from
 * the app bundle. A separate root and a separate outDir make that structural
 * rather than a convention somebody has to remember.
 */
export default defineConfig({
  root: path.resolve(__dirname, 'gallery'),
  base: './',
  plugins: [react()],
  build: {
    outDir: path.resolve(__dirname, 'dist-gallery'),
    emptyOutDir: true,
  },
  /**
   * Reviewable from a phone over a tunnel.
   *
   * Vite's preview server answers 403 to any Host header it does not
   * recognise, which is every quick-tunnel hostname — and a quick tunnel mints
   * a NEW hostname every run, so there is nothing stable to list. The gallery
   * is a static fixture harness: it imports no Supabase client (enforced by
   * `guard:gallery`), reads no environment and carries no tenant data, so
   * there is nothing here for a host check to protect.
   *
   * Deliberately on the GALLERY config only. The app's own preview keeps its
   * default, because that one does serve real data.
   */
  preview: { allowedHosts: true },
  server: { allowedHosts: true },
})
