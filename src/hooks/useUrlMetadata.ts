import { useState, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export interface UrlMetadata {
  url: string
  title: string | null
  description: string | null
  imageUrl: string | null
  faviconUrl: string | null
  siteName: string | null
  type: string | null
}

export interface UseUrlMetadataReturn {
  fetchMetadata: (url: string) => Promise<UrlMetadata | null>
  isLoading: boolean
  error: string | null
  metadata: UrlMetadata | null
}

export function useUrlMetadata(): UseUrlMetadataReturn {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [metadata, setMetadata] = useState<UrlMetadata | null>(null)

  const fetchMetadata = useCallback(async (url: string): Promise<UrlMetadata | null> => {
    // Validate URL
    try {
      new URL(url)
    } catch {
      setError('Invalid URL format')
      return null
    }

    setIsLoading(true)
    setError(null)

    try {
      const { data, error: fnError } = await supabase.functions.invoke('fetch-url-metadata', {
        body: { url }
      })

      if (fnError) {
        throw fnError
      }

      if (data?.error) {
        throw new Error(data.error)
      }

      const result: UrlMetadata = {
        url: data.url || url,
        title: data.title || null,
        description: data.description || null,
        imageUrl: data.imageUrl || null,
        faviconUrl: data.faviconUrl || null,
        siteName: data.siteName || null,
        type: data.type || 'website'
      }

      setMetadata(result)
      setIsLoading(false)
      return result
    } catch (err: any) {
      console.error('Error fetching URL metadata:', err)

      // Return basic fallback metadata
      const fallback: UrlMetadata = {
        url,
        title: new URL(url).hostname,
        description: null,
        imageUrl: null,
        faviconUrl: `${new URL(url).origin}/favicon.ico`,
        siteName: new URL(url).hostname,
        type: 'website'
      }

      setMetadata(fallback)
      setError(err.message || 'Failed to fetch URL metadata')
      setIsLoading(false)
      return fallback
    }
  }, [])

  return {
    fetchMetadata,
    isLoading,
    error,
    metadata
  }
}

export default useUrlMetadata
