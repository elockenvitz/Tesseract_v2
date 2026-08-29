/**
 * A probability silhouette for a set of weighted scenario prices.
 *
 * ── What this is, and what it is not ──────────────────────────────────────
 *
 * It is a DRAWING of a discrete framework. An analyst wrote down three prices
 * and three weights; this renders that as a shape the eye can read in one
 * glance instead of three numbers it has to compare.
 *
 * It is NOT a statistical estimate of anything. Nothing downstream reads it,
 * nothing is integrated to recover a mean, and the expected value on the card
 * keeps coming from the exact weighted-case arithmetic in `deriveScenarioState`.
 * If the curve and the stated EV ever disagreed, the curve would be wrong.
 *
 * ── Construction ─────────────────────────────────────────────────────────
 *
 * Each case contributes a Gaussian bump centred on its OWN price and scaled by
 * its probability; the curve is their sum, sampled evenly across the domain.
 * That gives the three properties the shape needs:
 *
 *   - the peak sits at the heaviest case, not at the mean, so a skewed
 *     framework looks skewed;
 *   - neighbouring cases merge into one shoulder rather than three spikes,
 *     which is what makes it read as a distribution;
 *   - it tapers to nothing at the edges instead of dropping vertically, so
 *     the silhouette has ends rather than walls.
 *
 * Deterministic: same cases in, same path out, on every render and reload.
 * There is no randomness, no time input and no per-card tuning.
 *
 * ── Bandwidth ────────────────────────────────────────────────────────────
 *
 * Derived from the spread of the cases themselves — a fraction of the span
 * between the lowest and highest — so a tight ladder gets narrow bumps and a
 * wide one gets broad bumps, and neither needs a hand-set constant. A
 * degenerate spread falls back to a fraction of the domain, so a ladder whose
 * cases sit at one price still draws one honest bump rather than dividing by
 * zero.
 */

export interface CurvePoint {
  /** The case's own price. Position, never redistributed. */
  price: number
  /** Its weight. Magnitude only; the sum need not be 100. */
  probability: number
}

export interface CurveGeometry {
  /** `d` for the filled area, closed along the baseline. */
  area: string
  /** `d` for the silhouette alone, unclosed. */
  line: string
  /** Where the drawn peak sits, in price. For labelling only — NOT the mean. */
  peakPrice: number
}

/** How wide each bump is, as a fraction of the case spread. */
const BANDWIDTH_OF_SPREAD = 0.22
/** Fallback when every case shares a price, as a fraction of the domain. */
const BANDWIDTH_OF_DOMAIN = 0.08
/** Sampling resolution. 64 is smooth at 340px and cheap to build. */
const SAMPLES = 64

const gaussian = (x: number, centre: number, bandwidth: number) =>
  Math.exp(-0.5 * ((x - centre) / bandwidth) ** 2)

/**
 * Build the silhouette.
 *
 * `toX` and `toY` map price and normalised height into the caller's own
 * coordinate space — the ladder passes its existing `pos(price)`, so the curve
 * cannot acquire a second x-scale. Height arrives as 0..1 and the caller
 * decides how tall that is.
 */
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

  const prices = usable.map(p => p.price)
  const spread = Math.max(...prices) - Math.min(...prices)
  const bandwidth = spread > 0
    ? spread * BANDWIDTH_OF_SPREAD
    : (domain.max - domain.min) * BANDWIDTH_OF_DOMAIN

  const sample = (price: number) =>
    usable.reduce((sum, p) => sum + p.probability * gaussian(price, p.price, bandwidth), 0)

  const step = (domain.max - domain.min) / (SAMPLES - 1)
  const raw: { price: number; value: number }[] = []
  for (let i = 0; i < SAMPLES; i++) {
    const price = domain.min + i * step
    raw.push({ price, value: sample(price) })
  }

  const peak = raw.reduce((best, p) => (p.value > best.value ? p : best), raw[0])
  if (!(peak.value > 0)) return null

  // Normalised so the tallest point is 1: the shape is what carries meaning,
  // not the absolute sum, which varies with how many cases overlap.
  const pts = raw.map(p => ({ x: toX(p.price), y: toY(p.value / peak.value) }))

  const round = (n: number) => Math.round(n * 100) / 100
  const line = pts
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${round(p.x)},${round(p.y)}`)
    .join(' ')
  const base = toY(0)
  const area = `${line} L${round(pts[pts.length - 1].x)},${round(base)} `
    + `L${round(pts[0].x)},${round(base)} Z`

  return { area, line, peakPrice: peak.price }
}
