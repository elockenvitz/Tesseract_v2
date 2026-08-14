import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Loader2, Search } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { useOrganizationOptional } from '../../contexts/OrganizationContext'

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
  const [justAdded, setJustAdded] = useState<string | null>(null)

  const { data: options = [], isLoading } = useQuery({
    queryKey: ['capture-file-options', target, user?.id, currentOrgId],
    enabled: !!user?.id && !!currentOrgId,
    staleTime: 60_000,
    queryFn: async () => {
      if (target === 'list') {
        const { data } = await supabase
          .from('asset_lists')
          .select('id, name, color')
          .eq('organization_id', currentOrgId!)
          .eq('created_by', user!.id)
          .order('updated_at', { ascending: false })
          .limit(50)
        return (data as any[]) ?? []
      }
      const { data } = await supabase
        .from('themes')
        .select('id, name, color')
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
      return id
    },
    onSuccess: (id) => {
      setJustAdded(id)
      queryClient.invalidateQueries({ queryKey: ['capture-file-existing', target, assetId] })
      queryClient.invalidateQueries({ queryKey: target === 'list' ? ['list-surfaces'] : ['themes'] })
      // Held briefly so the tick is visible — filing gives no other feedback,
      // and a sheet that closes instantly reads as "did that work?".
      setTimeout(onDone, 550)
    },
  })

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
        ) : filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">
            {query ? `No ${target}s match “${query}”` : `No ${target}s yet`}
          </p>
        ) : (
          <div className="space-y-0.5">
            {filtered.map((o: any) => {
              const already = existing.has(o.id) || justAdded === o.id
              return (
                <button
                  key={o.id}
                  type="button"
                  disabled={already || add.isPending}
                  onClick={() => add.mutate(o.id)}
                  className={clsx(
                    'w-full flex items-center gap-3 min-h-[52px] px-2 rounded-xl text-left transition-colors',
                    already ? 'opacity-60' : 'active:bg-gray-100 dark:active:bg-gray-800',
                  )}
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full flex-shrink-0"
                    style={{ backgroundColor: o.color || '#3b82f6' }}
                  />
                  <span className="flex-1 min-w-0 text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {o.name}
                  </span>
                  {already && (
                    <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 shrink-0">
                      <Check className="h-4 w-4" />
                      {justAdded === o.id ? 'Added' : 'Already in'}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        )}

        {add.isError && (
          <p className="py-2 text-center text-xs text-red-600">
            Couldn't add — {(add.error as any)?.message ?? 'please try again'}
          </p>
        )}
      </div>
    </div>
  )
}
