/**
 * The probability envelope over a scenario ladder.
 *
 * ── What this draws ──────────────────────────────────────────────────────
 *
 * A smooth line that PASSES THROUGH each case's probability at that case's own
 * price. Bear at 30% and Base at 40% put the line lower over Bear than over
 * Base, and the highest point of the curve is the heaviest case rather than
 * some derived statistic. It returns to the baseline a short way outside the
 * outer cases, so the shape has ends rather than walls.
 *
 * ── Why not the asset page's construction ────────────────────────────────
 *
 * `ProbabilityDistributionModal` fits a skew-normal to the probability-weighted
 * mean and variance, which peaks at the EXPECTED VALUE and not at any case. On
 * a wide desktop chart with its own axis that reads as a distribution. On a
 * 358px ladder it reads as a hump whose relationship to the three dots beneath
 * it has to be worked out, and the numerically correct answer for DASH — a
 * peak at x=60.3% against Base at x=63.7% — is close enough to Base to look
 * like a near-miss rather than a statement.
 *
 * This is a deliberate divergence, and the two answer different questions. The
 * modal answers "what distribution do these cases imply". This answers "how is
 * my framework weighted", which is the question the reader asked by tapping the
 * expectation on a ladder they are already looking at. Both remain honest
 * because neither is read back: the expected value on the card stays the exact
 * weighted-case figure from `deriveScenarioState`.
 *
 * ── Price controls X, probability controls Y ─────────────────────────────
 *
 * Strictly. `toX` is the ladder's own `pos`, so a knot sits on its dot by
 * construction rather than by two components agreeing. Height is
 * `probability / maxProbability`, so nothing about a case's PRICE can move it
 * vertically — which is what makes the shape a statement about weight.
 *
 * ── Interpolation ────────────────────────────────────────────────────────
 *
 * Monotone cubic (Fritsch-Carlson). A plain Catmull-Rom through three knots
 * overshoots between them, so a 30/40/30 ladder grows humps ABOVE Base on
 * either side — the curve inventing weight the analyst never wrote down.
 * Monotone tangents cannot overshoot: between two knots the curve stays within
 * their two values, so every height on the line is bounded by the
 * probabilities on each side of it.
 *
 * Deterministic: same cases in, same `d` out.
 */

export interface CurvePoint {
  price: number
  probability: number
}

export interface CurveKnot {
  price: number
  /** Where the curve passes, in the caller's coordinates. */
  x: number
  y: number
  /** 0..1 against the heaviest case. */
  height01: number
}

export interface CurveGeometry {
  area: string
  line: string
  /** One per CASE, in price order. The tails are not knots. */
  knots: CurveKnot[]
  /** The heaviest case's price — where the curve peaks. */
  peakPrice: number
}

/** Samples between knots. Enough to read as a curve at any phone width. */
const SAMPLES = 120
/** How far outside the outer cases the tails reach, as a share of their span. */
const TAIL_OF_SPAN = 0.35

/** Fritsch-Carlson tangents: smooth, and cannot overshoot the knots. */
function monotoneTangents(xs: number[], ys: number[]): number[] {
  const n = xs.length
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const dx = xs[i + 1] - xs[i]
    slope.push(dx === 0 ? 0 : (ys[i + 1] - ys[i]) / dx)
  }
  const m: number[] = new Array(n)
  m[0] = slope[0] ?? 0
  m[n - 1] = slope[n - 2] ?? 0
  for (let i = 1; i < n - 1; i++) {
    const a = slope[i - 1], b = slope[i]
    // A turning point gets a flat tangent, which is what stops the overshoot.
    m[i] = a * b <= 0 ? 0 : (a + b) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue }
    const a = m[i] / slope[i], b = m[i + 1] / slope[i]
    const s = a * a + b * b
    if (s > 9) {
      const t = 3 / Math.sqrt(s)
      m[i] = t * a * slope[i]
      m[i + 1] = t * b * slope[i]
    }
  }
  return m
}

export function buildProbabilityCurve(
  points: readonly CurvePoint[],
  /** The axis bounds in the caller's own x units, for clamping the tails. */
  bounds: { min: number; max: number },
  toX: (price: number) => number,
  toY: (height01: number) => number,
): CurveGeometry | null {
  const cases = points
    .filter(p => Number.isFinite(p.price) && Number.isFinite(p.probability) && p.probability > 0)
    .sort((a, b) => a.price - b.price)
  if (cases.length === 0) return null

  const maxP = Math.max(...cases.map(c => c.probability))
  if (!(maxP > 0)) return null

  const knots: CurveKnot[] = cases.map(c => ({
    price: c.price,
    x: toX(c.price),
    height01: c.probability / maxP,
    y: toY(c.probability / maxP),
  }))

  // Tails: back to the baseline a short way outside the outer cases, clamped
  // so a ladder hugging one end of the axis does not draw off the card.
  const first = knots[0], last = knots[knots.length - 1]
  const span = Math.max(last.x - first.x, 1)
  const pad = span * TAIL_OF_SPAN
  const leftX = Math.max(bounds.min, first.x - pad)
  const rightX = Math.min(bounds.max, last.x + pad)

  const xs = [leftX, ...knots.map(k => k.x), rightX]
  const hs = [0, ...knots.map(k => k.height01), 0]
  // A single case has no interior to interpolate; two tails still give a bump.
  const m = monotoneTangents(xs, hs)

  const heightAt = (x: number): number => {
    if (x <= xs[0]) return hs[0]
    if (x >= xs[xs.length - 1]) return hs[hs.length - 1]
    let i = 0
    while (i < xs.length - 2 && x > xs[i + 1]) i++
    const h = xs[i + 1] - xs[i]
    if (h === 0) return hs[i]
    const t = (x - xs[i]) / h
    const t2 = t * t, t3 = t2 * t
    return (2 * t3 - 3 * t2 + 1) * hs[i]
      + (t3 - 2 * t2 + t) * h * m[i]
      + (-2 * t3 + 3 * t2) * hs[i + 1]
      + (t3 - t2) * h * m[i + 1]
  }

  const step = (rightX - leftX) / SAMPLES
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const x = leftX + i * step
    // Clamped: monotone tangents cannot overshoot, but floating point at a
    // turning point can still land a hair outside [0, 1].
    pts.push({ x, y: toY(Math.min(Math.max(heightAt(x), 0), 1)) })
  }

  const r = (n: number) => Math.round(n * 100) / 100
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)},${r(p.y)}`).join(' ')
  const base = toY(0)
  const area = `${line} L${r(rightX)},${r(base)} L${r(leftX)},${r(base)} Z`

  const peak = cases.reduce((best, c) => (c.probability > best.probability ? c : best), cases[0])
  return { area, line, knots, peakPrice: peak.price }
}
