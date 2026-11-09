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
 * The stage track is the exception that proves the rule: moving an idea
 * forward is its own explicitly-labelled control, never a side effect of
 * saving a field. A field save writes content; a stage chip writes stage. The
 * one place they meet is a move the gate refused — it parks, opens the field
 * it is waiting on, and the save button says "Save & move to …" so the reader
 * is told the save will also move the idea before they press it.
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
import {
  IDEA_STAGES, IDEA_STAGE_CONFIG, missingForStage, stageIndex, toIdeaStage,
  type IdeaStage,
} from '../../../lib/ideas/stage-model'
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
  sharing_visibility: string | null
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
          'sharing_visibility, ' +
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
  saveLabel = 'Save',
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
  /** Says what the save will do when it also completes a parked stage move. */
  saveLabel?: string
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
              {saving ? 'Saving…' : saveLabel}
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
  const { updateTrade, updateTradeAsync, isUpdating, moveTrade, isMoving } = useTradeIdeaService()

  const [open, setOpen] = useState<null | 'rationale' | 'thesis' | 'conviction' | 'sizing'>(null)
  /** A move the gate refused, parked until the field it needs is written. */
  const [blocked, setBlocked] = useState<{ stage: IdeaStage; missing: string[] } | null>(null)
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
  useEffect(() => { setOpen(null); setBlocked(null) }, [idea.id])

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

  /*
   * ── Moving the idea forward ───────────────────────────────────────────
   *
   * The stage was a coloured label here and nothing more: advancing an idea
   * meant leaving for the modal. These chips move it, through the same
   * `moveTrade` mutation, and they answer the gate before sending a write
   * that `trade-idea-service.ts` would refuse.
   *
   * That service-side gate is still the rule. This is the reason the analyst
   * is not told "no" and left there: a refused move parks, opens the field it
   * is waiting on, and completes itself when that field is written. The
   * pattern is the modal's `requestStageMove` / `saveGatedField`, reused
   * rather than reinvented, so both surfaces behave the same way.
   */
  const currentStage: IdeaStage | null =
    row?.stage || idea.stage ? toIdeaStage(row?.stage ?? idea.stage) : null

  const gateSubject = { rationale: row?.rationale, thesis_text: row?.thesis_text }

  const requestStageMove = (stage: IdeaStage) => {
    const missing = missingForStage(gateSubject, stage)
    if (missing.length === 0) {
      setBlocked(null)
      moveTrade({ tradeId: idea.id, stage, uiSource: 'asset_work' })
      return
    }
    setBlocked({ stage, missing })
    /* Send them to the field, in document order — "Why now" sits above the
       thesis, and opening the lower one first makes the upper look optional. */
    if (missing.includes('Why now (rationale)')) startRationale()
    else startThesis()
  }

  /**
   * Save a field a parked move is waiting on, then finish the move if it was
   * the last thing outstanding.
   *
   * The gate is re-asked against the saved text rather than assumed
   * satisfied: a field saved blank still blocks, and the banner should say so
   * instead of the move failing a second time.
   */
  const saveGated = async (field: 'rationale' | 'thesis', value: string) => {
    const text = value.trim()
    await updateTradeAsync({
      tradeId: idea.id,
      updates: field === 'rationale' ? { rationale: text || null } : { thesisText: text || null },
      uiSource: 'asset_work',
    })
    setOpen(null)
    if (!blocked) return

    const stillMissing = missingForStage(
      {
        rationale: field === 'rationale' ? text : row?.rationale,
        thesis_text: field === 'thesis' ? text : row?.thesis_text,
      },
      blocked.stage,
    )
    if (stillMissing.length > 0) {
      setBlocked({ stage: blocked.stage, missing: stillMissing })
      if (stillMissing.includes('Why now (rationale)')) startRationale()
      else startThesis()
      return
    }
    const stage = blocked.stage
    setBlocked(null)
    moveTrade({ tradeId: idea.id, stage, uiSource: 'asset_work' })
  }

  /** The move completes on this save only when nothing else is outstanding. */
  const isLastBlocker = (field: 'rationale' | 'thesis') =>
    !!blocked &&
    blocked.missing.length === 1 &&
    blocked.missing[0] === (field === 'rationale' ? 'Why now (rationale)' : 'Trade thesis')

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

  /* A row with no visibility set is private — the column's own default. */
  const visibility = row.sharing_visibility ?? 'private'

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
        {/* The stage is not repeated here — the track below states it. */}
        <span className="text-[11px] text-gray-500 dark:text-gray-400">
          {[idea.portfolioName, idea.creatorName, idea.updatedAgo].filter(Boolean).join(' · ')}
        </span>
        {!canEdit && (
          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            Read only
          </span>
        )}
      </div>

      {/* The stage, as a track you move the idea along rather than a label. */}
      {currentStage && (
        <section data-testid="idea-pipeline">
          <div className="flex flex-wrap items-center gap-1">
            {IDEA_STAGES.map((s, i) => {
              const here = s === currentStage
              const passed = i < stageIndex(currentStage)
              const needs = missingForStage(gateSubject, s)
              return (
                <button
                  key={s}
                  type="button"
                  data-testid={`idea-stage-${s}`}
                  aria-current={here ? 'step' : undefined}
                  disabled={!canEdit || here || isPair || isMoving}
                  onClick={() => requestStageMove(s)}
                  title={
                    here ? 'Current stage'
                      : isPair ? 'Pair trades move together, in the idea pipeline'
                        : needs.length ? `Needs ${needs.join(' and ').toLowerCase()}`
                          : `Move to ${IDEA_STAGE_CONFIG[s].label}`
                  }
                  className={clsx(
                    'rounded-full px-2.5 py-1 text-[11px] font-medium ring-1 ring-inset transition-colors',
                    here
                      ? 'bg-gray-900 text-white ring-gray-900 dark:bg-gray-100 dark:text-gray-900'
                      : passed
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:ring-emerald-900'
                        : needs.length
                          ? 'text-gray-400 ring-dashed ring-gray-300 dark:text-gray-500 dark:ring-gray-700'
                          : 'text-gray-600 ring-gray-200 dark:text-gray-300 dark:ring-gray-700',
                    canEdit && !here && !isPair && !isMoving && 'hover:bg-gray-50 dark:hover:bg-gray-800',
                    (!canEdit || here || isPair) && 'cursor-default',
                  )}
                >
                  {IDEA_STAGE_CONFIG[s].label}
                </button>
              )
            })}
          </div>

          {/* A parked move, with the thing it is waiting on named. */}
          {blocked && (
            <p
              data-testid="idea-stage-blocked"
              className="mt-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {IDEA_STAGE_CONFIG[blocked.stage].label} needs{' '}
              {blocked.missing.join(' and ').toLowerCase()}. Write it below and the
              move completes on save.{' '}
              <button
                type="button"
                data-testid="idea-stage-blocked-cancel"
                onClick={() => { setBlocked(null); setOpen(null) }}
                className="font-medium underline"
              >
                Cancel the move
              </button>
            </p>
          )}
        </section>
      )}

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
          onSave={() => { void saveGated('rationale', rationale) }}
          saveLabel={isLastBlocker('rationale')
            ? `Save & move to ${IDEA_STAGE_CONFIG[blocked!.stage].label}`
            : 'Save'}
          saving={isUpdating || isMoving}
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
          onSave={() => { void saveGated('thesis', thesis) }}
          saveLabel={isLastBlocker('thesis')
            ? `Save & move to ${IDEA_STAGE_CONFIG[blocked!.stage].label}`
            : 'Save'}
          saving={isUpdating || isMoving}
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

        {/*
          ── Priority and visibility ────────────────────────────────────
          Two fields the modal had and this surface did not, so an analyst
          had to leave to mark an idea urgent or share it with the desk.

          No edit/save ceremony: each is one enum and a click is the whole
          decision, so these write straight through `updateTrade`. Priority
          is `urgency` — one column, called "priority" in the modal's
          dropdown, not a second field.
        */}
        <section data-testid="idea-handling">
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <div>
              <span className={clsx(EYEBROW, 'mb-1 block')}>Priority</span>
              <div className="flex gap-1.5">
                {(['low', 'medium', 'high'] as const).map(level => (
                  <button
                    key={level}
                    type="button"
                    data-testid={`idea-urgency-${level}`}
                    disabled={!canEdit || isUpdating}
                    onClick={() => save({ urgency: level })}
                    className={clsx(
                      'rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset',
                      row.urgency === level
                        ? 'bg-gray-900 text-white ring-gray-900 dark:bg-gray-100 dark:text-gray-900'
                        : 'text-gray-600 ring-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700',
                      !canEdit && 'cursor-default',
                    )}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <span className={clsx(EYEBROW, 'mb-1 block')}>Visible to</span>
              <div className="flex items-center gap-1.5">
                {/*
                  `sharing_visibility` holds four values in production
                  (`public` and `portfolio` as well), but only two are
                  offered — the same two the modal offers. An idea already
                  set to one of the others would otherwise render with
                  nothing selected, which reads as "private" and is wrong,
                  so the stored value is stated instead of implied.
                */}
                {visibility !== 'private' && visibility !== 'team' && (
                  <span
                    data-testid="idea-visibility-other"
                    title="Set outside this surface; change it in the idea pipeline"
                    className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium capitalize text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                  >
                    {visibility}
                  </span>
                )}
                {([['private', 'Just me'], ['team', 'The team']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    data-testid={`idea-visibility-${v}`}
                    disabled={!canEdit || isUpdating}
                    onClick={() => save({ sharingVisibility: v })}
                    className={clsx(
                      'rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                      visibility === v
                        ? 'bg-gray-900 text-white ring-gray-900 dark:bg-gray-100 dark:text-gray-900'
                        : 'text-gray-600 ring-gray-200 hover:bg-gray-50 dark:text-gray-300 dark:ring-gray-700',
                      !canEdit && 'cursor-default',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

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
