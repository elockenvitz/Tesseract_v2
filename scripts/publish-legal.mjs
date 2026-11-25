#!/usr/bin/env node
/**
 * Copy approved legal documents into public/legal/ so the site can serve them.
 *
 * ── Why a copy step exists at all ────────────────────────────────────────
 *
 * The documents could have been imported into the bundle with Vite's `?raw`.
 * That was rejected: a bundler import puts the legal text on the CDN the
 * moment the branch deploys, retrievable by anyone who enumerates assets,
 * whether or not a route renders it. There would be no moment at which
 * someone decided to publish.
 *
 * This script is that moment. It REFUSES to copy a document whose registry
 * status is still `draft`, and `public/legal/` is gitignored so a preview copy
 * cannot be committed into the served directory by accident. Together those
 * two facts are a gate. A status field on its own is a label.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   npm run legal:publish             copy approved documents. Refuses while
 *                                     any document is a draft, or while any
 *                                     entity detail is unset.
 *
 *   npm run legal:publish -- --preview
 *                                     copy drafts too, for LOCAL review.
 *                                     Every copied draft keeps its own
 *                                     "DRAFT" front matter and the page shows
 *                                     a banner. Refuses if NODE_ENV is
 *                                     production.
 *
 *   npm run legal:publish:build       what the Netlify build runs. Publishes
 *                                     if everything is approved; exits 0
 *                                     having published nothing if not. Still
 *                                     exits non-zero on a real fault, so the
 *                                     `&&` in netlify.toml means something.
 *
 *   npm run legal:unpublish           delete public/legal/ entirely.
 *
 * ── What it does not do ──────────────────────────────────────────────────
 *
 * It does not edit the documents, and it does not fill placeholders. The
 * `[LEGAL ENTITY NAME]` tokens are substituted at render time from
 * src/legal/entity.ts, so there is exactly one place the entity's details
 * live. A script that baked them into the copy would create a second place.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = resolve(root, 'public/legal')

const args = process.argv.slice(2)
const PREVIEW = args.includes('--preview')
const UNPUBLISH = args.includes('--unpublish')

/**
 * `--if-approved`: publish if everything is approved, otherwise exit 0 having
 * published nothing.
 *
 * This is the mode the Netlify build uses, and it exists because the default
 * mode's refusal is correct for a person and wrong for a build. A human who
 * runs `legal:publish` today has made a mistake worth stopping for -- the
 * documents are drafts and they were about to publish them -- so the script
 * exits 1 and names what is missing.
 *
 * A deploy has made no such mistake. Today's correct outcome for a deploy is
 * "the application ships, the legal pages show the in-preparation notice",
 * and exiting 1 for that would turn every deploy red until the day the
 * documents are approved. Nobody keeps a gate that is red for months; they
 * delete the line, and then on approval day nothing publishes.
 *
 * So this mode is quiet-and-zero for the EXPECTED unfinished state, and still
 * loudly non-zero for a genuine fault: a registry that will not parse, or a
 * document whose source file is missing. Those remain `process.exit(1)` below,
 * which is what makes `&&` in the build command worth writing.
 */
const IF_APPROVED = args.includes('--if-approved')

/**
 * Read the registry out of the TypeScript source.
 *
 * Parsing the source is uglier than importing it, and it is done anyway
 * because importing a .ts module from a plain node script needs a loader, and
 * because this script must work in a bare `npm run` with no build step. The
 * parse is deliberately strict: anything it cannot read with certainty is a
 * hard failure rather than a silently skipped document, because a document
 * skipped by a parse bug would be a document missing from the site with no
 * error anywhere.
 */
function readRegistry() {
  const src = readFileSync(resolve(root, 'src/legal/documents.ts'), 'utf8')
  const block = src.match(/export const LEGAL_DOCUMENTS[^=]*=\s*\[([\s\S]*?)\n\] as const/)
  if (!block) throw new Error('could not locate LEGAL_DOCUMENTS in src/legal/documents.ts')

  const docs = []
  for (const entry of block[1].split(/\n\s*\{\s*\n/).slice(1)) {
    const field = (name, pattern) => {
      const m = entry.match(new RegExp(`${name}:\\s*${pattern}`))
      return m ? m[1] : null
    }
    const id = field('id', "'([^']+)'")
    const source = field('source', "'([^']+)'")
    const version = field('version', "'([^']+)'")
    const status = field('status', "'([^']+)'")
    const title = entry.match(/title:\s*'([^']+)'/)?.[1] ?? null
    if (!id || !source || !version || !status) {
      throw new Error(`incomplete registry entry; parsed id=${id} source=${source} version=${version} status=${status}`)
    }
    docs.push({ id, source, version, status, title })
  }
  if (docs.length === 0) throw new Error('registry parsed to zero documents')
  return docs
}

