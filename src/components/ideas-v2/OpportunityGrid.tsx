/**
 * Desktop Ideas: the opportunity set, as a ranked heterogeneous grid.
 *
 * ── What this is, and what it is not ─────────────────────────────────────
 *
 * It is the dashboard counterpart to mobile Explore, reading the SAME
 * candidates: `useDesktopExplore` composes them through the mobile adapters
 * and ranks them with `diversifyExplore`, and `lib/desktop-ideas/opportunity`
 * narrows that to the subset carrying an investment question. No desktop
 * recommendation engine exists, and none is created here.
 *
 * It is not mobile's UI at desktop width. Mobile reads a feed -- one column,
 * one card at a time, scrolled. A desk with a monitor is comparing, so this is
 * a grid: the strongest candidate takes the hero, the next take large and
 * medium, and the tail runs compact. Same truth, different arrangement, which
 * is the whole reason the candidate layer is shared and the presentation is
 * not.
 *
 * ── Every card answers three questions ───────────────────────────────────
 *
 *   Why this name?   the kind chip and the title the adapter wrote
 *   Why now?         the context line, at rest on the shelf
 *   What next?       the verbs, on hover, from the shared resolver
 *
 * ── Generated opportunities do not masquerade as ideas ───────────────────
 *
 * An idea somebody wrote and a name Tesseract thinks is worth exploring are
 * different objects and are marked as such: the kind chip names what raised
 * the candidate, and a generated one never borrows the vocabulary of an
 * authored idea. Both belong in the lens; only one of them is somebody's
 * stated intent.
 */
import { useCallback, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  DesktopGallery, DesktopTile, TileState, TileIdentity, TileReason, TileFigure,
  TileAction, GallerySkeleton, type TileSize,
} from '../desktop/DesktopTile'
import { TilePriceChart } from '../desktop/TilePriceChart'
import { useTileCloses } from '../../hooks/useTileCloses'
import { ExploreVisualBlock } from '../mobile/ExploreVisual'
import { exploreVisualFor } from '../../lib/mobile/explore-visual'
import { useDesktopExplore } from '../../hooks/useDesktopExplore'
import type { RailCard } from '../../lib/dashboard/focus'
import { coverageExplorePrompts } from '../../lib/desktop-ideas/coverage-prompts'
import type { CoverageResearchCandidate } from '../../lib/research/coverage-research-gaps'
import {
  opportunitiesFrom, opportunitySize, withFeatureBudget, targetForOpportunity,
  OPPORTUNITY_LABEL, type Opportunity,
} from '../../lib/desktop-ideas/opportunity'
import { askAI, canDiscuss, discuss } from '../../lib/engagement'
import type { SemanticTone } from '../../lib/semantic-tone'

/**
 * Tone carries CONDITION, never the kind of candidate.
 *
 * A price move is not a problem and a missing thesis is not an emergency;
 * what earns ink is the adapter's own `positive === false`, which is the one
 * place a producer has said something is going against the desk.
 */
function toneFor(o: Opportunity): SemanticTone {
  if (o.item.positive === false) return 'review'
  return 'neutral'
}

/* One frozen empty set, so a lens that passes nothing does not hand the
   supplier a new object every render and re-rank the field. */
const EMPTY_IDS: ReadonlySet<string> = new Set()

