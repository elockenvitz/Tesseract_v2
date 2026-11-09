/**
 * What a requirement is asking, and which facts bear on it.
 *
 * ── Why this is a lookup table and not a prompt ─────────────────────────
 *
 * The Work surface needs to say two things beside a requirement: what the
 * analyst is trying to establish, and which of the asset's recorded facts
 * are relevant to establishing it. Both are easy to generate and expensive
 * to be wrong about — a plausible sentence under a heading reads as the
 * firm's own guidance, and nothing on the surface would tell a reader it
 * was invented. CLAUDE.md's provenance rule applies to prose as much as to
 * figures.
 *
 * So the objective is QUOTED from the Process definition — the stage
 * description the organization wrote — and the questions come from a fixed
 * table keyed on words that actually appear in the requirement. Nothing
 * here composes a new claim about the investment. A requirement that
 * matches no topic gets no questions rather than generic ones; an empty
 * section is honest and a filled one would not be.
 *
 * The facets decide which evidence cells lead, not which exist. A reader
 * checking performance sees price first; the position is still there.
 */

/** A fact the Work surface can show, each with its own provenance. */
export type EvidenceFacet = 'price' | 'position' | 'target' | 'case' | 'ideas'

/** The horizons the performance panel offers. */
export type PeriodKey = 'YTD' | '1M' | '3M'

export interface RequirementGuidance {
  /**
   * The stage description, verbatim, when the Process defines one. Null
   * when it does not — this surface does not write an objective the
   * organization did not.
   */
  objective: string | null
  /** The topic the wording matched, for the "derived from" line. Null when none did. */
  topic: string | null
  /** Questions from the matched topic. Empty when nothing matched. */
  questions: string[]
  /** Evidence to lead with, most relevant first. Never empty. */
  facets: EvidenceFacet[]
  /**
   * The horizon the requirement NAMES, when it names one.
   *
   * "Check YTD performance" opening on a 400-day return was the defect
   * this answers: the window was honestly stamped and still not the one
   * asked for. Null when the requirement names no period and none is
   * implied, which is every requirement whose subject is not performance.
   */
  defaultPeriod: PeriodKey | null
}

interface Topic {
  label: string
  /** Matched against the lower-cased requirement text, word-boundary aware. */
  match: RegExp
  questions: string[]
  facets: EvidenceFacet[]
}

/*
 * Ordered: the first match wins, so the more specific topics come first.
 * "check ytd performance" must read as performance, not as a generic check.
 */
const TOPICS: Topic[] = [
  {
    label: 'Performance',
    match: /\b(performance|ytd|return|returns|price action|momentum|moved|move|drawdown|rally|underperform|outperform)\b/,
    /*
     * These were "How large is the move, and over what window?", which the
     * panel beside them now answers outright, and "Is it the company, the
     * sector, or the market?", which NOTHING on this surface can answer —
     * no benchmark series is held, so the question sent the reader away
     * with no way back. A question whose evidence is absent is worse than
     * no question: it implies the surface could settle it.
     *
     * What is left is answerable from what is on screen: the series, the
     * official target, the book weight and the written case.
     */
    questions: [
      'Did the move arrive in a few sessions, or accumulate across the period?',
      'Does the price now sit through the official target, or further from it?',
      'Is the book weight still the one the case argues for at this price?',
      'Which claim in the written case does this move test?',
    ],
    facets: ['price', 'position', 'target', 'case'],
  },
  {
    label: 'Position and sizing',
    match: /\b(position|sizing|size|weight|exposure|trim|add|book|allocation)\b/,
    questions: [
      'What is the position now, and in which book?',
      'Is the current weight still the one the thesis argues for?',
      'What would have to be true to change it?',
    ],
    facets: ['position', 'price', 'ideas', 'target'],
  },
  {
    label: 'Valuation and target',
    match: /\b(valuation|target|upside|downside|multiple|model|fair value|dcf)\b/,
    questions: [
      'What does the official target imply from here?',
      'Which assumption is doing the most work?',
      'What would move the target rather than the price?',
    ],
    facets: ['target', 'price', 'case', 'position'],
  },
  {
    label: 'Thesis',
    match: /\b(thesis|case|view|differ|consensus|conviction|variant)\b/,
    questions: [
      'What does the written case claim, and when was it last written?',
      'Which part of it is now testable?',
      'Where does the firm differ from consensus, and is that still true?',
    ],
    facets: ['case', 'target', 'price', 'position'],
  },
  {
    label: 'Catalysts and events',
    match: /\b(catalyst|event|earnings|print|guidance|filing|13f|investor day|conference)\b/,
    questions: [
      'What is the next dated event, and what does it decide?',
      'What outcome is already in the price?',
      'What would make this a reason to act rather than to note?',
    ],
    facets: ['case', 'price', 'ideas', 'target'],
  },
  {
    label: 'Developments',
    match: /\b(news|developments|read|summar|headline|update|report)\b/,
    questions: [
      'What is genuinely new since the case was last written?',
      'Does any of it bear on a thesis pillar, or is it noise?',
    ],
    facets: ['case', 'price', 'ideas'],
  },
]

/** Everything a reader might want, in a defensible default order. */
const DEFAULT_FACETS: EvidenceFacet[] = ['position', 'price', 'case', 'target']

export interface GuidanceInput {
  /** The requirement's own text. */
  text: string | null | undefined
  /** The stage description from the Process definition, if it has one. */
  stageDescription?: string | null
}

/**
 * The horizon a requirement names, read from its own words.
 *
 * Only an explicit naming counts. "Check performance" names no period, and
 * guessing one for it would put a figure under a heading the reader never
 * asked for — the YTD default below is applied by the performance topic,
 * where year-to-date is the conventional reading, and nowhere else.
 */
function periodNamedIn(haystack: string): PeriodKey | null {
  if (/\b(ytd|year[- ]to[- ]date|this year|calendar year)\b/.test(haystack)) return 'YTD'
  if (/\b(3m|three[- ]month|quarter|quarterly|last quarter)\b/.test(haystack)) return '3M'
  if (/\b(1m|one[- ]month|past month|last month|monthly)\b/.test(haystack)) return '1M'
  return null
}

export function guidanceFor({ text, stageDescription }: GuidanceInput): RequirementGuidance {
  const objective = stageDescription?.trim() ? stageDescription.trim() : null
  const haystack = (text ?? '').toLowerCase()
  const topic = haystack ? TOPICS.find(t => t.match.test(haystack)) : undefined
  const named = haystack ? periodNamedIn(haystack) : null

  return {
    objective,
    topic: topic?.label ?? null,
    questions: topic ? [...topic.questions] : [],
    facets: topic ? [...topic.facets] : [...DEFAULT_FACETS],
    /* A performance requirement that names no period opens on YTD, the
       conventional reading; any other requirement opens on what it named,
       or on nothing. */
    defaultPeriod: named ?? (topic?.label === 'Performance' ? 'YTD' : null),
  }
}

/*
 * There was a `wantsDeepHistory` here, which asked for the long price
 * window only where price led the facets. It is gone deliberately. In the
 * app it made the SAME asset report a last close under one requirement and
 * "no price history" under the next, because the shallow window is twelve
 * calendar days and the newest close held was twenty-two days old. The
 * evidence panel now asks for one window for every requirement; see the
 * note in RequirementWorkspace.
 */
