/**
 * Em dashes in user-visible copy, counted with a real parser.
 *
 * ── Why a ratchet and not a sweep ─────────────────────────────────────────
 *
 * "Never an em dash in any user-visible string" was a rule with no
 * enforcement, so it held in new work and the back catalogue kept hundreds.
 * That is the shape every unratcheted standard ends up in. This stops the
 * number growing; lowering it is the actual progress and happens a file at a
 * time.
 *
 * ── Why the TypeScript parser ─────────────────────────────────────────────
 *
 * A grep gives a number that is wrong in both directions. It counts the long
 * explanatory comments this codebase is full of, which the rule exempts -- and
 * a hand-rolled comment stripper desynchronises on the first apostrophe in JSX
 * text, so one `doesn't` turns the remainder of a file into a single
 * unterminated string and the comments after it get reported as code.
 *
 * Measured on this tree: grep said 913 across 283 files, the parser says 448
 * across 171. The grep number is 465 comments.
 *
 * Comments are not AST nodes, so they are excluded by construction here rather
 * than by a regex that has to be right.
 *
 * ── What counts ───────────────────────────────────────────────────────────
 *
 * String literals, template-literal text, and JSX text. That is where copy
 * lives.
 *
 * NOT counted: a literal whose entire text is one em dash. `{value ?? '—'}` in
 * a table cell is the typographic convention for "no value", not prose with a
 * dash in it, and there are about 340 of them. Rewriting those would make the
 * tables worse.
 *
 * The distinction that actually matters is PROMINENCE, and no parser can see
 * it. The dash that was reported as a bug was in a tile's largest type, in the
 * identity position, where a reader took it for a company name. The same glyph
 * at 11px in a dense cell reads correctly. So the lone-dash shape is allowed
 * and prominence stays a review question.
 *
 * Also not copy: import specifiers, query keys, classNames. Those are string
 * literals too, so a handful of the 448 are false positives. Under a ratchet
 * that is harmless -- a false positive can only hold the number up, never let
 * a real one through.
 *
 * ── Keeping it honest ─────────────────────────────────────────────────────
 *
 * `MIN_FILES` is the property this repository's other ratchets lacked: a check
 * that scans nothing reports nothing and would otherwise pass. The count can
 * only fall by copy improving, not by the scan getting quieter.
 *
 * When the count falls the run says so and names the value to write here, so
 * slack is visible instead of silently accumulating. Same reasoning, and same
 * behaviour, as `typecheck-cards.mjs`.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const DASH = '—'
const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'src')

/**
 * The count when this guard landed, measured by this script. Product code
 * only; it may fall and must never rise.
 */
// 448 at the baseline, then → 345 in the same change, because four files held
// 103 of them and they were all one shape: a diagnosis, a dash, and the
// recommendation that follows from it. `decision-insights.ts` (36),
// `scorecard-engine.ts` (34), `dashboard/dashboardIntelligence.ts` (18) and
// `decision-intelligence.ts` (15) are now at zero.
//
// Three of those 103 were sentence FRAGMENTS, not sentences: `scorecard-engine`
// pushes clauses onto an array and later joins them with '. ' while
// capitalising each one, so turning an internal dash into a period there would
// have produced "Targets hitting at only 31%. Conviction levels may be
// miscalibrated" as ONE joined clause and then capitalised mid-sentence. Those
// took ", so" instead. A blind replace would have been wrong in exactly the
// places a script could not see.
//
// The remaining 345 are a genuine long tail: 167 files at one or two each. Not
// a backlog to burn down as a task -- the value here is the derivative, the
// same reasoning `typecheck-cards.mjs` records for its own ceiling. Fix them as
// you touch the copy, and lower this line when you do.
const MAX_PROSE_DASHES = 345

/**
 * The floor on how much this scan must actually look at.
 *
 * Without it, a glob that stops matching, a parser upgrade that changes a node
 * kind, or a bad refactor of `walk` all make this report zero and PASS. That
 * is the documented recurring defect class here: a gate that cannot observe
 * its own failure mode is decoration.
 *
 * This tree has 2,233 `.ts`/`.tsx` files under `src`. 1,800 leaves 19% of room
 * for deletions while sitting far above anything a broken walk returns, which
 * is zero or a single directory. (Do not reach for tsc's "source files loaded"
 * number for this: that one is ~3,900 because it counts node_modules `.d.ts`.)
 */
