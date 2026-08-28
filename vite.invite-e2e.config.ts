import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Builds the real application for the invitation end-to-end suite.
 *
 * The gallery build that the layout suite uses can't host this: the gallery is
 * deliberately Supabase-free pure components, and /invite/:token is a routed
 * page that talks to the database. So this builds the actual app — real router,
 * real InvitePage, real AuthLayout — with the Supabase client pointed at a
 * project reference that does not exist.
 *
 * Nothing is ever fetched from it. `src/lib/supabase.ts` throws at import time
 * without these two values, so they have to be *something*; every request the
 * page makes is intercepted by Playwright's `page.route`.
 *
 * The host has to sit under *.supabase.co. index.html ships a real
 * Content-Security-Policy whose connect-src allows 'self' and https://*.supabase.co
 * and nothing else, so a loopback address — the obvious choice for "somewhere
 * that cannot answer" — is blocked by the browser before the request is issued,
 * which means Playwright never sees it to intercept. Using an unregistered
 * subdomain keeps the fixture inside the policy the real app runs under, so
 * this suite exercises the same CSP production does.
 *
 * (A committed .env file would have been simpler, but .gitignore excludes
 * `.env*` except the example, and an e2e build config that only works on
 * machines with an uncommitted file is a suite that silently stops running.)
 */
const FIXTURE_SUPABASE_HOST = 'https://invite-e2e-fixture.supabase.co'

export default defineConfig({
  base: '/',
  define: {
    'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(FIXTURE_SUPABASE_HOST),
    'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify('invite-e2e-anon-key'),
    // Keep the access-request button out of the fixture so /signup asserts the
    // no-address branch, which is what production ships with today.
    'import.meta.env.VITE_ACCESS_REQUEST_EMAIL': JSON.stringify(''),
    'import.meta.env.VITE_SENTRY_DSN': JSON.stringify(''),
  },
  build: {
    outDir: 'dist-invite-e2e',
    emptyOutDir: true,
    sourcemap: false,
  },
  plugins: [react()],
})
