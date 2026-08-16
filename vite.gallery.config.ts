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
})