export function OpportunityGrid({
  onOpen,
  excludeAssetIds,
  coverageCandidates,
  extraMissing,
}: {
  /**
   * The shell owns navigation; this hands back the item that was chosen and
   * the population it came out of.
   *
   * The rail is supplied here because only this component knows the peer set:
   * it composes and ranks the candidates, and the deck needs the WHOLE
   * population in the field's own order so a card re-enters the rail when the
   * reader rotates away from it.
   */
  onOpen: (o: Opportunity, rail: RailCard[]) => void
  /**
   * Every asset a real idea already concerns, so a prompt never suggests
   * starting work that exists.
   *
   * Supplied by the lens rather than read here, because it must include ideas
   * the FIELD does not show -- a graduated pilot's seeded demo rows are hidden
   * and still count. Only the workspace knows that set.
   */
  excludeAssetIds?: ReadonlySet<string>
  /** Told, not discovered: the lens owns the coverage query. */
  coverageCandidates?: readonly CoverageResearchCandidate[]
  /**
   * Producers the caller knows are not answering.
   *
   * Named beside this grid's own gaps rather than swallowed. A failed coverage
   * scan costs the prompts that top up a thin field; it does not empty the
   * lens, and it must not be reported as though it had -- but it must be
   * reported.
   */
  extraMissing?: readonly string[]
}) {
  /*
   * Coverage prompts, composed with the producers rather than after them.
   *
   * `coverageExplorePrompts` applies the same `selectCoverageWork` with the
   * same caps and the same exclusion set the authored field used, so every
   * safety rule survives the change of shape -- and `useDesktopExplore` admits
   * them to `base`, so `diversifyExplore` ranks them against everything else
   * instead of appending a second section.
   */
  const extra = useCallback(
    (realCount: number) => coverageExplorePrompts(coverageCandidates ?? [], {
      realCount,
      ideaAssetIds: excludeAssetIds ?? EMPTY_IDS,
    }),
    [coverageCandidates, excludeAssetIds],
  )

  const { items, isLoading, missing: ownMissing } = useDesktopExplore({ extra })

  /* This grid's gaps and the caller's, in one list. A producer with no data is
     a gap to report, wherever it was noticed. */
  const missing = useMemo(
    () => [...ownMissing, ...(extraMissing ?? [])],
    [ownMissing, extraMissing],
  )

  const opportunities = useMemo(() => opportunitiesFrom(items), [items])

  /* Sized by each candidate's own content, then trimmed by the page's emphasis
     budget -- so wide cards fall where the content is rather than all at the
     top, and the page still cannot spend emphasis until it means nothing. */
  const sizes = useMemo(
    () => withFeatureBudget(opportunities.map(opportunitySize)),
    [opportunities],
  )

  /*
   * The peer population for the deck's rail, in the field's own order.
   *
   * Every value is a fact the producer already set. `reason` is the kind chip
   * rather than the headline, because the rail's job is to say what SORT of
   * thing each neighbour is -- ten clamped headlines are ten paragraphs, which
   * is the problem the rail's own notes describe.
   */
  const rail = useMemo<RailCard[]>(() => opportunities
    .filter(o => !!o.item.assetId)
    .map(o => ({
      id: o.item.assetId!,
      workspaceLens: 'research' as const,
      objectType: 'asset' as const,
      symbol: o.item.symbol ?? null,
      reason: OPPORTUNITY_LABEL[o.kind],
      tone: o.item.positive === false ? ('review' as const) : ('neutral' as const),
      figure: o.item.metric?.value ?? null,
      figureLabel: o.item.metric?.label ?? null,
      detail: o.item.title ?? null,
    })), [opportunities])

  if (isLoading && opportunities.length === 0) {
    return <GallerySkeleton title="Ideas" sizeAt={i => opportunitySize(
      { composed: { emphasis: 'standard' } } as Opportunity, i) as TileSize} />
  }

  /*
   * The field decides its own empty state.
   *
   * It used to be decided a level up, on a list of authored ideas this grid
   * does not read -- so a reader with no written ideas was told the lens was
   * empty while a full opportunity set sat here unrendered. The only list that
   * can answer "is there anything to show" is the one being shown.
   */
  if (opportunities.length === 0) {
    return (
      <DesktopGallery
        title="Ideas"
        note={
          <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
            Nothing to explore yet. Ideas appear as positions move, research
            lands, and names on your coverage go unexamined.
            {missing.length > 0 && ` Not yet reaching desktop: ${missing.join(', ')}.`}
          </p>
        }
      >
        {null}
      </DesktopGallery>
    )
  }

  return (
    <DesktopGallery
      title="Ideas"
      count={opportunities.length}
      /*
        Dense packing, allowed HERE and nowhere else.

        `diversifyExplore` ranks by interestingness, which is an ordering of
        emphasis rather than a promise that #7 matters less than #4 -- mobile's
        own packer already promotes within a lookahead for exactly this reason.
        So backfilling a short row with a later narrow card costs no meaning,
        and it closes the holes a 6-wide leaves when it cannot fit the tail of
        a row. Decisions, Portfolio and Research stay `ranked`: their order is
        a real ranking and reordering it would lie.
      */
      flow="packed"
      /* The note takes Research and Portfolio's measure and type. It was 11px
         grey-500 against their 12px grey-600 at a 74ch measure, so three
         lenses sharing one shell had three different sub-headings. */
      note={
        <p className="max-w-[74ch] text-[12px] text-gray-600 dark:text-gray-400">
          Where the next idea might come from — ranked, and mixed on purpose.
          {/* Named, not filled. A producer with no data is a gap to report
              rather than a hole to plug with a substitute. */}
          {missing.length > 0 && ` Not yet reaching desktop: ${missing.join(', ')}.`}
        </p>
      }
    >
      {opportunities.map((o, i) => (
        <OpportunityTile
          key={o.item.id}
          o={o}
          size={sizes[i]}
          onOpen={() => onOpen(o, rail)}
        />
      ))}
    </DesktopGallery>
  )
}

