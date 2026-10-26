/**
 * Arranging the Research page by moving the Research page.
 *
 * ── Why there is no canvas here any more ────────────────────────────────
 *
 * This started as a dialog listing every field with a "Full"/"Half"
 * button. It became a grid of named blocks, drawn to look like the page.
 * Both had the same defect, and the second one hid it better: what you
 * dragged was not what you were arranging. A block reading "Investment
 * Thesis" tells you where the thesis sits but not that it is four
 * paragraphs and the rating beside it is one line, which is the entire
 * question you are trying to answer.
 *
 * So nothing here draws a field. `AssetTab` renders the real page exactly
 * as it always does, and these components wrap what it rendered: the
 * content goes inert, drag and resize chrome goes on top, and the widths
 * come from the draft instead of the database. What you drag IS the page,
 * so there is no second renderer that can disagree with it — which is a
 * class of bug, not a nicety. The grid, the spans and the fields are one
 * implementation.
 *
 * ── Why the content is inert ────────────────────────────────────────────
 *
 * The fields are live editors. A press that lands in a rich-text body
 * while you meant to move the field would put a caret in your thesis, and
 * a drag from there would select text rather than move anything. So while
 * arranging, everything inside a field stops taking pointer events and the
 * chrome above it takes them instead. You arrange, you press Done, you
 * edit. Not both at once.
 *
 * ── Order without rebuilding the page ───────────────────────────────────
 *
 * Reordering is applied as CSS `order` on the grid items rather than by
 * reordering the elements. `AssetTab` builds those children inline, and
 * rebuilding them per drag would remount a live editor mid-gesture. CSS
 * grid honours `order`, and dnd-kit measures real rects, so dropping lands
 * where it looks like it lands.
 *
 * ── Why the save merges rather than replaces ────────────────────────────
 *
 * `save_asset_layout_customization` is a replace-all RPC: it writes the
 * `field_overrides` array it is handed and DROPS whatever it is not. So
 * the draft starts from the overrides that already exist, and section
 * overrides are handed back exactly as they came.
 */
import {
  createContext, useCallback, useContext, useMemo, useState,
  type ReactNode,
} from 'react'
import { clsx } from 'clsx'
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable'
import { GripVertical, RotateCcw } from 'lucide-react'
import {
  useUserAssetPagePreferences,
  useUserAssetPageLayouts,
  type FieldOverride,
} from '../../hooks/useUserAssetPagePreferences'
import {
  SELF_ARRANGED_SECTIONS,
  SPAN_CLASS,
  snapFraction,
  spanLabel,
  stepSpan,
} from '../../lib/research/field-span'
import { FULL_SPAN, type FieldSpan } from '../../lib/research/layout-resolver'

interface ArrangeState {
  active: boolean
  /** The span to draw a field at: the draft's, else the saved one. */
  spanOf: (fieldId: string, saved: FieldSpan) => FieldSpan
  /** Field ids in draft order for a section, or null if never dragged. */
  orderOf: (sectionId: string) => string[] | null
  setSpan: (fieldId: string, span: FieldSpan) => void
  reorder: (sectionId: string, ids: string[]) => void
}

const ArrangeContext = createContext<ArrangeState | null>(null)

/** Null outside arrange mode, so a wrapper can render plainly. */
function useArrange(): ArrangeState | null {
  return useContext(ArrangeContext)
}

export interface ResearchArrangeProviderProps {
  assetId: string
  active: boolean
  children: ReactNode
}

