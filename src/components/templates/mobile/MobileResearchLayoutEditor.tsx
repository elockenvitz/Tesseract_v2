import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import {
  ChevronDown,
  ChevronRight,
  ChevronUp,
  LayoutGrid,
  Lock,
  MoreHorizontal,
  Plus,
  X,
} from 'lucide-react'
import { MobileTemplateShell } from './MobileTemplateShell'
import { useResearchFields, useResearchSections } from '../../../hooks/useResearchFields'
import { useUserAssetPageLayouts } from '../../../hooks/useUserAssetPagePreferences'
import { useIsOrgAdmin } from '../../../hooks/useIsOrgAdmin'
import {
  buildSystemDefaultLayout,
  isSystemDefaultLayout,
  layoutCounts,
  resolveLayoutList,
  SYSTEM_DEFAULT_LAYOUT_ID,
} from '../../../lib/research/default-layout'
import {
  buildDraft,
  isDraftDirty,
  moveFieldToSection,
  moveVisibleField,
  sectionCounts,
  serializeDraft,
  setFieldVisibility,
  type DraftField,
  type DraftSection,
} from '../../../lib/research/layout-draft'
import type { FieldConfigItem } from '../../../lib/research/layout-resolver'

/**
 * Research Layout on a phone: Layout → Sections → Fields.
 *
 * ── Why this is not the flat list it was ───────────────────────────────────
 *
 * The first build rendered every readable field as one enormous form — 29
 * rows, each carrying a section dropdown, an eye toggle and two arrows. Every
 * control was reachable and the whole thing was unreadable: you could not
 * answer "what does this layout actually look like?" without scanning a
 * hundred controls, and the section dropdown repeated on every row implied
 * that moving a field between sections was the common action. It is not; it
 * is rare, and it was the most prominent thing on the screen.
 *
 * So the model is now the one the data already has. A layout is sections; a
 * section holds ordered fields. Sections are COLLAPSED by default and show
 * "4 shown · 6 fields", so the whole layout fits one screen and the overview
 * is the default view rather than a thing you assemble in your head.
 *
 * Underneath it is still the flat `FieldConfigItem[]`. This is an interaction
 * model, not a schema — `serializeDraft` writes exactly what the desktop
 * writes, and the round trip is pinned in layout-draft's tests.
 *
 * ── Two specific corrections ───────────────────────────────────────────────
 *
 * Visibility says "Shown" or "Hidden" in words. An eye icon inverts meaning
 * depending on state — is the open eye what IS, or what tapping DOES? — and
 * that ambiguity costs a tap to resolve every time.
 *
 * Reorder arrows appear only on shown fields, and they step to the next
 * VISIBLE neighbour. A hidden field has no position, so offering to move it
 * is offering a control that does nothing observable.
 */

interface Props {
  onBack: () => void
}

type Selection =
  | { kind: 'list' }
  | { kind: 'edit'; layoutId: string }
  | { kind: 'new' }

export function MobileResearchLayoutEditor({ onBack }: Props) {
  const [selection, setSelection] = useState<Selection>({ kind: 'list' })

  if (selection.kind === 'list') {
    return <LayoutList onBack={onBack} onSelect={setSelection} />
  }

  return (
    <LayoutDraftEditor
      key={selection.kind === 'edit' ? selection.layoutId : 'new'}
      layoutId={selection.kind === 'edit' ? selection.layoutId : null}
      onBack={() => setSelection({ kind: 'list' })}
    />
  )
}

// ============================================================================
// Shared: the catalog both screens read
// ============================================================================

/**
 * The fields and sections this user can read, plus the derived default.
 *
 * `useResearchFields` and `useResearchSections` are already RLS-filtered, so
 * the default built from them is scoped to what this person may actually
 * see — the same scoping the desktop gets, for the same reason.
 */
function useLayoutCatalog() {
  const { sections, isLoading: sectionsLoading } = useResearchSections()
  const { fields, isLoading: fieldsLoading } = useResearchFields()

  const systemDefault = useMemo(
    () =>
      buildSystemDefaultLayout(
        fields.map((f) => ({
          field_id: f.id,
          field_slug: f.slug,
          section_id: f.section_id ?? '',
        })),
      ),
    [fields],
  )

  return {
    sections,
    fields,
    systemDefault,
    isLoading: sectionsLoading || fieldsLoading,
  }
}

