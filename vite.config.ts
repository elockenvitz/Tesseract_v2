import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { visualizer } from 'rollup-plugin-visualizer'

// We only emit source maps when we're going to upload them (i.e. when
// the Sentry auth token is present). Local `npm run build` without
// the token skips source-map generation entirely, which keeps the
// build fast and avoids Node OOM on developer machines.
const shouldEmitSourceMaps = !!process.env.SENTRY_AUTH_TOKEN

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  build: {
    sourcemap: shouldEmitSourceMaps,
    rollupOptions: {
      output: {
        /**
         * Split the libraries out of the app chunk.
         *
         * ── What this is actually for ────────────────────────────────────
         *
         * The main chunk was 9.2MB, and it contains both the application and
         * every library it depends on. Transfer was never the problem —
         * measured over the mobile tunnel it gzips to 2.3MB and arrives in 3.3
         * seconds — but the browser then has to parse and execute all 9.2MB
         * before anything renders, and that is the wait.
         *
         * Splitting does not reduce the total. What it buys is CACHING, and
         * that is the win for the review loop: the libraries do not change
         * between builds, so a rebuild-and-reload re-downloads and re-parses
         * only the application chunk. Today every reload after every build
         * pays for the whole thing again.
         *
         * Grouped by change frequency rather than by size. `react` and
         * `supabase` are the floor of every page; the chart and document
         * libraries are heavy and used by a minority of surfaces, so keeping
         * them apart also lets a route that never touches them skip the parse.
         */
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          supabase: ['@supabase/supabase-js'],
          charts: ['recharts', 'lightweight-charts', 'd3-array', 'd3-scale', 'd3-time', 'd3-time-format'],
          docs: ['xlsx', 'jspdf', 'html2canvas'],
        },
      },
    },
  },
  plugins: [
    react(),
    // Upload source maps to Sentry so production stack traces show
    // real file/line numbers (TradeLabPage.tsx:127) instead of
    // minified gibberish (index-abc.js:42:12345). Disabled when
    // SENTRY_AUTH_TOKEN isn't set — i.e. local builds and any CI run
    // without the secret skip the upload entirely. Auth token is
    // injected by Netlify's build env.
    sentryVitePlugin({
      org: 'tesseract-org',
      project: 'tesseract',
      authToken: process.env.SENTRY_AUTH_TOKEN,
      disable: !process.env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        // After upload, strip .map files from dist/ so they don't ship
        // to clients. (Pre-deletion, the maps would still be reachable
        // at /assets/*.js.map and expose source code.)
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    }),
    // Bundle size visualizer. Only runs under `npm run analyze`
    // (vite build --mode analyze) so normal dev/build is unaffected.
    // Opens dist/stats.html in the browser after build.
    mode === 'analyze' &&
      visualizer({
        filename: 'dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
        template: 'treemap',
      }),
  ],
  server: {
    host: true,
    port: 5173,
  },
}))
