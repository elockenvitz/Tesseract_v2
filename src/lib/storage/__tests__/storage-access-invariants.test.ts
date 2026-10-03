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
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')
const read = (p: string) => readFileSync(path.join(SRC, p), 'utf8')

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
const codeOf = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')

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

describe('getPublicUrl is never used', () => {
  /*
   * Every bucket in this project is private. `getPublicUrl` on a private
   * bucket returns a well-formed URL that 400s, so persisting one stored a
   * permanently broken link; and making the bucket public to "fix" that would
   * publish an unauthenticated link to the object forever.
   */
  it('appears nowhere in application source', () => {
    const offenders = sourceFiles()
      .map(f => path.relative(SRC, f).replace(/\\/g, '/'))
      .filter(rel => codeOf(rel).includes('getPublicUrl'))
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
    const offenders = sourceFiles()
      .map(f => path.relative(SRC, f).replace(/\\/g, '/'))
      .filter(rel => {
        const body = codeOf(rel)
        return body.includes("'template-branding'") && body.includes('createSignedUrl')
      })
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
