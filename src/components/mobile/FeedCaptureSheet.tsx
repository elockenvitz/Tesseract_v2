import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowLeft, ArrowUpRight } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { CaptureFilePicker } from './CaptureFilePicker'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { RecommendationQuickModal } from '../thoughts/RecommendationQuickModal'
import { PromptModal } from '../thoughts/PromptModal'
import type { CapturedContext } from '../thoughts/ContextSelector'

import { CAPTURE_TYPES, captureType, type CaptureKind } from '../../lib/capture/capture-types'

interface FeedCaptureSheetProps {
  open: boolean
  onClose: () => void
  /** Asset of the tile the reader was looking at, so capture starts in context. */
  assetId?: string | null
  assetSymbol?: string | null
  assetName?: string | null
  /** What was on screen, recorded as the thought's provenance. */
  context?: CapturedContext | null
  /**
   * Skip the menu and open straight onto one kind.
   *
   * For controls that have already made the choice — the active-risk card's
   * what-if slider commits a specific proposed weight, and dropping the reader
   * on a six-option menu at that point discards the decision they just held
   * their thumb down for.
   */
  initialKind?: CaptureKind | null
  /** Seed text for the written kinds, so a number computed on a card is not
   *  retyped from memory. */
  initialNote?: string | null
  onCaptured?: (kind: CaptureKind) => void
  /**
   * Navigate to the asset this tile is about.
   *
   * The feed footer used to carry `Open TICKER` as a third button beside the
   * card's decision, which gave the decision a third of the bar and put two
   * ways of leaving the card either side of it. Navigation belongs with the
   * other things you might do next, not in competition with the judgement.
   *
   * Optional, and the entry is only rendered when there is an asset AND a
   * handler — a tile with no asset must not offer to open one.
   */
  onOpenAsset?: (assetId: string, symbol: string) => void
}

const OPTIONS = CAPTURE_TYPES

/** Filing picks a destination; the other kinds ask the reader to write. */
const isFiling = (kind: CaptureKind) =>
  captureType(kind)?.group === 'file'

/**
 * Capture from inside the feed.
 *
 * Reading is what prompts a thought, and until now acting on one meant leaving
 * the feed, losing your place and the thing that prompted it. The sheet opens
 * over the tile with that tile's asset already attached.
 *
 * Each option routes to the surface that already owns it —
 * QuickThoughtCapture, QuickTradeIdeaCapture, RecommendationQuickModal,
 * PromptModal — rather than reimplementing capture for phones. They carry
 * validation, provenance and org stamping that a mobile-only form would drift
 * from immediately.
 */
