/**
 * Trade Lab Sizing Parser
 *
 * Implements v3 spec Patch #4: Explicit active weight syntax using @t (target) and @d (delta).
 *
 * Syntax:
 * - Weight: 2.5, +0.5, -0.25 (percentage of portfolio)
 * - Shares: #500, #+100, #-50 (share count)
 * - Active Target: @t0.5, @t-0.5, @t0 (target active weight vs benchmark)
 * - Active Delta: @d0.5, @d+0.5, @d-0.5 (change in active weight)
 */

// =============================================================================
// TYPES
// =============================================================================

export type SizingFramework =
  | 'weight_target'
  | 'weight_delta'
  | 'active_target'
  | 'active_delta'
  | 'shares_target'
  | 'shares_delta'

export interface SizingSpec {
  raw_input: string
  framework: SizingFramework
  value: number
  input_sign: '+' | '-' | null
}

export interface ParseResult {
  framework?: SizingFramework
  value?: number
  input_sign?: '+' | '-' | null
  is_valid: boolean
  error?: string
}

export interface SizingContext {
  has_benchmark: boolean
}

// =============================================================================
// REGEX PATTERNS (Strict - no permissive cleanup)
// =============================================================================

/** Matches unsigned percentage: "2", "2.5", ".5", "0.5" */
const PCT_CORE = /^(?:\d+|\d*\.\d+)$/

/** Matches signed percentage: "+2", "-.5", "-0.25" - captures sign and value */
const PCT_SIGNED = /^([+-])(\d+|\d*\.\d+)$/

/** Matches unsigned integer: "500", "0" */
const SHARES_CORE = /^\d+$/

/** Matches signed integer: "+500", "-100" - captures sign and value */
const SHARES_SIGNED = /^([+-])(\d+)$/

// =============================================================================
// MAIN PARSER
// =============================================================================

/**
 * Parse sizing input string into a structured result.
 *
 * @param input - Raw user input string
 * @param context - Parsing context (e.g., benchmark availability)
 * @returns ParseResult with framework, value, input_sign, and validity
 */
export function parseSizingInput(input: string, context: SizingContext): ParseResult {
  const trimmed = input.trim()

  if (!trimmed) {
    return { is_valid: false, error: 'Sizing required' }
  }

  // SHARES SYNTAX: # prefix
  if (trimmed.startsWith('#')) {
    if (trimmed.includes('@')) {
      return { is_valid: false, error: 'Cannot mix # and @ syntax' }
    }
    return parseSharesSizing(trimmed.slice(1))
  }

  // ACTIVE WEIGHT SYNTAX: @ prefix
  if (trimmed.startsWith('@')) {
    if (trimmed.includes('#')) {
      return { is_valid: false, error: 'Cannot mix @ and # syntax' }
    }
    if (!context.has_benchmark) {
      return { is_valid: false, error: 'No benchmark configured for active weight sizing' }
    }
    // Pass everything after @ to active weight parser
    return parseActiveWeightSizing(trimmed.slice(1))
  }

  // WEIGHT SYNTAX: no prefix (default)
  if (trimmed.includes('#') || trimmed.includes('@')) {
    return { is_valid: false, error: 'Use # or @ at start of input' }
  }
  return parseWeightSizing(trimmed)
}

// =============================================================================
// SHARES PARSER
// =============================================================================

/**
 * Parse shares sizing input (after # prefix is stripped).
 * Shares must be whole numbers - no decimals allowed.
 */
function parseSharesSizing(input: string): ParseResult {
  const trimmed = input.trim()

  // Check for decimal (not allowed in shares)
  if (trimmed.includes('.')) {
    return { is_valid: false, error: 'Shares must be whole numbers (no decimals)' }
  }

  // Try signed pattern first (delta): #+500, #-100
  const signedMatch = trimmed.match(SHARES_SIGNED)
  if (signedMatch) {
    const sign = signedMatch[1] as '+' | '-'
    const absValue = parseInt(signedMatch[2], 10)
    return {
      framework: 'shares_delta',
      value: sign === '-' ? -absValue : absValue,
      input_sign: sign,
      is_valid: true
    }
  }

  // Try unsigned pattern (target): #500
  if (SHARES_CORE.test(trimmed)) {
    const value = parseInt(trimmed, 10)
    return {
      framework: 'shares_target',
      value: value,
      input_sign: null,
      is_valid: true
    }
  }

  return { is_valid: false, error: 'Invalid share count. Use #500, #+100, or #-50' }
}

