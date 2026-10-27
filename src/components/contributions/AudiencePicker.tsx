/**
 * Who can read this analyst's research.
 *
 * ── What replaced what ───────────────────────────────────────────────────
 *
 * The previous control was a 256px dropdown with two nested steps: pick a
 * level, the panel swapped to a list of groups, and a ← took you back. Both
 * steps wrote straight through to the page's state, so opening the menu and
 * looking around changed the audience; the only way out was to put it back by
 * hand. Levels that reached nobody were rendered disabled with a sentence of
 * explanation inside the option, which reads as broken rather than as a state.
 *
 * This is one panel. Firm-wide sits apart from the four group scopes because
 * it is a different kind of answer — everyone, versus these specific people.
 * Choosing a scope reveals its groups beneath it rather than replacing the
 * view, so the two halves of the decision stay on screen together.
 *
 * ── Draft, then Apply ────────────────────────────────────────────────────
 *
 * Everything inside is a DRAFT. Nothing leaves this component until Apply, so
 * exploring costs nothing and Cancel is always a true undo. The footer states
 * what is saved now and what is pending, because a picker that shows only its
 * own draft cannot tell you what you are about to change FROM.
 *
 * ── Reach is inherited ───────────────────────────────────────────────────
 *
 * Counts are EFFECTIVE: a group's own members plus everyone in the groups
 * beneath it, matching `user_effective_node_ids()` on the server. Sharing with
 * a Department reaches its teams. The counts come from `effectiveMemberCounts`
 * so the number here and the rows the policy returns are the same claim.
 *
 * A group that reaches nobody is not disabled — it is listed with "no members
 * yet", which is a fact about the org chart rather than a fault in the
 * control. It cannot be the ONLY thing applied, because a restricted audience
 * naming nobody is readable by its author alone while displaying as shared,
 * and the server refuses it with 23514 anyway.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { clsx } from 'clsx'
import { Check, ChevronDown, Globe, Loader2, AlertTriangle } from 'lucide-react'
import {
  buildAudienceOptions, isLevelSelectable, unreachableReason,
  type AudienceNode, type AudienceOption,
} from '../../lib/contributions/audience-reach'

export type AudienceVisibility = 'firm' | 'division' | 'department' | 'team' | 'portfolio'

/** The four group scopes, in org-chart order: widest first. */
export const GROUP_SCOPES: ReadonlyArray<{ value: Exclude<AudienceVisibility, 'firm'>; label: string; plural: string }> = [
  { value: 'division',   label: 'Division',   plural: 'divisions' },
  { value: 'department', label: 'Department', plural: 'departments' },
  { value: 'team',       label: 'Team',       plural: 'teams' },
  { value: 'portfolio',  label: 'Portfolio',  plural: 'portfolios' },
]

export interface AudienceSelection {
  visibility: AudienceVisibility
  targetIds: string[]
}

export interface AudiencePickerProps {
  /** What is stored on the server right now. Null before it has loaded. */
  saved: AudienceSelection | null
  /** Nodes available at each scope, already filtered to the author's own
   *  effective memberships by the caller. */
  nodesFor: (visibility: AudienceVisibility) => AudienceNode[]
  /** Effective reach per node id — subtree, not direct members. */
  memberCounts: ReadonlyMap<string, number>
  /** Any node by id, so a stored target the author can no longer pick is still
   *  shown by name rather than as a bare uuid. */
  nodeById: ReadonlyMap<string, AudienceNode>
  /**
   * Commit the draft. May reject; a rejection is shown in place and the panel
   * stays open with the draft intact, so nothing is reported as saved that was
   * not.
   */
  onApply: (next: AudienceSelection) => void | Promise<void>
  /** True while the saved audience is still loading. */
  isLoading?: boolean
  className?: string
}

