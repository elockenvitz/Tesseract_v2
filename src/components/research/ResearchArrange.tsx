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
import { GripVertical, Plus, RotateCcw, X } from 'lucide-react'
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
  /** Whether a field is on the page: the draft's answer, else the saved one. */
  visibleOf: (fieldId: string, saved: boolean) => boolean
  setSpan: (fieldId: string, span: FieldSpan) => void
  reorder: (sectionId: string, ids: string[]) => void
  setVisible: (fieldId: string, visible: boolean) => void
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
  const [visible, setVisibleMap] = useState<Map<string, boolean>>(new Map())

  const setSpan = useCallback((fieldId: string, span: FieldSpan) => {
    setSpans(prev => new Map(prev).set(fieldId, span))
  }, [])

  const reorder = useCallback((sectionId: string, ids: string[]) => {
    setOrder(prev => new Map(prev).set(sectionId, ids))
  }, [])

  const setVisible = useCallback((fieldId: string, v: boolean) => {
    setVisibleMap(prev => new Map(prev).set(fieldId, v))
  }, [])

  const clear = useCallback(() => {
    setSpans(new Map()); setOrder(new Map()); setVisibleMap(new Map())
  }, [])

  const value = useMemo<ArrangeState>(() => ({
    active,
    spanOf: (fieldId, saved) => spans.get(fieldId) ?? saved,
    orderOf: sectionId => order.get(sectionId) ?? null,
    visibleOf: (fieldId, saved) => visible.get(fieldId) ?? saved,
    setSpan,
    reorder,
    setVisible,
  }), [active, spans, order, visible, setSpan, reorder, setVisible])

  const draft = useMemo<ArrangeDraft>(
    () => ({ assetId, spans, order, visible, clear }),
    [assetId, spans, order, visible, clear],
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
  /** Fields added to or removed from the page, not yet saved. */
  visible: Map<string, boolean>
  clear: () => void
}
const ArrangeDraftContext = createContext<ArrangeDraft | null>(null)

/**
 * Where an arrangement is written.
 *
 *  - `asset`    this stock only, as per-asset overrides
 *  - `template` the active template, so every stock on it moves too
 *  - `new`      a new template made from this page, which this stock
 *               is then switched onto
 */
