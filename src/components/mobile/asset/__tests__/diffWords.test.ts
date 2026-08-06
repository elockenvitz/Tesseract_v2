import { describe, expect, it } from 'vitest'
import { diffWords } from '../CaseFieldHistory'

const render = (parts: ReturnType<typeof diffWords>) =>
  parts.map(p => `${p.kind[0]}:${p.text}`).join('|')

describe('diffWords', () => {
  it('marks only what changed', () => {
    const parts = diffWords('the thesis is intact', 'the thesis is broken')
    expect(parts.filter(p => p.kind === 'same').map(p => p.text).join('')).toBe('the thesis is ')
    expect(parts.find(p => p.kind === 'removed')?.text).toBe('intact')
    expect(parts.find(p => p.kind === 'added')?.text).toBe('broken')
  })

  it('reconstructs both revisions exactly', () => {
    const before = 'margins compress in the second half on mix'
    const after = 'margins expand in the second half on price'

    const parts = diffWords(before, after)
    const rebuiltBefore = parts.filter(p => p.kind !== 'added').map(p => p.text).join('')
    const rebuiltAfter = parts.filter(p => p.kind !== 'removed').map(p => p.text).join('')

    // A diff that cannot rebuild its inputs is showing the reader something
    // that was never written.
    expect(rebuiltBefore).toBe(before)
    expect(rebuiltAfter).toBe(after)
  })

  it('merges adjacent words into one run', () => {
    const parts = diffWords('we like it', 'we do not like it')
    // "do not " should be a single highlighted block, not three spans.
    expect(parts.filter(p => p.kind === 'added')).toHaveLength(1)
  })

  it('handles pure insertion and pure deletion', () => {
    expect(render(diffWords('', 'new text'))).toBe('a:new text')
    expect(render(diffWords('old text', ''))).toBe('r:old text')
  })

  it('reports no change when nothing moved', () => {
    const parts = diffWords('unchanged prose', 'unchanged prose')
    expect(parts.every(p => p.kind === 'same')).toBe(true)
  })

  it('preserves whitespace so the text stays readable', () => {
    const parts = diffWords('a  b', 'a  c')
    expect(parts.filter(p => p.kind !== 'added').map(p => p.text).join('')).toBe('a  b')
  })

  it('falls back rather than building a huge matrix', () => {
    // LCS is O(n x m); two long revisions would otherwise allocate millions of
    // cells and block the main thread on a phone.
    const long = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ')
    const parts = diffWords(long, long + ' extra')

    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('same')
    expect(parts[0].text).toBe(long + ' extra')
  })
})
