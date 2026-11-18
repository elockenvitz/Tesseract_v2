/**
 * Charting renders with the auth module the application actually provides.
 *
 * ── The P0 this pins ──────────────────────────────────────────────────────
 *
 * Opening Charting in production threw
 *
 *     useAuth must be used within an AuthProvider
 *
 * from inside the lazy `ChartingPage-*.js` chunk, taking the whole route
 * down.
 *
 * There are TWO useAuth implementations in this codebase, and only one of
 * them works at runtime:
 *
 *   src/hooks/useAuth.ts        a standalone hook reading the Supabase
 *                              session directly. No context, no provider
 *                              needed. ~255 call sites.
 *   src/contexts/AuthContext    a React context whose useAuth THROWS the
 *                              message above when no provider sits over it.
 *
 * `<AuthProvider>` is rendered NOWHERE in this application. App.tsx mounts
 * QueryClient, Theme, Toast, Capture, Router, Organization and
 * CoverageRelevance -- and no AuthProvider. So the context version throws on
 * its first render, unconditionally, for anyone who imports it.
 *
 * ChartingPage imported the context version. The same file also calls
 * `useOrganization`, which is ALSO a throwing context hook -- and that one is
 * fine, because `OrganizationProvider` really is mounted. Two context hooks
 * in one file, one provider present, one absent: that contrast is the whole
 * bug.
 *
 * ── Why the fix is an import and not a provider ────────────────────────────
 *
 * Mounting an AuthProvider would give Charting a SECOND, independent auth
 * state, separate from the one the other ~255 call sites read -- a duplicate
 * source of truth for who is signed in. Pointing this file at `hooks/useAuth`
 * instead makes it agree with the rest of the application, and the hook
 * returns a superset of the same shape, so `{ user }` is unchanged.
 *
 * ── What this file deliberately does NOT mock ─────────────────────────────
 *
 * `hooks/useAuth` and `contexts/AuthContext`. Mocking either is precisely
 * what would make this test vacuous: the bug IS which module is imported, so
 * a test that stubs the module cannot see it. Supabase is mocked one level
 * below, so the real hook runs its real code path.
 *
 * Organization, charting internals and Supabase are stubbed, because this is
 * about which auth module Charting binds to, not about rendering a canvas.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, waitFor, cleanup } from '@testing-library/react'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import React, { Suspense, lazy } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

/* ─────────────────────────── the stubs ─────────────────────────────────── */

const CACHED_USER = { id: 'user-hotfix-1', email: 'analyst@example.test' }

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      // The real hook awaits this once on mount.
      getSession: () => Promise.resolve({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }),
        order: () => Promise.resolve({ data: [], error: null }),
        then: (r: (v: { data: never[]; error: null }) => unknown) =>
          r({ data: [], error: null }),
      }),
    }),
    channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}) }),
    removeChannel: () => {},
  },
}))

/*
 * The organization context IS mounted in production, so stubbing its hook
 * changes nothing about the defect under test. Stubbed rather than mounted
 * because the real provider fetches.
 */
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'org-hotfix-1', currentOrganization: null }),
  useOrganizationOptional: () => null,
  OrganizationProvider: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}))

/* A canvas cannot render in jsdom. ChartType/TimeFrame/IndicatorType and
   CustomDateRange are type-only exports, so they vanish harmlessly. */
vi.mock('../../components/charting', () => ({
  ProChart: (props: { symbol?: string }) => (
    <div data-testid="pro-chart" data-symbol={props?.symbol ?? ''} />
  ),
}))

/* ──────────────────── the production-equivalent tree ───────────────────── */

/**
 * Exactly how DashboardPage.tsx:65 declares it, so the test exercises the
 * same lazy chunk boundary the failing asset came from.
 */
const LazyCharting = lazy(() =>
  import('../ChartingPage').then(m => ({ default: m.ChartingPage })),
)

/**
 * The providers Charting actually renders under in production -- and, just as
 * importantly, NO AuthProvider, because production has none. Adding one here
 * would make this test pass while production kept crashing.
 */