const MIN_FILES = 1800

/**
 * Tests are reported, never ratcheted.
 *
 * A test that asserts on copy has to change when the copy does, so a second
 * number here would only be a second thing to edit in the same commit.
 */
const IS_TEST = /__tests__|[.](test|spec)[.]tsx?$/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name === '.git') continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** Every em dash in copy, as {file, line, kind, count, text}. */
function findProseDashes(files) {
  const hits = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    // Cheap reject: most files have none at all, and parsing is the slow part.
    if (!src.includes(DASH)) continue

    const sf = ts.createSourceFile(
      file, src, ts.ScriptTarget.Latest, /* setParentNodes */ true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const record = (node, text, kind) => {
      if (!text.includes(DASH)) return
      // The "no value" glyph, not prose. See the header.
      if (text.trim() === DASH) return
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      hits.push({
        file: relative(ROOT, file).replace(/\\/g, '/'),
        line: line + 1,
        kind,
        count: [...text].filter(c => c === DASH).length,
        text: text.replace(/\s+/g, ' ').trim().slice(0, 100),
      })
    }

    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        record(node, node.text, 'string')
      } else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        record(node, node.text, 'template')
      } else if (ts.isJsxText(node)) {
        record(node, node.text, 'jsx')
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }

  return hits
}

const files = walk(SRC)
const all = findProseDashes(files)
const prod = all.filter(h => !IS_TEST.test(h.file))
const tests = all.filter(h => IS_TEST.test(h.file))

const total = prod.reduce((a, h) => a + h.count, 0)
const fileCount = new Set(prod.map(h => h.file)).size

console.log(`files scanned: ${files.length}  (floor ${MIN_FILES})`)
console.log(`em dashes in user-visible copy: ${total} across ${fileCount} files  (ceiling ${MAX_PROSE_DASHES})`)
console.log(`  in tests, reported only: ${tests.reduce((a, h) => a + h.count, 0)}`)

if (files.length < MIN_FILES) {
  console.error('')
  console.error(`FAIL: only ${files.length} files scanned, floor is ${MIN_FILES}.`)
  console.error('This scan is not looking at the codebase, so its count means nothing.')
  console.error('Check `walk` and the SRC path before trusting any number above.')
  process.exit(1)
}

if (process.argv.includes('--list')) {
  const byFile = new Map()
  for (const h of prod) byFile.set(h.file, (byFile.get(h.file) ?? 0) + h.count)
  console.log('')
  for (const [f, c] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`${String(c).padStart(4)}  ${f}`)
  }
}

if (process.argv.includes('--all')) {
  console.log('')
  for (const h of prod) console.log(`${h.file}:${h.line}  [${h.kind}]  ${h.text}`)
}

if (total > MAX_PROSE_DASHES) {
  console.error('')
  console.error(`FAIL: em dashes in copy rose to ${total}, ceiling is ${MAX_PROSE_DASHES}.`)
  console.error('An em dash is never used in a user-visible string in this product,')
  console.error('tooltips and title attributes included. Use a comma, a colon,')
  console.error('parentheses, or rewrite the sentence.')
  console.error('')
  console.error('Comments and commit messages are exempt. A literal that is ONLY a')
  console.error('dash (the "no value" glyph in a table cell) does not count.')
  console.error('Run with --list for a file breakdown, or --all for every line.')
  process.exit(1)
}

if (total < MAX_PROSE_DASHES) {
  /*
    Slack is reported, never auto-applied -- the rule `typecheck-cards.mjs`
    arrived at the hard way. A ratchet that lowers itself leaves no committed
    record of what the number was or why it moved, and the next reader cannot
    tell a real repair from a scan that looked at less.
  */
  console.log('')
  console.log(`NOTE: ${MAX_PROSE_DASHES - total} fewer than the ceiling.`)
  console.log(`      Lower MAX_PROSE_DASHES to ${total} in scripts/no-em-dash.mjs`)
  console.log('      so the ground gained is held.')
}

console.log('PASS')
