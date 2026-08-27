/**
 * Finds Supabase queries against organisation-scoped tables that do not filter
 * by organization_id.
 *
 * Used by the guard test to stop new unscoped queries being introduced. Run
 * directly (`node src/lib/org-scope/org-scope-scan.mjs`) to list current
 * offenders, or with `--write-baseline` to accept the existing set.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/**
 * Tables carrying organization_id whose rows are workspace data. A query
 * against one of these that does not constrain the organisation will return
 * rows from every org the user belongs to.
 */
export const ORG_SCOPED_TABLES = [
  'analyst_price_targets',
  'asset_contributions',
  'asset_lists',
  'asset_notes',
  'coverage',
  'portfolio_holdings_positions',
  'portfolios',
  'projects',
  'quick_thoughts',
  'trade_queue_items',
]

/**
 * Lines considered part of one query when looking for a filter.
 *
 * Generous, because the window now terminates at the next `.from(` (see
 * scanFile) and so can no longer bleed into a neighbouring query. Before that
 * terminator existed this had to stay small, which meant a query with a long
 * `.select()` column list pushed its own organization filter out of range and
 * reported a false positive.
 */
const QUERY_WINDOW = 40

export function scanFile(path, source) {
  const lines = source.split('\n')
  const found = []

  lines.forEach((line, i) => {
    const match = line.match(/\.from\('([a-z_]+)'\)/)
    if (!match || !ORG_SCOPED_TABLES.includes(match[1])) return

    // Stop the window at the next `.from(`. Without this it ran straight into
    // the following query in a Promise.all array and accepted ITS
    // organization_id as proof that this one was scoped — which is exactly how
    // the unscoped quick_thoughts read inside generateStaleCoverageSignals
    // stayed invisible to this scanner while sitting between three scoped ones.
    let end = Math.min(i + QUERY_WINDOW, lines.length)
    for (let j = i + 1; j < end; j++) {
      if (/\.from\('[a-z_]+'\)/.test(lines[j])) { end = j; break }
    }
    const block = lines.slice(i, end).join('\n')

    // Already constrained by organisation.
    if (/organization_id/.test(block)) return
    // Fetching specific rows by id is inherently scoped by the id itself.
    if (/\.eq\('id',|\.in\('id',/.test(block)) return
    // Deliberate exemptions must say why, on the line above.
    if (/org-scope-exempt/.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n'))) return

    found.push({ file: path, line: i + 1, table: match[1] })
  })

  return found
}

export function scanTree(root = 'src') {
  const files = []
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      const s = statSync(p)
      if (s.isDirectory()) {
        if (name === 'node_modules' || name === '__tests__') continue
        walk(p)
      } else if (/\.(ts|tsx)$/.test(name)) files.push(p)
    }
  }
  walk(root)

  const violations = []
  for (const f of files) {
    violations.push(...scanFile(relative('.', f).split('\\').join('/'), readFileSync(f, 'utf8')))
  }
  return violations
}

if (process.argv[1] && process.argv[1].endsWith('org-scope-scan.mjs')) {
  const violations = scanTree('src')
  const files = [...new Set(violations.map(v => v.file))].sort()
  if (process.argv.includes('--write-baseline')) {
    writeFileSync(
      'src/lib/org-scope/known-unscoped-queries.json',
      JSON.stringify(files, null, 2) + '\n'
    )
    console.log(`baseline written: ${files.length} files, ${violations.length} queries`)
  } else {
    console.log(`${violations.length} unscoped queries across ${files.length} files`)
    for (const v of violations.slice(0, 40)) console.log(`  ${v.file}:${v.line} ${v.table}`)
  }
}
