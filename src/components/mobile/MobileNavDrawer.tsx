import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { ChevronRight, Monitor, Search, X } from 'lucide-react'
import { TesseractLogo } from '../ui/TesseractLogo'
import { useOrganization } from '../../contexts/OrganizationContext'
import {
  getDesktopOnlyNavSurfaces,
  getMobileNavSurfaces,
  getMobileSurface,
  type MobileSurface,
} from '../../lib/mobile/mobile-surfaces'
import type { Tab } from '../layout/TabManager'

interface MobileNavDrawerProps {
  open: boolean
  onClose: () => void
  onSearchResult?: (result: any) => void
  onOpenSearch?: () => void
  tabs: Tab[]
  activeTabId?: string
  onTabChange: (tabId: string) => void
  onTabClose: (tabId: string) => void
}

/**
 * Phone navigation. Replaces the desktop tab strip, which assumes you are
 * juggling several surfaces at once — a workspace metaphor that does not
 * survive a 390px screen.
 *
 * Open tabs are still reachable, but demoted to a "Recent" list rather than
 * being the primary navigation model.
 */
export function MobileNavDrawer({
  open,
  onClose,
  onSearchResult,
  onOpenSearch,
  tabs,
  activeTabId,
  onTabChange,
  onTabClose,
}: MobileNavDrawerProps) {
  const { currentOrg } = useOrganization()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  useEffect(() => {
    if (open) panelRef.current?.focus({ preventScroll: true })
  }, [open])

  const openSurface = (surface: MobileSurface) => {
    onClose()
    onSearchResult?.({ id: surface.type, title: surface.title, type: surface.type, data: null })
  }

  const recentTabs = tabs.filter(tab => !tab.isBlank)

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      className={clsx('fixed inset-0 z-[70]', open ? 'pointer-events-auto' : 'pointer-events-none')}
      role="presentation"
    >
      <div
        className={clsx(
          'absolute inset-0 bg-gray-900/40 transition-opacity duration-200',
          open ? 'opacity-100' : 'opacity-0'
        )}
        onClick={onClose}
        aria-hidden="true"
      />

      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        tabIndex={-1}
        className={clsx(
          'absolute inset-y-0 left-0 w-[86%] max-w-sm flex flex-col outline-none',
          'bg-white dark:bg-gray-900 shadow-2xl',
          'transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center gap-3 px-4 h-16 border-b border-gray-200 dark:border-gray-700 pt-safe">
          <TesseractLogo size={26} />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {currentOrg?.name ?? 'Tesseract'}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex items-center justify-center h-11 w-11 -mr-2 rounded-full text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 dark:text-gray-400"
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain pb-safe">
          {onOpenSearch && (
            <div className="p-3">
              <button
                type="button"
                onClick={() => {
                  onClose()
                  // Header owns the full-screen search overlay.
                  window.dispatchEvent(new CustomEvent('open-mobile-search'))
                }}
                className="w-full flex items-center gap-3 h-12 px-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
              >
                <Search className="h-5 w-5" />
                <span className="text-sm">Search assets, notes, people…</span>
              </button>
            </div>
          )}

          {recentTabs.length > 0 && (
            <NavSection title="Recent">
              {recentTabs.map(tab => {
                const surface = getMobileSurface(tab.type)
                const Icon = surface?.icon
                return (
                  <div
                    key={tab.id}
                    className={clsx(
                      'flex items-center gap-3 pl-4 pr-2 rounded-lg',
                      tab.id === activeTabId && 'bg-primary-50 dark:bg-primary-900/20'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onClose()
                        onTabChange(tab.id)
                      }}
                      className="flex-1 flex items-center gap-3 min-h-[48px] text-left min-w-0"
                    >
                      {Icon ? (
                        <Icon className={clsx('h-4 w-4 flex-shrink-0', surface?.color)} />
                      ) : (
                        <span className="h-4 w-4 flex-shrink-0" />
                      )}
                      <span
                        className={clsx(
                          'text-sm truncate',
                          tab.id === activeTabId
                            ? 'font-semibold text-primary-700 dark:text-primary-300'
                            : 'text-gray-700 dark:text-gray-200'
                        )}
                      >
                        {tab.title}
                      </span>
                    </button>
                    {/* The dashboard tab cannot be closed (see
                        DashboardPage.handleTabClose), so offering an X there
                        is a control that does nothing. */}
                    {tab.id !== 'dashboard' && (
                      <button
                        type="button"
                        onClick={() => onTabClose(tab.id)}
                        className="flex items-center justify-center h-11 w-11 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                        aria-label={`Close ${tab.title}`}
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                )
              })}
            </NavSection>
          )}

          <NavSection title="Core">
            {getMobileNavSurfaces('core').map(surface => (
              <NavRow key={surface.type} surface={surface} onSelect={openSurface} />
            ))}
          </NavSection>

          <NavSection title="Work">
            {getMobileNavSurfaces('work').map(surface => (
              <NavRow key={surface.type} surface={surface} onSelect={openSurface} />
            ))}
          </NavSection>

          <NavSection title="Desktop only">
            <p className="px-4 pb-2 text-xs text-gray-400 dark:text-gray-500">
              These need a larger screen. Opening one explains why.
            </p>
            {getDesktopOnlyNavSurfaces().map(surface => (
              <NavRow key={surface.type} surface={surface} onSelect={openSurface} dimmed />
            ))}
          </NavSection>
        </div>
      </div>
    </div>,
    document.body
  )
}

function NavSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="pb-2">
      <div className="px-4 pt-4 pb-1">
        <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
          {title}
        </span>
      </div>
      <div className="px-1">{children}</div>
    </div>
  )
}

function NavRow({
  surface,
  onSelect,
  dimmed = false,
}: {
  surface: MobileSurface
  onSelect: (surface: MobileSurface) => void
  dimmed?: boolean
}) {
  const Icon = surface.icon
  return (
    <button
      type="button"
      onClick={() => onSelect(surface)}
      className={clsx(
        'w-full flex items-center gap-3 min-h-[52px] px-3 rounded-xl text-left',
        'hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
        dimmed && 'opacity-60'
      )}
    >
      <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', surface.bg)}>
        <Icon className={clsx('h-5 w-5', surface.color)} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{surface.title}</div>
        {surface.mobileNote && (
          <div className="text-xs text-gray-500 dark:text-gray-400 truncate">{surface.mobileNote}</div>
        )}
      </div>
      {dimmed ? (
        <Monitor className="h-4 w-4 text-gray-400 flex-shrink-0" />
      ) : (
        <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
      )}
    </button>
  )
}
