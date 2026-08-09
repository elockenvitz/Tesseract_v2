import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { Check, ChevronRight, Monitor, Search, X, Lightbulb } from 'lucide-react'
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
  const { currentOrg, userOrgs, switchOrg } = useOrganization()
  const [showOrgs, setShowOrgs] = useState(false)
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

  // Ideas is anchored above Recent rather than sorted into it. It is the home
  // surface, it cannot be closed, and a fixed position means the one row that
  // is always present is always in the same place — which a most-recent
  // ordering would take away exactly when the list is busiest.
  const ideasTab = tabs.find(tab => tab.id === 'dashboard') ?? null

  // Everything else, newest first and capped. DashboardPage closes tabs past
  // this cap on a phone, so the list and the tab set stay in agreement rather
  // than the drawer quietly hiding tabs that are still open.
  const RECENT_LIMIT = 5
  const recentTabs = tabs
    .filter(tab => !tab.isBlank && tab.id !== 'dashboard')
    .slice(-RECENT_LIMIT)
    .reverse()

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
          <button
            type="button"
            onClick={() => userOrgs.length > 1 && setShowOrgs(v => !v)}
            className="flex-1 min-w-0 flex items-center gap-1 text-left no-touch-target"
            aria-expanded={showOrgs}
            aria-haspopup={userOrgs.length > 1}
            disabled={userOrgs.length <= 1}
          >
            <span className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {currentOrg?.name ?? 'Tesseract'}
            </span>
            {userOrgs.length > 1 && (
              <ChevronRight
                className={clsx(
                  'h-4 w-4 shrink-0 text-gray-400 transition-transform',
                  showOrgs && 'rotate-90'
                )}
              />
            )}
          </button>
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
          {/* Switching workspace reloads, so it sits above navigation rather
              than among it — it changes what every destination below means. */}
          {showOrgs && userOrgs.length > 1 && (
            <div className="border-b border-gray-200 dark:border-gray-700 py-1">
              {userOrgs.map(org => {
                const isCurrent = org.id === currentOrg?.id
                return (
                  <button
                    key={org.id}
                    type="button"
                    onClick={async () => {
                      if (isCurrent) { setShowOrgs(false); return }
                      onClose()
                      await switchOrg(org.id)
                    }}
                    className={clsx(
                      'w-full flex items-center gap-3 min-h-[52px] px-4 text-left',
                      'hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
                      isCurrent && 'bg-primary-50 dark:bg-primary-900/20'
                    )}
                  >
                    <span
                      className={clsx(
                        'flex-1 min-w-0 truncate text-sm',
                        isCurrent
                          ? 'font-semibold text-primary-700 dark:text-primary-300'
                          : 'text-gray-700 dark:text-gray-200'
                      )}
                    >
                      {org.name}
                    </span>
                    {isCurrent && <Check className="h-4 w-4 text-primary-600 shrink-0" />}
                  </button>
                )
              })}
            </div>
          )}
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

          {ideasTab && (
            <NavSection title="Home">
              <button
                type="button"
                onClick={() => { onClose(); onTabChange(ideasTab.id) }}
                className={clsx(
                  'w-full flex items-center gap-3 h-12 px-3 rounded-xl text-left',
                  ideasTab.id === activeTabId
                    ? 'bg-primary-50 dark:bg-primary-900/20 font-semibold text-primary-700 dark:text-primary-300'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800'
                )}
              >
                <Lightbulb className="h-5 w-5 text-amber-500 shrink-0" />
                {/* The home tab renders the ideas feed on phones, so it is
                    labelled for what it shows rather than "Dashboard". */}
                <span className="text-sm">Ideas</span>
              </button>
            </NavSection>
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
                    <button
                      type="button"
                      onClick={() => onTabClose(tab.id)}
                      className="flex items-center justify-center h-11 w-11 rounded-full text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
                      aria-label={`Close ${tab.title}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
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
        'w-full flex items-center gap-3 min-h-[48px] px-3 rounded-xl text-left',
        'hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors',
        dimmed && 'opacity-60'
      )}
    >
      <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0', surface.bg)}>
        <Icon className={clsx('h-5 w-5', surface.color)} />
      </div>
      {/* Name only. The per-surface note explained what a surface does before
          you had opened it, which is a thing you need once and then never
          again — and it doubled every row's height in a list read by scanning
          for a name. The notes stay in mobile-surfaces.ts, where they document
          the support level for whoever changes it. */}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{surface.title}</div>
      </div>
      {dimmed ? (
        <Monitor className="h-4 w-4 text-gray-400 flex-shrink-0" />
      ) : (
        <ChevronRight className="h-4 w-4 text-gray-300 dark:text-gray-600 flex-shrink-0" />
      )}
    </button>
  )
}
