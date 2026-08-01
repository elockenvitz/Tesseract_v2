import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, Search, TrendingUp } from 'lucide-react'
import { BottomSheet } from './BottomSheet'
import { supabase } from '../../lib/supabase'
import { createReadthrough, type ReadthroughSourceType } from '../../lib/mobile/readthrough-service'

interface ReadthroughSheetProps {
  open: boolean
  onClose: () => void
  sourceType: ReadthroughSourceType
  sourceId: string
  /** Excluded from results — a post cannot read through to its own asset. */
  excludeAssetId?: string | null
  onCreated?: () => void
}

interface AssetRow {
  id: string
  symbol: string
  company_name: string | null
}

/**
 * "This post has implications for a *different* stock."
 *
 * Two steps in one sheet: pick the other asset, optionally say why. The note
 * is the valuable part — a readthrough without a reason is hard to act on
 * later — but it is not required, because forcing it would suppress capture.
 */
export function ReadthroughSheet({
  open,
  onClose,
  sourceType,
  sourceId,
  excludeAssetId,
  onCreated,
}: ReadthroughSheetProps) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<AssetRow | null>(null)
  const [note, setNote] = useState('')
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelected(null)
      setNote('')
    }
  }, [open])

  const { data: assets = [], isFetching } = useQuery({
    queryKey: ['readthrough-asset-search', query],
    queryFn: async () => {
      const escaped = query.replace(/[%_,()]/g, '')
      let request = supabase.from('assets').select('id, symbol, company_name').limit(20)
      if (escaped) {
        request = request.or(`symbol.ilike.%${escaped}%,company_name.ilike.%${escaped}%`)
      }
      const { data, error } = await request
      if (error) throw error
      return (data ?? []) as AssetRow[]
    },
    enabled: open,
    staleTime: 30_000,
  })

  const save = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error('No asset selected')
      return createReadthrough({
        sourceType,
        sourceId,
        targetAssetId: selected.id,
        note,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['object-links'] })
      onCreated?.()
      onClose()
    },
  })

  const results = assets.filter(a => a.id !== excludeAssetId)

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      title="Mark a readthrough"
      snapPoints={[0.9]}
      dismissible={!save.isPending}
      footer={
        <button
          type="button"
          onClick={() => save.mutate()}
          disabled={!selected || save.isPending}
          className="w-full h-12 rounded-xl bg-primary-600 text-white font-semibold disabled:opacity-40"
        >
          {save.isPending
            ? 'Saving…'
            : selected
              ? `Save readthrough to ${selected.symbol}`
              : 'Pick an asset'}
        </button>
      }
    >
      <div className="px-4 pt-3 pb-2">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Which other holding does this change your view on?
        </p>
      </div>

      <div className="px-4 pb-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search symbol or company"
            className="w-full h-12 pl-9 pr-3 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100"
          />
        </div>
      </div>

      <div className="px-2">
        {isFetching && results.length === 0 && (
          <p className="px-2 py-3 text-sm text-gray-400">Searching…</p>
        )}
        {!isFetching && results.length === 0 && (
          <p className="px-2 py-3 text-sm text-gray-400">No assets found.</p>
        )}
        {results.map(asset => {
          const isSelected = selected?.id === asset.id
          return (
            <button
              key={asset.id}
              type="button"
              onClick={() => setSelected(isSelected ? null : asset)}
              className={clsx(
                'w-full flex items-center gap-3 min-h-[56px] px-3 rounded-xl text-left transition-colors',
                isSelected
                  ? 'bg-primary-50 dark:bg-primary-900/20'
                  : 'hover:bg-gray-50 dark:hover:bg-gray-800'
              )}
            >
              <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-4 w-4 text-blue-500" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {asset.symbol}
                </div>
                <div className="text-xs text-gray-500 dark:text-gray-400 truncate">
                  {asset.company_name}
                </div>
              </div>
              {isSelected && <Check className="h-5 w-5 text-primary-600 flex-shrink-0" />}
            </button>
          )
        })}
      </div>

      {selected && (
        <div className="px-4 py-3">
          <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1.5">
            Why does it read through? (optional)
          </label>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            rows={3}
            placeholder={`What this means for ${selected.symbol}…`}
            className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 p-3 text-gray-900 dark:text-gray-100"
          />
        </div>
      )}

      {save.isError && (
        <p className="px-4 pb-3 text-sm text-error-600 dark:text-error-400">
          Could not save that readthrough. Please try again.
        </p>
      )}
    </BottomSheet>
  )
}
