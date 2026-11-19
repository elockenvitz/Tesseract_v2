import { ChartTheme } from './types'
import { ChartTransform } from './transform'
import {
  IndicatorValue,
  MACDValue,
  StochasticValue
} from './indicators'

export interface SubPanelConfig {
  id: string
  type: 'rsi' | 'macd' | 'stochastic' | 'custom'
  height: number // Height as percentage of total chart (0.15 = 15%)
  title: string
  range?: [number, number] // Fixed Y range (e.g., [0, 100] for RSI)
  referenceLines?: number[] // Horizontal reference lines (e.g., [30, 70] for RSI)
}

export interface SubPanelData {
  config: SubPanelConfig
  data: IndicatorValue[] | MACDValue[] | StochasticValue[]
}

/** One indicator inside an explicit plot. */
export interface RenderPlotSeries {
  id: string
  /** The indicator's own kind, which decides how it is drawn and scaled. */
  kind: string
  label: string
  color: string
  data: IndicatorValue[] | MACDValue[] | StochasticValue[]
}

/**
 * A plot the analyst created, with its own height and its own series.
 *
 * `reserveSpace` keeps an EMPTY plot on screen. Dropping it would make Add
 * Plot look like it had failed, and the plot is in the tree either way.
 */
export interface RenderPlot {
  id: string
  title: string
  heightRatio: number
  series: RenderPlotSeries[]
  reserveSpace?: boolean
}

/**
 * Renders indicator sub-panels below the main chart
 */
export class SubPanelRenderer {
  private ctx: CanvasRenderingContext2D
  private theme: ChartTheme
  private devicePixelRatio: number
  private mainChartTransform: ChartTransform

  constructor(
    ctx: CanvasRenderingContext2D,
    theme: ChartTheme,
    mainChartTransform: ChartTransform,
    devicePixelRatio: number = 1
  ) {
    this.ctx = ctx
    this.theme = theme
    this.mainChartTransform = mainChartTransform
    this.devicePixelRatio = devicePixelRatio
  }

  setTheme(theme: ChartTheme) {
    this.theme = theme
  }

  setMainTransform(transform: ChartTransform) {
    this.mainChartTransform = transform
  }

  // Calculate panel area based on position
  private getPanelArea(
    panelIndex: number,
    panelCount: number,
    totalPanelHeight: number,
    mainChartBottom: number
  ) {
    const dims = this.mainChartTransform.getDimensions()
    const panelHeight = totalPanelHeight / panelCount
    const panelGap = 8

    /*
     * `marginLeft`/`marginRight`, not `paddingLeft`/`paddingRight`.
     *
     * `ChartDimensions` has never had padding fields. Reading them gave
     * `undefined`, so `x` was undefined and `width` was NaN, and every draw
     * that takes the panel AREA silently did nothing: no background, no
     * border, no title, no 30/70 reference lines. Canvas discards a NaN
     * rect without raising anything.
     *
     * What still appeared were the indicator LINES, because they take their
     * x from the shared time transform and only their y from the area. So
     * the panes rendered as bare lines floating on the page background --
     * which is exactly what "the indicator lines look poor" was describing.
     * The lines were never the problem; their frame was missing.
     */
    return {
      x: dims.marginLeft,
      y: mainChartBottom + panelGap + panelIndex * (panelHeight + panelGap),
      width: dims.width - dims.marginLeft - dims.marginRight,
      height: panelHeight - panelGap
    }
  }

  // Convert value to Y coordinate within panel
  private valueToY(
    value: number,
    minValue: number,
    maxValue: number,
    panelY: number,
    panelHeight: number
  ): number {
    const range = maxValue - minValue
    const ratio = (value - minValue) / range
    return panelY + panelHeight - ratio * panelHeight
  }

  // Draw panel background and border
  private drawPanelBackground(area: { x: number; y: number; width: number; height: number }) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()

    // Background
    ctx.fillStyle = this.theme.background
    ctx.fillRect(area.x * dpr, area.y * dpr, area.width * dpr, area.height * dpr)

    // Border
    ctx.strokeStyle = this.theme.gridLines
    ctx.lineWidth = 1 * dpr
    ctx.strokeRect(area.x * dpr, area.y * dpr, area.width * dpr, area.height * dpr)