/** Draft state, shared by the bar and every wrapped field. */
export function ResearchArrangeProvider({
  assetId, active, children,
}: ResearchArrangeProviderProps) {
  const [spans, setSpans] = useState<Map<string, FieldSpan>>(new Map())
  const [order, setOrder] = useState<Map<string, string[]>>(new Map())

  const setSpan = useCallback((fieldId: string, span: FieldSpan) => {
    setSpans(prev => new Map(prev).set(fieldId, span))
  }, [])

  const reorder = useCallback((sectionId: string, ids: string[]) => {
    setOrder(prev => new Map(prev).set(sectionId, ids))
  }, [])

  const clear = useCallback(() => { setSpans(new Map()); setOrder(new Map()) }, [])

  const value = useMemo<ArrangeState>(() => ({
    active,
    spanOf: (fieldId, saved) => spans.get(fieldId) ?? saved,
    orderOf: sectionId => order.get(sectionId) ?? null,
    setSpan,
    reorder,
  }), [active, spans, order, setSpan, reorder])

  const draft = useMemo<ArrangeDraft>(
    () => ({ assetId, spans, order, clear }),
    [assetId, spans, order, clear],
  )

  return (
    <ArrangeContext.Provider value={active ? value : null}>
      <ArrangeDraftContext.Provider value={draft}>
        {children}
      </ArrangeDraftContext.Provider>
    </ArrangeContext.Provider>
  )
}

/**
 * The draft itself, for the bar that saves it.
 *
 * Separate from `ArrangeContext` because that one is nulled out when
 * arrange mode is off — the bar needs the draft to exist while it is
 * saving and closing, which happens in the same tick as `active` going
 * false.
 */
interface ArrangeDraft {
  assetId: string
  spans: Map<string, FieldSpan>
  order: Map<string, string[]>
  clear: () => void
}
const ArrangeDraftContext = createContext<ArrangeDraft | null>(null)

/** Where an arrangement is written. */
export type SaveTarget = 'asset' | 'template'

export interface ResearchArrangeBarProps {
  assetName?: string | null
  onClose: () => void
}

/**
 * The bar: what is being edited, where it will be saved, and the way out.
 *
 * It is sticky rather than fixed, so it belongs to the page it is editing
 * rather than floating over it.
 */
