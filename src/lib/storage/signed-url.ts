/**
 * One signed URL per storage object, shared by every surface that needs it.
 *
 * ── The defect this exists to remove ─────────────────────────────────────
 *
 * A Supabase signed URL carries a single-use-looking `?token=` that differs
 * on every call. Five surfaces each signed the same organization logo
 * independently, and two of them re-signed on a cadence:
 * `OrganizationContext` rewrote `organizations.logo_url` into a signed URL
 * inside a query with `staleTime: 60_000` and `refetchOnWindowFocus: true`,
 * and `Header` eagerly preloaded the result with `new Image()`.
 *
 * Because the URL string is the browser's HTTP cache key, a fresh token is a
 * guaranteed cache miss. Every refetch re-downloaded the full 1.44 MB PNG.
 * That produced 782.693 MB of Storage egress in a single day — 86.1% of the
 * project's total — against roughly 2 MB of stored objects.
 *
 * ── The rule ─────────────────────────────────────────────────────────────
 *
 * An object's identity is its BUCKET and PATH. Those are stable, they are
 * what the database stores, and they are what caches and effect dependencies
 * must key on. A signed URL is a temporary transport credential derived from
 * that identity, refreshed only as it approaches expiry.
 *
 * Keying the React Query cache on `[bucket, path]` means N surfaces asking
 * for the same object share one signing request and one URL string — so the
 * browser can actually reuse the bytes it already has.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'

/** How long a minted URL is valid. */
export const SIGNED_URL_TTL_SECONDS = 3600

/**
 * When a cached URL becomes eligible for refresh: 50 minutes, leaving a
 * ten-minute margin before the one-hour expiry.
 *
 * This single number is what stops the egress. While a URL is fresh, every
 * mount, re-render, refocus and re-read is served from cache and costs
 * nothing; the string stays byte-identical, so the browser's own image and
 * document caches keep hitting too.
 */
export const SIGNED_URL_STALE_MS = 50 * 60 * 1000

/**
 * Kept slightly longer than the refresh point, so closing and reopening a
 * menu or a preview does not re-sign an object that is still valid.
 */
export const SIGNED_URL_GC_MS = 55 * 60 * 1000

/** The cache identity of a storage object. Bucket and path, nothing else. */
export function signedUrlKey(bucket: string, path: string | null | undefined) {
  return ['storage-signed-url', bucket, path ?? null] as const
}

/**
 * Shared query options, so a hook call and an imperative read resolve to the
 * same cache entry rather than two.
 *
 * `refetchOnWindowFocus` and `refetchOnReconnect` are off because neither
 * event tells us anything about the object — it is immutable at this path,
 * and only the clock can invalidate the credential.
 *
 * `refetchOnMount` is deliberately left at the app default (`true`), which
 * in React Query refetches only when the entry is STALE. Combined with the
 * 50-minute `staleTime` that is exactly the wanted behaviour: a mount inside
 * the window is free, and the first mount after it refreshes the credential.
 */
export function signedUrlQueryOptions(bucket: string, path: string | null | undefined) {
  return {
    queryKey: signedUrlKey(bucket, path),
    queryFn: async (): Promise<string | null> => {
      if (!path) return null
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (error) throw error
      return data?.signedUrl ?? null
    },
    staleTime: SIGNED_URL_STALE_MS,
    gcTime: SIGNED_URL_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  }
}

/**
 * Resolve a private storage object to a URL usable as `<img src>`, an
 * `<iframe src>`, or a `fetch` target.
 *
 * Safe to call from as many components as need it, including one per row of
 * a list: identical (bucket, path) pairs collapse onto a single request.
 */
export function useSignedUrl(bucket: string, path: string | null | undefined) {
  const query = useQuery({
    ...signedUrlQueryOptions(bucket, path),
    enabled: !!path,
  })
  return {
    url: query.data ?? null,
    isLoading: query.isLoading && !!path,
    error: query.error as Error | null,
  }
}

/**
 * The imperative form, for code that is not a component — a `queryFn`, an
 * event handler, an export routine.
 *
 * Goes through the same cache as `useSignedUrl`, so an event handler does not
 * mint a second URL for an object a component already resolved.
 */
export async function fetchSignedUrl(
  queryClient: QueryClient,
  bucket: string,
  path: string | null | undefined,
): Promise<string | null> {
  if (!path) return null
  return queryClient.fetchQuery(signedUrlQueryOptions(bucket, path))
}

// ---------------------------------------------------------------------------
// Objects that genuinely have to become bytes
// ---------------------------------------------------------------------------

/** The cache identity of an object's base64 payload. Same rule: bucket+path. */
export function objectDataUrlKey(bucket: string, path: string | null | undefined) {
  return ['storage-object-data-url', bucket, path ?? null] as const
}

/**
 * An object as a base64 data URL, cached by its stable path.
 *
 * Only for consumers that cannot take a URL — jsPDF's `addImage` is the one
 * real case. Previously this ran on every render of the export modal, because
 * its effect depended on an un-memoised `getLogoUrl` function identity, so
 * each keystroke re-downloaded the image and re-ran a `FileReader`. Keyed on
 * the path, it is fetched once and reused for the life of the cache entry.
 */
export function useObjectDataUrl(bucket: string, path: string | null | undefined) {
  const query = useQuery({
    queryKey: objectDataUrlKey(bucket, path),
    queryFn: async (): Promise<string | null> => {
      if (!path) return null
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
      if (error || !data?.signedUrl) return null
      const response = await fetch(data.signedUrl)
      if (!response.ok) return null
      const blob = await response.blob()
      return await new Promise<string | null>(resolve => {
        const reader = new FileReader()
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null)
        reader.onerror = () => resolve(null)
        reader.readAsDataURL(blob)
      })
    },
    enabled: !!path,
    // The bytes do not expire the way a credential does, so this can be held
    // far longer than the signed URL that fetched them.
    staleTime: Infinity,
    gcTime: SIGNED_URL_GC_MS,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  })
  return query.data ?? null
}
