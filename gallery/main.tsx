import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { SignalCardView } from '../src/components/signals/SignalCardView'
import { buildActiveRiskCard } from '../src/lib/signals/builders/activeRisk'
import { buildRecommendationCard } from '../src/lib/signals/builders/recommendation'
import { buildNewsCard } from '../src/lib/signals/builders/news'
import type { CardResult, SignalCard } from '../src/lib/signals/contract'

/**
 * A gallery of every card the builders can emit, rendered through the real
 * component with the real stylesheet.
 *
 * It is a separate Vite entry rather than a route in the app so that nothing
 * here can reach the production bundle, and so the layout assertions in
 * e2e/signal-cards.spec.ts have something deterministic to measure — the feed
 * itself depends on live data and cannot be a stable subject for a height
 * assertion.
 *
 * Dates are frozen. A card whose eyebrow says "2 hours ago" one day and "3
 * hours ago" the next makes every screenshot diff meaningless.
 */

const NOW = new Date('2026-08-15T14:00:00.000Z')

const unwrap = (r: CardResult): SignalCard => {
  if (!r.ok) throw new Error(`suppressed: ${r.reason} — ${r.detail}`)
  return r.card
}

const activeRisk = unwrap(buildActiveRiskCard({
  assetId: 'a1', symbol: 'MSFT', companyName: 'Microsoft',
  weightPct: 6.2, benchmarkWeightPct: 3.1,
  portfolioId: 'p1', portfolioName: 'Core Equity',
  asOf: '2026-07-31T00:00:00.000Z',
}))

const recommendation = unwrap(buildRecommendationCard({
  id: 'r1', assetId: 'a2', symbol: 'DASH', action: 'trim',
  proposedWeightPct: 1.5, currentWeightPct: 4.0,
  currentWeightAsOf: '2026-07-31T00:00:00.000Z',
  rationale: 'Multiple has re-rated past our bull case and the delivery margin story is now consensus. The position was sized for an outcome that has already happened, and holding it at four percent is a new decision nobody has made.',
  recommendedBy: 'Priya Raman',
  portfolioId: 'p1', portfolioName: 'Core Equity',
  createdAt: new Date(NOW.getTime() - 6 * 86_400_000).toISOString(),
}))

const news = unwrap(buildNewsCard({
  id: 'n1',
  headline: 'Microsoft raises quarterly dividend and expands buyback authorisation',
  summary: 'The company lifted its payout by 10% and added $60bn to its repurchase programme, the largest single authorisation in its history.',
  url: 'https://example.com/story', source: 'Reuters',
  publishedAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
  primarySymbol: 'MSFT',
  asset: { id: 'a1', symbol: 'MSFT', companyName: 'Microsoft' },
  heldIn: ['Core Equity', 'Growth'], maxWeightPct: 6.2,
}))

/**
 * A constructed variant, not a builder output.
 *
 * None of the three builders emits evidence today — the contract's rule is
 * that a chart needs an argument to appear, and none of them has one yet. This
 * exists so the gallery can show the two states side by side: what a card with
 * a sparkline looks like, and that the slot leaves no gap without one.
 */
const withSparkline: SignalCard = {
  ...activeRisk,
  id: 'active_risk:with-evidence',
  evidence: {
    kind: 'sparkline',
    data: [402, 398, 405, 411, 409, 415, 421, 418, 424, 430, 427, 433],
    annotations: [{ date: '2026-07-15T00:00:00.000Z', label: 'Added', kind: 'entry' }],
  },
}

const Sparkline = ({ points }: { points: number[] }) => {
  const min = Math.min(...points)
  const max = Math.max(...points)
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * 100},${28 - ((p - min) / (max - min)) * 26}`)
    .join(' ')
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="w-full h-8" data-testid="sparkline">
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5"
        className="text-gray-400 dark:text-gray-500" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

const noop = () => {}

const CARDS: { slug: string; card: SignalCard; evidence?: React.ReactNode }[] = [
  { slug: 'active-risk', card: activeRisk },
  { slug: 'active-risk-sparkline', card: withSparkline, evidence: <Sparkline points={withSparkline.evidence!.data as number[]} /> },
  { slug: 'recommendation', card: recommendation },
  { slug: 'news', card: news },
]

createRoot(document.getElementById('root')!).render(
  <div className="bg-gray-100 dark:bg-black min-h-screen">
    {/* The feed proper — cards stacked as the user meets them, which is the
        only way to see whether more than one fits on a phone screen. */}
    <div id="feed" className="max-w-[390px] mx-auto">
      {CARDS.map(({ slug, card, evidence }) => (
        <div key={slug} data-card={slug}>
          <SignalCardView card={card} onAction={noop} onOpen={noop} onWhy={noop} evidence={evidence} />
        </div>
      ))}
    </div>
  </div>,
)