export function ResearchArrangeBar({ assetName, onClose }: ResearchArrangeBarProps) {
  const draft = useContext(ArrangeDraftContext)
  const {
    displayedFieldsBySection,
    assetFieldOverrides,
    assetSectionOverrides,
    activeLayout,
    saveCustomization,
  } = useUserAssetPagePreferences(draft?.assetId)
  /* Templates are a different hook: this one is scoped to one asset, and
     writing a template is not. */
  const { updateLayout } = useUserAssetPageLayouts()

  const [target, setTarget] = useState<SaveTarget>('asset')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const changed = (draft?.spans.size ?? 0) + (draft?.order.size ?? 0)
  const dirty = changed > 0

  /** A template must exist to write to; the system default is not one. */
  const templateWritable = !!activeLayout?.id && activeLayout.id !== 'system-default'

  const reset = () => { draft?.clear(); setError(null) }

  const allFields = useMemo(
    () => (displayedFieldsBySection ?? []).flatMap(s => s.fields),
    [displayedFieldsBySection],
  )

  /**
   * This stock: per-asset overrides, merged onto what is already saved.
   *
   * The RPC replaces the array it is handed, so starting from the existing
   * overrides is what keeps every visibility, section and order override
   * the field customizer wrote.
   */
  const saveToAsset = async () => {
    const byId = new Map<string, FieldOverride>()
    for (const o of assetFieldOverrides) byId.set(o.field_id, { ...o })

    const touch = (fieldId: string): FieldOverride => {
      const existing = byId.get(fieldId)
      const next: FieldOverride = existing
        ? { ...existing }
        /* A field with no override yet needs one created carrying its
           CURRENT visibility — defaulting it would hide or reveal the
           field as a side effect of making it narrower. */
        : {
            field_id: fieldId,
            is_visible: allFields.find(f => f.field_id === fieldId)?.is_visible ?? true,
          }
      byId.set(fieldId, next)
      return next
    }

    draft?.spans.forEach((span, fieldId) => { touch(fieldId).span = span })
    /* Every field in a reordered section is renumbered, not just the one
       that moved: `display_order` is an absolute position, so leaving the
       neighbours alone puts two fields on the same number. */
    draft?.order.forEach(ids => {
      ids.forEach((fieldId, index) => { touch(fieldId).display_order = index })
    })

    await saveCustomization.mutateAsync({
      layoutId: activeLayout?.id ?? null,
      fieldOverrides: Array.from(byId.values()),
      /* Not this bar's to change, and `[]` would DELETE every renamed,
         hidden or reordered section. */
      sectionOverrides: assetSectionOverrides,
      newSections: [],
    })
  }

  /**
   * All stocks: the active template's own field_config.
   *
   * Written from the page as it currently reads — every visible field,
   * with the draft applied — rather than by patching the stored config.
   * The stored config can be missing fields the page is showing from
   * defaults, and patching it would silently drop them.
   */
  const saveToTemplate = async () => {
    if (!activeLayout?.id) throw new Error('No template to save to.')
    const fieldConfig = (displayedFieldsBySection ?? []).flatMap((section, sIdx) => {
      const ids = draft?.order.get(section.section_id) ?? null
      const fields = ids
        ? [
            ...ids.map(id => section.fields.find(f => f.field_id === id)).filter(Boolean),
            ...section.fields.filter(f => !ids.includes(f.field_id)),
          ] as typeof section.fields
        : section.fields
      return fields.map((f, fIdx) => ({
        field_id: f.field_id,
        section_id: f.section_id || section.section_id,
        is_visible: f.is_visible,
        display_order: sIdx * 1000 + fIdx,
        is_collapsed: f.is_collapsed ?? false,
        span: draft?.spans.get(f.field_id) ?? f.span ?? FULL_SPAN,
      }))
    })
    await updateLayout.mutateAsync({ layoutId: activeLayout.id, fieldConfig })
  }

  const save = async () => {
    if (!dirty) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      if (target === 'template') await saveToTemplate()
      else await saveToAsset()
      draft?.clear()
      onClose()
    } catch (e) {
      /* The RPC raises CONFLICT when the layout changed in another tab.
         Closing on that would look like success, and `onClose` is inside
         the try precisely so a throw skips it: the reader keeps their
         unsaved arrangement with the error in front of them. */
      setError(e instanceof Error ? e.message : 'Could not save the layout.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      data-testid="research-arrange-bar"
      className="sticky top-0 z-30 mb-3 rounded-xl border border-primary-200 bg-primary-50/95 px-4 py-2.5 shadow-sm backdrop-blur dark:border-primary-800 dark:bg-primary-950/90"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-primary-900 dark:text-primary-100">
            Arranging {assetName ? `${assetName}'s ` : ''}Research page
          </p>
          <p className="mt-0.5 text-[11px] text-primary-700/90 dark:text-primary-300/90">
            Drag a field to move it. Drag its right edge, or use ← and →, to
            change how wide it is. Fields are not editable while arranging.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            Where it lands, chosen before pressing Save and visible while
            dragging. "All stocks" writes the active template, so it is
            offered only when there is one — on the system default there is
            nothing to write to, and a disabled control that explains
            itself beats one that fails on press.
          */}
          <span
            role="radiogroup"
            aria-label="Save this arrangement to"
            data-testid="arrange-target"
            className="inline-flex overflow-hidden rounded-md border border-primary-300 dark:border-primary-700"
          >
            {([
              { key: 'asset' as const, label: 'This stock', hint: `Applies to ${assetName ?? 'this stock'} only.` },
              {
                key: 'template' as const,
                label: 'All stocks',
                hint: templateWritable
                  ? `Changes the "${activeLayout?.name}" template, so every stock using it moves too.`
                  : 'Save a template first — there is no template to change yet.',
              },
            ]).map(o => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={target === o.key}
                disabled={o.key === 'template' && !templateWritable}
                title={o.hint}
                data-testid={`arrange-target-${o.key}`}
                onClick={() => setTarget(o.key)}
                className={clsx(
                  'px-2.5 py-1.5 text-[11px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  target === o.key
                    ? 'bg-primary-600 text-white'
                    : 'bg-white text-primary-800 hover:bg-primary-100 dark:bg-gray-900 dark:text-primary-200',
                )}
              >
                {o.label}
              </button>
            ))}
          </span>

          <span
            data-testid="arrange-dirty"
            className="text-[11px] text-primary-700/80 dark:text-primary-300/80"
          >
            {dirty ? `${changed} change${changed === 1 ? '' : 's'}, not saved` : 'No changes'}
          </span>

          <button
            type="button"
            onClick={reset}
            disabled={!dirty || saving}
            data-testid="arrange-reset"
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-[12px] font-medium text-primary-800 hover:bg-primary-100 disabled:opacity-40 dark:text-primary-200 dark:hover:bg-primary-900"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
          <button
            type="button"
            onClick={() => { draft?.clear(); onClose() }}
            data-testid="arrange-cancel"
            className="rounded-md px-2.5 py-1.5 text-[12px] font-medium text-gray-600 hover:bg-white/70 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            data-testid="arrange-save"
            className="rounded-md bg-primary-600 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? 'Saving…' : dirty ? 'Save layout' : 'Done'}
          </button>
        </div>
      </div>

      {error && (
        <p
          data-testid="arrange-error"
          className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          {error}
        </p>
      )}
    </div>
  )
}

