/**
 * The Files repository surface: does it show real data, and does it tell the
 * truth when things go wrong.
 *
 * ── What these pin ─────────────────────────────────────────────────────────
 *
 * This page shipped for a long time as a design mock whose query was
 * `return []`, so the list markup was unreachable and the empty state was the
 * only branch that had ever rendered. The regression that matters most is a
 * return to that: a control that does not work, or an empty state standing in
 * for a failure.
 *
 * So: loading, error and empty must be three distinguishable things, the
 * list must come from the query, and the controls that were placeholders
 * (New Folder, Star, Share) must stay gone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const uploadMutate = vi.fn()
let filesState: any = { data: [], isLoading: false, isError: false, refetch: vi.fn() }

vi.mock('../../hooks/useFiles', () => ({
  useFiles: () => filesState,
  useFile: () => ({ data: null }),
  useUploadFile: () => ({ mutateAsync: uploadMutate, isPending: false }),
  useRenameFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useArchiveFile: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUnlinkFile: () => ({ mutate: vi.fn() }),
  useLinkFile: () => ({ mutate: vi.fn() }),
  useFileUrl: () => vi.fn().mockResolvedValue('https://signed.example/x'),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))

import { FilesPage } from '../FilesPage'

function setViewportWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches =
      (!max || width <= Number(max[1])) &&
      (!min || width >= Number(min[1])) &&
      !/pointer:\s*coarse/.test(query)
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }
  }) as any
}

const FILE = {
  id: 'file-1',
  organization_id: 'org-a',
  name: 'Q3 model.xlsx',
  original_name: 'Q3 model.xlsx',
  storage_bucket: 'assets',
  storage_path: 'org-a/files/file-1/Q3 model.xlsx',
  mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size_bytes: 2048,
  uploaded_by: 'u1',
  created_at: '2026-09-01T00:00:00Z',
  updated_at: '2026-09-01T00:00:00Z',
  deleted_at: null,
  uploader: { id: 'u1', email: 'ana@x.com', first_name: 'Ana', last_name: 'Ruiz' },
  file_links: [],
}

beforeEach(() => {
  uploadMutate.mockReset()
  filesState = { data: [], isLoading: false, isError: false, refetch: vi.fn() }
  setViewportWidth(1440)
})

describe('the three states are distinguishable', () => {
  it('shows a loader while loading, and does NOT say there are no files', () => {
    filesState = { data: undefined, isLoading: true, isError: false, refetch: vi.fn() }
    render(<FilesPage />)
    expect(screen.queryByText(/no files yet/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/couldn't load/i)).not.toBeInTheDocument()
  })

  it('shows an error with a retry, and does NOT say there are no files', async () => {
    const refetch = vi.fn()
    filesState = { data: undefined, isLoading: false, isError: true, refetch }
    render(<FilesPage />)

    expect(screen.getByText(/couldn't load files/i)).toBeInTheDocument()
    // The specific untruth: an empty repository and a broken query are not
    // the same thing and must not read the same.
    expect(screen.queryByText(/no files yet/i)).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('says the repository is empty only when the query succeeded and returned nothing', () => {
    render(<FilesPage />)
    expect(screen.getByText(/no files yet/i)).toBeInTheDocument()
    expect(screen.getByText(/50\.0 MB/)).toBeInTheDocument()
  })
})

describe('the list is real', () => {
  it('renders files from the query on desktop', () => {
    filesState = { data: [FILE], isLoading: false, isError: false, refetch: vi.fn() }
    render(<FilesPage />)

    expect(screen.getByText('Q3 model.xlsx')).toBeInTheDocument()
    expect(screen.getByText('Ana Ruiz')).toBeInTheDocument()
    expect(screen.getByText('2.0 KB')).toBeInTheDocument()
    expect(screen.queryByText(/no files yet/i)).not.toBeInTheDocument()
  })

  it('renders files on a phone too, from the same query', () => {
    setViewportWidth(390)
    filesState = { data: [FILE], isLoading: false, isError: false, refetch: vi.fn() }
    render(<FilesPage />)
    expect(screen.getByText('Q3 model.xlsx')).toBeInTheDocument()
  })

  it('distinguishes "no files" from "no search results"', async () => {
    render(<FilesPage />)
    await userEvent.type(screen.getByPlaceholderText(/search files/i), 'zzz')
    expect(await screen.findByText(/no files match that search/i)).toBeInTheDocument()
  })
})

describe('no placeholder controls came back', () => {
  it('offers no New Folder, Star or Share', () => {
    filesState = { data: [FILE], isLoading: false, isError: false, refetch: vi.fn() }
    render(<FilesPage />)

    for (const label of [/new folder/i, /^star$/i, /^share$/i]) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument()
    }
    // And nothing anywhere promises a feature that does not exist.
    expect(screen.queryByText(/coming soon/i)).not.toBeInTheDocument()
  })
})

describe('upload', () => {
  it('surfaces a failure instead of claiming success', async () => {
    uploadMutate.mockRejectedValue(new Error('Upload did not complete. Nothing was saved.'))
    filesState = { data: [], isLoading: false, isError: false, refetch: vi.fn() }
    const { container } = render(<FilesPage />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'a.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(screen.getByText(/upload did not complete/i)).toBeInTheDocument()
    })
  })

  it('names the orphaned path when cleanup also failed', async () => {
    // An orphan nobody is told about is one nobody cleans up.
    uploadMutate.mockRejectedValue(
      new Error('Upload did not complete, and the partial file could not be removed. Storage path: org-a/files/x/a.pdf'),
    )
    const { container } = render(<FilesPage />)

    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.upload(input, new File(['x'], 'a.pdf', { type: 'application/pdf' }))

    await waitFor(() => {
      expect(screen.getByText(/org-a\/files\/x\/a\.pdf/)).toBeInTheDocument()
    })
  })
})