// =============================================================================
// WEIGHT PARSER
// =============================================================================

/**
 * Parse weight sizing input (no prefix).
 * Supports absolute targets and signed deltas.
 */
function parseWeightSizing(input: string): ParseResult {
  // Strip % if present
  const trimmed = input.replace(/%/g, '').trim()

  // Try signed pattern (delta): +0.5, -0.25
  const signedMatch = trimmed.match(PCT_SIGNED)
  if (signedMatch) {
    const sign = signedMatch[1] as '+' | '-'
    const absValue = parseFloat(signedMatch[2])

    if (isNaN(absValue)) {
      return { is_valid: false, error: 'Invalid percentage' }
    }

    return {
      framework: 'weight_delta',
      value: sign === '-' ? -absValue : absValue,
      input_sign: sign,
      is_valid: true
    }
  }

  // Try unsigned pattern (target): 2.5, .5, 0
  if (PCT_CORE.test(trimmed)) {
    const value = parseFloat(trimmed)

    if (isNaN(value)) {
      return { is_valid: false, error: 'Invalid percentage' }
    }

    if (value < 0) {
      return { is_valid: false, error: 'Weight target must be >= 0. Use -X for delta.' }
    }

    if (value > 100) {
      return { is_valid: false, error: 'Weight target cannot exceed 100%' }
    }

    return {
      framework: 'weight_target',
      value: value,
      input_sign: null,
      is_valid: true
    }
  }

  return { is_valid: false, error: 'Invalid weight. Use 2.5, +0.5, or -0.25' }
}

// =============================================================================
// ACTIVE WEIGHT PARSER
// =============================================================================

/**
 * Parse active weight sizing (after @ prefix is stripped).
 *
 * EXPLICIT PREFIX SYNTAX (Patch #4):
 * - @t = Target active weight (signed value allowed)
 * - @d = Delta active weight (change from current)
 *
 * Old syntax (@0.5, @-0.5, @+0.5) is REJECTED with instructional error.
 */
function parseActiveWeightSizing(input: string): ParseResult {
  // Strip % if present, normalize to lowercase for case-insensitive matching
  const trimmed = input.replace(/%/g, '').trim().toLowerCase()

  // TARGET: @t prefix
  if (trimmed.startsWith('t')) {
    return parseActiveTarget(trimmed.slice(1))
  }

  // DELTA: @d prefix
  if (trimmed.startsWith('d')) {
    return parseActiveDelta(trimmed.slice(1))
  }

  // Old syntax or invalid - provide instructional error
  return {
    is_valid: false,
    error: 'Use @t for target (e.g., @t0.5, @t-0.5) or @d for delta (e.g., @d+0.5, @d-0.25)'
  }
}

/**
 * Parse active_target: @t followed by signed or unsigned number.
 *
 * Examples:
 * - @t0.5  → active_target = +0.5 (overweight)
 * - @t-0.5 → active_target = -0.5 (underweight)
 * - @t0    → active_target = 0 (neutral)
 *
 * input_sign is ALWAYS null for active_target.
 */
function parseActiveTarget(input: string): ParseResult {
  const trimmed = input.trim()

  // Empty after prefix
  if (!trimmed) {
    return { is_valid: false, error: 'Missing value after @t' }
  }

  // Try signed pattern first: @t+0.5 or @t-0.5
  const signedMatch = trimmed.match(PCT_SIGNED)
  if (signedMatch) {
    const sign = signedMatch[1]
    const absValue = parseFloat(signedMatch[2])

    if (isNaN(absValue)) {
      return { is_valid: false, error: 'Invalid number in active target' }
    }

    const value = sign === '-' ? -absValue : absValue

    return {
      framework: 'active_target',
      value: value,
      input_sign: null,  // ALWAYS null for active_target
      is_valid: true
    }
  }

  // Try unsigned pattern: @t0.5, @t0, @t.5
  if (PCT_CORE.test(trimmed)) {
    const value = parseFloat(trimmed)

    if (isNaN(value)) {
      return { is_valid: false, error: 'Invalid number in active target' }
    }

    return {
      framework: 'active_target',
      value: value,  // Positive or zero
      input_sign: null,  // ALWAYS null for active_target
      is_valid: true
    }
  }

  // Invalid format
  return { is_valid: false, error: 'Invalid active target. Use @t0.5 or @t-0.5' }
}

