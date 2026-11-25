import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync, rmSync, mkdtempSync, cpSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * The publication gate, exercised as a process rather than as a function.
 *
 * ── Why the script is run, not imported ──────────────────────────────────
 *
 * The thing being guarded is an EXIT CODE and a set of files on disk. An
 * imported `publish()` would prove the function's logic; it would not prove
 * that `npm run legal:publish` refuses, which is what a release step actually
 * invokes. This repository's standing rule is that a gate must be shown
 * failing, and the failure here is "the command exits non-zero and writes
 * nothing".
 *
 * ── Why a copy of the repo ───────────────────────────────────────────────
 *
 * Proving the gate OPENS means approving a document, which cannot be done by
 * editing the working tree: this suite would then be mutating the real
 * registry, and a crash mid-test would leave documents marked approved. So
 * each case that needs a different registry copies the three inputs into a
 * temporary directory and runs the script against that.
 */

const root = resolve(import.meta.dirname, '../..')
const SCRIPT = 'scripts/publish-legal.mjs'

/** Run the script in `cwd`, returning its exit code and output. */
function run(cwd, args = []) {
  try {
    const stdout = execFileSync(process.execPath, [SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out: stdout }
  } catch (err) {
    return {
      code: err.status ?? 1,
      out: `${err.stdout ?? ''}${err.stderr ?? ''}`,
    }
  }
}

/**
 * A throwaway copy of just what the script reads and writes.
 *
 * `mutate` receives the registry and entity sources as strings and returns the
 * replacements, so a case can approve a document or configure an entity
 * without touching the real files.
 */
function sandbox(mutate = (reg, ent) => [reg, ent]) {
  const dir = mkdtempSync(join(tmpdir(), 'legal-publish-'))
  cpSync(resolve(root, 'scripts/publish-legal.mjs'), join(dir, 'scripts/publish-legal.mjs'), {
    recursive: false,
    force: true,
  })
  cpSync(resolve(root, 'docs/legal'), join(dir, 'docs/legal'), { recursive: true })
  cpSync(resolve(root, 'src/legal'), join(dir, 'src/legal'), { recursive: true })

  const regPath = join(dir, 'src/legal/documents.ts')
  const entPath = join(dir, 'src/legal/entity.ts')
  const [reg, ent] = mutate(readFileSync(regPath, 'utf8'), readFileSync(entPath, 'utf8'))
  writeFileSync(regPath, reg)
  writeFileSync(entPath, ent)
  return dir
}

/** Approve every document and fill every entity field. */
function approveEverything(reg, ent) {
  return [
    reg
      .replace(/status: 'draft'/g, "status: 'approved'")
      .replace(/effectiveDate: null/g, "effectiveDate: '2026-12-01'")
      .replace(/version: '([\d.]+)-draft'/g, "version: '$1'"),
    ent.replace(/^(\s*)(\w+): null,$/gm, "$1$2: 'filled',"),
  ]
}

describe('the legal publication gate', () => {
  it('REFUSES while any document is a draft, and names them', () => {
    // The real repository, as it ships. The gate must be shut.
    const { code, out } = run(root)
    expect(code, 'publishing drafts must exit non-zero').toBe(1)
    expect(out).toMatch(/Refusing to publish/)
    expect(out).toMatch(/still status: 'draft'/)
    expect(out).toMatch(/application-terms/)
  })

  it('REFUSES while any entity detail is null, and names them', () => {
    const { out } = run(root)
    expect(out).toMatch(/entity detail\(s\) are null/)
    expect(out).toMatch(/legalName/)
    expect(out).toMatch(/governingLaw/)
  })

  it('writes NOTHING when it refuses', () => {
    /*
     * The assertion that makes the exit code mean something. A script that
     * printed "Refusing" after already copying the files would satisfy the
     * two tests above while having published the drafts.
     */
    const dir = sandbox()
    const { code } = run(dir)
    expect(code).toBe(1)
    expect(existsSync(join(dir, 'public/legal')), 'public/legal must not exist').toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  describe('--if-approved, the mode the Netlify build runs', () => {
    /*
     * Three properties, and all three are needed. The mode exists so that a
     * deploy is not red for months while the documents are drafts -- but a
     * mode that exits 0 unconditionally would make the `&&` in netlify.toml
     * decoration, and would hide a registry that stopped parsing.
     */

    it('exits 0 and writes nothing while the documents are drafts', () => {
      const dir = sandbox()
      const { code, out } = run(dir, ['--if-approved'])
      expect(code, 'a deploy must not fail because the documents are drafts').toBe(0)
      expect(out).toMatch(/Nothing to publish yet/)
      expect(out).toMatch(/still status: 'draft'/)
      expect(existsSync(join(dir, 'public/legal')), 'nothing may be written').toBe(false)
      rmSync(dir, { recursive: true, force: true })
    })

    it('still PUBLISHES once everything is approved', () => {
      /*
       * Without this, the case above is indistinguishable from a flag that
       * disables publishing altogether -- which would mean approval day comes
       * and the build quietly ships no documents.
       */
      const dir = sandbox(approveEverything)
      const { code, out } = run(dir, ['--if-approved'])
      expect(code).toBe(0)
      expect(out).toMatch(/document\(s\) written to public\/legal/)
      expect(existsSync(join(dir, 'public/legal/privacy-policy.md'))).toBe(true)
      rmSync(dir, { recursive: true, force: true })
    })

    it('STILL FAILS on a real fault, so the && in netlify.toml means something', () => {
      /*
       * The injection. A broken registry is not the expected unfinished state,
       * it is a fault, and it must stop the build -- otherwise a deploy could
       * ship with the legal pages silently serving nothing on the day they
       * were supposed to go live.
       */
      /*
       * Note on the injection itself. The first attempt renamed the export to
       * `LEGAL_DOCUMENTS_RENAMED` and the script published anyway, exit 0 --
       * because the parser's pattern is `LEGAL_DOCUMENTS[^=]*=`, and
       * `_RENAMED` is `[^=]*`. The gate was fine; the injection was not, and
       * it took a second look to tell those apart.
       *
       * Recorded rather than quietly fixed, because it says something about
       * the parser: it matches a PREFIX, so a differently-named export could
       * be read as the registry. Renaming to `LEGAL_DOCS` is a real parse
       * failure and is what this case uses.
       */
      const dir = sandbox((reg, ent) => [
        reg.replace('export const LEGAL_DOCUMENTS', 'export const LEGAL_DOCS'),
        ent,
      ])
      const { code, out } = run(dir, ['--if-approved'])
      expect(code, 'an unparseable registry must fail the build').not.toBe(0)
      expect(out).toMatch(/could not locate LEGAL_DOCUMENTS/)
      rmSync(dir, { recursive: true, force: true })
    })

    it('STILL FAILS when an approved document points at a missing file', () => {
      /*
       * The other real fault, and the more likely one: a document renamed or
       * moved without updating the registry. With everything approved the
       * build WOULD publish, so this must not pass silently.
       */
      const dir = sandbox((reg, ent) => {
        const [approved, entity] = approveEverything(reg, ent)
        return [
          approved.replace(
            "source: 'docs/legal/policies/privacy-policy-draft.md'",
            "source: 'docs/legal/policies/moved-somewhere-else.md'",
          ),
          entity,
        ]
      })
      const { code, out } = run(dir, ['--if-approved'])
      expect(code, 'a missing source file must fail the build').not.toBe(0)
      expect(out).toMatch(/missing source/)
      rmSync(dir, { recursive: true, force: true })
    })
  })

  it('PUBLISHES once every document is approved and the entity is filled', () => {
    /*
     * The non-vacuity proof. Without this case, the three refusals above are
     * indistinguishable from a script that refuses unconditionally.
     */
    const dir = sandbox(approveEverything)
    const { code, out } = run(dir)
    expect(code, out).toBe(0)
    expect(out).toMatch(/published/)
    expect(existsSync(join(dir, 'public/legal/application-terms.md'))).toBe(true)

    const published = readFileSync(join(dir, 'public/legal/application-terms.md'), 'utf8')
    expect(published, 'front matter should record the approved status').toMatch(/status: approved/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('still REFUSES when documents are approved but the entity is not filled', () => {
    /*
     * The two conditions are independent, and this is the one a status field
     * cannot catch: an approved document still containing [LEGAL ENTITY NAME]
     * would publish a policy naming a company that does not exist.
     */
    const dir = sandbox((reg, ent) => [approveEverything(reg, ent)[0], ent])
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toMatch(/entity detail\(s\) are null/)
    expect(out).not.toMatch(/still status: 'draft'/)
    expect(existsSync(join(dir, 'public/legal'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('REFUSES when a document points at a missing source, rather than publishing an empty file', () => {
    const dir = sandbox((reg, ent) => {
      const [approvedReg, filledEnt] = approveEverything(reg, ent)
      return [
        approvedReg.replace(
          "source: 'docs/legal/policies/cookie-notice-draft.md'",
          "source: 'docs/legal/policies/does-not-exist.md'",
        ),
        filledEnt,
      ]
    })
    const { code, out } = run(dir)
    expect(code).toBe(1)
    expect(out).toMatch(/missing source/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('allows a PREVIEW of drafts, and labels every one of them', () => {
    const dir = sandbox()
    const { code, out } = run(dir, ['--preview'])
    expect(code, out).toBe(0)
    expect(out).toMatch(/PREVIEW MODE/)
    const published = readFileSync(join(dir, 'public/legal/application-terms.md'), 'utf8')
    expect(published).toMatch(/status: draft/)
    expect(published, 'the document itself must still announce it is a draft')
      .toMatch(/DRAFT, NOT LEGAL REVIEWED/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('refuses a PREVIEW when NODE_ENV is production', () => {
    /*
     * --preview is the one path that copies draft legal text, so it must not
     * be reachable from a production build. Checked here because the flag is
     * easy to leave in a deploy command.
     */
    const dir = sandbox()
    let code = 0
    try {
      execFileSync(process.execPath, [SCRIPT, '--preview'], {
        cwd: dir,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'production' },
      })
    } catch (err) {
      code = err.status ?? 1
    }
    expect(code).toBe(1)
    expect(existsSync(join(dir, 'public/legal'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('unpublishes by removing the directory entirely', () => {
    const dir = sandbox()
    run(dir, ['--preview'])
    expect(existsSync(join(dir, 'public/legal'))).toBe(true)
    const { code } = run(dir, ['--unpublish'])
    expect(code).toBe(0)
    expect(existsSync(join(dir, 'public/legal'))).toBe(false)
    rmSync(dir, { recursive: true, force: true })
  })

  it('keeps public/legal out of version control', () => {
    /*
     * The gate depends on this. --preview writes DRAFT text into
     * public/legal/; if that directory were tracked, a preview copy could be
     * committed and the next deploy would serve it.
     */
    const ignore = readFileSync(resolve(root, '.gitignore'), 'utf8')
    const active = ignore.split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith('#'))
    expect(active, 'public/legal/ must be gitignored').toContain('public/legal/')
  })
})
