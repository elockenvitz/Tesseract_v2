import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, ChevronUp, Eye, EyeOff, LayoutGrid, Lock, Plus } from 'lucide-react'
import { MobileTemplateShell } from './MobileTemplateShell'
import { useResearchFields, useResearchSections } from '../../../hooks/useResearchFields'
import { useUserAssetPageLayouts } from '../../../hooks/useUserAssetPagePreferences'
import { useIsOrgAdmin } from '../../../hooks/useIsOrgAdmin'
import {
  buildDraft,
  isDraftDirty,
  moveFieldToSection,
  moveFieldWithinSection,
  serializeDraft,
  setFieldVisibility,
  type DraftSection,
} from '../../../lib/research/layout-draft'
import type { FieldConfigItem } from '../../../lib/research/layout-resolver'

/**
 * Research Layout, authored on a phone.
 *
 * ── Why this is possible at all ────────────────────────────────────────────
 *
 * The notice this replaces said the layout is "built by dragging and resizing
 * widgets on a twelve-column grid". That described the wrong artefact. The
 * twelve-column grid is `research_fields.config` — the inside of a single
 * composite field. A Research LAYOUT is
 * `user_asset_page_layouts.field_config`: a flat list of
 * `{field_id, section_id, is_visible, display_order, is_collapsed}`.
 *
 * Which fields show, under which heading, in what order. That is an ordered
 * list, and a phone edits an ordered list perfectly well — one row moving one
 * place at a time, which is a more precise gesture on a touch screen than
 * dragging ever is. So the grid is not reproduced here; it was never what
 * this screen edits.
 *
 * ── Authority ──────────────────────────────────────────────────────────────
 *
 * Two different tables, two different postures, and conflating them is how a
 * screen offers something the database refuses:
 *
 *   user_asset_page_layouts   INSERT WITH CHECK (user_id = auth.uid())
 *                             — self-scoped. Anyone may author their own.
 *   research_fields/_sections USING (organization_id = current_org_id()
 *                               AND is_active_org_admin_of_current_org())
 *                             — org admins only, for every write.
 *
 * So composing a layout out of fields you can already read is offered to
 * everyone, and creating a NEW field or section is offered to nobody here.
 * The desktop shows those buttons to everyone and swallows the 42501 in a
 * console.error, which is the behaviour this screen deliberately does not
 * copy: an affordance that fails silently is worse than no affordance.
 *
 * For an admin that is a real deferral, and it says so. For a non-admin it
 * is not a deferral at all — they cannot create a field on a desktop either —
 * so they are told the catalog is managed by an admin rather than being sent
 * to a machine where the button would fail the same way.
 */

interface Props {
  onBack: () => void
}

type Selection = { kind: 'list' } | { kind: 'edit'; layoutId: string } | { kind: 'new' }

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
// The picker
// ============================================================================

