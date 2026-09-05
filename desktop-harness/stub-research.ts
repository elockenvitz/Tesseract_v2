/**
 * The focused workspace, with something in it.
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 *
 * Stages 4G through 4I audited the Dashboard destination through a harness
 * that never stubbed these hooks. `useResearchScan` returned nothing, so the
 * workspace resolved no subject and rendered its not-found state — and every
 * screenshot of "the workbench" was actually a screenshot of an empty one.
 *
 * That is how Stage 4I concluded the destination was read-only. It has a
 * primary action, Ask AI, Discuss, a route into a live idea and a route into
 * the Asset page; none of them could render without a subject. Auditing what a
 * surface offers requires the surface to have something to offer.
 *
 * The assets here match the Today fixtures, so a card and its destination
 * describe the same object.
 */
import type { ResearchSubject, ThesisSection, EvidenceItem } from '../src/lib/desktop-research'

const day = 86_400_000
const iso = (d: number) => new Date(Date.now() - d * day).toISOString()

const subject = (
  assetId: string, symbol: string, companyName: string, over: Partial<ResearchSubject> = {},
): ResearchSubject => ({
  assetId, symbol, companyName,
  thesisUpdatedAt: iso(64),
  daysSinceReview: 64,
  sectionCount: 4,
  coreSectionCount: 3,
  coreSections: ['thesis', 'risks', 'catalysts'],
  evidenceCount: 6,
  newestEvidenceAt: iso(9),
  newestEvidenceTitle: 'Grocery cohort retention, Q3 pull',
  newSinceReview: 2,
  weightPct: 0.9,
  ...over,
})

export const SUBJECTS: ResearchSubject[] = [
  subject('a-dash', 'DASH', 'DoorDash Inc'),
  subject('a-tsm', 'TSM', 'Taiwan Semiconductor', {
    thesisUpdatedAt: iso(21), daysSinceReview: 21, evidenceCount: 4,
    newSinceReview: 0, newestEvidenceTitle: 'N2 pricing checks', weightPct: 1.8,
  }),
  subject('a-pfe', 'PFE', 'Pfizer Inc', {
    thesisUpdatedAt: iso(140), daysSinceReview: 140, evidenceCount: 3,
    newSinceReview: 1, newestEvidenceTitle: 'LOE bridge, revised', weightPct: 2.1,
  }),
  // The sparse object: evidence exists, no case has ever been written.
  subject('a-baba', 'BABA', 'Alibaba Group', {
    thesisUpdatedAt: null, daysSinceReview: null, sectionCount: 0,
    coreSectionCount: 0, coreSections: [], evidenceCount: 1,
    newestEvidenceTitle: 'Initial screen note', newSinceReview: 1, weightPct: undefined,
  }),
  subject('a-nvda', 'NVDA', 'NVIDIA Corp', {
    thesisUpdatedAt: iso(214), daysSinceReview: 214, evidenceCount: 2,
    newSinceReview: 0, newestEvidenceTitle: 'Datacentre channel check', weightPct: 7.4,
  }),
]

const sections = (symbol: string): ThesisSection[] => [
  {
    section: 'thesis',
    content: `Grocery order frequency is compounding faster than the restaurant cohort ever did, at a contribution margin nobody has modelled separately. ${symbol} is being priced as a restaurant delivery business.`,
    supportingDetail: null, updatedAt: iso(64), authorName: 'Eric Lockenvitz',
  },
  {
    section: 'risks',
    content: 'Grocery basket economics assume a rider utilisation rate we have not observed outside the top ten metros.',
    supportingDetail: null, updatedAt: iso(64), authorName: 'Eric Lockenvitz',
  },
  {
    section: 'catalysts',
    content: 'Q4 disclosure is expected to split grocery contribution for the first time.',
    supportingDetail: null, updatedAt: iso(70), authorName: 'Eric Lockenvitz',
  },
]

const evidence = (): EvidenceItem[] => [
  {
    id: 'e-1', title: 'Grocery cohort retention, Q3 pull',
    content: 'Second-order cohort holds at 61% against 48% for restaurants at the same age.',
    createdAt: iso(9), authorName: 'Eric Lockenvitz', isShared: true, isNewSinceReview: true,
  } as EvidenceItem,
  {
    id: 'e-2', title: 'Rider utilisation, metro split',
    content: 'Utilisation outside the top ten metros runs 14% below the modelled rate.',
    createdAt: iso(12), authorName: 'Eric Lockenvitz', isShared: true, isNewSinceReview: true,
  } as EvidenceItem,
  {
    id: 'e-3', title: 'Q2 transcript, grocery commentary',
    content: 'Management declined to split contribution margin by category.',
    createdAt: iso(88), authorName: 'Eric Lockenvitz', isShared: false, isNewSinceReview: false,
  } as EvidenceItem,
]

function closes(from: number, to: number, days: number) {
  return Array.from({ length: days }, (_, i) => {
    const t = i / (days - 1)
    const shape = Math.sin(t * Math.PI * 2.1) * from * 0.05 * (1 - t * 0.35)
    return {
      date: new Date(Date.now() - (days - 1 - i) * day).toISOString().slice(0, 10),
      close: +(from + (to - from) * t + shape).toFixed(2),
    }
  })
}

const DETAIL: Record<string, any> = {
  'a-dash': {
    sections: sections('DASH'), evidence: evidence(),
    history: closes(180, 212.8, 90), spot: 212.8, weightPct: 0.9,
    portfolioName: 'Global Equity',
    liveIdea: { id: 'i-dash', action: 'buy', maturityLabel: 'Decision ready' },
  },
  'a-tsm': {
    sections: sections('TSM').slice(0, 2), evidence: evidence().slice(0, 2),
    history: closes(171, 189.4, 60), spot: 189.4, weightPct: 1.8,
    portfolioName: 'Global Equity',
  },
  'a-pfe': {
    sections: sections('PFE'), evidence: evidence().slice(0, 1),
    history: closes(27.4, 24.1, 90), spot: 24.1, weightPct: 2.1,
    portfolioName: 'Global Equity',
  },
  // Sparse: one note, no case at all, nothing held.
  'a-baba': { sections: [], evidence: evidence().slice(2), history: [], portfolioName: 'Income' },
  'a-nvda': {
    sections: sections('NVDA').slice(0, 1), evidence: evidence().slice(0, 1),
    history: closes(118, 141.8, 60), spot: 141.8, weightPct: 7.4,
    portfolioName: 'Global Equity',
  },
}

export const useResearchScan = () => ({ subjects: SUBJECTS, isLoading: false, error: null })
export const useResearchExposure = () =>
  Object.fromEntries(SUBJECTS.map(s => [s.assetId, s.weightPct ?? 0]))
export const useResearchDetail = (subject: ResearchSubject | null) => ({
  detail: subject ? DETAIL[subject.assetId] : undefined,
  isLoading: false,
})
export const useHasResearch = () => true
