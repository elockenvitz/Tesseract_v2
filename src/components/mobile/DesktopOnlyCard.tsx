import { clsx } from 'clsx'
import { Monitor } from 'lucide-react'
import { getMobileNavSurfaces, getMobileSurface } from '../../lib/mobile/mobile-surfaces'

interface DesktopOnlyCardProps {
  /** Tab type, used to look up the title and the reason. */
  type: string
  /** Overrides the registry title when a tab has a more specific name. */
  title?: string
  onOpenSurface?: (result: any) => void
}

/**
 * Shown in place of a surface that has no phone treatment.
 *
 * The point is to be honest rather than to half-render a desktop layout: a
 * clear reason plus somewhere useful to go beats a squeezed grid the user
 * cannot operate.
 */
export function DesktopOnlyCard({ type, title, onOpenSurface }: DesktopOnlyCardProps) {
  const surface = getMobileSurface(type)
  const Icon = surface?.icon ?? Monitor
  const heading = title ?? surface?.title ?? 'This surface'
  const reason =
    surface?.desktopReason ??
    'This surface has not been adapted for phone screens yet, so it would not be usable here.'

  const suggestions = getMobileNavSurfaces('core').slice(0, 6)

  return (
    <div className="h-full overflow-y-auto px-5 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className={clsx('w-14 h-14 rounded-2xl flex items-center justify-center mb-5', surface?.bg ?? 'bg-gray-100 dark:bg-gray-800')}>
          <Icon className={clsx('h-7 w-7', surface?.color ?? 'text-gray-500 dark:text-gray-400')} />
        </div>

        <h1 className="text-xl font-semibold text-gray-900 dark:text-white">
          {heading} is desktop only
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-600 dark:text-gray-300">{reason}</p>
        <p className="mt-3 text-sm leading-relaxed text-gray-500 dark:text-gray-400">
          Open Tesseract on a laptop to use it. Everything below works on your phone.
        </p>

        {onOpenSurface && (
          <div className="mt-7">
            <div className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500 mb-2">
              Available here
            </div>
            <div className="grid grid-cols-2 gap-2">
              {suggestions.map(item => {
                const ItemIcon = item.icon
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() =>
                      onOpenSurface({ id: item.type, title: item.title, type: item.type, data: null })
                    }
                    className="flex items-center gap-3 min-h-[56px] px-3 rounded-xl border border-gray-200 dark:border-gray-700 text-left hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className={clsx('w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0', item.bg)}>
                      <ItemIcon className={clsx('h-4 w-4', item.color)} />
                    </div>
                    <span className="text-sm font-medium text-gray-800 dark:text-gray-100 truncate">
                      {item.title}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
