import { useMemo, useState } from 'react'
import { clsx } from 'clsx'
import { FileSpreadsheet, Plus, Trash2, X } from 'lucide-react'
import { MobileTemplateShell } from './MobileTemplateShell'
import {
  useModelTemplates,
  generateFieldMapping,
  METRIC_CATEGORIES,
  STATIC_PRESET_CATEGORIES,
  TIME_PERIODS,
  type DetectionRules,
  type FieldMapping,
  type MetricDefinition,
  type ModelTemplate,
  type SnapshotRange,
} from '../../../hooks/useModelTemplates'
import {
  buildSavePayload,
  emptyDraft,
  validateDraft,
  type ModelTemplateDraft,
} from '../../../lib/templates/model-template-payload'
import {
  formatCellReference,
  formatRangeReference,
  parseCellReference,
  parseRangeReference,
  sheetNamesIn,
} from '../../../lib/excel/cell-reference'

/**
 * Excel Extraction, authored on a phone.
 *
 * ── The constraint, stated honestly ────────────────────────────────────────
 *
 * The desktop builds these by loading an .xlsx and clicking cells on a
 * rendered grid. `FieldMapping.cell` is assigned ONLY from that grid — there
 * is no free-text input bound to it anywhere in the 7,000-line manager; it is
 * rendered read-only as `<code>`. So the notice this replaces was right that
 * dragging a spreadsheet needs a pointer and a wide screen.
 *
 * But the DATA does not need the file. A mapping is
 * `{field, cell, type, label}` where `cell` is one flat string — `"B5"` or
 * `"Summary!B5"`. The workbook is how the desktop AVOIDS typing a reference;
 * it is not what makes the reference valid. A phone that lets the author name
 * a sheet and a cell produces exactly the same row.
 *
 * ── Sheet qualification without a workbook ─────────────────────────────────
 *
 * The desktop's rule is `workbook.SheetNames.length > 1`: several sheets and
 * the reference is qualified, one sheet and it is bare. A phone cannot
 * evaluate that, and guessing would be how a reference silently starts
 * pointing at the wrong sheet.
 *
 * So the sheet is an explicit field: name one and the reference is qualified,
 * leave it blank and it is bare — reproducing both desktop outcomes, chosen
 * by the one person who knows which workbook this is. The sheets a template
 * already uses are offered as chips, so the common case is one tap and the
 * second mapping rarely needs typing at all.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 *
 * No auto-detection, no base-template upload, no dynamic mappings. All three
 * require a parsed workbook: detection reads cell values, the upload writes
 * an .xlsx to a bucket, and a dynamic mapping is built by pointing at a label
 * row and a header row in a live grid. A phone cannot do any of it, and an
 * editor that opened a template with dynamic mappings must not drop them —
 * so they are carried through untouched and the screen says they are there.
 */

interface Props {
  onBack: () => void
}

export function MobileModelTemplateEditor({ onBack }: Props) {
  const [editing, setEditing] = useState<{ id: string | null } | null>(null)

  if (!editing) return <TemplateList onBack={onBack} onOpen={(id) => setEditing({ id })} />

  return (
    <DraftEditor
      key={editing.id ?? 'new'}
      templateId={editing.id}
      onBack={() => setEditing(null)}
    />
  )
}

// ============================================================================
// The picker
// ============================================================================

