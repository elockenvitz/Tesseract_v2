/**
 * One idea, as a working surface you can actually write in.
 *
 * ── What this replaces ──────────────────────────────────────────────────
 *
 * A read-only paragraph and a button called "Edit in the idea pipeline".
 * Selecting an idea in the Work sidebar showed you the rationale and then
 * sent you to a 7,881-line modal somewhere else to change a sentence in it.
 * The analyst who wrote the thing had no way to amend it where they were
 * working, which made the Work tab a viewer for ideas and an editor for
 * everything else.
 *
 * ── Why this is not a second idea editor ────────────────────────────────
 *
 * Nothing here owns idea state. Every field writes through
 * `useTradeIdeaService().updateTrade` — the same audited mutation the modal
 * calls, with the same `ActionContext`, the same optimistic cache patch and
 * the same invalidation. The fields are exactly those in
 * `UpdateTradeIdeaParams`; none was invented to fill the surface, and a
 * concept this model does not hold (free-text risks, counterarguments) is
 * absent rather than faked — counterviews are their own system and stay
 * there.
 *
 * ── The three roles stay apart ──────────────────────────────────────────
 *
 * The analyst's half writes `trade_queue_items` content. `DecisionModule`
 * keeps the PM's half — accept, defer, reject, per portfolio track — and
 * owns its own authorization. Nothing in the editor touches `stage`,
 * `outcome` or execution, so editing an idea cannot accept, execute or
 * complete a trade. Proposed sizing is labelled as the analyst's proposal
 * for the same reason: it is an argument, not a PM's decision.
 *
 * Pair trades are handed off rather than half-edited: a pair keeps its
 * rationale across legs and in `pair_trades`, and writing one leg's field
 * from here would silently desynchronise them.
 */
import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { clsx } from 'clsx'
import { Check, ExternalLink, PencilLine, X } from 'lucide-react'
import { DecisionModule } from '../../ideas-v2/DecisionModule'
import { openIdeaDetail } from '../../../lib/navigation/open-idea'
import { stageLabel, stageColor } from '../../../lib/ideas/stage-model'
import { useTradeIdeaService } from '../../../hooks/useTradeIdeaService'
import { useAuth } from '../../../hooks/useAuth'
import { supabase } from '../../../lib/supabase'
import { canEditIdea, type IdeaEditSubject } from '../../../lib/asset-work/idea-edit'

const EYEBROW = 'text-[10px] font-semibold uppercase tracking-wide text-gray-400'
const FIELD =
  'w-full rounded border border-gray-200 px-2.5 py-1.5 text-[13px] leading-relaxed ' +
  'focus:outline-none focus:ring-1 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900'

export interface IdeaWorkSurfaceIdea {
  id: string
  action?: string | null
  stage?: string | null
  rationale?: string | null
  portfolioName?: string | null
  creatorName?: string | null
  updatedAgo?: string | null
}

export interface IdeaWorkSurfaceProps {
  idea: IdeaWorkSurfaceIdea
  assetId: string
  className?: string
  headerAction?: React.ReactNode
}

/** The row the editor reads. Only columns it can also write, plus identity. */
interface IdeaRow extends IdeaEditSubject {
  id: string
  action: string | null
  stage: string | null
  rationale: string | null
  thesis_text: string | null
  conviction: 'low' | 'medium' | 'high' | null
  time_horizon: 'short' | 'medium' | 'long' | null
  urgency: string | null
  proposed_weight: number | null
  proposed_shares: number | null
  target_price: number | null
  stop_loss: number | null
  take_profit: number | null
  pair_id: string | null
}

const num = (s: string): number | null => {
  const t = s.trim()
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}
const str = (n: number | null | undefined): string => (n === null || n === undefined ? '' : String(n))

function useIdeaRow(ideaId: string) {
  return useQuery({
    queryKey: ['trade-detail', ideaId],
    enabled: !!ideaId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trade_queue_items')
        .select(
          'id, action, stage, rationale, thesis_text, conviction, time_horizon, urgency, ' +
          'proposed_weight, proposed_shares, target_price, stop_loss, take_profit, ' +
          'created_by, collaborators, assigned_to, pair_id'
        )
        .eq('id', ideaId)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as unknown as IdeaRow | null
    },
  })
}

