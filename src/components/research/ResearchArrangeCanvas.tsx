/**
 * Arranging the Research page by moving the page.
 *
 * ── Why this replaced a modal ───────────────────────────────────────────
 *
 * The first version of this was a dialog listing every field with a button
 * reading "Full" or "Half". Two things were wrong with it, and they were
 * the same thing twice: the layout was described rather than shown, and it
 * had two choices. You opened a box on top of the page, read a word, and
 * closed the box to find out what you had done.
 *
 * So this is not a dialog. It renders in the page, in the place the fields
 * were, at the width the fields have — the Research body turns into its own
 * tiles, you drag them around, and you press Done. The grid is the real
 * grid, the spans are the real spans, so there is nothing to translate.
 *
 * ── The twelve-column model ─────────────────────────────────────────────
 *
 * A field's width is a `span` in twelfths of a row. Dragging a tile's right
 * edge snaps through SNAP_SPANS — quarter, third, half, two thirds, three
 * quarters, full — which are the spans that have a complement, so a row can
 * always be completed. Arrow keys do the same without a mouse.
 *
 * ── What it does NOT do ─────────────────────────────────────────────────
 *
 * Add, remove, rename, hide or re-section a field, or move one to a
 * different section. Those belong to the field customizer, and duplicating
 * any of them would make two screens that disagree about what the layout
 * is. Here a field changes width and changes place within its section.
 *
 * ── Why the save merges rather than replaces ────────────────────────────
 *
 * `save_asset_layout_customization` is a replace-all RPC: it writes the
 * `field_overrides` array it is handed and DROPS whatever it is not. An
 * editor sending only the fields it touched would delete every visibility,
 * section and order override the customizer had saved. So the draft starts
 * from the overrides that already exist and writes span and order onto
 * them, and section overrides are handed back exactly as they came.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Info, RotateCcw } from 'lucide-react'
import {
  useUserAssetPagePreferences,
  type FieldOverride,
} from '../../hooks/useUserAssetPagePreferences'
import {
  SPAN_CLASS_FLAT,
  snapFraction,
  spanLabel,
  stepSpan,
} from '../../lib/research/field-span'
import { FULL_SPAN, type FieldSpan } from '../../lib/research/layout-resolver'

export interface ResearchArrangeCanvasProps {
  assetId: string
  assetName?: string | null
  /** Leave arrange mode. Called after a successful save, and on cancel. */
  onClose: () => void
}

/**
 * Sections the Research page lays out itself, ignoring per-field span.
 *
 * `AssetTab` renders most sections into the twelve-column grid and reads
 * each field's span. These two take their own branch: `forecasts` draws its
 * fields as fixed tiles, and `supporting_docs` is lifted out to the Key
 * References tab entirely. Arranging a field in either would save a value
 * nothing reads.
 *
 * They are shown rather than hidden — a reader looking for Price Targets
 * should find it and be told why it cannot move, instead of concluding this
 * screen has lost it — and their tiles are inert so the control cannot lie.
 */
const SELF_ARRANGED_SECTIONS = new Set(['forecasts', 'supporting_docs'])

/** A field as this canvas needs it: identity, a name, and a width. */
interface Tile {
  fieldId: string
  name: string
  span: FieldSpan
}

interface SectionTiles {
  sectionId: string
  sectionName: string
  /** False when the page arranges this section's fields for itself. */
  arrangeable: boolean
  tiles: Tile[]
}

/** The unsaved shape: a span and a position per field the reader moved. */
interface Draft {
  spans: Map<string, FieldSpan>
  /** Field ids in reader-chosen order, by section. Absent until dragged. */
  order: Map<string, string[]>
}

const EMPTY_DRAFT: Draft = { spans: new Map(), order: new Map() }

