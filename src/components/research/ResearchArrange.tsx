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
  useDroppable,
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
  useResearchPagePreferences,
  useResearchPageLayouts,
  type FieldOverride,
} from '../../hooks/useUserAssetPagePreferences'
import { assetSubject, type ResearchSubject } from '../../lib/research/subject'
import {
  SELF_ARRANGED_SECTIONS,
  SPAN_CLASS,
  snapFraction,
  spanLabel,
  stepSpan,
} from '../../lib/research/field-span'
import {
  FULL_SPAN,
  overrideDiffersFromBaseline,
  type FieldSpan,
} from '../../lib/research/layout-resolver'
import { LayoutStatusChip } from './LayoutStatusChip'
import { useIsOrgAdmin } from '../../hooks/useIsOrgAdmin'

interface ArrangeState {
  active: boolean
  /** The span to draw a field at: the draft's, else the saved one. */
  spanOf: (fieldId: string, saved: FieldSpan) => FieldSpan
  /**
   * Which fields are in a section right now, in order — the draft's answer.
   *
   * One derived map rather than separate "order" and "which section"
   * questions, because a drag can change both at once and two lookups that
   * disagreed for a frame would render a field twice or not at all.
   */
  fieldsIn: (sectionId: string) => string[]
  /** Whether a field is on the page: the draft's answer, else the saved one. */
  visibleOf: (fieldId: string, saved: boolean) => boolean
  setSpan: (fieldId: string, span: FieldSpan) => void
  setVisible: (fieldId: string, visible: boolean) => void
}

const ArrangeContext = createContext<ArrangeState | null>(null)

/** Null outside arrange mode, so a wrapper can render plainly. */
function useArrange(): ArrangeState | null {
  return useContext(ArrangeContext)
}

export interface ResearchArrangeProviderProps {
  /**
   * What is being arranged: an asset's research page or a theme's.
   *
   * A `ResearchSubject`, not an id, because arranging reads and writes the
   * whole layout stack — the section catalogue, the field catalogue, the
   * selection row, the active template and the save RPC — and every one of
   * those is a different table per subject. An id alone cannot say which.
   */
  subject: ResearchSubject
  active: boolean
  children: ReactNode
}

