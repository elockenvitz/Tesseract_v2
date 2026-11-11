/**
 * The assistant is called ACT AI, in every string a user can read.
 *
 * ── Why this is not a grep ────────────────────────────────────────────────
 *
 * "co-analyst" means two unrelated things in this product:
 *
 *   1. The assistant, which used to be called Co-Analyst. User-visible
 *      occurrences of this are the defect: four names for one capability
 *      (Co-Analyst in the pane header, CoAnalyst on two buttons, "AI
 *      Assistant" in a tooltip, nothing in the composer).
 *
 *   2. A PERSON who shares the work on a trade idea. `AddTradeIdeaModal`
 *      renders the field label "Co-Analyst (optional)" above a people picker,
 *      and `IdeaDetail` renders "3 co-analysts". Renaming those to ACT AI
 *      would turn a sentence about colleagues into a sentence about software.
 *
 * Capitalisation does not separate them -- the role label is "Co-Analyst" with
 * both capitals, same as the old assistant name. So the separation is an
 * explicit per-file allowlist, the same shape `frontend-tenant-lint.mjs` uses
 * for its known sites, rather than a pattern pretending to be clever.
 *
 * ── Why the TypeScript parser ─────────────────────────────────────────────
 *
 * Comments are not in scope. This codebase explains itself at length, and a
 * comment reading "Opens CoAnalyst on this requirement" is internal history,
 * not a label. The brief is explicit that internal APIs, identifiers and
 * infrastructure are not renamed for branding -- so `isCreatorOrCoAnalyst` and
 * `showCoAnalystMenu` stay, and a grep would report all of them.
 *
 * Comments are not AST nodes, so excluding them is a property of the walk
 * rather than a regex that has to be right. `no-em-dash.mjs` carries the
 * longer version of this argument.
 *
 * ── Zero, not a ratchet ───────────────────────────────────────────────────
 *
 * Unlike the em-dash count, this one was brought to zero in the change that
 * added the guard, so there is no back catalogue to amortise. A ceiling here
 * would only be somewhere for the next one to hide.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..')
const SRC = join(ROOT, 'src')

/** The assistant's former names, as a reader would see them. */
const LEGACY = /Co-?Analyst/i

/**
 * Files where "co-analyst" is a person, not the assistant.
 *
 * Each entry is a deliberate statement that the copy in that file refers to a
 * human collaborator on a trade idea. Adding a file here to silence a finding
 * about the ASSISTANT would be the wrong fix, and the comment beside each one
 * is how review can tell the difference.
 */
const ROLE_NOT_ASSISTANT = new Set([
  // "Co-Analyst (optional)" above a people picker, and the menu it opens.
  'src/components/trading/AddTradeIdeaModal.tsx',
  // "· 3 co-analysts" in an idea's team line.
  'src/components/mobile/ideas/IdeaDetail.tsx',
  // Permission vocabulary: who may move an idea's stage.
  'src/lib/permissions/trade-idea-permissions.ts',
  'src/lib/services/trade-idea-service.ts',
  'src/hooks/useTradeIdeaService.ts',
  'src/types/trading.ts',
  'src/pages/TradeQueuePage.tsx',
])

/**
 * The floor on how much this scan must look at.
 *
 * A gate that scans nothing finds nothing and passes, which is the documented
 * recurring defect class in this repository. Same floor and same reasoning as
 * `no-em-dash.mjs`: this tree holds ~2,230 `.ts`/`.tsx` files under `src`.
 */
const MIN_FILES = 1800

/**
 * The names the product should be using, and where they are defined.
 *
 * Checked as well as the prohibition, because "no occurrences of the old name"
 * is also true of a build where the branding module was deleted and every
 * label went blank. The gate has to observe the positive case too.
 */
const BRAND_MODULE = join(SRC, 'lib/ai/brand.ts')
const REQUIRED_BRAND = ['ACT AI', 'ACT AI Research', 'ACT AI Briefing', 'Ask ACT AI']

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

/** Every legacy assistant name in copy, as {file, line, kind, text}. */
function findLegacyNames(files) {
  const hits = []

  for (const file of files) {
    const src = readFileSync(file, 'utf8')
    if (!LEGACY.test(src)) continue

    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (ROLE_NOT_ASSISTANT.has(rel)) continue

    const sf = ts.createSourceFile(
      file, src, ts.ScriptTarget.Latest, /* setParentNodes */ true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )

    const record = (node, text, kind) => {
      if (!LEGACY.test(text)) return
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf))
      hits.push({
        file: rel,
        line: line + 1,
        kind,
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
const all = findLegacyNames(files)
const prod = all.filter(h => !IS_TEST.test(h.file))
const tests = all.filter(h => IS_TEST.test(h.file))

console.log(`files scanned: ${files.length}  (floor ${MIN_FILES})`)
console.log(`legacy assistant name in user-visible copy: ${prod.length}  (ceiling 0)`)
console.log(`  in tests, reported only: ${tests.length}`)

let failed = false

if (files.length < MIN_FILES) {
  console.error('')
  console.error(`FAIL: only ${files.length} files scanned, floor is ${MIN_FILES}.`)
  console.error('The scan is broken or the tree moved. Fix the walk, do not lower the floor.')
  failed = true
}

/* The positive half: the names the product is supposed to use still exist. */
let brand = ''
try {
  brand = readFileSync(BRAND_MODULE, 'utf8')
} catch {
  console.error('')
  console.error(`FAIL: ${relative(ROOT, BRAND_MODULE).replace(/\\/g, '/')} is missing.`)
  console.error('Every assistant label reads from it, so a build without it has no name at all.')
  failed = true
}
if (brand) {
  const absent = REQUIRED_BRAND.filter(s => !brand.includes(s))
  if (absent.length) {
    console.error('')
    console.error(`FAIL: the branding module no longer defines: ${absent.join(', ')}`)
    failed = true
  }
}

if (prod.length > 0) {
  console.error('')
  console.error('FAIL: the assistant is called ACT AI. These strings still say otherwise:')
  for (const h of prod) {
    console.error(`  ${h.file}:${h.line}  [${h.kind}]  ${h.text}`)
  }
  console.error('')
  console.error('Read labels from src/lib/ai/brand.ts. If the string means a PERSON who')
  console.error('co-analyses an idea, add the file to ROLE_NOT_ASSISTANT with a note saying so.')
  failed = true
}

if (tests.length > 0) {
  console.log('')
  console.log('Tests mentioning the old name (reported, not enforced):')
  for (const h of tests) console.log(`  ${h.file}:${h.line}  ${h.text}`)
}

if (failed) process.exit(1)
console.log('')
console.log('PASS')
