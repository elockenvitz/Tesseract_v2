/**
 * Per-list attention, with no new reads.
 *
 * Lists home has to answer "which collection needs my attention?", which means
 * every card needs counts across its own names. The naive way is a query per
 * list; this needs none at all, because all three inputs are already in memory
 * on that page:
 *
 *   • `useListSurfaces` nests `asset_list_items(asset_id)` in its one lists
 *     read, so `list.assetIds` is already the membership for every visible
 *     list — the join key, free.
 *   • `useResearchScan` is org-wide and cached 60s. Shared with the Research
 *     surface and with the open List's own row signals, so on a warm cache this
 *     is a map lookup.
 *   • `useIdeaScan` is org-wide and cached 60s, and carries `assetId` on every
 *     row.
 *
 * So this is a fold, not a fetch. That matters beyond tidiness: a per-list
 * query would have been N requests on a page whose whole job is to be scanned.
 *
 * RLS posture: unchanged. No new query — both scans are existing org-scoped
 * reads with their own policies, and the membership arrays come from the lists
 * read the page already performs.
 */
import { useMemo } from 'react'
import { useResearchScan } from '../useDesktopResearch'
import { useIdeaScan } from '../useDesktopIdeas'
import { stateOf, type ResearchSubject } from '../../lib/desktop-research/model'
import { FINAL_STAGE } from '../../lib/ideas/stage-model'

export interface ListAttention {
  /** Names carrying research the written case has not answered. */
  newResearch: number
  /** Total unreviewed notes across those names. */
  newResearchNotes: number
  /** Names whose case is past the review clock. */
  reviewDue: number
  /** Names with nothing written to review against. */
  noCase: number
  /** Names with a live, non-terminal idea. */
  activeIdeas: number
  /**
   * Names whose idea has reached the final stage — somebody owes a decision.
   *
   * The loudest thing a list can contain, and a subset of `activeIdeas`: an idea
   * at `ready_to_recommend` is waiting on a person, where an earlier-stage one
   * is work in hand. Folded from `stage` on the same scan rows, so it costs no
   * read.
   */
  awaitingDecision: number
  /**
   * What a person should look at: a decision owed, unanswered research, or an
   * overdue review.
   *
   * Deliberately NOT including `noCase` or the rest of `activeIdeas`. An
   * unwritten case is a gap in coverage rather than something that changed, and
   * an early-stage idea is work already in hand — folding either in would make
   * every list look equally loud, which is the failure this is meant to fix.
   */
  needsAttention: number
}

const EMPTY: ListAttention = {
  newResearch: 0, newResearchNotes: 0, reviewDue: 0,
  noCase: 0, activeIdeas: 0, awaitingDecision: 0, needsAttention: 0,
}

export interface ListMembership {
  id: string
  assetIds: string[]
}

export function useListAttention(lists: ListMembership[]) {
  const { subjects } = useResearchScan()
  const { ideas } = useIdeaScan()

  const subjectByAsset = useMemo(() => {
    const m = new Map<string, ResearchSubject>()
    for (const s of subjects ?? []) m.set(s.assetId, s)
    return m
  }, [subjects])

  const ideaCountByAsset = useMemo(() => {
    const m = new Map<string, number>()
    for (const i of ideas ?? []) {
      if (!i.assetId) continue
      m.set(i.assetId, (m.get(i.assetId) ?? 0) + 1)
    }
    return m
  }, [ideas])

  /** Names carrying an idea that has reached the final stage. */
  const awaitingByAsset = useMemo(() => {
    const s = new Set<string>()
    for (const i of ideas ?? []) {
      if (i.assetId && i.stage === FINAL_STAGE) s.add(i.assetId)
    }
    return s
  }, [ideas])

  return useMemo(() => {
    const byList = new Map<string, ListAttention>()
    for (const list of lists) {
      let newResearch = 0
      let newResearchNotes = 0
      let reviewDue = 0
      let noCase = 0
      let activeIdeas = 0
      let awaitingDecision = 0

      // A name can sit on a list twice only if the list itself is malformed;
      // dedupe anyway so a count never exceeds the list's length.
      for (const assetId of new Set(list.assetIds ?? [])) {
        if (ideaCountByAsset.has(assetId)) activeIdeas += 1
        if (awaitingByAsset.has(assetId)) awaitingDecision += 1
        const subject = subjectByAsset.get(assetId)
        if (!subject) continue
        switch (stateOf(subject)) {
          case 'evidence-since-review':
            newResearch += 1
            newResearchNotes += subject.newSinceReview ?? 0
            break
          case 'stale':
            reviewDue += 1
            break
          case 'no-thesis':
            noCase += 1
            break
          default:
            break
        }
      }

      byList.set(list.id, {
        newResearch, newResearchNotes, reviewDue, noCase, activeIdeas,
        awaitingDecision,
        needsAttention: awaitingDecision + newResearch + reviewDue,
      })
    }
    return {
      /** Never null — a list not in the fold reads as "nothing known". */
      attentionFor: (listId?: string | null) => (listId && byList.get(listId)) || EMPTY,
    }
  }, [lists, subjectByAsset, ideaCountByAsset, awaitingByAsset])
}