function LayoutList({
  onBack,
  onSelect,
}: {
  onBack: () => void
  onSelect: (s: Selection) => void
}) {
  const { layouts = [], isLoading } = useUserAssetPageLayouts()

  return (
    <MobileTemplateShell
      typeLabel="Research Layout"
      name="Research Layout"
      meta={isLoading ? undefined : `${layouts.length} saved`}
      onBack={onBack}
    >
      {isLoading ? (
        <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onSelect({ kind: 'new' })}
            className="no-touch-target flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-[13px] font-medium text-primary-600 dark:border-gray-600 dark:text-primary-400"
          >
            <Plus className="h-4 w-4 shrink-0" />
            New layout
          </button>

          {layouts.map((layout) => {
            // 'view' collaborators may open it but not save it, and the
            // editor below enforces that. Saying so on the row means the
            // Save button is not the first place they learn it.
            const readOnly = layout.my_permission === 'view'
            return (
              <button
                key={layout.id}
                type="button"
                onClick={() => onSelect({ kind: 'edit', layoutId: layout.id })}
                className="no-touch-target flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-left dark:border-gray-700"
              >
                <LayoutGrid className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">
                    {layout.name}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">
                    {layout.is_default && 'Default · '}
                    {(layout.field_config as FieldConfigItem[] | null)?.length ?? 0} fields
                    {layout.is_shared_with_me && ' · Shared with you'}
                    {readOnly && ' · View only'}
                  </span>
                </span>
              </button>
            )
          })}

          {layouts.length === 0 && (
            <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">
              No saved layouts yet.
            </p>
          )}
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
  const { sections, isLoading: sectionsLoading } = useResearchSections()
  const { fields, isLoading: fieldsLoading } = useResearchFields()
  const { isOrgAdmin } = useIsOrgAdmin()

  const layout = layoutId ? layouts.find((l) => l.id === layoutId) : undefined
  const readOnly = !!layout && layout.my_permission === 'view'

  const originalConfig = useMemo<FieldConfigItem[]>(
    () => ((layout?.field_config as FieldConfigItem[] | null) ?? []),
    [layout?.field_config],
  )

  const [name, setName] = useState(layout?.name ?? '')
  const [draft, setDraft] = useState<DraftSection[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const loading = sectionsLoading || fieldsLoading

  // Built once the catalog has loaded. `fields` and `sections` are already
  // RLS-filtered by the time they arrive, so the draft can only ever contain
  // things this user may read.
  const built = useMemo(() => {
    if (loading) return null
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
  }, [loading, sections, fields, originalConfig])

  const current = draft ?? built
  const dirty =
    !!current && (isDraftDirty(current, originalConfig) || name !== (layout?.name ?? ''))

  const edit = (next: DraftSection[]) => {
    if (readOnly) return
    setDraft(next)
  }

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
      if (layoutId) {
        await updateLayout.mutateAsync({ layoutId, name: name.trim(), fieldConfig })
      } else {
        await saveLayout.mutateAsync({ name: name.trim(), fieldConfig })
      }
      onBack()
    } catch (err) {
      // Shown, not consoled. A save that fails silently is how the desktop
      // loses a non-admin's work without telling them.
      setError(err instanceof Error ? err.message : 'Could not save this layout')
    } finally {
      setSaving(false)
    }
  }

  const visibleCount = current?.reduce(
    (n, s) => n + s.fields.filter((f) => f.is_visible).length,
    0,
  )

  return (
    <MobileTemplateShell
      typeLabel="Research Layout"
      name={name}
      onNameChange={readOnly ? undefined : setName}
      namePlaceholder="Untitled layout"
      meta={
        readOnly ? 'View only' : visibleCount == null ? undefined : `${visibleCount} fields shown`
      }
      onBack={onBack}
      onSave={readOnly ? undefined : handleSave}
      saveLabel={layoutId ? 'Save' : 'Create'}
      saveDisabled={!dirty || loading}
      saving={saving}
      dirty={dirty}
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

      {loading || !current ? (
        <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-4">
          {current.map((section) => (
            <SectionBlock
              key={section.section_id}
              section={section}
              allSections={current}
              readOnly={readOnly}
              onMove={(fieldId, direction) =>
                edit(moveFieldWithinSection(current, section.section_id, fieldId, direction))
              }
              onToggle={(fieldId, isVisible) =>
                edit(setFieldVisibility(current, fieldId, isVisible))
              }
              onReassign={(fieldId, toSectionId) =>
                edit(moveFieldToSection(current, fieldId, toSectionId))
              }
            />
          ))}

          <CatalogNotice isOrgAdmin={isOrgAdmin} />
        </div>
      )}
    </MobileTemplateShell>
  )
}

/**
 * Why there is no "New field" button.
 *
 * Two different sentences for two different truths. An admin genuinely can
 * create a field, just not here — that is a deferral. A non-admin cannot
 * create one anywhere, so sending them to a desktop would be a lie that costs
 * them a trip to find the same silent failure.
 */
function CatalogNotice({ isOrgAdmin }: { isOrgAdmin: boolean }) {
  return (
    <p className="flex items-start gap-1.5 border-t border-gray-200 pt-3 text-[11px] leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
      <Lock className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
      <span>
        {isOrgAdmin
          ? 'This composes existing fields. Creating new fields and sections is done on desktop.'
          : 'This composes the fields your organization has defined. New fields and sections are created by an organization admin.'}
      </span>
    </p>
  )
}

function SectionBlock({
  section,
  allSections,
  readOnly,
  onMove,
  onToggle,
  onReassign,
}: {
  section: DraftSection
  allSections: DraftSection[]
  readOnly: boolean
  onMove: (fieldId: string, direction: 'up' | 'down') => void
  onToggle: (fieldId: string, isVisible: boolean) => void
  onReassign: (fieldId: string, toSectionId: string) => void
}) {
  // Shown fields first, in their authored order, then what is available to
  // add. Mixing them would make reordering feel like it skipped rows, since
  // Move only ever steps past a sibling that is actually rendered.
  const shown = section.fields.filter((f) => f.is_visible)
  const hidden = section.fields.filter((f) => !f.is_visible)

  return (
    <section>
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {section.name}
      </h2>

      <div className="divide-y divide-gray-100 rounded-lg border border-gray-200 dark:divide-gray-800 dark:border-gray-700">
        {shown.length === 0 && hidden.length === 0 && (
          <p className="px-3 py-3 text-[12px] text-gray-400">No fields in this section.</p>
        )}

        {shown.map((field, index) => (
          <FieldRow
            key={field.field_id}
            name={field.name}
            isVisible
            readOnly={readOnly}
            canMoveUp={index > 0}
            canMoveDown={index < shown.length - 1}
            sections={allSections}
            currentSectionId={section.section_id}
            onMove={(d) => onMove(field.field_id, d)}
            onToggle={() => onToggle(field.field_id, false)}
            onReassign={(to) => onReassign(field.field_id, to)}
          />
        ))}

        {hidden.map((field) => (
          <FieldRow
            key={field.field_id}
            name={field.name}
            isVisible={false}
            readOnly={readOnly}
            canMoveUp={false}
            canMoveDown={false}
            sections={allSections}
            currentSectionId={section.section_id}
            onMove={() => {}}
            onToggle={() => onToggle(field.field_id, true)}
            onReassign={(to) => onReassign(field.field_id, to)}
          />
        ))}
      </div>
    </section>
  )
}

function FieldRow({
  name,
  isVisible,
  readOnly,
  canMoveUp,
  canMoveDown,
  sections,
  currentSectionId,
  onMove,
  onToggle,
  onReassign,
}: {
  name: string
  isVisible: boolean
  readOnly: boolean
  canMoveUp: boolean
  canMoveDown: boolean
  sections: DraftSection[]
  currentSectionId: string
  onMove: (direction: 'up' | 'down') => void
  onToggle: () => void
  onReassign: (toSectionId: string) => void
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5">
      <button
        type="button"
        onClick={onToggle}
        disabled={readOnly}
        aria-label={isVisible ? `Hide ${name}` : `Show ${name}`}
        aria-pressed={isVisible}
        className="no-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400 disabled:opacity-40"
      >
        {isVisible ? (
          <Eye className="h-4 w-4 text-primary-600 dark:text-primary-400" />
        ) : (
          <EyeOff className="h-4 w-4" />
        )}
      </button>

      <span
        className={clsx(
          'min-w-0 flex-1 truncate text-[13px]',
          isVisible
            ? 'text-gray-900 dark:text-white'
            : 'text-gray-400 dark:text-gray-500',
        )}
      >
        {name}
      </span>

      {/* Reassigning is a select rather than a drag: a phone has no room for
          two drop targets side by side, and a list of names is readable where
          a drag is guesswork. */}
      {sections.length > 1 && (
        <select
          value={currentSectionId}
          onChange={(e) => onReassign(e.target.value)}
          disabled={readOnly}
          aria-label={`Section for ${name}`}
          className="no-touch-target h-8 max-w-[7.5rem] shrink-0 rounded-md border border-gray-200 bg-transparent px-1 text-[11px] text-gray-600 disabled:opacity-40 dark:border-gray-700 dark:text-gray-300"
        >
          {sections.map((s) => (
            <option key={s.section_id} value={s.section_id}>
              {s.name}
            </option>
          ))}
        </select>
      )}

      {isVisible && (
        <span className="flex shrink-0">
          <button
            type="button"
            onClick={() => onMove('up')}
            disabled={readOnly || !canMoveUp}
            aria-label={`Move ${name} up`}
            className="no-touch-target flex h-8 w-7 items-center justify-center rounded-md text-gray-500 disabled:opacity-25 dark:text-gray-400"
          >
            <ChevronUp className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove('down')}
            disabled={readOnly || !canMoveDown}
            aria-label={`Move ${name} down`}
            className="no-touch-target flex h-8 w-7 items-center justify-center rounded-md text-gray-500 disabled:opacity-25 dark:text-gray-400"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </span>
      )}
    </div>
  )
}