/** Draft state, shared by the bar and every wrapped field. */
export function ResearchArrangeProvider({
  subject: subjectProp, active, children,
}: ResearchArrangeProviderProps) {
  /*
   * A stable subject, because hosts build theirs inline.
   *
   * `<ResearchArrangeProvider subject={assetSubject(asset.id)}>` hands a
   * NEW object every render, and the draft below is a `useMemo` keyed on
   * it, so an unmemoized prop would rebuild the draft — and re-render the
   * bar and every wrapped field — on each parent render. Keyed on the two
   * things that identify a subject rather than on the object, so a caller
   * cannot cause that by writing the obvious thing.
   */
  const subject = useMemo(
    () => subjectProp,
    [subjectProp.descriptor.kind, subjectProp.id], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const [spans, setSpans] = useState<Map<string, FieldSpan>>(new Map())
  const [order, setOrder] = useState<Map<string, string[]>>(new Map())
  const [visible, setVisibleMap] = useState<Map<string, boolean>>(new Map())
  /** Fields the reader dragged into a section other than their own. */
  const [moved, setMoved] = useState<Map<string, string>>(new Map())

  /* The same query AssetTab already runs, so React Query serves it from
     cache rather than fetching twice. The provider needs it because a
     cross-section drag has to know what is where, and only it sees every
     section at once. */
  const { sectionsForArranging: displayedFieldsBySection } = useResearchPagePreferences(subject)

  const setSpan = useCallback((fieldId: string, span: FieldSpan) => {
    setSpans(prev => new Map(prev).set(fieldId, span))
  }, [])

  const setVisible = useCallback((fieldId: string, v: boolean) => {
    setVisibleMap(prev => new Map(prev).set(fieldId, v))
  }, [])

  const clear = useCallback(() => {
    setSpans(new Map()); setOrder(new Map()); setVisibleMap(new Map()); setMoved(new Map())
  }, [])

  /**
   * Where every visible field sits right now: section → ordered field ids.
   *
   * Derived in one place from saved state plus the draft, rather than kept
   * as its own state. A second copy would have to be reconciled on every
   * change, and the failure mode of getting that wrong is a field drawn in
   * two sections at once or in none.
   */
  const layout = useMemo(() => {
    const map = new Map<string, string[]>()
    const sections = displayedFieldsBySection ?? []
    for (const s of sections) map.set(s.section_id, [])

    for (const s of sections) {
      for (const f of s.fields) {
        if (!(visible.get(f.field_id) ?? f.is_visible)) continue
        const target = moved.get(f.field_id) ?? s.section_id
        if (!map.has(target)) map.set(target, [])
        map.get(target)!.push(f.field_id)
      }
    }

    /* Then the reader's order within each section. Fields the drag never
       saw keep their place at the end rather than disappearing. */
    for (const [sectionId, ids] of map) {
      const wanted = order.get(sectionId)
      if (!wanted) continue
      map.set(sectionId, [
        ...wanted.filter(id => ids.includes(id)),
        ...ids.filter(id => !wanted.includes(id)),
      ])
    }
    return map
  }, [displayedFieldsBySection, visible, moved, order])

  const sectionHolding = useCallback((fieldId: string): string | null => {
    for (const [sectionId, ids] of layout) if (ids.includes(fieldId)) return sectionId
    return null
  }, [layout])

  const sensors = useSensors(
    /* A field is large and holds a resize grip, so a press has to travel
       before it counts as a drag — otherwise grabbing the grip, or a click
       meant for the chrome, starts moving the field. */
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  /**
   * Everything happens on DROP, not during the drag.
   *
   * The usual dnd-kit recipe moves an item between containers on
   * `onDragOver` so it animates across. It cannot be used here: these are
   * real, live field editors, and moving one to another section unmounts
   * and remounts it — including the node being dragged, which ends the
   * drag mid-gesture and loses the field somewhere between the two.
   * Settling once on drop is the correct trade, not merely the simpler one.
   */
  const onDragEnd = (event: DragEndEvent) => {
    const { active: dragged, over } = event
    if (!over) return
    const fieldId = String(dragged.id)
    const overId = String(over.id)
    if (fieldId === overId) return

    const from = sectionHolding(fieldId)
    /* `over` is either another field or a section's empty space, which is
       registered as a droppable under `section:<id>`. */
    const to = overId.startsWith(SECTION_DROP_PREFIX)
      ? overId.slice(SECTION_DROP_PREFIX.length)
      : sectionHolding(overId)
    if (!from || !to) return

    if (from === to) {
      const ids = layout.get(from) ?? []
      const a = ids.indexOf(fieldId)
      const b = ids.indexOf(overId)
      if (a < 0 || b < 0) return
      setOrder(prev => new Map(prev).set(from, arrayMove(ids, a, b)))
      return
    }

    /* Across sections: out of one list, into the other at the drop point,
       and BOTH orders are recorded. Writing only the destination would
       leave the source's order unstated, so the gap the field left would
       be filled by whatever the saved order said. */
    const fromIds = (layout.get(from) ?? []).filter(id => id !== fieldId)
    const toIds = [...(layout.get(to) ?? [])]
    const at = toIds.indexOf(overId)
    toIds.splice(at < 0 ? toIds.length : at, 0, fieldId)

    setMoved(prev => new Map(prev).set(fieldId, to))
    setOrder(prev => new Map(prev).set(from, fromIds).set(to, toIds))
  }

  const value = useMemo<ArrangeState>(() => ({
    active,
    spanOf: (fieldId, saved) => spans.get(fieldId) ?? saved,
    fieldsIn: sectionId => layout.get(sectionId) ?? [],
    visibleOf: (fieldId, saved) => visible.get(fieldId) ?? saved,
    setSpan,
    setVisible,
  }), [active, spans, layout, visible, setSpan, setVisible])

  const draft = useMemo<ArrangeDraft>(
    () => ({ subject, spans, order, visible, moved, layout, clear }),
    [subject, spans, order, visible, moved, layout, clear],
  )

  const body = (
    <ArrangeContext.Provider value={active ? value : null}>
      <ArrangeDraftContext.Provider value={draft}>
        {children}
      </ArrangeDraftContext.Provider>
    </ArrangeContext.Provider>
  )

  /*
   * ONE drag context around every section, not one per section.
   *
   * A context per section is what made a field undraggable past its own
   * heading: dnd-kit only considers droppables inside the context the drag
   * began in, so the rest of the page was not a place a field could go.
   */
  if (!active) return body
  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      {body}
    </DndContext>
  )
}

/** Namespaces a section's own droppable id so it cannot collide with a field's. */
const SECTION_DROP_PREFIX = 'section:'

/**
 * The draft itself, for the bar that saves it.
 *
 * Separate from `ArrangeContext` because that one is nulled out when
 * arrange mode is off — the bar needs the draft to exist while it is
 * saving and closing, which happens in the same tick as `active` going
 * false.
 */
interface ArrangeDraft {
  /** Which research page this draft belongs to. See the provider's props. */
  subject: ResearchSubject
  spans: Map<string, FieldSpan>
  order: Map<string, string[]>
  /** Fields added to or removed from the page, not yet saved. */
  visible: Map<string, boolean>
  /** Fields dragged into a different section, by field id → section id. */
  moved: Map<string, string>
  /** Where everything sits now: section id → ordered field ids. */
  layout: Map<string, string[]>
  clear: () => void
}
const ArrangeDraftContext = createContext<ArrangeDraft | null>(null)

/**
 * The subject a bar with no draft reads, which is no subject at all.
 *
 * Module-level so it is one object: the hooks below take a subject and
 * build query keys from it, and a fresh `assetSubject(undefined)` per
 * render would be a new dependency every time. An undefined id means
 * "library only, no per-subject row", which the hooks already handle.
 */
const EMPTY_SUBJECT = assetSubject(undefined)

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
  /** The name shown in the bar and on the Save button: a ticker, a theme. */
  subjectName?: string | null
  /**
   * What to call the subject when it has no name yet.
   *
   * Only the fallback wording, never a substitute for `subjectName`: "this
   * stock" on an asset page and "this theme" on a theme page. A single
   * noun rather than a sentence per surface, because the three places this
   * appears are the scope note, the new-section note and the Save button,
   * and they have to agree.
   */
  subjectNoun?: string
  onClose: () => void
}

