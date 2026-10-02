/**
 * A signed URL is not an identity.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * Supabase signed URLs carry a `?token=` that differs on every signing. The
 * browser's HTTP cache keys on the URL string, so a re-signed URL is always a
 * cache miss and always a full re-download.
 *
 * `OrganizationContext` signed the org logo inside its `['user-organizations']`
 * queryFn and wrote the result back over `organizations.logo_url` — the field
 * every consumer treats as the logo's identity. That query ran with
 * `staleTime: 60_000` and `refetchOnWindowFocus: true`, overriding the app's
 * deliberate global `refetchOnWindowFocus: false`. `Header` then preloaded the
 * result with `new Image()` in an effect keyed on the `userOrgs` array, which
 * React Query rebuilt on every refetch.
 *
 * So every tab refocus minted a new URL for a 1.44 MB PNG and downloaded it
 * again, whether or not the switcher menu was ever opened. That was
 * 782.693 MB of Storage egress in one day — 86.1% of the project's total —
 * against ~2 MB of stored objects. Four other surfaces signed the same object
 * independently.
 *
 * ── What these tests assert ──────────────────────────────────────────────
 *
 * They count real calls. The Supabase double records every `createSignedUrl`,
 * and `global.fetch` records every byte download, so "did not re-download"
 * is a number rather than a shape. Non-vacuity is in the commit: reverting
 * the staleTime or re-keying an effect on the URL makes these fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

/** Every signing request the code makes, in order. */
const signings = vi.hoisted(() => ({ calls: [] as Array<{ bucket: string; path: string }> }))

let tokenCounter = 0

vi.mock('../../supabase', () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, _ttl: number) => {
          signings.calls.push({ bucket, path })
          // A new token every time, exactly like the real API.
          tokenCounter += 1
          return {
            data: { signedUrl: `https://sb.example/storage/v1/object/sign/${bucket}/${path}?token=t${tokenCounter}` },
            error: null,
          }
        },
      }),
    },
  },
}))

import {
  useSignedUrl,
  fetchSignedUrl,
  signedUrlKey,
  useObjectDataUrl,
  SIGNED_URL_STALE_MS,
} from '../signed-url'
import { ORG_LOGO_BUCKET } from '../buckets'

const LOGO_PATH = 'org/4b4713e8-d5da-4dc9-a465-c06a71248a12/iiq1b345.png'

/**
 * A client whose defaults mirror the app's (`src/App.tsx`), so the test is
 * measuring the storage layer's own options rather than a friendlier harness.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnMount: true,
      },
    },
  })
}

function wrapper(client: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client }, children)
}

const signingsFor = (path: string) => signings.calls.filter(c => c.path === path)

beforeEach(() => {
  signings.calls = []
  tokenCounter = 0
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

// ───────────────────────────────────────────────────────────────────────────
// 1. Repeated renders do not re-sign or re-download
// ───────────────────────────────────────────────────────────────────────────

describe('repeated renders of an unchanged logo', () => {
  it('signs exactly once no matter how many times it re-renders', async () => {
    const client = makeClient()
    const { result, rerender } = renderHook(
      () => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())

    for (let i = 0; i < 25; i++) rerender()
    await waitFor(() => expect(result.current.url).toBeTruthy())

    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })

  it('hands back a byte-identical URL across renders, so the browser can cache', async () => {
    // This is the property that actually saves the egress: if the string
    // changes, the HTTP cache misses even when our own cache hit.
    const client = makeClient()
    const { result, rerender } = renderHook(
      () => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())
    const first = result.current.url

    rerender()
    rerender()
    await waitFor(() => expect(result.current.url).toBeTruthy())

    expect(result.current.url).toBe(first)
  })

  it('signs once across mount, unmount and remount', async () => {
    // Navigating away and back must not re-sign: the credential is still good.
    const client = makeClient()
    const first = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current.url).toBeTruthy())
    first.unmount()

    const second = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current.url).toBeTruthy())

    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 2. Window refocus and org-data refetch do not cause a byte download
// ───────────────────────────────────────────────────────────────────────────

describe('window refocus', () => {
  it('does not re-sign the logo', async () => {
    const client = makeClient()
    const { result } = renderHook(
      () => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())

    // What the old OrganizationContext opted into, three times over.
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        window.dispatchEvent(new Event('focus'))
        window.dispatchEvent(new Event('visibilitychange'))
      })
    }

    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })

  it('survives the org query refetching underneath it', async () => {
    /*
     * The real shape of the bug: org data legitimately refetches on focus —
     * that was a deliberate correctness fix and is preserved. What must no
     * longer happen is the logo being re-signed as a side effect, because the
     * logo is identified by its PATH and the path did not change.
     */
    const client = makeClient()
    let orgVersion = 0

    const { result, rerender } = renderHook(
      () => {
        // A new object identity on every render, as React Query produces.
        const org = { id: 'o1', logo_url: LOGO_PATH, version: orgVersion }
        return useSignedUrl(ORG_LOGO_BUCKET, org.logo_url)
      },
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())
    const url = result.current.url

    for (let i = 0; i < 10; i++) { orgVersion += 1; rerender() }
    await waitFor(() => expect(result.current.url).toBeTruthy())

    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
    expect(result.current.url).toBe(url)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 3. Five surfaces, one signer
