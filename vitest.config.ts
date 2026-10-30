import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { readdirSync, readFileSync, statSync } from 'node:fs';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

/*
 * ── Why the unit tests run in two projects ────────────────────────────────
 *
 * Every unit file used to get `environment: 'jsdom'`, `css: true` and a
 * setup file that imports `@testing-library/react` and `jest-dom`. Most of
 * them never touch a DOM: they read source text and assert on it.
 *
 * Measured on a 40-file sample of those source-reading tests:
 *
 *   jsdom + setup : 23.6s wall   (setup 35.5s, environment 172s cumulative)
 *   node, no setup:  6.7s wall   (setup 0ms,   environment 12ms)
 *
 * Same 40 files, same 709 assertions, all passing either way. The cost was
 * never the testing — `tests` was 1.2s of it — it was building a DOM and
 * loading a React testing stack 577 times over.
 *
 * ── The split is computed, not listed ─────────────────────────────────────
 *
 * A hand-maintained list of "these files need a DOM" is exactly the kind of
 * thing that goes stale silently, which is the defect class `unit-guard.mjs`
 * exists to catch. So the classification is recomputed from the working tree
 * on every run: a file needs jsdom if it mentions one.
 *
 * Misclassification is safe in both directions, which is what makes a
 * heuristic acceptable here. A DOM test wrongly sent to node fails LOUDLY
 * (`document is not defined`) rather than silently passing; a node test left
 * in jsdom is merely slow. There is no quiet-wrong outcome.
 */
const DOM_HINT = /@testing-library|\brender\(|document\.|window\.|screen\.|HTMLElement|localStorage/;

/*
 * Files that need a DOM without ever saying so.
 *
 * The scan reads the test file, not the modules it imports, so a test whose
 * SUBJECT touches `window`, `sessionStorage` or `Storage` looks pure. These
 * six are those — found by running the split and reading the failures, not
 * by guessing.
 *
 * A list like this is usually a liability. It is safe here because being
 * wrong is loud: a DOM test placed in the node project dies with
 * `ReferenceError: window is not defined` on the first run, naming itself.
 * It cannot decay into a silent pass, so the worst a stale entry costs is
 * one red run and a one-line edit.
 *
 * ── One counter-example, found the hard way ──────────────────────────────
 *
 * That "loud" claim has an exception, and `desktop-research.test.ts` was it.
 * Its subject is `openResearch`, which OPENS with
 * `if (typeof window === 'undefined') return false` -- a guard that exists so
 * a surface does not break when rendered without a DOM. Under the node
 * project that guard turned "there is no DOM here" into "the request was
 * refused", so the suite neither crashed nor passed: it sat red on an
 * assertion about behaviour it could not reach, and stayed there.
 *
 * So the rule is narrower than it reads: a module that GUARDS on `window`
 * instead of touching it degrades quietly, and the misclassification shows up
 * as a confusing failure rather than a self-naming one.
 */
const NEEDS_DOM_DESPITE_NO_HINT = [
  'src/lib/asset-work/__tests__/requirement-drafts.test.ts',
  'src/lib/desktop-ideas/desktop-ideas.test.ts',
  'src/lib/desktop-research/desktop-research.test.ts',
  'src/lib/mobile/__tests__/feed-backgrounded.test.ts',
  'src/lib/mobile/__tests__/feed-position-teardown.test.ts',
  'src/lib/mobile/__tests__/feed-session-scope.test.ts',
  'src/lib/today/__tests__/create-actions.test.ts',
];

function collectTests(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) collectTests(full, acc);
    else if (/\.test\.tsx?$/.test(name)) acc.push(full);
  }
  return acc;
}

const SRC = path.join(dirname, 'src');
/** Files with no DOM reference, as paths relative to the root, POSIX-style. */
const NODE_TESTS = collectTests(SRC)
  .filter((f) => !DOM_HINT.test(readFileSync(f, 'utf8')))
  .map((f) => path.relative(dirname, f).split(path.sep).join('/'))
  .filter((rel) => !NEEDS_DOM_DESPITE_NO_HINT.includes(rel));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    projects: [
      // Unit tests that need a DOM.
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.{ts,tsx}'],
          // Everything the node project takes, this one leaves.
          exclude: NODE_TESTS,
          environment: 'jsdom',
        }
      },
      // Unit tests that only read source and assert on it. Same assertions,
      // no DOM and no React testing stack — see the note above.
      {
        extends: true,
        test: {
          name: 'unit-node',
          include: NODE_TESTS,
          environment: 'node',
          setupFiles: [],
          css: false,
        }
      },
      // Storybook tests
      {
        extends: true,
        plugins: [
        // The plugin will run tests for the stories defined in your Storybook config
        // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
        storybookTest({
          configDir: path.join(dirname, '.storybook')
        })],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{
              browser: 'chromium'
            }]
          },
          setupFiles: ['.storybook/vitest.setup.ts']
        }
      }
    ]
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  }
});