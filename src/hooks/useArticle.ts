import { useQuery } from '@tanstack/react-query'

/**
 * Readable text for a news URL, for the in-app reader.
 *
 * Served by a Netlify function rather than a Supabase edge function, and the
 * distinction is not incidental: Supabase's egress is refused by Yahoo
 * Finance at the connection level, and Yahoo is most of the feed. Netlify's
 * reaches it — 10/10 real feed URLs extracted where Supabase managed 1/8.
 * See netlify/functions/article-extract.mjs.
 *
 * Extraction is allowed to fail. Paywalls, bot blocks and JS-rendered pages
 * are normal, and the reader's job in that case is to hand the reader
 * straight to the publisher rather than show an empty page. Callers should
 * branch on `ok`, not on the absence of an error.
 */

export interface ExtractedArticle {
  ok: true
  url: string
  via: 'json-ld' | 'paragraphs'
  title: string | null
  byline: string | null
  siteName: string
  publishedTime: string | null
  leadImage: string | null
  excerpt: string
  /** Plain text, already HTML-escaped by the function. Render as text. */
  paragraphs: string[]
  chars: number
  readingMinutes: number
}

export interface UnextractedArticle {
  ok: false
  reason: string
  detail?: string
  status?: number
}

export type ArticleResult = ExtractedArticle | UnextractedArticle

export function useArticle(url: string | null | undefined, options?: { enabled?: boolean }) {
  return useQuery<ArticleResult>({
    queryKey: ['article', url],
    enabled: !!url && (options?.enabled ?? true),
    // An article's text does not change. Re-fetching it on focus would spend
    // a function invocation to receive the same bytes.
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    // A failed extraction is a *result*, not an error — retrying a paywall
    // three times just delays showing the fallback.
    retry: false,
    queryFn: async () => {
      const res = await fetch(
        `/.netlify/functions/article-extract?url=${encodeURIComponent(url!)}`,
        { headers: { Accept: 'application/json' } },
      )
      if (!res.ok) return { ok: false, reason: 'request_failed', status: res.status }
      const data = await res.json()
      return data?.ok ? (data as ExtractedArticle) : (data as UnextractedArticle)
    },
  })
}
