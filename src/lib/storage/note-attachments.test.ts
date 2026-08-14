import { describe, it, expect } from 'vitest'
import { collectNoteAttachmentPaths } from './note-attachments'

const ORG = '3f2504e0-4f89-11d3-9a0c-0305e82c3301'

describe('collectNoteAttachmentPaths', () => {
  it('pulls attachment and screenshot paths out of stored note HTML', () => {
    const html = `
      <p>see attached</p>
      <div data-file-path="${ORG}/attachments/note/a1/1_x.xlsx"></div>
      <div data-screenshot-path="${ORG}/2_y.png"></div>
    `
    expect(collectNoteAttachmentPaths(html)).toEqual({
      assets: [`${ORG}/attachments/note/a1/1_x.xlsx`],
      captures: [`${ORG}/2_y.png`],
    })
  })

  it('handles empty and missing content', () => {
    for (const v of ['', null, undefined, '<p>no files here</p>']) {
      expect(collectNoteAttachmentPaths(v)).toEqual({ assets: [], captures: [] })
    }
  })

  it('deduplicates a path embedded twice', () => {
    const p = `${ORG}/attachments/note/a1/1_x.xlsx`
    const html = `<div data-file-path="${p}"></div><div data-file-path="${p}"></div>`
    expect(collectNoteAttachmentPaths(html).assets).toEqual([p])
  })

  it('finds every attachment across repeated calls', () => {
    // The regexes are module-level and /g. Without resetting lastIndex the
    // second call resumes mid-string and silently drops attachments — which
    // would leave files behind for every note after the first in a sweep.
    const html = `<div data-file-path="${ORG}/a.xlsx"></div><div data-file-path="${ORG}/b.xlsx"></div>`
    const first = collectNoteAttachmentPaths(html).assets
    const second = collectNoteAttachmentPaths(html).assets
    expect(second).toEqual(first)
    expect(second).toHaveLength(2)
  })

  it('decodes escaped characters in the stored attribute', () => {
    const html = `<div data-file-path="${ORG}/docs/a&amp;b.pdf"></div>`
    expect(collectNoteAttachmentPaths(html).assets).toEqual([`${ORG}/docs/a&b.pdf`])
  })

  it('keeps the two buckets separate', () => {
    // A screenshot path must never be sent to the assets bucket: remove() on
    // the wrong bucket silently no-ops and the file survives the deletion.
    const html = `<div data-screenshot-path="${ORG}/shot.png"></div>`
    const { assets, captures } = collectNoteAttachmentPaths(html)
    expect(assets).toEqual([])
    expect(captures).toEqual([`${ORG}/shot.png`])
  })
})
