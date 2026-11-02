import { ArrowLeft, Lightbulb } from 'lucide-react'
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
 * ── The way out is named ──────────────────────────────────────────────────
 *
 * The only exit used to be an unlabelled icon in the top-right corner, which
 * is the convention for dismissing a dialog. This pane is not a dialog. The
 * reader arrived from a section they can name, so the exit says that section's
 * name and sits top-left, where a back control belongs.
 *
 * `backTo` is required rather than defaulted: a host that mounts this pane
 * knows which section the reader left, and a generic "Back" would be a worse
 * answer than making the host say.
 */
export function IdeasWorkPane({
  selection, entry, onClose, backTo, mode = null,
}: {
  /** What the reader came to DO, when a progression CTA sent them. */
  mode?: Progression['mode'] | null
  /** Stable identity. Survives the feed reranking underneath. */
  selection: IdeasSelection | null
  /** Presentation only, for the header. May be stale; never routed on. */
  entry: AttentionEntry | null
  /**
   * The section the reader came from, in the words its own tab uses. Not a
   * route: the host decides what going back means, and here it means putting
   * this pane away and giving the section its full width again.
   */
  backTo: string
  onClose: () => void
}) {
  if (!selection) {
    return (
      <div className="flex h-full flex-col">
        {/* The empty region is still a region, and it still has to be
            dismissible — it is now reachable by clearing a selection, not only
            before one is made, so the way out cannot live in the header that
            only a selected item renders. It is the same control in the same
            place either way, which is the whole reason it is one component. */}
        <div className="flex shrink-0 items-center border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
          <BackToSection backTo={backTo} onBack={onClose} />
        </div>
        {/* Quiet. Half a screen of empty chrome, or a second dashboard invented
            to fill it, would both be worse than one line saying what to do. */}
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
        Why you are here, carried from the candidate.

        Deterministic — the headline and reason the builder already computed.
        Nothing is regenerated, and no model is asked for a fact the finding
        knows. This is what makes the surface below feel entered FROM an
        attention event rather than dropped into cold.
      */}
      <div className="flex shrink-0 items-start gap-3 border-b border-gray-200 px-4 py-2.5 dark:border-gray-700">
        {/* Left, before the identity, because it answers "where am I" before
            the heading answers "what is this". */}
        <BackToSection backTo={backTo} onBack={onClose} />
        <span aria-hidden className="mt-1 h-4 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
            {selection.symbol ?? entry?.card.surface}
          </p>
          <h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">
            {selection.why.headline}
          </h2>
          {selection.why.reason && (
            <p className="mt-0.5 truncate text-[11px] text-gray-500 dark:text-gray-400">
              {selection.why.reason}
            </p>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkSurface selection={selection} onClose={onClose} mode={mode} />
      </div>
    </div>
  )
}

/**
 * The way back to the section the reader left.
 *
 * One component for both states of the pane, so the control cannot drift into
 * two places or two labels. The section's name is in the visible text rather
 * than only in an `aria-label`: the reader who needs to know which section is
 * behind this pane is looking at the screen, not listening to it.
 */
function BackToSection({ backTo, onBack }: { backTo: string; onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="-ml-1.5 flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
    >
      <ArrowLeft className="h-3.5 w-3.5 shrink-0" />
      Back to {backTo}
    </button>
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