// ───────────────────────────────────────────────────────────────────────────

describe('the same object across surfaces', () => {
  it('resolves through one shared cache rather than five independent signers', async () => {
    // Header row, OrganizationPage preview, the template editor, the export
    // modal and an imperative handler all asking at once.
    const client = makeClient()
    const a = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    const b = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    const c = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })

    await waitFor(() => expect(a.result.current.url).toBeTruthy())
    await waitFor(() => expect(b.result.current.url).toBeTruthy())
    await waitFor(() => expect(c.result.current.url).toBeTruthy())

    const imperative = await fetchSignedUrl(client, ORG_LOGO_BUCKET, LOGO_PATH)

    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
    // And they all got the same string, so one cached image serves all of them.
    expect(new Set([a.result.current.url, b.result.current.url, c.result.current.url, imperative]).size).toBe(1)
  })

  it('shares one signing across many list rows', async () => {
    // The switcher dropdown renders one logo per row.
    const client = makeClient()
    const rows = Array.from({ length: 12 }, () =>
      renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) }),
    )
    await waitFor(() => expect(rows[11].result.current.url).toBeTruthy())
    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })

  it('the imperative form does not mint a second URL for a resolved object', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.url).toBeTruthy())

    expect(await fetchSignedUrl(client, ORG_LOGO_BUCKET, LOGO_PATH)).toBe(result.current.url)
    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 4. Expiry causes a controlled refresh
// ───────────────────────────────────────────────────────────────────────────