export function FeedCaptureSheet({
  open,
  onClose,
  assetId,
  assetSymbol,
  assetName,
  context,
  initialKind,
  initialNote,
  onCaptured,
  onOpenAsset,
}: FeedCaptureSheetProps) {
  const [kind, setKind] = useState<CaptureKind | null>(initialKind ?? null)

  // Re-seed on every open rather than once at mount. The sheet stays mounted
  // for the life of the feed, so a `useState` initialiser would apply the first
  // caller's choice to every subsequent capture.
  useEffect(() => {
    if (open) setKind(initialKind ?? null)
  }, [open, initialKind])

  const close = () => {
    setKind(null)
    onClose()
  }

  const done = (k: CaptureKind) => {
    onCaptured?.(k)
    close()
  }

  /*
    All four writable kinds render INSIDE the sheet now.

    Prompt and Recommendation used to break out and draw their own full-screen
    modals, on the grounds that nesting a modal inside a drag-dismissable panel
    would be wrong. It would be — but both have supported an `embedded` mode
    since the pane started rendering them inline, and embedded they draw no
    overlay at all. So the reason had lapsed, and the cost was that two of the
    four capture types arrived with different chrome, a different way to
    dismiss, and none of the sheet's keyboard handling.
  */

  return (
    <BottomSheet
      open={open}
      onClose={close}
      /* Named for the asset, because the sheet is no longer only about
         capture — it is everything you can do from this tile. "GOOGL actions"
         says whose actions these are, which matters when the sheet is opened
         from a feed the reader is scrolling quickly. */
      /*
        When a type is chosen, the sheet's own header carries the way back and
        the name of what is being written.

        It used to be a row at the top of the sheet BODY, which is a scrolling
        region, so the control that gets you out of a full-height writing form
        scrolled away with the form. Putting it here also removes the wrapper it
        lived in, which is what was clipping the form — see the branch below.
      */
      title={kind ? (
        <div className="flex items-center gap-2 -ml-2">
          <button
            type="button"
            onClick={() => setKind(null)}
            className="flex items-center justify-center h-9 w-9 rounded-full text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
            aria-label="Back to capture options"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="min-w-0 flex-1 truncate text-base font-semibold text-gray-900 dark:text-white">
            {captureType(kind)?.label}
          </span>
        </div>
      ) : (assetSymbol ? `${assetSymbol} actions` : 'Actions')}
      /*
        Sheet height follows the task.

        The picker is a short list and wants half a screen. A writing form
        wants the phone. `1` is the sheet's own maximum, not the screen's:
        `BottomSheet` caps every snap at `available - TOP_PEEK`, so 24px of
        backdrop stays visible and the surface still reads as a sheet rather
        than a page. `0.92` was an arbitrary gap on top of that cap, which is
        what made a writing workspace feel half-open. At `0.5` an open keyboard
        would reduce Recommendation or Prompt to a strip a few lines tall.

        Filing is a selection, not a writing task, so it keeps the shorter
        sheet and does not ask for a screen it has no use for.
      */
      snapPoints={kind === null ? [0.5] : isFiling(kind) ? [0.7] : [1]}
    >
      {kind === null ? (
        <div className="px-3 pb-4">
          {/* Navigation first, and kept apart from the rest.
              Opening the asset READS; everything below it WRITES. Running them
              together as one list of six would make "Open GOOGL" look like a
              seventh way to create something, and a reader in a hurry taps by
              position. The divider is doing real work. */}
          {assetId && assetSymbol && onOpenAsset && (
            <>
              <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Asset
              </p>
              <button
                type="button"
                data-slot="actions-open-asset"
                onClick={() => { onOpenAsset(assetId, assetSymbol); close() }}
                className="mb-2 flex min-h-[60px] w-full items-center gap-3 rounded-xl px-2 text-left transition-colors active:bg-gray-100 dark:active:bg-gray-800"
              >
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                  <ArrowUpRight className="h-5 w-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                    Open {assetSymbol}
                  </span>
                  <span className="block text-xs text-gray-500 dark:text-gray-400">
                    Research, thesis and activity
                  </span>
                </span>
              </button>
              <div className="mb-2 border-t border-gray-100 dark:border-gray-800" />
              <p className="px-1 pb-1.5 text-[11px] font-bold uppercase tracking-wide text-gray-400">
                Capture
              </p>
            </>
          )}
          {/* The attachment line is redundant once the header says "GOOGL
              actions" and the first entry says "Open GOOGL". Kept only where
              there is no asset heading above it to say the same thing. */}
          {assetSymbol && !(assetId && onOpenAsset) && (
            <p className="px-1 pb-2 text-xs text-gray-500 dark:text-gray-400">
              Attached to <span className="font-semibold text-gray-700 dark:text-gray-200">{assetSymbol}</span>
            </p>
          )}
          <div className="space-y-1">
            {/*
              One line each.

              ── Why the descriptions came off ──────────────────────────────
              Every option carried its hint as a second line, which made each
              row 60px and the four writing choices 240px before the two filing
              ones. Against a sheet opened at half of an 844px phone — and half
              of 700px on a smaller one — choosing what to capture meant
              scrolling first. A sentence under "Trade idea" is read once and
              then never again; the icon and the name are what the reader picks
              by, every time after that.

              The hint is not lost. It is the row's accessible description, so
              a screen reader still hears it, and the fuller `guidance` line
              appears above the form once a type is chosen.
            */}
            {OPTIONS.filter(opt => !opt.needsAsset || !!assetId).map((opt, i, list) => {
              const Icon = opt.icon
              // A rule where writing ends and filing begins. They are different
              // gestures and the eye should not have to read six names to work
              // that out.
              const startsFiling = opt.group === 'file' && list[i - 1]?.group === 'write'
              return (
                <div key={opt.kind}>
                  {startsFiling && (
                    <div className="my-1.5 border-t border-gray-100 dark:border-gray-800" />
                  )}
                  <button
                    type="button"
                    onClick={() => setKind(opt.kind)}
                    title={opt.hint}
                    aria-label={`${opt.label}. ${opt.hint}`}
                    className="w-full flex items-center gap-3 h-12 px-2 rounded-xl text-left active:bg-gray-100 dark:active:bg-gray-800 transition-colors"
                  >
                    <span className={clsx('h-9 w-9 rounded-lg flex items-center justify-center flex-shrink-0', opt.tone)}>
                      <Icon className="h-[18px] w-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {opt.label}
                    </span>
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /*
          One scroll owner, and no collapsed flex item.

          ── The defect this closes ──────────────────────────────────────────

          Reported as "Actions → Prompt → content at the TOP of the sheet is
          clipped/cut off", and it was geometry rather than anything in
          `PromptModal`.

          This branch was `<div class="flex flex-col min-h-0">` wrapping a
          `<div class="flex-1 min-h-0 overflow-y-auto">` that held the form.
          The wrapper has no height of its own, so it sizes to its content — and
          a `flex: 1 1 0%` child whose `min-height` has been zeroed contributes
          NOTHING to that measurement. Its hypothetical main size is its
          flex-basis, which is zero, and with the automatic minimum removed
          there is nothing to clamp it back up to its content. The form was
          therefore laid out inside a box collapsed to near nothing, with
          `overflow-y-auto` cutting off whatever did not fit — from the top,
          because that is where the box begins.

          It was also a scroller inside `BottomSheet`'s own scroller, which is
          the nested scroll trap: a drag in the form moved the inner box while
          the sheet stood still.

          Both go away by making this plain flow content. The sheet's body is
          already `flex-1 min-h-0 overflow-y-auto` against a definite height, so
          it is the only scroller needed, and content in normal flow cannot be
          collapsed by a flex basis it does not have.
        */
        <div className="px-3 pb-4">
          {/* What to do now that you have chosen, in the words the registry
              holds. The pane wrote its own sentence for each of these and they
              had drifted; both surfaces read the same line now. */}
          {captureType(kind)?.guidance && (
            <p className="pb-2 text-xs text-gray-500 dark:text-gray-400">
              {captureType(kind)!.guidance}
            </p>
          )}

          <div>
            {/* None of these carry `autoFocus`.

                A sheet that opens with the keyboard already up gives the reader
                half a screen and a decision they did not ask to make yet. They
                tap the writing area when ready, and until then the whole
                surface is theirs. Product contract, overriding the earlier
                "writing actions may autofocus" note. */}
            {kind === 'thought' && (
              <QuickThoughtCapture
                compact
                initialContent={initialNote ?? undefined}
                initialAssetId={assetId ?? undefined}
                capturedContext={context ?? contextFromAsset(assetId, assetSymbol)}
                onSuccess={() => done('thought')}
                onCancel={() => setKind(null)}
              />
            )}
            {kind === 'trade-idea' && (
              <QuickTradeIdeaCapture
                compact
                assetId={assetId ?? undefined}
                assetSymbol={assetSymbol ?? undefined}
                assetName={assetName ?? undefined}
                onSuccess={() => done('trade-idea')}
                onCancel={() => setKind(null)}
              />
            )}
            {kind === 'recommendation' && (
              <RecommendationQuickModal
                isOpen
                embedded
                onClose={() => setKind(null)}
                context={context ?? contextFromAsset(assetId, assetSymbol)}
              />
            )}
            {kind === 'prompt' && (
              <PromptModal
                isOpen
                embedded
                onClose={() => setKind(null)}
                context={context ?? contextFromAsset(assetId, assetSymbol)}
              />
            )}
            {(kind === 'add-to-list' || kind === 'add-to-theme') && assetId && (
              <CaptureFilePicker
                target={kind === 'add-to-list' ? 'list' : 'theme'}
                assetId={assetId}
                assetSymbol={assetSymbol}
                onDone={() => done(kind)}
              />
            )}
          </div>
        </div>
      )}
    </BottomSheet>
  )
}

function contextFromAsset(
  assetId?: string | null,
  assetSymbol?: string | null
): CapturedContext | null {
  if (!assetId || !assetSymbol) return null
  return { type: 'asset', id: assetId, title: assetSymbol }
}
