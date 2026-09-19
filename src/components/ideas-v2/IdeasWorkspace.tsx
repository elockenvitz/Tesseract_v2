/**
 * Desktop Ideas — the workspace.
 *
 * Two states, one surface, one at a time:
 *
 *   BROWSE   the gallery has the whole canvas — ticker, direction, maturity,
 *            a claim line, metrics, a small visual, what changed — enough to
 *            choose between Ideas without opening any of them.
 *   DETAIL   the chosen Idea has the whole canvas, and returning is one
 *            click back to where the reader was in the gallery.
 *
 * Earlier passes kept both on screen: a left rail, then a capped band above
 * the workspace. Both rationed the scan to make room for detail it was not
 * competing with. Neither question is served by half a screen.
 *
 * Ideas creates EngagementTargets and nothing else: Ask AI and Team both open
 * the existing CommunicationPane through the D1 seam. No AI component, no
 * message component, no comment system is defined here.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  useIdeaScan, useScanExposure, useScanFramework, useScanOpenPrice, useIdeaDetail,
  type ScanFrame,
} from '../../hooks/useDesktopIdeas'
import {
  scoreIdea, compareIdeas, subscribeToOpenIdea, MATURITY_LABEL,
  type IdeaRow, type IdeaFocus,
} from '../../lib/desktop-ideas'
import { useCoverageResearchGaps } from '../../hooks/useCoverageResearchGaps'
import { usePilotMode } from '../../hooks/usePilotMode'
import { operationalAfterPilot } from '../../lib/pilot/seed-visibility'
import { openCreate } from '../../lib/today/create-actions'
import { IdeaDetail } from './IdeaDetail'
/* The opportunity set, from the same candidates mobile Explore reads. It is
   the only field this lens renders, and it owns its own loading and empty
   states -- which is why nothing from `IdeaCard` is imported here any more. */
import { OpportunityGrid } from './OpportunityGrid'
import {
  openDashboardFocus, type FocusIntent, type RailCard,
} from '../../lib/dashboard/focus'

/**
 * The two vocabularies, translated at the boundary rather than merged.
 *
 * `FocusIntent` is what the Dashboard shell carries between any lens and any
 * workspace. `IdeaFocus` is what THIS workspace already understood before the
 * shell existed, and what `IdeaDetail` keys its emphasis off. They are not the
 * same list and should not become one: `book` means a position to Ideas and a
 * portfolio panel to Research, and collapsing them would make one lens wrong.
 *
 * Only the parts an Ideas card can actually raise appear here. An intent with
 * no destination behaviour is not translated, so it degrades to the overview
 * rather than silently naming a section that will not move.
 */
const INTENT_FOR: Partial<Record<IdeaFocus, FocusIntent>> = {
  thesis: 'claim',
  framework: 'framework',
  performance: 'price',
  portfolio: 'book',
}

const FOCUS_FOR: Partial<Record<FocusIntent, IdeaFocus>> = {
  claim: 'thesis',
  framework: 'framework',
  price: 'performance',
  book: 'portfolio',
}

export interface IdeasWorkspaceProps {
  /** Selection handed in by whoever opened this tab. */
  selectedIdeaId?: string | null
  focus?: IdeaFocus | null
  /** Why the user was sent here, shown so the reason is not lost in transit. */
  issue?: string | null
  /** Set by the Dashboard deck when this lens is the expanded workspace. */
  focusObjectId?: string | null
  /** Which part of the idea the reader reached for, in the shell's terms. */
  intent?: FocusIntent
  /** Reported once the arriving idea has actually been opened, so the shell
   *  can drop it from the tab. See `DashboardShellProps.onFocusConsumed`. */
  onFocusConsumed?: () => void
}