/**
 * Parse active_delta: @d followed by signed or unsigned number.
 *
 * Examples:
 * - @d0.5  → active_delta = +0.5 (increase, input_sign = null)
 * - @d+0.5 → active_delta = +0.5 (increase, input_sign = '+')
 * - @d-0.5 → active_delta = -0.5 (decrease, input_sign = '-')
 *
 * input_sign is PRESERVED exactly as typed.
 */
function parseActiveDelta(input: string): ParseResult {
  const trimmed = input.trim()

  // Empty after prefix
  if (!trimmed) {
    return { is_valid: false, error: 'Missing value after @d' }
  }

  // Try signed pattern first: @d+0.5 or @d-0.5
  const signedMatch = trimmed.match(PCT_SIGNED)
  if (signedMatch) {
    const sign = signedMatch[1] as '+' | '-'
    const absValue = parseFloat(signedMatch[2])

    if (isNaN(absValue)) {
      return { is_valid: false, error: 'Invalid number in active delta' }
    }

    const value = sign === '-' ? -absValue : absValue

    return {
      framework: 'active_delta',
      value: value,
      input_sign: sign,  // PRESERVE as typed
      is_valid: true
    }
  }

  // Try unsigned pattern: @d0.5, @d0, @d.5 (treated as positive)
  if (PCT_CORE.test(trimmed)) {
    const value = parseFloat(trimmed)

    if (isNaN(value)) {
      return { is_valid: false, error: 'Invalid number in active delta' }
    }

    return {
      framework: 'active_delta',
      value: value,  // Positive (no explicit sign)
      input_sign: null,  // No sign was typed
      is_valid: true
    }
  }

  // Invalid format
  return { is_valid: false, error: 'Invalid active delta. Use @d+0.5 or @d-0.25' }
}

// =============================================================================
// DISPLAY FORMATTING
// =============================================================================

/**
 * Format a SizingSpec for canonical display.
 *
 * Output is always normalized:
 * - active_target → @t+0.5%, @t-0.5%, @t0%
 * - active_delta  → @d+0.5%, @d-0.25%
 * - weight_target → 2.5%
 * - weight_delta  → +0.5%, -0.25%
 * - shares_target → #500
 * - shares_delta  → #+100, #-50
 */
export function formatSizingDisplay(sizing: SizingSpec): string {
  switch (sizing.framework) {
    case 'weight_target':
      return `${sizing.value}%`

    case 'weight_delta':
      return `${formatSignedDelta(sizing.value, sizing.input_sign)}%`

    case 'active_target':
      return `@t${formatActiveTargetValue(sizing.value)}%`

    case 'active_delta':
      return `@d${formatSignedDelta(sizing.value, sizing.input_sign)}%`

    case 'shares_target':
      return `#${sizing.value}`

    case 'shares_delta':
      return `#${formatSignedDelta(sizing.value, sizing.input_sign)}`
  }
}

/**
 * Format active_target value with sign for clarity.
 *
 * @t+1.0% = target 1% overweight
 * @t-0.5% = target 0.5% underweight
 * @t0%    = target benchmark weight (neutral)
 */
function formatActiveTargetValue(value: number): string {
  if (value > 0) {
    return `+${value}`
  }
  if (value < 0) {
    return `${value}`  // Negative sign is part of the number
  }
  return '0'
}

/**
 * Format signed delta value for display.
 *
 * - value > 0: show "+"
 * - value < 0: show "-" (implicit in number)
 * - value === 0: show "+" only if input_sign was explicitly '+'
 */
function formatSignedDelta(value: number, inputSign: '+' | '-' | null): string {
  if (value > 0) {
    return `+${value}`
  }
  if (value < 0) {
    return `${value}`  // Negative sign is part of the number
  }
  // value === 0
  if (inputSign === '+') {
    return '+0'
  }
  return '0'
}

// =============================================================================
// UTILITY: Create SizingSpec from ParseResult
// =============================================================================

/**
 * Convert a valid ParseResult to a SizingSpec.
 * Only call this if parseResult.is_valid is true.
 */
export function toSizingSpec(rawInput: string, parseResult: ParseResult): SizingSpec | null {
  if (!parseResult.is_valid || !parseResult.framework || parseResult.value === undefined) {
    return null
  }

  return {
    raw_input: rawInput,
    framework: parseResult.framework,
    value: parseResult.value,
    input_sign: parseResult.input_sign ?? null
  }
}
