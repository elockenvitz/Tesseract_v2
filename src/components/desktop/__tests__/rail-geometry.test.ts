import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * The rail: one column, a narrow gutter, and a cap that guarantees both.
 *
 * ── What was reported ─────────────────────────────────────────────────────
 *
 * "Portfolio left hand pane is not working right with the cards showing
 * oddly, need to be in a list like in ideas. Same for explore. Don't want
 * more than one in a line in the left hand pane." And, separately, "still a
 * lot of empty space around the left hand pane".
 *
 * Two causes, one fix.
 *
 * The book's gallery was not a `region` gallery at all, so it fell through to
 * the WINDOW breakpoints -- `2xl:grid-cols-12` at any 1536px-wide window --
 * and packed twelve tracks into a 26rem pane. That is the "showing oddly":
 * positions as slivers. Explore was a region gallery and still gave two
 * columns, because the pane was capped at 40rem and the gallery's second
 * track count starts at 34rem.
 *
 * So the pane's cap came down to 26rem, UNDER that threshold, and both
 * surfaces are a one-column list in the rail without either of them learning
 * a special case. The same threshold drops the gutter from 24px to 12px.
 *
 * ── Why this reads source rather than rendering ───────────────────────────
 *
 * Every rule here is a container query, and jsdom implements none of the
 * Container Queries spec -- `@container` blocks are parsed and never
 * evaluated. A rendered assertion would report the full-width arrangement at
 * every pane width and pass whatever the stylesheet said. So this asserts the
 * stylesheet and the component source, and the BEHAVIOUR is measured in the
 * running app (recorded in the commit: a 415px rail, one 376px column and a
 * 12px gutter on all three lenses, with 12 tracks and 24px still at 1840px).
 */

const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8')
const src = (f: string) => readFileSync(join(process.cwd(), 'src', f), 'utf8')

/** The rem threshold at which the gallery stops being one track. */
function galleryTwoTrackThreshold(): number | null {
  const m = css.match(/@container \(min-width: ([\d.]+)rem\)[\s\S]{0,200}?\.gallery-region \{/)
  return m ? Number(m[1]) : null
}

/** The rail's `max-w-[Nrem]`, from a shell's split-open class. */
function railCapRem(file: string): number | null {
  const m = src(file).match(/splitOpen \? '[^']*max-w-\[([\d.]+)rem\]/)
  return m ? Number(m[1]) : null
}

const SHELLS = [
  'components/ideas-app/IdeasApp.tsx',
  'components/dashboard-next/DashboardNext.tsx',
]

describe('the rail is narrow enough to be a list', () => {
  it('has a gallery threshold to measure against', () => {
    /* Anti-vacuity: every case below compares against this number, and a
       renamed or restructured query would make them all compare against
       null. */
    expect(galleryTwoTrackThreshold()).toBeGreaterThan(0)
  })

  it.each(SHELLS)('%s caps the rail below the gallery\'s second track', file => {
    const cap = railCapRem(file)
    const threshold = galleryTwoTrackThreshold()!
    expect(cap, `${file} must cap the split column with max-w-[Nrem]`).toBeTruthy()
    /*
     * This, and not a literal 26, is the invariant. The number may change;
     * what may not is the rail being wide enough for a second column. Raise
     * the cap past the threshold and the reader gets two columns of slivers
     * again, which is exactly what was reported.
     */
    expect(cap!).toBeLessThanOrEqual(threshold)
  })

  it.each(SHELLS)('%s gives the rail its own gutter, not the page\'s', file => {
    /* The container has to be ON the surfaces, or the gutter rule below never
       evaluates. The shells do not own that -- the surfaces do -- so this
       asserts the shells still route every lens through the one column that
       the surfaces size themselves against. */
    expect(src(file)).toMatch(/splitOpen \? '[^']*w-\[\d+%\]/)
  })
})

describe('every surface in the rail sizes itself off the region', () => {
  const surfaces = [
    { file: 'components/ideas-app/IdeasExploreBrowse.tsx', name: 'Explore' },
    { file: 'components/portfolio-v2/PortfolioWorkspace.tsx', name: 'the book' },
    { file: 'components/ideas-app/IdeasExplore.tsx', name: 'the feed' },
  ]

  it.each(surfaces)('$name declares a gallery-host container', ({ file }) => {
    /*
     * Comments are stripped first, and this is not a formality: the first
     * draft of this case read the whole file for `gallery-host`, and removing
     * the class from the feed's root left it passing on the strength of the
     * comment that explains the class. Caught by running the injection.
     *
     * Anchored on a className too, so the string has to be somewhere that
     * reaches the DOM rather than in a prop name or a test id.
     */
    const code = src(file)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '')
    expect(code, 'gallery-host must be on a className, not only in prose')
      .toMatch(/className=(\{[^}]*)?["'][^"']*\bgallery-host\b/)
  })

  it('the book asks for region tracks rather than window breakpoints', () => {
    const code = src('components/portfolio-v2/PortfolioWorkspace.tsx')
    /*
     * The specific defect: `<DesktopGallery title="Positions">` with no
     * `region`. It renders, it looks right at full width, and it packs twelve
     * tracks into the rail. Nothing on screen says which grid is in use.
     */
    expect(code).toMatch(/<DesktopGallery[^>]*\sregion\b/)
  })
})

describe('the rail gutter', () => {
  /** The body of the `@container (max-width: Nrem)` block, by brace matching. */
  const narrowBlock = (() => {
    const start = css.search(/@container \(max-width: [\d.]+rem\)/)
    if (start < 0) return ''
    const open = css.indexOf('{', start)
    let depth = 0
    for (let i = open; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
    }
    return ''
  })()

  it('exists, keyed on the same threshold as the track count', () => {
    expect(narrowBlock, 'no @container (max-width: Nrem) block in src/index.css').not.toBe('')
    const at = css.match(/@container \(max-width: ([\d.]+)rem\)/)
    expect(Number(at![1])).toBe(galleryTwoTrackThreshold())
  })

  it('is two classes deep, or Tailwind wins', () => {
    /*
     * This is the one that would fail SILENTLY. Tailwind emits its utilities
     * layer after this one, so a single-class `.rail-pad { padding: … }` ties
     * on specificity with `.px-6` and loses on order -- the rule is in the
     * stylesheet, the test that only greps for it passes, and the gutter
     * stays 24px. Every selector in the block must be anchored on the host.
     */
    const selectors = narrowBlock.split('{')[0].split(',').map(s => s.trim()).filter(Boolean)
    expect(selectors.length).toBeGreaterThan(0)
    for (const sel of selectors) {
      expect(sel, `"${sel}" must be anchored on .gallery-host to outrank Tailwind`)
        .toMatch(/^\.gallery-host\s+\S/)
    }
  })

  it('narrows the gutter rather than removing it', () => {
    /* Zero would run the cards into the pane edge and lose the card's own
       border against the divider. */
    const pad = narrowBlock.match(/padding-left:\s*([\d.]+)rem/)
    expect(pad, 'the narrow block must set padding-left').toBeTruthy()
    expect(Number(pad![1])).toBeGreaterThan(0)
    expect(Number(pad![1])).toBeLessThan(1.5)
  })
})
