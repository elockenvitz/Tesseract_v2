/**
 * What to do next, in the words of why the reader is here.
 *
 * ── The rule that keeps this from becoming a toolbar ─────────────────────
 *
 * Every action in this row has a real destination that exists today, and is
 * rendered only when that destination holds something. "Where we are exposed"
 * does not appear on a name nobody holds; "Open the requirements" does not
 * appear without a process run. An action that resolves to an empty surface is
 * worse than no action: it costs the reader a click to learn the page already
 * knew the answer.
 *
 * Nothing here is new behaviour. Each control calls a handler the Asset page
 * already owns -- `onOpenSubPage`, the exposure anchor, the `askAI`
 * engagement -- so permissions, routing and the surfaces themselves are
 * untouched. There is no action that writes.
 *
 * ── Why the AI action is here and not only in the pane ───────────────────
 *
 * The ask is framed by the entry reason, which this surface knows and the
 * pane does not. `workspaceAskDraft` writes the question; the pane places it
 * in the composer and never sends it, so the reader edits or discards it.
 *
 * ── Opening ACT AI is not the same as asking it something ────────────────
 *
 * Two of these three buttons name a question -- "Ask what evidence is
 * missing", "Ask what we already hold" -- and one says only "Ask ACT AI".
 * All three used to send a `seedPrompt`, so the plain one typed a
 * three-clause question about what had changed since the case was written
 * into the composer of a reader who had asked for nothing but a blank box.
 * They then had to clear it before they could ask their own.
 *
 * The pane now seeds the composer only for an entry that names an EVENT (see
 * `lib/ai/active-context`), which makes the distinction a property of the
 * data rather than a convention. So the two buttons that promise a question
 * state the reason they are promising it, and the one that promises only to
 * open ACT AI sends no seed at all. The reason is not invented: a decision
 * waiting and requirements open are what put this surface in those modes.
 */
import { clsx } from 'clsx'
import { askAI } from '../../lib/engagement'
import { workspaceAskDraft, type BriefingContext } from '../../lib/ai/briefing'
import { scrollToSection } from '../../lib/asset-workspace/scroll-to-section'
import { EXPOSURE_ANCHOR_ID } from '../../lib/asset-workspace/strip-targets'
import type { AssetSubPage } from '../../lib/asset-workspace/modes'
import type { WorkspaceEntryMode } from '../../lib/asset-workspace/entry'

export interface WorkspaceActionsProps {
  mode: WorkspaceEntryMode
  assetId: string
  symbol: string | null
  companyName?: string | null
  /** Held in at least one book the reader can see. */
  held: boolean
  /** A written case exists, so "review the case" lands on something. */
  hasCase: boolean
  /** A process run is on record for this name. */
  hasProcess: boolean
  /**
   * The page's own navigation, narrowed to the three destinations this row
   * actually names.
   *
   * Not `AssetSubPage`: the Snapshot's handler cannot accept `'snapshot'` --
   * you do not navigate to the surface you are standing on -- and declaring
   * the wider union here made the real handler unassignable. The narrow type
   * is also the honest one: an action area that could ask for any sub-page
   * would be a router, which `WorkspaceActions` is not.
   */
  onOpenSubPage: (sub: WorkspaceActionDestination) => void
  className?: string
}

export type WorkspaceActionDestination = Extract<AssetSubPage, 'research' | 'workflow' | 'decisions'>

/** The briefing vocabulary the ask is framed in, per entry mode. */
const ASK_CONTEXT: Record<WorkspaceEntryMode, BriefingContext> = {
  general: 'review',
  decision: 'decision',
  work: 'work',
}

const ASK_LABEL: Record<WorkspaceEntryMode, string> = {
  general: 'Ask ACT AI',
  decision: 'Ask what evidence is missing',
  work: 'Ask what we already hold',
}

