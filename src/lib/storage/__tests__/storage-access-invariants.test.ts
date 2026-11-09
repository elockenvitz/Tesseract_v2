/**
 * Storage access rules that must not come back.
 *
 * The egress incident was not caused by a subtle algorithm; it was caused by
 * three specific lines, each individually reasonable. Each one is pinned here
 * so a later edit reintroducing it fails rather than ships:
 *
 *   1. `OrganizationContext` signing a logo inside the org-list queryFn and
 *      overwriting `logo_url` with the result.
 *   2. `Header` preloading those URLs with `new Image()`.
 *   3. `WorkflowsPage` persisting a `getPublicUrl` result for a private bucket.
 *
 * Source assertions, because the defect is the PRESENCE of a call in a place,
 * which is exactly what a grep can state and a behavioural test cannot.
 *
 * ── Why the source is scanned once ───────────────────────────────────────────
 *
 * Two of these tests ask a question about the whole tree, and the tree is
 * about 2800 files. Each used to walk it and then read every file again
 * individually inside its own `.filter()`, so the file paid for the tree twice
 * per run on top of re-reading single files for the other sixteen tests. That
 * put it within a few hundred milliseconds of vitest's 5s default, and it
 * timed out whenever the runner scheduled it beside another guard that walks
 * the same tree, which made the Netlify deploy gate fail at random on a green
 * tree.
 *
 * The tree is now read once per run and every assertion reads from that. The
 * assertions and their guarantees are unchanged; only the number of times the
 * disk is read has changed.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')

/**
 * A file's CODE, with comments removed.
 *
 * These guards assert that a call is absent. Every removal in this change is
 * accompanied by a comment explaining what used to be there and why it was
 * wrong — and those comments necessarily name the very calls being asserted
 * against. Matching raw text would therefore fail on the documentation of the
 * fix, and, worse, would pass if someone deleted the comment while leaving the
 * call. Stripping comments first makes these assertions about behaviour.
 */
