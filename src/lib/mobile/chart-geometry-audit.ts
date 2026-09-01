/**
 * What a feed price chart's box chain actually measures, on the device.
 *
 * ── Why this exists ───────────────────────────────────────────────────────
 *
 * A phone reports that one card family's price chart is visibly taller than
 * every other's. Three passes of static analysis and headless measurement have
 * said the families are identical: one `pricePane` helper, one `PricePane`,
 * one `PriceContext`, one geometry token, and a rendered test proving two
 * framings reach the same element with the same classes. All of that can be
 * true and the phone can still be right — the feed is behind a login that
 * headless tooling cannot pass, so nothing has ever measured the DOM that
 * produced the report.
 *
 * This measures it. Read-only: it takes `getBoundingClientRect` and
 * `getComputedStyle` and returns numbers. It sets nothing, writes nothing back
 * into layout, and is not used as styling input anywhere.
 *
 * The point is the ANCESTOR CHAIN, not the plot. The plot's own contract is
 * already proven; what is not known is whether some box between the chart and
 * the card differs between families. So this walks from the chart outward and
 * reports every step, and the answer is whichever row differs.
 */

export interface BoxMeasure {
  /** What this row is, in the reader's terms. */
  label: string
  /** How the element was found, so a surprising number can be chased. */
  selector: string
  tag: string
  height: number
  width: number
  /** Viewport-relative, for "is it taller or merely lower down". */
  top: number
  bottom: number
}

export interface StyleMeasure {
  height: string
  minHeight: string
  maxHeight: string
  flexGrow: string
  flexShrink: string
  flexBasis: string
  display: string
  position: string
  overflow: string
  overflowY: string
  width: string
}

export interface AncestorMeasure {
  tag: string
  /** The most identifying attribute available, or the first class. */
  ident: string
  height: number
  overflow: string
  overflowY: string
  flexGrow: string
  flexShrink: string
  flexBasis: string
}

export interface SvgMeasure {
  width: number
  height: number
  cssWidth: string
  cssHeight: string
  viewBox: string
  preserveAspectRatio: string
  /** The box the SVG is positioned inside, which is not the plot wrapper. */
  parentWidth: number
  parentHeight: number
  parentPosition: string
}

export interface ChartGeometryReport {
  /** Which card this is, in the words on screen. */
  card: {
    signalType: string
    kindLabel: string
    headline: string
    activePane: string
    geometry: string
  }
  viewport: {
    inner: string
    screen: string
    visual: string
    dpr: number
    supportsHeightSvh: boolean
    supportsMaxHeightSvh: boolean
  }
  boxes: BoxMeasure[]
  plotStyle: StyleMeasure
  svg: SvgMeasure | null
  ancestors: AncestorMeasure[]
  /** The first ancestor above the plot that clips, which bounds what is seen. */
  firstClippingAncestor: string | null
  /** Elements the overlay outlines, in the order the legend lists them. */
  outlines: { label: string; rect: DOMRect }[]
}

const px = (n: number) => Math.round(n)

function measure(label: string, selector: string, el: Element | null | undefined): BoxMeasure | null {
  if (!el) return null
  const r = el.getBoundingClientRect()
  return {
    label,
    selector,
    tag: el.tagName.toLowerCase(),
    height: px(r.height),
    width: px(r.width),
    top: px(r.top),
    bottom: px(r.bottom),
  }
}

/** The most identifying thing about an element, for a one-line label. */
function ident(el: Element): string {
  const d = (el as HTMLElement).dataset ?? {}
  for (const k of ['testid', 'slot', 'signalCard', 'plotGeometry', 'proseRole']) {
    if (d[k]) return `${k}=${d[k]}`
  }
  const cls = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)[0]
  return cls ? `.${cls}` : el.tagName.toLowerCase()
}

/**
 * The plot box worth reporting on.
 *
 * The feed keeps several cards mounted at once, so there are several charts in
 * the document and only one of them is the one being looked at. The nearest to
 * the middle of the viewport is that one.
 */
export function visiblePlotBox(): HTMLElement | null {
  const mid = window.innerHeight / 2
  let best: HTMLElement | null = null
  let bestDist = Infinity
  document.querySelectorAll<HTMLElement>('[data-plot-geometry]').forEach(el => {
    const r = el.getBoundingClientRect()
    // Off-screen entirely, including the carousel's un-paged slides, which sit
    // beside the viewport rather than above or below it.
    if (r.height === 0 || r.width === 0) return
    if (r.right <= 0 || r.left >= window.innerWidth) return
    const dist = Math.abs((r.top + r.bottom) / 2 - mid)
    if (dist < bestDist) { bestDist = dist; best = el }
  })
  return best
}

