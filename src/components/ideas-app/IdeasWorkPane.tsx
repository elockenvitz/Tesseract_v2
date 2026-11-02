import { useEffect, useState } from 'react'
import { Lightbulb } from 'lucide-react'
import { QuickThoughtDetailPanel } from '../ideas/QuickThoughtDetailPanel'
import { PromptDetailView } from '../thoughts/PromptDetailView'
import { IdeaDetail } from '../ideas-v2/IdeaDetail'
import { AssetWorkspacePane } from '../asset-v2/AssetWorkspace'
import { useTradeIdeaWorkspace } from '../../hooks/useTradeIdeaWorkspace'
import { assetFocusFor, type IdeasSelection } from '../../lib/desktop-ideas/selection'
import type { Progression } from '../../lib/desktop-ideas/progression'
import type { AttentionEntry } from '../../hooks/useDesktopAttentionFeed'

/**
 * The contextual workspace.
 *
 * ── The division of labour ────────────────────────────────────────────────
 *
 *   the tile     what happened, and why should I care
 *   this pane    what do I know about it, and what can I do now
 *
 * So the pane is not a bigger copy of the tile. The tile keeps its contextual
 * objects because they are what make it triageable at a glance; the pane
 * answers the next question.
 *
 * ── Routing is by CANDIDATE IDENTITY, not by a scan lookup ────────────────
 *
 * An earlier pass resolved selection by matching `card.entity.id` against
 * `useIdeaScan`'s rows, which only ever matched trade ideas — thoughts and
 * prompts were silently inert. Selection now carries the entry, whose `family`
 * came from the producer that made it, so every candidate knows what it is
 * without being looked up in a table that only holds one kind.
 *
 * ── Families with no work surface yet ─────────────────────────────────────
 *
 * A stale target, a target hit, a conviction gap, a crowding finding and a
 * scenario gap are not trade ideas and must not be coerced into one. Each
 * deserves its own analytical surface and none exists as an embeddable panel
 * today. They are REPORTED here rather than routed into a generic text panel,
 * which is the same rule as the Explore producer gaps: name what is missing,
 * do not substitute something that looks similar.
 */
/*
 * ── The way out is NOT drawn here ─────────────────────────────────────────
 *
 * It was, for one pass: a labelled "Back to Ideas" at the top-left of this
 * pane, replacing an unlabelled X that read as a dialog's dismiss.
 *
 * Wrong half of the screen. Pressing it does not close this pane so much as
 * give the SECTION its full width back, and the section is on the left -- so
 * a control over here points away from where the press lands. It now sits
 * above the browse column, where it is over the list it is about to widen,
 * and this pane draws identity only. See `BackToSection`.
 */