export interface ArrangeableFieldGridProps {
  sectionId: string
  sectionSlug: string
  /** Visible field ids, in the order the page is rendering them. */
  fieldIds: string[]
  className: string
  children: ReactNode
}

/**
 * The section's grid — the same element outside arrange mode, wrapped in a
 * drag context inside it.
 *
 * The grid itself is unchanged in both cases. Rendering a different
 * container while arranging would change the very measurements the reader
 * is arranging against.
 */
export function ArrangeableFieldGrid({
  sectionId, sectionSlug, fieldIds, className, children,
}: ArrangeableFieldGridProps) {
  const arrange = useArrange()
  const sensors = useSensors(
    /* A field is large and holds a resize grip, so a press has to travel
       before it counts as a drag — otherwise grabbing the grip, or a click
       meant for the chrome, starts moving the field. */
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const arrangeable = arrange?.active && !SELF_ARRANGED_SECTIONS.has(sectionSlug)
  const ordered = arrange?.orderOf(sectionId) ?? fieldIds

  if (!arrangeable) return <div className={className}>{children}</div>

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const from = ordered.indexOf(String(active.id))
    const to = ordered.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    arrange!.reorder(sectionId, arrayMove(ordered, from, to))
  }

  return (
    <div className={className} data-arrange-section={sectionId}>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ordered} strategy={rectSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    </div>
  )
}

export interface ArrangeableFieldProps {
  fieldId: string
  fieldName: string
  sectionId: string
  sectionSlug: string
  /** The span the layout says, before the draft. */
  savedSpan: FieldSpan
  /** The field as the page renders it. Never redrawn here. */
  children: ReactNode
}

/**
 * One real field, wrapped.
 *
 * Outside arrange mode this is the plain grid cell the page always had.
 * Inside it, the same cell gains a width from the draft, an order, inert
 * content and chrome on top.
 */
export function ArrangeableField({
  fieldId, fieldName, sectionId, sectionSlug, savedSpan, children,
}: ArrangeableFieldProps) {
  const arrange = useArrange()
  const span = arrange?.spanOf(fieldId, savedSpan) ?? savedSpan
  const arrangeable = arrange?.active && !SELF_ARRANGED_SECTIONS.has(sectionSlug)

  if (!arrangeable) {
    return (
      <div data-field-span={span} className={`min-w-0 ${SPAN_CLASS[span]}`}>
        {children}
      </div>
    )
  }

  return (
    <ArrangeableFieldActive
      fieldId={fieldId}
      fieldName={fieldName}
      sectionId={sectionId}
      span={span}
      arrange={arrange!}
    >
      {children}
    </ArrangeableFieldActive>
  )
}

/**
 * Split out because it calls hooks that must not run on the normal page.
 *
 * `useSortable` registers the element with a `DndContext`. On the page
 * there is none, and calling it conditionally inside one component would
 * change the hook order the moment arrange mode turned on.
 */
