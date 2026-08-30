import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'

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
  css: {
    // The gallery has its own root, so PostCSS would otherwise look for a
    // config beside `gallery/` and find none — the cards would render
    // unstyled, and a layout suite over unstyled cards measures nothing.
    postcss: { plugins: [tailwindcss(), autoprefixer()] },
  },
  build: {
    outDir: path.resolve(__dirname, 'dist-gallery'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        // The card gallery, and the desktop cockpit on a page of its own —
        // its claims are about what fits in a viewport, so it cannot share one.
        main: path.resolve(__dirname, 'gallery/index.html'),
        cockpit: path.resolve(__dirname, 'gallery/cockpit.html'),
      },
    },
  },
})
