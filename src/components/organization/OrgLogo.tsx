/**
 * An organization's logo, resolved from its storage path.
 *
 * Takes the PATH that `organizations.logo_url` actually holds, not a URL, and
 * resolves it through the shared signed-URL cache. Rendering one of these per
 * row of a list is safe and intended: every instance pointing at the same
 * path shares a single signing request and a single, stable URL string, so
 * the browser caches the bytes once.
 */
import { Building2 } from 'lucide-react'
import clsx from 'clsx'
import { useSignedUrl } from '../../lib/storage/signed-url'
import { ORG_LOGO_BUCKET } from '../../lib/storage/buckets'

interface OrgLogoProps {
  /** Storage path in the private `template-branding` bucket. */
  path: string | null | undefined
  className?: string
}

export function OrgLogo({ path, className }: OrgLogoProps) {
  const { url } = useSignedUrl(ORG_LOGO_BUCKET, path)
  const box = className ?? 'w-6 h-6'

  if (!path || !url) {
    return (
      <div
        className={clsx(
          box,
          'rounded bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0',
        )}
      >
        <Building2 className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
      </div>
    )
  }

  return (
    <img
      src={url}
      alt=""
      /*
       * `loading="eager"` was here to beat the old per-click signing round
       * trip. The URL is cached now, so the browser can decide — and a lazy
       * logo in a closed menu costs nothing.
       */
      loading="lazy"
      decoding="async"
      className={clsx(box, 'rounded object-cover flex-shrink-0')}
    />
  )
}
