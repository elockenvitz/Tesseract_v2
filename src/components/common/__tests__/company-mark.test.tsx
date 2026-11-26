import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { CompanyMark } from '../CompanyMark'
import { monogramFor, markPaletteIndex, MARK_PALETTE } from '../company-mark-identity'

/**
 * The shared company mark.
 *
 * Two properties carry the weight. The colour must be STABLE, because the
 * whole point is that AAPL looks like itself in search and on the header.
 * And the mark must never make a network request on its own initiative,
 * because the obvious implementation (a public logo endpoint keyed on the
 * ticker) would both leak every search keystroke to a third party and put
 * someone else's trademark into a commercial product unlicensed.
 */

describe('the monogram survives real ticker shapes', () => {
  it('takes two letters from a plain ticker', () => {
    expect(monogramFor('AAPL', 'Apple Inc.')).toBe('AA')
  })

  it('reads a class share off its first segment', () => {
    // BRK.B, RDS-A, 0700.HK — the separator must not land in the monogram.
    expect(monogramFor('BRK.B')).toBe('BR')
    expect(monogramFor('RDS-A')).toBe('RD')
    expect(monogramFor('0700.HK')).toBe('07')
  })

  it('handles a single-letter ticker without padding it', () => {
    expect(monogramFor('V', 'Visa Inc.')).toBe('V')
  })

  it('falls back to initials when there is no ticker at all', () => {
    expect(monogramFor(null, 'Morgan Stanley')).toBe('MS')
    expect(monogramFor('', 'Caterpillar')).toBe('CA')
  })

  it('never returns punctuation', () => {
    for (const t of ['...', '-', '  ', '.A']) {
      expect(monogramFor(t, null)).toMatch(/^[A-Z0-9]{1,2}$|^—$/)
    }
  })

  it('has something to render with no inputs', () => {
    expect(monogramFor(null, null)).toBe('—')
  })
})

describe('the colour is an identity cue, so it must be stable', () => {
  it('gives the same symbol the same index every time', () => {
    const a = markPaletteIndex('AAPL')
    for (let i = 0; i < 25; i++) expect(markPaletteIndex('AAPL')).toBe(a)
  })

  it('separates the tickers a user actually compares', () => {
    // Not a hash-quality claim — just that these four, which sit together
    // in a search for common large caps, do not collapse to one colour.
    const idx = ['AAPL', 'MSFT', 'CAT', 'MS'].map(markPaletteIndex)
    expect(new Set(idx).size).toBeGreaterThan(1)
  })

  it('is in range for every input, including empty', () => {
    for (const s of ['', 'A', 'AAPL', 'BRK.B', '0700.HK', 'X'.repeat(200)]) {
      const i = markPaletteIndex(s)
      expect(Number.isInteger(i)).toBe(true)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(MARK_PALETTE.length)
    }
  })
})

describe('the component renders without reaching the network', () => {
  it('draws a monogram, not an image, when no src is given', () => {
    render(<CompanyMark symbol="AAPL" name="Apple Inc." />)
    const mark = screen.getByTestId('company-mark')
    expect(mark.textContent).toBe('AA')
    expect(mark.tagName).toBe('SPAN')
  })

  it('names the security for a screen reader', () => {
    render(<CompanyMark symbol="CAT" name="Caterpillar Inc." />)
    expect(screen.getByLabelText('CAT (Caterpillar Inc.)')).toBeTruthy()
  })

  it('renders an img only when a caller supplies a licensed url', () => {
    const { container } = render(<CompanyMark symbol="AAPL" src="https://example.test/a.png" />)
    const img = container.querySelector('img')
    expect(img).toBeTruthy()
    expect(img?.getAttribute('loading')).toBe('lazy')
  })

  /**
   * Non-vacuity for the claim above: no caller in the application passes
   * `src`, so the img branch is unreachable in production today. If that
   * changes, this is the test that should be revisited alongside the
   * licensing question — not silently satisfied by a new logo provider.
   */
  it('has no src from any application caller yet', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const root = resolve(__dirname, '../../../../')
    for (const f of ['src/components/search/GlobalSearch.tsx', 'src/components/asset/AssetWorkspaceHeader.tsx']) {
      const s = readFileSync(resolve(root, f), 'utf8')
      const at = s.indexOf('<CompanyMark')
      expect(at, f).toBeGreaterThan(-1)
      expect(s.slice(at, s.indexOf('/>', at)), f).not.toContain('src=')
    }
  })

  it('keeps one box size whichever branch renders', () => {
    const { container: a } = render(<CompanyMark symbol="AAPL" size="md" />)
    const { container: b } = render(<CompanyMark symbol="AAPL" size="md" src="https://example.test/a.png" />)
    const cls = (el: Element | null) => (el?.getAttribute('class') ?? '')
    for (const dim of ['h-9', 'w-9']) {
      expect(cls(a.firstElementChild), dim).toContain(dim)
      expect(cls(b.firstElementChild), dim).toContain(dim)
    }
  })
})
