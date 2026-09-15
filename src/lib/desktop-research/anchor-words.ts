/**
 * What a Research date is, and the words it has earned.
 *
 * Research used to call every date "review". None of the scan's are: there is
 * no reviewed_at on asset_contributions, and the scan's clock is the newest
 * save of a core section -- an edit. Only a generated coverage subject can
 * carry a recorded review, and only when the shared rule anchored on one.
 *
 *   subject            number                               date kind
 *   scan               age, new-since count, thesis date    updated  (newest core-section save)
 *   generated          age, new-since count, move           reviewed | written  (the case's anchor)
 *   generated          thesis date (detail chart, timeline) written  (caseWrittenAt)
 *
 * The same words are used on tiles, rails, the detail pane, the chart and the
 * Ask AI context, so the reader and the AI never see one date named two ways.
 * Wording only: no date, count or calculation is chosen here.
 */
import type { ResearchSubject } from './model'

export type ResearchDateKind = 'reviewed' | 'written' | 'updated'

export interface ResearchDateWords {
  /** "120d since update" */
  since: string
  /** Stat / chip label: "Last updated" */
  last: string
  /** Past participle: "Thesis last updated 120 days ago" */
  verb: string
  /** "since the thesis was last updated" */
  sinceThe: string
  /** Two-line figure label under a big number. */
  sinceTheLines: [string, string]
  /** Chart caption: "Price since the last update" */
  priceSince: string
  /** "History does not reach {the}" */
  the: string
  /** The dashed tick on a drawn window. */
  tick: string
  /** "New since update" */
  newSince: string
  /** Timeline start label: "Case updated" */
  start: string
}

const WORDS: Record<ResearchDateKind, ResearchDateWords> = {
  reviewed: {
    since: 'since review',
    last: 'Last review',
    verb: 'reviewed',
    sinceThe: 'since the thesis was last reviewed',
    sinceTheLines: ['since the thesis', 'was last reviewed'],
    priceSince: 'Price since the last review',
    the: 'the review date',
    tick: 'LAST REVIEW',
    newSince: 'New since review',
    start: 'Case reviewed',
  },
  written: {
    since: 'since written',
    last: 'Last written',
    verb: 'written',
    sinceThe: 'since the thesis was written',
    sinceTheLines: ['since the thesis', 'was written'],
    priceSince: 'Price since the thesis was written',
    the: 'the date it was written',
    tick: 'WRITTEN',
    newSince: 'New since written',
    start: 'Case written',
  },
  updated: {
    since: 'since update',
    last: 'Last updated',
    verb: 'updated',
    sinceThe: 'since the thesis was last updated',
    sinceTheLines: ['since the thesis', 'was last updated'],
    priceSince: 'Price since the last update',
    the: 'the update date',
    tick: 'LAST UPDATE',
    newSince: 'New since update',
    start: 'Case updated',
  },
}

export const dateWords = (kind: ResearchDateKind): ResearchDateWords => WORDS[kind]

/**
 * The date a subject's age, new-since count and price move count from.
 *
 * A generated subject's anchor is a recorded review only when the shared rule
 * says so; otherwise the case being written. A scan subject's is its newest
 * core-section save.
 */
export function ageKindOf(s: ResearchSubject): ResearchDateKind {
  if (s.generated) return s.generated.anchoredOn === 'reviewed' ? 'reviewed' : 'written'
  return 'updated'
}

/** The date `thesisUpdatedAt` is: what the detail chart and the tile timeline start from. */
export function thesisDateKindOf(s: ResearchSubject): ResearchDateKind {
  return s.generated ? 'written' : 'updated'
}
