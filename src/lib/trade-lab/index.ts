/**
 * Trade Lab Module
 *
 * Exports for Trade Lab sizing parser, normalization, and utilities.
 */

// Sizing parser
export {
  parseSizingInput,
  formatSizingDisplay,
  toSizingSpec,
  type SizingSpec,
  type SizingFramework,
  type ParseResult,
  type SizingContext
} from './sizing-parser'

// Sizing normalization
export {
  normalizeSizing,
  normalizeSizingBatch,
  detectDirectionConflict,
  applyLotRounding,
  hasAnyConflicts,
  hasAnyBelowLotWarnings,
  getNormalizationSummary,
  type NormalizationContext,
  type CurrentPosition,
  type BatchNormalizationInput,
  type BatchNormalizationResult,
} from './normalize-sizing'
