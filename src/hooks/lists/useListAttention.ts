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

/**
 * One security that wants a person, as a named investment object.
 *
 * Lists home used to state attention as counts — "2 awaiting decision" — which
 * tells a reader that a universe is loud without telling them what is loud in
 * it, so the only way to act was to open the list and look. These carry the
 * security, the reason in the product's own words, and where to go.
 *
 * Every field is already in memory. `useIdeaScan` rows carry symbol, company,
 * direction, stage, book and date; `ResearchSubject` carries symbol, company,
 * the unreviewed count and the review clock. Nothing here reads anything.
 */
export interface ListAttentionItem {
  assetId: string
  symbol: string | null
  companyName: string | null
  /** Decision outranks unanswered research, which outranks a review clock. */
  tier: 'decision' | 'research' | 'review'
  /** The headline — "BUY · Recommendation ready", "1 new research". */
  reason: string
  /** The quiet second half — the book and an age, where we have them. */
  meta: string | null
  /**
   * The collapsed column this security should open on.
   *
   * Lists home does not know about table columns, but the inspector's mode is
   * chosen by the clicked field (`MODE_FOR_COLUMN`), so the entry point is
   * expressed the same way a click would express it. A decision opens Work; new
   * research and an overdue review both open Case, which is what they are
   * reviewed against.
   */
  entryColumnId: 'list_work' | 'list_view'
}

const TIER_RANK: Record<ListAttentionItem['tier'], number> = {
  decision: 3, research: 2, review: 1,
}

/** Short, absolute-free ages. A universe panel has room for "4d", not a date. */
function ageOf(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.now() - Date.parse(iso)
  if (!Number.isFinite(ms) || ms < 0) return null
  const d = Math.floor(ms / 86_400_000)
  if (d < 1) return 'today'
  if (d < 7) return `${d}d`
  if (d < 31) return `${Math.floor(d / 7)}w`
  if (d < 365) return `${Math.floor(d / 30)}mo`
  return `${Math.floor(d / 365)}y`
}

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
  /**
   * The securities behind `needsAttention`, loudest first.
   *
   * Ranked decision → research → review, then by how long it has waited, so the
   * first two or three a panel can show are the two or three that matter.
   */
  items: ListAttentionItem[]
}

const EMPTY: ListAttention = {
  newResearch: 0, newResearchNotes: 0, reviewDue: 0,
  noCase: 0, activeIdeas: 0, awaitingDecision: 0, needsAttention: 0,
  items: [],
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

  /**
   * The idea that speaks for a name — furthest through the lifecycle wins.
   *
   * Same rule `useListRowSignals` applies to the Work column, so a security
   * reported as awaiting a decision on this page reads the same way inside the
   * list it belongs to.
   */
  const ideaByAsset = useMemo(() => {
    const m = new Map<string, (typeof ideas extends (infer T)[] ? T : never)>()
    for (const i of ideas ?? []) {
      if (!i.assetId) continue
      const held = m.get(i.assetId)
      const rank = (s: string | null | undefined) => (s === FINAL_STAGE ? 2 : 1)
      if (!held || rank(i.stage) > rank(held.stage)) m.set(i.assetId, i)
    }
    return m
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
      const items: ListAttentionItem[] = []

      // A name can sit on a list twice only if the list itself is malformed;
      // dedupe anyway so a count never exceeds the list's length.
      for (const assetId of new Set(list.assetIds ?? [])) {
        if (ideaCountByAsset.has(assetId)) activeIdeas += 1
        const subject = subjectByAsset.get(assetId)
        const idea = ideaByAsset.get(assetId)

        /*
         * A decision owed outranks everything, and claims the name.
         *
         * A security whose recommendation is waiting on a person may ALSO have
         * unreviewed research, but listing it twice would say the universe has
         * more outstanding than it does — and the decision is the thing to act
         * on. Same precedence `workStateFor` applies inside the list.
         */
        if (awaitingByAsset.has(assetId)) {
          awaitingDecision += 1
          const dir = (idea?.direction ?? '').toUpperCase()
          items.push({
            assetId,
            symbol: idea?.symbol ?? subject?.symbol ?? null,
            companyName: idea?.companyName ?? subject?.companyName ?? null,
            tier: 'decision',
            reason: dir ? `${dir} · Recommendation ready` : 'Recommendation ready',
            meta: [idea?.portfolioName, ageOf(idea?.createdAt)].filter(Boolean).join(' · ') || null,
            entryColumnId: 'list_work',
          })
          continue
        }

        if (!subject) continue
        switch (stateOf(subject)) {
          case 'evidence-since-review': {
            newResearch += 1
            const n = subject.newSinceReview ?? 0
            newResearchNotes += n
            items.push({
              assetId,
              symbol: subject.symbol,
              companyName: subject.companyName,
              tier: 'research',
              reason: `${n} new research`,
              meta: ['since last review', ageOf(subject.lastReviewedAt ?? subject.thesisUpdatedAt)]
                .filter(Boolean).join(' · ') || null,
              entryColumnId: 'list_view',
            })
            break
          }
          case 'stale': {
            reviewDue += 1
            items.push({
              assetId,
              symbol: subject.symbol,
              companyName: subject.companyName,
              tier: 'review',
              reason: 'Review due',
              meta: subject.thesisUpdatedAt
                ? `case written ${ageOf(subject.thesisUpdatedAt)} ago`
                : null,
              entryColumnId: 'list_view',
            })
            break
          }
          case 'no-thesis':
            // A gap in coverage, not something that changed. Counted, but it
            // does not take one of the panel's three attention rows.
            noCase += 1
            break
          default:
            break
        }
      }

      items.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier])

      byList.set(list.id, {
        newResearch, newResearchNotes, reviewDue, noCase, activeIdeas,
        awaitingDecision,
        needsAttention: awaitingDecision + newResearch + reviewDue,
        items,
      })
    }
    return {
      /** Never null — a list not in the fold reads as "nothing known". */
      attentionFor: (listId?: string | null) => (listId && byList.get(listId)) || EMPTY,
    }
  }, [lists, subjectByAsset, ideaCountByAsset, awaitingByAsset, ideaByAsset])
}
