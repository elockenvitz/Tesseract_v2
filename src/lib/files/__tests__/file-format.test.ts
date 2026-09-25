/**
 * The pure half of Files: what a type means, what a size reads as, and what
 * the repository refuses to store.
 *
 * These are the decisions the UI cannot make for itself, so they live in one
 * module that desktop and mobile both import — the alternative is two
 * definitions of "is this previewable" that drift.
 */
import { describe, it, expect } from 'vitest'
import {
  fileKind, canPreviewInline, formatBytes, fileExtension,
  validateUpload, MAX_FILE_BYTES,
} from '../file-format'

describe('fileKind', () => {
  it('reads the MIME type when there is one', () => {
    expect(fileKind('image/png')).toBe('image')
    expect(fileKind('application/pdf')).toBe('pdf')
    expect(fileKind('text/csv')).toBe('spreadsheet')
    expect(fileKind('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('spreadsheet')
    expect(fileKind('application/msword')).toBe('document')
    expect(fileKind('application/zip')).toBe('archive')
    expect(fileKind('text/plain')).toBe('text')
  })

  it('falls back to the extension when the browser supplies no type', () => {
    // A mobile picker routinely hands over an empty `type`. Losing the icon
    // over that is avoidable.
    expect(fileKind('', 'chart.PNG')).toBe('image')
    expect(fileKind(null, 'model.xlsx')).toBe('spreadsheet')
    expect(fileKind(undefined, 'memo.pdf')).toBe('pdf')
    expect(fileKind('', 'archive.tar')).toBe('archive')
  })

  it('calls an unrecognised file "other" rather than guessing', () => {
    expect(fileKind('application/x-unknown', 'thing.qqq')).toBe('other')
    expect(fileKind('', '')).toBe('other')
  })
})

describe('canPreviewInline', () => {
  it('is true for exactly the two types V1 renders', () => {
    expect(canPreviewInline('image/jpeg')).toBe(true)
    expect(canPreviewInline('application/pdf')).toBe(true)
  })

  it('is false for the Office formats V1 deliberately does not render', () => {
    // Not previewable is not the same as not storable — these upload fine
    // and offer Download.
    expect(canPreviewInline('application/msword')).toBe(false)
    expect(canPreviewInline('application/vnd.ms-excel')).toBe(false)
    expect(canPreviewInline('application/vnd.ms-powerpoint')).toBe(false)
    expect(canPreviewInline('application/zip')).toBe(false)
  })
})

describe('formatBytes', () => {
  it('scales through the units', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB')
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3.0 GB')
  })

  it('distinguishes an unknown size from an empty file', () => {
    // "0 B" for a missing size asserts something false about the file.
    expect(formatBytes(null)).toBe('—')
    expect(formatBytes(undefined)).toBe('—')
    expect(formatBytes(0)).toBe('0 B')
  })
})

describe('fileExtension', () => {
  it('lowercases and handles names with no extension', () => {
    expect(fileExtension('Report.PDF')).toBe('pdf')
    expect(fileExtension('archive.tar.gz')).toBe('gz')
    expect(fileExtension('README')).toBe('')
  })
})

describe('validateUpload', () => {
  it('accepts an ordinary file', () => {
    expect(validateUpload({ size: 1024, name: 'a.pdf' })).toEqual({ ok: true })
  })

  it('refuses an empty file', () => {
    const r = validateUpload({ size: 0, name: 'a.pdf' })
    expect(r.ok).toBe(false)
    expect(r.ok === false && r.reason).toMatch(/empty/i)
  })

  it('refuses a file over the bucket limit, and says both numbers', () => {
    const r = validateUpload({ size: MAX_FILE_BYTES + 1, name: 'big.zip' })
    expect(r.ok).toBe(false)
    // The message has to name the limit, or the user cannot tell how much
    // smaller the file needs to be.
    expect(r.ok === false && r.reason).toMatch(/50\.0 MB/)
  })

  it('accepts a file exactly at the limit', () => {
    expect(validateUpload({ size: MAX_FILE_BYTES, name: 'exact.zip' })).toEqual({ ok: true })
  })

  it('refuses no file type, ever', () => {
    // The deliberate absence of a whitelist: a repository that rejects the
    // unusual document somebody needed to keep is not a repository. Every
    // one of these stores; only preview differs.
    for (const name of ['a.exe', 'b.dwg', 'c.sketch', 'd.qqq', 'e']) {
      expect(validateUpload({ size: 10, name })).toEqual({ ok: true })
    }
  })
})