/** One line naming an audience, for the trigger and the footer. */
export function describeAudience(
  selection: AudienceSelection | null,
  nodeById: ReadonlyMap<string, AudienceNode>,
): string {
  if (!selection) return 'Not set'
  if (selection.visibility === 'firm') return 'Everyone at the firm'
  const names = selection.targetIds.map(id => nodeById.get(id)?.name).filter(Boolean) as string[]
  if (names.length === 0) return 'No groups selected'
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`
}

/** Total people a selection reaches. Distinct nodes, so a node listed twice
 *  counts once; the caller's counts are already distinct per node. */
export function reachOf(
  selection: AudienceSelection,
  memberCounts: ReadonlyMap<string, number>,
): number {
  if (selection.visibility === 'firm') return 0
  return [...new Set(selection.targetIds)]
    .reduce((n, id) => n + (memberCounts.get(id) ?? 0), 0)
}

const sameSelection = (a: AudienceSelection, b: AudienceSelection) =>
  a.visibility === b.visibility &&
  a.targetIds.length === b.targetIds.length &&
  [...a.targetIds].sort().every((id, i) => id === [...b.targetIds].sort()[i])

export function AudiencePicker({
  saved, nodesFor, memberCounts, nodeById, onApply, isLoading = false, className,
}: AudiencePickerProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AudienceSelection>(saved ?? { visibility: 'firm', targetIds: [] })
  const [scope, setScope] = useState<Exclude<AudienceVisibility, 'firm'>>(
    saved && saved.visibility !== 'firm' ? saved.visibility : 'division'
  )
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  /* Opening is the only moment the draft is seeded from `saved`. Re-seeding
     while open would discard what the author is in the middle of choosing if
     the query refetched underneath them. */
  const openPanel = useCallback(() => {
    const seed = saved ?? { visibility: 'firm' as const, targetIds: [] }
    setDraft(seed)
    setScope(seed.visibility !== 'firm' ? seed.visibility : 'division')
    setError(null)
    setOpen(true)
  }, [saved])

  const cancel = useCallback(() => {
    setOpen(false)
    setError(null)
    triggerRef.current?.focus()
  }, [])

  // Escape cancels; click outside cancels. Both discard the draft, which is
  // safe precisely because nothing has been written.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); cancel() } }
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)
          && !triggerRef.current?.contains(e.target as Node)) cancel()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [open, cancel])

  // Focus lands inside the panel, not back at the top of the page.
  useEffect(() => {
    if (!open) return
    const first = panelRef.current?.querySelector<HTMLElement>('[data-autofocus]')
    first?.focus()
  }, [open])

  const optionsFor = useCallback((visibility: Exclude<AudienceVisibility, 'firm'>): AudienceOption[] => {
    // The stored ids keep a saved group listed and checked even when the
    // author could no longer pick it — otherwise Apply would silently drop it.
    const storedTargetIds = saved?.visibility === visibility ? saved.targetIds : []
    return buildAudienceOptions({
      candidates: nodesFor(visibility),
      storedTargetIds,
      memberCounts,
      storedNodes: storedTargetIds.map(id => nodeById.get(id)).filter((n): n is AudienceNode => !!n),
    })
  }, [saved, nodesFor, memberCounts, nodeById])

  const scopeOptions = useMemo(() => optionsFor(scope), [optionsFor, scope])

  const toggle = (id: string) => setDraft(d => ({
    visibility: scope,
    targetIds: d.visibility === scope && d.targetIds.includes(id)
      ? d.targetIds.filter(x => x !== id)
      : d.visibility === scope ? [...d.targetIds, id] : [id],
  }))

  const chooseScope = (next: Exclude<AudienceVisibility, 'firm'>) => {
    setScope(next)
    // A team id is not a department id, so switching scope cannot carry the
    // selection over. Returning to the saved scope restores the saved ids.
    setDraft(d => d.visibility === next ? d
      : { visibility: next, targetIds: saved?.visibility === next ? saved.targetIds : [] })
  }

  const savedNow: AudienceSelection | null = saved
  const dirty = !savedNow || !sameSelection(draft, savedNow)
  const emptyRestricted = draft.visibility !== 'firm' && draft.targetIds.length === 0
  const canApply = dirty && !emptyRestricted && !applying

  const apply = async () => {
    if (!canApply) return
    setApplying(true)
    setError(null)
    try {
      await onApply({ visibility: draft.visibility, targetIds: [...draft.targetIds] })
      setOpen(false)
      triggerRef.current?.focus()
    } catch (e) {
      // Stay open, keep the draft, say what happened. The one thing this must
      // never do is close as though it worked.
      setError(e instanceof Error ? e.message : 'Could not save the audience. Nothing was changed.')
    } finally {
      setApplying(false)
    }
  }

  const draftReach = reachOf(draft, memberCounts)
  const triggerLabel = savedNow?.visibility === 'firm' || !savedNow
    ? 'Firm-wide'
    : `${GROUP_SCOPES.find(s => s.value === savedNow.visibility)?.label ?? ''} · ${savedNow.targetIds.length}`

  return (
    <div className={clsx('relative', className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? cancel() : openPanel())}
        disabled={isLoading}
        aria-haspopup="dialog"
        aria-expanded={open}
        data-testid="audience-trigger"
        className={clsx(
          'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors',
          'border border-gray-200 bg-white text-gray-700 hover:border-gray-300',
          'dark:border-white/10 dark:bg-white/[0.04] dark:text-gray-200',
          isLoading && 'opacity-60'
        )}
      >
        {isLoading
          ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          : <Globe className="h-4 w-4 text-gray-400" aria-hidden="true" />}
        <span>{isLoading ? 'Loading…' : triggerLabel}</span>
        <ChevronDown className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </button>

      {open && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Research audience"
          data-testid="audience-panel"
          className={clsx(
            'absolute right-0 top-full z-30 mt-1.5 rounded-xl border bg-white shadow-xl',
            'border-gray-200 dark:border-white/10 dark:bg-gray-900',
            // Roomy on a desktop; on a phone it spans the viewport instead of
            // becoming a 256px column of wrapped words.
            'w-[min(22rem,calc(100vw-2rem))] sm:w-[23rem]'
          )}
        >
          <div className="border-b border-gray-100 px-4 py-3 dark:border-white/10">
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Who can read this</p>
            <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400" data-testid="audience-saved-line">
              Saved: {describeAudience(savedNow, nodeById)}
            </p>
          </div>

          {/* Firm-wide, set apart. A different kind of answer from "these
              groups", so it does not sit in the same list as them. */}
          <div className="px-3 pt-3">
            <button
              type="button"
              data-autofocus
              data-testid="audience-firm"
              aria-pressed={draft.visibility === 'firm'}
              onClick={() => setDraft({ visibility: 'firm', targetIds: [] })}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left',
                draft.visibility === 'firm'
                  ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-400/30 dark:bg-emerald-500/10'
                  : 'border-gray-200 hover:bg-gray-50 dark:border-white/10 dark:hover:bg-white/[0.04]'
              )}
            >
              <Globe className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">Everyone at the firm</span>
                <span className="block text-xs text-gray-500 dark:text-gray-400">No group selection needed</span>
              </span>
              {draft.visibility === 'firm' && <Check className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />}
            </button>
          </div>

          <div className="px-3 pt-3">
            <p className="px-1 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-gray-400">
              Or specific groups
            </p>
            {/* Scope tabs. A scope you belong to no group of is still listed —
                selecting it shows why, which is more useful than a dead row. */}
            <div role="tablist" aria-label="Group scope" className="flex gap-1">
              {GROUP_SCOPES.map(s => {
                const active = scope === s.value && draft.visibility !== 'firm'
                const count = optionsFor(s.value).length
                return (
                  <button
                    key={s.value}
                    role="tab"
                    type="button"
                    aria-selected={active}
                    data-testid={`audience-scope-${s.value}`}
                    onClick={() => chooseScope(s.value)}
                    className={clsx(
                      'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
                      active
                        ? 'bg-gray-900 text-white dark:bg-white dark:text-gray-900'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]',
                      count === 0 && !active && 'text-gray-400 dark:text-gray-500'
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="max-h-64 overflow-y-auto px-3 py-2" data-testid="audience-groups">
            {draft.visibility === 'firm' ? (
              <p className="px-1 py-6 text-center text-xs text-gray-400">
                Pick a scope above to share with specific groups instead.
              </p>
            ) : scopeOptions.length === 0 ? (
              <p className="px-1 py-6 text-center text-xs text-gray-500 dark:text-gray-400" data-testid="audience-empty-scope">
                You don’t belong to any {GROUP_SCOPES.find(s => s.value === scope)?.plural}.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {scopeOptions.map(opt => {
                  const checked = draft.visibility === scope && draft.targetIds.includes(opt.id)
                  return (
                    <li key={opt.id}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={checked}
                        data-testid={`audience-group-${opt.id}`}
                        onClick={() => toggle(opt.id)}
                        className={clsx(
                          'flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left',
                          checked ? 'bg-gray-100 dark:bg-white/[0.08]' : 'hover:bg-gray-50 dark:hover:bg-white/[0.04]'
                        )}
                      >
                        <span className={clsx(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                          checked ? 'border-gray-900 bg-gray-900 dark:border-white dark:bg-white' : 'border-gray-300 dark:border-white/20'
                        )}>
                          {checked && <Check className="h-3 w-3 text-white dark:text-gray-900" />}
                        </span>
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: opt.color || '#9ca3af' }}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-gray-900 dark:text-gray-100">{opt.name}</span>
                          <span className="block text-xs text-gray-500 dark:text-gray-400">
                            {opt.reachable
                              ? `${opt.memberCount} ${opt.memberCount === 1 ? 'person' : 'people'}`
                              : 'No members yet'}
                            {opt.storedOnly && ' · already shared'}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {error && (
            <div className="mx-3 mb-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 dark:bg-red-500/10" role="alert" data-testid="audience-error">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
              <p className="text-xs text-red-700 dark:text-red-300">{error}</p>
            </div>
          )}

          <div className="border-t border-gray-100 px-4 py-3 dark:border-white/10">
            {/*
              Apply commits the choice to the editor, not to the server. The
              write happens when the section is saved, through
              set_contribution_audience. Saying so here is the difference
              between a control that looks persistent and one that is honest:
              an author who applies an audience and closes the page without
              saving has changed nothing, and should not have been told
              otherwise.
            */}
            <p className="mb-2 text-[11px] leading-snug text-gray-400 dark:text-gray-500" data-testid="audience-staging-note">
              Applies to your research when you save the section.
            </p>
            <div className="flex items-center justify-between gap-3">
            <p className="min-w-0 flex-1 text-xs text-gray-500 dark:text-gray-400" data-testid="audience-pending-line">
              {!dirty
                ? 'No changes'
                : draft.visibility === 'firm'
                  ? 'Pending: everyone at the firm'
                  : emptyRestricted
                    ? 'Pick at least one group'
                    : `Pending: ${describeAudience(draft, nodeById)} · ${draftReach} ${draftReach === 1 ? 'person' : 'people'}`}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={cancel}
                data-testid="audience-cancel"
                className="rounded-md px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/[0.06]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                disabled={!canApply}
                data-testid="audience-apply"
                className={clsx(
                  'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold',
                  canApply
                    ? 'bg-gray-900 text-white hover:bg-gray-700 dark:bg-white dark:text-gray-900'
                    : 'cursor-not-allowed bg-gray-200 text-gray-400 dark:bg-white/10 dark:text-gray-500'
                )}
              >
                {applying && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                {applying ? 'Applying…' : 'Apply'}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** Re-exported so callers can gate a scope without importing two modules. */
export { isLevelSelectable, unreachableReason }