export function ResearchArrangeCanvas({
  assetId, assetName, onClose,
}: ResearchArrangeCanvasProps) {
  const {
    displayedFieldsBySection,
    assetFieldOverrides,
    assetSectionOverrides,
    activeLayout,
    isLoading,
    saveCustomization,
  } = useUserAssetPagePreferences(assetId)

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const sections: SectionTiles[] = useMemo(() => {
    return (displayedFieldsBySection ?? []).map(s => {
      const visible = s.fields.filter(f => f.is_visible)
      const tiles: Tile[] = visible.map(f => ({
        fieldId: f.field_id,
        name: f.field_name,
        /* Hidden fields are left out because they are not on the page.
           Their span is left untouched rather than reset — a field made
           visible again should come back the width it was. */
        span: draft.spans.get(f.field_id) ?? f.span ?? FULL_SPAN,
      }))

      /* A dragged section is drawn in the reader's order. Fields the drag
         never saw (added in another tab while arranging) keep their place
         at the end rather than vanishing. */
      const dragged = draft.order.get(s.section_id)
      const ordered = dragged
        ? [
            ...dragged
              .map(id => tiles.find(t => t.fieldId === id))
              .filter((t): t is Tile => !!t),
            ...tiles.filter(t => !dragged.includes(t.fieldId)),
          ]
        : tiles

      return {
        sectionId: s.section_id,
        sectionName: s.section_name,
        arrangeable: !SELF_ARRANGED_SECTIONS.has(s.section_slug),
        tiles: ordered,
      }
    }).filter(s => s.tiles.length > 0)
  }, [displayedFieldsBySection, draft])

  const dirty = draft.spans.size > 0 || draft.order.size > 0

  const setSpan = useCallback((fieldId: string, span: FieldSpan) => {
    setDraft(prev => {
      const spans = new Map(prev.spans)
      spans.set(fieldId, span)
      return { spans, order: prev.order }
    })
  }, [])

  const sensors = useSensors(
    /*
     * A tile is a drag handle AND it holds a resize grip, so a press has to
     * travel before it counts as a drag — otherwise grabbing the grip or
     * tapping to focus starts moving the field instead.
     */
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (sectionId: string) => (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const section = sections.find(s => s.sectionId === sectionId)
    if (!section) return
    const ids = section.tiles.map(t => t.fieldId)
    const from = ids.indexOf(String(active.id))
    const to = ids.indexOf(String(over.id))
    if (from < 0 || to < 0) return
    setDraft(prev => {
      const order = new Map(prev.order)
      order.set(sectionId, arrayMove(ids, from, to))
      return { spans: prev.spans, order }
    })
  }

  const reset = () => { setDraft(EMPTY_DRAFT); setError(null) }

  const save = async () => {
    if (!dirty) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      /*
       * Start from what is saved so nothing else is lost, then apply spans
       * and order. A field with a change but no existing override needs one
       * created, and it must carry that field's CURRENT visibility —
       * defaulting it would hide or reveal the field as a side effect of
       * making it narrower.
       */
      const byId = new Map<string, FieldOverride>()
      for (const o of assetFieldOverrides) byId.set(o.field_id, { ...o })

      const allFields = (displayedFieldsBySection ?? []).flatMap(s => s.fields)
      const visibilityOf = (fieldId: string): boolean =>
        allFields.find(f => f.field_id === fieldId)?.is_visible ?? true

      const touch = (fieldId: string): FieldOverride => {
        const existing = byId.get(fieldId)
        const next: FieldOverride = existing
          ? { ...existing }
          : { field_id: fieldId, is_visible: visibilityOf(fieldId) }
        byId.set(fieldId, next)
        return next
      }

      draft.spans.forEach((span, fieldId) => { touch(fieldId).span = span })

      /*
       * Order is saved for EVERY field in a reordered section, not only the
       * one that moved. `display_order` is an absolute position, so writing
       * one field's new index while its neighbours keep their old ones puts
       * two fields at the same number and the tie breaks arbitrarily.
       */
      draft.order.forEach(ids => {
        ids.forEach((fieldId, index) => { touch(fieldId).display_order = index })
      })

      await saveCustomization.mutateAsync({
        layoutId: activeLayout?.id ?? null,
        fieldOverrides: Array.from(byId.values()),
        /* Not this screen's to change — but the RPC replaces what it is
           handed, so sending `[]` would DELETE every renamed, hidden or
           reordered section the customizer had saved. */
        sectionOverrides: assetSectionOverrides,
        newSections: [],
      })
      setDraft(EMPTY_DRAFT)
      onClose()
    } catch (e) {
      /* Saving genuinely fails — the RPC raises CONFLICT when the layout
         changed in another tab. Saying so beats closing as if it worked. */
      setError(e instanceof Error ? e.message : 'Could not save the layout.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="research-arrange-canvas" className="space-y-3">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl border border-primary-200 bg-primary-50/95 px-4 py-2.5 shadow-sm backdrop-blur dark:border-primary-800 dark:bg-primary-950/90">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-primary-900 dark:text-primary-100">
            Arranging {assetName ? `${assetName}'s ` : ''}Research page
          </p>
          <p className="mt-0.5 text-[11px] text-primary-700/90 dark:text-primary-300/90">
            Drag a field to move it. Drag its right edge, or use ← and → , to
            change how wide it is.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span
            data-testid="arrange-dirty"
            className="text-[11px] text-primary-700/80 dark:text-primary-300/80"
          >
            {dirty ? 'Not saved yet' : 'No changes'}
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
            onClick={onClose}
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
          className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
        >
          {error}
        </p>
      )}

      {isLoading ? (
        <div className="space-y-3" data-testid="arrange-loading">
          {[0, 1, 2].map(i => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <p className="rounded-xl border border-gray-200 px-4 py-6 text-center text-[13px] text-gray-500 dark:border-gray-700 dark:text-gray-400" data-testid="arrange-empty">
          No fields are visible on this page yet. Add them in Customize
          fields, then arrange them here.
        </p>
      ) : (
        sections.map(s => (
          <section
            key={s.sectionId}
            data-testid={`arrange-section-${s.sectionId}`}
            data-arrangeable={s.arrangeable}
            className="rounded-xl border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          >
            <h3 className="flex flex-wrap items-baseline gap-x-2 border-b border-gray-100 px-4 py-2 text-[10px] font-semibold uppercase tracking-wider text-gray-500 dark:border-gray-700 dark:text-gray-400">
              {s.sectionName}
              {!s.arrangeable && (
                <span className="font-medium normal-case tracking-normal text-gray-400">
                  — the page arranges this section itself
                </span>
              )}
            </h3>
            {/*
              The page's own grid. Twelve columns with each tile at its own
              span is exactly what AssetTab renders above `xl`, so what is
              drawn here IS the layout rather than a diagram of it. If these
              two disagree, this screen is lying.
            */}
            <div className="grid grid-cols-12 gap-2 px-4 py-3">
              {s.arrangeable ? (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleDragEnd(s.sectionId)}
                >
                  <SortableContext
                    items={s.tiles.map(t => t.fieldId)}
                    strategy={rectSortingStrategy}
                  >
                    {s.tiles.map(t => (
                      <ArrangeTile
                        key={t.fieldId}
                        tile={t}
                        onSetSpan={setSpan}
                      />
                    ))}
                  </SortableContext>
                </DndContext>
              ) : (
                s.tiles.map(t => (
                  <div
                    key={t.fieldId}
                    data-testid={`arrange-tile-${t.fieldId}`}
                    data-span={FULL_SPAN}
                    title={`${t.name} — the page places this field itself, so it has no width to set here.`}
                    className="col-span-12 rounded-lg border border-dashed border-gray-200 px-3 py-2.5 text-[12px] font-medium text-gray-400 dark:border-gray-700 dark:text-gray-500"
                  >
                    {t.name}
                  </div>
                ))
              )}
            </div>
          </section>
        ))
      )}

      <p className="flex items-start gap-1.5 px-1 pb-2 text-[11px] text-gray-400">
        <Info className="h-3.5 w-3.5 flex-none translate-y-px" aria-hidden="true" />
        <span>
          Widths apply on wide screens. On a narrow window every field is full
          width, whatever is set here. To add, remove, rename or move a field
          to another section, use Customize fields.
        </span>
      </p>
    </div>
  )
}

/**
 * One field as a tile: a drag handle, its name, its width, and a grip on the
 * right edge that resizes it.
 *
 * The resize is measured against the GRID's width, not the tile's. A span is
 * a fraction of the row, so the pointer's distance from the tile's left edge
 * has to be divided by the row to mean anything — dividing by the tile would
 * make every drag relative to the width it already had, and the tile would
 * creep toward whatever it was.
 */
function ArrangeTile({
  tile, onSetSpan,
}: {
  tile: Tile
  onSetSpan: (fieldId: string, span: FieldSpan) => void
}) {
  const {
    attributes, listeners, setNodeRef, transform, transition, isDragging,
  } = useSortable({ id: tile.fieldId })
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [resizing, setResizing] = useState(false)

  /* While resizing, the pointer leaves the grip and may leave the tile, so
     the move and release are listened for on the window. Attaching them to
     the grip loses the drag the moment the pointer outruns it. */
  useEffect(() => {
    if (!resizing) return
    const row = hostRef.current?.parentElement
    if (!row) return

    const apply = (clientX: number) => {
      const rowBox = row.getBoundingClientRect()
      const tileBox = hostRef.current?.getBoundingClientRect()
      if (!tileBox || rowBox.width <= 0) return
      onSetSpan(tile.fieldId, snapFraction((clientX - tileBox.left) / rowBox.width))
    }
    const onMove = (e: PointerEvent) => { e.preventDefault(); apply(e.clientX) }
    const stop = () => setResizing(false)

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', stop)
    window.addEventListener('pointercancel', stop)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', stop)
      window.removeEventListener('pointercancel', stop)
    }
  }, [resizing, tile.fieldId, onSetSpan])

  /* Resizing by keyboard, so the feature is not mouse-only. Left and right
     step through the snap spans; dnd-kit's keyboard sensor already owns the
     other keys for moving the tile, which is why these two are taken here
     and nothing else is. */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    e.stopPropagation()
    onSetSpan(tile.fieldId, stepSpan(tile.span, e.key === 'ArrowRight' ? 1 : -1))
  }

  return (
    <div
      ref={node => { setNodeRef(node); hostRef.current = node }}
      data-testid={`arrange-tile-${tile.fieldId}`}
      data-span={tile.span}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={clsx(
        'group relative flex min-h-[56px] items-start gap-1.5 rounded-lg border bg-gray-50 pl-1.5 pr-3 py-2 dark:bg-gray-900/40',
        SPAN_CLASS_FLAT[tile.span],
        isDragging
          ? 'z-10 border-primary-400 shadow-lg dark:border-primary-500'
          : 'border-gray-200 hover:border-primary-300 dark:border-gray-600',
      )}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        onKeyDown={onKeyDown}
        data-testid={`arrange-grab-${tile.fieldId}`}
        aria-label={`${tile.name} — ${spanLabel(tile.span)}. Space to pick up and move, left and right arrows to resize.`}
        className="flex-none cursor-grab rounded p-1 text-gray-400 hover:bg-gray-200 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 active:cursor-grabbing dark:hover:bg-gray-700"
      >
        <GripVertical className="h-4 w-4" aria-hidden="true" />
      </button>

      <span className="min-w-0 flex-1">
        <span className="line-clamp-2 text-[12px] font-medium text-gray-800 dark:text-gray-100">
          {tile.name}
        </span>
        <span
          data-testid={`arrange-span-label-${tile.fieldId}`}
          className="mt-0.5 block text-[10px] uppercase tracking-wide text-gray-400 dark:text-gray-500"
        >
          {spanLabel(tile.span)}
        </span>
      </span>

      {/*
        The resize grip. `touch-none` matters: without it a drag on a
        touchscreen scrolls the page instead, and the handle does nothing at
        all on the device where a 12px target is already hardest to hit.
      */}
      <span
        role="presentation"
        data-testid={`arrange-resize-${tile.fieldId}`}
        onPointerDown={e => { e.preventDefault(); e.stopPropagation(); setResizing(true) }}
        className={clsx(
          'absolute inset-y-1 right-0 w-3 cursor-col-resize touch-none rounded-r-lg',
          resizing
            ? 'bg-primary-400/60'
            : 'bg-transparent group-hover:bg-primary-300/40',
        )}
      />
    </div>
  )
}
