import type {
  BrandingConfig,
  CoverPageConfig,
  HeaderFooterConfig,
  StyleConfig,
  TocConfig,
} from '../../types/investmentCaseTemplates'

/**
 * What a save of an Investment Case PDF template is allowed to contain.
 *
 * ── Why this is a module and not an object literal in a component ──────────
 *
 * The product decision for mobile here is PARITY, not new behaviour: the
 * phone must write exactly the columns the desktop writes, and must not begin
 * writing the two it omits. That is a claim about a payload, so it is worth
 * being able to test it without mounting an editor — a rendering test can
 * only prove what one path did on one interaction, while this can be asserted
 * exhaustively.
 *
 * ── The two omissions, and why they are deliberate ─────────────────────────
 *
 * The desktop editor's `handleSave` sends exactly eight keys for both create
 * and update (InvestmentCaseTemplateEditor.tsx:233-269):
 *
 *   name, description, is_shared, cover_config, style_config,
 *   branding_config, header_footer_config, toc_config
 *
 * `section_config` is absent. The desktop COMPUTES a populated one from the
 * user's research layout and feeds it to the preview, but never persists it —
 * on create the hook writes the literal `[]`, and on update the key never
 * enters the payload at all. So the column is effectively inert today.
 *
 * `is_default` is absent too. It is written only by the dedicated
 * `setDefaultTemplate` mutation behind the Manager's "Set as Default" menu
 * item, which also relies on a DB trigger to unset the previous default.
 *
 * A phone that started writing either one would not be "more complete" — it
 * would be the only client populating a column nothing reads, and the only
 * one able to silently steal the default flag during an ordinary save. Both
 * stay omitted until someone decides otherwise for BOTH clients at once.
 */

/** The editor state a save is built from. */
export interface InvestmentCaseDraft {
  name: string
  description: string
  isShared: boolean
  coverConfig: CoverPageConfig
  styleConfig: StyleConfig
  brandingConfig: BrandingConfig
  headerFooterConfig: HeaderFooterConfig
  tocConfig: TocConfig
}

/**
 * Exactly the payload the desktop sends — same keys, same order of intent.
 *
 * Typed as a closed object rather than an index signature so that adding a
 * key becomes a compile error somewhere rather than a silent new column.
 */
export interface InvestmentCaseSavePayload {
  name: string
  description: string | null
  is_shared: boolean
  cover_config: CoverPageConfig
  style_config: StyleConfig
  branding_config: BrandingConfig
  header_footer_config: HeaderFooterConfig
  toc_config: TocConfig
}

/**
 * The canonical key set, exported so a test can assert against a named
 * constant rather than a literal retyped next to the thing it checks.
 */
export const SAVE_PAYLOAD_KEYS = [
  'name',
  'description',
  'is_shared',
  'cover_config',
  'style_config',
  'branding_config',
  'header_footer_config',
  'toc_config',
] as const

/**
 * Keys a save must never carry. See the header for why each is here.
 *
 * Named rather than implied: "we don't send section_config" is a decision,
 * and a decision that lives only in the absence of a line is a decision that
 * gets undone by the next person adding a field.
 */
export const OMITTED_KEYS = ['section_config', 'is_default'] as const

export function buildSavePayload(draft: InvestmentCaseDraft): InvestmentCaseSavePayload {
  return {
    name: draft.name.trim(),
    // Matches the desktop's `description || null` — an empty box is an absent
    // description, not an empty string, so the two clients agree on the row.
    description: draft.description.trim() || null,
    is_shared: draft.isShared,
    cover_config: draft.coverConfig,
    style_config: draft.styleConfig,
    branding_config: draft.brandingConfig,
    header_footer_config: draft.headerFooterConfig,
    toc_config: draft.tocConfig,
  }
}

/** Whether a draft is savable at all. Mirrors the desktop's only check. */
export function validateDraft(draft: InvestmentCaseDraft): string | null {
  if (!draft.name.trim()) return 'Template name is required'
  return null
}
