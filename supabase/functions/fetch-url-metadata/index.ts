import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface UrlMetadata {
  url: string
  title: string | null
  description: string | null
  imageUrl: string | null
  faviconUrl: string | null
  siteName: string | null
  type: string | null
}

async function fetchMetadata(url: string): Promise<UrlMetadata> {
  const result: UrlMetadata = {
    url,
    title: null,
    description: null,
    imageUrl: null,
    faviconUrl: null,
    siteName: null,
    type: null
  }

  try {
    // Validate URL
    const parsedUrl = new URL(url)

    // Fetch the page with timeout
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TesseractBot/1.0; +https://tesseract.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    })

    clearTimeout(timeout)

    if (!response.ok) {
      // Still return basic info even if fetch fails
      result.title = parsedUrl.hostname
      return result
    }

    const html = await response.text()

    // Parse meta tags
    // Title
    const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i)
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    const twitterTitleMatch = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i)
    result.title = ogTitleMatch?.[1] || twitterTitleMatch?.[1] || titleMatch?.[1] || parsedUrl.hostname

    // Description
    const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i)
    const twitterDescMatch = html.match(/<meta[^>]*name=["']twitter:description["'][^>]*content=["']([^"']+)["']/i)
    result.description = ogDescMatch?.[1] || twitterDescMatch?.[1] || descMatch?.[1] || null

    // Image
    const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    const twitterImageMatch = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
    let imageUrl = ogImageMatch?.[1] || twitterImageMatch?.[1] || null

    // Make image URL absolute if relative
    if (imageUrl && !imageUrl.startsWith('http')) {
      imageUrl = new URL(imageUrl, url).href
    }
    result.imageUrl = imageUrl

    // Favicon
    const faviconMatch = html.match(/<link[^>]*rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)["']/i)
    const appleTouchMatch = html.match(/<link[^>]*rel=["']apple-touch-icon["'][^>]*href=["']([^"']+)["']/i)
    let faviconUrl = faviconMatch?.[1] || appleTouchMatch?.[1] || null

    // Make favicon URL absolute if relative, or use default
    if (faviconUrl && !faviconUrl.startsWith('http')) {
      faviconUrl = new URL(faviconUrl, url).href
    } else if (!faviconUrl) {
      faviconUrl = `${parsedUrl.origin}/favicon.ico`
    }
    result.faviconUrl = faviconUrl

    // Site name
    const ogSiteNameMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
    result.siteName = ogSiteNameMatch?.[1] || parsedUrl.hostname

    // Type
    const ogTypeMatch = html.match(/<meta[^>]*property=["']og:type["'][^>]*content=["']([^"']+)["']/i)
    result.type = ogTypeMatch?.[1] || 'website'

    // Clean up HTML entities
    result.title = decodeHTMLEntities(result.title)
    result.description = result.description ? decodeHTMLEntities(result.description) : null
    result.siteName = result.siteName ? decodeHTMLEntities(result.siteName) : null

  } catch (error) {
    console.error('Error fetching metadata:', error)
    // Return basic info on error
    try {
      const parsedUrl = new URL(url)
      result.title = parsedUrl.hostname
      result.faviconUrl = `${parsedUrl.origin}/favicon.ico`
    } catch {
      result.title = url
    }
  }

  return result
}

function decodeHTMLEntities(text: string): string {
  const entities: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&#x27;': "'",
    '&#x2F;': '/',
    '&#x60;': '`'
  }

  return text.replace(/&[#\w]+;/g, (entity) => entities[entity] || entity)
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { url } = await req.json()

    if (!url) {
      return new Response(
        JSON.stringify({ error: 'URL is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Validate URL format
    try {
      new URL(url)
    } catch {
      return new Response(
        JSON.stringify({ error: 'Invalid URL format' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const metadata = await fetchMetadata(url)

    return new Response(
      JSON.stringify(metadata),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Error:', error)
    return new Response(
      JSON.stringify({ error: 'Failed to fetch URL metadata' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