function OpportunityTile({
  o, size, onOpen,
}: {
  o: Opportunity
  size: TileSize
  onOpen: () => void
}) {
  const item = o.item
  const big = size === 'hero' || size === 'large'

  /*
   * The three verbs the authored field had, restored on the shared shelf.
   *
   * They went missing when the old grid was removed: `IdeaCard` built its own
   * hover tray and called `askAI` / `discuss` through `targetFor`, and that
   * builder takes an `IdeaRow` a candidate cannot produce. `targetForOpportunity`
   * is the same seam for the other object, binding to the ASSET so a thread
   * raised here lands where a thread raised from the idea it becomes lands.
   *
   * Asked of the seam rather than assumed, exactly as `discussable` did: a
   * candidate the adapter could not resolve to an asset gets Open alone rather
   * than two buttons that would open nothing.
   */
  const target = useMemo(() => targetForOpportunity(o), [o])
  const canTalk = !!target && canDiscuss(target)

  /*
   * The situational object, from the shared resolver. One per card: mobile's
   * vocabulary already decides which single picture a candidate's facts
   * support, and `none` is a real answer it is allowed to give.
   */
  const visual = useMemo(() => exploreVisualFor(item as never), [item])

  /*
   * The price is ambient context, not the situational object -- so it may sit
   * alongside whatever the resolver chose. Same rule the other three lenses
   * settled on, and the same shared chart, so one name's price reads the same
   * everywhere on the dashboard.
   */
  const { data: closes } = useTileCloses(item.symbol)
  const drawsPrice = big && (closes?.length ?? 0) >= 2 && visual?.kind !== 'price_trend'

  return (
    <DesktopTile
      testId="opportunity-tile"
      dataAttrs={{ 'data-kind': o.kind, 'data-subtype': item.subtype }}
      tone={toneFor(o)}
      size={size}
      onOpen={onOpen}
      eyebrow={<>
        {/* What raised this, in the shared vocabulary. A generated opportunity
            says so here rather than dressing itself as an authored idea. */}
        <TileState tone={toneFor(o)}>{OPPORTUNITY_LABEL[o.kind]}</TileState>
        {item.metric?.value && (
          <TileFigure strong={item.metric.direction === 'bad'}>
            {item.metric.value}
          </TileFigure>
        )}
      </>}
      context={<span data-testid="opportunity-why">{item.context || item.title}</span>}
      actions={<>
        <TileAction label="Open" onClick={onOpen} primary testId="opportunity-open" />
        {target && (
          <TileAction label="Ask AI" onClick={() => askAI(target)} testId="opportunity-ai" />
        )}
        {canTalk && (
          <TileAction label="Discuss" onClick={() => discuss(target!)} testId="opportunity-discuss" />
        )}
      </>}
    >
      <TileIdentity
        symbol={item.symbol ?? null}
        name={item.companyName ?? null}
        size={size}
      />

      {/* The adapter's own sentence. Never re-derived here: the producer knows
          why it raised the candidate and this lens does not. */}
      <TileReason>{item.title}</TileReason>

      {visual && visual.kind !== 'none' && (
        <div className={clsx('min-w-0', big ? 'mt-3' : 'mt-2')} data-testid="opportunity-visual">
          <ExploreVisualBlock visual={visual} now={Date.now()} />
        </div>
      )}

      {drawsPrice && (
        <div className="mt-3 min-h-0 flex-1">
          <TilePriceChart
            points={closes!}
            fill
            height={size === 'hero' ? 150 : 120}
          />
        </div>
      )}
    </DesktopTile>
  )
}
