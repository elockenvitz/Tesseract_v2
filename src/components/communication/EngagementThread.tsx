/**
 * Discuss — the object-linked thread half of the engagement pane.
 *
 * ── Why this is thin on purpose ───────────────────────────────────────────
 *
 * Stage D1 must not build a second messaging product. `messages` is already
 * polymorphic on `(context_type, context_id)`, and `IdeaComments` already
 * reads and writes exactly that pair, with the composer, the user join, the
 * relative timestamps and the collapse behaviour the app already ships. So
 * this component contributes precisely two things `IdeaComments` cannot know
 * about: WHICH pair to bind, and WHY the conversation was started.
 *
 * Everything else is delegated. No query, no insert, no cache key of its own.
 *
 * ── The one cast, and why it is contained here ────────────────────────────
 *
 * `IdeaComments.itemType` is typed `ItemType` — the Ideas feed's vocabulary
 * ('quick_thought' | 'trade_idea' | ...) — but the component only ever uses it
 * as the `context_type` column value. Widening that prop would edit a shipping
 * Ideas component for a reason that has nothing to do with Ideas.
 *
 * Instead the cast lives here, once, guarded by `toThreadKey`, which only ever
 * returns values from `DISCUSSABLE_OBJECT_TYPES` — an allowlist derived from
 * what production code already reads or writes on `messages`. So the cast is
 * narrowing a proven-safe string, not asserting away an unknown.
 */

import { MessageSquareOff } from 'lucide-react'
import { IdeaComments } from '../ideas/social/IdeaComments'
import { EngagementContextHeader } from './EngagementContextHeader'
import { toThreadKey } from '../../lib/engagement'
import type { EngagementTarget } from '../../lib/engagement'
import type { ItemType } from '../../hooks/ideas/types'

interface EngagementThreadProps {
  target: EngagementTarget | null
}

export function EngagementThread({ target }: EngagementThreadProps) {
  if (!target) {
    return (
      <EmptyState
        title="No object selected"
        body="Open Discuss from a surfaced item and its thread appears here, already attached to that object."
      />
    )
  }

  const key = toThreadKey(target)

  if (!key) {
    // Deliberately explicit rather than silently redirecting to the asset.
    // See the note on toThreadKey: a comment about a note is not a comment
    // about the asset, and moving it would lose it.
    return (
      <div className="flex h-full flex-col">
        <EngagementContextHeader target={target} mode="discuss" />
        <EmptyState
          title="Discussion isn't available for this object yet"
          body={`Threads attach to assets, portfolios, themes, notes, trade ideas and quick thoughts. ${target.label} is none of those, so there is nowhere to put the conversation that you would find again.`}
        />
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <EngagementContextHeader target={target} mode="discuss" />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {target.issue && (
          <p className="mb-3 text-[11.5px] leading-snug text-gray-500 dark:text-gray-500">
            This thread is attached to {target.label}. Anyone opening it later sees the
            issue that prompted it, so nobody has to reconstruct the context.
          </p>
        )}
        <IdeaComments
          // Safe by construction — see the module note on the cast.
          itemType={key.contextType as ItemType}
          itemId={key.contextId}
          maxVisible={20}
        />
      </div>
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-12 text-center">
      <MessageSquareOff className="h-5 w-5 text-gray-400 dark:text-gray-600" />
      <div className="text-[13px] font-semibold text-gray-700 dark:text-gray-300">{title}</div>
      <div className="max-w-[44ch] text-[11.5px] leading-relaxed text-gray-500 dark:text-gray-500">
        {body}
      </div>
    </div>
  )
}
