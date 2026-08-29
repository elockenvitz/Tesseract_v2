/**
 * The scenario probability distribution, as the product already draws it.
 *
 * ── Where this comes from ─────────────────────────────────────────────────
 *
 * `ProbabilityDistributionModal` on the asset page has drawn this curve since
 * long before the mobile ladder existed: one continuous skew-normal built from
 * the probability-weighted mean, variance and third moment of the analyst's own
 * cases. This is that construction, extracted so the ladder draws the SAME
 * shape rather than a second one that merely looks similar.
 *
 * The first mobile attempt summed a Gaussian bump per case. It produced a
 * plausible silhouette and the wrong one — a lumpy curve peaking at the modal
 * case, where the product's curve is unimodal and peaks at the expectation. Two
 * drawings of one framework disagreeing is worse than either alone.
 *
 * The modal is deliberately NOT refactored onto this yet. It carries hover
 * states, scenario rules, gradients and an axis this has no business knowing
 * about, and rewiring a working desktop surface to prove a point is a change
 * with risk and no user. Adopting it there is a follow-up; the math is now in
 * one place for that to be cheap.
 *
 * ── The construction ─────────────────────────────────────────────────────
 *
 *   mean      probability-weighted price — the same EV the card states
 *   variance  probability-weighted squared deviation from that mean
 *   skewness  probability-weighted third moment, normalised
 *
 * The skew is applied as a skew-normal approximation: `tanh` clamps it, then
 * the standard deviation widens on one side of the mean and narrows on the
 * other. Weight concentrated above the mean gives a longer right tail, which is
 * what a bull-heavy ladder should look like.
 *
 * ── What it is not ───────────────────────────────────────────────────────
 *
 * A drawing, not an estimate. Nothing reads it back: the expected value on the
 * card stays the exact weighted-case figure from `deriveScenarioState`, and no
 * probability is ever recovered from the rendered path. Deterministic — same
 * cases in, same `d` out, on every render.
 */

export interface CurvePoint {
  /** The case's own price. */
  price: number
  /** Its weight. The set need not sum to 100. */
  probability: number
}

export interface CurveGeometry {
  /** `d` for the filled area, closed along the baseline. */
  area: string
  /** `d` for the silhouette alone, unclosed. */
  line: string
  /** The probability-weighted mean, which is where this curve peaks. */
  meanPrice: number
}

/** Resolution. 160 is smooth at any phone width and cheap to build. */
const SAMPLES = 160
/** Fallback spread when every case shares a price. */
const FALLBACK_SD_OF_SPAN = 0.2
/** How far the skew may push the two sides apart. Matches the modal. */
const SKEW_LIMIT = 0.3

export function buildProbabilityCurve(
  points: readonly CurvePoint[],
  domain: { min: number; max: number },
  toX: (price: number) => number,
  toY: (height01: number) => number,
): CurveGeometry | null {
  const usable = points.filter(p =>
    Number.isFinite(p.price) && Number.isFinite(p.probability) && p.probability > 0)
  if (usable.length === 0) return null
  if (!(domain.max > domain.min)) return null

  const total = usable.reduce((n, p) => n + p.probability, 0)
  if (!(total > 0)) return null

  const mean = usable.reduce((n, p) => n + p.price * p.probability, 0) / total

  const variance = usable.reduce(
    (n, p) => n + p.probability * (p.price - mean) ** 2, 0) / total
  const span = Math.max(...usable.map(p => p.price)) - Math.min(...usable.map(p => p.price))
  const sd = Math.sqrt(variance) || span * FALLBACK_SD_OF_SPAN
    || (domain.max - domain.min) * FALLBACK_SD_OF_SPAN
  if (!(sd > 0)) return null

  const skewness = usable.reduce(
    (n, p) => n + p.probability * ((p.price - mean) / sd) ** 3, 0) / total
  // `tanh` clamps an unbounded third moment into [-1, 1] before it is allowed
  // to move the tails — a single far-out case must not invert the shape.
  const skew = Math.tanh(skewness * 0.5)
  const leftSd = sd * (1 - skew * SKEW_LIMIT)
  const rightSd = sd * (1 + skew * SKEW_LIMIT)

  const step = (domain.max - domain.min) / SAMPLES
  const pts: { x: number; y: number }[] = []
  for (let i = 0; i <= SAMPLES; i++) {
    const price = domain.min + i * step
    const s = price < mean ? leftSd : rightSd
    const z = (price - mean) / s
    // Peak density is 1 at the mean, so the curve is already normalised.
    pts.push({ x: toX(price), y: toY(Math.exp(-0.5 * z * z)) })
  }

  const r = (n: number) => Math.round(n * 100) / 100
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${r(p.x)},${r(p.y)}`).join(' ')
  const base = toY(0)
  const area = `${line} L${r(pts[pts.length - 1].x)},${r(base)} L${r(pts[0].x)},${r(base)} Z`

  return { area, line, meanPrice: mean }
}
