import { useState, useRef, useEffect, useMemo } from 'react'
import { Plus, Search, BarChart3, Building2, Lightbulb } from 'lucide-react'
import { clsx } from 'clsx'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import type { TagRef, TagType } from '../../hooks/useAI'

interface Props {
  existingTags: TagRef[]
  onPick: (tag: TagRef) => void
}

// Compact "+" button that opens a popover where users can search across
// assets / portfolios / themes and pick one to tag the conversation with.
// Searches kick off after a short debounce; results are limited to 12 per
// kind to keep the popover scannable.
export function AITagPicker({ existingTags, onPick }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef     = useRef<HTMLInputElement>(null)

  // Debounce the query — avoid firing a new round-trip on every keystroke.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 180)
    return () => clearTimeout(h)
  }, [query])

  // Close on click outside.
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  // Focus the input when opening.
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 10)
  }, [open])

  // Set of already-picked tags so we can grey them out / disable.
  const existingKeys = useMemo(
    () => new Set(existingTags.map(t => `${t.type}:${t.id}`)),
    [existingTags],
  )

  const { data: results, isLoading } = useQuery({
    queryKey: ['ai-tag-picker', debounced],
    queryFn: async () => {
      const q = debounced
      // No query yet → show a small set of recent assets so the popover
      // isn't empty on first open. Cheap default.
      if (!q) {
        const { data: assets } = await supabase
          .from('assets').select('id, symbol, company_name')
          .order('updated_at', { ascending: false }).limit(8)
        return {
          asset:     (assets || []) as any[],
          portfolio: [] as any[],
          theme:     [] as any[],
        }
      }
      const escaped = q.replace(/%/g, '\\%').replace(/_/g, '\\_')
      const [a, p, t] = await Promise.all([
        supabase.from('assets').select('id, symbol, company_name')
          .or(`symbol.ilike.%${escaped}%,company_name.ilike.%${escaped}%`).limit(12),
        supabase.from('portfolios').select('id, name')
          .ilike('name', `%${escaped}%`).limit(12),
        supabase.from('themes').select('id, name')
          .ilike('name', `%${escaped}%`).limit(12),
      ])
      return { asset: a.data || [], portfolio: p.data || [], theme: t.data || [] }
    },
    enabled: open,
    staleTime: 30_000,
  })

  const handlePick = (tag: TagRef) => {
    if (existingKeys.has(`${tag.type}:${tag.id}`)) return
    onPick(tag)
    // Don't close — common case is adding several tags at once.
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <div className="relative inline-block" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={clsx(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border border-dashed',
          open
            ? 'border-primary-400 text-primary-700 dark:text-primary-300'
            : 'border-gray-300 text-gray-500 dark:border-gray-600 dark:text-gray-400 hover:border-primary-400 hover:text-primary-600',
        )}
        title="Tag asset / portfolio / theme"
      >
        <Plus className="w-3 h-3" />
        Tag
      </button>

      {open && (
        <div className="absolute z-50 mt-1 left-0 w-80 max-h-96 overflow-hidden flex flex-col
                        bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg">
          <div className="p-2 border-b border-gray-200 dark:border-gray-700 relative">
            <Search className="w-3.5 h-3.5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
            <input
              ref={inputRef}
              type="search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search tickers, portfolios, themes…"
              className="w-full pl-7 pr-2 py-1.5 text-sm bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-1 focus:ring-primary-400"
              onKeyDown={e => { if (e.key === 'Escape') setOpen(false) }}
            />
          </div>

          <div className="flex-1 overflow-y-auto py-1">
            {isLoading ? (
              <div className="px-3 py-3 text-xs text-gray-400 italic">Searching…</div>
            ) : (
              <>
                <PickerSection
                  label="Assets"
                  items={results?.asset || []}
                  type="asset"
                  Icon={BarChart3}
                  iconClass="text-blue-500"
                  renderItem={(a: any) => ({
                    title:    a.symbol,
                    subtitle: a.company_name,
                    id:       a.id,
                  })}
                  existingKeys={existingKeys}
                  onPick={handlePick}
                />
                <PickerSection
                  label="Portfolios"
                  items={results?.portfolio || []}
                  type="portfolio"
                  Icon={Building2}
                  iconClass="text-emerald-500"
                  renderItem={(p: any) => ({ title: p.name, id: p.id })}
                  existingKeys={existingKeys}
                  onPick={handlePick}
                />
                <PickerSection
                  label="Themes"
                  items={results?.theme || []}
                  type="theme"
                  Icon={Lightbulb}
                  iconClass="text-amber-500"
                  renderItem={(t: any) => ({ title: t.name, id: t.id })}
                  existingKeys={existingKeys}
                  onPick={handlePick}
                />
                {(!results || (results.asset.length + results.portfolio.length + results.theme.length === 0)) && (
                  <div className="px-3 py-3 text-xs text-gray-400 italic">
                    {debounced ? `No matches for "${debounced}"` : 'Type to search.'}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── A search-result group ─────────────────────────────────────────────────
function PickerSection<T>({
  label, items, type, Icon, iconClass, renderItem, existingKeys, onPick,
}: {
  label: string
  items: T[]
  type: TagType
  Icon: typeof BarChart3
  iconClass: string
  renderItem: (item: T) => { title: string; subtitle?: string; id: string }
  existingKeys: Set<string>
  onPick: (tag: TagRef) => void
}) {
  if (items.length === 0) return null
  return (
    <div className="mb-1">
      <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </div>
      <ul>
        {items.map((item, i) => {
          const r = renderItem(item)
          const already = existingKeys.has(`${type}:${r.id}`)
          return (
            <li key={`${type}-${r.id}-${i}`}>
              <button
                type="button"
                disabled={already}
                onClick={() => onPick({ type, id: r.id })}
                className={clsx(
                  'w-full flex items-start gap-2 px-3 py-1.5 text-left text-sm transition-colors',
                  already
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700',
                )}
              >
                <Icon className={clsx('w-3.5 h-3.5 mt-0.5 shrink-0', iconClass)} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.title}</div>
                  {r.subtitle && (
                    <div className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{r.subtitle}</div>
                  )}
                </div>
                {already && (
                  <span className="text-[10px] text-gray-400 mt-0.5 shrink-0">added</span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