/**
 * Why the drafted question is being offered, per mode, or null for the mode
 * whose button offers none.
 *
 * `general` is null and that is the whole point: the pane seeds the composer
 * from an event, so a mode with no event gets an empty box. The other two
 * describe the state that put the workspace in that mode, which is the same
 * state their labels are already referring to.
 */
const ASK_REASON: Record<WorkspaceEntryMode, ((name: string) => string) | null> = {
  general: null,
  decision: name => `A decision on ${name} is waiting`,
  work: name => `Open requirements on ${name}`,
}

interface Action {
  key: string
  label: string
  onClick: () => void
  primary?: boolean
}

export function WorkspaceActions({
  mode, assetId, symbol, companyName, held, hasCase, hasProcess, onOpenSubPage, className,
}: WorkspaceActionsProps) {
  const ask = () => {
    const reason = ASK_REASON[mode]
    askAI({
      objectType: 'asset',
      objectId: assetId,
      label: companyName ? `${symbol ?? ''} ${companyName}`.trim() : (symbol ?? 'Asset'),
      symbol: symbol ?? undefined,
      assetId,
      origin: { surface: 'asset-workspace-actions' },
      /*
       * Both or neither. The pane reads the seed through the event, so a
       * seed with no issue is silently dropped and a reason with no seed is
       * a banner about nothing. Sending them as a pair is what keeps the
       * button's label and the composer's contents agreeing.
       */
      ...(reason
        ? {
            issue: { title: reason(symbol ?? 'this asset') },
            seedPrompt: workspaceAskDraft(ASK_CONTEXT[mode], symbol),
          }
        : {}),
    })
  }

  const caseAction: Action = {
    key: 'case',
    /* The label states which of the two it is, because a reader who cannot
       tell "read what we wrote" from "write something" will click neither. */
    label: hasCase ? 'Review the case' : 'Start the case',
    onClick: () => onOpenSubPage('research'),
  }
  const exposureAction: Action | null = held
    ? {
        key: 'exposure',
        label: 'Where we are exposed',
        /* Already on this surface, so this is a scroll rather than a
           navigation. The anchor is the Exposure block's own. */
        onClick: () => scrollToSection(EXPOSURE_ANCHOR_ID),
      }
    : null
  const processAction: Action | null = hasProcess
    ? {
        key: 'process',
        label: mode === 'work' ? 'Continue the process' : 'Open the requirements',
        onClick: () => onOpenSubPage('workflow'),
        primary: mode === 'work',
      }
    : null

  const actions: Action[] = (() => {
    if (mode === 'decision') {
      return [
        { key: 'decision', label: 'Open the recommendation', onClick: () => onOpenSubPage('decisions'), primary: true },
        caseAction,
        ...(processAction ? [processAction] : []),
      ]
    }
    if (mode === 'work') {
      return [...(processAction ? [processAction] : []), caseAction]
    }
    return [caseAction, ...(exposureAction ? [exposureAction] : []), ...(processAction ? [processAction] : [])]
  })()

  return (
    <div
      data-testid="workspace-actions"
      data-mode={mode}
      className={clsx('flex flex-wrap items-center gap-2', className)}
    >
      {actions.map(a => (
        <button
          key={a.key}
          type="button"
          data-testid={`workspace-action-${a.key}`}
          onClick={a.onClick}
          className={clsx(
            'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            a.primary
              ? 'bg-primary-600 text-white hover:bg-primary-700'
              : 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-white/[0.12] dark:bg-transparent dark:text-gray-200 dark:hover:bg-white/[0.06]',
          )}
        >
          {a.label}
        </button>
      ))}
      {/* Last, and never primary: the assistant is a way to interrogate what
          the firm holds, not the first thing to reach for on a page whose own
          records are right there. */}
      <button
        type="button"
        data-testid="workspace-action-ask"
        onClick={ask}
        className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-500/10"
      >
        {ASK_LABEL[mode]}
      </button>
    </div>
  )
}
