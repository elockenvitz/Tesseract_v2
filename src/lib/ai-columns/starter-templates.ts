/**
 * Starter AI column templates — curated, one-click AI columns for common
 * investment-research questions. Each template becomes a real row in
 * `ai_column_library` when added; after that it behaves like any custom
 * column (editable, removable, cached).
 *
 * Kept intentionally short: better to have 8 excellent templates than 30
 * mediocre ones. Add new entries only when the prompt is proven useful.
 */

import type { AIColumnContextConfig } from '../../hooks/useAIColumns'

export interface AIColumnTemplate {
  /** Stable string id for UI keys — NOT persisted; every insert mints a new row. */
  id: string
  name: string
  description: string
  icon: string // keys in AIColumnLibraryDropdown ICON_MAP
  prompt: string
  contextConfig: AIColumnContextConfig
}

export const AI_COLUMN_TEMPLATES: AIColumnTemplate[] = [
  {
    id: 'tpl-earnings',
    name: 'Latest earnings summary',
    description: 'Key takeaways from the most recent quarterly report',
    icon: 'file-text',
    prompt: 'Summarize the most recent quarterly earnings for this company in 3 tight bullets: (1) top-line & EPS result vs. consensus, (2) most consequential metric or segment, (3) any notable guidance change. Keep to ~60 words.',
    contextConfig: { includeThesis: true, includeContributions: false, includeNotes: false, includePriceTargets: false }
  },
  {
    id: 'tpl-moat',
    name: 'Competitive moat',
    description: 'What protects the business from competitors',
    icon: 'scale',
    prompt: 'Describe this company\'s competitive moat in 2 sentences. Name the specific source (switching cost, network effect, scale, IP, brand, regulation) and state how durable it is. Avoid generic phrasing.',
    contextConfig: { includeThesis: true, includeContributions: true, includeNotes: false, includePriceTargets: false }
  },
  {
    id: 'tpl-catalyst',
    name: 'Near-term catalyst',
    description: 'Events in the next 1–2 quarters that could move the stock',
    icon: 'zap',
    prompt: 'What is the single most consequential near-term catalyst (0–2 quarters) for this company? Name the event, the approximate date/window, and the direction it would push the stock if it breaks positive. One tight sentence.',
    contextConfig: { includeThesis: true, includeContributions: true, includeNotes: true, includePriceTargets: false }
  },
  {
    id: 'tpl-bull-bear',
    name: 'Bull / bear in one line each',
    description: 'Sharpest argument on each side',
    icon: 'git-branch',
    prompt: 'Give the single strongest bull case and the single strongest bear case for this stock right now, one sentence each. Format exactly as:\n\nBULL: ...\nBEAR: ...\n\nBe specific and avoid generic platitudes.',
    contextConfig: { includeThesis: true, includeContributions: true, includeNotes: false, includePriceTargets: false }
  },
  {
    id: 'tpl-valuation',
    name: 'Valuation snapshot',
    description: 'Current multiples vs. history and peers',
    icon: 'scale',
    prompt: 'Give a one-line valuation snapshot: current NTM P/E (or EV/EBITDA if more relevant), 5-year average for the same multiple, and whether the stock is trading at a premium, in line, or at a discount. Example format: "18x NTM P/E vs. 22x 5-yr avg — discount."',
    contextConfig: { includeThesis: false, includeContributions: false, includeNotes: false, includePriceTargets: true }
  },
  {
    id: 'tpl-news',
    name: 'Recent news',
    description: 'Material news from the last 30 days',
    icon: 'file-text',
    prompt: 'What is the most material news story about this company from the last 30 days? Give the headline and one sentence on why it matters. If nothing material, say "No material news."',
    contextConfig: { includeThesis: false, includeContributions: false, includeNotes: false, includePriceTargets: false }
  },
  {
    id: 'tpl-competitors',
    name: 'Top 3 competitors',
    description: 'Who the company competes with most directly',
    icon: 'git-branch',
    prompt: 'List the top 3 most direct competitors, ticker first, then a 3–5 word description of what they compete on. Format:\n\n- TICK — battleground\n- TICK — battleground\n- TICK — battleground',
    contextConfig: { includeThesis: false, includeContributions: false, includeNotes: false, includePriceTargets: false }
  },
  {
    id: 'tpl-thesis-check',
    name: 'Thesis pressure test',
    description: 'Challenge the current thesis',
    icon: 'sparkles',
    prompt: 'Read my thesis on this asset and push back on it. Name the single weakest assumption and explain in one sentence why it might be wrong. Be direct — this is a pressure test, not validation.',
    contextConfig: { includeThesis: true, includeContributions: true, includeNotes: true, includePriceTargets: true }
  }
]
