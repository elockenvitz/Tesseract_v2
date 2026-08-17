import { defineConfig, devices } from '@playwright/test'

/**
 * Layout assertions and screenshot artifacts for the signal cards.
 *
 * These live in a real browser because the claims are about layout, and jsdom
 * has none: `offsetHeight` is always 0 there, so "the card is under 720px on a
 * phone" is unassertable in the unit suite. A rule that cannot be measured
 * where it is tested is a rule that regresses silently.
 *
 * 390px is the iPhone 14/15 logical width — the narrowest mainstream phone the
 * feed has to work on.
 */
export default defineConfig({
  testDir: './e2e',
  outputDir: './artifacts/playwright-output',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: process.env.CI ? [['list'], ['github']] : [['list']],
  use: {
    baseURL: 'http://localhost:4319',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  },
  projects: [
    {
      name: 'phone',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        // hasTouch was false, so dispatched touch events were ignored and the
        // gesture tests measured nothing. A layout suite for a phone that
        // cannot receive touch input is testing a desktop.
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: 'npx vite preview --config vite.gallery.config.ts --port 4319 --strictPort',
    url: 'http://localhost:4319',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
