import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * The asset header's context strip — FIRM RATING / PRICE TARGET / EXPOSURE /
 * ACTIVE WORK / CASE FRESHNESS — must stay legible and must keep using the row
 * it is given.
 *
 * Two defects this pins, both measured in the running app at 1920 wide:
 *
 *  1. SPACING. The band cells were `flex-none`, so the five facts shrink-wrapped
 *     into 593px of an 1,856px row — 32% — bunched at the left with a thousand
 *     pixels of empty surface beside them and the dividers crowded together.
 *
 *  2. CONTRAST. The label, the value and the sub-line all resolved to
 *     --ux2-ink-2 (slate-500, 4.8:1 on white), so on a name with no rating, no
 *     target and no case every character in the strip was one flat grey with no
 *     hierarchy to read. Cells with no data then had `opacity-55` layered on
 *     top, which takes 4.8:1 to roughly 2.6:1 — unreadable rather than quieted.
 *
 * The contrast cases below compute real WCAG ratios from the shipped tokens, so
 * they fail on an actual legibility regression rather than on a renamed class.
 */

const SRC = resolve(__dirname, '../../..')
const CSS = readFileSync(resolve(SRC, 'components/asset/asset-ux2.css'), 'utf8')
/*
 * Comment-stripped, because this file EXPLAINS the defects it removed and names
 * them — `opacity-55`, `flex-none`, `dimmed`. A guard its own rationale can
 * satisfy or break is not a guard; the first run of the cases below failed on
 * the comment that describes the fix.
 */
const STRIP = readFileSync(resolve(SRC, 'components/asset/AssetContextStrip.tsx'), 'utf8')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n')
  .replace(/\/\*[\s\S]*?\*\//g, '')

/** Relative luminance per WCAG 2.1, from #rgb / #rrggbb or rgba(). */
function luminance(color: string): number {
  let r: number, g: number, b: number
  const hex = color.trim().match(/^#([0-9a-f]{6}|[0-9a-f]{3})$/i)
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].replace(/./g, c => c + c) : hex[1]
    ;[r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16))
  } else {
    const n = color.match(/[\d.]+/g)
    if (!n) throw new Error(`unparseable colour: ${color}`)
    ;[r, g, b] = n.slice(0, 3).map(Number)
  }
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100
}

/** Read a token out of a `.ux2-scope{...}` / `.dark .ux2-scope{...}` block. */
function token(name: string, mode: 'light' | 'dark'): string {
  const selector = mode === 'light' ? '\\.ux2-scope\\{' : '\\.dark \\.ux2-scope\\{'
  const block = CSS.match(new RegExp(`${selector}([\\s\\S]*?)\\n\\}`))
  if (!block) throw new Error(`no ${mode} .ux2-scope block`)
  const m = block[1].match(new RegExp(`--${name}\\s*:\\s*([^;]+);`))
  if (!m) throw new Error(`no --${name} in the ${mode} block`)
  return m[1].trim()
}

describe('context strip: the three text levels are distinguishable and legible', () => {
  for (const mode of ['light', 'dark'] as const) {
    describe(mode, () => {
      const bg = () => token('ux2-band', mode)

      it('the VALUE reads at full strength — it is the answer', () => {
        expect(contrast(token('ux2-ink', mode), bg())).toBeGreaterThanOrEqual(12)
      })

      it('the LABEL clears AA-large-by-a-margin despite being 11px uppercase', () => {
        // 4.5:1 is the AA floor for body copy. These are ~11px uppercase at
        // well under half body size, which is where 4.8:1 read as washed out.
        expect(contrast(token('ux2-ink-3', mode), bg())).toBeGreaterThanOrEqual(7)
      })

      it('the SUB-LINE still clears AA', () => {
        expect(contrast(token('ux2-ink-2', mode), bg())).toBeGreaterThanOrEqual(4.5)
      })

      it('the three levels are actually different, so there is a hierarchy', () => {
        const [ink, ink3, ink2] = (['ux2-ink', 'ux2-ink-3', 'ux2-ink-2'] as const)
          .map(t => contrast(token(t, mode), bg()))
        expect(ink).toBeGreaterThan(ink3)
        expect(ink3).toBeGreaterThan(ink2)
      })
    })
  }

  it('the strip divider is visibly stronger than the band hairline', () => {
    // They shared one token; at 8% alpha the dividers were ~1.1:1 on white.
    // The band's own bottom hairline is meant to stay that faint, so this is a
    // second token rather than a darker shared one.
    const alpha = (c: string) => Number(c.match(/[\d.]+\s*\)$/)?.[0].replace(')', '') ?? 1)
    expect(alpha(token('ux2-strip-line', 'light')))
      .toBeGreaterThan(alpha(token('ux2-band-line', 'light')) * 1.5)
    expect(alpha(token('ux2-strip-line', 'dark')))
      .toBeGreaterThan(alpha(token('ux2-band-line', 'dark')) * 1.5)
  })
})

describe('context strip: the band cells use the row they are given', () => {
  it('band cells share the row rather than shrink-wrapping', () => {
    // `flex-none` is what bunched five facts into 32% of the row.
    expect(STRIP).not.toMatch(/band\s*\?\s*'flex-none/)
    expect(STRIP).toMatch(/flex-1 min-w-\[150px\][^']*px-5/)
  })

  it('no cell is dimmed into illegibility when its metric is absent', () => {
    // opacity-55 over ink-2 is ~2.6:1. Absence is said in words instead
    // ("No target yet"), at full contrast.
    expect(STRIP).not.toContain('opacity-55')
    expect(STRIP).not.toContain('dimmed')
  })

  it('the label and the em-dash sit at the label level, not the sub-line level', () => {
    const eyebrow = STRIP.match(/const EYEBROW_C = band\s*\?\s*'([^']+)'/)
    const dash = STRIP.match(/const DASH_C = band\s*\?\s*'([^']+)'/)
    expect(eyebrow?.[1]).toContain('--ux2-ink-3')
    expect(dash?.[1]).toContain('--ux2-ink-3')
  })

  it('the band value line is never overridden back to a flat grey', () => {
    // `VALUE_C + ' text-gray-500'` beat the band token and dropped "Not held" /
    // "None open" below the label beside them. The default variant keeps it.
    const overrides = STRIP.match(/VALUE_C \+ ' text-gray-500[^}]*/g) ?? []
    for (const o of overrides) {
      expect(o.startsWith('VALUE_C')).toBe(true)
    }
    expect(STRIP).not.toMatch(/className=\{VALUE_C \+ ' text-gray-500/)
  })
})