// ============================================================================
// The picker
// ============================================================================

function LayoutList({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (s: Selection) => void
}) {
  const { layouts = [], isLoading: layoutsLoading } = useUserAssetPageLayouts()
  const { systemDefault, isLoading: catalogLoading } = useLayoutCatalog()
  const loading = layoutsLoading || catalogLoading

  // One function decides this list on both surfaces. The derived default is
  // shown unless the user has a default of their own — see default-layout.ts.
  const visible = useMemo(
    () => (loading ? [] : resolveLayoutList(layouts, systemDefault)),
    [loading, layouts, systemDefault],
  )

  return (
    <MobileTemplateShell
      typeLabel="Research Layout"
      name="Research Layout"
      meta={loading ? undefined : `${visible.length} layouts`}
      onBack={onBack}
    >
      {loading ? (
        <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          <button
            type="button"
            onClick={() => onSelect({ kind: 'new' })}
            className="no-touch-target flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-[13px] font-medium text-primary-600 dark:border-gray-600 dark:text-primary-400"
          >
            <Plus className="h-4 w-4 shrink-0" />
            New layout
          </button>

          {visible.map((layout) => {
            const counts = layoutCounts((layout.field_config as FieldConfigItem[]) ?? [])
            const isSystem = isSystemDefaultLayout(layout)
            const shared = 'is_shared_with_me' in layout && layout.is_shared_with_me
            const readOnly = 'my_permission' in layout && layout.my_permission === 'view'

            return (
              <button
                key={layout.id}
                type="button"
                onClick={() => onSelect({ kind: 'edit', layoutId: layout.id })}
                className="no-touch-target flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-left dark:border-gray-700"
              >
                <LayoutGrid className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] font-medium text-gray-900 dark:text-white">
                      {layout.name}
                    </span>
                    {/* One badge, not two. The derived layout was carrying
                        "Default" AND "System", which read as two competing
                        statuses when it is one thing: the standard default.
                        A user's own default keeps the plain Default badge. */}
                    {isSystem ? (
                      <span className="shrink-0 rounded bg-gray-100 px-1.5 py-px text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        System default
                      </span>
                    ) : layout.is_default ? (
                      <span className="shrink-0 rounded bg-amber-50 px-1.5 py-px text-[10px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        Default
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {counts.shown} of {counts.total} fields
                    {counts.sections > 0 && ` · ${counts.sections} sections`}
                    {shared && ' · Shared with you'}
                    {readOnly && ' · View only'}
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-gray-300 dark:text-gray-600" />
              </button>
            )
          })}
        </div>
      )}
    </MobileTemplateShell>
  )
}

// ============================================================================
// The editor
// ============================================================================

function LayoutDraftEditor({ layoutId, onBack }: { layoutId: string | null; onBack: () => void }) {
  const { layouts = [], saveLayout, updateLayout } = useUserAssetPageLayouts()
  const { sections, fields, systemDefault, isLoading } = useLayoutCatalog()
  const { isOrgAdmin } = useIsOrgAdmin()

  const editingSystemDefault = layoutId === SYSTEM_DEFAULT_LAYOUT_ID
  const stored = layoutId && !editingSystemDefault
    ? layouts.find((l) => l.id === layoutId)
    : undefined
  const layout = editingSystemDefault ? systemDefault : stored

  const readOnly = !!stored && stored.my_permission === 'view'

  const originalConfig = useMemo<FieldConfigItem[]>(
    () => ((layout?.field_config as FieldConfigItem[] | null) ?? []),
    [layout?.field_config],
  )

  // Editing the derived default produces the user's OWN layout, so it opens
  // with a distinct name rather than a second thing called "Default".
  const [name, setName] = useState(
    editingSystemDefault ? 'My layout' : (layout?.name ?? ''),
  )
  const [draft, setDraft] = useState<DraftSection[] | null>(null)
  const [open, setOpen] = useState<Set<string>>(new Set())
  // Which section is in reorder mode, if any. One at a time: arrows in two
  // sections at once invite dragging a field between them, which these
  // controls cannot do.
  const [reordering, setReordering] = useState<string | null>(null)
  const [moving, setMoving] = useState<{ fieldId: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const built = useMemo(() => {
    if (isLoading) return null
    return buildDraft(
      sections.map((s) => ({ id: s.id, name: s.name, display_order: s.display_order })),
      fields.map((f) => ({
        id: f.id,
        name: f.name,
        field_type: f.field_type,
        section_id: f.section_id,
      })),
      originalConfig,
    )
  }, [isLoading, sections, fields, originalConfig])

  const current = draft ?? built

  // Saving the derived default always creates something, so it is always
  // dirty — there is no row to be unchanged relative to.
  const dirty =
    editingSystemDefault ||
    (!!current && (isDraftDirty(current, originalConfig) || name !== (layout?.name ?? '')))

  const edit = (next: DraftSection[]) => {
    if (readOnly) return
    setDraft(next)
  }

  const toggleSection = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const handleSave = async () => {
    if (!current) return
    setError(null)
    if (!name.trim()) {
      setError('Layout name is required')
      return
    }

    const fieldConfig = serializeDraft(current)
    setSaving(true)
    try {
      if (stored) {
        await updateLayout.mutateAsync({ layoutId: stored.id, name: name.trim(), fieldConfig })
      } else {
        // Covers both "New layout" and "saved the derived default". The
        // sentinel id is not a row, so an update would target nothing.
        await saveLayout.mutateAsync({ name: name.trim(), fieldConfig })
      }
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this layout')
    } finally {
      setSaving(false)
    }
  }

  const totals = current
    ? current.reduce(
        (acc, s) => {
          const c = sectionCounts(s)
          return { shown: acc.shown + c.shown, total: acc.total + c.total }
        },
        { shown: 0, total: 0 },
      )
    : null

  return (
    <MobileTemplateShell
      typeLabel="Research Layout"
      name={name}
      onNameChange={readOnly ? undefined : setName}
      namePlaceholder="Untitled layout"
      meta={readOnly ? 'View only' : totals ? `${totals.shown} of ${totals.total} shown` : undefined}
      onBack={onBack}
      onSave={readOnly ? undefined : handleSave}
      saveLabel={stored ? 'Save' : 'Create'}
      saveDisabled={!dirty || isLoading}
      saving={saving}
      dirty={dirty && !editingSystemDefault}
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {/* Said once, at the top, rather than on every save attempt. */}
      {editingSystemDefault && (
        <p className="mb-3 rounded-lg bg-gray-50 px-3 py-2 text-[12px] leading-relaxed text-gray-600 dark:bg-gray-800 dark:text-gray-300">
          This is the standard layout everyone starts from. Saving creates your own
          copy — the standard one is left as it is.
        </p>
      )}

      {isLoading || !current ? (
        <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-1.5">
          {/* Sections with no readable fields are hidden from the overview.
              They are valid and still offered in "Move to section", but a
              row reading "0 shown · 0 fields" is a line of chrome for
              something the reader cannot act on — and the catalog has
              several. Nothing is removed from the data. */}
          {current.filter((s) => s.fields.length > 0).map((section) => (
            <SectionGroup
              key={section.section_id}
              section={section}
              expanded={open.has(section.section_id)}
              onToggle={() => toggleSection(section.section_id)}
              reordering={reordering === section.section_id}
              onToggleReorder={() =>
                setReordering((r) => (r === section.section_id ? null : section.section_id))
              }
              readOnly={readOnly}
              onMove={(fieldId, direction) =>
                edit(moveVisibleField(current, section.section_id, fieldId, direction))
              }
              onSetVisible={(fieldId, isVisible) =>
                edit(setFieldVisibility(current, fieldId, isVisible))
              }
              onRequestMove={(field) => setMoving({ fieldId: field.field_id, name: field.name })}
            />
          ))}

          <CatalogNotice isOrgAdmin={isOrgAdmin} />
        </div>
      )}

      {moving && current && (
        <MoveToSectionSheet
          fieldName={moving.name}
          sections={current}
          currentSectionId={
            current.find((s) => s.fields.some((f) => f.field_id === moving.fieldId))?.section_id ?? ''
          }
          onPick={(toSectionId) => {
            edit(moveFieldToSection(current, moving.fieldId, toSectionId))
            setOpen((prev) => new Set(prev).add(toSectionId))
            setMoving(null)
          }}
          onClose={() => setMoving(null)}
        />
      )}
    </MobileTemplateShell>
  )
}

// ============================================================================
// A section
// ============================================================================

function SectionGroup({
  section,
  expanded,
  onToggle,
  reordering,
  onToggleReorder,
  readOnly,
  onMove,
  onSetVisible,
  onRequestMove,
}: {
  section: DraftSection
  expanded: boolean
  onToggle: () => void
  reordering: boolean
  onToggleReorder: () => void
  readOnly: boolean
  onMove: (fieldId: string, direction: 'up' | 'down') => void
  onSetVisible: (fieldId: string, isVisible: boolean) => void
  onRequestMove: (field: DraftField) => void
}) {
  const { shown, total } = sectionCounts(section)

  // Shown first in authored order, then what is available to add. Mixing
  // them would make Move feel like it skipped rows, because Move only ever
  // steps past a sibling that is actually rendered above or below.
  const shownFields = section.fields.filter((f) => f.is_visible)
  const hiddenFields = section.fields.filter((f) => !f.is_visible)

  return (
    <section className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="no-touch-target flex w-full items-center gap-2 px-3 py-2.5 text-left"
      >
        {expanded ? (
          <ChevronDown className="h-4 w-4 shrink-0 text-gray-400" />
        ) : (
          <ChevronRight className="h-4 w-4 shrink-0 text-gray-400" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">
            {section.name}
          </span>
          <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
            {shown} shown · {total} {total === 1 ? 'field' : 'fields'}
          </span>
        </span>
      </button>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-800">
          {/* Reorder is a MODE, not a permanent pair of arrows on every row.
              Two chevrons on all 29 rows made the list look like a queue of
              controls; reordering is also the rarest of the three things
              done here. Entering the mode surfaces the same touch-safe
              move-up/down behaviour, unchanged. */}
          {!readOnly && shownFields.length > 1 && (
            <div className="flex items-center justify-between border-b border-gray-100 px-3 py-1.5 dark:border-gray-800">
              <span className="text-[11px] text-gray-500 dark:text-gray-400">
                {reordering ? 'Move fields with the arrows' : `${shown} shown`}
              </span>
              <button
                type="button"
                onClick={onToggleReorder}
                aria-pressed={reordering}
                className={clsx(
                  'no-touch-target tap-pad rounded px-1.5 py-0.5 text-[11px] font-medium',
                  reordering
                    ? 'bg-primary-600 text-white'
                    : 'text-primary-600 dark:text-primary-400',
                )}
              >
                {reordering ? 'Done' : 'Reorder'}
              </button>
            </div>
          )}

          {shownFields.map((field, index) => (
            <FieldRow
              key={field.field_id}
              field={field}
              readOnly={readOnly}
              reordering={reordering}
              canMoveUp={index > 0}
              canMoveDown={index < shownFields.length - 1}
              onMove={(d) => onMove(field.field_id, d)}
              onSetVisible={(v) => onSetVisible(field.field_id, v)}
              onRequestMove={() => onRequestMove(field)}
            />
          ))}

          {hiddenFields.length > 0 && (
            <p className="border-t border-gray-100 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:border-gray-800">
              Not shown
            </p>
          )}
          {hiddenFields.map((field) => (
            <FieldRow
              key={field.field_id}
              field={field}
              readOnly={readOnly}
              reordering={false}
              canMoveUp={false}
              canMoveDown={false}
              onMove={() => {}}
              onSetVisible={(v) => onSetVisible(field.field_id, v)}
              onRequestMove={() => onRequestMove(field)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

function FieldRow({
  field,
  readOnly,
  reordering,
  canMoveUp,
  canMoveDown,
  onMove,
  onSetVisible,
  onRequestMove,
}: {
  field: DraftField
  readOnly: boolean
  reordering: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  onMove: (direction: 'up' | 'down') => void
  onSetVisible: (isVisible: boolean) => void
  onRequestMove: () => void
}) {
  return (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <span className="min-w-0 flex-1">
        <span
          className={clsx(
            'block truncate text-[13px]',
            field.is_visible
              ? 'text-gray-900 dark:text-white'
              : 'text-gray-400 dark:text-gray-500',
          )}
        >
          {field.name}
        </span>
      </span>

      {/* The word, not an eye. An open eye is ambiguous between what IS and
          what tapping WOULD DO, and the reader pays a tap to find out. */}
      <button
        type="button"
        onClick={() => onSetVisible(!field.is_visible)}
        disabled={readOnly}
        aria-pressed={field.is_visible}
        aria-label={field.is_visible ? `Hide ${field.name}` : `Show ${field.name}`}
        className={clsx(
          'no-touch-target tap-pad shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium disabled:opacity-40',
          field.is_visible
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
            : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
        )}
      >
        {field.is_visible ? 'Shown' : 'Hidden'}
      </button>

      {/* Arrows exist only in reorder mode, and only on a shown field — a
          hidden field has no position to change. Outside the mode the row
          carries its name, its state and one overflow, which is what the
          reader is usually here to read rather than to operate. */}
      {reordering && field.is_visible ? (
        <span className="flex shrink-0">
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={readOnly || !canMoveUp}
            aria-label={`Move ${field.name} up`}
            className="no-touch-target flex h-7 w-7 items-center justify-center rounded text-gray-500 disabled:opacity-20 dark:text-gray-400"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={readOnly || !canMoveDown}
            aria-label={`Move ${field.name} down`}
            className="no-touch-target flex h-7 w-7 items-center justify-center rounded text-gray-500 disabled:opacity-20 dark:text-gray-400"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={onRequestMove}
          disabled={readOnly}
          aria-label={`More actions for ${field.name}`}
          className="no-touch-target flex h-7 w-6 shrink-0 items-center justify-center rounded text-gray-400 disabled:opacity-20"
        >
          <MoreHorizontal className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )
}

/**
 * Moving a field to another section — secondary, on purpose.
 *
 * It was a `<select>` on every single row, which made the rarest action the
 * most prominent control in the editor and cost every row 7rem of width.
 */
function MoveToSectionSheet({
  fieldName,
  sections,
  currentSectionId,
  onPick,
  onClose,
}: {
  fieldName: string
  sections: DraftSection[]
  currentSectionId: string
  onPick: (sectionId: string) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-black/40" onClick={onClose}>
      <div
        className="max-h-[70%] overflow-y-auto rounded-t-2xl bg-white pb-safe dark:bg-gray-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2.5 dark:border-gray-700">
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">
              Move to section
            </span>
            <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
              {fieldName}
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="no-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-500"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-2">
          {sections.map((s) => (
            <button
              key={s.section_id}
              type="button"
              onClick={() => onPick(s.section_id)}
              disabled={s.section_id === currentSectionId}
              className={clsx(
                'no-touch-target block w-full rounded-lg px-3 py-2 text-left text-[13px]',
                s.section_id === currentSectionId
                  ? 'text-gray-400 dark:text-gray-600'
                  : 'text-gray-900 dark:text-white',
              )}
            >
              {s.name}
              {s.section_id === currentSectionId && (
                <span className="ml-1.5 text-[11px]">· current</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

/**
 * Why there is no "New field" button.
 *
 * `research_fields` and `research_sections` gate every write on
 * `is_active_org_admin_of_current_org()`. The desktop shows those buttons to
 * everyone and swallows the 42501 in a console.error; this does not copy
 * that. For an admin it is a real deferral to desktop. For a non-admin it is
 * not a deferral at all — they cannot create one there either — so they are
 * told who can, rather than sent somewhere to meet the same silent failure.
 */
function CatalogNotice({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  return (
    <p className="flex items-start gap-1.5 px-1 pt-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">
      <Lock className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {isOrgAdmin
          ? 'Composes existing fields. New fields and sections are created on desktop.'
          : 'Composes the fields your organization has defined. New fields and sections are created by an organization admin.'}
      </span>
    </p>
  )
}
