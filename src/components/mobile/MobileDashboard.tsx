import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lightbulb, SlidersHorizontal, X } from 'lucide-react'
import { ReadthroughSheet } from './ReadthroughSheet'
import { useIdeasFeed } from '../../hooks/ideas/useIdeasFeed'
import type { ScoredFeedItem, ItemType } from '../../hooks/ideas/types'
import type { ReadthroughSourceType } from '../../lib/mobile/readthrough-service'
import { markSeen, rotateBySeen } from '../../lib/mobile/feed-rotation'
import { useAuth } from '../../hooks/useAuth'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { useAttention } from '../../hooks/useAttention'
import { attentionTarget } from '../../lib/mobile/attention-navigation'
import { interleaveByKind } from '../../lib/mobile/feed-interleave'
import { clearFeedSession, loadFeedSession, saveFeedSession } from '../../lib/mobile/feed-session'
import { useFeedSessionStability } from '../../hooks/mobile/useFeedSessionStability'
import { useReaderSnapshots } from '../../hooks/mobile/useReaderSnapshots'
import { usePullToRefresh } from '../../hooks/mobile/usePullToRefresh'
import { PullToRefreshIndicator } from './PullToRefreshIndicator'
import { useSignalCards } from '../../hooks/ideas/useSignalCards'
import { usePortfolioLenses } from '../../hooks/mobile/usePortfolioLenses'
import { FeedFilterSheet } from './FeedFilterSheet'
import { FeedSlot } from './FeedSlot'
import { isFlagOn } from '../../lib/flags'
import { FullscreenChart } from '../signals/FullscreenChart'
import { TileSparkline } from './TileSparkline'
import { parseNumericEntry } from '../../lib/mobile/exploration'
import { insightSignalType } from '../../hooks/mobile/useDerivedInsights'
import { MobileCaseView } from './asset/MobileCaseView'
import { writeJudgmentThought } from '../../lib/signals/judgment-thought'
import { PricePane } from '../signals/PricePane'
import { findExploreMatch } from '../../lib/mobile/explore-match'
import { priceIdentity } from '../../lib/signals/price-availability'
import { newsChartSymbol, newsChartSymbols } from '../../lib/signals/news-chart'
import { feedEntryKeys, symbolOfEntry } from '../../lib/mobile/feed-entry-key'
import { EMPTY_FILTER, filterCount, useFeedFacets, type FeedFilter } from '../../hooks/mobile/useFeedFacets'
import { ArticleReader } from './ArticleReader'
import { resolveExploreItem } from '../../lib/mobile/explore-resolve'
import { KIND_LABEL } from '../signals/card-identity'
import { CATEGORY_LABEL, categoryOf, signalTypeOf, type FeedCategory } from '../../lib/mobile/feed-categories'
import { clsx } from 'clsx'
import { logPilotEvent } from '../../lib/pilot/pilot-telemetry'
import { MobileExplore } from './MobileExplore'
import { ExploreExpansion, measureTile, type ExpansionOrigin } from './ExploreExpansion'
import { ExploreDetail } from './ExploreDetail'
import { exploreSparkPlan } from '../../lib/mobile/explore-spark'
import { TesseractLoader } from '../ui/TesseractLoader'
import { LOADER_ANCHOR } from '../ui/PageLoader'
import { BottomSheet } from './BottomSheet'
import { MobileCaseTargets } from './asset/MobileCaseTargets'
import { LadderPane } from '../signals/LadderPane'
import {
  aggregatesFor, attentionToExplore, ideasToExplore, insightsToExplore,
  ideaSignalType,
  lensesToExplore, newsToExplore, scenarioCardsToExplore, templatesToExplore,
} from '../../lib/mobile/explore-adapters'
import type { ExploreItem } from '../../lib/mobile/explore-item'
import { ScenarioLadderPane } from '../signals/ScenarioLadderPane'
import { ScenarioGapPanes } from '../signals/ScenarioGapPanes'
import { scenarioReviewOptions } from '../../lib/signals/scenario-review'
import { deriveScenarioState } from '../../lib/signals/scenario-state'
import { ScenarioCaseDetail } from '../signals/ScenarioCaseDetail'
import { useScenarioCards } from '../../hooks/mobile/useScenarioCards'
import {
  buildTemplateCard, buildInsightCard, buildConvictionCard,
  buildCrowdingCard, buildTargetHitCard, buildStaleTargetCard, buildNoTargetCard, buildIdeasSignalCard,
  buildAttentionCard,
} from '../../lib/signals/builders/legacy-kinds'
import { recordTriage, type TriageAction } from '../../lib/signals/feed-triage'
import { SignalCardSection } from './SignalCardSection'
import { FirstSessionCoveragePrompt } from '../coverage/FirstSessionCoveragePrompt'
import { buildActiveRiskCard, selectActiveRisk, type ActiveRiskInput } from '../../lib/signals/builders/activeRisk'
import { SizeExplorer } from '../signals/SizeExplorer'
import { ActiveWeightPeers } from '../signals/ActiveWeightPeers'
import { type PriceBand, type PriceMarker, type PricePoint } from '../signals/PriceContext'
import { TargetExplorer } from '../signals/TargetExplorer'
import { TargetExpiredCard } from './TargetExpiredCard'
import { targetReviewOptions } from '../../lib/signals/target-review'
import { VerdictBar, type VerdictOption } from '../signals/VerdictBar'
import {
  // `isDisposedOf` is deliberately NOT imported. It is a second suppression
  // rule over the same store as `judgment-policy`, with a different window, and
  // the feed applying both is what produced blank slots. See `renderCard`.
  DISPOSITION_DAYS, loadDispositions, recordDisposition,
  type DispositionMap,
} from '../../lib/signals/dispositions'
import { recordSignalJudgment } from '../../lib/signals/judgment-log'
import { recordFeedFeedback } from '../../lib/signals/feed-feedback-log'
import type { FeedFeedbackOption } from '../../lib/signals/feed-feedback'
import { claimedSubjects, suppressCoveredInsights } from '../../lib/signals/feed-dedupe'
import { LEAD_TIER, diversify, rankFeed, type PriorityInput } from '../../lib/signals/feed-priority'
import { coverageRelevanceFor, coverageSignature } from '../../lib/signals/coverage-relevance'
import { useCoverageIndex } from '../../contexts/CoverageRelevanceContext'
import type { JudgmentRecord } from '../../lib/signals/judgment-policy'
import type { SignalType } from '../../lib/signals/contract'
import { signalTypeForTemplate } from '../../lib/signals/builders/legacy-kinds'
import { DAY_MS } from '../../lib/signals/thresholds'
import { resolveFeedAction, type FeedActionKey } from '../../lib/signals/feed-actions'
import { ResearchStarter } from '../signals/ResearchStarter'
import { CaseChartPane } from '../signals/CaseChartPane'
import { buildIdeaCard, ideaCardId, ideaCardType } from '../../lib/signals/builders/ideas'
import type { RecommendationInput } from '../../lib/signals/builders/recommendation'
import { latestBenchmarkRows } from '../../lib/holdings/latest-benchmark'
import { WeightBars } from '../signals/WeightBars'
import { buildNewsCard } from '../../lib/signals/builders/news'
import { useRecommendationCards } from '../../hooks/mobile/useRecommendationCards'
import type { SignalCard } from '../../lib/signals/contract'
import { useMarketNews } from '../../hooks/useMarketNews'
import { useMarketEvents } from '../../hooks/useMarketEvents'
import { useMarketData } from '../../hooks/useMarketData'
import {
  unusualMovers, outsizedActiveRisk, earningsAhead, earningsResult,
  corporateActions, economicReleases,
} from '../../lib/mobile/feed-templates'
import { useDerivedInsights } from '../../hooks/mobile/useDerivedInsights'
import { ShareToUserModal } from '../feed/ShareToUserModal'
import { FeedCaptureSheet } from './FeedCaptureSheet'
import { PromoteToTradeIdeaModal } from '../ideas/PromoteToTradeIdeaModal'
import { PromptModal } from '../thoughts/PromptModal'
import { useFeedDwell } from '../../hooks/mobile/useFeedDwell'
import { interestScore, recordInterest } from '../../lib/mobile/feed-telemetry'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { SCENARIO_CARDS_KEY } from '../../lib/signals/scenario-cards-key'

/**
 * Retired: the banner and the Curate sheet now read `CATEGORY_LABEL`.
 *
 * This was a map of INTERNAL entry kinds — attention, lens, template — shown to
 * readers as filter labels. See lib/mobile/feed-categories for why that could
 * not hold.
 */

interface MobileDashboardProps {
  onNavigate?: (result: any) => void
}

// `onShare` and `onCreateIdea` were removed with `ReelsFeedItem`: they existed
// only to feed that component's own header buttons. Sharing still works — it
// routes through the card menu into ShareToUserModal — and neither prop was
// ever passed by DashboardPage.

/**
 * The phone dashboard: a full-screen, one-post-per-screen ideas feed.
 *
 * This replaces the desktop analytics dashboard on mobile rather than trying
 * to reflow it. The desktop surface is a wide multi-column workbench; squeezed
 * onto 390px it produces cramped cards and horizontal overflow no amount of
 * breakpointing fixes. A feed is the mobile-native shape, and it matches how
 * the app is actually used on a phone — reading and reacting, not authoring.
 *
 * Paging uses CSS scroll-snap rather than manual touch handling: it inherits
 * native momentum, rubber-banding and accessibility behaviour, and cannot
 * desynchronise from the scroll position the way an index-tracking
 * implementation does.
 */