function ArrangeableFieldActive({
  fieldId, fieldName, sectionId, span, arrange, children,
}: {
  fieldId: string
  fieldName: string
  sectionId: string
  span: FieldSpan
  arrange: ArrangeState
  children: ReactNode
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: fieldId })
  const [host, setHost] = useState<HTMLDivElement | null>(null)
  const [resizing, setResizing] = useState(false)

  const order = arrange.orderOf(sectionId)?.indexOf(fieldId) ?? undefined

  /*
   * Resizing is measured against the ROW, not the field. A span is a
   * fraction of the row; dividing by the field's own width makes every
   * drag relative to the width it already had, so it creeps toward
   * whatever it was instead of landing under the pointer.
   */
  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const row = host?.parentElement
    if (!row || !host) return
    setResizing(true)
    const apply = (clientX: number) => {
      const rowBox = row.getBoundingClientRect()
      const left = host.getBoundingClientRect().left
      if (rowBox.width <= 0) return
      arrange.setSpan(fieldId, snapFraction((clientX - left) / rowBox.width))
    }
    /* Listened for on the window: the pointer leaves the 12px grip
       immediately, and a listener on the grip loses the drag at once. */
    const onMove = (ev: PointerEvent) => { ev.preventDefault(); apply(ev.clientX) }
    const stop = () => {
      setResizing(false)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
  }

  /*
   * Left and right resize — but only while the field is sitting still.
   *
   * Once dnd-kit's keyboard sensor has picked the field up, those same two
   * keys are how it is moved, and in a grid left/right is the direction
   * that matters. Stealing them unconditionally made a picked-up field
   * movable only vertically while it silently resized instead.
   */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (isDragging) return
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    arrange.setSpan(fieldId, stepSpan(span, e.key === 'ArrowRight' ? 1 : -1))
  }

  return (
    <div
      ref={node => { setNodeRef(node); setHost(node) }}
      data-field-span={span}
      data-arranging="true"
      style={{
        order,
        transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined,
        transition,
      }}
      className={clsx(
        'group relative min-w-0 rounded-xl',
        SPAN_CLASS[span],
        isDragging ? 'z-20 opacity-90 shadow-xl ring-2 ring-primary-400' : 'ring-1 ring-primary-200/70 dark:ring-primary-800',
      )}
    >
      {/*
        The real field, rendered by the page, made inert. `select-none`
        matters as much as the pointer events: without it a drag that
        starts over prose highlights the prose instead of moving anything.
      */}
      <div className="pointer-events-none select-none" aria-hidden="true">
        {children}
      </div>

      {/*
        Chrome on top. A translucent sheet over the whole field, so a press
        anywhere on it is a press on the field and not on the editor it is
        covering — which is what makes the field draggable by its body, the
        way an icon is, rather than by a 16px handle.
      */}
      <div
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        role="button"
        tabIndex={0}
        data-testid={`arrange-grab-${fieldId}`}
        aria-label={`${fieldName} — ${spanLabel(span)}. Space to pick up and move, left and right arrows to resize.`}
        className="absolute inset-0 cursor-grab rounded-xl bg-primary-500/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:cursor-grabbing dark:bg-primary-400/5"
      >
        <span className="pointer-events-none absolute left-2 top-2 inline-flex items-center gap-1 rounded-md bg-white/95 px-1.5 py-0.5 shadow-sm dark:bg-gray-900/95">
          <GripVertical className="h-3.5 w-3.5 text-gray-400" aria-hidden="true" />
          <span className="max-w-[14rem] truncate text-[11px] font-medium text-gray-700 dark:text-gray-200">
            {fieldName}
          </span>
          <span
            data-testid={`arrange-span-label-${fieldId}`}
            className="text-[10px] uppercase tracking-wide text-gray-400"
          >
            {spanLabel(span)}
          </span>
        </span>
      </div>

      {/*
        The resize grip, above the sheet. `touch-none` matters: without it
        a drag on a touchscreen scrolls the page instead, and the handle
        does nothing at all on the device where it is hardest to hit.
      */}
      <span
        role="presentation"
        data-testid={`arrange-resize-${fieldId}`}
        onPointerDown={startResize}
        className={clsx(
          'absolute inset-y-2 right-0 z-10 w-3 cursor-col-resize touch-none rounded-r-xl',
          resizing ? 'bg-primary-500/70' : 'bg-primary-400/20 group-hover:bg-primary-400/60',
        )}
      />
    </div>
  )
}
