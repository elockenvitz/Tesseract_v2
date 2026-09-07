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
      title={kind ? undefined : (assetSymbol ? `${assetSymbol} actions` : 'Actions')}
      snapPoints={kind ? [0.92] : [0.5]}
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
            {OPTIONS.filter(opt => !opt.needsAsset || !!assetId).map(opt => {
              const Icon = opt.icon
              return (
                <button
                  key={opt.kind}
                  type="button"
                  onClick={() => setKind(opt.kind)}
                  className="w-full flex items-center gap-3 min-h-[60px] px-2 rounded-xl text-left active:bg-gray-100 dark:active:bg-gray-800 transition-colors"
                >
                  <span className={clsx('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0', opt.tone)}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {opt.label}
                    </span>
                    <span className="block text-xs text-gray-500 dark:text-gray-400">{opt.hint}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      ) : (
        <div className="flex flex-col min-h-0">
          <div className="flex-shrink-0 flex items-center gap-2 px-3 pb-2">
            <button
              type="button"
              onClick={() => setKind(null)}
              className="flex items-center justify-center h-9 w-9 -ml-1 rounded-full text-gray-500 dark:text-gray-400 active:bg-gray-100 dark:active:bg-gray-800 no-touch-target"
              aria-label="Back to capture options"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
              {captureType(kind)?.label}
            </span>
          </div>

          {/* What to do now that you have chosen, in the words the registry
              holds. The pane wrote its own sentence for each of these and they
              had drifted; both surfaces read the same line now. */}
          {captureType(kind)?.guidance && (
            <p className="flex-shrink-0 px-3 pb-2 text-xs text-gray-500 dark:text-gray-400">
              {captureType(kind)!.guidance}
            </p>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-4">
            {kind === 'thought' && (
              <QuickThoughtCapture
                autoFocus
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
                autoFocus
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