/** Whether every entity detail in src/legal/entity.ts has a value. */
function entityIsConfigured() {
  const src = readFileSync(resolve(root, 'src/legal/entity.ts'), 'utf8')
  const block = src.match(/export const LEGAL_ENTITY: LegalEntity = \{([\s\S]*?)\n\}/)
  if (!block) throw new Error('could not locate LEGAL_ENTITY in src/legal/entity.ts')
  const nulls = [...block[1].matchAll(/^\s*(\w+):\s*null\s*,/gm)].map(m => m[1])
  return { ok: nulls.length === 0, missing: nulls }
}

function unpublish() {
  if (existsSync(OUT_DIR)) {
    rmSync(OUT_DIR, { recursive: true, force: true })
    console.log('removed public/legal/')
  } else {
    console.log('public/legal/ does not exist; nothing to remove')
  }
}

function publish() {
  const docs = readRegistry()
  const drafts = docs.filter(d => d.status !== 'approved')
  const entity = entityIsConfigured()

  if (!PREVIEW) {
    const problems = []
    if (drafts.length) {
      problems.push(
        `${drafts.length} document(s) are still status: 'draft' — ` +
        drafts.map(d => d.id).join(', '),
      )
    }
    if (!entity.ok) {
      problems.push(
        `${entity.missing.length} entity detail(s) are null in src/legal/entity.ts — ` +
        entity.missing.join(', '),
      )
    }
    if (problems.length && IF_APPROVED) {
      /*
       * The expected state, not a fault. Reported on stdout so the deploy log
       * records that the step ran and chose not to publish -- a silent no-op
       * here would be indistinguishable from the step having been removed.
       */
      console.log('\nNothing to publish yet; the legal pages will show the in-preparation notice.\n')
      for (const p of problems) console.log(`  - ${p}`)
      console.log('\nRelease sequence: docs/legal/legal-release-checklist.md\n')
      return
    }
    if (problems.length) {
      console.error('\nRefusing to publish.\n')
      for (const p of problems) console.error(`  - ${p}`)
      console.error(
        '\nPublishing a document that names an entity which does not exist is a\n' +
        'false statement, which is worse than a missing document.\n\n' +
        'For LOCAL review of the drafts, run:  npm run legal:publish -- --preview\n' +
        'The release sequence is docs/legal/legal-release-checklist.md\n',
      )
      process.exit(1)
    }
  } else if (process.env.NODE_ENV === 'production') {
    console.error('\nRefusing: --preview copies DRAFT legal text and NODE_ENV is production.\n')
    process.exit(1)
  }

  mkdirSync(OUT_DIR, { recursive: true })

  for (const doc of docs) {
    const srcPath = resolve(root, doc.source)
    if (!existsSync(srcPath)) {
      console.error(`\nRefusing: ${doc.id} points at a missing source: ${doc.source}\n`)
      process.exit(1)
    }
    const body = readFileSync(srcPath, 'utf8')

    /*
     * Front matter the page reads back, so the rendered page's version is the
     * version of the bytes it is showing rather than whatever the registry
     * happens to say now. If someone edits a document and republishes without
     * bumping the version, these disagree and the page's own test catches it.
     */
    const header = [
      '---',
      `document_id: ${doc.id}`,
      `version: ${doc.version}`,
      `status: ${doc.status}`,
      `published_at: ${new Date().toISOString()}`,
      `source: ${doc.source}`,
      '---',
      '',
    ].join('\n')

    writeFileSync(resolve(OUT_DIR, `${doc.id}.md`), header + body, 'utf8')
    console.log(`  ${doc.status === 'approved' ? 'published' : 'PREVIEW  '}  ${doc.id}.md  (${doc.version})`)
  }

  console.log(`\n${docs.length} document(s) written to public/legal/`)
  if (PREVIEW) {
    console.log(
      '\nPREVIEW MODE. These are DRAFTS. public/legal/ is gitignored, so this\n' +
      'cannot be committed. Set VITE_LEGAL_PUBLISHED=true in .env.local to view\n' +
      'them, and run `npm run legal:unpublish` when you are done.\n',
    )
  }
}

/** Documents in the registry whose source file does not exist. Used by tests. */
export function missingSources() {
  return readRegistry()
    .filter(d => !existsSync(resolve(root, d.source)))
    .map(d => `${d.id} -> ${d.source}`)
}

export { readRegistry, entityIsConfigured, OUT_DIR }

// Run only when invoked directly, so a test can import readRegistry() without
// the script writing files as a side effect of the import.
const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (invokedDirectly) {
  try {
    if (UNPUBLISH) unpublish()
    else publish()
  } catch (err) {
    console.error(`\n${err.message}\n`)
    process.exit(1)
  }
}

// Keep the directory listing helper exported so a test can assert the output
// shape without re-implementing the path.
export function publishedFiles() {
  return existsSync(OUT_DIR) ? readdirSync(OUT_DIR).sort() : []
}
