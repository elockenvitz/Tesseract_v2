import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

import { auditChartGeometry, type ChartGeometryReport } from '../../lib/mobile/chart-geometry-audit'

/**
 * On-device readout of a price chart's box chain.
 *
 * ── Why an overlay and not another measurement pass ───────────────────────
 *
 * The feed is behind a login, so every measurement of this chart so far has
 * been taken somewhere the reported bug does not live: a gallery fixture, a
 * headless viewport, a jsdom tree. All three said the families are identical
 * and the phone kept saying otherwise. The way out of that is not a fourth
 * inference — it is to put the numbers on the screen the report is about.
 *
 * ── What it must not do ───────────────────────────────────────────────────
 *
 * Read only. It calls `getBoundingClientRect` and `getComputedStyle` and
 * renders text. It sets no height, feeds nothing back into layout, and is not
 * an input to any style. It is a portal with `pointer-events: none`, so it
 * occupies no layout space and cannot intercept a gesture — a diagnostic that
 * changed the thing it was measuring would be worse than none.
 *
 * ── Gating ────────────────────────────────────────────────────────────────
 *
 * `import.meta.env.DEV` AND `?chartgeom=1`. The build gate means it cannot
 * exist in production at all; the URL flag is the convention
 * `OverflowAuditOverlay` already uses, and it is what makes this usable from a
 * phone against the dev server rather than only from a desktop console.
 *
 * Temporary. This is evidence collection for one bug and should come out with
 * the fix it leads to.
 */

/** Outline colours, in the order `outlines` returns them. */
const OUTLINE = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981']

export function ChartGeometryOverlay() {
  const [on, setOn] = useState(false)
  const [report, setReport] = useState<ChartGeometryReport | null>(null)

  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (typeof window === 'undefined') return
    setOn(new URLSearchParams(window.location.search).get('chartgeom') === '1')
  }, [])

  const run = useCallback(() => setReport(auditChartGeometry()), [])

  useEffect(() => {
    if (!on) return
    /**
     * Bounded, not polled.
     *
     * One measurement once layout has settled, then a debounced re-read on the
     * events that actually change which chart is on screen: swiping the feed
     * (a vertical scroll), paging the carousel (a horizontal scroll inside it,
     * which is why the listener captures), and rotating. No interval, no
     * observer — an observer here would be measurement feeding layout, which
     * is the exact shape of the jitter this codebase has already fixed twice.
     */
    let t: ReturnType<typeof setTimeout> | undefined
    const schedule = () => {
      if (t) clearTimeout(t)
      t = setTimeout(run, 220)
    }
    t = setTimeout(run, 700)
    window.addEventListener('scroll', schedule, { capture: true, passive: true })
    window.addEventListener('resize', schedule)
    window.addEventListener('orientationchange', schedule)
    return () => {
      if (t) clearTimeout(t)
      window.removeEventListener('scroll', schedule, { capture: true } as EventListenerOptions)
      window.removeEventListener('resize', schedule)
      window.removeEventListener('orientationchange', schedule)
    }
  }, [on, run])

  if (!import.meta.env.DEV || !on) return null

  const Row = ({ k, v }: { k: string; v: string | number }) => (
    <div className="flex gap-1 leading-[1.25]">
      <span className="w-[104px] shrink-0 truncate opacity-70">{k}</span>
      <span className="min-w-0 flex-1 truncate font-bold tabular-nums">{v}</span>
    </div>
  )

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[9999]">
      {/* Outlines, drawn at the measured rects. Absolutely positioned over the
          page, so they mark boxes without being in the layout that produced
          them. */}
      {report?.outlines.map((o, i) => (
        <div
          key={o.label}
          className="absolute"
          style={{
            left: o.rect.left, top: o.rect.top,
            width: o.rect.width, height: o.rect.height,
            outline: `1px dashed ${OUTLINE[i % OUTLINE.length]}`,
            outlineOffset: 0,
          }}
        />
      ))}

      <div
        className="absolute left-1 right-1 top-1 rounded bg-black/85 px-2 py-1.5 text-[9px] font-medium text-white"
        style={{ fontVariantNumeric: 'tabular-nums' }}
      >
        {!report && <div>chartgeom: no visible price chart</div>}
        {report && (
          <>
            <div className="mb-1 border-b border-white/25 pb-1 text-[10px] font-bold">
              {report.card.headline}
              <div className="font-medium opacity-80">
                {report.card.signalType} · {report.card.kindLabel} · pane {report.card.activePane}
                {' · '}geometry {report.card.geometry}
              </div>
              <div className="font-medium opacity-80">
                vp {report.viewport.inner} · visual {report.viewport.visual}
                {' · '}dpr {report.viewport.dpr}
                {' · svh h/max '}
                {String(report.viewport.supportsHeightSvh)}/{String(report.viewport.supportsMaxHeightSvh)}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-2">
              <div>
                {report.boxes.map(b => (
                  <Row key={b.label} k={b.label} v={`${b.height}${b.top || b.bottom ? ` · y${b.top}-${b.bottom}` : ''}`} />
                ))}
              </div>
              <div>
                <div className="opacity-70">plot computed</div>
                <Row k="height" v={report.plotStyle.height} />
                <Row k="min/max" v={`${report.plotStyle.minHeight} / ${report.plotStyle.maxHeight}`} />
                <Row k="grow/shrink" v={`${report.plotStyle.flexGrow} / ${report.plotStyle.flexShrink}`} />
                <Row k="basis" v={report.plotStyle.flexBasis} />
                <Row k="display/pos" v={`${report.plotStyle.display} ${report.plotStyle.position}`} />
                <Row k="overflow" v={report.plotStyle.overflowY} />
                <Row k="width" v={report.plotStyle.width} />
                {report.svg && (
                  <>
                    <div className="mt-1 opacity-70">svg</div>
                    <Row k="box" v={`${report.svg.width}x${report.svg.height}`} />
                    <Row k="css h" v={report.svg.cssHeight} />
                    <Row k="viewBox" v={report.svg.viewBox} />
                    <Row k="PAR" v={report.svg.preserveAspectRatio} />
                    <Row k="parent" v={`${report.svg.parentWidth}x${report.svg.parentHeight} ${report.svg.parentPosition}`} />
                  </>
                )}
              </div>
            </div>

            <div className="mt-1 border-t border-white/25 pt-1">
              <div className="opacity-70">ancestors above the plot</div>
              {report.ancestors.map((a, i) => (
                <Row
                  key={i}
                  k={a.ident}
                  v={`h${a.height} ovf:${a.overflowY} g${a.flexGrow} s${a.flexShrink} b${a.flexBasis}`}
                />
              ))}
              <Row k="first clip" v={report.firstClippingAncestor ?? '(none)'} />
            </div>

            <div className="mt-1 flex gap-2 border-t border-white/25 pt-1 opacity-80">
              {report.outlines.map((o, i) => (
                <span key={o.label} style={{ color: OUTLINE[i % OUTLINE.length] }}>■ {o.label}</span>
              ))}
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