/**
 * A titled block that is read-only until asked, and says who may ask.
 *
 * Editing opens in place rather than in a dialog: the point of this surface
 * is that the analyst does not leave what they were doing to change a
 * sentence in it.
 */
function Section({
  title, canEdit, editing, onEdit, onCancel, onSave, saving, dirty, children, view, testId,
}: {
  title: string
  canEdit: boolean
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  onSave: () => void
  saving: boolean
  dirty: boolean
  children: React.ReactNode
  view: React.ReactNode
  testId: string
}) {
  return (
    <section data-testid={testId}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className={EYEBROW}>{title}</span>
        {canEdit && !editing && (
          <button
            type="button"
            data-testid={`${testId}-edit`}
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary-600 hover:underline"
          >
            <PencilLine className="h-3 w-3" aria-hidden="true" /> Edit
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          {children}
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-testid={`${testId}-save`}
              disabled={saving || !dirty}
              onClick={onSave}
              className="inline-flex items-center gap-1 rounded bg-primary-600 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              data-testid={`${testId}-cancel`}
              onClick={onCancel}
              className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
            >
              <X className="h-3 w-3" aria-hidden="true" /> Cancel
            </button>
          </div>
        </div>
      ) : (
        view
      )}
    </section>
  )
}

const Prose = ({ text }: { text: string | null | undefined }) => (
  <p className="max-w-[68ch] whitespace-pre-wrap text-[13px] leading-relaxed text-gray-800 dark:text-gray-200">
    {text?.trim() || <span className="text-gray-400">Nothing written yet.</span>}
  </p>
)

const Chips = <T extends string>({
  options, value, onChange, disabled,
}: {
  options: readonly T[]
  value: T | null
  onChange: (v: T | null) => void
  disabled?: boolean
}) => (
  <div className="flex flex-wrap gap-1.5">
    {options.map(o => (
      <button
        key={o}
        type="button"
        disabled={disabled}
        onClick={() => onChange(value === o ? null : o)}
        className={clsx(
          'rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset',
          value === o
            ? 'bg-gray-900 text-white ring-gray-900 dark:bg-gray-100 dark:text-gray-900'
            : 'text-gray-600 ring-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700',
        )}
      >
        {o.replace('_', ' ')}
      </button>
    ))}
  </div>
)