function strip(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

/** Every .ts/.tsx file under src/, excluding tests. */
function sourceFiles(dir = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue
      sourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

interface SourceFile {
  /** Path relative to src, forward-slashed and normalised. */
  rel: string
  /** Comment-stripped text. */
  code: string
}

/** `a/b/../c.ts` and `a\c.ts` both key as `a/c.ts`. */
const key = (p: string) => path.normalize(p).replace(/\\/g, '/')

/**
 * The tree, read once per run of this file.
 *
 * Populated by `beforeAll` and cleared by `afterAll` rather than memoised on
 * first use. vitest runs both on every execution of this file, watch-mode
 * re-triggers included, so a file edited between runs is re-read on the next
 * one. A lazy memo would be correct today only because the module registry
 * happens to be rebuilt per run, and that is not a property this guard should
 * depend on.
 */
let corpus: SourceFile[] | null = null

beforeAll(() => {
  corpus = sourceFiles().map(abs => ({
    rel: key(path.relative(SRC, abs)),
    code: strip(readFileSync(abs, 'utf8')),
  }))
})

afterAll(() => {
  corpus = null
})

/**
 * The scanned tree.
 *
 * Throws rather than rescanning if the hook has not run, and throws again if
 * the tree scanned as empty. A guard that quietly substitutes an empty tree
 * would report PASS on every "appears nowhere" assertion below while checking
 * nothing at all.
 */
function sources(): SourceFile[] {
  if (corpus === null) {
    throw new Error('the source tree was not scanned: beforeAll did not run')
  }
  if (corpus.length === 0) {
    throw new Error('the source tree scanned as empty, which cannot be right')
  }
  return corpus
}

/**
 * One file's comment-stripped code, by path relative to src.
 *
 * Throws when the path is not in the tree, so a file that is renamed or moved
 * fails the assertion that names it instead of silently reading as empty.
 */
const codeOf = (p: string): string => {
  const want = key(p)
  const hit = sources().find(f => f.rel === want)
  if (!hit) throw new Error(`${want} is not in the scanned source tree`)
  return hit.code
}

describe('the scan these rules depend on is real', () => {
  /*
   * Both whole-tree rules below assert an empty array. If the walk returned
   * nothing — a moved root, a bad cwd — they would pass while checking no
   * files at all, which is the failure mode this repo keeps producing. This
   * is what makes those gates non-vacuous.
   *
   * `sources()` already throws on a COMPLETELY empty tree. These two go
   * further: a walk that reached three files, or one whose comment stripping
   * silently stopped working, is not empty and would slip past that check
   * while making every "appears nowhere" assertion meaningless.
   */
  it('reached a meaningful number of source files', () => {
    expect(sources().length).toBeGreaterThan(300)
  })

  it('actually stripped comments, so the rules match code and not prose', () => {
    expect(sources().some(s => s.code.length > 0)).toBe(true)
    expect(sources().every(s => !/^\s*\/\/ /m.test(s.code))).toBe(true)
  })
})

describe('getPublicUrl is never used', () => {
  /*
   * Every bucket in this project is private. `getPublicUrl` on a private
   * bucket returns a well-formed URL that 400s, so persisting one stored a
   * permanently broken link; and making the bucket public to "fix" that would
   * publish an unauthenticated link to the object forever.
   */
  it('appears nowhere in application source', () => {
    const offenders = sources()
      .filter(f => f.code.includes('getPublicUrl'))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })

  it('is not what WorkflowsPage persists for a workflow template', () => {
    const page = codeOf('pages/WorkflowsPage.tsx')
    // The storage path is stored, and the insert says so.
    expect(page).toContain('file_url: fileName')
    expect(page).not.toContain('getPublicUrl')
  })

  it('resolves the stored workflow-template value through a signed URL to open it', () => {
    const tab = codeOf('components/tabs/AssetTab.tsx')
    expect(tab).toContain('fetchSignedUrl(')
    expect(tab).toContain('WORKFLOW_TEMPLATES_BUCKET')
    // Not opened as if the stored value were already a URL.
    expect(tab).not.toContain('window.open(template.file_url')
  })
})

describe('the organization logo has one resolver', () => {
  it('OrganizationContext does not sign inside the org-list query', () => {
    expect(codeOf('contexts/OrganizationContext.tsx')).not.toContain('createSignedUrl')
  })

  it('OrganizationContext does not overwrite logo_url', () => {
    // The field is the object's identity. Writing a rotating credential into
    // it is what made every consumer re-download the image.
    expect(codeOf('contexts/OrganizationContext.tsx')).not.toMatch(/org\.logo_url\s*=[^=]/)
  })

  it('Header does not preload logos with new Image()', () => {
    expect(codeOf('components/layout/Header.tsx')).not.toContain('new Image()')
  })

  it('Header renders the logo through the shared component', () => {
    expect(codeOf('components/layout/Header.tsx')).toContain('<OrgLogo')
  })

  it('no surface signs template-branding directly any more', () => {
    // The five independent signers are now one. Any direct signing of this
    // bucket outside the shared cache is the defect returning.
    const offenders = sources()
      .filter(f => f.code.includes("'template-branding'") && f.code.includes('createSignedUrl'))
      .map(f => f.rel)
    expect(offenders).toEqual([])
  })
})

describe('byte-fetching effects key on object identity', () => {
  it('the spreadsheet preview depends on the path, not the signed URL', () => {
    /*
     * `fileUrl` rotates every fifty minutes. When it was the effect's only
     * dependency, each rotation re-downloaded and re-parsed the whole
     * workbook.
     */
    const ext = codeOf('components/rich-text-editor/extensions/FileAttachmentExtension.tsx')
    const effect = ext.slice(ext.indexOf('const loadedPathRef'))
    const deps = effect.slice(0, effect.indexOf('if (loading)'))
    expect(deps).toContain('}, [objectPath])')
    expect(deps).not.toContain('}, [fileUrl])')
  })

  it('the spreadsheet preview guards against reloading the same object', () => {
    const ext = codeOf('components/rich-text-editor/extensions/FileAttachmentExtension.tsx')
    expect(ext).toContain('if (loadedPathRef.current === identity) return')
  })

  it('the capture view no longer runs its own re-signing timer', () => {
    const view = codeOf('components/rich-text-editor/extensions/capture/CaptureView.tsx')
    expect(view).not.toContain('setTimeout(sign')
    expect(view).toContain('useSignedUrl(CAPTURES_BUCKET')
  })

  it('the attachment view no longer runs its own re-signing timer', () => {
    const ext = codeOf('components/rich-text-editor/extensions/FileAttachmentExtension.tsx')
    expect(ext).not.toContain('setTimeout(sign')
    expect(ext).toContain('useSignedUrl(ASSETS_BUCKET')
  })

  it('FileDetail resolves by bucket and path rather than by file object identity', () => {
    const detail = codeOf('components/files/FileDetail.tsx')
    expect(detail).toContain('useSignedUrl(')
    expect(detail).toContain('file.storage_path')
    // The old effect re-signed whenever the files list refetched.
    expect(detail).not.toContain('}, [file, getUrl])')
  })

  it('the export modal does not re-fetch the logo per render', () => {
    const builder = codeOf('components/research/InvestmentCaseBuilder.tsx')
    expect(builder).toContain('useObjectDataUrl(')
    // The unstable dependency that made this run on every render.
    expect(builder).not.toContain('getLogoUrl')
  })
})

describe('the shared cache refreshes only near expiry', () => {
  it('holds a credential well short of its own lifetime', () => {
    const mod = codeOf('lib/storage/signed-url.ts')
    expect(mod).toContain('export const SIGNED_URL_TTL_SECONDS = 3600')
    expect(mod).toContain('export const SIGNED_URL_STALE_MS = 50 * 60 * 1000')
  })

  it('does not re-sign on window focus or reconnect', () => {
    const mod = codeOf('lib/storage/signed-url.ts')
    expect(mod).toContain('refetchOnWindowFocus: false')
    expect(mod).toContain('refetchOnReconnect: false')
  })
})

describe('the comment-stripping these guards rely on', () => {
  /*
   * Without this, every "does not contain" assertion above could pass merely
   * because a comment was deleted, or fail merely because one was written.
   */
  it('removes block and line comments but keeps code', () => {
    const mod = codeOf('lib/storage/signed-url.ts')
    // Prose from this module's own header is gone…
    expect(mod).not.toContain('defeated one')
    // …and its code is not.
    expect(mod).toContain('createSignedUrl(path, SIGNED_URL_TTL_SECONDS)')
  })

  it('does not mistake a protocol slash for a comment', () => {
    // `https://` inside a string must survive, or URL assertions go vacuous.
    expect(codeOf('lib/storage/__tests__/../buckets.ts')).toContain('template-branding')
  })
})