function ProductionTree({ children }: { children: React.ReactNode }) {
  /* Charting's subtree uses react-query, and App.tsx mounts a
     QueryClientProvider above it. Retries off so a stubbed query fails fast
     instead of holding the test open. */
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })
  return (
    <QueryClientProvider client={client}>
      <Suspense fallback={<div data-testid="suspense-fallback" />}>{children}</Suspense>
    </QueryClientProvider>
  )
}

describe('the Charting route loads for an authenticated user', () => {
  beforeEach(() => {
    // The real hook seeds `user` synchronously from this cache key, so the
    // first render has a signed-in user without awaiting the session.
    localStorage.setItem('auth-user-cache', JSON.stringify(CACHED_USER))
  })

  afterEach(() => {
    cleanup()
    localStorage.clear()
  })

  it('renders the lazy chunk without throwing the AuthProvider error', async () => {
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '))
    })

    const view = render(
      <ProductionTree>
        <LazyCharting workspaceId="tab-1" initialSymbol="AAPL" />
      </ProductionTree>,
    )

    /*
     * Assert the page RENDERED, not merely that the fallback went away.
     *
     * The first version of this test waited only for the fallback to
     * disappear -- and PASSED with the bug still present, because a lazy
     * component that throws also removes the fallback. "The spinner stopped"
     * is not "the page loaded". Requiring Charting's own content is what
     * makes this test able to fail.
     */
    await waitFor(() => {
      expect(view.queryByTestId('pro-chart')).not.toBeNull()
    }, { timeout: 5000 })
    expect(view.queryByTestId('suspense-fallback')).toBeNull()

    /* And the exact production message, separately, so a different failure
       mode is not reported as this one. */
    const authErrors = errors.filter(e => /useAuth must be used within an AuthProvider/.test(e))
    expect(authErrors, 'Charting threw the AuthProvider error').toEqual([])

    spy.mockRestore()
  })

  it('does not crash when switching away from Charting and back', async () => {
    /*
     * Leaving Charting UNMOUNTS it -- only the active tab renders -- so
     * returning is a fresh mount of the same lazy module. A module-level
     * context captured at first import would fail the second time, not the
     * first.
     */
    const errors: string[] = []
    const spy = vi.spyOn(console, 'error').mockImplementation((...args) => {
      errors.push(args.map(String).join(' '))
    })

    for (const pass of ['first', 'second']) {
      const view = render(
        <ProductionTree>
          <LazyCharting workspaceId="tab-1" initialSymbol="AAPL" />
        </ProductionTree>,
      )
      // Scoped to this render's own container, not the whole document, so a
      // leftover node from the previous pass cannot satisfy the wait.
      await waitFor(() => {
        expect(view.queryByTestId('suspense-fallback')).toBeNull()
      }, { timeout: 5000 })
      await waitFor(() => {
        expect(view.queryByTestId('pro-chart')).not.toBeNull()
      }, { timeout: 5000 })
      expect(
        errors.filter(e => /useAuth must be used within an AuthProvider/.test(e)),
        `Charting threw the AuthProvider error on the ${pass} mount`,
      ).toEqual([])
      view.unmount()
    }

    spy.mockRestore()
  })
})

/* ───────────────── the invariant, not just this one file ───────────────── */

