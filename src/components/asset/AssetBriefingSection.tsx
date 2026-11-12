/**
 * The briefing, bound to the asset page's own view of the asset.
 *
 * ── Why this wrapper exists at all ──────────────────────────────────────
 *
 * `AiBriefing` renders a briefing and knows nothing about assets. This binds
 * it to the page: which situation the reader is in, which signals the page is
 * already flagging, and where "Continue in ACT AI" goes.
 *
 * ── One resolver, two presentations ─────────────────────────────────────
 *
 * It reads `useAssetAttentionSignals`, the same hook the attention band reads,
 * served from the same React Query cache — so this adds no database read, and
 * more importantly the briefing cannot describe a different asset from the
 * band two inches above it. A second derivation would eventually disagree,
 * and a reader cannot be asked to adjudicate between two parts of one screen.
 *
 * ── Nothing runs on arrival ─────────────────────────────────────────────
 *
 * `asked` gates the fetch. A briefing costs a model call and several seconds
 * of tool lookups, so it is spent when the reader presses, not when they open
 * a page they may be passing through. Once run it is cached under a key that
 * includes the signals, so switching modes and coming back shows the same
 * briefing rather than buying a slightly different one.
 *
 * The press is remembered per ASSET, not per mount: navigating to another
 * name and back should not silently re-run a model call, and `asked` resetting
 * to false on a new asset is what makes the control reappear instead.
 *
 * ── Permission scope ────────────────────────────────────────────────────
 *
 * RLS posture: nothing new here. No table is read in this file. The signals
 * come from hooks the page already ran, and the briefing's own retrieval
 * happens inside `ai-chat` on a client built from the reader's session, so it
 * is bounded exactly as the chat pane's is.
 */
import { useState } from 'react'
import { AiBriefing } from '../ai/AiBriefing'
import { useAssetAttentionSignals } from '../../hooks/useAssetAttentionSignals'
import { useAssetBriefing } from '../../hooks/ai/useAssetBriefing'
import { briefingContextFor, briefingHandoffDraft } from '../../lib/ai/briefing'
import { askAI } from '../../lib/engagement'
import { focusForSourceKind } from '../../lib/ai/source-focus'
import { openAsset } from '../../lib/desktop-asset'
import type { AiSourceRef } from '../../lib/ai/presentation'

export interface AssetBriefingSectionProps {
  assetId: string
  symbol: string | null
  /** For the label the chat pane shows. Falls back to the symbol. */
  companyName?: string | null
  /** Coverage rows the page already fetched. */
  coveringUserIds: string[]
  /** The page's live quote, where it has one. */
  spot?: number | null
  className?: string
}

export function AssetBriefingSection({
  assetId, symbol, companyName, coveringUserIds, spot, className,
}: AssetBriefingSectionProps) {
  /*
   * Which asset the reader asked about -- not a boolean.
   *
   * A new asset is a new question: the reader's press on AAPL must not start a
   * briefing the moment MSFT mounts in the same slot. The obvious shape is a
   * boolean reset by `useEffect(() => setAsked(false), [assetId])`, and it is
   * wrong. An effect runs AFTER the render that changed the asset, so that one
   * render still reports asked -- and one render is all React Query needs to
   * start a lookup against the new asset. Deriving it leaves no such window:
   * the first render on MSFT already says no.
   */
  const [askedFor, setAskedFor] = useState<string | null>(null)
  const asked = askedFor === assetId
  const ask = () => setAskedFor(assetId)

  const { signals, state, isLoading: signalsLoading } = useAssetAttentionSignals({
    assetId, symbol, coveringUserIds, spot,
  })
  const context = briefingContextFor(state)

  const request = { context, symbol, state, signals }
  const { data, isLoading, error, refetch } = useAssetBriefing({
    ...request,
    assetId,
    /*
     * Held until the signals have settled, even after the press.
     *
     * The question names the flagged signals, so asking before they land
     * would buy a briefing about an empty page and then cache it under a key
     * that no longer matches. One press, one briefing, about what is actually
     * there.
     */
    enabled: asked && !signalsLoading,
  })

  /* The signals still arriving is not a briefing in progress. Showing the
     working row here would put a spinner on a page nobody has asked anything
     of yet. */
  if (signalsLoading && !asked) return null

  return (
    <AiBriefing
      className={className}
      context={context}
      message={data?.message ?? null}
      toolCalls={data?.toolCalls ?? []}
      /* The press counts as working from the moment it happens, including
         while the signals finish arriving, so the control cannot be pressed
         twice. */
      isLoading={asked && (isLoading || signalsLoading)}
      error={error instanceof Error ? error : null}
      onRun={ask}
      onRetry={() => { ask(); void refetch() }}
      onContinueInChat={() => {
        askAI({
          objectType: 'asset',
          objectId: assetId,
          label: companyName ? `${symbol ?? ''} ${companyName}`.trim() : (symbol ?? 'Asset'),
          symbol: symbol ?? undefined,
          assetId,
          origin: { surface: 'asset-briefing' },
          /*
           * The framing, not the briefing's prose. The pane places this in
           * the composer and never sends it, so the reader can edit or
           * discard it -- and the briefing stays on screen to read alongside
           * rather than being retyped as if they had written it.
           */
          seedPrompt: briefingHandoffDraft(request),
        })
      }}
      onOpenSource={openSource}
    />
  )
}

/**
 * A consulted record, opened where that kind of record is read.
 *
 * The trail's own default does this; it is passed explicitly so the origin
 * says which surface the reader came from, which is what a later reader needs
 * to trace a navigation back.
 */
function openSource(source: AiSourceRef) {
  if (!source.asset_id) return
  openAsset({
    assetId: source.asset_id,
    symbol: source.symbol ?? null,
    focus: focusForSourceKind(source.kind),
    origin: 'ai-briefing',
  })
}