export type SaveTarget = 'asset' | 'template' | 'new'

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
    resolvedSectionOverrides,
    activeLayout,
    saveCustomization,
    selectLayoutForAsset,
    clearAssetOverrides,
  } = useUserAssetPagePreferences(draft?.assetId)
  /* Templates are a different hook: this one is scoped to one asset, and
     writing a template is not. */
  const { layouts, updateLayout, saveLayout } = useUserAssetPageLayouts()

  const arrange = useArrange()
  const [target, setTarget] = useState<SaveTarget>('asset')
  const [newTemplateName, setNewTemplateName] = useState('')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const changed =
    (draft?.spans.size ?? 0) + (draft?.order.size ?? 0) + (draft?.visible.size ?? 0)
  const dirty = changed > 0

  /**
   * Everything that exists but is not on the page right now.
   *
   * Reads the draft as well as the saved state, so a field removed a
   * moment ago appears here immediately and can be put straight back —
   * otherwise an accidental removal could only be undone by discarding
   * every other change with Reset.
   */
  const offPage = useMemo(
    () => (displayedFieldsBySection ?? []).flatMap(s =>
      s.fields
        .filter(f => !(arrange?.visibleOf(f.field_id, f.is_visible) ?? f.is_visible))
        .map(f => ({ id: f.field_id, name: f.field_name, section: s.section_name })),
    ),
    [displayedFieldsBySection, arrange],
  )

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
    /* Adding and removing write the same `is_visible` the field customizer
       writes, so the two screens cannot disagree about what is on a page. */
    draft?.visible.forEach((v, fieldId) => { touch(fieldId).is_visible = v })
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
  /**
   * The page as it currently reads, in the shape a template stores.
   *
   * Built from what is RENDERED rather than by patching the stored config:
   * the stored config can be missing fields the page is showing from
   * defaults, and patching would silently drop them. The trade is that
   * saving to a template also bakes in anything that was previously
   * arriving from a default — which is what "make the page look like this
   * everywhere" has to mean.
   */
  const templateConfigFromPage = () => {
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
        is_visible: draft?.visible.get(f.field_id) ?? f.is_visible,
        display_order: sIdx * 1000 + fIdx,
        is_collapsed: f.is_collapsed ?? false,
        span: draft?.spans.get(f.field_id) ?? f.span ?? FULL_SPAN,
      }))
    })
    /*
     * Sections travel too, now that a template can hold them. This is the
     * RESOLVED view — the template's own sections with this asset's
     * renames merged over — because the point of saving to a template is
     * that what you are looking at becomes the template.
     */
    return { fieldConfig, sectionConfig: resolvedSectionOverrides }
  }

  /**
   * Having written the arrangement into a template, stop overriding it here.
   *
   * Per-asset overrides BEAT the template — which is the whole point of
   * "this stock only". So saving to a template without clearing them left
   * the one stock you were looking at as the one that did not follow it:
   * the page refused to change, and its overrides were now a duplicate of
   * the template, pinning it there permanently.
   *
   * Clearing is safe because a template can now express everything the
   * per-asset layer holds — field visibility, section, order and span,
   * plus the sections themselves. Nothing is dropped; it moved up a level.
   */
  const stopOverridingLocally = async () => {
    if (draft?.assetId) await clearAssetOverrides.mutateAsync(draft.assetId)
  }

  const saveToTemplate = async () => {
    if (!activeLayout?.id) throw new Error('No template to save to.')
    const { fieldConfig, sectionConfig } = templateConfigFromPage()
    await updateLayout.mutateAsync({ layoutId: activeLayout.id, fieldConfig, sectionConfig })
    await stopOverridingLocally()
  }

  /**
   * A new template from this page, and this asset switched onto it.
   *
   * Without the switch the reader would name a template, press save, and
   * see no change at all — the page would still be on whatever it was
   * using, and the thing they just made would be invisible.
   */
  const saveAsNewTemplate = async () => {
    const name = newTemplateName.trim()
    if (!name) throw new Error('Give the template a name.')
    const { fieldConfig, sectionConfig } = templateConfigFromPage()
    /*
     * The insert's row type infers as `never` here — the generated
     * Supabase types do not reach this mutation — so the id is read
     * defensively rather than asserted. If it is missing the template is
     * still created; only the switch below is skipped, which is why that
     * is guarded rather than assumed.
     */
    const created: unknown = await saveLayout.mutateAsync({ name, fieldConfig, sectionConfig })
    const createdId =
      created && typeof created === 'object' && 'id' in created
        ? String((created as { id: unknown }).id)
        : null
    if (createdId && draft?.assetId) {
      /* Switch first, THEN clear: `clearAssetOverrides` deletes the whole
         selection row when it carries no layout_id, so clearing first
         would take the new template choice with it. */
      await selectLayoutForAsset.mutateAsync({ assetId: draft.assetId, layoutId: createdId })
      await stopOverridingLocally()
    }
  }

  const save = async () => {
    /* "Save as new template" is worth doing with no changes at all —
        it captures the page as it stands. The other two are not. */
    if (!dirty && target !== 'new') { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      if (target === 'new') await saveAsNewTemplate()
      else if (target === 'template') await saveToTemplate()
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
            Which template this stock is on.

            It switches immediately rather than on Save, because the page
            below redraws to the chosen template and that IS the preview —
            there is nothing to confirm that the reader cannot already see.
            An unsaved arrangement is kept: it is applied on top of
            whichever template is underneath.
          */}
          {(layouts?.length ?? 0) > 0 && (
            <label className="flex items-center gap-1.5 text-[11px] text-primary-800 dark:text-primary-200">
              <span className="sr-only">Template for this stock</span>
              <select
                value={activeLayout?.id ?? ''}
                disabled={saving || !draft?.assetId}
                data-testid="arrange-template-picker"
                onChange={async e => {
                  const layoutId = e.target.value || null
                  setError(null)
                  try {
                    await selectLayoutForAsset.mutateAsync({ assetId: draft!.assetId, layoutId })
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not switch template.')
                  }
                }}
                className="max-w-[11rem] truncate rounded-md border border-primary-300 bg-white px-2 py-1.5 text-[11px] font-medium text-primary-900 focus:border-primary-500 focus:outline-none disabled:opacity-50 dark:border-primary-700 dark:bg-gray-900 dark:text-primary-100"
              >
                <option value="">Default layout</option>
                {layouts?.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.name}{l.is_default ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}

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
              { key: 'asset' as const, label: 'This stock', disabled: false, hint: `Applies to ${assetName ?? 'this stock'} only.` },
              {
                key: 'template' as const,
                label: 'All stocks',
                disabled: !templateWritable,
                hint: templateWritable
                  ? `Changes the "${activeLayout?.name}" template, so every stock using it moves too.`
                  : 'There is no template to change yet — use New template.',
              },
              {
                key: 'new' as const,
                label: 'New template',
                disabled: false,
                hint: 'Saves this page as a new template and puts this stock on it.',
              },
            ]).map(o => (
              <button
                key={o.key}
                type="button"
                role="radio"
                aria-checked={target === o.key}
                disabled={o.disabled}
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

          {target === 'new' && (
            <input
              type="text"
              value={newTemplateName}
              onChange={e => setNewTemplateName(e.target.value)}
              placeholder="Template name"
              aria-label="Name for the new template"
              data-testid="arrange-new-template-name"
              className="w-40 rounded-md border border-primary-300 bg-white px-2 py-1.5 text-[12px] text-gray-900 placeholder:text-gray-400 focus:border-primary-500 focus:outline-none dark:border-primary-700 dark:bg-gray-900 dark:text-gray-100"
            />
          )}

          {/*
            Add a field, from the page you are adding it to.

            The list is everything not currently shown, named with the
            section it will land in — the same place it was before it was
            removed, so adding is the exact inverse of the × on a field and
            never has to ask where to put it.
          */}
          <span className="relative">
            <button
              type="button"
              onClick={() => setAdding(a => !a)}
              aria-expanded={adding}
              disabled={offPage.length === 0}
              title={offPage.length === 0
                ? 'Every field is already on this page.'
                : 'Put a field back on this page'}
              data-testid="arrange-add-field"
              className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-primary-800 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary-700 dark:bg-gray-900 dark:text-primary-200"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add field
            </button>
            {adding && offPage.length > 0 && (
              <span
                role="menu"
                data-testid="arrange-add-menu"
                className="absolute right-0 top-full z-40 mt-1 block max-h-72 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800"
              >
                {offPage.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    role="menuitem"
                    data-testid={`arrange-add-${f.id}`}
                    onClick={() => { arrange?.setVisible(f.id, true); setAdding(false) }}
                    className="block w-full px-3 py-1.5 text-left hover:bg-primary-50 dark:hover:bg-gray-700"
                  >
                    <span className="block truncate text-[12px] font-medium text-gray-800 dark:text-gray-100">
                      {f.name}
                    </span>
                    <span className="block truncate text-[10px] text-gray-400">{f.section}</span>
                  </button>
                ))}
              </span>
            )}
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

      {/*
        Saving to a template rewrites every stock on it, and the reader is
        looking at exactly one of them. Said before the press, because
        afterwards there is no undo — the previous arrangement is gone.
      */}
      {target !== 'asset' && (
        <p
          data-testid="arrange-scope-warning"
          className="mt-2 text-[11px] text-primary-800/90 dark:text-primary-200/90"
        >
          {target === 'template'
            ? `Every stock using "${activeLayout?.name}" will be arranged this way. ${assetName ?? 'This stock'}'s own adjustments will be cleared, so it follows the template from now on.`
            : `Saves this page as a new template and puts ${assetName ?? 'this stock'} on it. Its own adjustments will be cleared, so it follows the new template.`}
        </p>
      )}

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
  /**
   * Whether the layout says this field is on the page, before the draft.
   *
   * Arrange mode is handed the hidden fields too, so that putting one back
   * can mount it. Passing `true` here instead would make every hidden
   * field appear the moment anyone started arranging.
   */
  savedVisible: boolean
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
  fieldId, fieldName, sectionId, sectionSlug, savedSpan, savedVisible, children,
}: ArrangeableFieldProps) {
  const arrange = useArrange()
  const span = arrange?.spanOf(fieldId, savedSpan) ?? savedSpan
  const arrangeable = arrange?.active && !SELF_ARRANGED_SECTIONS.has(sectionSlug)

  /*
   * Off the page: either the layout hides it, or the draft just removed
   * it. Removed fields leave at once rather than greying out in place —
   * the question being answered is what the page looks like without them,
   * which a placeholder holding their space cannot show.
   */
  if (arrange?.active ? !arrange.visibleOf(fieldId, savedVisible) : !savedVisible) return null

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
        Remove, on the field itself.

        Taking a field off the page is a thing you decide while looking at
        the page, so it is here rather than in a list on another screen.
        It only hides: the field keeps its width and its place, and the
        writing in it is untouched, so putting it back restores what was
        there. Sits above the drag sheet, or the sheet would swallow it.
      */}
      <button
        type="button"
        data-testid={`arrange-remove-${fieldId}`}
        title={`Remove ${fieldName} from this page`}
        aria-label={`Remove ${fieldName} from this page`}
        onPointerDown={e => e.stopPropagation()}
        onClick={e => { e.stopPropagation(); arrange.setVisible(fieldId, false) }}
        className="absolute right-4 top-2 z-10 rounded-md bg-white/95 p-1 text-gray-400 opacity-0 shadow-sm transition-opacity hover:text-error-600 focus-visible:opacity-100 group-hover:opacity-100 dark:bg-gray-900/95"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
      </button>

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
