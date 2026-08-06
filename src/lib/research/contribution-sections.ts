/**
 * Maps a research template field to the contribution section that stores it.
 *
 * The asset page is template-driven: an organisation chooses which fields
 * appear and in what order, and each field's prose lives in
 * `asset_contributions` under a section key. The two vocabularies do not line
 * up — templates use hyphenated slugs, contributions use underscored section
 * names, and several slugs are aliases for one section.
 *
 * Shared rather than duplicated: this mapping used to be private to
 * InvestmentCaseBuilder, so any second reader had to restate it. Both sides
 * pass bare strings, and a wrong-but-valid key is a successful insert — an
 * edit that saves, confirms, and is never displayed again.
 */
export const SLUG_TO_SECTION: Record<string, string[]> = {
  'investment-thesis': ['thesis'],
  'thesis': ['thesis'],
  'where_different': ['where_different'],
  'where-different': ['where_different'],
  'risks_to_thesis': ['risks_to_thesis'],
  'risks-to-thesis': ['risks_to_thesis'],
  'key-risks': ['risks_to_thesis', 'risks'],
  'price_targets': ['price_target', 'price_targets'],
  'price-targets': ['price_target', 'price_targets'],
  'key_catalysts': ['catalysts', 'key_catalysts'],
  'catalysts': ['catalysts', 'key_catalysts'],
  'bull-case': ['bull_case'],
  'bull_case': ['bull_case'],
  'bear-case': ['bear_case'],
  'bear_case': ['bear_case'],
  'business_model': ['business_model'],
  'business-model': ['business_model'],
  'rating': ['rating'],
  'estimates': ['estimates'],
}

/**
 * Every section key a field's prose might be stored under, most likely first.
 *
 * Readers should try these in order. Writers must use the first, so a field
 * with aliases does not accumulate content under two different keys.
 */
export function contributionSectionsForSlug(slug: string): string[] {
  const mapped = SLUG_TO_SECTION[slug]
  if (mapped) return mapped

  // Unmapped fields — custom ones an organisation added — store their prose
  // under the slug itself, normalised to the underscore form contributions use.
  const normalized = slug.replace(/-/g, '_')
  return normalized === slug ? [slug] : [slug, normalized]
}

/** The single key a new contribution for this field must be written under. */
export function writeSectionForSlug(slug: string): string {
  return contributionSectionsForSlug(slug)[0]
}