export function IdeasWorkPane({
  selection, entry, onClose, mode = null,
}: {
  /** What the reader came to DO, when a progression CTA sent them. */
  mode?: Progression['mode'] | null
  /** Stable identity. Survives the feed reranking underneath. */
  selection: IdeasSelection | null
  /** Presentation only, for the header. May be stale; never routed on. */
  entry: AttentionEntry | null
  onClose: () => void
}) {
  /*
   * Declared before the empty-state guard, because a hook cannot sit after a
   * conditional return.
   *
   * Reset on the selection's identity rather than remembered: opening a
   * second name with the first one's explanation still expanded would put the
   * band back for every subsequent read, which is the thing being removed.
   * `key`, not the object -- it is the selection's stable identity, declared
   * to survive the feed reranking underneath, and the object itself is new on
   * every rerank for the same subject.
   */
  const [whyOpen, setWhyOpen] = useState(false)
  const selectionKey = selection?.key ?? null
  useEffect(() => { setWhyOpen(false) }, [selectionKey])

  if (!selection) {
    return (
      <div className="flex h-full flex-col">
        {/* Quiet. Half a screen of empty chrome, or a second dashboard invented
            to fill it, would both be worse than one line saying what to do.
            No exit of its own: the column beside this one carries the only
            one, which is why an empty region needs no chrome at all now. */}
        <div className="flex min-h-0 flex-1 items-center justify-center px-8">
        <div className="max-w-xs text-center">
          <Lightbulb className="mx-auto h-5 w-5 text-gray-300 dark:text-gray-600" />
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
            Select an item to work on it
          </p>
          <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
            The feed keeps its place while you do.
          </p>
        </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      {/*
        ── The band is gone; the question mark moved into the header ────────

        It was a `?` in a 25px strip with its own bottom border, sitting on
        top of a work surface that draws its own header with its own ticker
        -- so the pane opened with a thin top pane stacked on a thick one for
        the sake of a single 16px control.

        The asset workspace takes `why` and renders the control beside its
        ticker, inside the header it already had. One top pane.

        ── The other three families keep the strip ──────────────────────────

        `PromptDetailView`, `QuickThoughtDetailPanel` and `IdeaDetail` do not
        take a `why`, and giving all three one is a bigger change than this.
        They are also the surfaces where the explanation carries most, since
        a thought's own header is its author and date rather than a finding.
        A fork, and a deliberate one: the band appears only where nothing
        below can hold it.
      */}
      {!selection.assetId && (
        <div className="shrink-0 border-b border-gray-200 px-4 py-1 dark:border-gray-700">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">
              {selection.symbol ?? entry?.card.surface}
            </span>
            <button
              type="button"
              onClick={() => setWhyOpen(o => !o)}
              aria-expanded={whyOpen}
              data-slot="work-why-toggle"
              // No em dash, and no "?" alone as the label: a bare glyph is not
              // a name for assistive tech.
              aria-label="Why you are here"
              className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-gray-300 text-[9px] font-bold text-gray-400 hover:border-gray-500 hover:text-gray-600 dark:border-gray-600 dark:hover:border-gray-400"
            >
              ?
            </button>
          </div>
          {whyOpen && (
            <div className="pb-1.5 pt-1" data-slot="work-why-body">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {selection.why.headline}
              </h2>
              {selection.why.reason && (
                <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400">
                  {selection.why.reason}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkSurface selection={selection} onClose={onClose} mode={mode} />
      </div>
    </div>
  )
}

function WorkSurface({ selection, onClose, mode }: {
  selection: IdeasSelection
  onClose: () => void
  mode: Progression['mode'] | null
}) {
  /*
   * Posts route by their own feed type. Every surface below already exists and
   * is already used elsewhere — this is routing, not new work surfaces.
   */
  if (selection.family === 'post') {
    if (selection.postType === 'prompt') {
      return <PromptDetailView promptId={selection.objectId!} onClose={onClose} />
    }
    if (selection.postType === 'thought') {
      return <QuickThoughtDetailPanel quickThoughtId={selection.objectId} onClose={onClose} embedded />
    }
    if (selection.postType === 'trade_idea') return <TradeIdeaSurface selection={selection} mode={mode} />
    return (
      <NotYet
        what={`A work surface for a ${selection.postType ?? 'post'}`}
        why="This post family has no dedicated work surface yet."
      />
    )
  }

  /*
   * Every machine-derived family here is an ASSET-level finding, and the
   * finding is the reason the reader arrived rather than the thing they work
   * on. So the workspace opens the underlying asset, focused on the part the
   * finding is about — a target argument lands on research, a sizing argument
   * on the position, a case-versus-price gap on the framework.
   *
   * `AssetWorkspacePane` already takes an `issue`, which is how the attention
   * event travels in with the reader. `openAsset` was rejected: it dispatches
   * a tab and would eject them from Ideas entirely, which is the flow this
   * application exists to replace.
   */
  if (selection.assetId) {
    return (
      <AssetWorkspacePane
        asset={{ id: selection.assetId, symbol: selection.symbol }}
        focus={assetFocusFor(selection.family)}
        portfolioId={selection.portfolioId}
        portfolioName={selection.portfolioName}
        issue={selection.why.headline}
        origin="ideas"
        /*
         * The explanation goes INTO that header rather than above it.
         *
         * This pane used to draw it as a band of its own -- a ticker, a
         * headline and a reason with a bottom border -- directly over a
         * header that draws its own ticker. Two top panes, and the header
         * also printed "Opened from Ideas · <the finding>", so the same
         * sentence appeared twice within eighty pixels.
         */
        why={{ headline: selection.why.headline, reason: selection.why.reason }}
      />
    )
  }

  return (
    <NotYet
      what={`A work surface for ${FAMILY_LABEL[selection.family] ?? selection.family}`}
      why="This finding does not name an asset, so there is no underlying object to open. Its attention tile is still useful; the work surface is not."
    />
  )
}

const FOCUS_FOR_MODE: Record<string, 'research' | 'thesis' | 'decision'> = {
  research: 'research', thesis: 'thesis', decision: 'decision',
}

function TradeIdeaSurface({ selection, mode }: {
  selection: IdeasSelection
  mode: Progression['mode'] | null
}) {
  const { idea, detail, exposure } = useTradeIdeaWorkspace(selection.item ?? null)
  if (!idea) {
    return <NotYet what="This trade idea" why="Its underlying row is no longer in the loaded feed." />
  }
  return (
    <IdeaDetail
      idea={idea}
      detail={detail}
      exposure={exposure}
      /*
       * The module the CTA asked for. `IdeaDetail` already takes a focus, so
       * "Advance research" lands on research rather than the workspace default
       * — which is what makes it a different destination from the tile.
       *
       * Nothing is written. Entering a research view is not evidence research
       * happened, and a CTA that advanced the pipeline for a look would put
       * false progress in the record.
       */
      focus={mode?.kind === 'idea_focus' ? FOCUS_FOR_MODE[mode.focus] : null}
      /* The attention event, preserved in the surface's own vocabulary. */
      arrivedFor={selection.why.headline}
    />
  )
}

const FAMILY_LABEL: Record<string, string> = {
  stale_target: 'a stale target',
  target_hit: 'a target hit',
  conviction: 'a conviction gap',
  crowding: 'a crowded name',
  scenario_gap: 'a case-versus-price gap',
}

function NotYet({ what, why }: { what: string; why: string }) {
  return (
    <div className="px-5 py-6">
      <p className="text-sm font-medium text-gray-700 dark:text-gray-200">{what} is not wired up yet.</p>
      <p className="mt-1.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{why}</p>
    </div>
  )
}
