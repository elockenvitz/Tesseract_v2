/**
 * Trade Lab's "Loading workbench" state shows the Tesseract, not a spinning
 * refresh arrow.
 *
 * The loader is the canonical one — `TesseractLoader` over `TesseractMark`,
 * the same mark and loop as the boot screen and the feed — so this pins that
 * the Workbench uses it in the same centred slot and leaves the other loaders
 * alone, and renders the composition to show the still mark under reduced
 * motion. The loading condition itself is untouched.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render } from '@testing-library/react'
import { TesseractLoader } from '../../components/ui/TesseractLoader'

const page = readFileSync(path.join(process.cwd(), 'src/pages/SimulationPage.tsx'), 'utf8')
const CONDITION = '{(sharedSimLoading || tradeLabLoading || simulationsLoading || isAutoCreating || (selectedPortfolioId && !simulation && simulationLoading && !isSharedView)) ? ('
const loadingBlock = page.slice(page.indexOf(CONDITION), page.indexOf(') : !selectedPortfolioId && !isSharedView ? ('))

afterEach(() => vi.unstubAllGlobals())

describe('the Workbench loading state', () => {
  it('keeps the same loading condition', () => {
    expect(page).toContain(CONDITION)
  })

  it('shows the Tesseract loader in the same centred slot', () => {
    expect(loadingBlock).toContain('<div className="flex-1 flex items-center justify-center bg-gray-50 dark:bg-gray-900/50">')
    expect(loadingBlock).toContain('<TesseractLoader size={64} compact text="Loading workbench..." />')
    expect(page).toContain("import { TesseractLoader } from '../components/ui/TesseractLoader'")
  })

  it('no longer spins the refresh arrow there', () => {
    expect(loadingBlock).not.toContain('RefreshCw')
    expect(loadingBlock).not.toContain('animate-spin')
  })

  it('leaves the other loaders in Trade Lab as they were', () => {
    // Not a global replacement: saving, the ideas list and portfolio data keep theirs.
    expect(page).toContain('<RefreshCw className="h-3.5 w-3.5 animate-spin" />')
    expect(page).toContain('<RefreshCw className="h-5 w-5 text-gray-400 animate-spin" />')
    expect(page).toContain('<RefreshCw className="h-6 w-6 text-gray-400 animate-spin mx-auto mb-2" />')
  })
})

describe('the loader it uses', () => {
  const stubRaf = (frames: FrameRequestCallback[]) => {
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { frames.push(cb); return frames.length })
    vi.stubGlobal('cancelAnimationFrame', () => {})
  }

  it('draws the existing mark with its copy, at a fixed size so nothing shifts while it turns', () => {
    const { getByTestId, getByText } = render(<TesseractLoader size={64} compact text="Loading workbench..." />)
    const mark = getByTestId('tesseract-mark')
    expect(mark.getAttribute('width')).toBe('64')
    expect(mark.getAttribute('height')).toBe('64')
    expect(getByText('Loading workbench...')).toBeTruthy()
  })

  it('animates normally', () => {
    const frames: FrameRequestCallback[] = []
    stubRaf(frames)
    render(<TesseractLoader size={64} compact text="Loading workbench..." />)
    expect(frames.length).toBeGreaterThan(0)
  })

  it('holds a still mark under prefers-reduced-motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
    const frames: FrameRequestCallback[] = []
    stubRaf(frames)
    const { getByTestId } = render(<TesseractLoader size={64} compact text="Loading workbench..." />)
    expect(frames).toHaveLength(0)
    expect(getByTestId('tesseract-mark').querySelectorAll('line').length).toBeGreaterThan(0)
  })
})