export function auditChartGeometry(): ChartGeometryReport | null {
  const plot = visiblePlotBox()
  if (!plot) return null

  const svg = plot.querySelector<SVGSVGElement>('[data-testid="price-chart"]')
  const svgParent = svg?.parentElement ?? null
  const priceRoot = plot.closest<HTMLElement>('[data-testid="price-context"]')
  // `PricePane` renders `PriceContext` as its own root in the drawable state,
  // so these are the same element there — reported separately anyway, because
  // "they are the same element" is itself a finding worth seeing.
  const paneRoot = priceRoot?.parentElement ?? null
  const slide = plot.closest<HTMLElement>('[data-testid="card-carousel"]')?.firstElementChild
    ? (paneRoot?.closest('[data-testid="card-carousel"]')?.firstElementChild?.children
        ? Array.from(
            paneRoot!.closest('[data-testid="card-carousel"]')!.firstElementChild!.children,
          ).find(s => s.contains(plot)) ?? null
        : null)
    : null
  const carousel = plot.closest<HTMLElement>('[data-testid="card-carousel"]')
    ?? plot.closest<HTMLElement>('[data-testid="carousel-single"]')
  const workspace = carousel?.parentElement ?? null
  const card = plot.closest<HTMLElement>('article[data-signal-card]')
  const column = card?.querySelector<HTMLElement>('[data-slot="body-region"]')?.parentElement
    ?? workspace?.parentElement
    ?? null
  const controls = priceRoot?.firstElementChild ?? null
  const pager = carousel?.lastElementChild ?? null
  const desc = card?.querySelector<HTMLElement>('[data-slot="body-region"]') ?? null
  const footer = card?.querySelector<HTMLElement>('[data-slot="actions"]') ?? null

  /**
   * The header is not one element, so it is measured as a span rather than
   * guessed at: everything in the content column above the workspace.
   */
  let headerHeight = 0
  if (column && workspace) {
    for (const kid of Array.from(column.children)) {
      if (kid === workspace) break
      headerHeight += kid.getBoundingClientRect().height
    }
  }

  const boxes: BoxMeasure[] = [
    measure('A card', 'article[data-signal-card]', card),
    { label: 'B header (sum above workspace)', selector: 'column children before band',
      tag: 'span', height: px(headerHeight), width: 0, top: 0, bottom: 0 },
    measure('C workspace / band', 'carousel.parentElement', workspace),
    measure('D active slide', 'track child containing the plot', slide),
    measure('E pane root', 'priceContext.parentElement', paneRoot),
    measure('F/G PriceContext root', '[data-testid=price-context]', priceRoot),
    measure('H price controls', 'priceContext.firstElementChild', controls),
    measure('I PLOT wrapper', '[data-plot-geometry]', plot),
    measure('J svg', '[data-testid=price-chart]', svg),
    measure('K svg parent', 'svg.parentElement', svgParent),
    measure('L pager', 'carousel.lastElementChild', pager),
    measure('M description', '[data-slot=body-region]', desc),
    measure('N footer', '[data-slot=actions]', footer),
  ].filter((b): b is BoxMeasure => b != null)

  const cs = getComputedStyle(plot)
  const plotStyle: StyleMeasure = {
    height: cs.height, minHeight: cs.minHeight, maxHeight: cs.maxHeight,
    flexGrow: cs.flexGrow, flexShrink: cs.flexShrink, flexBasis: cs.flexBasis,
    display: cs.display, position: cs.position,
    overflow: cs.overflow, overflowY: cs.overflowY, width: cs.width,
  }

  let svgMeasure: SvgMeasure | null = null
  if (svg && svgParent) {
    const sr = svg.getBoundingClientRect()
    const pr = svgParent.getBoundingClientRect()
    const ss = getComputedStyle(svg)
    svgMeasure = {
      width: px(sr.width), height: px(sr.height),
      cssWidth: ss.width, cssHeight: ss.height,
      viewBox: svg.getAttribute('viewBox') ?? '(none)',
      preserveAspectRatio: svg.getAttribute('preserveAspectRatio') ?? '(default)',
      parentWidth: px(pr.width), parentHeight: px(pr.height),
      parentPosition: getComputedStyle(svgParent).position,
    }
  }

  const ancestors: AncestorMeasure[] = []
  let firstClipping: string | null = null
  let node: HTMLElement | null = plot.parentElement
  for (let i = 0; i < 8 && node && node !== document.body; i++) {
    const s = getComputedStyle(node)
    const row: AncestorMeasure = {
      tag: node.tagName.toLowerCase(),
      ident: ident(node),
      height: px(node.getBoundingClientRect().height),
      overflow: s.overflow, overflowY: s.overflowY,
      flexGrow: s.flexGrow, flexShrink: s.flexShrink, flexBasis: s.flexBasis,
    }
    ancestors.push(row)
    if (!firstClipping && s.overflowY !== 'visible') firstClipping = `${row.ident} (${row.overflowY})`
    node = node.parentElement
  }

  const kindEl = card?.querySelector('[data-slot="kind"]')
  const activeDot = carousel?.lastElementChild?.querySelector('[aria-current="true"]')
    ?? carousel?.lastElementChild?.querySelector('[aria-selected="true"]')

  const vv = window.visualViewport

  return {
    card: {
      signalType: card?.dataset.signalCard ?? '(none)',
      kindLabel: kindEl?.textContent?.trim() ?? '(none)',
      headline: card?.querySelector('h2')?.textContent?.trim().slice(0, 40) ?? '(none)',
      activePane: activeDot?.getAttribute('aria-label')
        ?? (carousel?.dataset.testid === 'carousel-single' ? 'single' : 'price'),
      geometry: plot.dataset.plotGeometry ?? '(none)',
    },
    viewport: {
      inner: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${window.screen.width}x${window.screen.height}`,
      visual: vv ? `${Math.round(vv.width)}x${Math.round(vv.height)}` : '(none)',
      dpr: window.devicePixelRatio,
      supportsHeightSvh: CSS.supports('height', '34svh'),
      supportsMaxHeightSvh: CSS.supports('max-height', '34svh'),
    },
    boxes,
    plotStyle,
    svg: svgMeasure,
    ancestors,
    firstClippingAncestor: firstClipping,
    outlines: [
      workspace ? { label: 'workspace', rect: workspace.getBoundingClientRect() } : null,
      priceRoot ? { label: 'priceRoot', rect: priceRoot.getBoundingClientRect() } : null,
      { label: 'plot', rect: plot.getBoundingClientRect() },
      svg ? { label: 'svg', rect: svg.getBoundingClientRect() } : null,
    ].filter((o): o is { label: string; rect: DOMRect } => o != null),
  }
}