function TemplateList({
  onBack,
  onOpen,
}: {
  onBack: () => void
  onOpen: (id: string | null) => void
}) {
  const { myTemplates = [], sharedTemplates = [], isLoading } = useModelTemplates()

  return (
    <MobileTemplateShell
      typeLabel="Excel Extraction"
      name="Excel Extraction"
      meta={isLoading ? undefined : `${myTemplates.length} saved`}
      onBack={onBack}
    >
      {isLoading ? (
        <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">Loading…</p>
      ) : (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => onOpen(null)}
            className="no-touch-target flex w-full items-center gap-2 rounded-lg border border-dashed border-gray-300 px-3 py-2.5 text-left text-[13px] font-medium text-primary-600 dark:border-gray-600 dark:text-primary-400"
          >
            <Plus className="h-4 w-4 shrink-0" />
            New template
          </button>

          {myTemplates.map((t: ModelTemplate) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onOpen(t.id)}
              className="no-touch-target flex w-full items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 text-left dark:border-gray-700"
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">
                  {t.name}
                </span>
                <span className="mt-0.5 block truncate text-[11px] text-gray-500 dark:text-gray-400">
                  {t.field_mappings?.length ?? 0} fields
                  {(t.snapshot_ranges?.length ?? 0) > 0 &&
                    ` · ${t.snapshot_ranges.length} ranges`}
                </span>
              </span>
            </button>
          ))}

          {sharedTemplates.length > 0 && (
            <>
              <h2 className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                Shared with you
              </h2>
              {sharedTemplates.map((t: ModelTemplate) => (
                // RLS is `FOR ALL USING (created_by = auth.uid())`, so an
                // update on someone else's row is rejected. Read-only here
                // rather than a save that fails after the work is done.
                <div
                  key={t.id}
                  className="flex items-center gap-2.5 rounded-lg border border-gray-200 px-3 py-2.5 dark:border-gray-700"
                >
                  <FileSpreadsheet className="h-4 w-4 shrink-0 text-gray-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] text-gray-900 dark:text-white">
                      {t.name}
                    </span>
                    <span className="mt-0.5 block text-[11px] text-gray-500 dark:text-gray-400">
                      View only
                    </span>
                  </span>
                </div>
              ))}
            </>
          )}

          {myTemplates.length === 0 && (
            <p className="py-8 text-center text-[13px] text-gray-500 dark:text-gray-400">
              No templates yet.
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

function DraftEditor({ templateId, onBack }: { templateId: string | null; onBack: () => void }) {
  const { myTemplates = [], createTemplate, updateTemplate } = useModelTemplates()
  const template = templateId
    ? myTemplates.find((t: ModelTemplate) => t.id === templateId)
    : undefined

  const [draft, setDraft] = useState<ModelTemplateDraft>(() =>
    template
      ? {
          name: template.name,
          description: template.description ?? '',
          fieldMappings: template.field_mappings ?? [],
          // Carried through untouched — a phone cannot author these, but it
          // must not drop what a desktop author built.
          dynamicMappings: template.dynamic_mappings ?? [],
          snapshotRanges: template.snapshot_ranges ?? [],
          detectionRules: template.detection_rules ?? {},
        }
      : emptyDraft(),
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [picking, setPicking] = useState(false)

  // The sheets this template already refers to. This is how the editor offers
  // sheet names without ever opening the workbook — the template records them.
  const knownSheets = useMemo(
    () =>
      sheetNamesIn([
        ...draft.fieldMappings.map((m) => m.cell),
        ...draft.snapshotRanges.map((r) => r.range),
      ]),
    [draft.fieldMappings, draft.snapshotRanges],
  )

  const update = (patch: Partial<ModelTemplateDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const handleSave = async () => {
    setError(null)
    const invalid = validateDraft(draft)
    if (invalid) {
      setError(invalid)
      return
    }

    const payload = buildSavePayload(draft)
    setSaving(true)
    try {
      if (templateId) {
        await updateTemplate.mutateAsync({ id: templateId, ...payload })
      } else {
        await createTemplate.mutateAsync(payload)
      }
      onBack()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this template')
    } finally {
      setSaving(false)
    }
  }

  return (
    <MobileTemplateShell
      typeLabel="Excel Extraction"
      name={draft.name}
      onNameChange={(name) => update({ name })}
      namePlaceholder="Untitled template"
      meta={`${draft.fieldMappings.length} fields`}
      onBack={onBack}
      onSave={handleSave}
      saveLabel={templateId ? 'Save' : 'Create'}
      saving={saving}
    >
      {error && (
        <div
          role="alert"
          className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] text-red-700 dark:bg-red-900/20 dark:text-red-300"
        >
          {error}
        </div>
      )}

      <div className="space-y-4">
        <Field label="Description">
          <input
            value={draft.description}
            onChange={(e) => update({ description: e.target.value })}
            placeholder="What this model looks like"
            className="w-full rounded-lg border border-gray-300 bg-transparent px-2.5 py-1.5 text-[13px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
          />
        </Field>

        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Field mappings
            </h2>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="no-touch-target flex items-center gap-1 text-[12px] font-medium text-primary-600 dark:text-primary-400"
            >
              <Plus className="h-3.5 w-3.5" />
              Add field
            </button>
          </div>

          {draft.fieldMappings.length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-300 px-3 py-4 text-center text-[12px] text-gray-500 dark:border-gray-600 dark:text-gray-400">
              No fields yet. A template needs at least one.
            </p>
          ) : (
            <div className="space-y-1.5">
              {draft.fieldMappings.map((mapping, index) => (
                <MappingRow
                  key={`${mapping.field}-${index}`}
                  mapping={mapping}
                  knownSheets={knownSheets}
                  onChange={(next) =>
                    update({
                      fieldMappings: draft.fieldMappings.map((m, i) => (i === index ? next : m)),
                    })
                  }
                  onRemove={() =>
                    update({
                      fieldMappings: draft.fieldMappings.filter((_, i) => i !== index),
                    })
                  }
                />
              ))}
            </div>
          )}
        </section>

        <SnapshotRangesSection
          ranges={draft.snapshotRanges}
          knownSheets={knownSheets}
          onChange={(snapshotRanges) => update({ snapshotRanges })}
        />

        <DetectionRulesSection
          rules={draft.detectionRules}
          onChange={(detectionRules) => update({ detectionRules })}
        />

        {draft.dynamicMappings.length > 0 && (
          <section className="border-t border-gray-200 pt-3 dark:border-gray-700">
            <h2 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
              Dynamic mappings
            </h2>
            <p className="text-[12px] leading-relaxed text-gray-500 dark:text-gray-400">
              {draft.dynamicMappings.length} built on desktop. They match rows by label against a
              live workbook, so they are edited there — saving here keeps them unchanged.
            </p>
          </section>
        )}

        <p className="border-t border-gray-200 pt-3 text-[11px] leading-relaxed text-gray-500 dark:border-gray-700 dark:text-gray-400">
          Auto-detection and the base workbook need the .xlsx open, so both stay on desktop.
          References typed here use the same format the grid writes.
        </p>
      </div>

      {picking && (
        <FieldPicker
          onPick={(mapping) => {
            update({ fieldMappings: [...draft.fieldMappings, mapping] })
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </MobileTemplateShell>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {children}
    </label>
  )
}

/**
 * One mapping: what it is, which sheet, which cell.
 *
 * The sheet and the cell are separate inputs even though they are stored as
 * one string, because "Summary!B5" is a format, not a thing a person types
 * comfortably on a phone — and splitting them is what makes the sheet chips
 * possible.
 */
function MappingRow({
  mapping,
  knownSheets,
  onChange,
  onRemove,
}: {
  mapping: FieldMapping
  knownSheets: string[]
  onChange: (next: FieldMapping) => void
  onRemove: () => void
}) {
  const { sheet, cell } = parseCellReference(mapping.cell)

  const setRef = (nextSheet: string | null, nextCell: string) =>
    onChange({ ...mapping, cell: formatCellReference(nextSheet, nextCell) })

  return (
    <div className="rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-700">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium text-gray-900 dark:text-white">
            {mapping.label || mapping.field}
          </span>
          <span className="block truncate text-[11px] text-gray-500 dark:text-gray-400">
            {mapping.field} · {mapping.type}
          </span>
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${mapping.label || mapping.field}`}
          className="no-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-1.5 flex gap-1.5">
        <input
          value={sheet ?? ''}
          onChange={(e) => setRef(e.target.value || null, cell)}
          placeholder="Sheet (optional)"
          aria-label={`Sheet for ${mapping.label || mapping.field}`}
          className="min-w-0 flex-1 rounded-md border border-gray-300 bg-transparent px-2 py-1 text-[12px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
        />
        <input
          value={cell}
          onChange={(e) => setRef(sheet, e.target.value)}
          placeholder="B12"
          aria-label={`Cell for ${mapping.label || mapping.field}`}
          className="w-20 shrink-0 rounded-md border border-gray-300 bg-transparent px-2 py-1 text-[12px] uppercase text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
        />
      </div>

      {knownSheets.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {knownSheets.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRef(s, cell)}
              className={clsx(
                'no-touch-target rounded px-1.5 py-0.5 text-[11px]',
                s === sheet
                  ? 'bg-primary-50 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300'
                  : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
              )}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SnapshotRangesSection({
  ranges,
  knownSheets,
  onChange,
}: {
  ranges: SnapshotRange[]
  knownSheets: string[]
  onChange: (next: SnapshotRange[]) => void
}) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Snapshot ranges
        </h2>
        <button
          type="button"
          onClick={() => onChange([...ranges, { name: '', range: '' }])}
          className="no-touch-target flex items-center gap-1 text-[12px] font-medium text-primary-600 dark:text-primary-400"
        >
          <Plus className="h-3.5 w-3.5" />
          Add range
        </button>
      </div>

      {ranges.length === 0 ? (
        <p className="text-[12px] text-gray-500 dark:text-gray-400">
          Areas captured as images. Optional.
        </p>
      ) : (
        <div className="space-y-1.5">
          {ranges.map((range, index) => {
            const parsed = parseRangeReference(range.range)
            const set = (next: SnapshotRange) =>
              onChange(ranges.map((r, i) => (i === index ? next : r)))

            return (
              <div
                key={index}
                className="rounded-lg border border-gray-200 px-2.5 py-2 dark:border-gray-700"
              >
                <div className="flex items-center gap-1.5">
                  <input
                    value={range.name}
                    onChange={(e) => set({ ...range, name: e.target.value })}
                    placeholder="Name"
                    aria-label={`Name for range ${index + 1}`}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-transparent px-2 py-1 text-[12px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
                  />
                  <button
                    type="button"
                    onClick={() => onChange(ranges.filter((_, i) => i !== index))}
                    aria-label={`Remove range ${index + 1}`}
                    className="no-touch-target flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-400"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-1.5 flex gap-1.5">
                  <input
                    value={parsed.sheet ?? ''}
                    onChange={(e) =>
                      set({
                        ...range,
                        range: formatRangeReference(e.target.value || null, parsed.start, parsed.end),
                      })
                    }
                    placeholder="Sheet"
                    aria-label={`Sheet for range ${index + 1}`}
                    className="min-w-0 flex-1 rounded-md border border-gray-300 bg-transparent px-2 py-1 text-[12px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
                  />
                  <input
                    value={parsed.start}
                    onChange={(e) =>
                      set({
                        ...range,
                        range: formatRangeReference(parsed.sheet, e.target.value, parsed.end),
                      })
                    }
                    placeholder="A1"
                    aria-label={`Start cell for range ${index + 1}`}
                    className="w-16 shrink-0 rounded-md border border-gray-300 bg-transparent px-2 py-1 text-[12px] uppercase text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
                  />
                  <input
                    value={parsed.end}
                    onChange={(e) =>
                      set({
                        ...range,
                        range: formatRangeReference(parsed.sheet, parsed.start, e.target.value),
                      })
                    }
                    placeholder="H30"
                    aria-label={`End cell for range ${index + 1}`}
                    className="w-16 shrink-0 rounded-md border border-gray-300 bg-transparent px-2 py-1 text-[12px] uppercase text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
                  />
                </div>

                {knownSheets.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {knownSheets.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() =>
                          set({ ...range, range: formatRangeReference(s, parsed.start, parsed.end) })
                        }
                        className="no-touch-target rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}

function DetectionRulesSection({
  rules,
  onChange,
}: {
  rules: DetectionRules
  onChange: (next: DetectionRules) => void
}) {
  // Stored as arrays, edited as one-per-line text — the same shape the
  // desktop's two textareas produce.
  const toLines = (v?: string[]) => (v ?? []).join('\n')
  const fromLines = (v: string) =>
    v.split('\n').map((s) => s.trim()).filter(Boolean)

  return (
    <section>
      <h2 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        Detection
      </h2>
      <p className="mb-1.5 text-[12px] text-gray-500 dark:text-gray-400">
        How a workbook is matched to this template. One per line, optional.
      </p>

      <Field label="Filename patterns">
        <textarea
          value={toLines(rules.filename_patterns)}
          onChange={(e) => onChange({ ...rules, filename_patterns: fromLines(e.target.value) })}
          rows={2}
          placeholder="*OnePager*"
          className="w-full rounded-lg border border-gray-300 bg-transparent px-2.5 py-1.5 text-[12px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
        />
      </Field>

      <Field label="Sheet names">
        <textarea
          value={toLines(rules.sheet_names)}
          onChange={(e) => onChange({ ...rules, sheet_names: fromLines(e.target.value) })}
          rows={2}
          placeholder="Summary"
          className="w-full rounded-lg border border-gray-300 bg-transparent px-2.5 py-1.5 text-[12px] text-gray-900 placeholder-gray-400 dark:border-gray-600 dark:text-white"
        />
      </Field>
    </section>
  )
}

/**
 * Pick what a cell means.
 *
 * Presets and metrics come from the same catalogs the desktop uses, and the
 * mapping skeleton from the same `generateFieldMapping`, so a phone cannot
 * invent a field name the desktop would not recognise.
 */
function FieldPicker({
  onPick,
  onClose,
}: {
  onPick: (mapping: FieldMapping) => void
  onClose: () => void
}) {
  const [metric, setMetric] = useState<MetricDefinition | null>(null)

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-white dark:bg-gray-900">
      <div className="flex shrink-0 items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
        <h2 className="text-[14px] font-semibold text-gray-900 dark:text-white">
          {metric ? `${metric.label} — pick a period` : 'Add a field'}
        </h2>
        <button
          type="button"
          onClick={metric ? () => setMetric(null) : onClose}
          aria-label={metric ? 'Back to fields' : 'Close'}
          className="no-touch-target flex h-8 w-8 items-center justify-center rounded-md text-gray-500"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {metric ? (
          <div className="space-y-1">
            {TIME_PERIODS.filter(
              (p) => !metric.periodsAllowed || metric.periodsAllowed.includes(p.periodType),
            ).map((period) => (
              <button
                key={period.id}
                type="button"
                onClick={() => onPick(generateFieldMapping(metric, period))}
                className="no-touch-target block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-[13px] text-gray-900 dark:border-gray-700 dark:text-white"
              >
                {period.shortLabel} {metric.label}
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {STATIC_PRESET_CATEGORIES.map((category) => (
              <section key={category.name}>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {category.name}
                </h3>
                <div className="space-y-1">
                  {Object.values(category.presets).map((preset) => (
                    <button
                      key={preset.field}
                      type="button"
                      onClick={() => onPick({ ...preset, cell: '' })}
                      className="no-touch-target block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-[13px] text-gray-900 dark:border-gray-700 dark:text-white"
                    >
                      {preset.label ?? preset.field}
                    </button>
                  ))}
                </div>
              </section>
            ))}

            {METRIC_CATEGORIES.map((category) => (
              <section key={category.name}>
                <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                  {category.name}
                </h3>
                <div className="space-y-1">
                  {category.metrics.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => (m.supportsPeriods ? setMetric(m) : onPick(generateFieldMapping(m)))}
                      className="no-touch-target block w-full rounded-lg border border-gray-200 px-3 py-2 text-left text-[13px] text-gray-900 dark:border-gray-700 dark:text-white"
                    >
                      {m.label}
                      {m.supportsPeriods && (
                        <span className="ml-1 text-[11px] text-gray-400">· pick a period</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
