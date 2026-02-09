/**
 * Trade Lab Sizing Parser - Unit Tests
 *
 * Tests for v3 spec Patch #4: Explicit active weight syntax.
 */

import { describe, it, expect } from 'vitest'
import {
  parseSizingInput,
  formatSizingDisplay,
  toSizingSpec,
  type SizingSpec,
  type SizingContext,
  type ParseResult
} from './sizing-parser'

// Floating-point tolerance for value comparisons
const EPSILON = 1e-12

function expectClose(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined()
  expect(Math.abs((actual as number) - expected)).toBeLessThan(EPSILON)
}

// =============================================================================
// ACTIVE TARGET (@t) TESTS
// =============================================================================

describe('Active Target (@t) Parsing', () => {
  const context: SizingContext = { has_benchmark: true }

  describe('Valid inputs', () => {
    it('parses @t0.5 as positive overweight target', () => {
      const result = parseSizingInput('@t0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t1 as positive overweight target', () => {
      const result = parseSizingInput('@t1', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 1)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t.5 as 0.5', () => {
      const result = parseSizingInput('@t.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t0 as neutral (benchmark weight)', () => {
      const result = parseSizingInput('@t0', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 0)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t+0.5 as positive target (input_sign still null)', () => {
      const result = parseSizingInput('@t+0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBeNull()  // ALWAYS null for active_target
    })

    it('parses @t+1.25 as positive target', () => {
      const result = parseSizingInput('@t+1.25', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 1.25)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t-0.5 as negative underweight target', () => {
      const result = parseSizingInput('@t-0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, -0.5)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t-1.25 as negative underweight target', () => {
      const result = parseSizingInput('@t-1.25', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, -1.25)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t-.5 as -0.5', () => {
      const result = parseSizingInput('@t-.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, -0.5)
      expect(result.input_sign).toBeNull()
    })

    it('parses @t0.5% with percent symbol', () => {
      const result = parseSizingInput('@t0.5%', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 0.5)
    })
  })

  describe('Case insensitivity', () => {
    it('parses @T0.5 (uppercase T)', () => {
      const result = parseSizingInput('@T0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, 0.5)
    })

    it('parses @T-0.5 (uppercase T, negative)', () => {
      const result = parseSizingInput('@T-0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_target')
      expectClose(result.value, -0.5)
    })
  })
})

// =============================================================================
// ACTIVE DELTA (@d) TESTS
// =============================================================================

describe('Active Delta (@d) Parsing', () => {
  const context: SizingContext = { has_benchmark: true }

  describe('Valid inputs', () => {
    it('parses @d0.5 as positive delta (no input_sign)', () => {
      const result = parseSizingInput('@d0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBeNull()
    })

    it('parses @d1 as positive delta', () => {
      const result = parseSizingInput('@d1', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 1)
      expect(result.input_sign).toBeNull()
    })

    it('parses @d.5 as 0.5', () => {
      const result = parseSizingInput('@d.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBeNull()
    })

    it('parses @d0 as zero delta (no input_sign)', () => {
      const result = parseSizingInput('@d0', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0)
      expect(result.input_sign).toBeNull()
    })

    it('parses @d+0.5 with preserved input_sign', () => {
      const result = parseSizingInput('@d+0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBe('+')  // PRESERVED
    })

    it('parses @d+0 with preserved input_sign', () => {
      const result = parseSizingInput('@d+0', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0)
      expect(result.input_sign).toBe('+')  // PRESERVED
    })

    it('parses @d+.5 with preserved input_sign', () => {
      const result = parseSizingInput('@d+.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBe('+')
    })

    it('parses @d-0.5 with preserved input_sign', () => {
      const result = parseSizingInput('@d-0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, -0.5)
      expect(result.input_sign).toBe('-')  // PRESERVED
    })

    it('parses @d-0.25 with preserved input_sign', () => {
      const result = parseSizingInput('@d-0.25', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, -0.25)
      expect(result.input_sign).toBe('-')
    })

    it('parses @d-.5 with preserved input_sign', () => {
      const result = parseSizingInput('@d-.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, -0.5)
      expect(result.input_sign).toBe('-')
    })

    it('parses @d+0.5% with percent symbol', () => {
      const result = parseSizingInput('@d+0.5%', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBe('+')
    })
  })

  describe('Case insensitivity', () => {
    it('parses @D+0.5 (uppercase D)', () => {
      const result = parseSizingInput('@D+0.5', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 0.5)
      expect(result.input_sign).toBe('+')
    })

    it('parses @D-0.25 (uppercase D)', () => {
      const result = parseSizingInput('@D-0.25', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, -0.25)
      expect(result.input_sign).toBe('-')
    })

    it('parses @D1 (uppercase D, no sign)', () => {
      const result = parseSizingInput('@D1', context)
      expect(result.is_valid).toBe(true)
      expect(result.framework).toBe('active_delta')
      expectClose(result.value, 1)
      expect(result.input_sign).toBeNull()
    })
  })
})

// =============================================================================
// MISSING BENCHMARK REJECTION
// =============================================================================

describe('Missing Benchmark Rejection', () => {
  const contextNoBenchmark: SizingContext = { has_benchmark: false }

  it('rejects @t0.5 without benchmark', () => {
    const result = parseSizingInput('@t0.5', contextNoBenchmark)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/benchmark/i)
  })

  it('rejects @t-0.5 without benchmark', () => {
    const result = parseSizingInput('@t-0.5', contextNoBenchmark)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/benchmark/i)
  })

  it('rejects @d+0.5 without benchmark', () => {
    const result = parseSizingInput('@d+0.5', contextNoBenchmark)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/benchmark/i)
  })

  it('rejects @d-0.25 without benchmark', () => {
    const result = parseSizingInput('@d-0.25', contextNoBenchmark)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/benchmark/i)
  })
})

// =============================================================================
// OLD SYNTAX REJECTION
// =============================================================================

describe('Old Syntax Rejection (Instructional Error)', () => {
  const context: SizingContext = { has_benchmark: true }
  const expectedErrorPattern = /Use @t for target.*@d for delta/i

  it('rejects @0.5 with instructional error', () => {
    const result = parseSizingInput('@0.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(expectedErrorPattern)
  })

  it('rejects @-0.5 with instructional error', () => {
    const result = parseSizingInput('@-0.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(expectedErrorPattern)
  })

  it('rejects @+0.5 with instructional error', () => {
    const result = parseSizingInput('@+0.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(expectedErrorPattern)
  })

  it('rejects @1 with instructional error', () => {
    const result = parseSizingInput('@1', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(expectedErrorPattern)
  })

  it('rejects @.5 with instructional error', () => {
    const result = parseSizingInput('@.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(expectedErrorPattern)
  })

  it('rejects @ alone with instructional error', () => {
    const result = parseSizingInput('@', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(expectedErrorPattern)
  })
})

// =============================================================================
// INVALID FORMAT REJECTION
// =============================================================================

describe('Invalid Format Rejection', () => {
  const context: SizingContext = { has_benchmark: true }

  it('rejects @t with no value', () => {
    const result = parseSizingInput('@t', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/missing value/i)
  })

  it('rejects @d with no value', () => {
    const result = parseSizingInput('@d', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/missing value/i)
  })

  it('rejects @t with whitespace only', () => {
    const result = parseSizingInput('@t   ', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/missing value/i)
  })

  it('rejects @tx (non-numeric)', () => {
    const result = parseSizingInput('@tx', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('rejects @dabc (non-numeric)', () => {
    const result = parseSizingInput('@dabc', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('rejects @t1.2.3 (multiple decimals)', () => {
    const result = parseSizingInput('@t1.2.3', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('rejects @d1.2.3 (multiple decimals)', () => {
    const result = parseSizingInput('@d1.2.3', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('rejects @t++0.5 (multiple signs)', () => {
    const result = parseSizingInput('@t++0.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })

  it('rejects @d--0.5 (multiple signs)', () => {
    const result = parseSizingInput('@d--0.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/invalid/i)
  })
})

// =============================================================================
// WEIGHT PARSING (unchanged behavior)
// =============================================================================

describe('Weight Parsing', () => {
  const context: SizingContext = { has_benchmark: true }

  it('parses 2.5 as weight_target', () => {
    const result = parseSizingInput('2.5', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('weight_target')
    expectClose(result.value, 2.5)
    expect(result.input_sign).toBeNull()
  })

  it('parses .5 as weight_target', () => {
    const result = parseSizingInput('.5', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('weight_target')
    expectClose(result.value, 0.5)
    expect(result.input_sign).toBeNull()
  })

  it('parses +0.5 as weight_delta with input_sign', () => {
    const result = parseSizingInput('+0.5', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('weight_delta')
    expectClose(result.value, 0.5)
    expect(result.input_sign).toBe('+')
  })

  it('parses -0.25 as weight_delta with input_sign', () => {
    const result = parseSizingInput('-0.25', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('weight_delta')
    expectClose(result.value, -0.25)
    expect(result.input_sign).toBe('-')
  })

  it('parses 2.5% with percent symbol', () => {
    const result = parseSizingInput('2.5%', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('weight_target')
    expectClose(result.value, 2.5)
  })

  it('rejects weight target > 100', () => {
    const result = parseSizingInput('101', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/exceed 100/i)
  })
})

// =============================================================================
// SHARES PARSING (unchanged behavior)
// =============================================================================

describe('Shares Parsing', () => {
  const context: SizingContext = { has_benchmark: true }

  it('parses #500 as shares_target', () => {
    const result = parseSizingInput('#500', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('shares_target')
    expect(result.value).toBe(500)
    expect(result.input_sign).toBeNull()
  })

  it('parses #0 as shares_target', () => {
    const result = parseSizingInput('#0', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('shares_target')
    expect(result.value).toBe(0)
    expect(result.input_sign).toBeNull()
  })

  it('parses #+100 as shares_delta with input_sign', () => {
    const result = parseSizingInput('#+100', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('shares_delta')
    expect(result.value).toBe(100)
    expect(result.input_sign).toBe('+')
  })

  it('parses #-50 as shares_delta with input_sign', () => {
    const result = parseSizingInput('#-50', context)
    expect(result.is_valid).toBe(true)
    expect(result.framework).toBe('shares_delta')
    expect(result.value).toBe(-50)
    expect(result.input_sign).toBe('-')
  })

  it('rejects #1.5 (decimals not allowed)', () => {
    const result = parseSizingInput('#1.5', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/whole numbers/i)
  })

  it('rejects #++5 (multiple signs)', () => {
    const result = parseSizingInput('#++5', context)
    expect(result.is_valid).toBe(false)
  })
})

// =============================================================================
// MIXED SYNTAX REJECTION
// =============================================================================

describe('Mixed Syntax Rejection', () => {
  const context: SizingContext = { has_benchmark: true }

  it('rejects #@500', () => {
    const result = parseSizingInput('#@500', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/mix/i)
  })

  it('rejects @#500', () => {
    const result = parseSizingInput('@#500', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/mix/i)
  })

  it('rejects @t#500', () => {
    const result = parseSizingInput('@t#500', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/mix/i)
  })
})

// =============================================================================
// EMPTY INPUT
// =============================================================================

describe('Empty Input', () => {
  const context: SizingContext = { has_benchmark: true }

  it('rejects empty string', () => {
    const result = parseSizingInput('', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/required/i)
  })

  it('rejects whitespace only', () => {
    const result = parseSizingInput('   ', context)
    expect(result.is_valid).toBe(false)
    expect(result.error).toMatch(/required/i)
  })
})

// =============================================================================
// DISPLAY FORMATTING
// =============================================================================

describe('formatSizingDisplay', () => {
  describe('Active Target Display', () => {
    it('formats positive active_target as @t+X%', () => {
      const sizing: SizingSpec = {
        raw_input: '@t0.5',
        framework: 'active_target',
        value: 0.5,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('@t+0.5%')
    })

    it('formats larger positive active_target as @t+X%', () => {
      const sizing: SizingSpec = {
        raw_input: '@t+1.25',
        framework: 'active_target',
        value: 1.25,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('@t+1.25%')
    })

    it('formats negative active_target as @t-X%', () => {
      const sizing: SizingSpec = {
        raw_input: '@t-0.5',
        framework: 'active_target',
        value: -0.5,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('@t-0.5%')
    })

    it('formats zero active_target as @t0%', () => {
      const sizing: SizingSpec = {
        raw_input: '@t0',
        framework: 'active_target',
        value: 0,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('@t0%')
    })
  })

  describe('Active Delta Display', () => {
    it('formats positive active_delta with + as @d+X%', () => {
      const sizing: SizingSpec = {
        raw_input: '@d+0.5',
        framework: 'active_delta',
        value: 0.5,
        input_sign: '+'
      }
      expect(formatSizingDisplay(sizing)).toBe('@d+0.5%')
    })

    it('formats positive active_delta without sign as @d+X%', () => {
      const sizing: SizingSpec = {
        raw_input: '@d0.5',
        framework: 'active_delta',
        value: 0.5,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('@d+0.5%')  // Positive value shows +
    })

    it('formats negative active_delta as @d-X%', () => {
      const sizing: SizingSpec = {
        raw_input: '@d-0.25',
        framework: 'active_delta',
        value: -0.25,
        input_sign: '-'
      }
      expect(formatSizingDisplay(sizing)).toBe('@d-0.25%')
    })

    it('formats zero active_delta without sign as @d0%', () => {
      const sizing: SizingSpec = {
        raw_input: '@d0',
        framework: 'active_delta',
        value: 0,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('@d0%')
    })

    it('formats zero active_delta with + as @d+0%', () => {
      const sizing: SizingSpec = {
        raw_input: '@d+0',
        framework: 'active_delta',
        value: 0,
        input_sign: '+'
      }
      expect(formatSizingDisplay(sizing)).toBe('@d+0%')
    })
  })

  describe('Weight Display', () => {
    it('formats weight_target as X%', () => {
      const sizing: SizingSpec = {
        raw_input: '2.5',
        framework: 'weight_target',
        value: 2.5,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('2.5%')
    })

    it('formats positive weight_delta as +X%', () => {
      const sizing: SizingSpec = {
        raw_input: '+0.5',
        framework: 'weight_delta',
        value: 0.5,
        input_sign: '+'
      }
      expect(formatSizingDisplay(sizing)).toBe('+0.5%')
    })

    it('formats negative weight_delta as -X%', () => {
      const sizing: SizingSpec = {
        raw_input: '-0.25',
        framework: 'weight_delta',
        value: -0.25,
        input_sign: '-'
      }
      expect(formatSizingDisplay(sizing)).toBe('-0.25%')
    })
  })

  describe('Shares Display', () => {
    it('formats shares_target as #X', () => {
      const sizing: SizingSpec = {
        raw_input: '#500',
        framework: 'shares_target',
        value: 500,
        input_sign: null
      }
      expect(formatSizingDisplay(sizing)).toBe('#500')
    })

    it('formats positive shares_delta as #+X', () => {
      const sizing: SizingSpec = {
        raw_input: '#+100',
        framework: 'shares_delta',
        value: 100,
        input_sign: '+'
      }
      expect(formatSizingDisplay(sizing)).toBe('#+100')
    })

    it('formats negative shares_delta as #-X', () => {
      const sizing: SizingSpec = {
        raw_input: '#-50',
        framework: 'shares_delta',
        value: -50,
        input_sign: '-'
      }
      expect(formatSizingDisplay(sizing)).toBe('#-50')
    })
  })
})

// =============================================================================
// toSizingSpec UTILITY
// =============================================================================

describe('toSizingSpec', () => {
  it('converts valid ParseResult to SizingSpec', () => {
    const parseResult: ParseResult = {
      framework: 'active_target',
      value: 0.5,
      input_sign: null,
      is_valid: true
    }
    const spec = toSizingSpec('@t0.5', parseResult)
    expect(spec).not.toBeNull()
    expect(spec?.raw_input).toBe('@t0.5')
    expect(spec?.framework).toBe('active_target')
    expect(spec?.value).toBe(0.5)
    expect(spec?.input_sign).toBeNull()
  })

  it('returns null for invalid ParseResult', () => {
    const parseResult: ParseResult = {
      is_valid: false,
      error: 'Invalid input'
    }
    const spec = toSizingSpec('@bad', parseResult)
    expect(spec).toBeNull()
  })

  it('preserves input_sign for deltas', () => {
    const parseResult: ParseResult = {
      framework: 'active_delta',
      value: 0.5,
      input_sign: '+',
      is_valid: true
    }
    const spec = toSizingSpec('@d+0.5', parseResult)
    expect(spec?.input_sign).toBe('+')
  })
})