describe('no module binds to an auth context that has no provider', () => {
  const SRC = resolve(__dirname, '../..')

  /** Every .ts/.tsx under src/, excluding tests -- a test may mock freely. */
  function runtimeFiles(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        if (entry === '__tests__' || entry === 'node_modules') continue
        runtimeFiles(full, out)
        continue
      }
      if (!/\.tsx?$/.test(entry)) continue
      if (/\.test\.tsx?$/.test(entry)) continue
      out.push(full)
    }
    return out
  }

  const files = runtimeFiles(SRC)

  /**
   * Source with comments removed.
   *
   * Not optional, and the first run of this file proved why: the explanatory
   * comment added to ChartingPage.tsx contains the literal `<AuthProvider>`,
   * which made the "is a provider mounted?" scan answer YES and silently skip
   * the invariant below. A guard that reads prose reports on prose.
   */
  const stripped = new Map<string, string>(
    files.map(f => [
      f,
      readFileSync(f, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/[^\n]*/g, ''),
    ]),
  )

  it('scanned the source tree, so the assertions below are not vacuous', () => {
    expect(files.length).toBeGreaterThan(500)
    expect(files.some(f => f.endsWith(`pages${sep}ChartingPage.tsx`))).toBe(true)
    // And the stripping really removed prose: ChartingPage's own comment names
    // the context, the stripped text must not.
    const page = stripped.get(join(SRC, 'pages', 'ChartingPage.tsx')) ?? ''
    expect(page.length).toBeGreaterThan(1000)
    expect(page).not.toMatch(/<AuthProvider/)
  })

  /**
   * The real rule, stated as a conditional rather than a ban.
   *
   * Importing the context is legitimate IF a provider is mounted. So the
   * invariant is: either nobody imports the context's runtime exports, or
   * `<AuthProvider>` is rendered somewhere. Banning the import outright would
   * forbid the other valid fix; this way both pass and the broken middle
   * state -- which is what shipped -- fails.
   */
  it('either AuthProvider is mounted or nothing imports its useAuth', () => {
    const importers: string[] = []
    for (const file of files) {
      const text = stripped.get(file) ?? ''
      // An import FROM contexts/AuthContext that pulls in useAuth.
      const m = /import\s*\{([^}]*)\}\s*from\s*'[^']*contexts\/AuthContext'/.exec(text)
      if (m && /\buseAuth\b/.test(m[1])) {
        importers.push(relative(SRC, file).split(sep).join('/'))
      }
    }

    const mounted = files.some(f => /<AuthProvider[\s>]/.test(stripped.get(f) ?? ''))

    if (!mounted) {
      expect(
        importers,
        'these files call the context useAuth, but no <AuthProvider> is rendered anywhere in src/ — ' +
          'each one throws "useAuth must be used within an AuthProvider" on its first render. ' +
          'Import from hooks/useAuth instead, or mount a provider.',
      ).toEqual([])
    }
  })

  it('Charting binds to the hook the rest of the application uses', () => {
    const page = readFileSync(join(SRC, 'pages', 'ChartingPage.tsx'), 'utf8')
    expect(page).toMatch(/import\s*\{\s*useAuth\s*\}\s*from\s*'\.\.\/hooks\/useAuth'/)
    expect(page).not.toMatch(/import\s*\{[^}]*\buseAuth\b[^}]*\}\s*from\s*'[^']*contexts\/AuthContext'/)
  })

  it('introduces no second auth provider', () => {
    /* The workaround this fix deliberately avoids. A nested provider would
       give Charting its own answer to "who is signed in". */
    const providers = files.filter(f => /<AuthProvider[\s>]/.test(stripped.get(f) ?? ''))
    expect(providers.map(f => relative(SRC, f))).toEqual([])
  })
})

/* ─────────── the per-user isolation the hook is there to provide ───────── */

describe('auth still keys the workspace, so state stays per user', () => {
  it('builds the workspace key from the real user id', async () => {
    /*
     * Why this matters: the forbidden workarounds -- stubbing auth or
     * returning a fake user -- would leave `user` null, and
     * `chartingWorkspaceKey` returns null without a userId. Charting would
     * then stop persisting silently instead of crashing loudly, which is
     * worse. So assert the key is really built from the signed-in id.
     */
    const { chartingWorkspaceKey } = await import('../../lib/charting/workspace-state')
    expect(chartingWorkspaceKey(CACHED_USER.id, 'org-hotfix-1', 'tab-1'))
      .toBe(`${CACHED_USER.id}:org-hotfix-1:tab-1`)
    expect(chartingWorkspaceKey(null, 'org-hotfix-1', 'tab-1')).toBeNull()
    expect(chartingWorkspaceKey(undefined, 'org-hotfix-1', 'tab-1')).toBeNull()
  })
})
