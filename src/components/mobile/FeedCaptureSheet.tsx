import { useEffect, useState } from 'react'
import { clsx } from 'clsx'
import { ArrowLeft, ArrowUpRight, Lightbulb, List, MessageSquareQuote, Tag, Target, TrendingUp } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { CaptureFilePicker } from './CaptureFilePicker'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { RecommendationQuickModal } from '../thoughts/RecommendationQuickModal'
import { PromptModal } from '../thoughts/PromptModal'
import type { CapturedContext } from '../thoughts/ContextSelector'

type CaptureKind = 'thought' | 'trade-idea' | 'recommendation' | 'prompt' | 'add-to-list' | 'add-to-theme'

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

const OPTIONS: {
  kind: CaptureKind
  label: string
  hint: string
  icon: typeof Lightbulb
  tone: string
  /** Hidden when the tile has no asset — filing needs something to file. */
  needsAsset?: boolean
}[] = [
  {
    kind: 'thought',
    label: 'Quick thought',
    hint: 'Something worth remembering. Structure it later.',
    icon: Lightbulb,
    tone: 'text-amber-500 bg-amber-50 dark:bg-amber-900/30',
  },
  {
    kind: 'trade-idea',
    label: 'Trade idea',
    hint: 'A position to put on, with a direction.',
    icon: TrendingUp,
    tone: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30',
  },
  {
    kind: 'recommendation',
    label: 'Recommendation',
    hint: 'Ask a PM to act. Goes to the decision queue.',
    icon: Target,
    tone: 'text-primary-600 bg-primary-50 dark:bg-primary-900/30',
  },
  {
    kind: 'prompt',
    label: 'Prompt',
    hint: 'Ask someone for work or an answer.',
    icon: MessageSquareQuote,
    tone: 'text-purple-600 bg-purple-50 dark:bg-purple-900/30',
  },
  // Filing, not writing. "Keep an eye on this" is the most common reaction to
  // a feed card and every option above it produces prose, so the only way to
  // act on it was to leave the feed and find the list — by which point the
  // impulse has cost more than it was worth. These need an asset, so they are
  // hidden on cards that have none.
  {
    kind: 'add-to-list',
    label: 'Add to a list',
    hint: 'File it somewhere you already watch.',
    icon: List,
    tone: 'text-violet-600 bg-violet-50 dark:bg-violet-900/30',
    needsAsset: true,
  },
  {
    kind: 'add-to-theme',
    label: 'Add to a theme',
    hint: 'Connect it to a thesis you are building.',
    icon: Tag,
    tone: 'text-fuchsia-600 bg-fuchsia-50 dark:bg-fuchsia-900/30',
    needsAsset: true,
  },
]

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

  // These two own their overlay, so they render outside the sheet rather than
  // inside it — nesting them would put a modal inside a drag-dismissable panel.
  if (open && kind === 'recommendation') {
    return (
      <RecommendationQuickModal
        isOpen
        onClose={close}
        context={context ?? contextFromAsset(assetId, assetSymbol)}
      />
    )
  }

  if (open && kind === 'prompt') {
    return (
      <PromptModal
        isOpen
        onClose={close}
        context={context ?? contextFromAsset(assetId, assetSymbol)}
      />
    )
  }

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
            <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {OPTIONS.find(o => o.kind === kind)?.label}
            </span>
          </div>

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
