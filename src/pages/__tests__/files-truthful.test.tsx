/**
 * Files says what is true.
 *
 * The surface used to render a working-looking file manager on top of a query
 * that was a hard-coded `return []`: Upload and New Folder buttons, a search
 * field, category chips with counts, a grid/list toggle, and a table whose
 * rows carried Download, Share, Star and More buttons with empty handlers.
 * There is no `files` table anywhere, so the list could never be non-empty
 * and none of those controls could ever do anything.
 *
 * These assertions are about ABSENCE, which is the whole point: the failure
 * mode being guarded is a control coming back that implies a repository
 * exists. The nav entry itself stays — Files is staying in the product.
 */

import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), auth: {} },
}))

import { FilesPage } from '../FilesPage'
import { getMobileSurface, isDesktopOnly } from '../../lib/mobile/mobile-surfaces'

describe('FilesPage tells the truth', () => {
  it('states that the repository is not connected', () => {
    render(<FilesPage />)
    expect(screen.getByText(/repository is not connected yet/i)).toBeInTheDocument()
  })

  it('points at the workspaces that do hold files', () => {
    render(<FilesPage />)
    expect(screen.getByText(/remain\s+available from those workspaces/i)).toBeInTheDocument()
  })

  it('does not claim files merely have not been added yet', () => {
    // The old copy was "No files yet" over "Upload files or create folders to
    // organize your resources" — an empty repository, not an absent one.
    render(<FilesPage />)
    expect(screen.queryByText(/no files yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/create folders/i)).not.toBeInTheDocument()
  })

  it('offers no control that cannot work', () => {
    const { container } = render(<FilesPage />)

    for (const label of [/upload/i, /new folder/i, /download/i, /share/i, /star/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    // Nothing actionable at all: no buttons, no inputs, no links.
    expect(container.querySelectorAll('button')).toHaveLength(0)
    expect(container.querySelectorAll('input')).toHaveLength(0)
    expect(container.querySelectorAll('select')).toHaveLength(0)
  })

  it('never says a feature is coming soon', () => {
    render(<FilesPage />)
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })
})

describe('Files stays in the product', () => {
  it('keeps its registry entry and its place in the phone nav', () => {
    const surface = getMobileSurface('files')
    expect(surface).toBeDefined()
    expect(surface?.inNav).toBe(true)
    expect(isDesktopOnly('files')).toBe(false)
  })
})
