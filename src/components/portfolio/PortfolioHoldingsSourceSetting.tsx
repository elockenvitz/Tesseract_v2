import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Card } from '../ui/Card'
import type { HoldingsSource } from '../../types/organization'

interface Props {
  portfolioId: string
}

interface OptionDef {
  value: HoldingsSource
  label: string
  description: string
}

const OPTIONS: OptionDef[] = [
  {
    value: 'manual_eod',
    label: 'Manual EOD uploads',
    description:
      'No live feed. Accepted trades apply to holdings immediately so your intraday view stays honest; the next EOD upload reconciles against what was actually traded.',
  },
  {
    value: 'paper',
    label: 'Paper portfolio',
    description:
      'Hypothetical portfolio. Accepted trades auto-apply to holdings and auto-complete execution. No trader workflow.',
  },
  {
    value: 'live_feed',
    label: 'Live holdings feed',
    description:
      'External feed is the source of truth. Accepted trades wait for fills from the feed before touching holdings. Full trader workflow.',
  },
]

export function PortfolioHoldingsSourceSetting({ portfolioId }: Props) {
  const queryClient = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['portfolio-holdings-source', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolios')
        .select('holdings_source')
        .eq('id', portfolioId)
        .single()
      if (error) throw error
      return (data?.holdings_source ?? 'manual_eod') as HoldingsSource
    },
  })

  const mutation = useMutation({
    mutationFn: async (next: HoldingsSource) => {
      const { error } = await supabase
        .from('portfolios')
        .update({ holdings_source: next, updated_at: new Date().toISOString() })
        .eq('id', portfolioId)
      if (error) throw error
      return next
    },
    onSuccess: (next) => {
      queryClient.setQueryData(['portfolio-holdings-source', portfolioId], next)
      // Downstream surfaces that care about holdings_source (Lab baseline mode,
      // Trade Book execution UI) read this via the same query or refetch their
      // own portfolio rows — nudge a broad invalidate for simplicity.
      queryClient.invalidateQueries({ queryKey: ['portfolio', portfolioId] })
    },
  })

  const current = data ?? 'manual_eod'

  return (
    <Card className="p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Holdings source</h3>
        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
          Controls how accepted trades flow into portfolio holdings and how execution is tracked.
        </p>
      </div>

      <div className="space-y-2">
        {OPTIONS.map((opt) => {
          const selected = current === opt.value
          const disabled = isLoading || mutation.isPending
          return (
            <button
              key={opt.value}
              type="button"
              disabled={disabled}
              onClick={() => {
                if (opt.value !== current) mutation.mutate(opt.value)
              }}
              className={[
                'w-full text-left rounded-lg border px-3 py-2.5 transition-colors',
                selected
                  ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600',
                disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              ].join(' ')}
            >
              <div className="flex items-start gap-2">
                <div
                  className={[
                    'mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0',
                    selected
                      ? 'border-primary-600 bg-primary-600'
                      : 'border-gray-300 dark:border-gray-600',
                  ].join(' ')}
                >
                  {selected && <div className="w-1.5 h-1.5 rounded-full bg-white m-auto mt-[3px]" />}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                    {opt.label}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {opt.description}
                  </div>
                </div>
              </div>
            </button>
          )
        })}
      </div>

      {mutation.isError && (
        <p className="mt-3 text-xs text-red-600 dark:text-red-400">
          Failed to update: {(mutation.error as Error)?.message || 'unknown error'}
        </p>
      )}
    </Card>
  )
}
