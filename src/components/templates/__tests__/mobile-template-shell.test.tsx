/**
 * The shared mobile Templates chrome, and the presentation-state contract it
 * must not break.
 *
 * Two separate things are pinned here:
 *
 *   1. The shell itself — that it is chrome and nothing else. It must not
 *      acquire knowledge of any template type, because a shell that
 *      understood templates becomes a fifth place the canonical model gets
 *      interpreted.
 *
 *   2. `TemplatesTab`'s localStorage behaviour. That predates this work and
 *      is easy to destroy by accident: a phone must never write the active
 *      section back to storage, or visiting Templates on a phone silently
 *      retires the section the user chose on their desktop. Adding mobile
 *      editors means more code paths that call `setActiveSection`, which is
 *      exactly the pressure that would break it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MOBILE_QUERY } from '../../../hooks/useMediaQuery'
import { MobileTemplateShell } from '../mobile/MobileTemplateShell'

function setViewport(mobile: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: mobile && query === MOBILE_QUERY,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia
}

const tabSrc = () =>
  readFileSync(resolve(process.cwd(), 'src/components/tabs/TemplatesTab.tsx'), 'utf8')

/** Strip comments so no assertion can be satisfied by prose about the code. */
const stripComments = (s: string) =>
  s
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')

describe('the shell is chrome, not an editor', () => {
  beforeEach(() => setViewport(true))
  afterEach(() => vi.restoreAllMocks())

  it('shows the way back, the name and the type', () => {
    render(
      <MobileTemplateShell typeLabel="Quick Text" name="Earnings recap" onBack={() => {}}>
        <div>editor</div>
      </MobileTemplateShell>,
    )
    expect(screen.getByRole('button', { name: /templates/i })).toBeInTheDocument()
    expect(screen.getByText('Earnings recap')).toBeInTheDocument()
    expect(screen.getByText('Quick Text')).toBeInTheDocument()
    expect(screen.getByText('editor')).toBeInTheDocument()
  })

  it('names an unsaved template rather than showing an empty heading', () => {
    render(
      <MobileTemplateShell typeLabel="Quick Text" name="" onBack={() => {}}>
        <div />
      </MobileTemplateShell>,
    )
    expect(screen.getByText(/untitled quick text/i)).toBeInTheDocument()
  })

  it('renders only the actions a type actually passes', () => {
    const { rerender } = render(
      <MobileTemplateShell typeLabel="Quick Text" name="x" onBack={() => {}}>
        <div />
      </MobileTemplateShell>,
    )
    // No handlers: no action bar at all, rather than disabled buttons that
    // suggest a capability the editor does not have.
    expect(screen.queryByRole('button', { name: /^save$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /preview/i })).not.toBeInTheDocument()

    rerender(
      <MobileTemplateShell
        typeLabel="Quick Text" name="x" onBack={() => {}}
        onSave={() => {}} onPreview={() => {}}
      >
        <div />
      </MobileTemplateShell>,
    )
    expect(screen.getByRole('button', { name: /^save$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /preview/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^use$/i })).not.toBeInTheDocument()
  })

  it('calls back, save, preview and use', () => {
    const onBack = vi.fn(), onSave = vi.fn(), onPreview = vi.fn(), onUse = vi.fn(), onMore = vi.fn()
    render(
      <MobileTemplateShell
        typeLabel="Quick Text" name="x" onBack={onBack}
        onSave={onSave} onPreview={onPreview} onUse={onUse} onMore={onMore}
      >
        <div />
      </MobileTemplateShell>,
    )
    fireEvent.click(screen.getByRole('button', { name: /templates/i }))
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }))
    fireEvent.click(screen.getByRole('button', { name: /preview/i }))
    fireEvent.click(screen.getByRole('button', { name: /^use$/i }))
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }))
    expect(onBack).toHaveBeenCalled()
    expect(onSave).toHaveBeenCalled()
    expect(onPreview).toHaveBeenCalled()
    expect(onUse).toHaveBeenCalled()
    expect(onMore).toHaveBeenCalled()
  })

  it('says "Unsaved" in words when there are pending edits', () => {
    const { rerender } = render(
      <MobileTemplateShell typeLabel="Quick Text" name="x" onBack={() => {}}>
        <div />
      </MobileTemplateShell>,
    )
    expect(screen.queryByText(/unsaved/i)).not.toBeInTheDocument()

    rerender(
      <MobileTemplateShell typeLabel="Quick Text" name="x" onBack={() => {}} dirty>
        <div />
      </MobileTemplateShell>,
    )
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument()
  })

  it('blocks save while one is in flight, and says so', () => {
    const onSave = vi.fn()
    render(
      <MobileTemplateShell typeLabel="Quick Text" name="x" onBack={() => {}} onSave={onSave} saving>
        <div />
      </MobileTemplateShell>,
    )
    const btn = screen.getByRole('button', { name: /saving/i })
    expect(btn).toBeDisabled()
    fireEvent.click(btn)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('never reads vh, which is what puts a pinned bar under the keyboard', () => {
    const src = stripComments(
      readFileSync(resolve(process.cwd(), 'src/components/templates/mobile/MobileTemplateShell.tsx'), 'utf8'),
    )
    expect(src).not.toMatch(/\bh-screen\b/)
    expect(src).not.toMatch(/\b\d*vh\b/)
    // The scrolling region must carry min-h-0, or it grows the flex parent
    // and pushes the action bar off the bottom instead of scrolling.
    expect(src).toMatch(/min-h-0 flex-1 overflow-y-auto/)
  })
})

describe('mobile never rewrites the desktop section preference', () => {
  const src = () => stripComments(tabSrc())

  it('still normalises the phone landing through a one-shot ref', () => {
    // Without the ref this re-runs on every render and fights any editor
    // that legitimately changes section.
    expect(src()).toMatch(/didNormalise/)
    expect(src()).toMatch(/didNormalise\.current\s*=\s*true/)
  })

  it('still early-returns out of the localStorage write on mobile', () => {
    const s = src()
    const writeEffect = s.slice(s.indexOf('localStorage.setItem') - 400, s.indexOf('localStorage.setItem') + 120)
    // The guard must sit BEFORE the write, in the same effect.
    expect(writeEffect).toMatch(/if\s*\(isMobile\)\s*return[\s\S]*localStorage\.setItem/)
  })

  it('writes to storage in exactly one place, so the guard cannot be bypassed', () => {
    const writes = src().match(/localStorage\.setItem\(\s*TEMPLATES_TAB_STORAGE_KEY/g) ?? []
    expect(writes).toHaveLength(1)
  })
})