export function IdeasWorkspace({
  selectedIdeaId, focus, issue, focusObjectId, intent, onFocusConsumed,
}: IdeasWorkspaceProps = {}) {
  /* `isLoading` is no longer read: the field owns its own loading state, and
     gating the lens on the idea scan blanked a field that does not read it. */
  const { ideas: scanned } = useIdeaScan()
  /*
   * The cached hint, for the reason Decisions and the coverage source already
   * use it.
   *
   * `hasGraduated` resolves `false` first while `pilot_progress` is in flight,
   * so a graduated reader's seeded rows were KEPT on the first paint and
   * removed on the second. That is a visible disappearance on its own, but the
   * expensive part is downstream: the id list changes, and every query keyed on
   * it -- exposure, open price, framework -- is re-keyed and re-fetched. It is
   * what made the whole field blank on a cold load.
   */
  const { hasGraduated, cachedHasGraduated } = usePilotMode()
  const graduated = hasGraduated || cachedHasGraduated

  /**
   * The pilot's seeded demo ideas leave the field once the pilot is over.
   *
   * The rule is the Dashboard's, not this lens's (lib/pilot/seed-visibility):
   * a seeded row stays stored with its provenance and every archival surface
   * still shows it, but after graduation it stops being counted as live work.
   * An open seeded idea is one nobody has acted on, so none of them survive
   * the rule here; the seeded idea the reader decided and executed is already
   * terminal and was never in this scan.
   */
  const ideas = useMemo(
    () => operationalAfterPilot(
      scanned.map(i => ({ ...i, pilotSeed: i.isPilotSeed })), { hasGraduated: graduated }),
    [scanned, graduated],
  )
  /* `settled` is no longer read: it gated the whole lens on a weight that only
     orders the deck's rail, which blanked a field that was ready to draw. */
  const { exposure } = useScanExposure(ideas)
  const openPrice = useScanOpenPrice(ideas)
  const [arrival, setArrival] = useState<{ focus?: IdeaFocus | null; issue?: string | null } | null>(
    selectedIdeaId ? { focus, issue } : null,
  )

  /*
   * One arrival, one opening.
   *
   * The id stays on the tab (and in its persisted state) for the life of that
   * tab, so honouring it on every render would re-open the same idea every
   * time the reader came back to Ideas. It is marked consumed once the idea it
   * names has actually been found and opened, and reset when a DIFFERENT id
   * arrives -- so a second hand-off into an already-open tab is honoured, which
   * is what the tab-reuse behaviour depends on.
   */
  const [arrivalConsumed, setArrivalConsumed] = useState(false)
  const lastArrivalRef = useRef<string | null>(selectedIdeaId ?? null)

  // A later hand-off into an already-open tab. The tab id is fixed, so
  // arriving from Today twice reuses this workspace and re-selects inside it
  // rather than stacking duplicate tabs.
  useEffect(() => {
    if (!selectedIdeaId) return
    setArrival({ focus, issue })
    if (lastArrivalRef.current !== selectedIdeaId) {
      lastArrivalRef.current = selectedIdeaId
      setArrivalConsumed(false)
    }
  }, [selectedIdeaId, focus, issue])

  /*
   * What the reader covers and has no idea on, as suggestions.
   *
   * The same shared source Today and Research read, so a name is described the
   * same way wherever it appears, and only the reader's own or assigned
   * coverage. It never blocks the field: real ideas render as soon as the scan
   * answers, and prompts append when the coverage scan does.
   */
  const gaps = useCoverageResearchGaps()

  /*
   * Every asset a real idea already concerns, including seeded rows hidden
   * from the field: a prompt must not suggest starting work that exists.
   *
   * Read from `scanned` rather than `ideas` on purpose -- `ideas` is the
   * visible list, and a graduated pilot's seeded rows are filtered out of it
   * while still being work somebody did. Excluding on the visible list alone
   * would suggest starting an idea that is sitting right there in history.
   *
   * Handed to the field rather than applied here: the prompts are projected
   * into Explore's shape and ranked with every other candidate, so the rule
   * travels to where the selection now happens.
   */
  const ideaAssetIds = useMemo(
    () => new Set(scanned.map(i => i.assetId).filter((id): id is string => !!id)),
    [scanned],
  )

  const ranked = useMemo(() => {
    const now = Date.now()
    return ideas
      .map(idea => ({
        idea,
        id: idea.id,
        rank: scoreIdea(idea, { weightPct: exposure[idea.assetId ?? '']?.pct }, now),
      }))
      .sort(compareIdeas)
      .map(r => r.idea)
  }, [ideas, exposure])

  /**
   * Selection lives in the deck. The ranking is untouched -- `ranked` is the
   * same list in the same order -- and it still decides which idea the reader
   * meets first. What it never does is open one on their behalf.
   */
  /*
   * The deck first, then the arrival.
   *
   * `focusObjectId` is the deck -- a card the reader opened inside this lens,
   * and it must always win. `selectedIdeaId` is the tab payload: Today's
   * "Review this proposal", Research's "open the idea", the asset strip. Every
   * one of those producers has always sent an id, and this line read
   * `focusObjectId ?? null`, so every one of them landed on an unsorted
   * gallery with nothing open. The reader was handed a specific idea and shown
   * all of them.
   *
   * The arrival is consumed once it has actually been applied -- see the effect
   * below -- so a later ordinary visit to this tab is ordinary.
   */
  const activeId = focusObjectId ?? (arrivalConsumed ? null : selectedIdeaId ?? null)
  // A generated prompt has no detail pane: it opens capture instead, so it can
  // never become the deck's selected object.
  const selected = activeId
    ? ranked.find(i => i.id === activeId && !i.generated) ?? null
    : null

  /*
   * Spent only once it actually opened something.
   *
   * Marking it consumed on arrival would lose the hand-off whenever the scan
   * had not answered yet -- the id would be cleared a render before the idea
   * it names exists in `ranked`. Waiting for `selected` means a payload naming
   * an idea this lens cannot show (deleted, or filtered out as a seeded row)
   * stays unconsumed and simply does nothing, which is the honest outcome.
   */
  useEffect(() => {
    if (arrivalConsumed || focusObjectId || !selected) return
    setArrivalConsumed(true)
    // Tell the shell too, so the id leaves the tab. Local state alone would
    // stop the re-open but leave `tab.data.selectedIdeaId` for the AI subject
    // chip to keep reading long after the reader moved on.
    onFocusConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [arrivalConsumed, focusObjectId, selected])

  // One read for the whole gallery, so a tile can show where spot sits in the
  // desk's own ladder without costing a query per tile.
  const framework = useScanFramework(ranked)
  // Null while browsing, so the gallery costs one query however long the
  // reader stays in it.
  const { detail } = useIdeaDetail(selected)

  /**
   * A prompt is not an object to open: there is nothing to open yet.
   *
   * It opens the product's existing capture form with the asset bound, which
   * is where an idea is actually written. Nothing is created until the reader
   * submits it.
   */
  const open = (idea: IdeaRow, focus?: IdeaFocus) => idea.generated
    ? openCreate('trade_idea', { assetId: idea.assetId, symbol: idea.symbol })
    : openDashboardFocus({
    target: {
      originLens: 'ideas',
      workspaceLens: 'ideas',
      objectType: 'idea',
      objectId: idea.id,
      symbol: idea.symbol,
      label: idea.companyName,
      portfolioId: idea.portfolioId,
      portfolioName: idea.portfolioName,
      issue: MATURITY_LABEL[idea.maturity],
      origin: 'ideas',
      /*
       * Which part of the idea, carried on the shell's own seam.
       *
       * It cannot be held in this component's state: the browse field and the
       * expanded detail are two SEPARATE instances of this workspace -- the
       * shell renders one behind the deck and one inside it -- so a value set
       * on the click in the first is not present in the second. It has to
       * travel with the request, which is what `FocusSource` is for.
       *
       * `FocusIntent` is the shell's vocabulary and `IdeaFocus` is this
       * lens's; they are translated at the boundary rather than merged,
       * because the same intent means different things to a research surface
       * and an ideas one.
       */
      source: focus ? { elementId: `idea-tile-${idea.id}`, role: 'standard', intent: INTENT_FOR[focus] } : null,
    },
    backLabel: 'Ideas',
    rail: ranked.map(i => toRailCard(
      i, exposure[i.assetId ?? '']?.pct, framework[i.assetId ?? ''], openPrice[i.id],
    )),
  })

  useEffect(() => subscribeToOpenIdea(r => {
    const found = ranked.find(i => i.id === r.ideaId)
    if (found) open(found)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [ranked])

  /*
   * Hold until everything that can change the ORDER has answered.
   *
   * `ranked` decides each tile's index, and `spanForRank(index)` turns that
   * index into a column span -- so anything that reorders the list resizes the
   * whole gallery. Two things can: `exposure`, which feeds `scoreIdea`'s
   * materiality term, and the coverage `prompts` that append to the list.
   * Painting before either settles means painting a gallery that is about to
   * rearrange itself.
   *
   * Note what is NOT in this gate: framework, open price and the detail read.
   * Those fill a tile's contents without touching its position or size, so
   * they are free to land late -- which is the distinction between
   * progressive filling and re-layout.
   */
  /*
   * ── What this lens may wait for, and what it may not ────────────────────
   *
   * Three gates used to stand here, all of them asking about the authored
   * field this lens no longer draws:
   *
   *   `!exposureSettled`         exposure feeds `scoreIdea`, which orders
   *                              `ranked` -- a list that now only supplies the
   *                              deck, never the field. Holding the whole lens
   *                              for it blanked a field that was ready.
   *   `gaps.status === 'loading'` the coverage scan. Its candidates now reach
   *                              the field as prompts, but they SUPPLEMENT a
   *                              thin page; they are not the page. A slow
   *                              coverage query must not hide the findings
   *                              that already arrived.
   *   `!ranked.length -> Empty`  the worst of the three. `ranked` is authored
   *                              ideas. A reader who has written none was told
   *                              the lens was empty while a full opportunity
   *                              set sat underneath, unrendered.
   *
   * All three are gone. The field owns its own loading and empty states --
   * `OpportunityGrid` draws a skeleton while its producers are in flight and
   * says so plainly when there is genuinely nothing -- because the only list
   * that can answer "is there anything to show" is the one being shown.
   *
   * A fourth gate went with them, for the same reason.
   *
   * `if (isLoading) return <Loading />` was the idea scan, and the field does
   * not read the idea scan for anything it draws -- only for the set of asset
   * ids a prompt may not suggest. So a slow scan blanked a field that was
   * ready to paint, behind a skeleton built from `spanForRank` for a grid that
   * no longer exists. It is the same defect as `!ranked.length -> Empty`, one
   * step earlier, and it had to go too.
   *
   * Nothing downstream needs it. `selected` is found in `ranked`, which is
   * empty while the scan is in flight, so the deck simply does not open and
   * the field renders -- which is the correct behaviour rather than a
   * tolerated one. The exclusion set is empty for that moment, and the only
   * consequence is that a prompt may appear for a name whose idea has not
   * loaded yet; it corrects itself on the next render, and showing one
   * suggestion a beat early is a smaller lie than showing an empty lens.
   */

  if (selected) {
    return (
      <IdeaDetail
        idea={selected}
        detail={detail}
        focus={(intent && FOCUS_FOR[intent]) ?? arrival?.focus ?? null}
        arrivedFor={arrival?.issue ?? null}
        exposure={exposure[selected.assetId ?? '']}
      />
    )
  }

  /*
    Ask AI and Discuss moved to the field that draws the tiles.

    These three built an `EngagementTarget` from an `IdeaRow` via `targetFor`.
    The field no longer renders `IdeaRow`s, so all three were dead -- `tsc`
    said so. The same two verbs are live on every tile, built from the
    opportunity instead: see `targetForOpportunity`, which binds to the ASSET
    so a thread raised from a candidate lands where a thread raised from the
    idea it becomes lands. `IdeaDetail` keeps its own copies for the expanded
    view, which is still an idea and still has a row.
  */
  /*
    The `card` helper is gone with the authored grid it built.

    It was the last reference to `IdeaCard` from this lens, and it was already
    dead -- declared, never called, and reported as such by `tsc`. The card
    component itself stays: `IdeaDetail` is still the expanded view, and
    removing a component because one caller stopped using it is a separate
    change from removing the caller.
  */

  return (
    <div className="h-full overflow-y-auto" data-testid="ideas-lens">
      {/*
        No header here. `DesktopGallery` inside `OpportunityGrid` draws the
        heading and the note, and this component drew a second `Ideas` above
        it -- one lens, two titles, the field starting a viewport further down
        than it needed to.

        The gallery is the right owner: the heading belongs to the field it
        labels, and every other lens reads the same way. The summary line that
        sat here went with it. It counted how many of the reader's OWN ideas
        were awaiting a decision or had gone cold, which was true of the
        authored grid it was written for and is not true of what is on the
        page now -- the field is the opportunity set, and a sentence counting
        a different population is worse than no sentence.

        The outer padding goes too. `DesktopGallery` already applies
        `px-6 pb-10 pt-5`, so keeping it here indented the field twice.
      */}
      {/*
        ── One field: the opportunity set ───────────────────────────────────

        Desktop Ideas is the dashboard counterpart to mobile Explore, not a
        second recommendation engine: `useDesktopExplore` composes candidates
        through the mobile adapters and ranks them with `diversifyExplore`,
        and `lib/desktop-ideas/opportunity` narrows that to the subset
        carrying an investment question -- the ones that could start, revive
        or advance an idea. News and aggregates stay in Explore.

        The authored-idea grid that used to sit above this is gone. It was
        kept for one pass so the two could be compared side by side, and two
        fields answering the same question is exactly the "which of these am
        I looking at" the lens should not ask. Authored ideas are not lost:
        they reach this field through `ideasToExplore`, and the kind chip
        keeps them distinguishable from a name Tesseract raised itself.

        Mounted directly under the scroll container, with no wrapper of its
        own -- the same two-element structure Research and Portfolio have. A
        lens is a scroll region and a gallery; anything between them is what
        put this one's field at a different indent and a different starting
        height from its neighbours.
      */}
      <OpportunityGrid
        /* The coverage scan's candidates, and the names already spoken for.
           Projected into Explore's shape and ranked with everything else --
           see `coverageExplorePrompts`. */
        coverageCandidates={gaps.candidates}
        excludeAssetIds={ideaAssetIds}
        /* A failed or org-less coverage scan is named, not swallowed. It costs
           the prompts, not the lens, so it is a gap in the note rather than a
           full-page error that would overstate it. */
        extraMissing={
          gaps.status === 'error' || gaps.status === 'no_org'
            ? ['coverage prompts']
            : []
        }
        /*
          The deck, not the asset page.

          This called `openAsset`, which leaves the dashboard entirely and
          drops the reader on a full asset route -- so a tile in Ideas behaved
          unlike a tile in every other lens, where opening a tile expands it
          into the work surface with the rest of the field beside it in the
          rail. Decisions, Portfolio and Research all call
          `openDashboardFocus`; this is the same call with this lens's
          vocabulary.

          `objectType: 'asset'` is the honest type. A candidate is not an idea
          row -- nobody has staged it, and `objectType: 'idea'` with an explore
          item's id would name a row the deck cannot load. Research opens
          assets the same way and its workspace handles them, which is why
          `workspaceLens` is `research`: it is the surface that can actually
          show an asset nobody has written an idea about yet.

          A candidate with no asset id is not openable and is never given the
          action -- checked here rather than navigating to nothing.
        */
        onOpen={(o, rail) => {
          if (!o.item.assetId) return
          openDashboardFocus({
            target: {
              originLens: 'ideas',
              workspaceLens: 'research',
              objectType: 'asset',
              objectId: o.item.assetId,
              symbol: o.item.symbol ?? null,
              label: o.item.companyName ?? null,
              portfolioName: o.item.portfolio?.name ?? null,
              /* The producer's own words for the state. This lens does not
                 re-describe a finding it did not detect. */
              issue: o.item.title,
              origin: 'ideas',
            },
            backLabel: 'Ideas',
            rail,
          })
        }}
      />
    </div>
  )
}

/**
 * How long an idea can sit before the page says so.
 *
 * The card's own threshold, in one place so the header and the tile cannot
 * disagree about which ideas have gone cold.
 */
export const STALE_DAYS = 120

/**
 * The field in one line: what is waiting on a judgment, and what has gone cold.
 *
 * Deliberately not a stage breakdown. Counting how many ideas are in each of
 * four maturities describes the workflow; these two describe the book. Neither
 * clause is printed when it is zero -- a field with nothing outstanding should
 * say so by saying nothing, not by printing "0 awaiting a decision".
 */
export function summarise(ideas: IdeaRow[]): string {
  const now = Date.now()
  if (!ideas.length) return 'Nothing open yet. These are names on your coverage worth a look.'
  const deciding = ideas.filter(
    i => i.maturity === 'deciding' || i.maturity === 'decision_ready').length
  const stale = ideas.filter(
    i => (now - new Date(i.createdAt).getTime()) / 86_400_000 >= STALE_DAYS).length

  const parts = [
    deciding ? `${deciding} awaiting a decision` : null,
    stale ? `${stale} open more than ${Math.round(STALE_DAYS / 30)} months` : null,
  ].filter(Boolean)

  if (!parts.length) return 'Active investment ideas. Nothing is overdue a decision.'
  return `${parts.join(' · ')}.`
}

/**
 * An idea as a rail card.
 *
 * The claim is what distinguishes one belief from another, so it is the line
 * of substance. Direction and maturity are the state; nothing is coloured by
 * buy-versus-sell, which is a stance and not a severity.
 */
export function toRailCard(
  i: IdeaRow, weightPct?: number, frame?: ScanFrame, openAt?: number,
): RailCard {
  const deciding = i.maturity === 'deciding' || i.maturity === 'decision_ready'
  return {
    id: i.id,
    workspaceLens: 'ideas',
    objectType: 'idea',
    symbol: i.symbol,
    reason: `${i.direction ?? 'idea'} \u00b7 ${MATURITY_LABEL[i.maturity]}`,
    tone: deciding ? 'review' : 'neutral',
    figure: i.proposedWeight != null ? `${i.proposedWeight.toFixed(1)}%`
      : weightPct != null ? `${weightPct.toFixed(1)}%` : null,
    figureLabel: i.proposedWeight != null ? 'proposed' : weightPct != null ? 'held' : null,
    // Proposed against held is the whole shape of a sizing decision, and both
    // are already in hand. Never shown twice as the same number.
    secondary: i.proposedWeight != null && weightPct != null
      ? { value: `${weightPct.toFixed(1)}%`, label: 'held' }
      : null,
    detail: i.thesis ?? 'No claim written yet',
    /*
     * The same move the card draws, measured from the same mark.
     *
     * Against the idea's own opening price where one is known, and against
     * the start of the window otherwise -- never against an invented base.
     * Null when there is no series, so a name with no price shows no picture
     * rather than a flat line pretending to be one.
     */
    spark: frame?.closes?.length
      ? {
          closes: frame.closes.map(c => c.close),
          changePct: (() => {
            const from = openAt ?? frame.closes[0].close
            const to = frame.spot ?? frame.closes[frame.closes.length - 1].close
            return from > 0 ? ((to - from) / from) * 100 : 0
          })(),
        }
      : null,
    portfolioId: i.portfolioId,
    portfolioName: i.portfolioName,
    issue: MATURITY_LABEL[i.maturity],
  }
}

/* ----------------------------------------------------------------- states */

/*
  The lens-level skeleton is gone with the gate that showed it.

  It was built from `spanForRank` so its placeholders would occupy the columns
  the authored grid was about to occupy -- a fade rather than a re-layout. That
  property still matters and is still honoured, one level down: `OpportunityGrid`
  renders `GallerySkeleton` sized by `opportunitySize`, the same function the
  loaded field uses. The skeleton moved to the field because the loading state
  belongs to whoever is doing the loading.
*/

/*
  `Empty` and `ScanUnavailable` are gone, and the distinction they carried
  is not.

  Both were whole-lens states decided on the authored list. The field decides
  its own emptiness now, because it is the only thing that can -- see
  `OpportunityGrid`.

  What had to survive is the reason `ScanUnavailable` existed: "no open ideas"
  is a claim about the desk and the best possible state, while a failed read is
  the opposite, and rendering the good news over the failure is how a broken
  query goes unnoticed for weeks. A failed coverage scan no longer empties this
  lens -- it costs the prompts that supplement a thin field, and nothing else --
  so it is reported as a named gap in the field's own note rather than as a
  full-page error that would overstate it. See `missing` below.
*/