export function IdeaWorkSurface({ idea, assetId, className, headerAction }: IdeaWorkSurfaceProps) {
  const { user } = useAuth()
  const { data: row, isLoading, error } = useIdeaRow(idea.id)
  const { updateTrade, isUpdating } = useTradeIdeaService()

  const [open, setOpen] = useState<null | 'rationale' | 'thesis' | 'conviction' | 'sizing'>(null)
  const [rationale, setRationale] = useState('')
  const [thesis, setThesis] = useState('')
  const [conviction, setConviction] = useState<IdeaRow['conviction']>(null)
  const [horizon, setHorizon] = useState<IdeaRow['time_horizon']>(null)
  const [sizing, setSizing] = useState({
    proposedWeight: '', proposedShares: '', targetPrice: '', stopLoss: '', takeProfit: '',
  })

  /*
   * Close any open editor when the surface is pointed at a different idea.
   * Without this, switching ideas in the sidebar with a draft open carried
   * that draft onto the next idea and offered to save it there.
   */
  useEffect(() => { setOpen(null) }, [idea.id])

  const canEdit = canEditIdea(row, user?.id ?? null)
  const isPair = !!row?.pair_id

  const startRationale = () => { setRationale(row?.rationale ?? ''); setOpen('rationale') }
  const startThesis = () => { setThesis(row?.thesis_text ?? ''); setOpen('thesis') }
  const startConviction = () => {
    setConviction(row?.conviction ?? null); setHorizon(row?.time_horizon ?? null); setOpen('conviction')
  }
  const startSizing = () => {
    setSizing({
      proposedWeight: str(row?.proposed_weight), proposedShares: str(row?.proposed_shares),
      targetPrice: str(row?.target_price), stopLoss: str(row?.stop_loss), takeProfit: str(row?.take_profit),
    })
    setOpen('sizing')
  }

  const save = (updates: Parameters<typeof updateTrade>[0]['updates']) => {
    updateTrade({ tradeId: idea.id, updates, uiSource: 'asset_work' })
    setOpen(null)
  }

  if (isLoading) {
    return (
      <div className={clsx('space-y-3', className)} data-testid="idea-work-loading">
        <div className="h-6 w-56 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
        <div className="h-24 animate-pulse rounded bg-gray-100 dark:bg-gray-800" />
      </div>
    )
  }

  if (error || !row) {
    /* Unavailable is not the same as empty: offer the pipeline, claim nothing. */
    return (
      <div className={clsx('rounded-lg border border-gray-200 px-4 py-6 dark:border-gray-700', className)}>
        <p className="text-[13px] text-gray-600 dark:text-gray-300">
          This idea could not be read here.
        </p>
        <button
          type="button"
          data-testid="idea-open-editor"
          onClick={() => openIdeaDetail(idea.id)}
          className="mt-2 text-[12px] font-medium text-primary-600 hover:underline"
        >
          Open it in the idea pipeline
        </button>
      </div>
    )
  }

  const sizingDirty =
    num(sizing.proposedWeight) !== row.proposed_weight ||
    num(sizing.proposedShares) !== row.proposed_shares ||
    num(sizing.targetPrice) !== row.target_price ||
    num(sizing.stopLoss) !== row.stop_loss ||
    num(sizing.takeProfit) !== row.take_profit

  return (
    <div className={clsx('space-y-5', className)} data-testid="idea-work-surface">
      {/* ── Identity ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {headerAction}
        {(row.action ?? idea.action) && (
          <span className="rounded bg-gray-900 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white dark:bg-gray-100 dark:text-gray-900">
            {row.action ?? idea.action}
          </span>
        )}
        {(row.stage ?? idea.stage) && (
          <span className={clsx(
            'rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset',
            stageColor(row.stage ?? idea.stage!),
          )}>
            {stageLabel(row.stage ?? idea.stage!)}
          </span>
        )}
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {[idea.portfolioName, idea.creatorName, idea.updatedAgo].filter(Boolean).join(' · ')}
        </span>
        {!canEdit && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            Read only
          </span>
        )}
      </div>

      {isPair && (
        /* A pair's fields are shared across its legs; editing one here
           would desynchronise them silently. */
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
          This is one leg of a pair trade. Its rationale and levels are shared
          with the other leg, so they are edited together in the idea pipeline.
        </p>
      )}

      {/* ── The analyst's argument ───────────────────────────────────── */}
      <div className="space-y-5" data-testid="idea-analyst">
        <Section
          testId="idea-field-rationale"
          title="Why now"
          canEdit={canEdit && !isPair}
          editing={open === 'rationale'}
          onEdit={startRationale}
          onCancel={() => setOpen(null)}
          onSave={() => save({ rationale: rationale.trim() || null })}
          saving={isUpdating}
          dirty={(rationale.trim() || null) !== (row.rationale ?? null)}
          view={<Prose text={row.rationale} />}
        >
          <textarea
            data-testid="idea-field-rationale-input"
            value={rationale}
            onChange={e => setRationale(e.target.value)}
            rows={4}
            autoFocus
            placeholder="What has changed, and why does it matter now?"
            className={clsx(FIELD, 'max-w-[68ch] resize-y')}
          />
        </Section>

        <Section
          testId="idea-field-thesis"
          title="Investment thesis"
          canEdit={canEdit && !isPair}
          editing={open === 'thesis'}
          onEdit={startThesis}
          onCancel={() => setOpen(null)}
          onSave={() => save({ thesisText: thesis.trim() || null })}
          saving={isUpdating}
          dirty={(thesis.trim() || null) !== (row.thesis_text ?? null)}
          view={<Prose text={row.thesis_text} />}
        >
          <textarea
            data-testid="idea-field-thesis-input"
            value={thesis}
            onChange={e => setThesis(e.target.value)}
            rows={6}
            autoFocus
            placeholder="The argument: what you believe, what the market is missing, and what would prove you wrong."
            className={clsx(FIELD, 'max-w-[68ch] resize-y')}
          />
        </Section>

        <Section
          testId="idea-field-conviction"
          title="Conviction and horizon"
          canEdit={canEdit}
          editing={open === 'conviction'}
          onEdit={startConviction}
          onCancel={() => setOpen(null)}
          onSave={() => save({ conviction, timeHorizon: horizon })}
          saving={isUpdating}
          dirty={conviction !== (row.conviction ?? null) || horizon !== (row.time_horizon ?? null)}
          view={
            <p className="text-[13px] text-gray-800 dark:text-gray-200">
              {row.conviction || row.time_horizon ? (
                <>
                  <span className="capitalize">{row.conviction ?? 'unstated'}</span> conviction
                  {' · '}
                  <span className="capitalize">{row.time_horizon ?? 'unstated'}</span> horizon
                </>
              ) : (
                <span className="text-gray-400">Not stated.</span>
              )}
            </p>
          }
        >
          <div className="space-y-2">
            <div>
              <span className="mb-1 block text-[10px] text-gray-400">Conviction</span>
              <Chips options={['low', 'medium', 'high'] as const} value={conviction} onChange={setConviction} />
            </div>
            <div>
              <span className="mb-1 block text-[10px] text-gray-400">Horizon</span>
              <Chips options={['short', 'medium', 'long'] as const} value={horizon} onChange={setHorizon} />
            </div>
          </div>
        </Section>

        <Section
          testId="idea-field-sizing"
          title="Proposed sizing and levels"
          canEdit={canEdit && !isPair}
          editing={open === 'sizing'}
          onEdit={startSizing}
          onCancel={() => setOpen(null)}
          onSave={() => save({
            proposedWeight: num(sizing.proposedWeight),
            proposedShares: num(sizing.proposedShares),
            targetPrice: num(sizing.targetPrice),
            stopLoss: num(sizing.stopLoss),
            takeProfit: num(sizing.takeProfit),
          })}
          saving={isUpdating}
          dirty={sizingDirty}
          view={
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-gray-800 dark:text-gray-200">
              {([
                ['Weight', row.proposed_weight === null ? null : `${row.proposed_weight}%`],
                ['Shares', row.proposed_shares === null ? null : row.proposed_shares.toLocaleString('en-US')],
                ['Target', row.target_price === null ? null : `$${row.target_price}`],
                ['Stop', row.stop_loss === null ? null : `$${row.stop_loss}`],
                ['Take profit', row.take_profit === null ? null : `$${row.take_profit}`],
              ] as const).map(([label, v]) => (
                <span key={label}>
                  <span className="text-[10px] uppercase tracking-wide text-gray-400">{label} </span>
                  {v ?? <span className="text-gray-400">—</span>}
                </span>
              ))}
            </div>
          }
        >
          <div className="grid max-w-[520px] grid-cols-2 gap-2 sm:grid-cols-3">
            {([
              ['proposedWeight', 'Weight %'],
              ['proposedShares', 'Shares'],
              ['targetPrice', 'Target $'],
              ['stopLoss', 'Stop $'],
              ['takeProfit', 'Take profit $'],
            ] as const).map(([key, label]) => (
              <label key={key} className="block">
                <span className="mb-0.5 block text-[10px] text-gray-400">{label}</span>
                <input
                  type="number"
                  data-testid={`idea-field-sizing-${key}`}
                  value={sizing[key]}
                  onChange={e => setSizing(s => ({ ...s, [key]: e.target.value }))}
                  className={clsx(FIELD, 'text-[12px]')}
                />
              </label>
            ))}
          </div>
          {/* The distinction the brief protects, said on the surface. */}
          <p className="text-[11px] text-gray-400">
            The analyst's proposal. Accepting or sizing a trade is the decision below.
          </p>
        </Section>
      </div>

      {/* ── The PM's half, unchanged ─────────────────────────────────── */}
      <section data-testid="idea-decision" className="border-t border-gray-200 pt-4 dark:border-gray-700">
        <h4 className={clsx(EYEBROW, 'mb-1.5')}>Decision</h4>
        <DecisionModule ideaId={idea.id} assetId={assetId} />
      </section>

      {/* Everything this surface deliberately does not hold. */}
      <button
        type="button"
        data-testid="idea-open-editor"
        onClick={() => openIdeaDetail(idea.id)}
        className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 hover:text-gray-700 hover:underline dark:text-gray-400"
      >
        Discussion, counterviews and labs in the idea pipeline
        <ExternalLink className="h-3 w-3" aria-hidden="true" />
      </button>
    </div>
  )
}
