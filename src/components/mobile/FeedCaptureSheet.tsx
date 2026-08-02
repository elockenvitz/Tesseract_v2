import { useState } from 'react'
import { clsx } from 'clsx'
import { ArrowLeft, Lightbulb, MessageSquareQuote, Target, TrendingUp } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { QuickThoughtCapture } from '../thoughts/QuickThoughtCapture'
import { QuickTradeIdeaCapture } from '../thoughts/QuickTradeIdeaCapture'
import { RecommendationQuickModal } from '../thoughts/RecommendationQuickModal'
import { PromptModal } from '../thoughts/PromptModal'
import type { CapturedContext } from '../thoughts/ContextSelector'

type CaptureKind = 'thought' | 'trade-idea' | 'recommendation' | 'prompt'

interface FeedCaptureSheetProps {
  open: boolean
  onClose: () => void
  /** Asset of the tile the reader was looking at, so capture starts in context. */
  assetId?: string | null
  assetSymbol?: string | null
  assetName?: string | null
  /** What was on screen, recorded as the thought's provenance. */
  context?: CapturedContext | null
  onCaptured?: (kind: CaptureKind) => void
}

const OPTIONS: {
  kind: CaptureKind
  label: string
  hint: string
  icon: typeof Lightbulb
  tone: string
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
  onCaptured,
}: FeedCaptureSheetProps) {
  const [kind, setKind] = useState<CaptureKind | null>(null)

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
      title={kind ? undefined : 'Capture'}
      snapPoints={kind ? [0.92] : [0.5]}
    >
      {kind === null ? (
        <div className="px-3 pb-4">
          {assetSymbol && (
            <p className="px-1 pb-2 text-xs text-gray-500 dark:text-gray-400">
              Attached to <span className="font-semibold text-gray-700 dark:text-gray-200">{assetSymbol}</span>
            </p>
          )}
          <div className="space-y-1">
            {OPTIONS.map(opt => {
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
