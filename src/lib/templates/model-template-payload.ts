import type {
  DetectionRules,
  DynamicFieldMapping,
  FieldMapping,
  SnapshotRange,
} from '../../hooks/useModelTemplates'
import { isValidCellReference, isValidRangeReference } from '../excel/cell-reference'

/**
 * What a save of an Excel Extraction template contains.
 *
 * ── The desktop's actual write, not the one in the brief ───────────────────
 *
 * `ExcelModelTemplateManager` submits six arguments to `createTemplate`:
 *
 *   name, description, fieldMappings, dynamicMappings, snapshotRanges,
 *   detectionRules
 *
 * and `useModelTemplates` turns those into the row, adding `created_by` and
 * `organization_id` itself. A phone must therefore pass the same six and
 * touch neither of the two the hook owns.
 *
 * One correction worth stating plainly, because it inverts a stated
 * assumption: the desktop does NOT write `dynamic_mappings = null` on a
 * normal save. Its form seeds `dynamicMappings: []` and always passes it, and
 * the hook's `dynamic_mappings: dynamicMappings || null` never reaches the
 * null branch because `[]` is truthy. The stored value is `[]`. A phone
 * writing `null` "for parity" would be the only client producing null rows.
 * So the default here is `[]`, matching what actually lands in the column.
 *
 * `snapshot_ranges = []` and `detection_rules = {}` are correct as stated.
 *
 * ── Columns this must never touch ──────────────────────────────────────────
 *
 * `created_by` is set by the hook from the session and is what RLS checks —
 * `FOR ALL USING (created_by = auth.uid())`, with no WITH CHECK, which
 * Postgres copies from USING, so an insert naming someone else is rejected.
 * `organization_id` is written only for a firm template, which the desktop UI
 * never creates. `is_firm_template` likewise stays false: a phone quietly
 * promoting a template to org-wide would change who can read it.
 */

/** The editor state a save is built from. */
export interface ModelTemplateDraft {
  name: string
  description: string
  fieldMappings: FieldMapping[]
  dynamicMappings: DynamicFieldMapping[]
  snapshotRanges: SnapshotRange[]
  detectionRules: DetectionRules
}

/** Exactly the arguments the desktop passes to the create/update mutations. */
export interface ModelTemplateSavePayload {
  name: string
  description: string | undefined
  fieldMappings: FieldMapping[]
  dynamicMappings: DynamicFieldMapping[]
  snapshotRanges: SnapshotRange[]
  detectionRules: DetectionRules
}

export const SAVE_PAYLOAD_KEYS = [
  'name',
  'description',
  'fieldMappings',
  'dynamicMappings',
  'snapshotRanges',
  'detectionRules',
] as const

/**
 * Arguments the hook owns and a caller must never supply.
 *
 * `isFirmTemplate` is included because passing it is how a save would flip a
 * private template to org-visible — the hook reads it to decide whether to
 * stamp `organization_id`.
 */
export const HOOK_OWNED_KEYS = ['createdBy', 'organizationId', 'isFirmTemplate'] as const

/** A fresh template, seeded exactly as the desktop form seeds one. */
export function emptyDraft(): ModelTemplateDraft {
  return {
    name: '',
    description: '',
    fieldMappings: [],
    // `[]`, not null — see the header. This is what the desktop stores.
    dynamicMappings: [],
    snapshotRanges: [],
    detectionRules: {},
  }
}

export function buildSavePayload(draft: ModelTemplateDraft): ModelTemplateSavePayload {
  return {
    name: draft.name.trim(),
    // The desktop passes `description || undefined`; the hook then stores
    // `description || null`. Matching the undefined keeps both clients
    // landing on the same null in the column.
    description: draft.description.trim() || undefined,
    fieldMappings: draft.fieldMappings,
    dynamicMappings: draft.dynamicMappings,
    snapshotRanges: draft.snapshotRanges,
    detectionRules: draft.detectionRules,
  }
}

/**
 * Why this validates references and the desktop does not.
 *
 * The desktop's only gates are "name present", "at least one mapping" and
 * "every mapping has both a cell and a field" — it needs no more, because a
 * `cell` can only ever arrive by clicking a rendered grid, so it is
 * well-formed by construction. A phone has no grid and accepts typing, so
 * the same guarantee has to come from somewhere. Without it, a malformed
 * reference is discovered at extraction time against a real workbook, long
 * after the person who typed it has moved on.
 *
 * The three shared rules are kept identical so the phone never refuses a
 * template the desktop would accept, nor accepts one it would refuse.
 */
export function validateDraft(draft: ModelTemplateDraft): string | null {
  if (!draft.name.trim()) return 'Template name is required'

  if (draft.fieldMappings.length === 0) {
    return 'At least one field mapping is required'
  }

  const incomplete = draft.fieldMappings.filter((m) => !m.cell || !m.field)
  if (incomplete.length > 0) {
    return 'All field mappings must have both a cell reference and a Tesseract field'
  }

  const badCell = draft.fieldMappings.find((m) => !isValidCellReference(m.cell))
  if (badCell) {
    return `"${badCell.cell}" is not a cell reference. Use a cell like B12, or Summary!B12.`
  }

  const badRange = draft.snapshotRanges.find((r) => r.range && !isValidRangeReference(r.range))
  if (badRange) {
    return `"${badRange.range}" is not a range. Use a range like A1:H30, or Summary!A1:H30.`
  }

  const unnamedRange = draft.snapshotRanges.find((r) => r.range && !r.name.trim())
  if (unnamedRange) return 'Every snapshot range needs a name'

  return null
}
