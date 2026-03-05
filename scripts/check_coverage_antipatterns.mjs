#!/usr/bin/env node
/**
 * Lint script: detects coverage anti-patterns.
 *
 * Fails if it finds:
 *   1. `coverage[0]` usage near a `from('coverage')` query
 *   2. `.find(` on coverage arrays without using sortCoverageDeterministically or resolveCoverageDefault
 *
 * Run: node scripts/check_coverage_antipatterns.mjs
 * Exit code 0 = clean, 1 = violations found.
 */

import { readFileSync } from 'fs'
import { execSync } from 'child_process'

const ALLOWLIST = [
  'src/lib/coverage/resolveCoverage.ts',        // the resolver itself
  'src/lib/coverage/__tests__/',                 // tests
  'scripts/check_coverage_antipatterns.mjs',     // this file
  'docs/',                                       // documentation
]

// Find all TS/TSX files that import or query coverage
const files = execSync(
  'git grep -l "from(\'coverage\')" -- "src/**/*.ts" "src/**/*.tsx" 2>/dev/null || true',
  { encoding: 'utf-8' }
).trim().split('\n').filter(Boolean)

let violations = 0

for (const file of files) {
  if (ALLOWLIST.some(a => file.includes(a))) continue

  const content = readFileSync(file, 'utf-8')
  const lines = content.split('\n')

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const lineNum = i + 1

    // Pattern 1: coverage[0] — direct array indexing on coverage results
    if (/coverage\[0\]/.test(line) && !/sortCoverageDeterministically|resolveCoverageDefault/.test(content)) {
      console.error(`VIOLATION: ${file}:${lineNum}  coverage[0] without deterministic sort`)
      violations++
    }

    // Pattern 2: .find( on coverage for default selection (not keyed lookup)
    // Allow: coverageData.find(c => c.user_id === someId)  — keyed lookup by known ID
    // Flag:  coverageData.find(c => c.isLead)  — default owner selection
    //        coverageData.find(c => c.role === 'primary')  — default owner selection
    if (/coverage\w*\.find\(/.test(line)
      && !/\.find\(\w+ => \w+\.user_id\s*===/.test(line)  // allow keyed lookups
      && !/sortCoverageDeterministically|resolveCoverageDefault|coverageRoleRank/.test(content)) {
      console.error(`VIOLATION: ${file}:${lineNum}  .find() on coverage without deterministic sort`)
      violations++
    }
  }
}

if (violations > 0) {
  console.error(`\n${violations} coverage anti-pattern(s) found. Use sortCoverageDeterministically() or resolveCoverageDefault().`)
  process.exit(1)
} else {
  console.log('Coverage anti-pattern check passed.')
  process.exit(0)
}
