import { defineConfig, devices } from '@playwright/test'

/**
 * The invitation entry suite.
 *
 * Kept in its own config rather than added as a project to playwright.config.ts
 * because Playwright starts every configured `webServer` for any run: folding
 * this in would make `guard:layout` build and serve the whole application in
 * order to test the signal-card gallery.
 *
 * Phone viewport, because "the invitation link works on a phone" is one of the
 * things this suite exists to prove — an invite that only opens on a laptop is
 * useless when the link arrives in someone's mail app.
 */
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/invite-entry.spec.ts',
  outputDir: './artifacts/playwright-invite-output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: 'http://localhost:4321',
    ...devices['Desktop Chrome'],
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
  },
  projects: [{ name: 'invite-phone' }],
  webServer: {
    command:
      'npx vite build --config vite.invite-e2e.config.ts && npx vite preview --outDir dist-invite-e2e --port 4321 --strictPort',
    url: 'http://localhost:4321',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