    ctx.restore()
  }

  // Draw panel title
  private drawPanelTitle(title: string, area: { x: number; y: number }) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()
    ctx.fillStyle = this.theme.textSecondary
    ctx.font = `${10 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillText(title, (area.x + 4) * dpr, (area.y + 4) * dpr)
    ctx.restore()
  }

  // Draw horizontal reference lines
  private drawReferenceLines(
    lines: number[],
    minValue: number,
    maxValue: number,
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio

    ctx.save()
    ctx.strokeStyle = this.theme.gridLines
    ctx.lineWidth = 1 * dpr
    ctx.setLineDash([4 * dpr, 4 * dpr])

    for (const value of lines) {
      const y = this.valueToY(value, minValue, maxValue, area.y, area.height) * dpr
      ctx.beginPath()
      ctx.moveTo(area.x * dpr, y)
      ctx.lineTo((area.x + area.width) * dpr, y)
      ctx.stroke()

      // Draw label
      ctx.fillStyle = this.theme.textSecondary
      ctx.font = `${9 * dpr}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
      ctx.textAlign = 'right'
      ctx.textBaseline = 'middle'
      ctx.fillText(String(value), (area.x + area.width - 4) * dpr, y)
    }

    ctx.setLineDash([])
    ctx.restore()
  }

  // Draw RSI panel
  drawRSIPanel(
    data: IndicatorValue[],
    area: { x: number; y: number; width: number; height: number },
    titleOverride?: string,
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    /* The caller's label when there is one. The literal said "RSI (14)"
       whatever period was actually calculated, so an analyst who set 50
       read a pane that disagreed with its own tree entry. */
    this.drawPanelTitle(titleOverride ?? 'RSI (14)', area)
    this.drawReferenceLines([30, 50, 70], 0, 100, area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime && d.value !== null
    )

    if (visibleData.length < 2) return

    ctx.save()

    // Draw overbought/oversold zones
    ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(100, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(70, 0, 100, area.y, area.height) - this.valueToY(100, 0, 100, area.y, area.height)) * dpr
    )

    ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(30, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(0, 0, 100, area.y, area.height) - this.valueToY(30, 0, 100, area.y, area.height)) * dpr
    )

    // Draw RSI line
    ctx.strokeStyle = '#8b5cf6'
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    for (let i = 0; i < visibleData.length; i++) {
      const point = visibleData[i]
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.value!, 0, 100, area.y, area.height) * dpr

      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }

    ctx.stroke()
    ctx.restore()
  }

  // Draw MACD panel
  drawMACDPanel(
    data: MACDValue[],
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle('MACD (12, 26, 9)', area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime && d.macd !== null
    )

    if (visibleData.length < 2) return

    // Calculate range
    let minValue = Infinity
    let maxValue = -Infinity
    for (const d of visibleData) {
      if (d.macd !== null) {
        minValue = Math.min(minValue, d.macd)
        maxValue = Math.max(maxValue, d.macd)
      }
      if (d.signal !== null) {
        minValue = Math.min(minValue, d.signal)
        maxValue = Math.max(maxValue, d.signal)
      }
      if (d.histogram !== null) {
        minValue = Math.min(minValue, d.histogram)
        maxValue = Math.max(maxValue, d.histogram)
      }
    }

    // Add padding
    const range = maxValue - minValue
    minValue -= range * 0.1
    maxValue += range * 0.1

    // Draw zero line
    this.drawReferenceLines([0], minValue, maxValue, area)

    ctx.save()

    // Draw histogram bars
    const barWidth = Math.max(2, (area.width / visibleData.length) * 0.6)
    for (const point of visibleData) {
      if (point.histogram === null) continue

      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const zeroY = this.valueToY(0, minValue, maxValue, area.y, area.height) * dpr
      const histY = this.valueToY(point.histogram, minValue, maxValue, area.y, area.height) * dpr

      ctx.fillStyle = point.histogram >= 0 ? 'rgba(34, 197, 94, 0.6)' : 'rgba(239, 68, 68, 0.6)'
      ctx.fillRect(
        x - (barWidth * dpr) / 2,
        Math.min(zeroY, histY),
        barWidth * dpr,
        Math.abs(histY - zeroY)
      )
    }

    // Draw MACD line
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let started = false
    for (const point of visibleData) {
      if (point.macd === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.macd, minValue, maxValue, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    // Draw signal line
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()

    started = false
    for (const point of visibleData) {
      if (point.signal === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.signal, minValue, maxValue, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    ctx.restore()
  }

  // Draw Stochastic panel
  drawStochasticPanel(
    data: StochasticValue[],
    area: { x: number; y: number; width: number; height: number },
    titleOverride?: string,
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle(titleOverride ?? 'Stochastic (14, 3)', area)
    this.drawReferenceLines([20, 50, 80], 0, 100, area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime
    )

    if (visibleData.length < 2) return

    ctx.save()

    // Draw overbought/oversold zones
    ctx.fillStyle = 'rgba(239, 68, 68, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(100, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(80, 0, 100, area.y, area.height) - this.valueToY(100, 0, 100, area.y, area.height)) * dpr
    )

    ctx.fillStyle = 'rgba(34, 197, 94, 0.1)'
    ctx.fillRect(
      area.x * dpr,
      this.valueToY(20, 0, 100, area.y, area.height) * dpr,
      area.width * dpr,
      (this.valueToY(0, 0, 100, area.y, area.height) - this.valueToY(20, 0, 100, area.y, area.height)) * dpr
    )

    // Draw %K line
    ctx.strokeStyle = '#2563eb'
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let started = false
    for (const point of visibleData) {
      if (point.k === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.k, 0, 100, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    // Draw %D line
    ctx.strokeStyle = '#f97316'
    ctx.lineWidth = 1.5 * dpr
    ctx.beginPath()

    started = false
    for (const point of visibleData) {
      if (point.d === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.d, 0, 100, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    ctx.restore()
  }

  // Draw generic line indicator panel (ATR, ADX, OBV, etc.)
  drawLinePanel(
    data: IndicatorValue[],
    title: string,
    color: string,
    area: { x: number; y: number; width: number; height: number }
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const view = this.mainChartTransform.getView()

    this.drawPanelBackground(area)
    this.drawPanelTitle(title, area)

    // Filter visible data
    const visibleData = data.filter(
      d => d.time >= view.startTime && d.time <= view.endTime && d.value !== null
    )

    if (visibleData.length < 2) return

    // Calculate range
    let minValue = Infinity
    let maxValue = -Infinity
    for (const d of visibleData) {
      if (d.value !== null) {
        minValue = Math.min(minValue, d.value)
        maxValue = Math.max(maxValue, d.value)
      }
    }

    // Add padding
    const range = maxValue - minValue
    minValue -= range * 0.1
    maxValue += range * 0.1

    ctx.save()

    // Draw line
    ctx.strokeStyle = color
    ctx.lineWidth = 1.5 * dpr
    ctx.lineJoin = 'round'
    ctx.beginPath()

    let started = false
    for (const point of visibleData) {
      if (point.value === null) continue
      const x = this.mainChartTransform.timeToX(point.time) * dpr
      const y = this.valueToY(point.value, minValue, maxValue, area.y, area.height) * dpr

      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    ctx.stroke()

    ctx.restore()
  }

  // Render all sub-panels
  /**
   * Draw explicit PLOTS: each one owns its height and may hold several
   * series on a shared scale.
   *
   * `renderSubPanels` below divides the space equally and draws exactly one
   * indicator per pane, because a pane was only ever created by naming an
   * indicator. It is kept, unchanged, for that path.
   *
   * ── The scale model ──────────────────────────────────────────────────
   *
   * Two series in one pane need one axis, and the brief's rule is not to
   * mix units without deciding how. So:
   *
   *   - A plot whose series are ALL bounded oscillators (RSI, Stochastic)
   *     gets the fixed 0-100 they are defined on, and the 30/70 reference
   *     lines that make them readable.
   *   - Any other plot gets the union of its series' actual values. An ATR
   *     in dollars beside an OBV in shares will be dominated by whichever
   *     is larger -- that is a true picture of what was asked for, not a
   *     silent renormalisation that would make both look comparable when
   *     they are not.
   *
   * A plot holding ONE series is delegated to the existing specialised
   * drawing, so today's RSI, MACD and Stochastic panes render exactly as
   * they do now. Nothing that already looked right is redrawn by new code.
   */
  renderPlots(
    plots: RenderPlot[],
    mainChartBottom: number,
    totalHeight: number
  ) {
    const drawable = plots.filter(p => p.series.length > 0 || p.reserveSpace)
    if (drawable.length === 0) return

    const totalPanelHeight = totalHeight - mainChartBottom - 30
    const gap = 8
    const sum = drawable.reduce((a, p) => a + Math.max(0.01, p.heightRatio), 0)
    const dims = this.mainChartTransform.getDimensions()

    let cursor = mainChartBottom + gap
    for (const plot of drawable) {
      const share = Math.max(0.01, plot.heightRatio) / sum
      const height = Math.max(24, totalPanelHeight * share - gap)
      /*
       * `marginLeft`/`marginRight`, which is what `ChartDimensions`
       * actually declares. The older `getPanelArea` below reads
       * `paddingLeft`, which does not exist on the type and resolves to
       * `undefined` at runtime -- see the note there.
       */
      const area = {
        x: dims.marginLeft,
        y: cursor,
        width: dims.width - dims.marginLeft - dims.marginRight,
        height,
      }
      cursor += height + gap

      if (plot.series.length === 1) {
        /* One series: the specialised renderers, untouched. */
        const only = plot.series[0]
        switch (only.kind) {
          case 'rsi':
            this.drawRSIPanel(only.data as IndicatorValue[], area, only.label)
            continue
          case 'macd':
            this.drawMACDPanel(only.data as MACDValue[], area)
            continue
          case 'stochastic':
            this.drawStochasticPanel(only.data as StochasticValue[], area, only.label)
            continue
          default:
            this.drawLinePanel(only.data as IndicatorValue[], only.label, only.color, area)
            continue
        }
      }

      this.drawPanelBackground(area)
      if (plot.series.length === 0) {
        /* A plot created on purpose and not yet filled. It holds its space
           and says why, rather than looking like a rendering failure. */
        this.drawPanelTitle(`${plot.title} — empty`, area)
        continue
      }

      const scale = this.plotScale(plot)
      if (scale.bounded) {
        this.drawReferenceLines([30, 70], scale.min, scale.max, area)
      }
      for (const s of plot.series) {
        this.drawPlotSeries(s, scale, area)
      }
      this.drawPanelTitle(
        `${plot.title} — ${plot.series.map(s => s.label).join(', ')}`,
        area,
      )
    }
  }

  /** The shared value range for a plot, and whether it is a bounded one. */
  private plotScale(plot: RenderPlot): { min: number; max: number; bounded: boolean } {
    const BOUNDED = new Set(['rsi', 'stochastic'])
    if (plot.series.every(s => BOUNDED.has(s.kind))) {
      return { min: 0, max: 100, bounded: true }
    }
    const values: number[] = []
    for (const s of plot.series) {
      for (const point of s.data as unknown as Array<Record<string, number | null>>) {
        for (const key of ['value', 'macd', 'signal', 'histogram', 'k', 'd']) {
          const v = point[key]
          if (typeof v === 'number' && Number.isFinite(v)) values.push(v)
        }
      }
    }
    if (values.length === 0) return { min: 0, max: 1, bounded: false }
    const min = Math.min(...values)
    const max = Math.max(...values)
    /* A flat series has zero range, and dividing by it puts every point at
       NaN -- which draws as nothing and reads as "the indicator is broken". */
    if (min === max) return { min: min - 1, max: max + 1, bounded: false }
    const pad = (max - min) * 0.08
    return { min: min - pad, max: max + pad, bounded: false }
  }

  /** One series of a multi-series plot, on the plot's shared scale. */
  private drawPlotSeries(
    s: RenderPlotSeries,
    scale: { min: number; max: number },
    area: { x: number; y: number; width: number; height: number },
  ) {
    const ctx = this.ctx
    const dpr = this.devicePixelRatio
    const keys = s.kind === 'macd'
      ? ['macd', 'signal']
      : s.kind === 'stochastic'
        ? ['k', 'd']
        : ['value']

    keys.forEach((key, keyIndex) => {
      ctx.save()
      ctx.strokeStyle = s.color
      /* The second component of a two-line indicator is dashed rather than
         a second colour: it belongs to the same series and the tree names
         one colour for it. */
      if (keyIndex > 0) ctx.setLineDash([4 * dpr, 3 * dpr])
      ctx.lineWidth = 1.5 * dpr
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'
      ctx.beginPath()

      let started = false
      for (const point of s.data as unknown as Array<Record<string, number | null> & { time: number }>) {
        const v = point[key]
        /*
         * A null is a gap, not a zero. An indicator's first `period` bars
         * have no value, and joining across them draws a line from the
         * axis into the series that is pure artefact.
         */
        if (typeof v !== 'number' || !Number.isFinite(v)) { started = false; continue }
        const x = this.mainChartTransform.timeToX(point.time)
        if (x < area.x - 2 || x > area.x + area.width + 2) { started = false; continue }
        const y = this.valueToY(v, scale.min, scale.max, area.y, area.height)
        if (!started) { ctx.moveTo(x * dpr, y * dpr); started = true }
        else ctx.lineTo(x * dpr, y * dpr)
      }

      ctx.stroke()
      ctx.restore()
    })
  }

  renderSubPanels(
    panels: SubPanelData[],
    mainChartBottom: number,
    totalHeight: number
  ) {
    if (panels.length === 0) return

    const totalPanelHeight = totalHeight - mainChartBottom - 30 // Leave space for time axis
    const panelCount = panels.length

    panels.forEach((panel, index) => {
      const area = this.getPanelArea(index, panelCount, totalPanelHeight, mainChartBottom)

      switch (panel.config.type) {
        case 'rsi':
          this.drawRSIPanel(panel.data as IndicatorValue[], area)
          break
        case 'macd':
          this.drawMACDPanel(panel.data as MACDValue[], area)
          break
        case 'stochastic':
          this.drawStochasticPanel(panel.data as StochasticValue[], area)
          break
        case 'custom':
          this.drawLinePanel(
            panel.data as IndicatorValue[],
            panel.config.title,
            '#2563eb',
            area
          )
          break
      }
    })
  }
}
