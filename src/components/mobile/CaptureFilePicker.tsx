import { useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Loader2, Plus, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'
import { useToast } from '../common/Toast'

interface CaptureFilePickerProps {
  target: 'list' | 'theme'
  assetId: string
  assetSymbol?: string | null
  onDone: () => void
}

/**
 * Filing an asset into a list or a theme, from the feed.
 *
 * "I should keep an eye on this" is the most common reaction to a feed card
 * and the one the sheet could not previously act on — the four capture options
 * all produced *writing*, so the only way to file something was to leave the
 * feed, find the list and add it there. By then the impulse has cost more than
 * it was worth.
 *
 * Deliberately a picker rather than a form: filing is a one-tap act, and
 * anything that asks for a title first is a different feature.
 */
export function CaptureFilePicker({ target, assetId, assetSymbol, onDone }: CaptureFilePickerProps) {
  const { user } = useAuth()
  // created_by alone is not a tenant filter: a user in two orgs would be
  // offered lists from both, in whichever one they happen to be capturing.
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  /**
   * What this session has filed into, on top of what the server reported.
   *
   * A set rather than the single id it was: filing into three lists in one pass
   * has to leave all three reading as members, not just the last one. The
   * server's own membership query stays the source of truth and is invalidated
   * on every add; this is what makes the row change under the thumb before that
   * round trip lands.
   */
  const [justAdded, setJustAdded] = useState<Set<string>>(() => new Set())
  /** The confirmation toast fires once, not once per add. */
  const hasToastedRef = useRef(false)
  const toast = useToast()

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['capture-file-options', target, user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      if (target === 'list') {
        /*
          Owned AND shared, which is what "my lists" means.

          ── The defect this closes ──────────────────────────────────────────
          This asked for `created_by = me` and nothing else, so a list a
          colleague had shared with the reader simply did not appear — while
          the desktop `AddToListButton`, looking at the same asset, offered it.
          Filing from a phone showed a shorter list than filing from a laptop,
          with no sign that anything was missing.

          The org filter stays: `created_by` alone is not a tenant filter, and a
          user in two organisations must not be offered the other one's lists.
          The collaboration arm is joined through `asset_lists` so the same
          scoping applies to it.
        */
        const [owned, shared] = await Promise.all([
          supabase
            .from('asset_lists')
            .select('id, name, color, is_default')
            /*
              `is_default OR organization_id`, which is the predicate the
              migration that added the column wrote down.

              ── Why `.eq('organization_id', …)` returned nothing ─────────────
              `20260603160000_asset_lists_organization_id` deliberately leaves
              two kinds of row org-NULL: the two system-seeded default lists
              every user gets on signup ("Investment Ideas", "Work in Process"),
              which are user-level globals by design, and every list that
              existed before the migration, whose origin org cannot be
              reconstructed.

              A pilot who has never hand-made a list owns exactly those two, so
              an equality filter on the org returned an empty picker — while the
              desktop button, which filters on `created_by` alone, showed them.
              "Works on my laptop, empty on my phone" was that one operator.

              `useListSurfaces` and `AssetListManager` already read it this way.
            */
            .or(`is_default.eq.true,organization_id.eq.${currentOrgId!}`)
            .eq('created_by', user!.id)
            .order('updated_at', { ascending: false })
            .limit(50),
          supabase
            .from('asset_list_collaborations')
            .select('asset_lists!inner(id, name, color, is_default, organization_id, updated_at)')
            .eq('user_id', user!.id)
            .limit(50),
        ])
        const sharedLists = (((shared.data as any[]) ?? [])
          .map(c => c.asset_lists)
          .filter(Boolean) as any[])
          // Same rule on the shared arm: a default list shared with you is
          // still org-NULL, and dropping it here would reintroduce the bug on
          // the other side of the join.
          .filter(l => l.is_default === true || l.organization_id === currentOrgId)
        // Deduplicate: a list can be both owned and collaborated on.
        return Array.from(
          new Map([...(((owned.data as any[]) ?? [])), ...sharedLists].map(l => [l.id, l])).values(),
        )
      }
      // Themes carry no collaboration table, so ownership is the whole set the
      // reader can file into. Scoped to the organisation for the same reason
      // the lists are.
      const { data } = await supabase
        .from('themes')
        .select('id, name, color')
        .eq('organization_id', currentOrgId!)
        .order('updated_at', { ascending: false })
        .limit(50)
      return (data as any[]) ?? []
    },
  })

  /** Where the asset already sits, so we can say so rather than duplicating. */
  const { data: existing = new Set<string>() } = useQuery({
    queryKey: ['capture-file-existing', target, assetId],
    enabled: !!assetId,
    staleTime: 30_000,
    queryFn: async () => {
      if (target === 'list') {
        const { data } = await supabase
          .from('asset_list_items')
          .select('list_id')
          .eq('asset_id', assetId)
        return new Set(((data as any[]) ?? []).map(r => r.list_id))
      }
      const { data } = await supabase
        .from('theme_assets')
        .select('theme_id')
        .eq('asset_id', assetId)
      return new Set(((data as any[]) ?? []).map(r => r.theme_id))
    },
  })

  const add = useMutation({
    mutationFn: async (id: string) => {
      // Cast through `any`: the generated Supabase types resolve these inserts
      // to `never`, the same inference problem the rest of the codebase works
      // around at every insert site.
      if (target === 'list') {
        const { error } = await (supabase.from('asset_list_items') as any)
          .insert({ list_id: id, asset_id: assetId, added_by: user?.id })
        if (error) throw error
      } else {
        const { error } = await (supabase.from('theme_assets') as any)
          .insert({ theme_id: id, asset_id: assetId })
        if (error) throw error
      }
      return { id, name: options.find((o: any) => o.id === id)?.name ?? (target === 'list' ? 'the list' : 'the theme') }
    },
    onSuccess: onFiled,
  })

  /**
   * What happens after a successful file, whichever route got there.
   *
   * ── Why the drawer no longer closes ───────────────────────────────────────
   *
   * It closed 550ms after the first add, which made filing into three lists
   * three round trips through the actions sheet. Adding one name to several
   * lists is the normal case, not the exception, so the picker stays open and
   * the row it just filed into becomes the receipt.
   *
   * The toast is kept for the FIRST add only. Firing one per add turned a
   * quick pass over four lists into four overlays covering the picker being
   * used — the confirmation drowning the thing it was confirming.
   */
  function onFiled({ id, name }: { id: string; name: string }) {
    {
      setJustAdded(prev => new Set(prev).add(id))
      queryClient.invalidateQueries({ queryKey: ['capture-file-options', target] })
      queryClient.invalidateQueries({ queryKey: ['capture-file-existing', target, assetId] })
      queryClient.invalidateQueries({ queryKey: target === 'list' ? ['list-surfaces'] : ['themes'] })
      /*
        Say what happened, and offer the way in.

        Filing gave no feedback beyond a tick that the closing sheet took with
        it, and no route to the thing just filed into — so "did that work, and
        where did it go" had no answer. The toast is the product's existing
        primitive and already carries an action, so this introduces no second
        notification system. It does NOT navigate on its own: the reader was
        capturing from a feed and being moved off it unasked would cost more
        than the confirmation is worth.
      */
      if (!hasToastedRef.current) {
        hasToastedRef.current = true
        toast.success(`Added to ${name}`, {
          action: {
            label: target === 'list' ? 'View list' : 'View theme',
            onClick: () => window.dispatchEvent(new CustomEvent(
              target === 'list' ? 'navigate-to-list' : 'navigate-to-theme',
              { detail: { id, name } },
            )),
          },
        })
      }
      // No auto-close. The reader dismisses when they are done filing.
    }
  }

  /**
   * Create the thing being searched for, and file into it in one go.
   *
   * The picker offered no way out of an empty result: typing the name of a list
   * that did not exist yet produced "No lists match" and a dead end, so filing
   * a new idea meant leaving the feed to make the list first — the exact
   * round trip this sheet exists to remove.
   *
   * The payloads are the desktop buttons' payloads, unchanged: a `mutual` list
   * or a plain theme, then the link row. Nothing new is persisted and no schema
   * moves.
   */
  const createAndAdd = useMutation({
    mutationFn: async (name: string) => {
      if (target === 'list') {
        const { data, error } = await (supabase.from('asset_lists') as any)
          // `organization_id` explicitly, even though a BEFORE INSERT trigger
          // would stamp it. The org-scope guard reads the call site, not the
          // schema, and it is right to: a reader of this line should be able to
          // see which tenant the row lands in without going to find a trigger.
          .insert({ name, created_by: user?.id, list_type: 'mutual', organization_id: currentOrgId })
          .select('id').single()
        if (error) throw error
        const { error: linkError } = await (supabase.from('asset_list_items') as any)
          .insert({ list_id: data.id, asset_id: assetId, added_by: user?.id })
        if (linkError) throw linkError
        return { id: data.id as string, name }
      }
      const { data, error } = await (supabase.from('themes') as any)
        .insert({ name, created_by: user?.id, organization_id: currentOrgId })
        .select('id').single()
      if (error) throw error
      const { error: linkError } = await (supabase.from('theme_assets') as any)
        .insert({ theme_id: data.id, asset_id: assetId })
      if (linkError) throw linkError
      return { id: data.id as string, name }
    },
    onSuccess: onFiled,
  })

  /**
   * Whether to offer creation.
   *
   * Only once something has been typed, and only when nothing already carries
   * that exact name — offering "Create Watchlist" beside an existing Watchlist
   * invites a duplicate the reader did not mean to make.
   */
  const canCreate = useMemo(() => {
    const q = query.trim()
    if (q.length === 0) return false
    return !options.some((o: any) => (o.name ?? '').trim().toLowerCase() === q.toLowerCase())
  }, [options, query])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter((o: any) => (o.name ?? '').toLowerCase().includes(q))
  }, [options, query])

  return (
    <div className="flex flex-col min-h-0">
      <div className="flex-shrink-0 px-3 pb-2">
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
          Add <span className="font-semibold text-gray-700 dark:text-gray-200">{assetSymbol ?? 'this asset'}</span>
          {' '}to a {target}
        </p>
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${target}s…`}
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 dark:border-gray-700 rounded-lg bg-white dark:bg-gray-900 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 pb-safe">
        {isLoading ? (
          <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        ) : filtered.length === 0 && !canCreate ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {query ? `No ${target}s match “${query}”` : `No ${target}s yet`}
          </p>
        ) : (
          <div className="space-y-0.5">
            {/* Create what was searched for, and file into it.

                Typing the name of a list that does not exist yet used to
                produce "No lists match" and a dead end — so filing a new idea
                meant leaving the feed to make the list first, which is the
                round trip this sheet exists to remove. */}
            {canCreate && (
              <button
                type="button"
                disabled={createAndAdd.isPending}
                onClick={() => createAndAdd.mutate(query.trim())}
                className="w-full flex items-center gap-3 min-h-[52px] px-2 rounded-xl text-left active:bg-gray-100 dark:active:bg-gray-800 transition-colors"
              >
                <span className="h-2.5 w-2.5 rounded-full flex-shrink-0 border border-dashed border-gray-400" />
                <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200 truncate">
                  Create <span className="font-semibold">{query.trim()}</span>
                </span>
                {createAndAdd.isPending
                  ? <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />
                  : <Plus className="h-4 w-4 text-gray-400 shrink-0" />}
              </button>
            )}
            {/* A membership row, not a one-shot action.

                Each row says whether the asset is in that destination and, if
                not, offers to put it there. Filing several in a pass is the
                normal case, so the row is the receipt and the picker stays put.

                Membership is the SERVER's answer — the `existing` query — plus
                what this session has filed since. Optimistic state alone would
                claim a membership a failed insert never created. */}
            {filtered.map((o: any) => {
              const addedNow = justAdded.has(o.id)
              const already = existing.has(o.id) || addedNow
              const pending = add.isPending && add.variables === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  // Duplicate prevention is the row's own job as well as the
                  // table's: a member cannot be tapped again.
                  disabled={already || pending}
                  onClick={() => add.mutate(o.id)}
                  aria-pressed={already}
                  className={clsx(
                    'w-full flex items-center gap-3 min-h-[52px] px-2 rounded-xl text-left transition-colors',
                    already ? 'opacity-70' : 'active:bg-gray-100 dark:active:bg-gray-800',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: o.color || '#3b82f6' }}
                  />
                  <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {o.name}
                  </span>
                  {pending ? (
                    <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />
                  ) : already ? (
                    <span className="flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Check className="h-4 w-4" />
                      Added
                    </span>
                  ) : (
                    <span className="flex items-center gap-0.5 text-xs font-medium text-gray-400 shrink-0">
                      <Plus className="h-4 w-4" />
                      Add
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {/* Errors sit under the list rather than replacing it. A failed add is
            one row's problem and must not cost the reader the picker they were
            part way through using. */}
        {(add.isError || createAndAdd.isError) && (
          <p className="py-2 text-center text-xs text-red-600">
            Couldn't add — {((add.error ?? createAndAdd.error) as any)?.message ?? 'please try again'}
          </p>
        )}
      </div>
    </div>
  )
}
