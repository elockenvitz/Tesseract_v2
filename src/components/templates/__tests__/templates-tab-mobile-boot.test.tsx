/**
 * Every Templates section renders on a phone without throwing.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Earlier in this lane a symbol was used in new JSX and never imported. It
 * was a `ReferenceError` at render, it took down the whole surface, and it
 * hid inside the type ceiling's slack because an unimported name in a file
 * with pre-existing errors does not move the number. Nothing caught it until
 * a human opened the app and found a loading screen.
 *
 * The three mobile editors each have their own tests, which would catch that
 * for the editor itself. What had no coverage was TemplatesTab — the thing
 * that decides which editor a phone gets. A broken import in the tab, or in
 * a component only the tab mounts, would still reach a user first.
 *
 * So this is deliberately shallow: mount the tab at phone width, visit each
 * of the four sections, assert it produced something and did not throw. It is
 * not testing behaviour — each editor's own file does that. It is testing
 * that the surface boots, which is the failure that actually shipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TemplatesTab } from '../../tabs/TemplatesTab'
import { MOBILE_QUERY } from '../../../hooks/useMediaQuery'

// The four editors are mounted for real; only their data layers are stubbed,
// because a missing import inside one of them is exactly what this catches.
// Spread the original: the DESKTOP manager uses other exports from this same
// module, and a partial mock would fail it for a reason that has nothing to
// do with what is being tested.
vi.mock('../../../hooks/useUserAssetPagePreferences', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../../hooks/useUserAssetPagePreferences')>()
  return {
    ...actual,
    useUserAssetPageLayouts: () => ({
      layouts: [],
      isLoading: false,
      saveLayout: { mutateAsync: vi.fn() },
      updateLayout: { mutateAsync: vi.fn() },
    }),
  }
})
vi.mock('../../../hooks/useResearchFields', () => ({
  useResearchSections: () => ({ sections: [], isLoading: false }),
  useResearchFields: () => ({ fields: [], isLoading: false }),
}))
vi.mock('../../../hooks/useIsOrgAdmin', () => ({
  useIsOrgAdmin: () => ({ isOrgAdmin: false, isLoading: false, canAuthorCatalog: false }),
}))
vi.mock('../../../hooks/useInvestmentCaseTemplates', () => ({
  useInvestmentCaseTemplates: () => ({
    myTemplates: [],
    sharedTemplates: [],
    isLoading: false,
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  }),
}))
vi.mock('../../../hooks/useModelTemplates', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../hooks/useModelTemplates')>()
  return {
    ...actual,
    useModelTemplates: () => ({
      myTemplates: [],
      sharedTemplates: [],
      isLoading: false,
      createTemplate: { mutateAsync: vi.fn() },
      updateTemplate: { mutateAsync: vi.fn() },
    }),
  }
})
vi.mock('../TemplateManager', () => ({
  TemplateManager: () => <div data-testid="quick-text" />,
}))

// The desktop managers are stubbed by identity only. The mobile editors above
// are deliberately NOT stubbed — they are what this file exists to boot.
vi.mock('../ResearchFieldsManager', () => ({
  ResearchFieldsManager: () => <div data-testid="desktop-Research Layout" />,
}))
vi.mock('../ExcelModelTemplateManager', () => ({
  ExcelModelTemplateManager: () => <div data-testid="desktop-Excel Extraction" />,
}))
vi.mock('../../investment-case-templates', () => ({
  InvestmentCaseTemplateManager: () => <div data-testid="desktop-Investment Case PDF" />,
  InvestmentCaseTemplatePreview: () => null,
}))

function setMobile(mobile: boolean) {
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

beforeEach(() => setMobile(true))
afterEach(() => vi.restoreAllMocks())

const SECTIONS = ['Quick Text', 'Excel Extraction', 'Research Layout', 'Investment Case PDF']

describe('TemplatesTab boots every section on a phone', () => {
  it.each(SECTIONS)('renders %s without throwing', (label) => {
    // `render` rethrows a ReferenceError from a child, so reaching the
    // assertion at all is most of the point.
    render(<TemplatesTab />)
    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(document.body.textContent?.trim()).not.toBe('')
  })

  it('lands on Quick Text rather than a section restored from another device', () => {
    render(<TemplatesTab />)
    expect(screen.getByTestId('quick-text')).toBeInTheDocument()
  })

  it('shows no desktop-only notice on any section any more', () => {
    // All four types author on a phone now. A lingering notice would mean a
    // section silently stopped being editable.
    render(<TemplatesTab />)
    for (const label of SECTIONS) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(screen.queryByText(/is built on desktop/i)).not.toBeInTheDocument()
    }
  })
})

describe('desktop is untouched', () => {
  it('picks the desktop manager, not the phone editor', () => {
    // The BRANCH is what this lane changed, so the branch is what is asserted.
    // Mounting the real desktop managers here would pull in react-grid-layout
    // and a QueryClient to prove something their own surface already proves —
    // and a test that heavy is one people delete.
    setMobile(false)
    render(<TemplatesTab />)

    for (const label of ['Research Layout', 'Investment Case PDF', 'Excel Extraction']) {
      fireEvent.click(screen.getByRole('button', { name: label }))
      expect(screen.getByTestId(`desktop-${label}`)).toBeInTheDocument()
    }
  })
})