export function MobileDashboard({ onNavigate }: MobileDashboardProps) {
  const { user } = useAuth()
  // Required by `audit_events`. Optional context so the feed still renders for
  // a user who has not resolved an org yet; without it the judgment is local
  // only, which `recordSignalJudgment` reports as `skipped` rather than failed.
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null
  const userId = user?.id

  /**
   * The working set is composed ONCE per visit and then held.
   *
   * `useFeedRefreshOnReturn` used to live here and refetched every stale feed
   * source when the tab came back. It was the wrong product: a reader working
   * down the feed who answers a message and returns wants the card they left,
   * not a re-ranked list. Freshness on this surface is a property of the FIRST
   * composition, not of a refresh cycle. `useFeedSessionStability` below pins
   * the sources instead; a deliberate refresh, a filter change, a reload and a
   * write still recompose.
   */
  useFeedSessionStability()

  const queryClient = useQueryClient()
  const { items, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, refetch } =
    useIdeasFeed({ mode: 'for_you' })

  // Re-rank on every open. staleTime keeps the network quiet within 30s, but
  // the point here is that returning to the feed reflects what changed.
  useEffect(() => { refetch() }, [refetch])

  const { sections, acknowledge, snoozeFor, markRead, refetch: refetchAttention, isLoading: attentionLoading } = useAttention()

  const attentionItems = useMemo(() => {
    // All four types, not just decisions and actions. The feed is meant to be
    // endless and to keep pointing the user at something to do; restricting it
    // to the two most urgent buckets left long stretches with nothing to act
    // on. Priority still orders them, so decisions surface first.
    const byPriority = [
      ...(sections?.decision_required ?? []),
      ...(sections?.action_required ?? []),
      ...(sections?.alignment ?? []),
      ...(sections?.informational ?? []),
    ]
    return byPriority.filter(a => a.status !== 'resolved' && a.status !== 'dismissed')
  }, [sections])

  // Genuinely derived signals — stale coverage, conflicting team sentiment,
  // catalyst proximity. These are the real "what should I be thinking about"
  // cards; the `prompt` type is excluded because those are canned questions
  // with no finding behind them, which is precisely the filler complained of.
  const { data: derivedInsights = [], isLoading: insightsLoading } = useDerivedInsights()

  // Portfolio lenses: questions about the book that no other screen asks.
  // Deliberately part of the feed rather than a separate destination — the
  // whole point is that nobody goes looking for "is this position the right
  // size", so it has to arrive unprompted.
  const { data: lenses, isLoading: lensesLoading } = usePortfolioLenses()
  const { signals, isLoading: signalsLoading } = useSignalCards()
  /**
   * The signal types that still earn a screen, filtered BEFORE a slot exists.
   *
   * ── Why the filter is here as well as in the builder ──────────────────────
   *
   * `buildIdeasSignalCard` suppresses both of these, and a suppression there is
   * the authoritative decision — it is logged with a reason and it holds for
   * every caller. But `FeedSlot` mounts a slot per ENTRY, and `renderCard`
   * returns null for a suppressed result, so a suppressed entry that reaches
   * the pool becomes a blank screen in a snap feed with no way to tell it from
   * a card that failed to render. That is the exact defect `renderCard`'s own
   * header describes.
   *
   * So the builder decides and this keeps the decision out of the layout.
   * `stale_coverage` joins `prompt`: it is the superseded silence-alone rule,
   * it duplicates `useDerivedInsights`, and it dates itself to the moment the
   * feed opened — see the builder for the whole argument.
   */
  const realSignals = useMemo(
    () => (signals ?? []).filter(
      sig => sig.signalType !== 'prompt' && sig.signalType !== 'stale_coverage',
    ),
    [signals]
  )

  const [shareItem, setShareItem] = useState<ScoredFeedItem | null>(null)
  const [promoteItem, setPromoteItem] = useState<ScoredFeedItem | null>(null)
  const [askItem, setAskItem] = useState<ScoredFeedItem | null>(null)
  /**
   * Asset the reader was looking at when they tapped Capture, so a thought
   * logged from the feed arrives already attached to its subject.
   *
   * `kind` and `note` are set only by controls that have already made the
   * choice for the reader — today just the active-risk what-if slider, which
   * arrives with a specific proposed weight and would lose it to a menu.
   */
  /**
   * The thought the last applied judgment wrote, so it can be shared.
   *
   * Held at the feed rather than on the card: the card that produced it may
   * have scrolled out of the window by the time the reader decides to send it,
   * and a windowed slot unmounting must not take the offer with it.
   */
  /** The asset whose thesis is open for editing, or nothing. */
  const [thesisSheet, setThesisSheet] = useState<{ assetId: string; symbol: string } | null>(null)

  /** The name whose ladder is gaining a case, or nothing. */
  const [newCaseSheet, setNewCaseSheet] = useState<
    /**
     * `seedName` prefills the case name.
     *
     * Set when the drawer is opened from a named rung on the ladder builder —
     * the reader has already said "Bull", and making them type it again in the
     * sheet that opened from the Bull row is the kind of repetition that made
     * the old control unusable. Absent for a free "+ Add a case".
     */
    { assetId: string; symbol: string; seedPrice: number | null; seedName?: string } | null
  >(null)
  const [newCaseName, setNewCaseName] = useState('')
  const [newCasePrice, setNewCasePrice] = useState('')
  /** A preset string, or the literal 'rolling' / 'date'. See the drawer. */
  const [newCaseHorizon, setNewCaseHorizon] = useState('12 months')
  const [newCaseProbability, setNewCaseProbability] = useState('')
  const [newCaseReasoning, setNewCaseReasoning] = useState('')
  const [newCaseDate, setNewCaseDate] = useState('')

  /* `targetCaseName` is gone with the control that needed it. The no-target
     card no longer asks which case a lone number belongs to, because it no
     longer collects a lone number — the ladder names its own rungs. */

  /**
   * The diagnostic strip.
   *
   * Read through `isFlagOn`, not from `location.search`. The root route
   * redirects with `<Navigate replace />` and drops the query string before
   * this component ever mounts — `main.tsx` consumes flags at module load for
   * exactly that reason, and reinventing a latch here failed for the reason
   * its comment already documented.
   */
  const debugOn = isFlagOn('feed-debug')

  const [lastThought, setLastThought] = useState<{ id: string; symbol: string | null } | null>(null)

  /**
   * The offer expires. Sharing is deliberate, and a bar that waits forever
   * turns into furniture the reader stops seeing — which is worse than not
   * offering, because it also covers the bottom of the card.
   */
  useEffect(() => {
    if (!lastThought) return
    const t = setTimeout(() => setLastThought(null), 6000)
    return () => clearTimeout(t)
  }, [lastThought])

  const [captureCtx, setCaptureCtx] = useState<
    {
      assetId: string | null
      symbol: string | null
      name: string | null
      /**
       * Which composer opens. Widened from `'thought'` alone: a research
       * question can equally become a prompt for somebody else, and the
       * capture sheet has always supported both — the type was the only thing
       * saying otherwise.
       */
      kind?: 'thought' | 'prompt'
      note?: string
    } | null
  >(null)

  /**
   * What the reader has already decided about, snapshotted once per mount.
   *
   * Read live, a disposition applied mid-scroll would delete the card under the
   * reader's thumb and jump the feed — the same reason `seenAtMount` is a
   * snapshot. Cards already on screen keep their place; the decision takes
   * effect on the next open or refresh, which is when a feed is allowed to
   * change shape.
   */
  const [dispositions, setDispositions] = useState<DispositionMap>(() => loadDispositions(userId ?? ''))
  useEffect(() => { setDispositions(loadDispositions(userId ?? '')) }, [userId])

  /**
   * Applied at the moment of decision, and reflected on the next open.
   *
   * `flagged` deliberately does not hide anything: the reader said the finding
   * is real and needs work, and hiding it then would be the surface raising
   * something and immediately removing the reminder.
   */
  /**
   * Judgment first, writing second — and writing is never compulsory.
   *
   * ── What this used to do, and why it was wrong ────────────────────────────
   *
   * A `flagged` judgment opened the capture sheet automatically, on the
   * reasoning that committing to work is worth a sentence. The reasoning is
   * fine and the trigger was not: `flagged` is a FEED state, not a statement
   * that the reader wants to write something. Five of the most ordinary answers
   * on the surface map to it — Thesis weaker, Cases outdated, Needs review,
   * Revise target, Needs update — so answering a question in one tap threw the
   * reader into a form they never asked for, which is precisely the friction
   * "judgment first" exists to remove. The compatibility mapping had started
   * dictating product behaviour.
   *
   * Now: tap, persist, stay in the feed. Capture is still one tap away on every
   * card's action bar and through the global control, and a follow-up prompt
   * ("add why?") is a later phase's job — offered, not imposed.
   */
  const applyVerdict = useCallback(
    async (card: SignalCard, question: string, o: VerdictOption, commentary?: string): Promise<boolean> => {
      if (!userId) return false
      const result = await recordSignalJudgment({
        userId,
        orgId: currentOrgId ?? null,
        card,
        question,
        judgment: {
          key: o.key,
          label: o.label,
          disposition: o.disposition,
          intent: o.intent,
        },
      })
      // The LOCAL write decides what the reader is told, because it is what the
      // feed reads on the next open. A dropped audit request must not stop
      // somebody triaging on a train; it is marked and left for a sync pass.
      if (result.durable === 'failed') {
        console.warn('[feed] judgment recorded locally but not durably', {
          card: card.type, key: o.key,
        })
      }

      /**
       * The answer becomes something the reader can find again.
       *
       * Applying a judgment used to produce an audit row and a card that
       * stopped asking — correct, and invisible. The surface asked for a
       * decision and gave back nothing usable ten minutes later.
       *
       * The option's `note` is already first-person prose written for exactly
       * this, so it lands as a private quick thought against the same name.
       * Failure here does not fail the judgment: the judgment is the record
       * and this is a convenience on top of it.
       */
      if (result.local && o.intent !== 'feed_quality') {
        const wrote = await writeJudgmentThought({
          userId, card, note: o.note,
          // The reader's own words go BELOW the generated line, not instead of
          // it: the generated sentence carries the numbers and the provenance,
          // and theirs carries the reason. Losing either would be a worse note.
          commentary,
        })
        if (wrote.thoughtId) setLastThought({ id: wrote.thoughtId, symbol: card.entity?.ticker ?? null })
      }

      return result.local
    },
    [userId, currentOrgId],
  )

  /**
   * Feedback about the feed, with the two effects kept apart.
   *
   * 1. RECORD it, to product telemetry, always.
   * 2. DISMISS the card, only where the option says it should.
   *
   * Two statements rather than one, because Phase 3's defect was a
   * compatibility state silently driving unrelated behaviour. "This was not
   * useful" and "hide this" are different claims, and a reader may mean the
   * first without the second — the option declares which, and neither is
   * inferred from the other.
   *
   * `feed_wrong_person` records a ROUTING complaint and does not touch
   * coverage. Repeated feedback may one day suggest an ownership change; a
   * menu tap silently rewriting team data would be a different product.
   */
  const applyFeedback = useCallback(
    (card: SignalCard, o: FeedFeedbackOption) => {
      // Fire-and-forget by design: the card goes away because the reader asked,
      // not because telemetry replied. A dismissal that waited on a network
      // round trip would be worse than a lost datapoint.
      recordFeedFeedback({ card, option: o, orgId: currentOrgId ?? null })
      if (o.dismisses && userId) {
        recordDisposition(userId, card.type, card.entity.id, {
          kind: 'rejected',
          // Namespaced so this never reads as an investment judgment. Anything
          // querying judgments filters on the `feed_` prefix — or, durably, on
          // the fact that this wrote no audit row at all.
          key: o.key,
          label: o.label,
          question: 'Feed feedback',
          cardType: card.type,
          until: Date.now() + DISPOSITION_DAYS.rejected * 86_400_000,
        })
        setDispositions(loadDispositions(userId))
      }
    },
    [userId, currentOrgId],
  )

  /**
   * Snooze and Dismiss, for every card type, through the one store.
   *
   * ── What this replaces ────────────────────────────────────────────────────
   *
   * `onSnooze={() => {}}` and `onDismiss={() => {}}` at six of this file's
   * seven card call sites. Both controls have been in the overflow menu since
   * the contract was written and neither has ever done anything — a card the
   * reader cannot get rid of, which the contract names as the thing that trains
   * people to scroll past the surface.
   *
   * It writes a `Disposition`, which is the mechanism the feed ALREADY uses to
   * decide what comes back and when. No second store, no snooze table, no new
   * schema: the two keys are classified in `judgment-policy` beside every other
   * key the surface writes, so the ranking gate suppresses them exactly the way
   * it suppresses an answered verdict.
   *
   * ── Why the card goes immediately ─────────────────────────────────────────
   *
   * `applyVerdict` deliberately does NOT refresh `dispositions`: answering a
   * question should not delete the card under the reader's thumb, because they
   * may want to read what they just answered. Triage is the opposite request.
   * "Dismiss" means "take this off my screen", and a dismissal that leaves the
   * card sitting there is indistinguishable from the no-op this replaces.
   * `applyFeedback` already refreshes for the same reason on its dismissing
   * options; this follows that precedent rather than inventing a third rule.
   */
  const triageCard = useCallback((card: SignalCard, action: TriageAction) => {
    if (!userId) return
    const stuck = recordTriage(userId, card, action)
    if (!stuck) {
      // Private browsing, a full quota, a disabled origin. Say so rather than
      // hiding the card and letting it come back tomorrow unexplained.
      console.warn('[feed] triage not persisted', { card: card.type, action })
      return
    }
    setDispositions(loadDispositions(userId))
  }, [userId])

  const { track } = useFeedDwell(userId)

  /**
   * Draft reweights on scenario cases, written from the feed.
   *
   * `draft_*` only — the published case is untouched, so this is reversible by
   * construction and needs no confirmation ceremony. The `user_id` filter is
   * belt and braces: RLS already restricts UPDATE to `auth.uid() = user_id`,
   * but it does so by matching zero rows and returning SUCCESS, so a bug that
   * sent somebody else's case id would report a save that never happened.
   * Filtering here makes that case an observable zero instead.
   */
  /**
   * Save one case's price.
   *
   * ── Why a price and not a probability ─────────────────────────────────────
   *
   * The old editor wrote `draft_probability`, so "editing a case" meant moving
   * how likely you thought it was — while the number on the card, on the
   * ladder and on the chart was the case PRICE. A reader who dragged what
   * looked like a bear case to $150 changed a probability instead, and nothing
   * said so.
   *
   * `draft_price` is the field the ladder actually renders, so the control and
   * the display now agree about which number is being changed.
   */
  /**
   * Save an analyst's own price target.
   *
   * ── Why this exists ──────────────────────────────────────────────────────
   *
   * Editing a target used to open the capture sheet and write a THOUGHT
   * saying what the reader would have set it to, leaving the stored target
   * untouched. Reported plainly: "the record a thought here doesn't make sense
   * because this is a price target — if I am editing my price target I want it
   * to edit my price target."
   *
   * That indirection was defensible when the feed had no write path to
   * `analyst_price_targets`. It has one — `saveCasePrice` writes `draft_price`
   * through the same table — so the honest thing is to write the target.
   *
   * Scoped to the reader's OWN row by `user_id`, matching the case writer: RLS
   * decides ownership server-side and fails silently, so the filter is what
   * turns somebody else's target into an observable zero rather than a save
   * that reports success and changed nothing.
   */
  const saveAnalystTarget = useCallback(
    async (
      assetId: string,
      price: number,
      /**
       * The horizon this number is given, where the caller collected one.
       *
       * ── Why a target card must write this and not only the price ────────
       *
       * `target_expired` fires on an elapsed horizon and on nothing else. A
       * write that moves the number and leaves the clock alone therefore
       * changes none of the signal's inputs: the card comes back saying the
       * view has outlived its horizon, which — having only been given a new
       * price — it has. The reader concludes their edit was lost.
       *
       * Publishing rather than drafting, for the same reason. `draft_price`
       * is an unpublished edit; it is not the stated view, the lens does not
       * read it, and the previous version of this function wrote ONLY that.
       * So the one control the card offered for revising a target could not
       * resolve the card it was reached from, by two independent mechanisms.
       *
       * ── Why this re-stamps `created_at` ─────────────────────────────────
       *
       * Because that is the column the horizon is measured from — see
       * `statedAtOf`, and the production measurement in its comment for why
       * `updated_at` cannot be. Writing the horizon without moving the anchor
       * would leave the card firing on the original date forever, which is the
       * exact defect this function exists to fix.
       *
       * Mutating a `created_at` is not something to do lightly, and it is
       * defensible here for one reason: this row is not an event, it is the
       * CURRENT stated view. Its history lives in
       * `analyst_price_target_history` and in the revision events, neither of
       * which this touches. The database already agrees — the
       * `create_outcome_for_target` trigger dates a fixed target's renewal
       * from `NOW()` on UPDATE rather than from the original insert.
       */
      horizon?: string,
    ): Promise<boolean> => {
      if (!userId) return false
      const now = new Date().toISOString()
      const patch: Record<string, unknown> = horizon
        ? {
            price,
            timeframe: horizon,
            timeframe_type: 'preset',
            is_rolling: false,
            created_at: now,
            updated_at: now,
            // A published number supersedes any draft of itself. Leaving one
            // behind would show a pending edit against a target that already
            // moved past it.
            draft_price: null,
            draft_timeframe: null,
            draft_updated_at: null,
          }
        // No horizon collected: the old behaviour, which stages rather than
        // states. Kept for the target-hit card, whose claim is about a price
        // being reached and which does not ask for a horizon.
        : { draft_price: price, draft_updated_at: now }

      const { error } = await (supabase as any)
        .from('analyst_price_targets')
        .update(patch as any)
        .eq('asset_id', assetId)
        .eq('user_id', userId)
      if (error) {
        // Reported, not swallowed. The caller keeps its editor open on false —
        // a write that did not land must never look like one that did.
        console.warn('[feed] target not saved', { assetId, error })
        return false
      }
      await queryClient.invalidateQueries({ queryKey: [...SCENARIO_CARDS_KEY] })
      await queryClient.invalidateQueries({ queryKey: ['analyst-price-targets', assetId] })
      await queryClient.invalidateQueries({ queryKey: ['portfolio-lenses'] })
      await refetchAttention?.()
      return true
    },
    [userId, queryClient, refetchAttention],
  )

  /**
   * Save one case by its row id, with no card to invalidate against.
   *
   * The scenario-card path knows which card it is saving for and uses that to
   * drive its spinner. A target card editing the same ladder does not, so this
   * is the same write without the per-card busy state — one function rather
   * than two, because two writers to one table drift.
   */
  /**
   * Add a case to a name's ladder.
   *
   * ── Two rows, because a case is two things ────────────────────────────────
   *
   * `scenarios` names it and is per-asset; `analyst_price_targets` holds THIS
   * analyst's number for it. The "+" was rendered and wired to nothing, so a
   * ladder could be read and edited but never extended — reported twice.
   *
   * Seeded at the current price rather than at zero or empty. A case with no
   * number is not a case, and starting it where the name actually trades gives
   * the reader something to drag FROM; the row is a draft until they save it,
   * exactly like every other value on this surface.
   */
  const addCase = useCallback(
    async (
      assetId: string,
      name: string,
      seedPrice: number | null,
      /**
       * The rest of what a stored target carries.
       *
       * `analyst_price_targets` holds a horizon, a probability and the
       * reasoning alongside the number. A case created without them is a bare
       * figure somebody has to interpret later, which is the complaint this
       * whole area started from. All optional — a target with only a price is
       * still a target.
       */
      extra?: {
        /**
         * A preset string ("12 months"), or the literal 'rolling' / 'date'.
         *
         * One field rather than separate flags, because the columns behind it
         * are mutually exclusive in practice — and encoding them separately is
         * how the old control set `is_rolling` without ever setting
         * `timeframe_type`, which is why "ends on a date" did nothing.
         */
        horizon: string | null
        probability: number | null
        reasoning: string | null
        targetDate?: string | null
      },
    ) => {
      if (!userId || !name.trim()) return
      const { data: scenario, error: sErr } = await (supabase as any)
        .from('scenarios')
        .insert({ asset_id: assetId, name: name.trim(), created_by: userId } as any)
        .select('id')
        .single()
      if (sErr || !scenario) { console.warn('[feed] scenario not created', { assetId, name, sErr }); return }

      const { error: tErr } = await (supabase as any)
        .from('analyst_price_targets')
        .insert({
          asset_id: assetId,
          scenario_id: (scenario as any).id,
          user_id: userId,
          price: seedPrice ?? 0,
          // A draft, like every other unsaved value here. `organization_id` is
          // left to the column default rather than passed — a second source of
          // truth for tenancy is the one thing the org work is careful about.
          draft_price: seedPrice ?? null,
          draft_updated_at: new Date().toISOString(),
          /**
           * The horizon, written as the trio the schema actually stores.
           *
           * Every row in production is `timeframe_type: 'preset'` with a
           * string like "12 months". A dated horizon sets `timeframe_type`
           * and `target_date`; a rolling one sets `is_rolling` and by
           * definition never expires, which is what makes the stale-target
           * lens skip it.
           */
          ...(extra?.horizon === 'rolling'
            ? { is_rolling: true, draft_is_rolling: true, timeframe_type: 'rolling' }
            : extra?.horizon === 'date'
              ? {
                  timeframe_type: 'date',
                  ...(extra.targetDate
                    ? { target_date: extra.targetDate, draft_target_date: extra.targetDate }
                    : {}),
                }
              : extra?.horizon
                ? { timeframe: extra.horizon, draft_timeframe: extra.horizon, timeframe_type: 'preset' }
                : {}),
          ...(extra?.probability != null ? { probability: extra.probability, draft_probability: extra.probability } : {}),
          ...(extra?.reasoning ? { reasoning: extra.reasoning, draft_reasoning: extra.reasoning } : {}),
        } as any)
      if (tErr) { console.warn('[feed] case target not created', { assetId, name, tErr }); return }

      await queryClient.invalidateQueries({ queryKey: [...SCENARIO_CARDS_KEY] })
      await queryClient.invalidateQueries({ queryKey: ['portfolio-lenses'] })
    },
    [userId, queryClient],
  )

  const saveCasePriceById = useCallback(
    async (caseId: string, price: number) => {
      if (!userId) return
      const { error } = await (supabase as any)
        .from('analyst_price_targets')
        .update({ draft_price: price, draft_updated_at: new Date().toISOString() } as any)
        .eq('id', caseId)
        .eq('user_id', userId)
      if (error) { console.warn('[feed] case not saved', { caseId, error }); return }
      await queryClient.invalidateQueries({ queryKey: [...SCENARIO_CARDS_KEY] })
      await queryClient.invalidateQueries({ queryKey: ['portfolio-lenses'] })
    },
    [userId, queryClient],
  )

  // Resume the previous session if there is a recent one, so returning from an
  // asset lands where the user left. A fresh visit gets a new seed, which is
  // what makes a genuine refresh reorder the feed.
  /**
   * Show one kind only. Set by tapping a tile's category chip — the chip names
   * what a card is, so it is the obvious control for "more like this", and
   * having it do nothing was a dead affordance on every tile.
   */
  /**
   * Curate or Explore. A browsing MODE, not a filter.
   *
   * Deliberately outside `feedFilter`: the category row answers "which of these
   * do I want", and this answers "which question am I asking" — what deserves
   * my attention, or what might be interesting. Folding it into the filters
   * would make Explore look like a sixth category, which is the one thing the
   * phase brief is explicit that it is not.
   */
  const [mode, setMode] = useState<'curate' | 'explore'>('curate')
  /** Explore's own category selection, kept apart from Curate's filter state. */
  const [exploreCategory, setExploreCategory] = useState<FeedCategory | null>(null)
  /**
   * The Explore tile a reader has opened, if any.
   *
   * Explore is preview -> rich tile -> asset page. Tapping a preview used to
   * jump straight to the asset route, which skips the middle step and throws
   * away the reader's place in the mosaic. This holds the opened item so the
   * rich card can render over Explore, with Explore still mounted behind it.
   */
  const [exploreFocus, setExploreFocus] = useState<ExploreItem | null>(null)
  /**
   * The rect the sheet grows from, captured at the moment of the tap.
   *
   * Held beside the focused item rather than inside it: the item is data and
   * this is a measurement of the DOM, and the two have different lifetimes —
   * the rect is stale the moment the reader scrolls, which is why dismissal
   * re-measures rather than reusing it. See `ExploreExpansion`.
   */
  const [exploreOrigin, setExploreOrigin] = useState<ExpansionOrigin | null>(null)
  /**
   * An external story opened from Explore.
   *
   * Held beside `exploreFocus` rather than inside it: the grid stays mounted
   * underneath, so closing the reader returns to the exact scroll position and
   * category without the mosaic rebuilding. Same reason the focus overlay is an
   * overlay and not a route.
   */
  const [exploreArticle, setExploreArticle] =
    useState<{ url: string; title: string | null; source: string | null } | null>(null)

  /**
   * The target/cases editor, opened over the card instead of replacing it.
   *
   * "Set a target" and "Review cases" both routed to the asset page, which is
   * the whole surface for a change that takes one number and a horizon — the
   * reader loses the feed, their place in it, and the card they were answering.
   */
  const [targetSheet, setTargetSheet] = useState<
    {
      assetId: string; symbol: string; price: number | null
      /**
       * A resolution waiting on the ladder being saved.
       *
       * Present only when the sheet was opened from an expired-target card's
       * "Review cases" choice. Opening the ladder resolves nothing; the
       * judgment is recorded when the reader actually saves a case, and
       * dismissing the sheet drops this without a write.
       */
      pending?: { commit: (r: any) => Promise<boolean>; resolution: any }
    } | null
  >(null)

  /**
   * The expanded chart, or nothing.
   *
   * Held here rather than per card so only one can ever be open, and so a
   * windowed slot collapsing underneath does not take the overlay with it.
   * Everything it needs is captured at open time — the series, the overlays,
   * the resolved name — which also means it cannot re-resolve a symbol and
   * find a different one.
   */
  const [fsChart, setFsChart] = useState<{
    symbol: string
    companyName: string | null
    series: any[]
    bands: PriceBand[]
    markers: PriceMarker[]
  } | null>(null)

  const [kindFilter, setKindFilter] = useState<string | null>(null)

  /**
   * The curated view: several facets at once, intersected.
   *
   * kindFilter above stays as the tile chip's one-tap "more like this" — it is
   * the right control for a glance. This is the other half: you cannot express
   * "European industrials, news and decisions only" by tapping a chip.
   */
  const [feedFilter, setFeedFilter] = useState<FeedFilter>(EMPTY_FILTER)
  const [filterSheetOpen, setFilterSheetOpen] = useState(false)
  const { data: facets } = useFeedFacets()

  /**
   * Whose feed session this is.
   *
   * `feed-session` used to be one entry for the whole origin, so a second
   * reader on the same phone resumed the first one's seed and scroll offset,
   * and switching org restored a position in a feed that no longer held those
   * cards. It carries no intelligence — a seed, a cycle and an offset — but
   * "put me back where I was" put people back where somebody else was.
   *
   * Null on either half means no load and no save: the first render can happen
   * before the org query resolves, and an entry written then is one the next
   * render cannot find and a different reader could.
   */
  const feedScope = useMemo(
    () => ({ userId: userId ?? null, orgId: currentOrgId }),
    [userId, currentOrgId],
  )
  const [resumed] = useState(() => loadFeedSession(feedScope))
  const [shuffleSeed, setShuffleSeed] = useState(() => resumed?.seed ?? Math.floor(Math.random() * 2 ** 31))

  // The feed must not end. Ideas paginate from the server, but attention,
  // signals and derived insights are finite sets. When the server has no more
  // pages, additional cycles of the derived insights are appended instead of
  // the scroll simply stopping. Each cycle is reshuffled and labelled, so it
  // reads as "here is the rest of the book to look at" rather than a silent
  // repeat.
  const [cycle, setCycle] = useState(() => resumed?.cycle ?? 0)

  /**
   * What the feed knows about this reader: what they have seen, and what they
   * dwell on. Both frozen for the life of the mount so the ranking cannot move
   * under the thumb as the reader's own scrolling is recorded — and both
   * re-read when the READER changes, which is the part that was missing.
   *
   * They were two `useState` initialisers keyed on a `userId` that is
   * `undefined` for the first frames of a cold start, with nothing to correct
   * them afterwards. See `useReaderSnapshots`.
   */
  const { seenAtMount, interestAtMount } = useReaderSnapshots(userId)
  const [readthroughFor, setReadthroughFor] = useState<ScoredFeedItem | null>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  // State, not a ref. The component returns early while loading, so the
  // scroller does not exist on first render — effects keyed on a ref bound to
  // nothing and never re-ran, which is why pull-to-refresh did nothing and the
  // scroll position was never saved.
  const [scroller, setScroller] = useState<HTMLDivElement | null>(null)
  const restoredRef = useRef(false)

  // One query for every asset referenced by an attention item, rather than a
  // lookup inside each card.
  const attentionAssetIds = useMemo(
    () => Array.from(new Set(attentionItems.map(a => a.context?.asset_id).filter(Boolean) as string[])),
    [attentionItems]
  )
  const { data: attentionAssets } = useQuery({
    queryKey: ['attention-feed-assets', attentionAssetIds],
    queryFn: async () => {
      if (!attentionAssetIds.length) return {} as Record<string, { symbol: string; company_name: string | null }>
      const { data, error } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .in('id', attentionAssetIds)
      if (error) throw error
      return Object.fromEntries((data ?? []).map((a: any) => [a.id, a]))
    },
    enabled: attentionAssetIds.length > 0,
    staleTime: 5 * 60 * 1000,
  })

  // Attention items are raised per trade-queue row, so a four-leg pair
  // produces four near-identical decision cards. Look up pair membership for
  // the sources on screen so legs of one pair can be collapsed into a single
  // tile.
  const attentionSourceIds = useMemo(
    () => attentionItems
      .filter(a => a.source_type === 'trade_queue_item')
      .map(a => a.source_id)
      .filter(Boolean) as string[],
    [attentionItems]
  )
  const { data: pairInfo, isLoading: pairInfoLoading } = useQuery({
    queryKey: ['attention-pair-membership', attentionSourceIds],
    queryFn: async () => {
      const empty = { keyBySource: {} as Record<string, string>, legsByPair: {} as Record<string, any[]> }
      if (!attentionSourceIds.length) return empty

      const { data: sources, error } = await supabase
        .from('trade_queue_items')
        .select('id, pair_id, pair_trade_id')
        .in('id', attentionSourceIds)
      if (error) throw error

      const keyBySource: Record<string, string> = {}
      const pairKeys = new Set<string>()
      for (const row of (sources ?? []) as any[]) {
        const key = row.pair_trade_id || row.pair_id
        if (!key) continue
        keyBySource[row.id] = key
        pairKeys.add(key)
      }
      if (!pairKeys.size) return { keyBySource, legsByPair: {} }

      // Every leg of those pairs, so the surviving card can show the whole
      // trade rather than the one leg that happened to raise the alert.
      const keys = [...pairKeys]
      const { data: legs } = await supabase
        .from('trade_queue_items')
        .select('id, action, pair_id, pair_trade_id, pair_leg_type, assets:asset_id(id, symbol, company_name)')
        .or(`pair_id.in.(${keys.join(',')}),pair_trade_id.in.(${keys.join(',')})`)
        .eq('visibility_tier', 'active')
        .neq('status', 'deleted')

      const legsByPair: Record<string, any[]> = {}
      for (const leg of (legs ?? []) as any[]) {
        const key = leg.pair_trade_id || leg.pair_id
        if (!key) continue
        ;(legsByPair[key] ||= []).push(leg)
      }
      return { keyBySource, legsByPair }
    },
    enabled: attentionSourceIds.length > 0,
    staleTime: 60_000,
  })
  const pairKeyBySource = pairInfo?.keyBySource

  // Drop only genuinely empty cards. An earlier 24-character threshold was
  // hiding real posts — short reasoning is still reasoning. This now catches
  // just the AI insights that arrive as a call to action with no finding.
  const substantive = items.filter(item => {
    // Drop the generated discovery prompts. They are eight hardcoded questions
    // ("What are the biggest risks to your portfolio right now?") emitted when
    // human content runs thin, yet they render under an "AI Insight" badge —
    // an action prompt with no finding behind it. The mobile feed now carries
    // attention items and genuinely derived signals, so it does not need
    // filler to stay populated.
    if ((item as any).meta?.isDiscovery) return false

    if (stripMarkup(item.content ?? '').length > 0) return true
    if ('title' in item && item.title) return true
    return 'asset' in item && !!item.asset
  })

  // Demote what has already been seen so the feed does not open on the same
  // post every time. `seenAtMount` is a snapshot for the reader — see
  // `useReaderSnapshots` — because reading it live would reshuffle the list
  // underneath them as they scroll.
  const visibleItems = useMemo(
    () => rotateBySeen(substantive, seenAtMount),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [substantive.map(i => i.id).join(','), seenAtMount]
  )

  // Record what actually reached the screen, so the next open leads with
  // something else.
  useEffect(() => {
    if (!userId || !visibleItems.length) return
    const timer = setTimeout(() => markSeen(userId, visibleItems.slice(0, 10).map(i => i.id)), 1500)
    return () => clearTimeout(timer)
  }, [userId, visibleItems])

  // News for the names already in front of the reader. Deliberately derived
  // from what the feed is showing rather than the whole book: each symbol
  // costs a provider call, and a story about a name you are not looking at is
  // not why you opened this.
  const newsSymbols = useMemo(() => {
    const out: string[] = []
    for (const item of visibleItems) {
      const sym = ('asset' in item && item.asset ? item.asset.symbol : null) as string | null
      if (sym) out.push(sym)
    }
    for (const sig of realSignals) {
      const sym = sig.relatedAssets?.[0]?.symbol
      if (sym) out.push(sym)
    }
    /**
     * Twenty-four names, not twelve.
     *
     * The cap was written when each symbol was assumed to cost a provider
     * call. It does not: `useMarketNews` posts the whole list to one edge
     * function in a single request, so the marginal cost of a name is a longer
     * query string. Twelve names in a feed that runs to dozens of cards meant
     * most of what the reader scrolled past carried no story even when one
     * existed.
     */
    return Array.from(new Set(out)).slice(0, 24)
  }, [visibleItems, realSignals])

  /**
   * Cached closes for the names on screen, for the price pane.
   *
   * Keyed off `newsSymbols` — the names the feed is already showing — for the
   * same reason the news query is: a chart of a name nobody is looking at
   * costs a round trip and answers no question.
   */

  const { data: news } = useMarketNews(newsSymbols)
  const newsItems = news?.items ?? []

  const { data: events } = useMarketEvents(newsSymbols)

  /** Symbol → asset, for turning a story's tickers into things you can open. */
  const assetBySymbol = useMemo(() => {
    const map = new Map<string, { id: string; symbol: string; companyName?: string | null; sector?: string | null }>()
    for (const item of visibleItems) {
      const a = ('asset' in item ? item.asset : null) as any
      if (a?.symbol) map.set(a.symbol.toUpperCase(), { id: a.id, symbol: a.symbol, companyName: a.company_name, sector: a.sector })
    }
    for (const sig of realSignals) {
      for (const a of (sig.relatedAssets ?? []) as any[]) {
        if (a?.symbol) map.set(a.symbol.toUpperCase(), { id: a.id, symbol: a.symbol, companyName: a.company_name, sector: a.sector })
      }
    }
    return map
  }, [visibleItems, realSignals])

  // Live quotes for the names on screen — the input to the unusual-mover and
  // earnings-reaction templates.
  const { quotes: feedQuotes } = useMarketData(newsSymbols, { enabled: newsSymbols.length > 0 })

  // Active weight needs both sides: what the book holds and what the benchmark
  // holds. Fetched together and joined here rather than per-card, which would
  // be a query per position.
  const EMPTY_ACTIVE_RISK = useMemo(
    () => ({ rows: [] as any[], notHeldCount: 0, notHeldActivePct: 0 }),
    [],
  )
  const { data: activeRisk = EMPTY_ACTIVE_RISK } = useQuery({
    queryKey: ['feed-active-risk', userId],
    enabled: !!userId,
    staleTime: 10 * 60 * 1000,
    queryFn: async () => {
      // Ordered, because `.limit(1)` on an unordered select picks whichever row
      // Postgres returns first — which is not stable, and 4 of the 11 active
      // portfolios have no benchmark weights at all. The card that came back
      // therefore varied between reloads.
      const { data: portfolios } = await supabase
        .from('portfolios')
        .select('id, name')
        .eq('status', 'active')
        .order('name', { ascending: true })
        .limit(1)
      const portfolioId = (portfolios as any[])?.[0]?.id as string | undefined
      const portfolioName = (portfolios as any[])?.[0]?.name as string | undefined
      if (!portfolioId) return { rows: [], notHeldCount: 0, notHeldActivePct: 0 }

      const [{ data: holdings }, { data: bench }] = await Promise.all([
        supabase
          .from('portfolio_holdings')
          .select('asset_id, shares, price, date, assets(id, symbol, asset_type, current_symbol, lifecycle_status)')
          .eq('portfolio_id', portfolioId)
          .order('date', { ascending: false, nullsFirst: false }),
        supabase
          .from('portfolio_benchmark_weights')
          // as_of_date is selected even though the table can only hold one
          // today: `UNIQUE (portfolio_id, asset_id)` forbids a second. The
          // moment that constraint is relaxed for historical active weights,
          // an unfiltered read starts merging index files across dates — the
          // distinct-vs-current collapse, for the third time in this codebase.
          .select('asset_id, weight, as_of_date, portfolio_id')
          .eq('portfolio_id', portfolioId),
      ])

      // Same dated-snapshot rule as the portfolio page: only the newest row
      // per asset is a live position.
      const current = new Map<string, any>()
      for (const h of (holdings as any[]) ?? []) {
        if (!current.has(h.asset_id)) current.set(h.asset_id, h)
      }
      const rows = [...current.values()]
      const total = rows.reduce((s, h) => s + (Number(h.shares) || 0) * (Number(h.price) || 0), 0)
      if (total <= 0) return { rows: [], notHeldCount: 0, notHeldActivePct: 0 }

      // One file per portfolio, newest wins. A no-op today and load-bearing
      // the day the history migration lands.
      const currentBench = latestBenchmarkRows((bench ?? []) as any[])
      const benchByAsset = new Map(currentBench.map((b: any) => [b.asset_id, Number(b.weight)]))

      /**
       * Index constituents the book does not hold at all.
       *
       * One decision, not N. A concentrated book against a 500-name index is
       * underweight every name it skipped, and listing those would bury the
       * positions somebody actually chose. The peer pane states them as a
       * single line — see `ActiveWeightPeers` — so the number is visible
       * without pretending to be a ranking.
       */
      const held = new Set(rows.map((h: any) => h.asset_id))
      let notHeldCount = 0
      let notHeldActivePct = 0
      for (const b of currentBench as any[]) {
        if (held.has(b.asset_id)) continue
        notHeldCount += 1
        notHeldActivePct -= Number(b.weight) || 0
      }

      return {
        notHeldCount,
        notHeldActivePct,
        rows: rows
          .map((h: any) => ({
            assetId: h.asset_id,
            symbol: h.assets?.symbol ?? '',
            weight: ((Number(h.shares) || 0) * (Number(h.price) || 0)) / total * 100,
            benchmarkWeight: benchByAsset.has(h.asset_id) ? benchByAsset.get(h.asset_id)! : null,
            // Carried for the contract card: a weight is a book number and the
            // eyebrow has to be able to say which book, and as of when.
            portfolioId,
            portfolioName: portfolioName ?? 'Portfolio',
            asOf: h.date ?? null,
            // How many names the benchmark file lists at all. Without it the
            // builder cannot tell "the index excludes this name" from "this
            // portfolio has no benchmark", and asserts the first.
            benchmarkNameCount: benchByAsset.size,
            // What KIND of instrument it is. The builder suppresses the claims
            // that are structurally impossible for a class rather than merely
            // unverified — an index is not a position, a currency pair is not
            // an index constituent.
            instrumentClass: h.assets?.asset_type ?? null,
            /**
             * The ticker it trades under NOW, for price lookups only.
             *
             * `symbol` stays what the holdings file said — rewriting it to
             * match the present would make old uploads unreconcilable — so a
             * renamed name (SQ, held, now XYZ) would otherwise look up a price
             * series that ends the day it was renamed. The card still says
             * SQ; the chart comes from XYZ.
             */
            tradedSymbol: (h.assets?.current_symbol || h.assets?.symbol) ?? null,
            lifecycleStatus: h.assets?.lifecycle_status ?? null,
          }))
          .filter((r: any) => r.symbol),
      }
    },
  })
  const activeRiskRows = activeRisk.rows

  /**
   * Every held name ranked by active weight, for the peer pane.
   *
   * Built once here rather than per card: the ranking is a property of the
   * book, not of the name the card happens to be about, and recomputing it
   * inside three cards would sort the same 69 rows three times.
   *
   * Names with no benchmark weight are dropped rather than treated as zero.
   * A missing row means the index file did not list the name, which is not the
   * same claim as "the index holds none of it" — and `ActiveWeightPeers`
   * renders a signed active weight, so guessing here would put a fabricated
   * bet on a chart.
   */
  const activeRiskPeers = useMemo(
    () => activeRiskRows
      .filter((r: any) => r.benchmarkWeight != null && Number.isFinite(r.weight))
      .map((r: any) => ({
        symbol: r.symbol,
        weightPct: r.weight,
        benchmarkPct: r.benchmarkWeight as number,
        activePct: r.weight - (r.benchmarkWeight as number),
      }))
      .sort((a: any, b: any) => Math.abs(b.activePct) - Math.abs(a.activePct)),
    [activeRiskRows],
  )

  /**
   * Derived content cards.
   *
   * Templates are pure functions over data we already hold, so this is a memo
   * rather than a query — and each returns nothing when there is nothing worth
   * saying, which is what keeps the feed from filling with cards that always
   * fire.
   */
  /**
   * The three kinds that have moved onto the card contract.
   *
   * Behind the `signal-cards` flag. While it is off nothing here renders and
   * the feed is exactly as it was; while it is on, these three kinds render
   * through SignalCardView and the other four keep their legacy tiles. That
   * mixed state is deliberate and temporary — the exit is the remaining four
   * builders, after which the legacy components are deleted in one PR.
   */
  /**
   * Signal cards are the feed, not an experiment.
   *
   * They were behind a `signal-cards` flag while three of seven kinds were
   * migrated and the other four still rendered as legacy tiles. That flag cost
   * more than it bought: it silently failed twice — once because the root
   * route's <Navigate replace> dropped the query string before anything read
   * it, and once because nothing on screen said which state you were in — and
   * every "why is the feed empty" question had to rule the flag out first.
   *
   * A card that renders nothing and a card behind an unset flag look identical.
   * Removing the flag removes that ambiguity permanently.
   */
  const { data: recommendationResults = [], isLoading: recsLoading } = useRecommendationCards()

  /** Keyed by trade_queue_items.id, so a recommendation keeps its position in
   *  the interleave rather than jumping to the top of the feed. */
  const recommendationBySource = useMemo(() => {
    const m = new Map<string, { card: SignalCard; input: RecommendationInput }>()
    for (const r of recommendationResults) {
      if (r.result.ok) {
        m.set(r.result.card.id.replace(/^recommendation:/, ''), { card: r.result.card, input: r.input })
      }
    }
    return m
  }, [recommendationResults])

  /**
   * Keyed by assetId, replacing the active_risk template cards one for one.
   *
   * The builder INPUT is kept beside the card, not discarded. The card carries
   * the active weight as a formatted string, and the what-if control needs the
   * two numbers behind it — recovering them by parsing `metric.value` back out
   * of the rendered card would be the same mistake as reading a rollup instead
   * of the source.
   */
  const activeRiskByAsset = useMemo(() => {
    const m = new Map<string, { card: SignalCard; input: ActiveRiskInput }>()
    const usable = activeRiskRows.filter((r: any) => r.asOf)
    for (const row of selectActiveRisk(usable.map((r: any) => ({
      assetId: r.assetId, symbol: r.symbol, weightPct: r.weight,
      benchmarkWeightPct: r.benchmarkWeight, portfolioId: r.portfolioId,
      portfolioName: r.portfolioName, asOf: r.asOf,
      benchmarkNameCount: r.benchmarkNameCount,
      instrumentClass: r.instrumentClass,
    })), { limit: 3 })) {
      const built = buildActiveRiskCard(row)
      if (built.ok) m.set(row.assetId, { card: built.card, input: row })
    }
    return m
  }, [activeRiskRows])

  /**
   * Scenario cards — the strongest content the product can produce.
   *
   * Behind the `signal-cards` flag. Placed ahead of the interleave rather than
   * inside it: these are the only cards built on data no other tool has, and
   * burying the one saying "TSLA is below your bear case" beneath four news
   * items would be a ranking decision nobody would defend out loud.
   */
  const { data: scenarioResults = [], isLoading: scenariosLoading } = useScenarioCards()


  /**
   * Scenario cards, with the portfolio chip's books given real exposure.
   *
   * `useScenarioCards` knows which books hold a name — it fetches those
   * holdings to produce the count — but it cannot compute a WEIGHT, because a
   * weight needs the whole book as its denominator and that hook only fetches
   * rows for the assets it is building cards for. A percentage over a partial
   * denominator is a wrong number, not a missing one.
   *
   * `usePortfolioLenses` already fetches every holding for the org and already
   * computes the canonical totals, the minimum-positions guard and the
   * benchmark lookup. Its `weightIndex` is a projection of that finished work,
   * so this is a join rather than a second calculation, and it costs no extra
   * query — the lenses are already loaded for the feed.
   *
   * Where the index has nothing for a book, the chip keeps exactly what it had:
   * the name and its value. Nothing is fabricated to fill a column.
   */
  const scenarioCards = useMemo(() => {
    const index = lenses?.weightIndex
    return scenarioResults.filter(r => r.ok).map(r => {
      const card = (r as { ok: true; card: any }).card
      const assetId = card?.entity?.id
      const exposures = index?.get(assetId)
      if (!exposures?.length) return card
      return {
        ...card,
        context: card.context?.map((chip: any) => {
          if (!chip.portfolios?.length) return chip
          return {
            ...chip,
            portfolios: chip.portfolios.map((pf: any) => {
              const e = exposures.find((x: { portfolioId: string; name: string }) =>
                x.portfolioId === pf.id || x.name === pf.name)
              if (!e) return pf
              return {
                ...pf,
                ...(e.portfolioPct != null ? { weightPct: e.portfolioPct } : {}),
                // `null` is meaningful — no benchmark file — so it is passed
                // through rather than dropped by a truthiness check.
                benchmarkPct: e.benchmarkPct,
                ...(e.activePct != null ? { activePct: e.activePct } : {}),
              }
            }),
          }
        }),
      }
    })
  }, [scenarioResults, lenses])

  const templateCards = useMemo(() => {
    const quoteList = newsSymbols
      .map(sym => {
        const q = feedQuotes.get(sym)
        return q ? { symbol: sym, price: q.price, changePercent: q.changePercent } : null
      })
      .filter(Boolean) as { symbol: string; price: number; changePercent: number }[]
    const quoteMap = new Map(quoteList.map(q => [q.symbol.toUpperCase(), q]))

    return [
      ...unusualMovers(quoteList, assetBySymbol as any),
      ...outsizedActiveRisk(activeRiskRows),
      ...earningsAhead(events?.upcomingEarnings ?? [], assetBySymbol as any),
      ...earningsResult(events?.recentEarnings ?? [], assetBySymbol as any, quoteMap),
      ...corporateActions(events?.corporateActions ?? [], assetBySymbol as any, quoteMap),
      ...economicReleases(events?.economicReleases ?? []),
    ]
  }, [newsSymbols, feedQuotes, assetBySymbol, events, activeRiskRows])

  // One card per pair. The highest-priority leg is kept — the list is already
  // ordered by attention priority — and the rest are dropped rather than
  // rendered as separate screens for what is one decision.
  const dedupedAttention = useMemo(() => {
    // Until pair membership resolves, every leg still looks like its own
    // decision. Rendering them would show "SELL CLOV" for a beat and then
    // replace it with the pair, so hold the attention cards back instead.
    if (attentionSourceIds.length && pairInfoLoading) return []
    if (!pairKeyBySource || !Object.keys(pairKeyBySource).length) return attentionItems
    const seenPairs = new Set<string>()
    return attentionItems.filter(a => {
      const key = a.source_id ? pairKeyBySource[a.source_id] : undefined
      if (!key) return true
      if (seenPairs.has(key)) return false
      seenPairs.add(key)
      return true
    })
  }, [attentionItems, pairKeyBySource, attentionSourceIds.length, pairInfoLoading])

  /**
   * Every feed entry, expressed in the terms the ranking model understands.
   *
   * The adapter is the only place that knows where each kind hides its signal
   * type, its weight and its deviation, and it is deliberately explicit rather
   * than clever: seven sources store those in seven different shapes, and one
   * generic reader over them would quietly return `undefined` the first time a
   * shape moved. A field missing here has to mean "this signal genuinely does
   * not carry that", because the model reads unknown as neutral.
   *
   * Deviation is normalised per signal type BEFORE it reaches the model. "12%
   * through a bull case" and "12% overweight versus benchmark" are the same
   * number and nothing like the same fact, so each kind converts its own.
   */
  /**
   * What this reader covers, for the ranker.
   *
   * Read once here rather than per-card: `rankInputFor` runs for every entry on
   * every rank pass, so a hook call inside it would be both a Rules-of-Hooks
   * violation and a query per card.
   *
   * This is the SAME context value the desktop scorer reads — one provider, one
   * fetch, one object — so mobile and desktop cannot drift on who covers what.
   * See contexts/CoverageRelevanceContext and lib/signals/coverage-relevance.
   */
  const coverageIndex = useCoverageIndex()

  const rankInputFor = useCallback((e: any): PriorityInput => {
    /** The stored judgment for a card, so acknowledgment can be read. */
    const judgmentFor = (type: SignalType, entityId?: string | null): JudgmentRecord | null => {
      if (!entityId) return null
      const d = dispositions[`${type}:${entityId}`]
      return d ? { key: d.key ?? d.verdict ?? null, kind: d.kind, at: d.at } : null
    }
    /**
     * `judgmentType` exists for the post kinds, and only for them.
     *
     * The ranker's `type` is what decides a card's TIER, and `ideaSignalType`
     * deliberately collapses `note`, `thesis_update` and `message` into
     * `thought` so the tail of the feed ranks coherently. The disposition store
     * is keyed by the CARD's type, which keeps all three apart. Passing the
     * ranking type there would look up a key nothing ever wrote — so the two
     * are separate arguments rather than one that has to mean both.
     */
    const withJudgment = (
      i: Omit<PriorityInput, 'judgment'>,
      entityId?: string | null,
      judgmentType: SignalType = i.type,
    ): PriorityInput => ({
      ...i,
      judgment: judgmentFor(judgmentType, entityId),
      /**
       * The coverage seam, finally populated.
       *
       * `PriorityInput.owned` carried a comment since it was written saying it
       * was undefined for every signal on mobile because no feed hook queried
       * `coverage`. One now does. Threaded through the single function every
       * branch already routes its entity id through, rather than added to
       * twelve call sites — and the decision about when NOT to answer lives in
       * `coverageRelevanceFor`, not here.
       */
      coverage: coverageRelevanceFor(coverageIndex, entityId),
    })

    switch (e.kind) {
      case 'scenario': {
        const c = e.card
        // The card's own metric IS the deviation: a percentage of the case the
        // price broke through, and the same number the builder computed the
        // severity from. Reading it back beats recomputing it differently.
        const dev = Number(String(c?.metric?.value ?? '').replace(/[^0-9.]/g, ''))
        return withJudgment({
          id: c.id,
          type: c.type as SignalType,
          severity: c.severity,
          occurredAt: c.provenance?.occurredAt ?? null,
          deviationPct: Number.isFinite(dev) ? dev : null,
          // A scenario ladder exists because somebody covers the name, and the
          // card carries the portfolios it sits in.
          held: (c.context ?? []).some((chip: any) => /portfolio/i.test(String(chip?.label ?? ''))),
          weightPct: null,
        }, c?.entity?.id)
      }

      case 'lens': {
        const l = e.lens
        switch (l.type) {
          case 'breach':
            return withJudgment({
              id: `breach-${l.breach.assetId}`,
              type: 'target_hit',
              severity: Math.abs(l.breach.overshootPct * 100) >= 15 ? 'critical' : 'attention',
              occurredAt: l.breach.asOf,
              // `TargetBreach` carries no weight at all. Null is neutral here,
              // not zero — see `materialityBand`.
              weightPct: null,
              held: true,
              deviationPct: Math.abs(l.breach.overshootPct * 100),
            }, l.breach.assetId)
          case 'stale':
            return withJudgment({
              id: `stale-${l.target.assetId}`,
              type: 'target_expired',
              severity: l.target.overdueMonths >= 6 ? 'critical' : 'attention',
              occurredAt: l.target.expiredAt,
              weightPct: null,
              held: true,
              // Months overdue is this signal's deviation — how far past its own
              // horizon the view has run. Converted into the band's 0-100 shape
              // rather than compared against a price move, which it is not.
              deviationPct: l.target.overdueMonths * 5,
            }, l.target.assetId)
          case 'untargeted':
            return withJudgment({
              id: `untargeted-${l.position.assetId}`,
              type: 'no_target',
              severity: l.position.weightPct >= 5 ? 'critical' : 'attention',
              occurredAt: l.position.asOf,
              weightPct: l.position.weightPct,
              held: true,
              deviationPct: null,
            }, l.position.assetId)
          case 'conviction':
            return withJudgment({
              id: `conviction-${l.gap.assetId}`,
              type: l.gap.direction === 'overweight' ? 'conviction_oversized' : 'conviction_undersized',
              severity: 'attention',
              occurredAt: l.gap.asOf,
              weightPct: l.gap.weightPct,
              held: true,
              // `tension` is this lens's own mismatch measure on its own scale.
              // Scaled into the band's shape rather than reused raw.
              deviationPct: Math.min(Math.abs(l.gap.tension) * 100, 100),
            }, l.gap.assetId)
          default:
            return withJudgment({
              id: `crowded-${l.name.assetId}`,
              type: 'crowding',
              severity: 'informational',
              occurredAt: l.name.asOf,
              weightPct: l.name.maxWeightPct,
              held: true,
              deviationPct: null,
            }, l.name.assetId)
        }
      }

      case 'insight': {
        const i = e.insight
        const type = insightSignalType(i.kind) as SignalType
        return withJudgment({
          id: i.id,
          type,
          severity: (i.weightPct ?? 0) >= 5 ? 'attention' : 'informational',
          occurredAt: i.lastTouchedAt ?? null,
          weightPct: i.weightPct ?? null,
          held: true,
          // The Phase 7 context IS the deviation, where the trigger was a move.
          deviationPct: i.context?.kind === 'price_move' ? Math.abs(i.context.movePct ?? 0) : null,
        }, i.assetId)
      }

      case 'attention': {
        const a = e.attention
        /**
         * Attention items are not one thing, so they must not get one tier.
         *
         * A trade awaiting the PM's call, a deliverable three weeks late and a
         * plain notification were all pushed to the top of the feed together by
         * `leadWith: 'attention'`. Mapping by source is what lets the overdue
         * project sink while the pending trade stays competitive.
         */
        const type: SignalType =
          a.source_type === 'trade_queue_item' ? 'recommendation'
          : a.source_type === 'project' || a.source_type === 'project_deliverable' ? 'project_overdue'
          : a.attention_type === 'informational' ? 'thought'
          : 'awaiting_review'
        return withJudgment({
          id: String(a.attention_id),
          type,
          severity: a.priority === 'high' ? 'critical'
            : a.priority === 'medium' ? 'attention'
            : 'informational',
          occurredAt: a.created_at ?? null,
          weightPct: null,
          held: !!a.context?.asset_id,
          /**
           * `due_at`, not `due_date`.
           *
           * `useAttention` normalises every source onto `due_at` — a project's
           * `due_date`, a target's `expires_at`, an earnings date — and this
           * read a column that does not exist on the normalised row. So
           * `overdueDays` was null for every attention item ever ranked, and
           * the rule directly below it, which lifts severely overdue work out
           * of the workflow tier, has never once fired.
           */
          overdueDays: a.due_at
            ? Math.floor((Date.now() - new Date(a.due_at).getTime()) / DAY_MS)
            : null,
        }, a.context?.asset_id)
      }

      case 'template': {
        const c = e.card
        return withJudgment({
          id: String(c.id ?? c.symbol),
          // `active_risk` is deliberately absent from TEMPLATE_TYPE — it has
          // its own builder — so it is named here rather than falling to news.
          type: signalTypeForTemplate(c.kind),
          severity: c.tone === 'negative' ? 'attention' : 'informational',
          occurredAt: c.occurredAt ?? null,
          weightPct: c.weightPct ?? null,
          held: !!c.heldIn?.length,
          deviationPct: null,
        }, c.assetId)
      }

      case 'news': {
        /**
         * The same entity the card will carry, resolved the same way.
         *
         * This branch used to return a bare object with no `judgment`, so a
         * reader who answered "priced in" on a story — or dismissed it — was
         * writing a disposition nothing ever read back. News was one of two
         * kinds that bypassed the feed's single suppression gate.
         *
         * `buildNewsCard` keys its entity on the linked asset where the source
         * NAMED one, and on the primary symbol otherwise. Mirrored here rather
         * than approximated, because a key that is nearly right is a key that
         * never matches.
         */
        const n = e.news
        const chartSym = newsChartSymbol({
          primarySymbol: n?.primarySymbol, symbols: n?.symbols,
        })?.symbol ?? null
        const linkedId = chartSym ? assetBySymbol.get(chartSym)?.id ?? null : null
        return withJudgment({
          id: String(n?.id ?? n?.url ?? 'news'),
          type: 'news',
          severity: 'informational',
          occurredAt: n?.publishedAt ?? n?.published_at ?? null,
          weightPct: null,
          held: false,
        }, linkedId ?? n?.primarySymbol ?? 'market')
      }

      case 'idea':
        /**
         * Keyed on the POST, not on the ticker — see `dispositionEntityFor`.
         *
         * This branch also returned a bare object with no `judgment`, so
         * dismissing a colleague's post did nothing at all. It is wired now,
         * and it is wired to the card's own id: a reader answering Priya's
         * thought about AAPL must not silence Marcus's thought about AAPL.
         */
        return withJudgment({
          id: String(e.idea?.id ?? 'idea'),
          /**
           * The SAME test the Explore adapter uses.
           *
           * This read `=== 'trade'` while the adapter accepted `'trade'` or
           * `'trade_idea'`, so a post stored under the longer name ranked as a
           * thought and tiled as a trade idea. The filter then offered a
           * "Thought" pill that selected trade-idea tiles, and the Explore
           * matcher could not find the entry behind one because the two sides
           * disagreed about its type.
           */
          type: ideaSignalType(e.idea?.type),
          severity: 'informational',
          occurredAt: e.idea?.created_at ?? null,
          weightPct: null,
          held: false,
        },
        ideaCardId(e.idea?.type, String(e.idea?.id ?? 'idea')),
        ideaCardType(e.idea?.type))

      default:
        // `signal` entries are already contract cards.
        return withJudgment({
          id: String(e.signal?.id ?? e.kind),
          type: (e.signal?.type ?? 'news') as SignalType,
          severity: e.signal?.severity ?? 'informational',
          occurredAt: e.signal?.provenance?.occurredAt ?? null,
          weightPct: null,
          held: false,
        }, e.signal?.entity?.id)
    }
  }, [dispositions, assetBySymbol, coverageIndex])

  /**
   * Explore's candidates, from exactly the same sources Curate reads.
   *
   * No new content query. Explore is a second arrangement of material already
   * in hand, which is why it can exist without a data programme behind it —
   * and why switching modes is instant rather than a load.
   */
  const exploreCandidates = useMemo<ExploreItem[]>(() => {
    const base = [
      ...lensesToExplore(lenses as any),
      ...scenarioCardsToExplore(scenarioCards as any[]),
      ...insightsToExplore(derivedInsights as any[]),
      ...ideasToExplore(visibleItems as any[]),
      ...newsToExplore((newsItems ?? []) as any[]),
      ...templatesToExplore(templateCards as any[]),
      ...attentionToExplore(dedupedAttention as any[]),
    ]
    // Aggregates are derived from the base set, so they can never claim a count
    // the reader cannot go and find.
    return [...base, ...aggregatesFor(base, Date.now())]
  }, [lenses, scenarioCards, derivedInsights, visibleItems, newsItems, templateCards, dedupedAttention])

  /**
   * The names Explore wants a sparkline for — derived from ITS OWN page.
   *
   * ── The trap this avoids ──────────────────────────────────────────────────
   *
   * `usePriceHistory` takes the first `MAX_SYMBOLS` (24) of whatever it is
   * given. Curate feeds it the composed Curate feed order, so passing Explore
   * the same list would have given tiles 25+ no chart while looking exactly
   * like missing data — the failure mode this project has now hit three times.
   *
   * So Explore composes first and asks second: the symbol list is taken from
   * the page it is actually about to render, in the order the tiles appear,
   * which is also the order a thumb reaches them. React Query keys on the
   * symbol list, so this is a SEPARATE cache entry from Curate's rather than a
   * competitor for the same budget, and it is gated on the mode so only one of
   * the two is ever in flight.
   *
   * Beyond 24 a tile simply renders without a sparkline. That is a graceful
   * degradation and not a silent one: the content of every tile stands on its
   * own, and none of them claims a chart it does not have.
   */
  /**
   * Explore no longer batches its sparklines.
   *
   * `exploreSymbolList` + `usePriceHistory` fetched up to 24 names behind one
   * query key, so the mosaic drew nothing until every page landed — and any
   * change to the list threw the whole result away. Tiles fetch their own
   * symbol now and share the cards' cache; see `TileSparkline`.
   */


  // Interleave so consecutive screens are not all one kind. Scores are
  // position-derived rather than raw: each source ranks on its own scale, and
  // using position preserves the ordering each source already decided
  // (including the seen-rotation applied to ideas) while making the two
  // comparable. `leadWith` keeps the single most pressing decision first.
  /**
   * The last UNFILTERED composition, kept for the price-history symbol set.
   *
   * Written only when no filter is active, so it holds the mixed feed's own
   * ranked order and does not move when a category is selected. That is what
   * makes the query key below stable — see `pricedSymbols`.
   *
   * A ref rather than state: nothing renders from it, and making it state would
   * add a render per composition purely to feed a query key.
   */
  const unfilteredRef = useRef<any[]>([])
  /**
   * Every candidate this feed knows about, whatever Curate did with them.
   *
   * Explore matches its previews against this rather than against the composed
   * feed — see where it is written.
   */
  const allEntriesRef = useRef<any[]>([])

  const feedEntries = useMemo(() => {
    const attentionEntries = dedupedAttention.map((a, idx) => ({
      kind: 'attention' as const,
      score: dedupedAttention.length - idx,
      attention: a,
    }))
    // Learned interest nudges rank rather than dictating it: a strong
    // interest can lift an item by up to a third of the list, but cannot
    // override recency and relevance entirely, so the feed still surfaces
    // new names instead of narrowing to what was read yesterday.
    const ideaEntries = visibleItems.map((i, idx) => {
      const boost = interestScore(interestAtMount, {
        assetId: ('asset' in i && i.asset ? i.asset.id : null) as string | null,
        authorId: i.author?.id ?? null,
      })
      return {
        kind: 'idea' as const,
        score: (visibleItems.length - idx) + boost * visibleItems.length * 0.33,
        idea: i,
      }
    })
    const signalEntries = realSignals.map((sig, idx) => ({
      kind: 'signal' as const,
      score: realSignals.length - idx,
      signal: sig,
    }))

    // Cycle 0 is the first pass; each additional cycle re-presents the derived
    // insights further down the book, so scrolling keeps yielding real
    // observations about real positions rather than running out.
    const insightEntries = Array.from({ length: cycle + 1 }).flatMap((_, round) =>
      derivedInsights.map((ins, idx) => ({
        kind: 'insight' as const,
        score: derivedInsights.length - idx,
        insight: ins,
        round,
      }))
    )

    // News is the only source that brings genuinely new material between
    // visits — everything else is the book restated. Ranked on the provider's
    // own relevance where there is one, recency otherwise, then normalised to
    // the same positional scale as every other kind.
    const newsEntries = (newsItems ?? []).map((n, idx) => ({
      kind: 'news' as const,
      score: newsItems.length - idx,
      news: n,
    }))

    // Derived templates share one kind so the interleaver treats them as a
    // single stream. Grouping them per-template would let six sparse kinds
    // dominate the rotation over the sources that actually carry the book.
    const templateEntries = templateCards.map(c => ({
      kind: 'template' as const,
      score: c.score,
      // The declared signal type travels WITH the card, so `categoryOf` can
      // read it rather than inferring a category from the entry kind. That
      // inference is what filed active risk — a sizing decision — under News.
      card: { ...c, type: signalTypeForTemplate(c.kind) },
    }))

    // Both lenses share one kind so the interleaver treats them as a single
    // stream, for the same reason the templates do: two sparse kinds would
    // otherwise take two slots in every rotation.
    const lensEntries = [
      ...((lenses?.conviction ?? []).map((g, idx) => ({
        kind: 'lens' as const,
        score: 40 - idx,
        lens: { type: 'conviction' as const, gap: g },
      }))),
      ...((lenses?.crowded ?? []).map((c, idx) => ({
        kind: 'lens' as const,
        score: 38 - idx,
        lens: { type: 'crowded' as const, name: c },
      }))),
      // Scored above the other two: a target that has been hit or has expired
      // is a decision waiting on someone, where sizing and crowding are
      // observations. Attention should outrank interest.
      ...((lenses?.breaches ?? []).map((b, idx) => ({
        kind: 'lens' as const,
        score: 60 - idx,
        lens: { type: 'breach' as const, breach: b },
      }))),
      ...((lenses?.stale ?? []).map((t, idx) => ({
        kind: 'lens' as const,
        score: 58 - idx,
        lens: { type: 'stale' as const, target: t },
      }))),
      // Scored between the target lenses and the observations. A large position
      // nobody has priced is a decision waiting on someone, like the two target
      // kinds above it, but unlike them it has been waiting since the position
      // was opened rather than since a horizon lapsed, so it is less urgent than
      // a view that has just run out.
      ...((lenses?.untargeted ?? []).map((u, idx) => ({
        kind: 'lens' as const,
        score: 50 - idx,
        lens: { type: 'untargeted' as const, position: u },
      }))),
    ]

    /**
     * A specific decision event beats a generic attention reminder.
     *
     * If a name already has a target-hit, target-expired, no-target or
     * scenario-gap card in this feed, an insight card saying "nobody has
     * looked at it lately" is describing the SAME unresolved condition in
     * weaker words. Two cards about one problem is how a feed teaches people
     * to skim: the precise one gets read at the same rate as the vague one.
     *
     * Precedence rather than scoring, because this is not a close call — the
     * stronger card names the event and offers the matching action, and the
     * insight card names neither.
     *
     * Deliberately NOT applied to `no_thesis`: a name with a stale target and
     * no written research at all are two genuinely different gaps, and the
     * second is not implied by the first.
     */
    const claimed = claimedSubjects([
      // Each kind stores its subject somewhere different; the extraction stays
      // here where the shapes are known, and the rule stays in `feed-dedupe`.
      // Read per variant. The optional-chain version compiled only because
      // nothing typechecked this file: `gap` exists on one member of the union,
      // so `e.lens?.gap` is an error, and the `as any` fallbacks would have
      // silently returned undefined for every kind if the shape ever moved.
      ...lensEntries.map(e => {
        const l = e.lens
        switch (l.type) {
          case 'conviction': return l.gap.symbol
          case 'crowded':    return l.name.symbol
          case 'breach':     return l.breach.symbol
          case 'stale':      return l.target.symbol
          case 'untargeted': return l.position.symbol
          default:           return null
        }
      }),
      ...(scenarioCards as any[]).map(c => c?.entity?.ticker),
    ])
    const insightEntriesDeduped = suppressCoveredInsights(insightEntries, claimed)

    // Scenario cards join the pool instead of rendering in their own block
    // above it. They were unconditionally first, so a gap on a 0.4% watchlist
    // name preceded a 12% position below its bear case and no ranking could
    // reach them. They still usually lead — `scenario_gap` tops tier 0 — but
    // now they have to earn it against the rest of the book.
    const scenarioEntries = (scenarioCards as any[]).map(c => ({
      kind: 'scenario' as const,
      score: 0,
      card: c,
    }))

    const all = [...attentionEntries, ...ideaEntries, ...signalEntries, ...insightEntriesDeduped, ...newsEntries, ...templateEntries, ...lensEntries, ...scenarioEntries]

    /**
     * Every candidate, before anything is dropped.
     *
     * ── Why Explore needs this and not the composed feed ────────────────────
     *
     * Tapping an Explore tile opens the SAME card Curate would render, found
     * by matching the preview back to its entry. That matching ran against
     * `unfilteredRef` — which is the composed feed: post-filter, post insight
     * dedupe, post rank-and-diversify.
     *
     * Explore's tiles come from the RAW sources. So any candidate Curate
     * dropped — suppressed as a duplicate of a stronger card, spaced out by
     * diversity, filtered by a facet — was visible in Explore and unmatchable
     * from it, and tapping it fell through to "this one lives on its own
     * surface" for a card that demonstrably exists.
     *
     * The two surfaces are two arrangements of one candidate set, so the
     * lookup belongs against the set rather than against one arrangement of it.
     */
    allEntriesRef.current = all

    // Filtering before the interleave rather than after: interleaving exists to
    // stop one kind running consecutively, and with a single kind selected that
    // constraint has nothing to do — applying it first would just be a shuffle
    // fighting a rule that can never be satisfied.
    /**
     * The symbol a tile is about, where it has one.
     *
     * Every kind stores it somewhere different, and a tile with no symbol —
     * a macro event, an unattributed story — is *kept* when only kind filters
     * are set and dropped when an asset facet is. Dropping it either way would
     * silently remove whole categories from a "European only" view that the
     * reader never meant to exclude.
     */
    const symbolOf = symbolOfEntry

    const assetFacetsActive =
      feedFilter.sectors.length > 0 || feedFilter.countries.length > 0 ||
      feedFilter.exchanges.length > 0 || feedFilter.symbols.length > 0

    const matchesFilter = (e: any): boolean => {
      // Categories, not internal kinds. `feedFilter.kinds` carries category
      // keys now, so the Curate sheet and the header banner are filtering the
      // same objects by the same words — see lib/mobile/feed-categories.
      if (feedFilter.kinds.length) {
        const cat = categoryOf(e)
        if (!cat || !feedFilter.kinds.includes(cat)) return false
      }
      /**
        * The card's own pill. Composes with the category above rather than
        * replacing it: Research + No thesis is a narrower question than either.
        *
        * Read through `rankInputFor`, not off `e.card`. Lens and scenario
        * entries build their card at RENDER time, so the entry itself has no
        * `.card` — and `signalTypeOf` returned null for exactly the pills the
        * reader asked about: Oversized, Target reached, Target expired, Case vs
        * price. `rankInputFor` is the one place that already names every
        * entry's type, which is why the ranker and the Explore matcher both use
        * it.
        */
      if (feedFilter.signalTypes.length) {
        const t = rankInputFor(e)?.type ?? signalTypeOf(e)
        if (!t || !feedFilter.signalTypes.includes(t)) return false
      }
      if (!assetFacetsActive) return true

      const sym = symbolOf(e)
      // No symbol and an asset facet is set: this tile cannot be shown to
      // satisfy it, so it is excluded rather than assumed to qualify.
      if (!sym) return false
      if (feedFilter.symbols.length && !feedFilter.symbols.includes(sym)) return false

      const f = facets?.bySymbol.get(sym.toUpperCase())
      if (feedFilter.sectors.length && !(f?.sector && feedFilter.sectors.includes(f.sector))) return false
      if (feedFilter.countries.length && !(f?.country && feedFilter.countries.includes(f.country))) return false
      if (feedFilter.exchanges.length && !(f?.exchange && feedFilter.exchanges.includes(f.exchange))) return false
      return true
    }

    // Facets intersect: two sectors widen, adding a country narrows. The chip
    // filter stays a separate one-tap override on top.
    const curated = filterCount(feedFilter) ? all.filter(matchesFilter) : all
    // The one-tap chip filter speaks the same vocabulary as the sheet.
    const filtered = kindFilter ? curated.filter(e => categoryOf(e) === kindFilter) : curated

    // Tag each entry with what it is *about* so the interleaver can keep one
    // name off three consecutive screens. symbolOf already knows where each
    // kind hides its subject.
    const pool = filtered.map(e => ({ ...e, subject: symbolOf(e) }))

    /**
     * Rank deterministically, then interleave only what is left.
     *
     * ── Why not simply sort everything ───────────────────────────────────
     *
     * `interleaveByKind` exists for a real problem: concatenating sources
     * produces "all decisions, then all projects, then all ideas", and a
     * strict sort of per-source positional scores produced the identical feed
     * on every visit. Its answer was a seeded weighted draw — importance
     * biases position rather than fixing it.
     *
     * That answer is right for the tail and wrong for the head. A PM opening
     * the feed twice must see the same most-important thing both times, and a
     * ranking nobody can reproduce cannot be debugged. But a fully sorted feed
     * would also run every scenario card, then every target card, then every
     * insight — which is the blocked-by-kind reading the interleaver was
     * written to prevent.
     *
     * So: the decision tiers lead, in a fixed order, and everything below them
     * is interleaved as before. The scores handed to the interleaver are now
     * genuinely comparable across kinds, which is the complaint its own header
     * opens with.
     */
    const ranked = diversify(
      rankFeed<any>(pool, rankInputFor, Date.now()),
      {
        // Off under a single-category filter: the reader asked for all of that
        // category, and interleaving a category with itself means nothing.
        enabled: !kindFilter && !feedFilter.kinds.length && !feedFilter.signalTypes.length,
        // The opening cap needs to know what family a card belongs to, which
        // is the same canonical answer the filters use.
        categoryOf: (e: any) => categoryOf(e),
      },
    )

    const lead = ranked.filter(r => r.priority.tier <= LEAD_TIER)
    const tail = ranked.filter(r => r.priority.tier > LEAD_TIER)

    // Recorded before the filter is applied downstream — see `unfilteredRef`.
    if (!kindFilter && !feedFilter.kinds.length) {
      unfilteredRef.current = ranked.map(r => r.item)
    }

    return [
      ...lead.map(r => r.item),
      ...interleaveByKind<any>(
        // The interleaver reads `score`, and the ranked total is the first
        // number in this feed's history that means the same thing in every
        // kind. Position-derived scores were explicitly not comparable.
        tail.map(r => ({ ...r.item, score: r.priority.total })),
        {
          maxRun: 1,
          // `leadWith: 'attention'` is gone. It forced workflow items to open
          // the feed, which is precisely the "a project overdue by two days
          // outranks a 12% position below its bear case" failure — and the
          // lead is now decided by tier instead.
          seed: shuffleSeed,
        },
      ),
    ]
    /**
     * `coverageSignature` rather than `coverageIndex`, and rather than
     * `rankInputFor`.
     *
     * Coverage resolves asynchronously, always AFTER the first paint. Without a
     * coverage dep this memo ranks every card as `unknown` and never runs
     * again, so declaring NVDA would populate the seam and move nothing — the
     * exact "the boolean is set but the feed did not change" outcome this work
     * exists to avoid. The desktop feed needed the same signature in its query
     * key for the same reason.
     *
     * The signature and not the index itself, because `useCoverageRelevance`
     * returns a fresh object whenever either underlying query refetches; the
     * string only changes when the reader's coverage actually changes.
     *
     * And not `rankInputFor`, which would be the exhaustive-deps answer: it
     * also closes over `dispositions`, so depending on it would re-rank and
     * reflow the whole feed every time the reader judged a card — pulling the
     * feed out from under their thumb mid-scroll, which is the failure
     * `seenAtMount` and `interestAtMount` were both introduced to prevent.
     */
  }, [dedupedAttention, visibleItems, realSignals, derivedInsights, newsItems, templateCards, cycle, interestAtMount, shuffleSeed, kindFilter, lenses, feedFilter, facets, scenarioCards, coverageSignature(coverageIndex)])

  /**
   * Every signal type, for the filter sheet — not only the ones on screen.
   *
   * ── Why this stopped being "what the feed is carrying" ──────────────────
   *
   * It was derived from the rendered candidates, on the reasoning that a sheet
   * offering "Corporate action" to a feed with none is a control whose only
   * possible effect is to empty the screen. That reasoning had it backwards in
   * two ways.
   *
   * First, a filter list that changes shape with the data is a filter list the
   * reader cannot learn. The set of things Tesseract can tell you is a fixed,
   * knowable vocabulary; hiding the ones that happen to be quiet today means
   * the control looks different every session and its absences are
   * indistinguishable from a bug — which is exactly how this surfaced, as
   * "there is no target expired filter".
   *
   * Second, "no results" is a USEFUL answer. Selecting Target expired and
   * being told there are none is a reader learning something true about their
   * book. Being unable to ask the question at all is not.
   *
   * So the list is the registry, and the feed says plainly when a filter
   * matches nothing — see the empty state below.
   */
  const presentSignalTypes = useMemo(() => KIND_LABEL as Record<string, string>, [])

  /**
   * Keys that survive a recompute.
   *
   * The pipeline rebuilds every entry object each time it runs, so identity
   * cannot come from the object. A slot whose key changed would remount its
   * card and lose the carousel pane the reader had paged to.
   */
  /**
   * What the reader narrowed to, in their own words, for the empty state.
   *
   * Names the SIGNAL type where one is selected, because that is the specific
   * question being answered — "nothing is a Target expired right now" is a
   * fact about the book, where "nothing matches your filters" is a fact about
   * the interface. Falls back through the category and then to a generic
   * phrase, so the sentence is grammatical whatever is set.
   */
  const activeFilterLabel = useMemo(() => {
    const [type] = feedFilter.signalTypes
    if (type) return KIND_LABEL[type as keyof typeof KIND_LABEL] ?? type
    const [cat] = feedFilter.kinds
    if (cat) return CATEGORY_LABEL[cat as FeedCategory] ?? cat
    if (kindFilter) return CATEGORY_LABEL[kindFilter as FeedCategory] ?? kindFilter
    return 'match for these filters'
  }, [feedFilter.signalTypes, feedFilter.kinds, kindFilter])

  const feedKeys = useMemo(() => feedEntryKeys(feedEntries), [feedEntries])

  /**
   * The names to fetch closes for, taken from the feed that was actually
   * composed.
   *
   * ── The bug this replaces ─────────────────────────────────────────────────
   *
   * This used to be derived from `newsSymbols`, which is built from ideas posts
   * and ideas signals and nothing else. So a conviction card, a crowding card, a
   * target-hit card, a stale-target card, a derived insight and every market
   * template asked for a price pane that had never been fetched — `panes.length`
   * came out 0, the evidence band collapsed, and the surface silently lost
   * almost every chart it declared. The only cards that kept one were the few
   * whose ticker happened to also appear in somebody's post.
   *
   * That is why the product went from "a lot of interactive charts" to one
   * chart on one tile: nothing about the charts was removed, the data stopped
   * being requested for them.
   *
   * ── Why the order matters ─────────────────────────────────────────────────
   *
   * `usePriceHistory` caps at twelve symbols, so which twelve is a real
   * decision. Walking `feedEntries` in its final interleaved order means the
   * cards the reader reaches first are the ones that get a chart, rather than
   * whichever source happened to sort highest.
   */
  /**
   * Display ticker to the one the series is stored under.
   *
   * `price_history_cache` is keyed by `coalesce(current_symbol, symbol)` — what
   * the instrument trades as now — while cards say what the holdings file said,
   * because rewriting that would make old uploads unreconcilable. So a renamed
   * name (SQ, held, now trading as XYZ) is fetched as XYZ and must be looked up
   * as XYZ too.
   *
   * Shared by the fetch and the lookup deliberately. They were two separate
   * copies of this mapping for about an hour, and only the fetch side had it:
   * the series arrived under the traded ticker and `pricePane` asked for the
   * display ticker, so every renamed instrument fetched a chart it could never
   * find. One resolver means the two cannot disagree again.
   */
  const tradedSymbolOf = useCallback((symbol: string): string => {
    const up = symbol.toUpperCase()
    for (const r of activeRiskRows as any[]) {
      if (r.symbol && String(r.symbol).toUpperCase() === up && r.tradedSymbol) {
        return String(r.tradedSymbol).toUpperCase()
      }
    }
    return up
  }, [activeRiskRows])

  /**
   * There is no feed-wide symbol budget any more.
   *
   * A `pricedSymbols` list used to be collected here — every symbol the
   * composed feed mentioned, deduplicated, then handed to `usePriceHistory`,
   * which took the first 24 and split them across seven parallel requests
   * because PostgREST returns at most 1,000 rows per call.
   *
   * That machinery existed only because the query was batched. `PricePane`
   * reads one symbol, which is 260 rows and one request, and `FeedSlot` keeps
   * about five cards mounted at any depth. So the budget, the ordering
   * question it forced ("which 24?"), the paging, and the whole-list query key
   * that invalidated on any change all go away together.
   *
   * Explore still batches, and correctly: it renders many tiles at once and
   * each needs only a sparkline, which is a genuinely different shape of
   * request from a card's full year.
   */

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(
      entries => {
        if (!entries[0].isIntersecting) return
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        } else if (derivedInsights.length > 0) {
          // Server exhausted — keep the scroll alive with another pass over
          // the book rather than dead-ending.
          setCycle(c => c + 1)
        }
      },
      { rootMargin: '400px' }
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage, derivedInsights.length])

  // Restore once, after the entries that make up the remembered offset exist.
  // Attempting it before render leaves scrollTop clamped to zero.
  useEffect(() => {
    if (restoredRef.current || !resumed?.scrollTop) return
    if (!scroller || !feedEntries.length) return
    const el = scroller
    const want = resumed.scrollTop

    /**
     * Keep trying until the feed is actually tall enough to hold the position.
     *
     * ── Why one attempt was not enough ──────────────────────────────────────
     *
     * This set `scrollTop` after two frames and marked itself done. But the
     * feed grows for a while after first paint — sources resolve at different
     * times, and `cycle` extends the list — so at that moment the scroller was
     * often SHORTER than the saved offset. Assigning past the end silently
     * clamps to whatever fits, and the one attempt was spent.
     *
     * The result is a reader who navigates to an asset, comes back, and lands
     * near the top instead of where they were — which is the entire point of
     * saving the position.
     *
     * So it retries while the content is still too short, and stops the moment
     * it lands. Bounded at 40 frames, because a feed that never grows to the
     * saved depth (the reader was deeper than today's feed goes) must not
     * retry forever — it settles at the bottom, which is the closest honest
     * answer.
     */
    let tries = 0
    let raf = 0
    const attempt = () => {
      const reachable = el.scrollHeight - el.clientHeight
      if (reachable >= want - 1 || tries++ > 40) {
        el.scrollTop = want
        restoredRef.current = true
        return
      }
      // Land as close as possible meanwhile, so a slow feed does not sit at
      // the top while it grows.
      el.scrollTop = Math.min(want, reachable)
      raf = requestAnimationFrame(attempt)
    }
    raf = requestAnimationFrame(attempt)
    return () => cancelAnimationFrame(raf)
  }, [resumed, scroller, feedEntries.length])

  // Persist position as the user scrolls, and once more on unmount so a fast
  // navigation away is not lost to the throttle window.
  useEffect(() => {
    const el = scroller
    if (!el) return
    let timer: ReturnType<typeof setTimeout> | null = null
    const persist = () => saveFeedSession(feedScope, { seed: shuffleSeed, cycle, scrollTop: el.scrollTop })
    const onScroll = () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; persist() }, 400)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      el.removeEventListener('scroll', onScroll)
      if (timer) clearTimeout(timer)
      persist()
    }
  }, [scroller, shuffleSeed, cycle, feedScope])

  /**
   * A filter change starts the feed again, at the top.
   *
   * ── The bug ───────────────────────────────────────────────────────────────
   *
   * Reported from a phone: scroll down five tiles, come back up, apply a
   * filter, and the old tiles are still there — the filtered ones only begin
   * once you scroll past everything you had already seen.
   *
   * Two causes, and they compound. `cycle` grows as the reader scrolls, and
   * each cycle re-presents the derived insights further down, so the rendered
   * list is several times longer than the candidate set. And the scroll
   * position is left where it was, so the reader is standing in the middle of a
   * list that has just been rebuilt underneath them.
   *
   * Selecting a category is a request to see that category, from the start. It
   * resets the depth and returns to the top, which is also what stops the DOM
   * from carrying five screens of cards nobody can reach any more — most of the
   * slowdown after a long scroll.
   */
  /**
   * Every facet, not only the categories.
   *
   * This read `kinds` alone, so narrowing to a sector, country, exchange or
   * symbol reset neither the depth nor the scroll position — the reader was
   * left standing five screens down a list that had just been rebuilt
   * underneath them, which is the half of the report that survived the first
   * fix. Any change to what the reader asked for starts the feed again.
   */
  const filterKey = [
    kindFilter ?? '',
    feedFilter.kinds.join(','),
    feedFilter.sectors.join(','),
    feedFilter.countries.join(','),
    feedFilter.exchanges.join(','),
    feedFilter.symbols.join(','),
  ].join('|')
  const lastFilterKey = useRef(filterKey)
  useEffect(() => {
    if (lastFilterKey.current === filterKey) return
    lastFilterKey.current = filterKey
    setCycle(0)
    if (scroller) scroller.scrollTop = 0
  }, [filterKey, scroller])

  // A deliberate refresh: refetch every source, re-deal the order, drop the
  // saved position and return to the top. The browser's own pull-to-refresh
  // would instead reload the page, which loses all of that.
  const handleRefresh = useCallback(async () => {
    setShuffleSeed(Math.floor(Math.random() * 2 ** 31))
    setCycle(0)
    clearFeedSession(feedScope)
    restoredRef.current = true // nothing to restore after an explicit refresh
    await Promise.all([
      refetch(),
      refetchAttention?.(),
      // useSignalCards and useDerivedInsights expose no refetch, so refresh
      // them through the cache they share.
      queryClient.invalidateQueries({ queryKey: ['signal-cards'] }),
      queryClient.invalidateQueries({ queryKey: ['derived-insights'] }),
    ].filter(Boolean) as Promise<unknown>[])
    scroller?.scrollTo({ top: 0 })
  }, [refetch, refetchAttention, queryClient, scroller])

  const { indicatorRef, isRefreshing, armed } = usePullToRefresh({
    scroller,
    onRefresh: handleRefresh,
  })

  const openAsset = useCallback(
    (assetId: string, symbol: string) => {
      onNavigate?.({ id: assetId, title: symbol, type: 'asset', data: { id: assetId, symbol } })
    },
    [onNavigate]
  )

  /**
   * A book named in a card's context row.
   *
   * "Held in Core Equity" is only better than "Held in 1" if the name goes
   * somewhere. This is the reader's shortest route from a finding about a
   * position to the position itself.
   */
  const openPortfolio = useCallback(
    (portfolioId: string, name: string) => {
      onNavigate?.({ id: portfolioId, title: name, type: 'portfolio', data: { id: portfolioId, name } })
    },
    [onNavigate]
  )


  /**
   * Contextual actions, handled in place where the feed can honour them.
   *
   * `review_target`, `set_target` and `open_cases` all resolve to the same
   * editor — `MobileCaseTargets`, which is where a price and a horizon are
   * actually written — so the feed opens it over the card rather than
   * navigating to the page that hosts it. Persistence is that component's own;
   * nothing here fakes a save.
   *
   * Everything else still routes. `update_thesis` in particular needs a
   * rich-text field with history beside it, which is a page rather than a
   * sheet, and pretending otherwise would be the dead-end button this feed has
   * been removing since Phase 4.
   */
  const handleFeedAction = useCallback((t: { id: string; title: string; type: string; data: Record<string, unknown> }) => {
    const focus = (t.data as any)?.focus

    /**
     * Writing stays on the tile — in the REAL thesis field.
     *
     * "Add rationale" and "Update thesis" resolved to the asset page, so
     * answering a card meant leaving the feed and losing everything
     * part-answered on it. The first fix opened the capture drawer, which kept
     * the reader in place but wrote a thought — and a card that says "no
     * thesis" wants a thesis, not a note about one.
     *
     * `MobileCaseSection` is the asset page's own editor and is
     * self-contained: it takes an asset and a section key and does its own
     * loading, drafting and publishing through `useContributions`. So the
     * sheet below is the same write the desktop page makes — same draft and
     * publish split, same revision history, same visibility rules — reached
     * without leaving the card that asked for it.
     */
    if (t.type === 'asset' && focus === 'thesis') {
      setThesisSheet({
        assetId: String((t.data as any).id ?? t.id),
        symbol: String((t.data as any).symbol ?? t.title),
      })
      return
    }

    if (t.type === 'asset' && (focus === 'target' || focus === 'cases')) {
      setTargetSheet({
        assetId: String((t.data as any).id ?? t.id),
        symbol: String((t.data as any).symbol ?? t.title),
        price: null,
      })
      return
    }
    onNavigate?.(t)
  }, [onNavigate])

  /**
   * Where an Explore tile goes.
   *
   * Routed through `resolveFeedAction`, the same resolver Curate uses, so
   * "Review target" means one destination in both modes. A second route
   * grammar for Explore is exactly the divergence that gave the product two
   * filter taxonomies and cost a phase to unpick.
   */
  /**
   * Opening a tile shows the rich card, not the asset page.
   *
   * Only an AGGREGATE's `filter` reaches here already handled — `MobileExplore`
   * owns the category state for those. Everything else focuses the item, and
   * the overlay decides what it can render. Navigation is still available from
   * inside that card, as an explicit action, which is the order the mode is
   * meant to have: preview, then detail, then leave.
   */
  /**
   * Declared AFTER `handleFeedAction`, deliberately.
   *
   * It depends on it now, and a `useCallback` dependency array is evaluated at
   * render — so listing a `const` declared further down the component is a
   * temporal-dead-zone ReferenceError on the first paint, not a lint nit. See
   * `scripts/lint-mobile-ratchet.mjs`, which exists because this file has hit
   * that before.
   */
  const openExploreItem = useCallback((item: ExploreItem, el?: HTMLElement) => {
    /**
     * One resolver decides; this only carries the instruction out.
     *
     * The condition here used to be the whole of Explore's routing: everything
     * that was not a `filter` got focused, and the focus overlay then tried to
     * find a matching Curate entry and apologised when it could not. See
     * `explore-resolve`.
     */
    const action = resolveExploreItem(item)
    switch (action.do) {
      case 'article':
        setExploreArticle({ url: action.url, title: action.title, source: action.source })
        return
      case 'filter':
        // Only an aggregate resolves to this now, and `MobileExplore` owns
        // category state and has already handled it. Everything else that
        // carries a `filter` DESTINATION resolves to `focus` — see
        // `explore-resolve`, where the two jobs that key was doing are split.
        return
      case 'navigate':
        // An explicit arm, not the `default:` it used to fall into. A `tab`
        // destination names a surface; focusing it instead showed the reader a
        // preview of the thing they asked to be taken to.
        handleFeedAction(action.target)
        return
      case 'unsupported':
        // Reported rather than swallowed. A tile reaching this was drawn as
        // tappable and cannot answer, which is a defect in the adapter that
        // produced it.
        console.warn('[explore] nothing to open', action.why)
        return
      default:
        setExploreOrigin(measureTile(el ?? null))
        setExploreFocus(item)
    }
  }, [handleFeedAction])

  /* `leaveExploreForAsset` is gone with the header button that called it.
     It resolved an `ExploreItem.destination` into navigation for a control
     that duplicated the actions sheet's first entry — same handler, same
     destination — and nothing else used it. */

  /**
   * The price pane, built once instead of at six call sites.
   *
   * Every kind that is about a name wants the same thing behind it, and the
   * five copies of this block that existed had already drifted: one passed
   * bands, three did not, one keyed the lookup off the traded ticker and the
   * rest off the display symbol. Returns nothing when there is no series, so
   * `panes.filter(Boolean)` keeps a card from advertising a chart it cannot
   * draw.
   */
  /**
   * Leg rows from the feed, in the shape the card builder reads.
   *
   * One place, because the two shapes disagreed silently once already.
   */
  const pairLegs = useCallback(
    (legs: any[] | null | undefined): { symbol: string }[] =>
      (legs ?? [])
        .map(l => ({ symbol: String(l?.asset?.symbol ?? l?.symbol ?? '').toUpperCase() }))
        .filter(l => !!l.symbol),
    [],
  )

  const pricePane = useCallback(
    (
      symbol: string | null | undefined,
      opts?: {
        bands?: PriceBand[]
        markers?: PriceMarker[]
        /**
         * Promote one band's distance from the price over the window return.
         *
         * The pane leads with "up 12% since May" by default, which is a fact
         * about the chart rather than about the decision. Where a card's whole
         * claim is the distance to a line — an expired target, a breached case
         * — naming the band makes the pane lead with that instead. Already
         * supported by `PricePane`; `TargetExpiredCard` passes it directly and
         * every card composing a pane through this helper could not.
         */
        compareTo?: string
      },
    ) => {
      /**
       * The pane is composed here; the DATA is fetched by the pane itself.
       *
       * ── What changed, and why it matters ────────────────────────────────
       *
       * This used to read a shared map filled by one batched query for the
       * first 24 symbols in feed order. PostgREST caps a response at 1,000
       * rows, so 24 names at 260 closes each was already seven parallel pages
       * — and the twenty-fifth card onward simply lost its chart. Not because
       * the data was missing, but because the budget had run out, which meant
       * whether a card carried evidence depended on where the reader happened
       * to be standing.
       *
       * `PricePane` fetches ONE symbol, which is 260 rows: comfortably inside
       * the cap, so it is a single request with no paging at all. The cap only
       * ever bit because the query was batched. `FeedSlot` keeps about five
       * cards mounted, so this is about five independent, individually cached
       * requests at any scroll depth.
       *
       * Only the SYMBOL is resolved synchronously here — an unresolved or
       * placeholder symbol gets no pane, because there is no honest statement
       * to make about it. The other three states (loading, drawable,
       * resolved-but-uncached) are the pane's own business.
       */
      const resolved = priceIdentity(symbol, () => undefined)
      if (!resolved.symbol) return null
      // Price history is stored under what the provider serves, which for a
      // renamed instrument is not what the holdings file called it.
      const traded = tradedSymbolOf(resolved.symbol)
      const bands = opts?.bands ?? []
      const markers = opts?.markers ?? []
      return {
        id: 'price',
        label: 'Price',
        content: (
          <PricePane
            symbol={traded}
            bands={bands}
            markers={markers}
            compareTo={opts?.compareTo}
            onExpand={(series: PricePoint[]) => setFsChart({
              symbol: traded,
              companyName: assetBySymbol.get(traded)?.companyName ?? null,
              series, bands, markers,
            })}
          />
        ),
      }
    },
    [tradedSymbolOf, assetBySymbol],
  )

  /**
   * A verdict pane, for the many cards whose only other affordance is "Open".
   *
   * The feed's problem was never that its findings were wrong, it was that most
   * of them could only be read. A card with nothing to do on it is a card people
   * learn to swipe past, and once that habit forms it applies to the cards that
   * DO matter. So every kind that can carry a proposition gets one response
   * control, and the response is recorded as a note against the name rather
   * than as a hidden vote: the desk has to be able to find it later, and an
   * opinion nobody can read is not worth collecting.
   */
  /**
   * The optional next step after a judgment, or nothing.
   *
   * ── The deduplication rule ────────────────────────────────────────────────
   *
   * Suppressed when the follow-on is the SAME action the card's own primary
   * button already offers. On a no-target card the primary is "Set a target"
   * and the `price_target` judgment's follow-on is also `set_target` — two
   * identical buttons about 150px apart, one of which is permanently visible in
   * a sticky bar. The inline one adds nothing there.
   *
   * It is a comparison of action IDS, not labels, so a rewording cannot quietly
   * defeat it. Where the actions differ — `cases_outdated` offering the case
   * editor on a card whose primary is the target editor — both render, because
   * they genuinely go to different places.
   *
   * Returns null for anything unroutable, which is the same guard Phase 4 uses:
   * a follow-on with no destination is a dead-end button, and the answer is not
   * to render it.
   */
  const resolveNextFor = useCallback(
    (card: SignalCard) => (o: VerdictOption) => {
      const id = o.nextAction?.id
      if (!id) return null
      // Feed feedback never produces an investment-workflow CTA. Saying "this
      // story is not relevant to me" must not open a thesis editor.
      if (o.intent === 'feed_quality') return null
      if (id === card.actions.primary.id) return null

      const target = resolveFeedAction(id as FeedActionKey, {
        assetId: card.entity.kind === 'asset' ? card.entity.id : null,
        symbol: card.entity.ticker ?? null,
        name: card.entity.name,
      })
      if (!target) return null
      return { label: o.nextAction!.label, run: () => onNavigate?.(target) }
    },
    [onNavigate],
  )

  const verdictPane = useCallback(
    (card: SignalCard, question: string, options: VerdictOption[]) => ({
      id: 'verdict',
      label: 'Respond',
      content: (
        <VerdictBar
          question={question}
          options={options}
          // The card's own prompt already asked this, higher up and in a style
          // a reader meets first.
          hideQuestion={card.prompt === question}
          resolveNext={resolveNextFor(card)}
          onRespond={o => applyVerdict(card, question, o)}
        />
      ),
    }),
    [applyVerdict, resolveNextFor],
  )

  /**
   * One wrapper for every migrated kind.
   *
   * All seven kinds now render through SignalCardView, so the eyebrow, severity
   * dot, claim/metric split, overflow menu, show-more control, one-screen
   * constraint and action grammar are defined once. A card that suppresses
   * renders nothing rather than falling back to a legacy tile — a suppression
   * is a decision, not a rendering failure, and gate() has already logged it
   * with its reason.
   */
  const renderCard = (
    result: ReturnType<typeof buildInsightCard>,
    trackAs: string,
    assetId: string | null,
    /**
     * Everything interactive, as ONE carousel.
     *
     * Replaces the old `evidence` + `detail` pair. Two regions meant the lower
     * one carried `flex-1` and was therefore the first to give up space, so the
     * controls under the question were what got clipped when a card ran out of
     * room. The chart, the editor and the response all page together now.
     *
     * Empty is fine: most kinds have nothing to chart and the band collapses
     * rather than leaving a gap.
     */
    panes: { id: string; label: string; content: React.ReactNode }[] = [],
    /**
     * Contextual footer wiring, for the kinds whose panes own the decision.
     *
     * Optional and absent on fifteen of the sixteen: a card whose footer is the
     * same wherever you are on it passes nothing and behaves exactly as before.
     * See `SignalCardView.primaryOverride`.
     */
    shell?: {
      onPaneChange?: (paneId: string) => void
      primaryOverride?: { id: string; label: string; disabled?: boolean; run?: () => void } | null
      /**
       * What to do with an action the card surface does not handle itself.
       *
       * ── Why this had to become a parameter ────────────────────────────────
       *
       * It was hard-coded to `() => {}` for every kind that renders through
       * here, on the reasoning that these cards' actions all resolve through
       * `resolveFeedAction`. They do not. An action id that is neither
       * routable nor `capture` lands in `onPrimary`, and a no-op there is
       * indistinguishable — to the reader — from a button that is broken.
       *
       * Attention cards are the case in point: their primary reached this and
       * stopped. Every other branch that needed a handler had already left
       * `renderCard` and built its own `SignalCardSection`, which is how a
       * missing parameter came to look like a settled decision.
       */
      onPrimary?: (card: SignalCard, actionId: string) => void
    },
  ) => {
    if (!result.ok) return null
    const card = result.card
    /**
     * No disposition gate here. There is exactly one, and it is upstream.
     *
     * ── The defect this removes ─────────────────────────────────────────────
     *
     * This used to call `isDisposedOf`, which applies `DISPOSITION_DAYS` —
     * 90 days for a settled answer. The feed's OTHER suppression rule,
     * `priorityFor`, applies `judgment-policy`'s per-key window, which is 30
     * for most confirmations. Two rules over one store, and between day 30 and
     * day 90 they disagreed: the ranking admitted the card, `FeedSlot` mounted
     * a slot for it, and this returned null — so the reader got a blank screen
     * in a snap feed with no way to tell it from a card that failed to render.
     *
     * The gate belongs where the entry is chosen, not where it is drawn, and
     * `rankFeed` already drops `priority.suppressed`. Every card type reaches
     * the feed through `rankInputFor`, including the direct-render branches
     * below, so a new type cannot bypass it without also failing to be ranked.
     */
    return (
      <div key={card.id} className="h-full w-full" ref={track({ assetId, kind: trackAs })}>
        <SignalCardSection
          card={card}
          panes={panes}
          onPaneChange={shell?.onPaneChange}
          primaryOverride={shell?.primaryOverride ?? null}
          onOpenAsset={openAsset}
          onOpenPortfolio={openPortfolio}
          onFeedAction={handleFeedAction}
          onFeedback={applyFeedback}
          onCapture={setCaptureCtx}
          onSnooze={c => triageCard(c, 'snooze')}
          onDismiss={c => triageCard(c, 'dismiss')}
          onPrimary={shell?.onPrimary ?? (() => {})}
          // Tapping the kind chip narrows the feed, exactly as the legacy
          // tile chips did. `trackAs` is the feed's own entry kind, which is
          // what kindFilter already speaks — mapping SignalType back to it
          // would be lossy in both directions.
          // The card's own category, so tapping its chip and choosing the same
          // word in Curate produce the same feed.
          onFilterKind={() => setKindFilter(categoryOf({ kind: trackAs }) ?? null)}
        />
      </div>
    )
  }

  /**
   * What the first coherent feed actually depends on.
   *
   * ── The bug this fixes ────────────────────────────────────────────────────
   *
   * The gate covered five sources — ideas, attention, signals, insights, pair
   * info — and the feed composes from ten. The five it missed include the two
   * that produce the highest-ranked cards in the product: `usePortfolioLenses`
   * (targets hit, targets expired, positions with no target) and
   * `useScenarioCards` (a price outside its own ladder). Both are tier 0 or 1.
   *
   * So the first paint happened with only the low-tier sources in hand, showed
   * whatever led those, and then a scenario gap landed and took the lead. The
   * reader saw one tile replaced by another and concluded — reasonably — that
   * the ranking had changed its mind. Nothing had; the feed had simply been
   * committed before it was composed.
   *
   * ── Critical versus enrichment ────────────────────────────────────────────
   *
   * CRITICAL means the input can change which cards exist, what tier they are,
   * or which one leads. Everything below is critical on that test, and all of
   * it now gates the first commit.
   *
   * ENRICHMENT means the input only adds decoration to a card that already
   * exists and already knows its rank. `usePriceHistory` is the clear case: a
   * missing sparkline collapses an evidence band, and no card's eligibility,
   * tier, score or order depends on it. It must NOT gate — waiting on it would
   * hold a correct feed behind a picture, and it is also the slowest input.
   *
   * `useMarketNews` and the market templates are the interesting middle. They
   * produce real cards, so they are critical for COMPLETENESS — but they are
   * tier 4, they can never lead, and they are the slowest of the content
   * sources. Gating on them would trade a stable first card for a slower one
   * and gain nothing: a news card appearing late changes nothing above it.
   */
  const composing =
    isLoading || attentionLoading || signalsLoading || insightsLoading ||
    lensesLoading || scenariosLoading || recsLoading ||
    (attentionSourceIds.length > 0 && pairInfoLoading)


  if (composing) {
    return (
      // The branded mark, not a border-radius with a spinning edge.
      //
      // `TesseractLoader` already exists and already runs at app boot, so this
      // is the same motion the reader has just seen rather than a second
      // loading vocabulary. Reused rather than rebuilt.
      //
      // No artificial minimum display time. The brief allows one to avoid a
      // single-frame flash, and it is not needed here: the gate now waits on
      // seven sources including the portfolio lenses, so a cold feed is never
      // ready inside a frame. Adding a floor would only make a warm feed slower.
      // Anchored to the viewport, not to the feed area.
      // Centred in its own box it sat below the header — so the mark stepped
      // down the screen as the boot element handed over to it, midway through
      // one wait. `LOADER_ANCHOR` is the same fixed centre the pre-JS element
      // uses, so nothing moves. See PageLoader.
      <div className={LOADER_ANCHOR} data-testid="feed-loader">
        <TesseractLoader size={96} compact text="Curating your feed…" />
      </div>
    )
  }

  if (!visibleItems.length && !attentionItems.length) {
    // The cold-start case, and the one that matters most on a phone.
    //
    // A brand-new reader's feed is empty *precisely because* they have not told
    // Tesseract what they follow — so this branch is exactly where the question
    // belongs. Found in real authenticated testing: the prompt was mounted
    // above the snap scroller further down, which this early return never
    // reaches, so a new mobile user saw "Nothing in your feed yet" and had no
    // way to fix it without opening a laptop. That is the one thing the mobile
    // brief said must not be true.
    //
    // An empty state that explains the emptiness and does nothing about it is a
    // dead end; this one offers the action that fills it.
    return (
      <div className="h-full overflow-y-auto px-4 [padding-top:calc(1rem+env(safe-area-inset-top))]">
        <FirstSessionCoveragePrompt variant="sheet" />
        <div className="flex flex-col items-center justify-center px-4 py-10 text-center">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 text-amber-400" />
          <p className="text-sm font-medium text-gray-700 dark:text-gray-200">Nothing in your feed yet</p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Ideas, thoughts and thesis updates from your team will appear here.
          </p>
        </div>
      </div>
    )
  }

  /**
   * A scenario card, as a function rather than as its own render block.
   *
   * These used to render in a `.map` above the feed, which meant they were
   * unconditionally first: a gap on a 0.4% watchlist name preceded a 12%
   * position below its bear case, and no ranking could reach them because
   * they were never in the pool. They are ordinary feed entries now, and
   * this is the same JSX moved rather than rewritten.
   */
  const renderScenarioCard = (card: any) => {
    const symbol = String(card.entity?.ticker ?? card.entity?.name ?? '')
    const assetId = String(card.entity?.assetId ?? card.entity?.id ?? '')
    const price = card.evidence.data.price
    const cases = card.evidence.data.cases as any[]
    const expected = card.evidence.data.expected

    /**
     * One derivation, used by the chart band and by nothing else.
     *
     * `hasProbabilities` is gone with the two panes it gated. `Conviction` and
     * `Reweight` rendered only for a ladder carrying a usable distribution, so
     * the card's PANE COUNT changed with the data — four panes on one name and
     * six on the next, with the two extra pages sitting between the decision
     * and its evidence. Everything they showed is on the Cases pane, beside the
     * case each number belongs to, and `Review cases` opens the editor that
     * changes any of it.
     */
    const scenarioState = deriveScenarioState(price, cases)

    /**
     * The tape, with ONE reference line: the boundary the signal is about.
     *
     * ── What was evaluated and rejected ─────────────────────────────────────
     *
     * Drawing the 52-week high and low here as well. They would be two more
     * horizontal rules on a chart whose SERIES IS the last year of closes — the
     * highest point of the line already is the 52-week high, so the rule would
     * label a coordinate the reader can see. On the ladder the same two numbers
     * carry real information, because that axis has no history on it at all.
     *
     * Drawing every case was rejected for the reason the comment below already
     * gives: a `below_all` card pins two or three off-scale and stacks their
     * labels in one corner.
     *
     * What DID change is `compareTo`. The pane leads with the window return by
     * default — "up 12% since May" — which is a fact about the chart. The
     * decision figure on this card is the distance to the case the price broke
     * through, and naming the band makes the pane lead with that instead.
     */
    /**
     * The reference line is the reason the card exists.
     *
     * This was `above_all ? highest : lowest`, so everything that was not a
     * breach of the top fell through to the BEAR case. On DASH — priced at its
     * expected value — the chart drew Bear $180 while the headline and the
     * hero were both telling the reader the number that matters is the
     * probability-weighted $244. The pane answered a question the card was not
     * asking.
     *
     * Now each state names its own boundary:
     *   above_all   the highest case, which the price has passed
     *   below_all   the lowest case, likewise
     *   at_expected the expected value itself — the claim IS the agreement
     *   otherwise   the nearer boundary, which is the one in play
     *
     * A case the reader explicitly taps still overrides this; the default only
     * decides what is drawn before they choose.
     */
    const reference: { label: string; price: number } | null = (() => {
      const pos = scenarioState?.position
      if (pos === 'above_all' && scenarioState?.highest) return scenarioState.highest
      if (pos === 'below_all' && scenarioState?.lowest) return scenarioState.lowest
      const ev = scenarioState?.expectedValue
      if (ev != null && Number.isFinite(ev)) return { label: 'Expected', price: ev }
      // Inside the range with no expectation: the nearer end is the live one.
      const lo = scenarioState?.lowest
      const hi = scenarioState?.highest
      if (lo && hi && Number.isFinite(price)) {
        return Math.abs(price - lo.price) <= Math.abs(hi.price - price) ? lo : hi
      }
      return lo ?? hi ?? null
    })()
    const breached = reference
    const priced = pricePane(card.entity.ticker, {
      bands: breached
        ? [{ label: breached.label, price: breached.price, kind: 'case' as const }]
        : [],
      /**
       * No `compareTo`.
       *
       * It named the breached case, so the chart header printed
       * `-32.4% to bull` — the distance to a CASE, beside a price, on a card
       * whose hero metric is already `+48% above your highest case of $180` in
       * 32px. Two different measurements in the same weight, and it truncated
       * to `-32.4% t…` at 390px because the row also carries a ticker, a
       * price, an expand control and six range chips.
       *
       * The header shows the window return instead. The breached case is still
       * in `bands` above, so it is still DRAWN on the plot as a labelled rule
       * at its own price — which is where a case belongs on a chart.
       */
    })

    return (
      <ScenarioGapPanes
        key={card.id}
        /* The card's own prompt, so the question the reader met above the band
           is the question the radiogroup is labelled by. */
        question={card.prompt ?? 'Has the investment view changed?'}
        ladderPane={(
          <ScenarioLadderPane
            symbol={symbol}
            price={price}
            cases={cases}
            expected={expected}
            // The ladder's age, under the axis it describes. It was the tail of
            // the card's body until the two-line clamp started eating it.
            statedOn={card.evidence.data.statedOn ?? null}
          />
        )}
        pricePane={priced ? priced.content : null}
        casesPane={(
          <ScenarioCaseDetail
            price={price}
            cases={cases}
            expected={expected}
            // The same editor "Review cases" opens. Probabilities are a field
            // on a case, so there is nowhere else for this to go and no new
            // workflow to invent.
            blockedBy={scenarioState?.expectedBlockedBy ?? null}
            onAddProbabilities={() => setTargetSheet({ assetId, symbol, price: price ?? null })}
          />
        )}
        /**
         * The existing judgment path, unchanged.
         *
         * `applyVerdict` is the same function every other card's response calls:
         * it records the disposition locally, writes the `record_judgment` audit
         * row where the entity is a real asset, and lands the option's
         * first-person note plus the reader's own words as a private quick
         * thought. Nothing about the write moved — only the control that
         * collects the answer.
         */
        onSubmit={(choice, note) => {
          const option = scenarioReviewOptions(symbol).find(o => o.key === choice.key)
          if (!option) return Promise.resolve(false)
          return applyVerdict(
            card,
            card.prompt ?? 'Has the investment view changed?',
            option,
            note || undefined,
          )
        }}
      >
        {({ panes, onPaneChange, primaryOverride }) => (
          <SignalCardSection
            card={card}
            panes={panes}
            onPaneChange={onPaneChange}
            primaryOverride={primaryOverride}
            onOpenAsset={openAsset}
            onOpenPortfolio={openPortfolio}
            onFeedAction={handleFeedAction}
            onFeedback={applyFeedback}
            onCapture={setCaptureCtx}
            onSnooze={c => triageCard(c, 'snooze')}
            onDismiss={c => triageCard(c, 'dismiss')}
            /* Nothing unrouted reaches here: the primary is `open_cases`, which
               `resolveFeedAction` resolves, and `capture` is handled by the
               section. `submit_response` never arrives — it carries its own
               `run`, which `SignalCardView` calls instead of dispatching. */
            onPrimary={() => {}}
          />
        )}
      </ScenarioGapPanes>
    )
  }

  /**
   * One feed entry, rendered.
   *
   * Extracted from the map so Explore can reuse it. A tile there opens the
   * SAME rich card Curate would show rather than a second detail surface —
   * one renderer, so the two modes cannot drift into disagreeing about what a
   * scenario gap looks like.
   */
  const renderEntry = (entry: any) => {
          // Ranked in with everything else now, rather than rendered in its own
          // block above the feed. The JSX is unchanged; only its position in the
          // list is decided differently.
          if (entry.kind === 'scenario') return renderScenarioCard(entry.card)

          if (entry.kind === 'attention') {
            const a = entry.attention
            const linked = a.context?.asset_id ? attentionAssets?.[a.context.asset_id] : null
            const target = attentionTarget(a)

            // Trade-queue-backed attention items are recommendations. Matched
            // by source_id so the card holds its place in the interleave
            // instead of jumping to the top of the feed.
            const asRecommendation = a.source_type === 'trade_queue_item' && a.source_id
              ? recommendationBySource.get(a.source_id)
              : undefined
            if (asRecommendation) {
              return (
                                <div
                  key={a.attention_id}
                  // h-full, or the SignalCardSection inside collapses to content
                  // height: `h-full` resolves against the PARENT, and a bare
                  // wrapper div has none. That is why the market card rendered at
                  // half a screen while the scenario cards — which render the
                  // section directly, with no wrapper — filled it.
                  className="h-full w-full" ref={track({ assetId: a.context?.asset_id ?? null, kind: 'attention' })}>
                  <SignalCardSection
                    /**
                     * Approve and Decline are not offered here, because this
                     * surface cannot do either.
                     *
                     * ── Two opposite buttons, one behaviour ────────────────
                     *
                     * The builder declares `approve` as the primary and
                     * `reject` as the quick action, and says why: "a
                     * recommendation you cannot answer from the feed is a
                     * notification, not a card". True — and mobile was not
                     * answering it. Neither id is a `FeedActionKey`, so both
                     * fell through `SignalCardSection` into this call site's
                     * `onPrimary`, which ignores the action id entirely and
                     * runs `markRead` + navigate. So pressing Approve and
                     * pressing Decline produced the same result, on the one
                     * card in the feed where the two are the whole point, and
                     * the reader had no way to see that.
                     *
                     * A button that says Approve must approve. The mutations
                     * exist — `useAttention` exposes `approveTradeIdea` and
                     * `rejectTradeIdea`, and three desktop surfaces call them
                     * — but wiring them here would give a phone the authority
                     * to commit a trade-queue decision, which is a product
                     * call and not a rendering one. Until it is taken, the bar
                     * says what this surface actually does.
                     *
                     * Nothing is lost that was working: the sizing bars, the
                     * rationale and the route to the decision are all still
                     * here, and the route is now the only thing claiming to be
                     * one.
                     */
                    card={{
                      ...asRecommendation.card,
                      actions: {
                        ...asRecommendation.card.actions,
                        primary: {
                          id: 'open_item',
                          label: 'Open decision',
                          inline: false,
                        },
                        quick: [{ id: 'capture', label: 'Capture', inline: true }],
                      },
                    }}
                    // What it holds against what is being asked for. The card
                    // states the proposed weight as a number; the bars put it
                    // beside the current one, which is the comparison the
                    // reader is making in their head either way.
                    //
                    // Only when both exist. `currentWeightPct` is null when the
                    // name is new to the book — a real and different case, and
                    // charting it as a bar of zero would say "we hold none of
                    // it" when the truth is "we could not look it up".
                    /**
                     * One carousel: the sizing bars and the rationale.
                     *
                     * The rationale is the one thing the decision turns on, and
                     * it sat in the lower region — the one that collapses when
                     * a card runs out of room, behind a "Read the full
                     * rationale" toggle that no longer exists.
                     */
                    panes={[
                      ...(asRecommendation.input.proposedWeightPct != null &&
                          asRecommendation.input.currentWeightPct != null ? [{
                        id: 'weights',
                        label: 'Sizing',
                        content: (
                            <WeightBars
                              baselineIndex={0}
                              rows={[
                                {
                                  label: 'Current',
                                  weightPct: asRecommendation.input.currentWeightPct,
                                  tone: 'subject',
                                  note: asRecommendation.input.currentWeightAsOf
                                    ? `book ${asRecommendation.input.currentWeightAsOf.slice(0, 10)}`
                                    : undefined,
                                },
                                {
                                  label: 'Proposed',
                                  weightPct: asRecommendation.input.proposedWeightPct,
                                  tone: 'proposed',
                                },
                              ]}
                              unitNote="Tap to see the change asked for"
                            />
                        ),
                      }] : []),
                      ...(asRecommendation.input.rationale ? [{
                        id: 'rationale',
                        label: 'The case',
                        content: (
                          <div className="text-[14px] leading-relaxed text-gray-600 dark:text-gray-300">
                            {asRecommendation.input.recommendedBy && (
                              <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-gray-400">
                                {asRecommendation.input.recommendedBy}’s case
                              </p>
                            )}
                            {/* Clamped, because a pane is a box: the full text
                                is a tap away in the commentary drawer. */}
                            <p className="line-clamp-6">{asRecommendation.input.rationale}</p>
                          </div>
                        ),
                      }] : []),
                    ]}
                    onOpenAsset={openAsset}
                    onOpenPortfolio={openPortfolio}
                    onFeedAction={handleFeedAction}
                    onFeedback={applyFeedback}
                    onCapture={setCaptureCtx}
                    // The queue's own resolution AND the feed's memory of it.
                    // `snoozeFor`/`acknowledge` settle the attention row on the
                    // server; the triage write is what stops the card returning
                    // in this feed, and every other card type gets it too.
                    onSnooze={c => { snoozeFor(a.attention_id, 24); triageCard(c, 'snooze') }}
                    onDismiss={c => { acknowledge(a.attention_id); triageCard(c, 'dismiss') }}
                    onPrimary={() => { markRead(a.attention_id); if (target) onNavigate?.(target) }}
                  />
                </div>
              )
            }

            /**
             * The two thinnest cards in the feed, given something to work with.
             *
             * "Needs review" and "Overdue" were a title, a clause and two
             * buttons — the only kinds left with an empty evidence band AND an
             * empty detail slot, which is why they read as notifications that
             * had wandered into a feed.
             *
             * The tape is the missing context. A decision waiting on somebody
             * is a decision about a name, and "what has it done since this was
             * raised" is the first thing anybody asks. The raise date goes on
             * the axis as a marker rather than into the prose, so the reader
             * sees the gap between the ask and now rather than computing it.
             */
            const attnBuilt = buildAttentionCard(a as any, linked ? {
              id: linked.id, symbol: linked.symbol,
              companyName: (linked as any).company_name ?? null,
            } : null)
            const attnRaisedAt = a.created_at ?? a.last_activity_at ?? null
            const attnPrice = pricePane(linked?.symbol, {
              markers: attnRaisedAt
                ? [{ date: attnRaisedAt, label: 'Raised', kind: 'event' as const }]
                : [],
            })
            const isDecision = a.attention_type === 'decision_required'

            return renderCard(attnBuilt,
'attention',
a.context?.asset_id ?? null,
[
...(attnPrice ? [attnPrice] : []),
...(attnBuilt.ok ? [{ id: 'verdict', label: 'Respond', content: (
<VerdictBar
                  question={isDecision ? 'What is your answer?' : 'Where does this stand?'}
                  /**
                   * The one set where the generic dispositions are a natural
                   * fit rather than a compatibility mapping. A workflow item
                   * genuinely IS done, in progress, deferred or misrouted, and
                   * those map cleanly onto settled / flagged / rejected without
                   * flattening anything an analyst meant.
                   */
                  options={isDecision
                    ? [
                        { key: 'answered', label: 'Answered', tone: 'affirm', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: answered outside the feed. Clearing it from my queue.` },
                        { key: 'in_progress', label: 'In progress', tone: 'neutral', disposition: 'flagged',
                          note: `${linked?.symbol ?? a.title}: still working through it.` },
                        { key: 'defer', label: 'Defer', tone: 'neutral', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: deferred deliberately, not forgotten.` },
                        { key: 'not_mine', label: 'Not mine', tone: 'negate', disposition: 'rejected',
                          note: `${linked?.symbol ?? a.title}: this decision is not mine to make.` },
                      ]
                    : [
                        { key: 'done', label: 'Done', tone: 'affirm', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: handled. Clearing it from my queue.` },
                        { key: 'in_progress', label: 'In progress', tone: 'neutral', disposition: 'flagged',
                          note: `${linked?.symbol ?? a.title}: in progress. Noting where it stands.` },
                        { key: 'defer', label: 'Defer', tone: 'neutral', disposition: 'settled',
                          note: `${linked?.symbol ?? a.title}: deferred deliberately, not forgotten.` },
                        { key: 'not_mine', label: 'Not mine', tone: 'negate', disposition: 'rejected',
                          note: `${linked?.symbol ?? a.title}: this is not mine to action.` },
                      ]}
                  onRespond={o => {
                    applyVerdict(attnBuilt.card, isDecision ? 'What is your answer?' : 'Where does this stand?', o)
                    // The attention engine has its own record, and a card the
                    // reader has answered should not be waiting on them there
                    // either. Local disposition alone would clear the feed and
                    // leave the queue.
                    if (o.disposition === 'settled') acknowledge(a.attention_id)
                    if (o.disposition === 'rejected') snoozeFor(a.attention_id, 24 * 7)
                  }}
                />
) }] : []),
],
              {
                /**
                 * The primary takes you to the thing being asked about.
                 *
                 * The identical handler the recommendation branch above
                 * already uses, and the reason it is here is that this branch
                 * had none: the primary fell through `renderCard`'s hard-coded
                 * no-op, so "Resolve" was a control that did nothing on every
                 * workflow card in the feed. The builder now labels it
                 * `Open <SYMBOL>` / `Open item`, which is what this does.
                 *
                 * `markRead` and not `acknowledge`: opening an item is reading
                 * it, not answering it. Answering is the verdict pane above,
                 * which acknowledges or snoozes on the reader's actual choice.
                 */
                onPrimary: () => {
                  markRead(a.attention_id)
                  if (target) onNavigate?.(target)
                },
              })
          }

          if (entry.kind === 'lens') {
            const l = entry.lens
            const built =
              l.type === 'conviction' ? buildConvictionCard(l.gap)
              : l.type === 'crowded'  ? buildCrowdingCard(l.name)
              : l.type === 'breach'   ? buildTargetHitCard(l.breach)
              : l.type === 'untargeted' ? buildNoTargetCard(l.position)
              :                         buildStaleTargetCard(l.target)
            const assetId =
              l.type === 'conviction' ? l.gap.assetId
              : l.type === 'crowded'  ? l.name.assetId
              : l.type === 'breach'   ? l.breach.assetId
              : l.type === 'untargeted' ? l.position.assetId
              :                         l.target.assetId
            const symbol =
              l.type === 'conviction' ? l.gap.symbol
              : l.type === 'crowded'  ? l.name.symbol
              : l.type === 'breach'   ? l.breach.symbol
              : l.type === 'untargeted' ? l.position.symbol
              :                         l.target.symbol

            /**
             * The expired-target card builds its own panes, in its own component.
             *
             * ── Why this one kind leaves the shared branch ──────────────────
             *
             * Every number on it has to come from ONE price, and a price is a
             * fetch. Assembled inline like the others, the chart pane fetched
             * closes while the editor beside it used the holdings mark the lens
             * carried down — the $348.06 / $142.80 split, both labelled
             * "current". A hook cannot live in a `.map` over a variable-length
             * list, so the card that needs one becomes a component.
             *
             * It still renders through `renderCard`, so dwell tracking,
             * dispositions, capture routing, feedback and navigation are the
             * shared ones rather than a second copy.
             */
            if (l.type === 'stale' && built.ok) {
              const s = l.target
              const traded = tradedSymbolOf(s.symbol)
              const staleCard = built.card
              /**
               * One commit path: MUTATE, then judge, then resolve.
               *
               * The order is the whole correctness argument. The previous
               * version recorded the judgment when the reader picked an answer
               * and opened the editor afterwards — so choosing "Keep target"
               * wrote a `settled` disposition, which suppresses the card for
               * ninety days, BEFORE any horizon existed. Backing out of the
               * picker hid a still-expired view until November.
               *
               * Now nothing is written until a mutation has actually landed.
               * A failed or cancelled flow leaves the target, the horizon, the
               * judgment log and the signal exactly as they were.
               */
              const commit = async (r: any): Promise<boolean> => {
                // The two editing flows write the target; the other two do not.
                if (r.value) {
                  const ok = await saveAnalystTarget(s.assetId, r.value.target, r.value.horizon)
                  if (!ok) return false
                }
                const option = targetReviewOptions(s.symbol).find((o: any) => o.key === r.choice.key)
                if (!option) return false
                // The reader's own words ride WITH the judgment rather than
                // becoming a second, separate record of the same decision.
                return applyVerdict(staleCard, 'What should happen to this target?', option, r.note || undefined)
              }
              return (
                <TargetExpiredCard
                  key={staleCard.id}
                  card={staleCard}
                  stale={s}
                  tradedSymbol={traded}
                  onCommit={commit}
                  /* Opening the ladder is not resolving anything. The sheet
                     carries the pending resolution and commits on save. */
                  onOpenCases={r => setTargetSheet({
                    assetId: s.assetId, symbol: s.symbol, price: null,
                    pending: { commit, resolution: r },
                  })}
                  onExpandChart={(series, bands, markers) => setFsChart({
                    symbol: traded,
                    companyName: assetBySymbol.get(traded)?.companyName ?? null,
                    series, bands, markers,
                  })}
                  render={(panes, shell) => renderCard(built, 'lens', assetId, panes, shell)}
                />
              )
            }

            /**
             * The spread behind the claim.
             *
             * Crowding says "six books hold it" and the number alone cannot
             * distinguish five token positions beside one real bet from six
             * books expressing the same view. The bars are that distinction.
             *
             * The other three lens kinds get the price pane when there is a
             * series: a target reached and a view gone stale are both claims
             * about where the tape went, and neither card could show it.
             */
            const panes: any[] = []

            /**
             * The conviction cohort: every name in this book you rated the
             * same way, with its weight.
             *
             * "High conviction, 0.4% position" invites the answer "so is
             * everything else". If the other five high-conviction names sit at
             * 4%, it is not — and nothing on the card could tell those two
             * apart before. Two or more, because a cohort of one is the
             * subject looking at itself.
             */
            if (l.type === 'conviction' && l.gap.cohort?.length > 1) {
              panes.push({
                id: 'cohort',
                // The label follows the BASIS, not the card's conviction field.
                // A ranking against the whole book captioned "high conviction"
                // would be a different claim than the one being drawn — and
                // today the book path is the only one that ever runs.
                label: l.gap.cohortBasis === 'conviction' && l.gap.conviction
                  ? `${l.gap.conviction} conviction`
                  : 'Book sizes',
                content: (
                  <WeightBars
                    rows={l.gap.cohort.map((c: { symbol: string; weightPct: number }) => ({
                      label: c.symbol,
                      weightPct: c.weightPct,
                      tone: c.symbol === l.gap.symbol ? ('subject' as const) : ('neutral' as const),
                    }))}
                    // The subject is the baseline, so every tap answers
                    // "against THIS position" rather than against the heaviest.
                    baselineIndex={Math.max(
                      l.gap.cohort.findIndex((c: { symbol: string }) => c.symbol === l.gap.symbol), 0)}
                    unitNote={l.gap.cohortBasis === 'conviction'
                      ? `Same stated conviction in ${l.gap.portfolioName}`
                      : `Every position in ${l.gap.portfolioName}`}
                  />
                ),
              })
            }
            if (l.type === 'crowded' && l.name.weightsByPortfolio?.length > 1) {
              panes.push({
                id: 'books',
                label: 'By book',
                content: (
                  <WeightBars
                    rows={l.name.weightsByPortfolio.map((w: { name: string; weightPct: number }, i: number) => ({
                      label: w.name,
                      weightPct: w.weightPct,
                      tone: i === 0 ? ('subject' as const) : ('neutral' as const),
                    }))}
                    unitNote="Weight in each portfolio · tap to compare"
                  />
                ),
              })
            }
            /**
             * The target belongs on the axis, on BOTH cards that are about one.
             *
             * This drew a band only for `breach`. The stale-target card, whose
             * entire claim is "this number has stopped being a view", therefore
             * rendered a bare price line with the number in question nowhere on
             * it — the one card in the feed where the reference line IS the
             * argument. The horizon gets a marker for the same reason: the card
             * says the view outlived its own deadline, so the deadline should be
             * a place on the chart rather than a figure in the prose.
             */
            const priceBands: PriceBand[] =
              l.type === 'breach' ? [{ label: 'Target', price: l.breach.target, kind: 'target' }]
              : []
            // `stale` draws its own band and horizon marker — see
            // `TargetExpiredCard`, which returned above.
            const priceMarkers: PriceMarker[] = []

            const priced = pricePane(symbol, { bands: priceBands, markers: priceMarkers })
            if (priced) panes.push(priced)

            // The pane ranks, the detail carries the rest — the same split
            // `active-risk-real` uses, and what keeps a card with six books on
            // it from either truncating silently or growing past its screen.
            // A conviction card's claim is that the size and the view disagree.
            // The control that answers it is the same one the active-risk card
            // carries — and deliberately NOT a second copy of the bars above,
            // because within one book value and weight rank identically, so a
            // money view here would be the same chart twice.
            const convictionDetail = l.type === 'conviction'
              ? (
                  <SizeExplorer
                    symbol={l.gap.symbol}
                    currentPct={l.gap.weightPct}
                    /**
                     * The index weight for this name in this book.
                     *
                     * It was hard-coded null, so the oversized card could not
                     * say what the active weight was — on a card whose entire
                     * claim is that a position is too big. The lens reads the
                     * benchmark file now, and returns null only where the
                     * portfolio has none: there "active" genuinely has no
                     * meaning, and the row stays absent rather than reading an
                     * empty table as a zero.
                     */
                    benchmarkPct={l.gap.benchmarkPct}
                    onStage={(proposedPct: number) => setCaptureCtx({
                      assetId: l.gap.assetId,
                      symbol: l.gap.symbol,
                      name: l.gap.companyName ?? l.gap.symbol,
                      kind: 'thought',
                      note: `${l.gap.symbol} at ${proposedPct.toFixed(2)}% instead of ${
                        l.gap.weightPct.toFixed(2)}% in ${l.gap.portfolioName}. Stated conviction ${
                        l.gap.conviction ?? 'not recorded'}. Weights from the holdings snapshot of ${
                        l.gap.asOf.slice(0, 10)}. Recorded from the feed; the position is unchanged.`,
                    })}
                  />
                )
              : undefined

            const lensDetail = l.type === 'crowded' && l.name.weightsByPortfolio?.length > 1
              ? (
                  <WeightBars
                    // Money, not weight — a different fact, not a repeat of the
                    // pane above it. A 25% weight in a small book can be a
                    // fraction of a 4% weight in a large one, and "crowded" is
                    // a claim about the firm's money rather than about any one
                    // book's percentages.
                    unit="usd"
                    rows={l.name.weightsByPortfolio.map(
                      (w: { name: string; weightPct: number; valueUsd: number }) => ({
                        label: w.name, weightPct: w.valueUsd,
                      }))}
                    limit={12}
                    unitNote="Exposure by book · tap to compare"
                  />
                )
              : undefined

            /**
             * The target control, for the cards that still assemble one here.
             *
             * The stale-target branch is gone from this chain: that card's
             * editor is no longer a permanent pane at all — it opens from the
             * REVIEW choice that asks for it, and it needs the card's canonical
             * price, which is why it lives in `TargetExpiredCard`.
             *
             * "Your view has outlived its horizon" and "the price reached your
             * target" both end in the same question: what is the number now?
             * Until this, the only answer either card offered was to leave the
             * feed. The tuner puts the arithmetic in front of the reader and
             * records what they land on, which is the most a feed can honestly
             * do with somebody else's research artifact.
             */
            const targetDetail =
              l.type === 'breach' ? (
                /**
                 * The whole ladder, selectable.
                 *
                 * A target IS a case — every row in `analyst_price_targets`
                 * belongs to a scenario — so "target reached" with no way to
                 * see or change WHICH case is asking the reader to edit a
                 * number whose identity they cannot check. Where the name has
                 * a ladder they pick the case and edit that one. Where it has
                 * a single row there is nothing to choose, and the simpler
                 * control is the honest one rather than a selector with one
                 * option.
                 */
                l.breach.cases.length > 1 ? (
                  <CaseChartPane
                    onEditCase={() => setTargetSheet({
                      assetId: l.breach.assetId, symbol: l.breach.symbol, price: l.breach.price,
                    })}
                    symbol={l.breach.symbol}
                    cases={l.breach.cases}
                    currentPrice={l.breach.price}
                    onSave={(caseId, price) => saveCasePriceById(caseId, price)}
                    onAddCase={() => setNewCaseSheet({
                      assetId: l.breach.assetId, symbol: l.breach.symbol, seedPrice: l.breach.price,
                    })}
                  />
                ) : (
                <TargetExplorer
                  symbol={l.breach.symbol}
                  recordedTarget={l.breach.target}
                  currentPrice={l.breach.price}
                  referenceLabel="Current price"
                  // Saves the TARGET. The note that used to be all this did is
                  // gone: a control labelled "save target" that wrote prose and
                  // left the stored number alone was the reported confusion.
                  onSave={t => { void saveAnalystTarget(l.breach.assetId, t); setCaptureCtx({
                    assetId: l.breach.assetId,
                    symbol: l.breach.symbol,
                    name: l.breach.companyName ?? l.breach.symbol,
                    kind: 'thought',
                    note: `${l.breach.symbol} target restated at $${t.toFixed(2)}, against a standing $${
                      l.breach.target.toFixed(2)} the price has already passed. Book mark $${
                      l.breach.price.toFixed(2)}. Recorded from the feed alongside the saved target.`,
                  }) }}
                />
                )
              ) : l.type === 'untargeted' ? (
                /**
                 * The whole ladder, in one pass.
                 *
                 * This was `TargetExplorer`: case-name chips over a slider,
                 * setting ONE number under ONE name. So the card offered Bear,
                 * Base and Bull and then made the analyst run the control three
                 * times to get them — with no way to see the three numbers
                 * together while choosing, which is the only reason to have
                 * three. A ladder is one judgement about a spread; it is
                 * entered as one.
                 *
                 * The slider went with it. A slider needs a range, and pricing
                 * a name that has never been priced is exactly the case where
                 * nobody knows what the range is — the old control had to
                 * invent track bounds around a number that did not exist.
                 */
                <LadderPane
                  symbol={l.position.symbol}
                  /**
                   * The drawer is the only way anything is written.
                   *
                   * The card used to write all three rungs on one button, with
                   * nulls for the horizon, probability and reasoning it had no
                   * room to collect — three bare numbers somebody would have to
                   * interpret later, which is the complaint this area began
                   * with. One tap more per case buys all four fields.
                   */
                  onOpenDetails={(name, horizon) => {
                    // The case NAME is prefilled and the price field is left
                    // empty, because the card no longer holds a price and must
                    // not smuggle one in here either. `seedPrice` is the book
                    // mark, which is what the drawer shows the new case
                    // against — context, not a prefilled answer.
                    setNewCaseName(name)
                    setNewCasePrice('')
                    setNewCaseHorizon(horizon)
                    setNewCaseSheet({
                      assetId: l.position.assetId,
                      symbol: l.position.symbol,
                      seedPrice: l.position.price,
                      seedName: name,
                    })
                  }}
                />
              ) : undefined

            // A response for the kinds with no number to move. Crowding and a
            // conviction gap are propositions about the book, and a reader who
            // disagrees currently has nowhere to say so.
            /**
             * Three dispositions, in the same order on every kind.
             *
             * Left is "handled, stop asking", middle is "real, and it needs
             * work", right is "this is not a useful thing to tell me about this
             * name". The wording is kind-specific because a target and a
             * position size are not answered with the same words, but the
             * POSITION of each answer is fixed, so the gesture is learnable
             * across a feed that mixes seven kinds.
             */
            const lensVerdict = built.ok ? verdictPane(
              built.card,
              l.type === 'breach' ? 'What should happen next?'
                : l.type === 'crowded' ? `Is ${symbol} too much of one bet?`
                // Asks whether a target BELONGS here. The old question,
                // "How is this position being valued?", presumed the absence
                // was an oversight and asked the analyst to defend their
                // process — on a card that only knows one field is empty.
                : l.type === 'untargeted' ? 'Does this position need a price target?'
                : 'Does the size match the view?',
              l.type === 'untargeted'
                /**
                 * Does this position need a price target?
                 *
                 * The KEYS are unchanged and deliberately so. `price_target`,
                 * `case_framework` and `not_price_driven` already carry exactly
                 * these three meanings, they are classified in
                 * `judgment-policy.ts` (with `not_price_driven` resolving the
                 * no-target signal), and every one already recorded means what
                 * the new label says. Renaming them would orphan those records
                 * for no gain — Phase 3's rule is to classify what exists, not
                 * to retranslate it. Only the labels move, to match the
                 * narrower question.
                 *
                 * `needs_work` is the exception and is genuinely replaced. It
                 * answered "the valuation basis needs work", which is not an
                 * answer to "does this need a target" at all. `not_now` is.
                 *
                 * `not_price_driven` maps to `settled`, NOT `rejected`. A
                 * position held on a framework that does not reduce to a price
                 * target is a legitimate investment process, and the earlier
                 * set had no way to say so: the nearest option was "Not
                 * useful", which files a deliberate methodology under feed spam.
                 */
                ? [
                    { key: 'price_target', label: 'Yes', tone: 'affirm', disposition: 'flagged',
                      note: `${symbol}: this position should carry a price target. Recording that it needs one.`,
                      nextAction: { id: 'set_target', label: 'Set target' } },
                    { key: 'case_framework', label: 'I use cases', tone: 'affirm', disposition: 'flagged',
                      note: `${symbol}: valued on a scenario ladder rather than a single target.`,
                      nextAction: { id: 'open_cases', label: 'Build cases' } },
                    { key: 'not_price_driven', label: 'Not target-driven', tone: 'neutral', disposition: 'settled',
                      note: `${symbol}: held on a thesis that does not reduce to a price. Deliberate, not an oversight.` },
                    { key: 'not_now', label: 'Not now', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: a target question worth answering, but not today. Deferred from the feed.` },
                  ]
                // What should happen next? These are the reader's intended next
                // steps. Tesseract is prompting, not recommending one.
                : l.type === 'breach'
                ? [
                    { key: 'revise_target', label: 'Revise target', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the target needs revising now the price has reached it.`,
                      nextAction: { id: 'set_target', label: 'Revise target' } },
                    { key: 'hold_as_is', label: 'Hold as-is', tone: 'affirm', disposition: 'settled',
                      note: `${symbol}: holding at this level deliberately, target unchanged.` },
                    { key: 'reduce_exit', label: 'Reduce / exit', tone: 'negate', disposition: 'flagged',
                      note: `${symbol}: reaching the target is the trigger to reduce or exit.` },
                    { key: 'reunderwrite', label: 'Re-underwrite', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the whole case needs re-underwriting rather than a new number.`,
                      // Re-underwriting is rewriting the case, which is the
                      // thesis field. Deliberately NOT a trade or sizing flow:
                      // `reduce_exit` gets no follow-on at all for that reason.
                      nextAction: { id: 'update_thesis', label: 'Review thesis' } },
                  ]
                : [
                    { key: 'sized_right', label: 'Sized right', tone: 'affirm', disposition: 'settled',
                      note: `${symbol}: the current size is deliberate and I am comfortable with it.` },
                    { key: 'size_wrong', label: 'Size is wrong', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the size and the view disagree and the size is the part that is wrong.` },
                    { key: 'view_stale', label: 'View is stale', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: the size is fine; the stated view behind it is what needs updating.` },
                    { key: 'needs_review', label: 'Review', tone: 'neutral', disposition: 'flagged',
                      note: `${symbol}: needs a proper review before I would call it either way.` },
                  ],
            ) : null

            /**
             * Detail is a carousel now, not a single control.
             *
             * The slot used to hold exactly one thing, so a card could offer the
             * tuner or the verdict but never both, and the choice was made in
             * this file by an `??` chain. Paging them sideways is the same move
             * the scenario card already makes with its cases and its reweight
             * editor, and it is what lets every lens card carry three things a
             * reader can work: the chart, a second pane, and a control.
             */
            const detailPanes = [
              ...(targetDetail ? [{ id: 'tune', label: 'Target', content: targetDetail }] : []),
              ...(convictionDetail ? [{ id: 'size', label: 'Size', content: convictionDetail }] : []),
              ...(lensDetail ? [{ id: 'money', label: 'Money', content: lensDetail }] : []),
              ...(lensVerdict ? [lensVerdict] : []),
            ]

            return renderCard(
              built, 'lens', assetId,
              // One carousel: the evidence panes and the controls together.
              [...panes, ...detailPanes],
            )
          }

          if (entry.kind === 'insight') {
            const ins = entry.insight
            // Research staleness is a claim about a name, so the tape behind it
            // is the same evidence every other name-shaped card gets. This kind
            // rendered with an empty evidence band and an empty detail slot.
            // The gap ON the axis, not counted at the reader. A marker where
            // research last happened turns "179 days" into a visible distance
            // between a point on the line and its right-hand edge.
            const insightPrice = pricePane(ins.symbol, {
              markers: ins.lastTouchedAt
                ? [{ date: ins.lastTouchedAt, label: 'Last written', kind: 'event' as const }]
                : [],
            })
            // Built once. The handler needs the card to record a disposition
            // against its type and entity, and rebuilding it inside the closure
            // ran the whole builder — suppression gates included — on every tap.
            const insightBuilt = buildInsightCard(ins)
            return renderCard(insightBuilt,
'insight',
ins.assetId ?? null,
[
...(insightPrice ? [insightPrice] : []),
...(insightBuilt.ok ? [
                    {
                      id: 'start',
                      label: 'Start',
                      content: (
                        <ResearchStarter
                          symbol={ins.symbol}
                          daysSince={ins.daysSinceActivity}
                          onStart={(_p, note, kind) => {
                            // The thesis is a FIELD, not a note about a field.
                            // See the thesis sheet: it mounts the asset page's
                            // own editor, so this is the same write the desktop
                            // makes, reached without leaving the card.
                            if (kind === 'thesis' && ins.assetId) {
                              setThesisSheet({ assetId: ins.assetId, symbol: ins.symbol ?? '' })
                              return
                            }
                            setCaptureCtx({
                            assetId: ins.assetId ?? null,
                            symbol: ins.symbol ?? null,
                            name: ins.companyName ?? ins.symbol ?? null,
                            kind: kind === 'prompt' ? 'prompt' : 'thought',
                            note,
                            })
                          }}
                        />
                      ),
                    },
                    {
                      id: 'verdict',
                      label: 'Respond',
                      content: (
                <VerdictBar
                  question={insightBuilt.card.type === 'no_research'
                    ? 'What best describes this position?'
                    : 'Does this change need a look?'}
                  options={insightBuilt.card.type === 'no_research'
                    /**
                     * A position with no written research is not automatically
                     * a failure. It is routinely a legacy holding, or one
                     * somebody else covers, and the old set could only say
                     * "covered" or "needs a refresh" — neither of which is
                     * true of either case.
                     */
                    ? [
                        { key: 'active_thesis', label: 'Active thesis', tone: 'affirm', disposition: 'settled',
                          note: `${ins.symbol}: there is an active thesis; it has not been written up here.`,
                          // The strongest follow-on on the surface: the reader
                          // has just said a view exists and the product has no
                          // record of it. Offered, never forced.
                          nextAction: { id: 'add_rationale', label: 'Add rationale' } },
                        { key: 'legacy_position', label: 'Legacy position', tone: 'neutral', disposition: 'settled',
                          note: `${ins.symbol}: a legacy position carried rather than actively underwritten.` },
                        { key: 'owned_elsewhere', label: 'Someone else owns it', tone: 'neutral', disposition: 'settled',
                          note: `${ins.symbol}: covered by someone else; the research lives with them.`,
                          nextAction: { id: 'open_coverage', label: 'Open coverage' } },
                        { key: 'needs_review', label: 'Needs review', tone: 'negate', disposition: 'flagged',
                          note: `${ins.symbol}: genuinely uncovered and it needs review. Flagged from the feed.`,
                          nextAction: { id: 'add_rationale', label: 'Add rationale' } },
                      ]
                    // Three, not four. A fourth added purely for visual
                    // symmetry would be an answer nobody meant.
                    /**
                     * Three, matched to the new trigger.
                     *
                     * The card now asserts that something changed and the view
                     * did not follow, so the answers are about that change:
                     * the view already accounts for it, it needs revising, or
                     * nobody is covering this name any more. No fourth option
                     * was added for symmetry.
                     */
                    : [
                        { key: 'change_accounted_for', label: 'View holds', tone: 'affirm', disposition: 'settled',
                          note: `${ins.symbol}: the recorded view already accounts for this. Reaffirmed from the feed.` },
                        { key: 'view_needs_update', label: 'Needs update', tone: 'neutral', disposition: 'flagged',
                          note: `${ins.symbol}: the written view needs updating for this. Flagged from the feed.`,
                          nextAction: { id: 'update_thesis', label: 'Update thesis' } },
                        { key: 'no_longer_covered', label: 'No longer covered', tone: 'negate', disposition: 'settled',
                          note: `${ins.symbol}: no longer actively covered. Recording that rather than leaving it ambiguous.` },
                      ]}
                  onRespond={o => applyVerdict(insightBuilt.card, `Does ${ins.symbol} need work?`, o)}
                />
                      ),
                    },
                  ] : []),
])
          }

          if (entry.kind === 'signal') {
            const sigAsset = (entry.signal.relatedAssets?.[0] as any) ?? null
            const sigPrice = pricePane(sigAsset?.symbol)
            const sigBuilt = buildIdeasSignalCard(entry.signal as any)
            return renderCard(
              sigBuilt,
              'signal',
              sigAsset?.id ?? null,
              // Team focus, a coverage gap and a thesis conflict are all
              // observations about the desk, and the reader is on the desk. A
              // card about what everyone is looking at with no way to say "that
              // is not the interesting part" is a broadcast, not a feed.
              [
                ...(sigPrice ? [sigPrice] : []),
                ...(sigAsset ? [{ id: 'verdict', label: 'Respond', content: (

                    <VerdictBar
                      /**
                       * DELIBERATELY LEFT ON ITS EXISTING BEHAVIOUR.
                       *
                       * This card fires on "the desk has been quiet on this
                       * name" and similar attention clustering. That is not
                       * enough context to support an investment judgment: there
                       * is no price event, no target, no catalyst and no
                       * position change behind it, so any option set naming a
                       * thesis would be asking the reader to rule on something
                       * the signal never established.
                       *
                       * Its current options are a mix of investment view and
                       * feed feedback, which is exactly what the rest of this
                       * phase separated. Fixing it properly needs the SIGNAL to
                       * carry a reason to revisit — a move, a catalyst, a size
                       * change — not a better set of buttons. Left intact, keys
                       * normalised, and the feed-quality option marked so it
                       * can move to the overflow with the others.
                       */
                      question="Is the desk looking at the right thing?"
                      options={[
                        { key: 'agree', label: 'Agree', tone: 'affirm', disposition: 'settled',
                          note: `${sigAsset.symbol}: agreed, this is where the attention belongs right now.` },
                        // Key says what it means; the label already worked.
                        { key: 'discussion_warranted', label: 'Worth a talk', tone: 'neutral', disposition: 'flagged',
                          note: `${sigAsset.symbol}: worth a conversation before the desk commits more time here.` },
                        /**
                         * Stays in the judgment layer, reworded.
                         *
                         * It was labelled "Not useful" and tagged feed_quality, but its
                         * note says "I do not think this is the thing worth the desk's
                         * attention" — a view about where research effort should go, not
                         * a complaint that the card was shown. Moving it to the overflow
                         * would have discarded a process judgment because its label
                         * sounded like feedback. The label now matches the meaning.
                         */
                        { key: 'attention_misplaced', label: 'Not the priority', tone: 'negate', disposition: 'flagged',
                          note: `${sigAsset.symbol}: I do not think this is the thing worth the desk's attention.` },
                      ]}
                      onRespond={o => { if (sigBuilt.ok) applyVerdict(sigBuilt.card, "Is the desk looking at the right thing?", o) }}
                    />
                ) }] : []),
              ],
            )
          }

          if (entry.kind === 'template') {
            const c = entry.card

            // active_risk has its own builder — benchmark provenance and a peer
            // pane the flat template shape cannot carry.
            if (c.kind === 'active_risk' && c.assetId) {
              const built = activeRiskByAsset.get(c.assetId)
              if (built) {
                const { card, input } = built
                return (
                  <div key={c.id} className="h-full w-full" ref={track({ assetId: c.assetId ?? null, kind: 'template' })}>
                    <SignalCardSection
                      card={card}
                      // The peer ranking, which the builder has always declared
                      // as `evidence: peer_bar` and the feed has never passed a
                      // node for — so `hasEvidence` was false and the band
                      // collapsed. One active weight in isolation says nothing
                      // about whether it is the book's biggest bet or its fifth.
                      /**
                       * One carousel: the peer ranking, the tape, the sizing
                       * control and the response.
                       *
                       * Active risk carried the most content of any card and
                       * split it across two regions, the lower of which is the
                       * one that collapses under pressure.
                       */
                      panes={[...(() => {
                        const panes = []
                        if (activeRiskPeers.length > 0) {
                          panes.push({
                            id: 'weight',
                            label: 'Active weight',
                            content: (
                              <ActiveWeightPeers
                                subject={input.symbol}
                                peers={activeRiskPeers}
                                heldCount={activeRiskPeers.length}
                                notHeldCount={activeRisk.notHeldCount}
                                notHeldActivePct={activeRisk.notHeldActivePct}
                              />
                            ),
                          })
                        }
                        /**
                         * Through `pricePane`, which fetches this card's own
                         * symbol.
                         *
                         * The comment here used to say the cache covered eight
                         * symbols, which had been wrong for months —
                         * `price_history_cache` holds 135 symbols and ~34k
                         * rows. The real bound was `usePriceHistory`'s
                         * MAX_SYMBOLS: the first 24 names in FEED ORDER, so a
                         * card lacked a chart because it sat deep in the feed,
                         * not because the data was missing.
                         *
                         * That budget is gone — a per-symbol read is 260 rows
                         * and needs no paging — and with it the reason this
                         * branch had its own copy of the availability rule.
                         * `pricePane` also resolves the traded ticker, which a
                         * renamed instrument needs and which this had to do by
                         * hand.
                         */
                        const p = pricePane(input.symbol)
                        if (p) panes.push(p)
                        return panes
                      })(),
                      // The question this card provokes is "what if it were
                      // smaller", and until now the only way to answer it was
                      // to leave the feed and do the arithmetic elsewhere.
                      //
                      // The hold RECORDS the proposed size as a thought against
                      // the name — it does not change the position and the
                      // label does not claim it does. Sizing is a PM decision
                      // taken in Trade Lab; what a feed can honestly do is
                      // capture the number you arrived at, with its provenance
                      // attached, so the desk finds it instead of losing it.
                      // Two panes, like every other card that carries a
                      // control: the sizing question the card provokes, and the
                      // disposition that decides whether it comes back. This
                      // kind was the last one where a reader could explore an
                      // answer but not record having reached one.
                      ...[
                            {
                              id: 'size',
                              label: 'Size',
                              content: (
                                <SizeExplorer
                                  symbol={input.symbol}
                                  currentPct={input.weightPct}
                                  benchmarkPct={input.benchmarkWeightPct}
                                  onStage={(proposedPct: number) => setCaptureCtx({
                                    assetId: input.assetId,
                                    symbol: input.symbol,
                                    name: input.companyName ?? input.symbol,
                                    kind: 'thought',
                                    note: whatIfNote(input, proposedPct),
                                  })}
                                />
                              ),
                            },
                            verdictPane(
                              card,
                              `Is the ${input.symbol} bet the right size?`,
                              [
                                { key: 'sized_right', label: 'Sized right', tone: 'affirm', disposition: 'settled',
                                  note: `${input.symbol}: the active weight is deliberate and I am comfortable with it.` },
                                { key: 'trim', label: 'Trim it', tone: 'neutral', disposition: 'flagged',
                                  note: `${input.symbol}: the active weight is larger than the view supports.` },
                                { key: 'add', label: 'Add to it', tone: 'neutral', disposition: 'flagged',
                                  note: `${input.symbol}: the view supports more than the current active weight.` },
                                { key: 'needs_review', label: 'Review', tone: 'neutral', disposition: 'flagged',
                                  note: `${input.symbol}: the active weight needs a proper review. Flagged from the feed.` },
                              ],
                            ),
                          ],
                      ]}
                      onOpenAsset={openAsset}
                      onOpenPortfolio={openPortfolio}
                      onFeedAction={handleFeedAction}
                      onFeedback={applyFeedback}
                      onCapture={setCaptureCtx}
                      onSnooze={c => triageCard(c, 'snooze')}
                      onDismiss={c => triageCard(c, 'dismiss')}
                      onPrimary={() => {}}
                    />
                  </div>
                )
              }
            }

            /**
             * The market templates get the tape, which is what they are about.
             *
             * An unusual move, an earnings reaction and a corporate action are
             * all statements about a price path, and every one of them rendered
             * as a headline over an empty band. A macro release has no ticker
             * and correctly gets nothing: `pricePane` returns null and the
             * carousel is skipped rather than showing an empty pane.
             */
            const tplPrice = pricePane(c.symbol)
            const tplBuilt = buildTemplateCard(c)
            return renderCard(tplBuilt,
'template',
c.assetId ?? null,
[
...(tplPrice ? [tplPrice] : []),
...(c.symbol ? [{ id: 'verdict', label: 'Respond', content: (
<VerdictBar
                      question={`Does this change anything for ${c.symbol}?`}
                      options={[
                        { key: 'priced_in', label: 'Priced in', tone: 'affirm', disposition: 'settled',
                          note: `${c.symbol}: the move is noise against the thesis. No action.` },
                        { key: 'thesis_relevant', label: 'Hits the thesis', tone: 'neutral', disposition: 'flagged',
                          note: `${c.symbol}: this affects the thesis and needs following up. Flagged from the feed.` },
                        // `not_relevant` moved to the overflow menu, for the same reason
                        // as news: it was about surfacing, not about the position.
                      ]}
                      onRespond={o => { if (tplBuilt.ok) applyVerdict(tplBuilt.card, `Does this change anything for ${c.symbol}?`, o) }}
                    />
) }] : []),
])
          }

          if (entry.kind === 'news') {
            const n = entry.news
            /**
             * The story's subject, decided by the SOURCE — never by a search
             * over our own holdings. See `news-chart` for why the previous
             * `symbols.map(...).find(Boolean)` produced MSFT charts on stories
             * that had nothing to do with Microsoft.
             */
            const newsChart = newsChartSymbol({ primarySymbol: n.primarySymbol, symbols: n.symbols })
            /**
             * `linked` is now ONLY the asset record behind a symbol the source
             * actually named, and is used for naming and navigation. It is no
             * longer allowed to pick a chart: an arbitrary tagged name that we
             * happen to own is not what a story is about.
             */
            const linked = newsChart.symbol
              ? (assetBySymbol.get(newsChart.symbol) ?? null)
              : null

            {
              // No quote is passed. The feed's quote map has no per-symbol
              // timestamp to check freshness against, and the builder must not
              // be handed a number it cannot date — that is the exact shape of
              // the placeholder bug. A news card with no move is correct; a
              // news card with an undateable move is not.
              const built = buildNewsCard({
                id: n.id, headline: n.headline, summary: n.summary ?? null,
                url: n.url, source: n.source, publishedAt: n.publishedAt,
                primarySymbol: n.primarySymbol ?? null, symbols: n.symbols,
                sentiment: n.sentiment ?? null,
                asset: linked ? { id: linked.id, symbol: linked.symbol, companyName: (linked as any).company_name ?? null } : null,
                heldIn: [], maxWeightPct: null, quote: null,
              })
              // Suppressed cards render nothing at all. The suppression is
              // already logged with its reason by gate().
              if (!built.ok) return null
              // A story about a name the book holds, with no way to see what the
              // name did and no way to say what you make of it, is a headline
              // the reader could have got anywhere.
              /**
               * One labelled chart per name the story mentions.
               *
               * The rule used to be "the declared primary, or nothing",
               * because picking one of several would assert a subject the
               * source never declared — the defect that put MSFT under
               * unrelated headlines.
               *
               * Showing them ALL is a different claim, and an honest one: a
               * carousel of labelled charts says "these are the names this
               * story mentions", which is exactly what the provider tagged.
               * Nothing is implied about primacy because nothing is singled
               * out, and the declared primary still leads where there is one.
               */
              const newsPanes = newsChartSymbols({ primarySymbol: n.primarySymbol, symbols: n.symbols })
                .map(sym => {
                  const pane = pricePane(sym)
                  // Distinct ids, or the carousel keys two panes the same and
                  // renders only one of them.
                  return pane ? { ...pane, id: `price:${sym}`, label: sym } : null
                })
                .filter(Boolean) as { id: string; label: string; content: React.ReactNode }[]
              return (
                <div key={n.id} className="h-full w-full" ref={track({ assetId: linked?.id ?? null, kind: 'news' })}>
                  <SignalCardSection
                    card={built.card}
                    /**
                     * One carousel: the tape and the response page together.
                     *
                     * Reported from a phone as "news tiles are not showing
                     * interactive objects" — the chart was there but it was the
                     * whole of the evidence band while the judgment sat in a
                     * separate region below the question, which is the region
                     * that collapses when a card runs out of room.
                     */
                    panes={[
                      ...newsPanes,
                      ...(linked ? [{
                        id: 'verdict',
                        label: 'Respond',
                        content: (
                            <VerdictBar
                              question={`What does this mean for ${linked.symbol}?`}
                              options={[
                                { key: 'priced_in', label: 'Already priced', tone: 'affirm', disposition: 'settled',
                                  note: `${linked.symbol}: this story is already in the price and does not move the thesis.` },
                                { key: 'thesis_relevant', label: 'Hits the thesis', tone: 'neutral', disposition: 'flagged',
                                  note: `${linked.symbol}: this bears directly on the thesis and needs a proper look.` },
                                // `not_relevant` moved to the overflow menu. Its note read
                                // "news on this name is not worth SURFACING to me", which is a
                                // complaint about the feed rather than a view about the
                                // position — and the investment reading of it, "this does not
                                // move the thesis", is already what `priced_in` says.
                              ]}
                              onRespond={o => applyVerdict(built.card, `What does this mean for ${linked.symbol}?`, o)}
                            />
                        ),
                      }] : []),
                    ]}
                    onOpenAsset={openAsset}
                    onOpenPortfolio={openPortfolio}
                    onFeedAction={handleFeedAction}
                    onFeedback={applyFeedback}
                    onCapture={setCaptureCtx}
                    onSnooze={c => triageCard(c, 'snooze')}
                    onDismiss={c => triageCard(c, 'dismiss')}
                    /**
                     * Read opens the publisher's page.
                     *
                     * This was `() => {}`. Every action the card could not
                     * resolve elsewhere landed here and was dropped — so Read
                     * and Open source were buttons that did nothing, and
                     * nothing said so.
                     *
                     * `noopener,noreferrer` because this is somebody else's
                     * page: without it the opened tab gets a handle on this one
                     * through `window.opener`.
                     */
                    onPrimary={(_c, actionId) => {
                      if (actionId === 'read' && n.url) {
                        window.open(n.url, '_blank', 'noopener,noreferrer')
                      }
                    }}
                  />
                </div>
              )
            }
          }

          const item = entry.idea
          const source = readthroughSourceType(item.type)
          const itemAssetId = ('asset' in item && item.asset ? item.asset.id : null) as string | null
          const itemAuthorId = item.author?.id ?? null
          const note = (signal: 'reaction' | 'share' | 'open' | 'readthrough') =>
            userId && recordInterest({ userId, signal, assetId: itemAssetId, authorId: itemAuthorId, kind: 'idea' })

          /**
           * Posts render as cards too, as of 2026-08-19.
           *
           * They were the last kinds outside the contract — a colleague's trade
           * idea sat next to an active-risk card wearing entirely different
           * furniture, in the same scroller. That is the "two products"
           * complaint the whole migration existed to end, surviving in the one
           * place nobody counted because posts were never among "the seven
           * kinds".
           *
           * Everything the old vertical action rail offered survives, in the
           * card's menu: ask, share, promote, readthrough. A migration that
           * looks tidier while quietly dropping functionality is the worst
           * kind, so the builder only offers what this call site can honour.
           */
          const itemAsset = ('asset' in item && item.asset ? item.asset : null) as any
          const built = buildIdeaCard(
            {
              id: item.id,
              type: item.type as any,
              content: (item as any).content ?? null,
              title: (item as any).title ?? null,
              createdAt: item.created_at,
              authorName: item.author?.full_name
                || [item.author?.first_name, item.author?.last_name].filter(Boolean).join(' ')
                || item.author?.email?.split('@')[0]
                || null,
              asset: itemAsset
                ? { id: itemAsset.id, symbol: itemAsset.symbol, companyName: itemAsset.company_name ?? null }
                : null,
              action: (item as any).action ?? null,
              urgency: (item as any).urgency ?? null,
              rationale: (item as any).rationale ?? null,
              portfolioName: (item as any).portfolio?.name ?? null,
              /**
               * The legs, reshaped to what the builder reads.
               *
               * `useIdeasFeed` emits `{ id, action, asset: { symbol } }` per
               * leg; the builder reads `l.symbol`. So every leg resolved to
               * undefined and the headline fell back to "proposed a pair
               * trade" with both sides blank — reported as pair tiles not
               * showing their legs.
               *
               * Two shapes that were never checked against each other, because
               * nothing typed the boundary between them.
               */
              longLegs: pairLegs((item as any).long_legs),
              shortLegs: pairLegs((item as any).short_legs),
              sentiment: (item as any).sentiment ?? null,
            },
            {
              share: true,
              ask: true,
              // Only a quick thought can become a trade idea.
              promote: item.type === 'quick_thought',
              readthrough: !!source,
            },
          )
          if (!built.ok) return null

          /**
           * A pair gets a chart PER LEG, not one chart for whichever side
           * happened to be first.
           *
           * The card's subject was `long_legs[0].asset`, so a long/short pair
           * showed the long leg's tape and nothing else — which quietly
           * asserts the trade is about that name. A pair is a claim about a
           * RELATIONSHIP, and the two tapes side by side in the carousel are
           * the evidence for it.
           */
          const legPanes = item.type === 'pair_trade'
            ? [
                ...pairLegs((item as any).long_legs).map(l => ({ side: 'Long', symbol: l.symbol })),
                ...pairLegs((item as any).short_legs).map(l => ({ side: 'Short', symbol: l.symbol })),
              ]
                .filter(l => !!l.symbol)
                .map(l => {
                  const p = pricePane(l.symbol)
                  // Distinct ids, or the carousel keys two panes the same and
                  // React renders one of them.
                  return p ? { ...p, id: `price:${l.side}:${l.symbol}`, label: `${l.side} ${l.symbol}` } : null
                })
                .filter(Boolean) as { id: string; label: string; content: React.ReactNode }[]
            : []

          const ideaPrice = item.type === 'pair_trade' ? null : pricePane(itemAsset?.symbol)

          /**
           * A colleague's post is the most obviously answerable thing in the
           * feed, and it was the least answerable card in it.
           *
           * The post kinds carry "Ask" and "Share" in the menu, both of which
           * start a conversation somewhere else. Agreeing or disagreeing on the
           * spot is the response people actually have, and losing it is how a
           * desk ends up with six analysts who each assumed everyone else
           * agreed.
           */
          /**
           * A pair is answered as a PAIR, not as one of its legs.
           *
           * The idea verdict asks "where do you land on <symbol>", and the
           * card's symbol is the first long leg — so on a pair trade it asked
           * about half the trade and recorded the answer against that half. A
           * pair is a claim about a relationship; agreeing with the long side
           * is not agreeing with the trade.
           *
           * It is also the only thing on the card that moves it forward. The
           * legs chart and the rationale reads, and until now there was nothing
           * a colleague could do with it.
           */
          const pairSides = item.type === 'pair_trade'
            ? [
                pairLegs((item as any).long_legs).map(l => l.symbol).join('/'),
                pairLegs((item as any).short_legs).map(l => l.symbol).join('/'),
              ].filter(Boolean).join(' vs ')
            : null

          const pairVerdict = pairSides
            ? (
                <VerdictBar
                  question={`Would you put this pair on? ${pairSides}`}
                  options={[
                    { key: 'back_pair', label: 'Back it', tone: 'affirm', disposition: 'settled',
                      note: `${pairSides}: I would put this pair on as proposed.` },
                    { key: 'pair_sizing', label: 'Right idea, wrong size', tone: 'neutral', disposition: 'flagged',
                      note: `${pairSides}: I agree with the relationship but not the sizing as proposed.` },
                    { key: 'pair_one_leg', label: 'Only one leg', tone: 'neutral', disposition: 'flagged',
                      note: `${pairSides}: I would take one side of this rather than the pair.` },
                    { key: 'pair_no', label: 'Not convinced', tone: 'negate', disposition: 'flagged',
                      note: `${pairSides}: I do not think this relationship holds and would argue the other side.` },
                  ]}
                  onRespond={(o, commentary) =>
                    applyVerdict(built.card, `Would you put this pair on? ${pairSides}`, o, commentary)}
                />
              )
            : null

          const ideaVerdict = pairVerdict ?? (itemAsset?.symbol
            ? (
                <VerdictBar
                  question={`Where do you land on ${itemAsset.symbol}?`}
                  options={[
                    { key: 'agree', label: 'Agree', tone: 'affirm', disposition: 'settled',
                      note: `${itemAsset.symbol}: I agree with this read.` },
                    { key: 'questions', label: 'Questions', tone: 'neutral', disposition: 'flagged',
                      note: `${itemAsset.symbol}: I have questions about this before I would back it.` },
                    { key: 'disagree', label: 'Not convinced', tone: 'negate', disposition: 'flagged',
                      note: `${itemAsset.symbol}: I do not agree with this read and would want to argue the other side.` },
                  ]}
                  onRespond={o => applyVerdict(built.card, `Where do you land on ${itemAsset.symbol}?`, o)}
                />
              )
            : null)

          // The post itself, in full. The body clamps to two lines, so on a
          // research note or a thesis update the card was showing an opening
          // clause and hiding the argument, on a surface whose whole point is
          // not having to navigate to read it.
          const ideaDetailPanes = [
            ...(built.card.body.length > 140
              ? [{
                  id: 'post',
                  label: 'Post',
                  content: (
                    <p className="whitespace-pre-line text-[15px] leading-[1.55] text-gray-600 dark:text-gray-300">
                      {built.card.body}
                    </p>
                  ),
                }]
              : []),
            ...(ideaVerdict ? [{ id: 'verdict', label: 'Respond', content: ideaVerdict }] : []),
          ]

          return (
            <div
              key={item.id}
              className="h-full w-full"
              ref={track({ assetId: itemAssetId, authorId: itemAuthorId, kind: 'idea' })}
            >
              <SignalCardSection
                card={built.card}
                /**
                 * One carousel: the tape, the post and the response.
                 *
                 * The tape only when there is a series — a sparkline under
                 * somebody's musing is decoration, which the builder already
                 * refuses to declare. Reported from a phone as "pair trade
                 * tiles are not showing interactive objects": the panes existed
                 * but sat in the lower region, which is the one that collapses.
                 */
                panes={[
                  ...(ideaPrice ? [ideaPrice] : []),
            ...legPanes,
                  ...ideaDetailPanes,
                ]}
                onOpenAsset={(id, sym) => { note('open'); openAsset(id, sym) }}
                onCapture={setCaptureCtx}
                onSnooze={c => triageCard(c, 'snooze')}
                onDismiss={c => triageCard(c, 'dismiss')}
                onPrimary={(_card, actionId) => {
                  // Routed by action id so the rail's verbs survive the move.
                  switch (actionId) {
                    case 'share': note('share'); setShareItem(item); break
                    case 'ask': setAskItem(item); break
                    case 'promote': setPromoteItem(item); break
                    case 'readthrough': note('readthrough'); setReadthroughFor(item); break
                    default: note('open')
                  }
                }}
              />
            </div>
          )
  }

  return (
    // Column, not a positioning context with an overlay in it. The filter bar
    // below used to be `absolute top-0`, which kept it from scrolling away but
    // also took it out of layout — so it sat on top of the first tile's header
    // band, hiding the kind badge and attribution behind it. A flex column
    // gives it its own height and leaves the rest to the scroller, which is
    // what "above the scroller" was trying to express in the first place.
    <div className="relative h-full overflow-hidden flex flex-col">
      <PullToRefreshIndicator ref={indicatorRef as any} isRefreshing={isRefreshing} armed={armed} />

      {/* Active filter. Occupies its own row so it cannot scroll away and
          cannot cover the feed — a filter you cannot see is a feed that looks
          broken, and one that hides the tile beneath it is worse. */}
      {/* Always-present entry point. The chip filter below only appears once
          something is filtered, which is correct for a state indicator and
          wrong for a control — there was no way to *start* curating. */}
      <div className="flex-shrink-0 flex items-center gap-2 px-3 pb-1.5 pt-1.5 [padding-top:calc(0.375rem+env(safe-area-inset-top))] border-b border-gray-200 dark:border-gray-800">
        {/* The mode switch, in the open and one tap from anywhere.
            Not behind the overflow menu: it is one of two peer answers to
            "what am I doing here", and a browsing mode nobody can find is a
            browsing mode nobody uses. 32px tall so it costs one row rather
            than a band, and the safe-area inset above it is unchanged. */}
        <div data-feed-mode={mode} className="flex shrink-0 rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
          {(['curate', 'explore'] as const).map(m => (
            <button
              key={m}
              type="button"
              data-mode-option={m}
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                logPilotEvent({ eventType: 'feed_mode', organizationId: currentOrgId ?? null, metadata: { mode: m } })
              }}
              className={clsx(
                'h-7 rounded-full px-3 text-[12px] font-bold no-touch-target',
                mode === m
                  ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white'
                  : 'text-gray-500 dark:text-gray-400',
              )}
            >
              {/* "Ideas", not "Curate". Curate is what the FILTER does — it
                  narrows the feed — and using the same word for the browsing
                  mode made two different controls claim one verb. The internal
                  key stays `curate` so telemetry and the filter sheet keep
                  their vocabulary. */}
              {m === 'curate' ? 'Ideas' : 'Explore'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setFilterSheetOpen(true)}
          className="flex items-center gap-1.5 h-8 px-3 rounded-full bg-gray-100 dark:bg-gray-800 text-[12px] font-bold text-gray-700 dark:text-gray-200 no-touch-target"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Curate
          {filterCount(feedFilter) > 0 && (
            <span className="px-1.5 rounded-full bg-primary-600 text-white text-[10px]">
              {filterCount(feedFilter)}
            </span>
          )}
        </button>
        {filterCount(feedFilter) > 0 && (
          <button
            type="button"
            onClick={() => setFeedFilter(EMPTY_FILTER)}
            className="text-[12px] font-semibold text-gray-500 dark:text-gray-400 underline underline-offset-2 no-touch-target"
          >
            Reset
          </button>
        )}

      </div>

      {kindFilter && (
        // pt-safe alone collapses to zero on a phone with no notch, which is
        // why the band read as cramped against the top edge. A real 10px floor
        // plus the inset, and more room below it, gives the row a band rather
        // than a stripe.
        <div className="flex-shrink-0 z-40 flex items-center gap-2 px-3 py-2.5 bg-gray-900 text-white dark:bg-gray-800">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em]">
            {CATEGORY_LABEL[kindFilter as FeedCategory] ?? kindFilter} only
          </span>
          <button
            type="button"
            onClick={() => setKindFilter(null)}
            className="ml-auto flex items-center gap-1 h-7 px-2.5 rounded-full bg-white/15 text-[11px] font-semibold active:bg-white/25 no-touch-target"
          >
            <X className="h-3 w-3" strokeWidth={2.5} />
            Clear
          </button>
        </div>
      )}

      {/* The focused Explore tile, over Explore.
          ── Why an overlay and not a route ──────────────────────────────────
          Explore is preview -> rich tile -> asset page, and the middle step
          only works if the mosaic survives it: a reader who opens a tile,
          decides it is not interesting and closes it must land exactly where
          they were. A route change loses the scroll position and the category,
          and puts the browser's back stack between them and the page.
          Not a snap container either. One card does not need a feed, and
          wrapping it in one would put mandatory snapping around a single tile.
      */}
      {mode === 'explore' && exploreFocus && (
        <ExploreExpansion
          origin={exploreOrigin}
          label={exploreFocus.title}
          /**
           * Re-measured at dismiss, not reused from the tap.
           *
           * The mosaic is still mounted and still scrollable behind the sheet,
           * so the tile may be somewhere else — or off-screen entirely — by the
           * time the reader closes. Reading it again means the card returns to
           * where the tile IS rather than where it was.
           */
          measureOrigin={() => measureTile(
            document.querySelector(`[data-explore-tile="${exploreFocus.id}"]`),
          )}
          onClose={() => { setExploreFocus(null); setExploreOrigin(null) }}
        >
        <div className="flex h-full flex-col bg-white dark:bg-gray-900" data-explore-focus>
          {/* No header bar. `ExploreExpansion` owns the way out — one control,
              one reverse transition — and a second bar above the card was
              chrome stacked on chrome. */}
          <div className="min-h-0 flex-1">
            {(() => {
              /**
               * The SAME card Curate would render, found by matching the
               * preview back to the entry it came from.
               *
               * Matched on asset and ranked signal type, because those are what
               * both sides agree on: `rankInputFor` gives every feed entry a
               * type and an id, and an Explore item's `dedupeKey` is built from
               * the same signal type and asset. Rebuilding the card from the
               * preview instead would mean a second copy of every builder.
               *
               * A preview with no matching entry — a post, an aggregate, a
               * template with no ticker — falls back to what the preview itself
               * knows. That is honest: the alternative is inventing a card.
               */
              const match = findExploreMatch(
                exploreFocus,
                allEntriesRef.current as any[],
                e => {
                  const input = rankInputFor(e)
                  return { type: input.type, id: input.id, symbol: symbolOfEntry(e) }
                },
              )
              /**
               * Rendered only if it actually renders.
               *
               * ── The blank screen this removes ─────────────────────────────
               *
               * This was `if (match) return renderEntry(match)`, and
               * `renderEntry` returns `null` for an idea whose card the builder
               * declines to gate through — `buildIdeaCard` refuses a post with
               * no substantive words (`content_quality`), and Explore's own
               * intake keeps such a post because it HAS an asset. So a trade
               * idea with an empty rationale tiled fine, matched fine, and
               * opened a full-screen white overlay with a back button and
               * nothing else. Proven against the builder, not inferred.
               *
               * A truthy match also meant the fallback below could never run in
               * that case, which is the part that made it a blank rather than a
               * degraded panel: the honest fallback was already written and was
               * unreachable precisely when it was needed.
               */
              const rendered = match ? renderEntry(match) : null
              if (rendered) return rendered
              /**
               * No feed entry answers this preview, or none that can be drawn —
               * so state what the preview knows and route to the object, rather
               * than apologising for not having a card.
               *
               * The matcher can only re-render what Curate is currently
               * carrying. An item outside that pool — a trade idea the feed has
               * not surfaced, a post older than the window — used to reach a
               * screen reading "This one lives on its own surface", which is a
               * tile that looked tappable answering with an apology after the
               * reader had already spent the tap.
               *
               * Every asset-scoped item HAS a real destination: the asset page.
               * That is where the idea, the note and the thesis actually live,
               * and it is the same route `open_asset` uses everywhere else. The
               * detail states what the preview knows and offers that route as
               * an explicit action rather than performing it on tap, which is
               * the order this mode has everywhere: preview, detail, leave.
               */
              /**
               * The preview's own facts, expanded — not the preview enlarged.
               *
               * This was a headline, a clause, a company name and one button.
               * `ExploreItem` already carries the modelled ladder, the horizon
               * dates, the benchmark weight, the review date, the proposal's
               * stage, the portfolio and its weight — all of which the tile
               * drops for want of room, and none of which needed fetching.
               * See `ExploreDetail`.
               */
              return (
                <ExploreDetail
                  item={exploreFocus}
                  now={Date.now()}
                  /**
                   * The chart the tile could not fit.
                   *
                   * The sheet was rendering `ExploreVisualBlock` at the tile's
                   * own size, so opening a card added facts and no better
                   * picture — the one thing a full screen is for. Same plan as
                   * the tile (`exploreSparkPlan`), so the window and its anchor
                   * are identical; only the height changes. A name with no
                   * cached closes renders nothing here, exactly as on the tile.
                   */
                  chart={(() => {
                    const plan = exploreSparkPlan(exploreFocus, Date.now())
                    if (plan.form === 'none' || !exploreFocus.symbol) return undefined
                    return (
                      <TileSparkline
                        symbol={exploreFocus.symbol}
                        form="detail"
                        since={plan.since}
                        sinceLabel={plan.sinceLabel}
                      />
                    )
                  })()}
                  onOpenAsset={openAsset}
                  onReadArticle={url => setExploreArticle({
                    url,
                    title: exploreFocus.title ?? null,
                    source: exploreFocus.source?.label ?? null,
                  })}
                />
              )
            })()}
          </div>
        </div>
        </ExploreExpansion>
      )}

      {/* First-session coverage, above the scroller.
          Outside the snap container deliberately: the scroller is
          `snap-mandatory`, so its first child gets snapped past before anyone
          sees it — the debug counter learned this the same way. Renders
          nothing once the user has any coverage, which is most sessions.

          On the feed rather than behind a nav item because this IS the screen
          a phone user lands on, the feed is what coverage changes, and a setup
          prompt filed under a menu is a setup prompt nobody opens. No
          `onGoToIdeas`: they are already here. */}
      <div className="flex-shrink-0 px-3 pb-1.5 empty:hidden">
        <FirstSessionCoveragePrompt variant="sheet" />
      </div>

      {/* Explore replaces the snap scroller entirely rather than wrapping it.
          The two modes are different layouts with different scroll owners, and
          nesting one inside the other is how gesture architecture leaks — the
          snap container would still be there, still mandatory, still claiming
          one viewport per child. */}
      {mode === 'explore' ? (
        <MobileExplore
          // The real fetcher, injected — see MobileExplore.
          renderSparkline={(sym, { feature, form, since, sinceLabel, fallback }) => (
            <TileSparkline
              symbol={sym}
              feature={feature}
              form={form}
              since={since}
              sinceLabel={sinceLabel}
              fallback={fallback}
            />
          )}
          candidates={exploreCandidates}
          category={exploreCategory}
          onCategoryChange={setExploreCategory}
          onOpen={openExploreItem}
          expandedId={exploreFocus?.id ?? null}
          onTelemetry={(eventType, metadata) =>
            // Product telemetry, never `audit_events`. Browsing is not
            // investment judgment, and putting it in the research record would
            // make every future reader filter it out before counting anything.
            logPilotEvent({ eventType, organizationId: currentOrgId ?? null, metadata })}
        />
      ) : (
      <>
      {/* ABOVE the scroller, not inside it.
          It was the scroller's first child, and the scroller is
          `snap-mandatory` — so the browser snapped past it to the first card
          the instant the feed rendered and it was never on screen for a frame.
          It shipped, it rendered, and it could not be seen. Which is the third
          time in this sequence the diagnostic has failed for the same shape of
          reason as the thing it was meant to diagnose.

          A count per stage, behind ?debug=1.
          ── Why this exists ─────────────────────────────────────────────────
          "I still see no trade ideas" has now been answered five times with a
          different real cause each time — the status rule, the time window,
          diversity deleting rather than deferring, adapter type mismatches,
          and an 18-hour half-life applied to something that does not decay.
          Every one was a genuine defect and none was the whole answer, because
          each was diagnosed by reading code rather than by measuring where the
          rows actually stop.
          A phone has no console and no network tab, so the reader cannot tell
          "the query returned nothing" from "the ranking buried it" from "I am
          looking at a cached bundle". These six numbers separate those cases in
          one glance. Query-string gated, so it costs nothing to leave in. */}
      {debugOn && (
        <div
          data-slot="feed-diagnostics"
          className="shrink-0 bg-gray-900 px-3 py-1.5 font-mono text-[10px] leading-tight text-emerald-300"
        >
          build {import.meta.env.MODE} · raw {items.length} · substantive {substantive.length}
          {' · '}visible {visibleItems.length}
          {' · '}ideas {visibleItems.filter((i: any) => i.type === 'trade_idea').length}
          {' / '}pairs {visibleItems.filter((i: any) => i.type === 'pair_trade').length}
          {' · '}news {(newsItems ?? []).length} for {newsSymbols.length} syms
          {' · '}entries {feedEntries.length}
        </div>
      )}

      {/* min-h-0 matters: a flex child defaults to min-height:auto, which lets
          it grow to its content instead of scrolling, and the snap sections
          inside are full-height by definition. Without it the scroller has no
          bounded height and every tile spills. */}
      <div
        ref={setScroller}
        // Mandatory snapping stays.
        //
        // It was briefly relaxed to `proximity` on the theory that mandatory
        // snapping was what made the feed read as a stack of full-screen
        // alerts. It was not: the full-screen CARDS were, and once a compact
        // card is 380px the next one is already visible below it while the
        // current one sits snapped to the top. Proximity bought nothing and
        // cost the "one swipe advances exactly one tile" guarantee, which two
        // gesture tests and every reader's muscle memory depend on.
        className="flex-1 min-h-0 overflow-y-auto snap-y snap-mandatory overscroll-contain"
      >
        {/* Scenario cards are ranked with everything else — see renderScenarioCard. */}

        {/* A filter that matches nothing SAYS so.
            ── Why this needs its own state ─────────────────────────────────
            The "Nothing in your feed yet" guard above tests the SOURCES, so a
            feed with plenty in it that has been narrowed to zero fell past it
            and rendered an empty snap scroller: a blank screen with a filter
            chip on it, which reads as the feed being broken rather than as an
            answer.
            And it IS an answer. Selecting Target expired and being told there
            are none is the reader learning something true about their book —
            which is the whole reason the Signal list offers every type rather
            than only the ones already on screen. A question you cannot ask has
            no answer; a question that answers "none" has one. */}
        {feedEntries.length === 0 && (
          <div
            data-testid="feed-filter-empty"
            className="flex h-full w-full snap-start flex-col items-center justify-center px-8 text-center"
          >
            <Lightbulb className="mb-3 h-10 w-10 text-amber-400" />
            <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
              No tiles match this filter
            </p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              Nothing in your feed is a {activeFilterLabel} right now. That is an
              answer, not a gap — the finding simply is not there today.
            </p>
            <button
              type="button"
              data-testid="feed-filter-clear"
              onClick={() => { setFeedFilter(EMPTY_FILTER); setKindFilter(null) }}
              className="mt-4 h-11 rounded-xl border border-gray-300 px-4 text-[14px] font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200"
            >
              Clear filters
            </button>
          </div>
        )}

        {/* Windowed. Every tile is exactly one scroller height, so a collapsed
            slot occupies the same box and no scroll offset moves — see
            FeedSlot for why that exactness matters on a snap scroller. */}
        {feedEntries.map((entry, i) => (
          <FeedSlot
            key={feedKeys[i]}
            root={scroller}
            // The first two screens are present in the first paint; the rest
            // arrive as the observer reaches them.
            initiallyNear={i < 2}
            render={() => renderEntry(entry)}
          />
        ))}

        <div ref={sentinelRef} className="h-px" />
      </div>
      </>
      )}

      {/* The expanded chart. One shell for every card kind — see
          FullscreenChart for why the overlays are parameters rather than
          variants. Closing restores the card and the feed untouched, because
          nothing about the feed changed while it was open. */}
      <FullscreenChart
        open={fsChart !== null}
        onClose={() => setFsChart(null)}
        symbol={fsChart?.symbol ?? ''}
        companyName={fsChart?.companyName}
        series={fsChart?.series ?? []}
        bands={fsChart?.bands}
        markers={fsChart?.markers}
      />

      {/* The target and case editor, over the card.
          The real one — `MobileCaseTargets` writes through
          `useAnalystPriceTargets`, so a save here is a save. `viewFilter` is
          the reader's own id because editing requires it; the aggregated view
          is read-only and would give them a sheet they cannot type in.
          A sheet is one of the two places a vertical scroller is legitimate on
          this surface: it is an overlay, not a member of the snap feed. */}
      <BottomSheet
        open={targetSheet !== null}
        onClose={() => setTargetSheet(null)}
        title={targetSheet ? `${targetSheet.symbol} price target` : ''}
        /**
         * Opens near full height, not at 70%.
         *
         * Editing a case opens a keyboard, and a software keyboard takes about
         * the bottom 40% of a phone. A sheet that starts at 70% then loses 40%
         * of the screen leaves roughly a third of itself visible — which is
         * where the case list, the value being edited and the save control all
         * have to fit. Reported as the keyboard blocking most of what the user
         * needs to see.
         *
         * The lower stop is gone rather than reordered: there is no reading
         * mode for this sheet, only an editing one, and offering a size that
         * cannot be typed in is offering a broken state.
         */
        snapPoints={[0.95]}
        /**
         * The sheet keeps its height when the keyboard opens.
         *
         * `avoidKeyboard` shrinks the sheet to sit above the keyboard, which
         * is right for a short sheet and wrong for an editor: a 95% sheet
         * became roughly half a screen the moment a field was tapped, and the
         * case list, the value and the save control all had to fit in what was
         * left. Reported as the drawer shrinking on the pencil.
         *
         * Held at full height, the keyboard simply overlaps the bottom of it,
         * and the focused field scrolls up into the visible part — see the
         * `focusin` handler in BottomSheet, which is what makes this safe.
         */
        avoidKeyboard={false}
        aria-label="Price target editor"
      >
        {targetSheet && (
          <div data-slot="target-sheet" className="px-3 pb-6">
            <MobileCaseTargets
              assetId={targetSheet.assetId}
              currentPrice={targetSheet.price}
              viewFilter={userId ?? 'aggregated'}
              /* Records the pending judgment only once a case is genuinely
                 saved. Dismissing the sheet leaves target, cases, signal and
                 judgment untouched. */
              onSaved={() => {
                const p = targetSheet.pending
                if (!p) return
                void p.commit(p.resolution)
                setTargetSheet(null)
              }}
            />

            {/* A case the ladder does not have yet.
                The editor lists and edits what exists; extending the ladder is
                the one thing it could not do, so a reader who decided the
                spread needed a fourth case had to leave for the asset page —
                from a drawer they opened precisely to work on that ladder.
                It opens the same drawer the card's "+" does, which stacks
                above this one because it is rendered after it. Deliberate: the
                target editor stays mounted underneath, so dismissing the new
                case returns to the ladder rather than to the feed. */}
            <button
              type="button"
              data-slot="target-sheet-add-case"
              onClick={() => setNewCaseSheet({
                assetId: targetSheet.assetId,
                symbol: targetSheet.symbol,
                seedPrice: targetSheet.price,
              })}
              className="mt-5 h-11 w-full rounded-xl border border-dashed border-gray-300 text-[14px] font-bold text-gray-600 dark:border-gray-600 dark:text-gray-300"
            >
              + Add a case
            </button>
          </div>
        )}
      </BottomSheet>

      {/* What the answer produced, and the one thing to do with it.
          ── Why a toast and not a card state ──────────────────────────────
          The card that produced the thought may already have scrolled out of
          the windowed set, and the reader's attention has moved on with it.
          The offer to share belongs where they are looking now, and it has to
          be dismissible without being the point — sharing is deliberate, and
          most judgments are never shared. */}
      {lastThought && (
        <div
          data-slot="judgment-thought-toast"
          role="status"
          className="pointer-events-auto fixed inset-x-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-40 flex items-center gap-3 rounded-xl bg-gray-900 px-3 py-2.5 text-white shadow-lg dark:bg-gray-800"
        >
          <span className="min-w-0 flex-1 text-[13px] font-medium">
            Saved to your thoughts
            {lastThought.symbol ? ` on ${lastThought.symbol}` : ''}
            {/* Said out loud, because the default is the part people need to
                trust before they will answer honestly. */}
            <span className="ml-1 text-gray-400">· private</span>
          </span>
          <button
            type="button"
            data-slot="judgment-thought-share"
            onClick={() => {
              setShareItem({ id: lastThought.id, type: 'quick_thought', title: 'Thought' } as any)
              setLastThought(null)
            }}
            className="shrink-0 rounded-lg bg-white/15 px-2.5 py-1.5 text-[13px] font-bold text-white no-touch-target"
          >
            Share
          </button>
          <button
            type="button"
            data-slot="judgment-thought-dismiss"
            aria-label="Dismiss"
            onClick={() => setLastThought(null)}
            className="shrink-0 rounded-lg px-1.5 py-1.5 text-[13px] font-semibold text-gray-400 no-touch-target"
          >
            ✕
          </button>
        </div>
      )}

      {/* Adding a case, in a drawer.
          A case is a name AND a number, and collecting both in a chip row on a
          card with one screen put a text input under the keyboard. Here there
          is room, the sheet holds its height, and the fields scroll above the
          keyboard like every other editor on this surface. */}
      <BottomSheet
        open={newCaseSheet !== null}
        onClose={() => { setNewCaseSheet(null); setNewCaseName(''); setNewCasePrice(''); setNewCaseProbability(''); setNewCaseReasoning('') }}
        title={newCaseSheet ? `New case for ${newCaseSheet.symbol}` : ''}
        // Full height. At 0.6 the keyboard covered the price field the moment
        // the name was typed, which is the failure the whole drawer exists to
        // avoid.
        snapPoints={[0.95]}
        avoidKeyboard={false}
        aria-label="Add a case"
      >
        {newCaseSheet && (
          <div data-slot="new-case-sheet" className="px-4 pb-6">
            <label className="block text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Case name
            </label>
            <input
              data-slot="new-case-name"
              autoFocus
              value={newCaseName}
              onChange={e => setNewCaseName(e.target.value)}
              placeholder="Bull, Downside, Break-up…"
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] dark:border-gray-600 dark:bg-gray-900"
            />

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Price
            </label>
            <input
              data-slot="new-case-price"
              inputMode="decimal"
              value={newCasePrice}
              onChange={e => setNewCasePrice(e.target.value)}
              placeholder={newCaseSheet.seedPrice != null ? newCaseSheet.seedPrice.toFixed(2) : '0.00'}
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] tabular-nums dark:border-gray-600 dark:bg-gray-900"
            />
            {/* Seeded from the current price when left blank. A case with no
                number is not a case, and where it trades is the only honest
                starting point. */}
            <p className="mt-1 text-[11px] text-gray-400">
              Leave blank to start from the current price.
            </p>

            {/* The rest of what a stored target actually carries.
                `analyst_price_targets` holds a horizon, a probability and the
                reasoning alongside the number — a case created without them is
                a bare figure somebody has to interpret later, which is the
                complaint this whole area started from. All optional: a target
                with only a price is still a target. */}
            {/* Horizon: the presets the rest of the product stores.
                It was a free-text box. `analyst_price_targets` does not store
                prose here — every row in production is a preset string with a
                matching `timeframe_type`: "12 months" (21 rows), "6 months"
                (7), "3 months" (1). Typing "a year" would have written a value
                nothing else can read, and the separate rolling/dated toggle
                beside it wrote `is_rolling` without ever setting
                `timeframe_type`, which is why "ends on a date" did nothing.
                One control, three shapes, and each writes the trio the schema
                actually expects. */}
            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Horizon
            </label>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {['3 months', '6 months', '12 months', '24 months'].map(tf => (
                <button
                  key={tf}
                  type="button"
                  data-slot="new-case-timeframe"
                  data-timeframe={tf}
                  aria-pressed={newCaseHorizon === tf}
                  onClick={() => setNewCaseHorizon(tf)}
                  className={
                    'h-10 rounded-lg px-3 text-[13px] font-bold transition-colors '
                    + (newCaseHorizon === tf
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300')
                  }
                >
                  {tf.replace(' months', 'M')}
                </button>
              ))}
              {([['rolling', 'Rolling'], ['date', 'By a date']] as const).map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  data-slot={`new-case-horizon-${key}`}
                  aria-pressed={newCaseHorizon === key}
                  onClick={() => setNewCaseHorizon(key)}
                  className={
                    'h-10 rounded-lg px-3 text-[13px] font-bold transition-colors '
                    + (newCaseHorizon === key
                      ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300')
                  }
                >
                  {label}
                </button>
              ))}
            </div>
            {newCaseHorizon === 'date' && (
              <input
                data-slot="new-case-target-date"
                type="date"
                value={newCaseDate}
                onChange={e => setNewCaseDate(e.target.value)}
                className="mt-2 h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] dark:border-gray-600 dark:bg-gray-900"
              />
            )}

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Probability
            </label>
            <input
              data-slot="new-case-probability"
              inputMode="decimal"
              value={newCaseProbability}
              onChange={e => setNewCaseProbability(e.target.value)}
              placeholder="%"
              className="mt-1 h-11 w-full rounded-lg border border-gray-300 px-3 text-[15px] tabular-nums dark:border-gray-600 dark:bg-gray-900"
            />

            <label className="mt-4 block text-[11px] font-bold uppercase tracking-wide text-gray-400">
              Reasoning
            </label>
            <textarea
              data-slot="new-case-reasoning"
              rows={3}
              value={newCaseReasoning}
              onChange={e => setNewCaseReasoning(e.target.value)}
              placeholder="What has to be true for this case."
              className="mt-1 w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-[15px] dark:border-gray-600 dark:bg-gray-900"
            />

            <button
              type="button"
              data-slot="new-case-save"
              disabled={!newCaseName.trim()}
              onClick={() => {
                const typed = parseNumericEntry(newCasePrice)
                void addCase(newCaseSheet.assetId, newCaseName, typed ?? newCaseSheet.seedPrice, {
                  horizon: newCaseHorizon,
                  probability: parseNumericEntry(newCaseProbability),
                  reasoning: newCaseReasoning.trim() || null,
                })
                setNewCaseSheet(null); setNewCaseName(''); setNewCasePrice(''); setNewCaseProbability(''); setNewCaseReasoning('')
              }}
              className="mt-5 h-11 w-full rounded-xl bg-primary-600 text-[15px] font-bold text-white disabled:opacity-40"
            >
              Add case
            </button>
          </div>
        )}
      </BottomSheet>

      {/* The thesis, editable in place.
          Near-full height for the same reason the case editor is: this opens a
          keyboard, and a sheet that starts lower loses most of itself to it.
          `viewFilter` is the reader's own id because editing requires it — the
          aggregated view is read-only, and opening a field somebody cannot
          type in is the failure this replaces. */}
      <BottomSheet
        open={thesisSheet !== null}
        onClose={() => setThesisSheet(null)}
        title={thesisSheet ? `${thesisSheet.symbol} thesis` : ''}
        snapPoints={[0.95]}
        // Same reasoning as the target editor: hold the height, scroll the
        // field. Three text areas shrunk to half a screen is unusable.
        avoidKeyboard={false}
        aria-label="Thesis editor"
      >
        {thesisSheet && (
          <div data-slot="thesis-sheet" className="px-1 pb-6">
            {/* The organisation's OWN research template for this asset, not a
                guess at what a thesis contains.
                It was three hardcoded sections — thesis, where we differ,
                risks — which is a reasonable shape and not necessarily THIS
                firm's. `MobileCaseView` is what the asset page renders: it
                loads the template, so a desk that has added a "Competitive
                position" field gets that field here too, with the same write
                path, the same draft/publish split and the same visibility. */}
            <MobileCaseView assetId={thesisSheet.assetId} symbol={thesisSheet.symbol} focus="thesis" />
          </div>
        )}
      </BottomSheet>

      <FeedCaptureSheet
        open={captureCtx !== null}
        onClose={() => setCaptureCtx(null)}
        assetId={captureCtx?.assetId}
        assetSymbol={captureCtx?.symbol}
        assetName={captureCtx?.name}
        initialKind={captureCtx?.kind ?? null}
        initialNote={captureCtx?.note ?? null}
        /* The same `openAsset` the footer's `Open TICKER` button called, so
           the destination and whatever engagement it records are unchanged —
           only where the reader taps it has moved. */
        onOpenAsset={openAsset}
      />

      {shareItem && (
        <ShareToUserModal isOpen onClose={() => setShareItem(null)} item={shareItem} />
      )}

      {promoteItem && (
        <PromoteToTradeIdeaModal
          isOpen
          onClose={() => setPromoteItem(null)}
          quickThoughtId={promoteItem.id}
          quickThoughtContent={promoteItem.content ?? ''}
          assetId={('asset' in promoteItem && promoteItem.asset ? promoteItem.asset.id : null) as any}
          assetSymbol={('asset' in promoteItem && promoteItem.asset ? promoteItem.asset.symbol : null) as any}
          assetName={('asset' in promoteItem && promoteItem.asset ? promoteItem.asset.company_name : null) as any}
        />
      )}

      {askItem && (
        <PromptModal
          isOpen
          onClose={() => setAskItem(null)}
          context={{
            type: 'asset' in askItem && askItem.asset ? 'asset' : undefined,
            id: 'asset' in askItem && askItem.asset ? askItem.asset.id : undefined,
            title: 'asset' in askItem && askItem.asset ? askItem.asset.symbol : undefined,
          }}
        />
      )}

      <FeedFilterSheet
        open={filterSheetOpen}
        onClose={() => setFilterSheetOpen(false)}
        value={feedFilter}
        onChange={setFeedFilter}
        kindLabels={CATEGORY_LABEL}
        /* Only the pills the feed is actually carrying. Offering all thirty
           would put twenty-odd options in front of the reader that match
           nothing today — a filter that can only empty the feed. */
        signalTypeLabels={presentSignalTypes}
      />

      {/* The story, in the reader the feed already uses.
          ── Why not a new surface ──────────────────────────────────────────
          `ArticleReader` is what the Curate news card opens: it extracts the
          text, says so honestly when extraction fails, and offers the
          publisher's page rather than a stub. Explore reaching for a second
          reader would be two implementations of the same thing, drifting.
          Rendered OVER the grid rather than replacing it, so closing returns to
          the exact scroll position and category — the mosaic never unmounts. */}
      {exploreArticle && (
        <ArticleReader
          open
          onClose={() => setExploreArticle(null)}
          url={exploreArticle.url}
          fallbackTitle={exploreArticle.title ?? undefined}
          fallbackSource={exploreArticle.source ?? undefined}
        />
      )}

      {readthroughFor && (
        <ReadthroughSheet
          open
          onClose={() => setReadthroughFor(null)}
          sourceType={readthroughSourceType(readthroughFor.type)!}
          sourceId={readthroughFor.id}
          excludeAssetId={
            'asset' in readthroughFor && readthroughFor.asset ? readthroughFor.asset.id : null
          }
        />
      )}
    </div>
  )
}

function stripMarkup(html: string): string {
  return html.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * The seed text for a size recorded off the active-risk card.
 *
 * It states every number the proposal depends on, including the snapshot date
 * the weights came from. A note saying only "take NVDA to 6.5%" is unreadable
 * a week later: 6.5% against what book, on which day, and versus what
 * benchmark. The whole reason the card carries `asOf` is that a book number
 * without its date is a claim nobody can check, and a note derived from one
 * inherits the same obligation.
 *
 * The benchmark clause is omitted rather than faked when there is no benchmark
 * weight — writing "benchmark 0.00%" would assert the index excludes the name,
 * which is the `insufficient_coverage` confusion the builder exists to avoid.
 */
function whatIfNote(input: ActiveRiskInput, proposedPct: number): string {
  const day = new Date(input.asOf)
  const asOf = Number.isNaN(day.getTime())
    ? 'an undated snapshot'
    : day.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

  const bench = input.benchmarkWeightPct
  const benchClause = bench == null
    ? ''
    : ` Benchmark ${bench.toFixed(2)}%, so active weight would go from ${
        (input.weightPct - bench >= 0 ? '+' : '')}${(input.weightPct - bench).toFixed(2)}% to ${
        (proposedPct - bench >= 0 ? '+' : '')}${(proposedPct - bench).toFixed(2)}%.`

  return `${input.symbol} at ${proposedPct.toFixed(2)}% instead of ${input.weightPct.toFixed(2)}% in ${
    input.portfolioName}.${benchClause} Weights from the holdings snapshot of ${asOf}. Recorded from the feed; the position is unchanged.`
}

/**
 * Feed item types map onto `object_links.source_type`. Only the types with an
 * unambiguous counterpart are offered — `note` covers four distinct note
 * tables, and guessing the wrong one would write a link that resolves to
 * nothing, so readthrough is withheld there rather than recorded incorrectly.
 */
function readthroughSourceType(type: ItemType): ReadthroughSourceType | null {
  switch (type) {
    case 'quick_thought':
      return 'quick_thought'
    case 'trade_idea':
      return 'trade_idea'
    case 'thesis_update':
      return 'trade_idea_thesis'
    default:
      return null
  }
}
