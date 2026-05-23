import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'

// We only emit source maps when we're going to upload them (i.e. when
// the Sentry auth token is present). Local `npm run build` without
// the token skips source-map generation entirely, which keeps the
// build fast and avoids Node OOM on developer machines.
const shouldEmitSourceMaps = !!process.env.SENTRY_AUTH_TOKEN

// https://vitejs.dev/config/
export default defineConfig({
  build: {
    sourcemap: shouldEmitSourceMaps,
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
  ],
  server: {
    host: true,
    port: 5173,
  },
})