describe('approaching expiry', () => {
  it('refreshes the credential once the entry goes stale', async () => {
    const client = makeClient()
    const { result, unmount } = renderHook(
      () => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())
    const before = result.current.url
    expect(signingsFor(LOGO_PATH)).toHaveLength(1)

    // Age the entry past the refresh point, then observe it again — which is
    // what a mount after fifty minutes does.
    const entry = client.getQueryCache().find({ queryKey: signedUrlKey(ORG_LOGO_BUCKET, LOGO_PATH) })
    expect(entry, 'expected a cache entry keyed on bucket+path').toBeTruthy()
    entry!.state.dataUpdatedAt = Date.now() - (SIGNED_URL_STALE_MS + 1000)
    unmount()

    const next = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(signingsFor(LOGO_PATH)).toHaveLength(2))
    await waitFor(() => expect(next.result.current.url).toBeTruthy())

    // A genuinely new credential, not the expired one.
    expect(next.result.current.url).not.toBe(before)
  })

  it('does NOT refresh while the credential is still fresh', async () => {
    // The other half of the same rule — without this, "refreshes on stale"
    // would also pass for code that refreshes constantly.
    const client = makeClient()
    const { result, unmount } = renderHook(
      () => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())
    const entry = client.getQueryCache().find({ queryKey: signedUrlKey(ORG_LOGO_BUCKET, LOGO_PATH) })
    // Well inside the window.
    entry!.state.dataUpdatedAt = Date.now() - 60_000
    unmount()

    const next = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(next.result.current.url).toBeTruthy())
    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// 5. A different path is a different object
// ───────────────────────────────────────────────────────────────────────────

describe('a changed storage path', () => {
  it('resolves again, because it is a different object', async () => {
    const client = makeClient()
    let path = LOGO_PATH
    const { result, rerender } = renderHook(
      () => useSignedUrl(ORG_LOGO_BUCKET, path),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current.url).toBeTruthy())
    const first = result.current.url

    // A new logo uploaded: new path, new object.
    path = 'org/4b4713e8-d5da-4dc9-a465-c06a71248a12/replacement.png'
    rerender()
    await waitFor(() => expect(result.current.url).not.toBe(first))

    expect(signings.calls.map(c => c.path)).toEqual([LOGO_PATH, path])
  })

  it('keys the cache on bucket as well as path', async () => {
    const client = makeClient()
    const a = renderHook(() => useSignedUrl('template-branding', 'same/name.png'), { wrapper: wrapper(client) })
    const b = renderHook(() => useSignedUrl('captures', 'same/name.png'), { wrapper: wrapper(client) })
    await waitFor(() => expect(a.result.current.url).toBeTruthy())
    await waitFor(() => expect(b.result.current.url).toBeTruthy())

    expect(signings.calls).toHaveLength(2)
    expect(a.result.current.url).not.toBe(b.result.current.url)
  })

  it('signs nothing at all when there is no path', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useSignedUrl(ORG_LOGO_BUCKET, null), { wrapper: wrapper(client) })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(signings.calls).toHaveLength(0)
    expect(result.current.url).toBeNull()
  })
})

// ───────────────────────────────────────────────────────────────────────────
// Bytes: the export modal's base64 logo
// ───────────────────────────────────────────────────────────────────────────

describe('an object fetched as bytes', () => {
  function stubFetch() {
    const fetches: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      fetches.push(String(url))
      return {
        ok: true,
        blob: async () => new Blob(['PNGDATA'], { type: 'image/png' }),
      } as unknown as Response
    }))
    return fetches
  }

  it('downloads the bytes once across many re-renders', async () => {
    /*
     * The export modal re-renders on every checkbox in it. Its logo effect
     * used to depend on an un-memoised `getLogoUrl`, so each render signed a
     * URL, fetched 1.44 MB, and ran a FileReader over it.
     */
    const fetches = stubFetch()
    const client = makeClient()
    const { result, rerender } = renderHook(
      () => useObjectDataUrl(ORG_LOGO_BUCKET, LOGO_PATH),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current).toBeTruthy())

    for (let i = 0; i < 20; i++) rerender()
    await waitFor(() => expect(result.current).toBeTruthy())

    expect(fetches).toHaveLength(1)
    expect(signingsFor(LOGO_PATH)).toHaveLength(1)
  })

  it('reuses the bytes when the modal is reopened', async () => {
    const fetches = stubFetch()
    const client = makeClient()
    const first = renderHook(() => useObjectDataUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(first.result.current).toBeTruthy())
    first.unmount()

    const second = renderHook(() => useObjectDataUrl(ORG_LOGO_BUCKET, LOGO_PATH), { wrapper: wrapper(client) })
    await waitFor(() => expect(second.result.current).toBeTruthy())

    expect(fetches).toHaveLength(1)
  })

  it('fetches again for a different path', async () => {
    const fetches = stubFetch()
    const client = makeClient()
    let path = LOGO_PATH
    const { result, rerender } = renderHook(
      () => useObjectDataUrl(ORG_LOGO_BUCKET, path),
      { wrapper: wrapper(client) },
    )
    await waitFor(() => expect(result.current).toBeTruthy())

    path = 'org/other/replacement.png'
    rerender()
    await waitFor(() => expect(fetches).toHaveLength(2))
  })
})
