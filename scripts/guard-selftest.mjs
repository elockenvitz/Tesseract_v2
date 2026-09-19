#!/usr/bin/env node
/**
 * Proves the guards can fail.
 *
 * ── Why this is a script and not a unit test ──────────────────────────────
 *
 * The unit suite under src/lib/guards pins the DECISIONS: given this tsc
 * output, given this eslint report, given this vitest report, fail. Those are
 * fast, deterministic and run on every `guard:unit`.
 *
 * What they cannot do is prove the decisions are being fed the truth. A
 * classifier that is right about output no tool actually produces is still a
 * guard that cannot fail — which is the entire defect class here. So this runs
 * the real TypeScript compiler and the real test runner against deliberately
 * broken fixtures and checks that the guards' own logic rejects the result.
 *
 * Everything is built in a temp directory outside the repository and removed
 * afterwards, so a broken fixture can never be left behind in src/ where the
 * other guards would trip over it.
 *
 *     npm run guard:selftest
 *
 * Not part of `guard` or `guard:ci`: it spawns compilers, so it belongs where
 * somebody chooses to spend the time, not in the loop everyone waits on.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { classifyChildOutcome } from './lib/guard-process.mjs'
import { parseTscOutput, assessTscCompletion } from './lib/tsc-report.mjs'
import {
  assessUnitReport, allTestFiles, classifyTestFiles, unclassifiedProblems,
  GATED_DIRS, DEFERRED_DIRS, resolveScope,
} from './lib/unit-scope.mjs'

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = mkdtempSync(path.join(tmpdir(), 'tesseract-guard-selftest-'))

let failures = 0
const results = []

const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  if (!ok) failures++
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${name}${detail ? ` — ${detail}` : ''}`)
}

const write = (rel, body) => {
  const abs = path.join(root, rel)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, body)
  return abs
}

// ── TypeScript ────────────────────────────────────────────────────────────
//
// A miniature project, so the real compiler runs in seconds instead of the
// four minutes the repository takes.

const tsProject = (name, files) => {
  const dir = path.join('ts', name)
  write(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: { strict: true, noEmit: true, jsx: 'react-jsx', target: 'ES2020', module: 'ESNext', moduleResolution: 'bundler', skipLibCheck: true },
      include: ['src'],
    }),
  )
  for (const [rel, body] of Object.entries(files)) write(path.join(dir, 'src', rel), body)
  const child = spawnSync('npx', ['tsc', '-p', path.join(root, dir, 'tsconfig.json'), '--noEmit', '--listFiles'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32',
    timeout: 5 * 60 * 1000,
  })
  return { child, report: parseTscOutput(child.stdout) }
}

console.log('\nguard:types — against the real compiler')

{
  const { child, report } = tsProject('clean', { 'a.ts': 'export const n: number = 1\n' })
  const outcome = classifyChildOutcome({
    status: child.status, signal: child.signal, error: child.error,
    stderr: child.stderr, allowedExitCodes: [0, 1, 2], label: 'tsc',
  })
  const problems = assessTscCompletion(report, { minFiles: 1 })
  check('a clean project completes and is accepted', outcome.ok && problems.length === 0,
    `exit=${child.status} files=${report.files.length} diagnostics=${report.diagnostics.length}`)
}

{
  // The accepted-baseline case: real type errors, compiler ran to completion.
  // This MUST still be treated as a completed run, or the repo's deliberate
  // ~8,800-error backlog would fail the gate outright.
  const { child, report } = tsProject('type-error', {
    'a.ts': 'export const n: number = "not a number"\n',
  })
  const problems = assessTscCompletion(report, { minFiles: 1 })
  check('a completed compile with type errors is NOT treated as an abort',
    child.status === 2 && report.diagnostics.length > 0 && problems.length === 0,
    `exit=${child.status} diagnostics=${report.diagnostics.length}`)
}

{
  // The reproduction. A JSX syntax error makes TypeScript report syntactic
  // diagnostics and skip semantic analysis of the whole program.
  const { child, report } = tsProject('syntax-error', {
    'broken.tsx': 'export const B = () => <div className="x" </div>\n',
    'alsoWrong.ts': 'export const n: number = "not a number"\n',
  })
  const problems = assessTscCompletion(report, { minFiles: 1 })
  const grammarNamed = problems.some((p) => /syntax\/grammar/.test(p))
  check('a syntax error is rejected as an aborted compile', problems.length > 0 && grammarNamed,
    `exit=${child.status} diagnostics=${report.diagnostics.length}`)
  // The type error in the sibling file vanished, which is exactly why a lower
  // error count must never be read as success.
  const sawTypeError = report.diagnostics.some((d) => d.code === 2322)
  check('the sibling type error disappeared, proving nothing was type-checked', !sawTypeError,
    sawTypeError ? 'TS2322 was still reported' : 'TS2322 gone, as expected')
}

{
  // A compiler that cannot be configured.
  const dir = path.join('ts', 'bad-config')
  write(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'NOT_A_TARGET' }, include: ['src'] }))
  write(path.join(dir, 'src', 'a.ts'), 'export const n = 1\n')
  const child = spawnSync('npx', ['tsc', '-p', path.join(root, dir, 'tsconfig.json'), '--noEmit', '--listFiles'], {
    cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    shell: process.platform === 'win32', timeout: 5 * 60 * 1000,
  })
  const problems = assessTscCompletion(parseTscOutput(child.stdout), { minFiles: 1 })
  check('a misconfigured compiler is rejected', problems.length > 0, `exit=${child.status}`)
}

// ── Vitest ────────────────────────────────────────────────────────────────

console.log('\nguard:unit — against the real test runner')

const runVitest = (name, files, filters = []) => {
  const dir = path.join('vitest', name)
  for (const [rel, body] of Object.entries(files)) write(path.join(dir, rel), body)
  const out = path.join(root, dir, 'report.json')
  const child = spawnSync(
    'npx',
    ['vitest', 'run', '--root', path.join(root, dir), ...filters, '--reporter=json', `--outputFile.json=${out}`],
    {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      shell: process.platform === 'win32', timeout: 5 * 60 * 1000,
      env: { ...process.env, CI: 'true' },
    },
  )
  let report = null
  if (existsSync(out)) {
    try { report = JSON.parse(readFileSync(out, 'utf8')) } catch { report = null }
  }
  const onDisk = Object.keys(files).filter((f) => /\.test\.tsx?$/.test(f))
  return { child, report, onDisk }
}

const PASSING = `import { it, expect } from 'vitest'\nit('works', () => { expect(1).toBe(1) })\n`

{
  const { child, report, onDisk } = runVitest('clean', { 'a.test.ts': PASSING, 'b.test.ts': PASSING })
  const problems = assessUnitReport({ expectedFiles: onDisk, report })
  check('a clean suite completes and is accepted', child.status === 0 && problems.length === 0,
    `exit=${child.status} files=${report?.testResults?.length}`)
}

{
  const { child, report, onDisk } = runVitest('syntax-error', {
    'a.test.ts': PASSING,
    'broken.test.ts': `import { it, expect } from 'vitest'\nit('x', () => { expect(1).toBe(1) })\n`.replace('})\n', ''),
  })
  const problems = assessUnitReport({ expectedFiles: onDisk, report })
  check('a test file with a syntax error fails', child.status !== 0 && problems.length > 0,
    `exit=${child.status}`)
}

{
  const { child, report, onDisk } = runVitest('missing-module', {
    'a.test.ts': `import { it, expect } from 'vitest'\nimport { nope } from './does-not-exist'\nit('x', () => { expect(nope).toBeDefined() })\n`,
  })
  const problems = assessUnitReport({ expectedFiles: onDisk, report })
  check('a missing imported module fails', child.status !== 0 && problems.length > 0,
    `exit=${child.status}`)
}

{
  const { child, report, onDisk } = runVitest('broken-source', {
    'src.ts': 'export const Bad = () => <div className="x" </div>\n',
    'a.test.ts': `import { it, expect } from 'vitest'\nimport { Bad } from './src'\nit('x', () => { expect(Bad).toBeDefined() })\n`,
  })
  const problems = assessUnitReport({ expectedFiles: onDisk, report })
  check('an unparseable source file breaks collection and fails', child.status !== 0 && problems.length > 0,
    `exit=${child.status}`)
}

{
  const { child, report, onDisk } = runVitest('failing-assertion', {
    'a.test.ts': `import { it, expect } from 'vitest'\nit('x', () => { expect(1).toBe(2) })\n`,
  })
  const problems = assessUnitReport({ expectedFiles: onDisk, report })
  check('a failing assertion fails', child.status !== 0 && problems.length > 0, `exit=${child.status}`)
}

{
  // THE ONE THIS LANE EXISTS FOR.
  //
  // Two test files on disk, and a filter that matches only one — the shape a
  // renamed or moved directory produces. Vitest is entirely happy: it runs
  // what matched, reports green, and exits 0. Nothing in the runner's own
  // output says a third of the scope never ran.
  const { child, report, onDisk } = runVitest(
    'silent-shrink',
    { 'a.test.ts': PASSING, 'b.test.ts': PASSING, 'c.test.ts': PASSING },
    ['a.test.ts'],
  )
  check('vitest itself reports success on a silently shrunken scope',
    child.status === 0 && report?.success === true,
    `exit=${child.status} ran=${report?.testResults?.length} of ${onDisk.length} on disk`)

  const problems = assessUnitReport({ expectedFiles: onDisk, report })
  check('the guard rejects it anyway, naming the files that never ran',
    problems.length > 0 && problems.join('\n').includes('b.test.ts'),
    problems[0] ?? 'no problem reported')
}

// ── Scope accounting, against the real working tree ──────────────────────

console.log('\nguard:unit — scope accounting')

{
  const { files } = resolveScope(REPO, GATED_DIRS)
  const onDisk = allTestFiles(REPO)
  const split = classifyTestFiles({ all: onDisk, gatedFiles: files, deferredDirs: DEFERRED_DIRS })
  check('every test file in the tree is gated or deliberately deferred',
    split.unclassified.length === 0,
    `${onDisk.length} on disk = ${split.gated.length} gated + ${split.deferred.length} deferred`)

  // A directory that nobody classified is the way `src/pages/__tests__` landed
  // on main with no guard running it and no number moving.
  const pretend = classifyTestFiles({
    all: [...onDisk, 'src/brand-new-area/__tests__/x.test.ts'],
    gatedFiles: files,
    deferredDirs: DEFERRED_DIRS,
  })
  const problems = unclassifiedProblems(pretend.unclassified)
  check('an unclassified test directory is rejected by name',
    problems.length > 0 && problems.join('\n').includes('src/brand-new-area/__tests__'),
    problems[0] ?? 'no problem reported')
}

// ── Cleanup ───────────────────────────────────────────────────────────────
try {
  rmSync(root, { recursive: true, force: true })
} catch {
  console.log(`(could not remove ${root})`)
}

console.log('')
if (failures) {
  console.error(`FAIL: ${failures} of ${results.length} self-test(s) did not hold.`)
  process.exit(1)
}
console.log(`PASS: ${results.length} self-tests, every guard proved able to fail.`)