/**
 * The bar: what is being edited, where it will be saved, and the way out.
 *
 * It is sticky rather than fixed, so it belongs to the page it is editing
 * rather than floating over it.
 */
export function ResearchArrangeBar({
  subjectName, subjectNoun = 'stock', onClose,
}: ResearchArrangeBarProps) {
  const draft = useContext(ArrangeDraftContext)
  /*
   * The subject comes from the DRAFT, not from a prop of this bar.
   *
   * One source, so the bar cannot read one subject's catalogue while
   * saving to another's tables — which is exactly the shape of bug that
   * two props naming the same thing produce. The fallback only covers a
   * bar rendered outside the provider, which is a wiring mistake, not a
   * state: with no draft every value below is empty and nothing saves, so
   * the fallback's job is to keep the hook count stable, not to work.
   */
  const subject = draft?.subject ?? EMPTY_SUBJECT
  const {
    displayedFieldsBySection,
    assetFieldOverrides,
    assetSectionOverrides,
    activeLayout,
    saveCustomization,
    selectLayoutForAsset,
    clearAssetOverrides,
    templateBaselineFields,
    overridesTemplate,
    createSection,
  } = useResearchPagePreferences(subject)
  /* Templates are a different hook. Only the LIST is needed here, to fill
     the picker — arrange mode chooses which template this stock follows,
     and never writes one. */
  const { layouts } = useResearchPageLayouts(subject)
  const { canAuthorCatalog } = useIsOrgAdmin()

  /*
   * How the bar names what it is saving to, in one place.
   *
   * The name appears in the scope note, the new-section note and on the
   * Save button, and those three have to agree: a button reading "Save to
   * NKE" above a note reading "Saves to this theme only" is the kind of
   * disagreement that makes a reader distrust the scope promise, which is
   * the only thing telling them the save is narrow.
   *
   * `subjectNoun` is pluralised by adding an "s", which is correct for the
   * only two values there are ("stock", "theme"). A third subject with an
   * irregular plural needs a second prop, not a pluralisation library.
   */
  const subjectLabel = subjectName ?? `this ${subjectNoun}`
  const subjectPlural = `${subjectNoun}s`

  const arrange = useArrange()
  const [adding, setAdding] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [newSectionName, setNewSectionName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  /**
   * Create a section and put it on this stock.
   *
   * `createSection` writes two things: a row in the organisation's
   * `research_sections`, and an `is_added` section override on this
   * stock. The first is unavoidable — a section is a schema object other
   * stocks can reuse — and the second is what keeps the promise this bar
   * makes, that arranging changes this stock and nothing else. The
   * wording in the menu says so rather than leaving it to be found.
   */
  const addSection = async () => {
    const name = newSectionName.trim()
    if (!name) return
    setError(null)
    try {
      await createSection.mutateAsync({ name, addAsOverride: true })
      setNewSectionName('')
      setAddingSection(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add the section.')
    }
  }

  /**
   * How many things actually differ from what is saved — not how many
   * entries the draft holds.
   *
   * Those are different numbers. Removing a field and adding it straight
   * back leaves an entry behind whose value matches the saved state, and
   * counting entries reported "1 change" over a page identical to the
   * stored one. Same for resizing a field and resizing it back. The count
   * is the reason to press Save, so it has to mean something.
   */
  const changed = useMemo(() => {
    if (!draft) return 0
    const saved = new Map(
      (displayedFieldsBySection ?? []).flatMap(s => s.fields).map(f => [f.field_id, f]),
    )
    let n = 0
    draft.spans.forEach((span, id) => {
      if (span !== (saved.get(id)?.span ?? FULL_SPAN)) n++
    })
    draft.visible.forEach((v, id) => {
      if (v !== (saved.get(id)?.is_visible ?? true)) n++
    })
    draft.order.forEach((ids, sectionId) => {
      const current = (displayedFieldsBySection ?? [])
        .find(s => s.section_id === sectionId)?.fields
        .filter(f => draft.visible.get(f.field_id) ?? f.is_visible)
        .map(f => f.field_id) ?? []
      /* An order entry counts once for the section, not once per field:
         it is one thing the reader did. */
      if (ids.length !== current.length || ids.some((id, i) => id !== current[i])) n++
    })
    return n
  }, [draft, displayedFieldsBySection])

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
    /* A field dragged across sections carries its new section with it.
       Writing only the order would renumber it inside a section it does
       not belong to, and it would snap back on the next load. */
    draft?.moved.forEach((sectionId, fieldId) => { touch(fieldId).section_id = sectionId })
    /* Every field in a reordered section is renumbered, not just the one
       that moved: `display_order` is an absolute position, so leaving the
       neighbours alone puts two fields on the same number. */
    draft?.order.forEach(ids => {
      ids.forEach((fieldId, index) => { touch(fieldId).display_order = index })
    })

    /*
     * An override that says what the template already says is not an
     * override — drop it.
     *
     * Without this, setting a field back to how the template has it
     * leaves a row behind that happens to agree. The page looks right, so
     * nothing tells you anything is wrong, but the stock is now PINNED:
     * change the template later and this one stock silently refuses to
     * follow, because it carries an explicit instruction that matches
     * today's template and not tomorrow's.
     *
     * Compared against `templateBaselineFields`, which is the real
     * resolver run with the overrides stripped — not a second opinion
     * about what the template means.
     */
    const kept = Array.from(byId.values()).filter(o =>
      overrideDiffersFromBaseline(o, templateBaselineFields.get(o.field_id)),
    )

    /*
     * Nothing left to say, and no deliberately chosen template: remove the
     * row entirely so the stock is genuinely back on the default, not
     * sitting on an empty override that still counts as one.
     */
    if (kept.length === 0 && assetSectionOverrides.length === 0 && !activeLayout?.id) {
      /* `clearAssetOverrides` takes the id positionally; the keyed
         mutations spell it `subjectId`. Both write
         `S.tables.selections` keyed on `S.subjectColumn`, so on a theme
         page this is a theme id. */
      if (draft?.subject.id) await clearAssetOverrides.mutateAsync(draft.subject.id)
      return
    }

    await saveCustomization.mutateAsync({
      layoutId: activeLayout?.id ?? null,
      fieldOverrides: kept,
      /* Not this bar's to change, and `[]` would DELETE every renamed,
         hidden or reordered section. */
      sectionOverrides: assetSectionOverrides,
      newSections: [],
    })
  }

  /*
   * `templateConfigFromPage()` lived here: it read the arranged page back
   * out in the shape a TEMPLATE stores. Removed with the template save
   * itself — it had no other caller, and dead code that writes to a
   * shared table is worse than no code. It is in git history at d937e4c0
   * if the template editor ever wants to build a template from a page.
   */

  /**
   * Arrange mode writes THIS STOCK and nothing else.
   *
   * It used to offer three targets — this stock, every stock on the
   * template, and a brand-new template. That put two jobs on one bar: a
   * tweak to the page in front of you, and a change to what every other
   * page looks like. The second job already has a home in the template
   * editor, which is also where templates are named, duplicated and
   * deleted, so the arrange bar was a worse second entrance to it.
   *
   * Removing it also removes the failure mode it carried: a template save
   * from here had to clear this asset's own overrides afterwards, because
   * per-asset settings beat the template and would otherwise pin the one
   * stock you were looking at to a stale copy of what you just saved.
   *
   * The template PICKER stays, because choosing which template a stock
   * follows is itself a per-stock setting — it writes this asset's
   * selection row, not the template.
   */
  const save = async () => {
    if (!dirty) { onClose(); return }
    setSaving(true)
    setError(null)
    try {
      await saveToAsset()
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
            Arranging {subjectName ? `${subjectName}'s ` : ''}Research page
          </p>
          <p className="mt-0.5 text-[11px] text-primary-700/90 dark:text-primary-300/90">
            Drag a field to move it. Drag its right edge, or use ← and →, to
            change how wide it is. Each section header has its own controls —
            rename, reorder, hide. Fields are not editable while arranging.
          </p>
          {/*
            Scope, stated once and always. With the target picker gone
            there is no control left that says where a save lands, so the
            bar has to — otherwise the safest possible behaviour would
            also be the least obvious one.
          */}
          <p
            data-testid="arrange-scope-note"
            className="mt-0.5 text-[11px] font-medium text-primary-800 dark:text-primary-200"
          >
            Saves to {subjectLabel} only. To change every {subjectNoun},
            edit the layout template.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/*
            The same chip the Research toolbar shows, in the same words.

            Arrange mode used to state the layout layer in its own
            vocabulary — a picker naming a template, and a sentence about
            scope — while the toolbar outside used another. Two names for
            one state is how the original confusion started, so the state
            is reported by one component in both places. Read-only here:
            Reset is a write, and the way out of an override while
            arranging is the picker beside it plus Save, not a second
            button that discards what you are in the middle of doing.
          */}
          <LayoutStatusChip
            templateName={activeLayout?.name ?? null}
            isDefaultTemplate={activeLayout?.is_default ?? false}
            overridden={overridesTemplate}
          />

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
                disabled={saving || !draft?.subject.id}
                data-testid="arrange-template-picker"
                onChange={async e => {
                  const layoutId = e.target.value || null
                  setError(null)
                  try {
                    await selectLayoutForAsset.mutateAsync({ subjectId: draft!.subject.id!, layoutId })
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
            No "where does this land" control any more — it always lands on
            this stock. The sentence in the bar's header says so, which is
            cheaper to read than a radio group that was correct three
            quarters of the time and dangerous the rest.
          */}

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

          {/*
            Add a section.

            The only section action that cannot live on a section header,
            because there is no header to put it on yet. Renaming,
            reordering, hiding and removing are all on the sections
            themselves — see `ResearchArrangeSection.tsx` for why.

            It writes immediately, like the template picker: the new
            section appears below, empty, ready to have fields dragged
            into it, and that appearance is the confirmation.
          */}
          {/*
            Offered only to someone the database will actually let do it.

            `research_sections` carries one `FOR ALL` policy with a null
            `WITH CHECK`, so Postgres applies its `USING` clause to the
            INSERT as well: a non-admin member has SELECT and nothing
            else, and the insert fails 42501. The desktop field manager
            shows the button to everyone and swallows the rejection in a
            console.error — tap it, the menu closes, nothing happens.
            `useIsOrgAdmin` is the seam that exists so a surface does not
            do that, and it fails closed, so an unresolved answer hides
            the control rather than offering one that will be refused.

            This is an affordance check, not authorization. RLS is still
            the only thing enforcing it.
          */}
          {canAuthorCatalog && (
          <span className="relative">
            <button
              type="button"
              onClick={() => setAddingSection(s => !s)}
              aria-expanded={addingSection}
              disabled={saving || !draft?.subject.id}
              title="Add a new section to this page"
              data-testid="arrange-add-section"
              className="inline-flex items-center gap-1 rounded-md border border-primary-300 bg-white px-2 py-1.5 text-[11px] font-semibold text-primary-800 hover:bg-primary-100 disabled:cursor-not-allowed disabled:opacity-40 dark:border-primary-700 dark:bg-gray-900 dark:text-primary-200"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add section
            </button>
            {addingSection && (
              <span className="absolute right-0 top-full z-40 mt-1 block w-72 rounded-lg border border-gray-200 bg-white p-2 shadow-lg dark:border-gray-700 dark:bg-gray-800">
                <input
                  value={newSectionName}
                  autoFocus
                  placeholder="Section name"
                  aria-label="Name for the new section"
                  data-testid="arrange-new-section-name"
                  onChange={e => setNewSectionName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') { e.preventDefault(); void addSection() }
                    if (e.key === 'Escape') { e.preventDefault(); setAddingSection(false) }
                  }}
                  className="w-full rounded border border-gray-300 px-2 py-1.5 text-[12px] focus:border-primary-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                />
                {/*
                  A section belongs to the organization's research schema,
                  so it will exist for every stock — it is only ADDED to
                  this one. Said here rather than discovered later, because
                  the rest of this bar promises that nothing leaves this
                  stock.
                */}
                <span className="mt-1.5 block text-[10px] text-gray-500 dark:text-gray-400">
                  Added to {subjectLabel}. The section itself joins your
                  organisation's list, so you can add it to other {subjectPlural} too.
                </span>
                <span className="mt-2 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setAddingSection(false); setNewSectionName('') }}
                    className="rounded px-2 py-1 text-[11px] font-medium text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void addSection()}
                    disabled={!newSectionName.trim() || createSection.isPending}
                    data-testid="arrange-create-section"
                    className="rounded bg-primary-600 px-2 py-1 text-[11px] font-semibold text-white hover:bg-primary-700 disabled:opacity-40"
                  >
                    {createSection.isPending ? 'Adding…' : 'Add'}
                  </button>
                </span>
              </span>
            )}
          </span>
          )}

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
            {/*
              Named for what it writes, not for what it is.

              "Save layout" reads as saving THE layout — the shared thing
              every stock uses — which is the one thing this button does
              not do. The stock's own name on the button is the cheapest
              place to say so, because it is read at the moment of the
              decision rather than three lines above it.
            */}
            {saving ? 'Saving…' : dirty ? `Save to ${subjectLabel}` : 'Done'}
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
  const arrangeable = arrange?.active && !SELF_ARRANGED_SECTIONS.has(sectionSlug)

  if (!arrangeable) return <div className={className}>{children}</div>
  return (
    <ArrangeableFieldGridActive
      sectionId={sectionId}
      ordered={arrange!.fieldsIn(sectionId)}
      fallback={fieldIds}
      className={className}
    >
      {children}
    </ArrangeableFieldGridActive>
  )
}

/**
 * Split out for the same reason as the field: `useDroppable` registers
 * with a `DndContext` that does not exist on the normal page, and calling
 * it conditionally would change hook order the moment arranging began.
 */
function ArrangeableFieldGridActive({
  sectionId, ordered, fallback, className, children,
}: {
  sectionId: string
  ordered: string[]
  fallback: string[]
  className: string
  children: ReactNode
}) {
  /*
   * The section itself is a drop target, so a field can be dropped into
   * one that is currently empty. Without this there would be nothing to
   * aim at — an empty section has no field to drop onto, so a field moved
   * out of a section could never be moved back.
   */
  const { setNodeRef, isOver } = useDroppable({ id: `${SECTION_DROP_PREFIX}${sectionId}` })

  return (
    <div
      ref={setNodeRef}
      data-arrange-section={sectionId}
      className={clsx(className, isOver && 'bg-primary-50/60 dark:bg-primary-950/30')}
    >
      <SortableContext
        items={ordered.length > 0 ? ordered : fallback}
        strategy={rectSortingStrategy}
      >
        {children}
      </SortableContext>
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

  /*
   * While arranging, every section is handed every field, so that one
   * dragged across sections can render under its new heading. This is the
   * line that puts it in exactly one of them: the draft's layout decides
   * where a field lives, and each section draws only what it holds.
   */
  if (arrange?.active && !arrange.fieldsIn(sectionId).includes(fieldId)) return null

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

  const position = arrange.fieldsIn(sectionId).indexOf(fieldId)
  const order = position < 0 ? undefined : position

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

        `pt-7` reserves the strip the chrome below sits in. The badge used
        to be drawn at `top-2` directly over the field's own header, so
        "Business Model" covered "Business Model" and the badge's span
        label ate the "Updated 7 months ago" beside it — the page you were
        arranging was partly illegible while you arranged it. Pushing the
        field down by the height of the badge is the only arrangement
        where the chrome and the header can both be read; it costs 28px
        per field, in arrange mode only.
      */}
      <div className="pointer-events-none select-none pt-7" aria-hidden="true">
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
        <span className="pointer-events-none absolute left-2 top-0.5 inline-flex max-w-[calc(100%-5rem)] items-center gap-1 rounded-md px-1.5 py-0.5">
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
        className="absolute right-2 top-0.5 z-10 rounded-md bg-white/95 p-1 text-gray-400 opacity-0 shadow-sm transition-opacity hover:text-error-600 focus-visible:opacity-100 group-hover:opacity-100 dark:bg-gray-900/95"
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
          /* Starts below the chrome strip so the grip tracks the card it
             actually resizes, not the badge above it. */
          'absolute bottom-2 top-8 right-0 z-10 w-3 cursor-col-resize touch-none rounded-r-xl',
          resizing ? 'bg-primary-500/70' : 'bg-primary-400/20 group-hover:bg-primary-400/60',
        )}
      />
    </div>
  )
}
