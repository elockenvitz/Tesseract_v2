import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { clsx } from 'clsx'
import { RefreshCw, X } from 'lucide-react'
import { auditOverflow, hasHorizontalScroll, type OverflowOffender } from '../../lib/mobile/overflow-audit'

/**
 * Opt-in on-device overflow reporter.
 *
 * Enabled by adding `?overflow=1` to the URL — it therefore works against the
 * deployed build on a real phone, which is where these bugs actually show up.
 * Nothing renders and nothing is measured unless the flag is present.
 *
 * Tap an entry to flash the offending element so you can see what it is.
 */
export function OverflowAuditOverlay() {
  const [enabled, setEnabled] = useState(false)
  const [offenders, setOffenders] = useState<OverflowOffender[]>([])
  const [scrolls, setScrolls] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    setEnabled(params.get('overflow') === '1')
  }, [])

  const run = useCallback(() => {
    setOffenders(auditOverflow())
    setScrolls(hasHorizontalScroll())
  }, [])

  useEffect(() => {
    if (!enabled) return
    // Let layout settle (fonts, images, async content) before measuring.
    const timer = setTimeout(run, 600)
    window.addEventListener('resize', run)
    window.addEventListener('orientationchange', run)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', run)
      window.removeEventListener('orientationchange', run)
    }
  }, [enabled, run])

  const flash = (el: Element) => {
    const node = el as HTMLElement
    const previous = node.style.outline
    node.style.outline = '3px solid #ef4444'
    node.scrollIntoView({ block: 'center', behavior: 'smooth' })
    setTimeout(() => {
      node.style.outline = previous
    }, 1600)
  }

  if (!enabled || typeof document === 'undefined') return null

  return createPortal(
    <div
      data-overflow-audit
      className="fixed left-0 right-0 bottom-0 z-[999] pb-safe pointer-events-auto"
    >
      <div className="mx-2 mb-2 rounded-xl bg-gray-900/95 text-white shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
          <span
            className={clsx(
              'inline-block h-2 w-2 rounded-full',
              scrolls || offenders.length ? 'bg-red-500' : 'bg-emerald-500'
            )}
          />
          <span className="text-xs font-semibold">
            {offenders.length} overflowing · {scrolls ? 'page scrolls sideways' : 'no page scroll'}
          </span>
          <div className="ml-auto flex items-center gap-1">
            <button
              onClick={run}
              className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-white/10 no-touch-target"
              aria-label="Re-scan"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCollapsed(c => !c)}
              className="h-9 px-2 flex items-center justify-center rounded-lg hover:bg-white/10 text-xs no-touch-target"
            >
              {collapsed ? 'Show' : 'Hide'}
            </button>
            <button
              onClick={() => setEnabled(false)}
              className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-white/10 no-touch-target"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="max-h-56 overflow-y-auto overscroll-contain">
            {offenders.length === 0 ? (
              <p className="px-3 py-3 text-xs text-white/60">
                Nothing wider than the viewport. If the page still drags sideways, the
                cause is a scroll container rather than an oversized element.
              </p>
            ) : (
              offenders.map((o, i) => (
                <button
                  key={i}
                  onClick={() => flash(o.element)}
                  className="w-full text-left px-3 py-2 border-b border-white/5 hover:bg-white/5 no-touch-target"
                >
                  <div className="text-[11px] font-mono text-red-300">
                    +{o.overhangRight}px{o.overhangLeft > 0 ? ` / left −${o.overhangLeft}px` : ''} · {o.width}px wide
                  </div>
                  <div className="text-[11px] font-mono text-white/70 break-all">{o.path}</div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
